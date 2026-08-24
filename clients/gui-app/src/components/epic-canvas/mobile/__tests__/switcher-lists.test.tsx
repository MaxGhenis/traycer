import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitcherAgentsList } from "@/components/epic-canvas/mobile/switcher-agents-list";
import { useEpicSidebarExpansionStore } from "@/stores/epics/epic-sidebar-expansion-store";

interface FixtureRecord {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly type: string;
  readonly status: number | null;
  readonly hostId: string;
}
/**
 * The whole ref, not just its `type`. The ref's `hostId` is what the opened
 * tile BINDS TO for life, so it is the field most worth asserting - and a
 * fixture that dropped it is why a wrong-host ref went unnoticed here.
 */
interface ActivateRef {
  readonly type: string;
  readonly hostId: string;
}
interface ActivateCall {
  readonly id: string;
  readonly ref: ActivateRef;
}
interface Holder {
  records: ReadonlyArray<FixtureRecord>;
  activeId: string | null;
  role: "owner" | "viewer";
  activateCalls: ActivateCall[];
  workingAgentIds: ReadonlySet<string>;
  activityTiers: ReadonlyMap<string, "turn" | "background">;
  /** Chat ids the agents list subscribed indicator state for, per render. */
  indicatorChatIdCalls: ReadonlyArray<string>[];
  /** What `useEpicNodeHostId` answers - the row's OWN owner host. */
  ownerHostIdByNodeId: Record<string, string>;
  /** Rows the projection reports as archived. */
  archivedIds: ReadonlySet<string>;
  /** Per-row last activity, for the trailing compact timestamp. */
  updatedAtByNodeId: Record<string, number>;
  /** Whether the epic's host advertises `epic.setChatArchived`. */
  archiveSupported: boolean;
  indicators: IndicatorFixture;
}

interface IndicatorFlags {
  readonly unreadFailure: boolean;
  readonly pendingFork: boolean;
  readonly pendingApproval: boolean;
  readonly pendingInterview: boolean;
  readonly unreadDone: boolean;
}
interface IndicatorResponseFixture {
  readonly epics: Record<string, never>;
  readonly chats: Record<string, IndicatorFlags>;
}
interface IndicatorFixture extends IndicatorResponseFixture {
  readonly byOriginHostId?: Record<string, IndicatorResponseFixture>;
}

const holder = vi.hoisted((): Holder => ({
  records: [],
  activeId: null,
  role: "owner",
  activateCalls: [],
  workingAgentIds: new Set<string>(),
  activityTiers: new Map<string, "turn" | "background">(),
  indicatorChatIdCalls: [],
  ownerHostIdByNodeId: {},
  archivedIds: new Set<string>(),
  updatedAtByNodeId: {},
  archiveSupported: false,
  indicators: { epics: {}, chats: {} },
}));

/**
 * The projector's tree index, rebuilt from the fixture records' `parentId` -
 * roots and each sibling bucket in last-updated-desc order, exactly as
 * `projectTreeSlice` emits them. The agents list WALKS this index now, so a
 * fixture that returned an empty `rootIds` would render an empty tree however
 * many records it declared.
 */
function fixtureTree(): {
  readonly rootIds: readonly string[];
  readonly childrenByParent: Readonly<Record<string, readonly string[]>>;
  readonly nodeById: Readonly<Record<string, TreeNodeFixture>>;
} {
  const nodeById: Record<string, TreeNodeFixture> = {};
  holder.records.forEach((record, index) => {
    nodeById[record.id] = {
      id: record.id,
      type: record.type,
      parentId: record.parentId,
      title: record.name,
      createdAt: index,
      updatedAt: index,
    };
  });
  const byRecency = (a: string, b: string): number =>
    nodeById[b].updatedAt - nodeById[a].updatedAt;
  const childrenByParent: Record<string, string[]> = {};
  const rootIds: string[] = [];
  for (const record of holder.records) {
    const parentId = record.parentId;
    if (parentId === null || !Object.hasOwn(nodeById, parentId)) {
      rootIds.push(record.id);
      continue;
    }
    (childrenByParent[parentId] ??= []).push(record.id);
  }
  rootIds.sort(byRecency);
  for (const ids of Object.values(childrenByParent)) ids.sort(byRecency);
  return { rootIds, childrenByParent, nodeById };
}

interface TreeNodeFixture {
  readonly id: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

vi.mock("@/lib/epic-selectors", () => ({
  useEpicArtifactRecords: () => holder.records,
  useEpicActiveAgentIds: () => holder.workingAgentIds,
  useEpicAgentActivityTiers: () => holder.activityTiers,
  useEpicChatHarnessId: () => null,
  useMaybeEpicTuiAgentHarnessId: () => null,
  useEpicPermissionRole: () => holder.role,
  useEpicChatIds: () =>
    holder.records
      .filter((record) => record.type === "chat")
      .map((record) => record.id),
  // The chat projection's OWN host. Deliberately distinct from the `hostId` on
  // the records above, which is the app-wide ACTIVE host for chat rows.
  useEpicNodeHostId: (nodeId: string) =>
    holder.ownerHostIdByNodeId[nodeId] ?? null,
  useEpicNodeArchived: (nodeId: string) => holder.archivedIds.has(nodeId),
  useEpicNodeUpdatedAt: (nodeId: string) =>
    holder.updatedAtByNodeId[nodeId] ?? 0,
  useAncestorIds: () => new Set<string>(),
  useEpicTreeIndex: () => fixtureTree(),
  useEpicTreeNode: (nodeId: string) => fixtureTree().nodeById[nodeId] ?? null,
  useChildIds: (parentId: string) =>
    fixtureTree().childrenByParent[parentId] ?? [],
}));
// The row menus' per-list facts. Both capabilities default OFF, which is the
// fail-closed production default too: Archive and Make private only appear once
// a handshake proves the host advertises them.
vi.mock("@/hooks/epic/use-chat-archive-support", () => ({
  useChatArchiveSupported: () => holder.archiveSupported,
}));
vi.mock("@/hooks/epic/use-chat-sharing-support", () => ({
  useCloudChatVisibilitySupported: () => false,
}));
vi.mock("@/hooks/epics/use-epic-collaborators-query", () => ({
  useEpicCollaboratorsQuery: () => ({ data: undefined }),
}));
vi.mock("@/hooks/chats/use-cloud-chat-queries", () => ({
  useCloudChatList: () => ({ data: undefined }),
}));
vi.mock("@/hooks/chats/use-chat-publication-targets", () => ({
  useChatPublicationTargets: () => ({ data: undefined }),
  publicationTargetMap: () => new Map<string, string>(),
}));
vi.mock("@/hooks/epic/use-epic-chat-visibility-mutations", () => ({
  useEpicSetCloudChatVisibility: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/chats/chat-sharing-inflight", () => ({
  useChatSharingInFlight: () => false,
}));
vi.mock("@/stores/epics/canvas/canvas-selectors", () => ({
  useIsActiveEpicArtifact: (_tabId: string, id: string) =>
    holder.activeId === id,
  // The focused tile, whose ancestors the agents tree expands implicitly. The
  // canvas store re-exports these, so a partial mock here leaves the store's
  // re-export undefined rather than falling back to the real hook.
  useActiveEpicArtifactId: () => holder.activeId,
  findOpenArtifactInTab: () => null,
}));
vi.mock("@/components/epic-canvas/mobile/use-switcher-activate", () => ({
  useSwitcherActivate:
    () =>
    (
      id: string,
      buildRef: () => { readonly type: string; readonly hostId: string },
    ) => {
      holder.activateCalls.push({ id, ref: buildRef() });
    },
}));
vi.mock("@/lib/host", () => ({ useHostClient: () => null }));
vi.mock("@/hooks/host/use-addressable-host-id", () => ({
  useAddressableHostId: () => "host-A",
}));
// Keep the row menu's mutation + focus hooks inert so it mounts without a
// QueryClient / host client (the menu's editor gating is what we assert).
vi.mock("@/hooks/epic/use-epic-chat-mutations", () => ({
  useEpicRenameChat: () => ({ mutate: vi.fn(), isPending: false }),
  useEpicDeleteChat: () => ({ mutate: vi.fn(), isPending: false }),
  useEpicArchiveChat: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/epic/use-epic-tui-agent-mutations", () => ({
  useEpicRenameTuiAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useEpicDeleteTuiAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/epic/use-epic-node-mutations", () => ({
  useEpicDeleteArtifact: () => ({ mutate: vi.fn(), isPending: false }),
  useEpicRenameArtifact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/terminal/use-terminal-rename-for-mutation", () => ({
  useTerminalRenameFor: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/terminal/use-terminal-kill-for-mutation", () => ({
  useTerminalKillFor: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/epic/use-epic-session-host-client", () => ({
  useEpicSessionHostClient: () => null,
}));
vi.mock("@/hooks/epic/use-epic-nested-focus-navigation", () => ({
  useEpicNestedFocusNavigation: () => vi.fn(),
}));
// The agents list owns the indicator subscription its rows read through
// context; record what it asks for so the wiring is asserted rather than
// assumed, and answer from the holder.
vi.mock("@/hooks/epic/use-epic-session-host-id", () => ({
  useEpicSessionHostId: () => "host-A",
}));
vi.mock("@/hooks/notifications/use-notification-indicators-query", () => ({
  useNotificationIndicators: (args: {
    readonly chatIds: readonly string[];
  }) => {
    holder.indicatorChatIdCalls.push(args.chatIds);
    return holder.indicators;
  },
}));
// Each category list renders its own create row/menu (Agents: New chat,
// Terminals: New terminal, Artifacts: a "+" kind menu); stub all three to
// markers so their own wiring (composer mode, the terminal picker dialog, the
// artifact-kind dropdown) doesn't need to mount here - this file exercises
// each list's editor gating and row positioning in isolation.
vi.mock("@/components/epic-canvas/mobile/switcher-create-actions", () => ({
  SwitcherNewChatRow: () => (
    <button type="button" data-testid="switcher-new-chat" />
  ),
  SwitcherNewTerminalRow: () => (
    <button type="button" data-testid="switcher-new-terminal" />
  ),
  SwitcherNewArtifactMenu: () => (
    <button type="button" data-testid="new-artifact-action" />
  ),
}));

const PROPS = { epicId: "epic-1", tabId: "tab-1", onClose: () => {} };

beforeEach(() => {
  holder.records = [];
  holder.activeId = null;
  holder.role = "owner";
  holder.activateCalls = [];
  holder.workingAgentIds = new Set<string>();
  holder.activityTiers = new Map<string, "turn" | "background">();
  holder.indicatorChatIdCalls = [];
  holder.ownerHostIdByNodeId = {};
  holder.archivedIds = new Set<string>();
  holder.updatedAtByNodeId = {};
  holder.archiveSupported = false;
  holder.indicators = { epics: {}, chats: {} };
  // Module-level and shared with the desktop sidebar, so one test's collapse
  // would otherwise decide the next test's chevron state - and its label.
  useEpicSidebarExpansionStore.setState({
    userExpandedByScope: {},
    userCollapsedByScope: {},
  });
});
afterEach(cleanup);

describe("<SwitcherAgentsList />", () => {
  beforeEach(() => {
    holder.records = [
      {
        id: "chat-1",
        parentId: null,
        name: "Alpha",
        type: "chat",
        status: null,
        hostId: "host-A",
      },
      {
        id: "tui-1",
        parentId: null,
        name: "Beta",
        type: "terminal-agent",
        status: null,
        hostId: "host-A",
      },
      {
        id: "spec-1",
        parentId: null,
        name: "Spec",
        type: "spec",
        status: null,
        hostId: "host-A",
      },
    ];
  });

  it("renders chats + terminal-agents interleaved by recency (artifacts excluded)", () => {
    render(<SwitcherAgentsList {...PROPS} />);
    expect(
      screen.getByTestId("switcher-agent-row-chat-1").textContent,
    ).toContain("Alpha");
    expect(
      screen.getByTestId("switcher-agent-row-tui-1").textContent,
    ).toContain("Beta");
    expect(screen.queryByTestId("switcher-agent-row-spec-1")).toBeNull();
    // tui-1 (updatedAt 1) is more recent than chat-1 (updatedAt 0), so the list
    // interleaves by recency rather than grouping all chats before agents.
    const order = Array.from(
      document.querySelectorAll('[data-testid^="switcher-agent-row-"]'),
    ).map((row) => row.getAttribute("data-testid"));
    expect(order).toEqual([
      "switcher-agent-row-tui-1",
      "switcher-agent-row-chat-1",
    ]);
  });

  it("marks the active tile with a check and taps open it (chat ref)", () => {
    holder.activeId = "chat-1";
    render(<SwitcherAgentsList {...PROPS} />);
    const activeRow = screen.getByTestId("switcher-agent-row-chat-1");
    expect(activeRow.getAttribute("aria-current")).toBe("true");
    fireEvent.click(activeRow);
    expect(holder.activateCalls).toHaveLength(1);
    expect(holder.activateCalls[0].id).toBe("chat-1");
    expect(holder.activateCalls[0].ref.type).toBe("chat");
  });

  it("spins a row whose agent is mid-turn and leaves the idle rows alone", () => {
    holder.workingAgentIds = new Set<string>(["chat-1"]);
    holder.activityTiers = new Map<string, "turn" | "background">([
      ["chat-1", "turn"],
    ]);
    render(<SwitcherAgentsList {...PROPS} />);
    expect(screen.getByTestId("switcher-agent-activity-chat-1")).toBeTruthy();
    expect(screen.queryByTestId("switcher-agent-activity-tui-1")).toBeNull();
  });

  it("updates a row's status live while the sheet stays open", () => {
    const view = render(<SwitcherAgentsList {...PROPS} />);
    expect(screen.queryByTestId("switcher-agent-activity-tui-1")).toBeNull();

    holder.workingAgentIds = new Set<string>(["tui-1"]);
    holder.activityTiers = new Map<string, "turn" | "background">([
      ["tui-1", "turn"],
    ]);
    view.rerender(<SwitcherAgentsList {...PROPS} />);
    expect(screen.getByTestId("switcher-agent-activity-tui-1")).toBeTruthy();

    // …and back down when the turn ends.
    holder.workingAgentIds = new Set<string>();
    holder.activityTiers = new Map<string, "turn" | "background">();
    view.rerender(<SwitcherAgentsList {...PROPS} />);
    expect(screen.queryByTestId("switcher-agent-activity-tui-1")).toBeNull();
  });

  it("renders the desktop mapping's background glyph, not the busy spinner, for background-only work", () => {
    holder.workingAgentIds = new Set<string>(["tui-1"]);
    holder.activityTiers = new Map<string, "turn" | "background">([
      ["tui-1", "background"],
    ]);
    render(<SwitcherAgentsList {...PROPS} />);
    expect(
      screen.getByTestId("switcher-agent-background-activity-tui-1"),
    ).toBeTruthy();
    expect(screen.queryByTestId("switcher-agent-activity-tui-1")).toBeNull();
  });

  it("surfaces notification status on a row, outranking a running turn", () => {
    holder.workingAgentIds = new Set<string>(["chat-1"]);
    holder.activityTiers = new Map<string, "turn" | "background">([
      ["chat-1", "turn"],
    ]);
    holder.indicators = {
      epics: {},
      chats: {
        "chat-1": {
          unreadFailure: false,
          pendingFork: false,
          pendingApproval: true,
          pendingInterview: false,
          unreadDone: false,
        },
      },
    };
    render(<SwitcherAgentsList {...PROPS} />);
    expect(screen.getByTestId("switcher-agent-approval-chat-1")).toBeTruthy();
    expect(screen.queryByTestId("switcher-agent-activity-chat-1")).toBeNull();
  });

  it("keeps a retained epic's rows reading status from their own host after the active host changes", () => {
    // Session/provider bound to host A; the user has since switched the app's
    // active host to B. `useEpicArtifactRecords()` stamps chat rows with the
    // ACTIVE host, so the record says B while the chat still lives on A.
    holder.records = [
      {
        id: "chat-1",
        parentId: null,
        name: "Alpha",
        type: "chat",
        status: null,
        hostId: "host-B",
      },
    ];
    holder.ownerHostIdByNodeId = { "chat-1": "host-A" };
    holder.indicators = {
      epics: {},
      chats: {
        "chat-1": {
          unreadFailure: true,
          pendingFork: false,
          pendingApproval: false,
          pendingInterview: false,
          unreadDone: false,
        },
      },
      byOriginHostId: {
        "host-A": {
          epics: {},
          chats: {
            "chat-1": {
              unreadFailure: true,
              pendingFork: false,
              pendingApproval: false,
              pendingInterview: false,
              unreadDone: false,
            },
          },
        },
        "host-B": { epics: {}, chats: {} },
      },
    };
    render(<SwitcherAgentsList {...PROPS} />);
    // Passing the record's `hostId` would read `byOriginHostId["host-B"]` -
    // empty - and the row would render an inert idle glyph.
    expect(screen.getByTestId("switcher-agent-failure-chat-1")).toBeTruthy();

    // …and the same rule governs the ref the tap builds. A tab binds its host
    // FOR LIFE, so a B-bound tile for an A-owned chat asks the wrong machine
    // for the transcript permanently - not just until the next host switch.
    fireEvent.click(screen.getByTestId("switcher-agent-row-chat-1"));
    expect(holder.activateCalls).toHaveLength(1);
    expect(holder.activateCalls[0].ref.hostId).toBe("host-A");
  });

  it("falls back to the record's host for a legacy chat with no projected owner", () => {
    // `useEpicNodeHostId` answers null for a chat predating the field. The
    // record's host is the active one by construction, matching the desktop
    // row's `?? activeHostId` - a tap always opens something.
    holder.records = [
      {
        id: "chat-1",
        parentId: null,
        name: "Alpha",
        type: "chat",
        status: null,
        hostId: "host-B",
      },
    ];
    holder.ownerHostIdByNodeId = {};
    render(<SwitcherAgentsList {...PROPS} />);
    fireEvent.click(screen.getByTestId("switcher-agent-row-chat-1"));
    expect(holder.activateCalls[0].ref.hostId).toBe("host-B");
  });

  it("opens a TUI agent against its projected owner host", () => {
    // In production both sides of the `??` read the same projection field for
    // a terminal-agent, so they cannot disagree; the fixture drives them apart
    // only to pin WHICH one the row takes - the owner, uniformly, with no
    // per-kind branch to fall out of sync.
    holder.ownerHostIdByNodeId = { "tui-1": "host-C" };
    render(<SwitcherAgentsList {...PROPS} />);
    fireEvent.click(screen.getByTestId("switcher-agent-row-tui-1"));
    expect(holder.activateCalls[0].ref.type).toBe("terminal-agent");
    expect(holder.activateCalls[0].ref.hostId).toBe("host-C");
  });

  it("subscribes indicator state for exactly the agent rows it lists", () => {
    render(<SwitcherAgentsList {...PROPS} />);
    const chatIds = holder.indicatorChatIdCalls.at(-1);
    // Agents only - the spec artifact in the fixture is not a chat entity, and
    // the ids are sorted so the query key does not churn on every re-sort.
    expect(chatIds).toEqual(["chat-1", "tui-1"]);
  });

  it("nests a child agent under its parent, and collapsing the parent hides it", () => {
    holder.records = [
      {
        id: "chat-1",
        parentId: null,
        name: "Alpha",
        type: "chat",
        status: null,
        hostId: "host-A",
      },
      {
        id: "chat-2",
        parentId: "chat-1",
        name: "Child",
        type: "chat",
        status: null,
        hostId: "host-A",
      },
    ];
    render(<SwitcherAgentsList {...PROPS} />);
    const parent = screen.getByTestId("switcher-agent-row-chat-1");
    const child = screen.getByTestId("switcher-agent-row-chat-2");
    // The child follows its parent in document order rather than landing
    // wherever a global recency sort would have put it.
    expect(
      parent.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // …and reads as one level deeper: the indent is on the row's wrapper.
    const padding = (element: Element): string =>
      (element.parentElement as HTMLElement).style.paddingLeft;
    expect(padding(parent)).toBe("8px");
    expect(padding(child)).toBe("28px");

    // Roots are expanded implicitly, so the parent starts open and its chevron
    // closes it.
    fireEvent.click(screen.getByRole("button", { name: "Collapse Alpha" }));
    expect(screen.queryByTestId("switcher-agent-row-chat-2")).toBeNull();
  });

  it("gives a leaf no chevron and a parent an expand control", () => {
    holder.records = [
      {
        id: "chat-1",
        parentId: null,
        name: "Alpha",
        type: "chat",
        status: null,
        hostId: "host-A",
      },
      {
        id: "chat-2",
        parentId: "chat-1",
        name: "Child",
        type: "chat",
        status: null,
        hostId: "host-A",
      },
    ];
    render(<SwitcherAgentsList {...PROPS} />);
    // By role, not test id: the control's accessible name and `aria-expanded`
    // ARE the contract a phone user reaches it through, and a test-id query
    // would still pass with both dropped.
    expect(screen.getByRole("button", { name: "Collapse Alpha" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /(Collapse|Expand) Child/ }),
    ).toBeNull();
  });

  it("renders each row's last activity on the shared compact ladder", () => {
    // Offset past the hour boundary: the shared clock samples `now` at module
    // load, so an exactly-3h delta has already floored to "2h" by the time this
    // renders.
    const now = Date.now();
    holder.updatedAtByNodeId = {
      "chat-1": now - (3 * 60 + 5) * 60 * 1000,
      "tui-1": now,
    };
    render(<SwitcherAgentsList {...PROPS} />);
    expect(
      screen.getByTestId("switcher-agent-row-chat-1").textContent,
    ).toContain("3h");
    expect(
      screen.getByTestId("switcher-agent-row-tui-1").textContent,
    ).toContain("now");
  });

  it("lists an archived agent rather than hiding it, and marks it", () => {
    holder.archivedIds = new Set<string>(["chat-1"]);
    render(<SwitcherAgentsList {...PROPS} />);
    const row = screen.getByTestId("switcher-agent-row-chat-1");
    expect(row.textContent).toContain("Archived");
    expect(
      screen.getByTestId("switcher-agent-row-tui-1").textContent,
    ).not.toContain("Archived");
  });

  it("shows the '…' menu for an editor and hides it entirely for a viewer", () => {
    const editor = render(<SwitcherAgentsList {...PROPS} />);
    expect(screen.getByTestId("switcher-more-chat-1")).toBeTruthy();
    editor.unmount();

    holder.role = "viewer";
    render(<SwitcherAgentsList {...PROPS} />);
    expect(screen.queryByTestId("switcher-more-chat-1")).toBeNull();
  });
});


describe("switcher create affordances (editor-gated)", () => {
  it("shows the New chat row as the first row for an editor and hides it for a viewer", () => {
    holder.records = [
      {
        id: "chat-1",
        parentId: null,
        name: "Alpha",
        type: "chat",
        status: null,
        hostId: "host-A",
      },
    ];
    const editor = render(<SwitcherAgentsList {...PROPS} />);
    const newChatRow = screen.getByTestId("switcher-new-chat");
    const firstItemRow = screen.getByTestId("switcher-agent-row-chat-1");
    // DOCUMENT_POSITION_FOLLOWING on `firstItemRow` relative to `newChatRow`
    // means the create row comes first in document order.
    expect(
      newChatRow.compareDocumentPosition(firstItemRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    editor.unmount();

    holder.role = "viewer";
    render(<SwitcherAgentsList {...PROPS} />);
    expect(screen.queryByTestId("switcher-new-chat")).toBeNull();
  });

  it("keeps the New chat row above the empty-state message when there are no agents", () => {
    render(<SwitcherAgentsList {...PROPS} />);
    expect(screen.getByTestId("switcher-new-chat")).toBeTruthy();
    expect(screen.getByText("No agents yet.")).toBeTruthy();
  });

});
