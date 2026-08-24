import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwitcherArtifactsList } from "@/components/epic-canvas/mobile/switcher-artifacts-list";
import { STATUS_DOT_CLASSES } from "@/components/epic-canvas/sidebar/epic-sidebar-tree-shared";
import {
  SWITCHER_ROW_BASE_PAD_LEFT,
  SWITCHER_ROW_INDENT_PX,
} from "@/components/epic-canvas/mobile/switcher-row-nesting";
import { useLeftPanelStore } from "@/stores/epics/left-panel-store";
import { useEpicSidebarExpansionStore } from "@/stores/epics/epic-sidebar-expansion-store";

/**
 * The switcher's artifacts category, exercised as the TREE it now is: the same
 * projector index the desktop panel walks, the same per-tab filter/sort/
 * expansion state, rendered as touch rows. Everything below the tree index is
 * stubbed at the module boundary - the point under test is that hierarchy,
 * ordering and the panel's shared controls reach the phone, not how the store
 * projects.
 */
interface FixtureNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly type: string;
  readonly status: number | null;
  readonly updatedAt: number;
}

interface Holder {
  nodes: ReadonlyArray<FixtureNode>;
  role: "owner" | "viewer";
  activeId: string | null;
  createCalls: { parentId: string | null; artifactType: string }[];
  exportCalls: { format: string; ids: readonly string[] }[];
}

const holder = vi.hoisted((): Holder => ({
  nodes: [],
  role: "owner",
  activeId: null,
  createCalls: [],
  exportCalls: [],
}));

function nodeById(): Record<string, FixtureNode> {
  return Object.fromEntries(holder.nodes.map((node) => [node.id, node]));
}
function childrenByParent(): Record<string, readonly string[]> {
  const map: Record<string, string[]> = {};
  for (const node of holder.nodes) {
    if (node.parentId === null) continue;
    map[node.parentId] = [...(map[node.parentId] ?? []), node.id];
  }
  return map;
}
function rootIds(): readonly string[] {
  return holder.nodes.flatMap((node) =>
    node.parentId === null ? [node.id] : [],
  );
}
function findNode(id: string): FixtureNode | null {
  return holder.nodes.find((node) => node.id === id) ?? null;
}

vi.mock("@/lib/epic-selectors", () => ({
  useRootIds: () => rootIds(),
  useChildIds: (parentId: string) => childrenByParent()[parentId] ?? [],
  useEpicTreeIndex: () => ({
    rootIds: rootIds(),
    childrenByParent: childrenByParent(),
    nodeById: nodeById(),
  }),
  useEpicTreeNode: (id: string) => findNode(id),
  useEpicArtifactStatus: (id: string) => findNode(id)?.status ?? null,
  useEpicArtifactRecords: () =>
    holder.nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      name: node.title,
      type: node.type,
      status: node.status,
      hostId: "host-A",
    })),
  useAncestorIds: () => new Set<string>(),
  useEpicPermissionRole: () => holder.role,
}));
vi.mock("@/hooks/use-epic-store", () => ({
  useEpicStore: (selector: (state: unknown) => unknown) =>
    selector({
      artifacts: {
        allIds: holder.nodes.flatMap((node) =>
          node.type === "chat" ? [] : [node.id],
        ),
        byId: Object.fromEntries(
          holder.nodes.flatMap((node) =>
            node.type === "chat"
              ? []
              : [
                  [
                    node.id,
                    {
                      id: node.id,
                      kind: node.type,
                      status: node.status,
                      updatedAt: node.updatedAt,
                    },
                  ],
                ],
          ),
        ),
      },
    }),
}));
vi.mock("@/stores/epics/canvas/canvas-selectors", () => ({
  useActiveEpicArtifactId: () => holder.activeId,
  useIsActiveEpicArtifact: (_tabId: string, id: string) =>
    holder.activeId === id,
  findOpenArtifactInTab: () => null,
}));
vi.mock("@/stores/epics/canvas/store", () => ({
  useEpicCanvasStore: (selector: (state: unknown) => unknown) =>
    selector({
      prepareOpenTileInTabFocusTarget: vi.fn(),
      prepareCloseCanvasTabFocusTarget: vi.fn(),
    }),
}));
vi.mock("@/components/epic-canvas/mobile/use-switcher-activate", () => ({
  useSwitcherActivate: () => vi.fn(),
}));
vi.mock("@/providers/use-open-epic-handle", () => ({
  useOpenEpicHandle: () => ({ store: { getState: () => ({}) } }),
}));
vi.mock("@/hooks/epic/use-epic-session-host-id", () => ({
  useEpicSessionHostId: () => "host-A",
}));
vi.mock("@/hooks/epic/use-epic-session-host-client", () => ({
  useEpicSessionHostClient: () => null,
}));
vi.mock("@/hooks/epic/use-epic-nested-focus-navigation", () => ({
  useEpicNestedFocusNavigation: () => vi.fn(),
}));
vi.mock("@/hooks/epic/use-epic-node-mutations", () => ({
  useEpicCreateArtifact: () => ({
    mutate: (vars: { parentId: string | null; artifactType: string }) => {
      holder.createCalls.push({
        parentId: vars.parentId,
        artifactType: vars.artifactType,
      });
    },
    isPending: false,
  }),
  useEpicDeleteArtifact: () => ({ mutate: vi.fn(), isPending: false }),
  useEpicRenameArtifact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/epic/use-epic-chat-mutations", () => ({
  useEpicRenameChat: () => ({ mutate: vi.fn(), isPending: false }),
  useEpicDeleteChat: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/epic/use-epic-tui-agent-mutations", () => ({
  useEpicRenameTuiAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useEpicDeleteTuiAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/terminal/use-terminal-kill-for-mutation", () => ({
  useTerminalKillFor: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/terminal/use-terminal-rename-for-mutation", () => ({
  useTerminalRenameFor: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/epic/use-epic-export-artifacts-mutation", () => ({
  useEpicExportArtifacts: () => ({
    mutate: (vars: {
      readonly artifacts: ReadonlyArray<{ readonly id: string }>;
      readonly format: string;
    }) => {
      holder.exportCalls.push({
        format: vars.format,
        ids: vars.artifacts.map((artifact) => artifact.id),
      });
    },
    isPending: false,
  }),
}));

/**
 * Radix's DropdownMenuTrigger opens on pointerdown, not click - a plain click
 * leaves the menu closed and every entry unqueryable.
 */
function openMenu(triggerTestId: string): void {
  fireEvent.pointerDown(screen.getByTestId(triggerTestId), { button: 0 });
}

const PROPS = { epicId: "epic-1", tabId: "tab-1", onClose: () => {} };

/** Spec "Parent" with a ticket child, plus a chat the list must ignore. */
const NESTED_FIXTURE: ReadonlyArray<FixtureNode> = [
  {
    id: "spec-1",
    parentId: null,
    title: "Parent Spec",
    type: "spec",
    status: null,
    updatedAt: 1,
  },
  {
    id: "tk-1",
    parentId: "spec-1",
    title: "Child Ticket",
    type: "ticket",
    status: 1,
    updatedAt: 5,
  },
  {
    id: "chat-1",
    parentId: null,
    title: "Alpha",
    type: "chat",
    status: null,
    updatedAt: 9,
  },
];

beforeEach(() => {
  holder.nodes = NESTED_FIXTURE;
  holder.role = "owner";
  holder.activeId = null;
  holder.createCalls = [];
  holder.exportCalls = [];
  useLeftPanelStore.getState().resetArtifactView("epic-1");
  useEpicSidebarExpansionStore.setState({
    userExpandedByScope: {},
    userCollapsedByScope: {},
  });
});
afterEach(cleanup);

describe("<SwitcherArtifactsList /> tree", () => {
  it("nests a child under its parent instead of listing both at the root", () => {
    render(<SwitcherArtifactsList {...PROPS} />);
    const child = screen.getByTestId("switcher-artifact-row-tk-1");
    // The child sits inside a `role="group"` owned by the parent's treeitem -
    // the structural claim, independent of how the indent is painted.
    const group = child.closest('ul[role="group"]');
    expect(group).not.toBeNull();
    expect(
      group
        ?.closest('li[role="treeitem"]')
        ?.contains(screen.getByTestId("switcher-artifact-row-spec-1")),
    ).toBe(true);
    // Chats belong to the Agents category, never this one.
    expect(screen.queryByTestId("switcher-artifact-row-chat-1")).toBeNull();
  });

  it("indents by depth, so a child is not flush with its parent", () => {
    render(<SwitcherArtifactsList {...PROPS} />);
    const parentIndent = screen
      .getByTestId("switcher-artifact-row-spec-1")
      .closest<HTMLElement>("[style]");
    const childIndent = screen
      .getByTestId("switcher-artifact-row-tk-1")
      .closest<HTMLElement>("[style]");
    // The DESKTOP sidebar's constants, re-exported rather than restated, so a
    // change to the tree's indent moves both surfaces or neither.
    expect(parentIndent?.style.paddingLeft).toBe(
      `${SWITCHER_ROW_BASE_PAD_LEFT}px`,
    );
    expect(childIndent?.style.paddingLeft).toBe(
      `${SWITCHER_ROW_INDENT_PX + SWITCHER_ROW_BASE_PAD_LEFT}px`,
    );
  });

  it("collapses and re-expands a subtree from the row's own chevron", () => {
    render(<SwitcherArtifactsList {...PROPS} />);
    const chevron = screen.getByTestId("switcher-artifact-row-spec-1-toggle");
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chevron);
    expect(screen.queryByTestId("switcher-artifact-row-tk-1")).toBeNull();
    fireEvent.click(screen.getByTestId("switcher-artifact-row-spec-1-toggle"));
    expect(screen.getByTestId("switcher-artifact-row-tk-1")).toBeTruthy();
  });

  it("gives a childless row no chevron control", () => {
    render(<SwitcherArtifactsList {...PROPS} />);
    expect(
      screen.queryByTestId("switcher-artifact-row-tk-1-toggle"),
    ).toBeNull();
  });

  it("names the status a dot stands for, since a phone cannot hover it", () => {
    render(<SwitcherArtifactsList {...PROPS} />);
    const dot = screen.getByLabelText("In Progress");
    expect(dot.className).toContain(STATUS_DOT_CLASSES[1]);
  });
});

describe("<SwitcherArtifactsList /> shared panel controls", () => {
  it("distinguishes an empty epic from one whose filters hide everything", () => {
    const empty = render(<SwitcherArtifactsList {...PROPS} />);
    expect(screen.queryByTestId("switcher-artifacts-filter-empty")).toBeNull();
    empty.unmount();

    // Only reviews may pass; the fixture has none, so the tree is filtered
    // empty rather than genuinely empty.
    useLeftPanelStore.getState().toggleArtifactKind("epic-1", "review");
    render(<SwitcherArtifactsList {...PROPS} />);
    expect(screen.getByTestId("switcher-artifacts-filter-empty")).toBeTruthy();
    expect(screen.queryByTestId("switcher-artifacts-empty")).toBeNull();
    expect(
      screen.getByText("Status, Type, or Read state may be hiding artifacts."),
    ).toBeTruthy();
  });

  it("shows the empty state when the epic has no artifacts at all", () => {
    holder.nodes = [];
    render(<SwitcherArtifactsList {...PROPS} />);
    expect(screen.getByTestId("switcher-artifacts-empty")).toBeTruthy();
    expect(screen.getByText("No artifacts yet.")).toBeTruthy();
  });

  it("hides a filtered-out root while keeping the ones that match", () => {
    holder.nodes = [
      ...NESTED_FIXTURE,
      {
        id: "rv-1",
        parentId: null,
        title: "Review One",
        type: "review",
        status: null,
        updatedAt: 3,
      },
    ];
    useLeftPanelStore.getState().toggleArtifactKind("epic-1", "ticket");
    render(<SwitcherArtifactsList {...PROPS} />);
    expect(screen.getByTestId("switcher-artifact-row-tk-1")).toBeTruthy();
    // The parent spec survives as the matched ticket's ancestor - a match must
    // stay reachable - while a root with nothing matching under it does not.
    expect(screen.getByTestId("switcher-artifact-row-spec-1")).toBeTruthy();
    expect(screen.queryByTestId("switcher-artifact-row-rv-1")).toBeNull();
  });

  it("offers the desktop filter menu, viewer included", () => {
    holder.role = "viewer";
    render(<SwitcherArtifactsList {...PROPS} />);
    expect(screen.getByLabelText(/Filter artifacts/)).toBeTruthy();
    // Creating is still editor-only.
    expect(screen.queryByTestId("switcher-new-artifact")).toBeNull();
  });
});

describe("<SwitcherArtifactsList /> row actions", () => {
  it("exports a single artifact in both desktop formats", () => {
    render(<SwitcherArtifactsList {...PROPS} />);
    openMenu("switcher-more-tk-1");
    fireEvent.click(screen.getByTestId("switcher-export-markdown-tk-1"));
    expect(holder.exportCalls).toEqual([{ format: "markdown", ids: ["tk-1"] }]);

    openMenu("switcher-more-tk-1");
    fireEvent.click(screen.getByTestId("switcher-export-pdf-tk-1"));
    expect(holder.exportCalls).toEqual([
      { format: "markdown", ids: ["tk-1"] },
      { format: "pdf", ids: ["tk-1"] },
    ]);
  });

  it("keeps export available to a viewer, without the mutations", () => {
    holder.role = "viewer";
    render(<SwitcherArtifactsList {...PROPS} />);
    openMenu("switcher-more-tk-1");
    expect(screen.getByTestId("switcher-export-markdown-tk-1")).toBeTruthy();
    expect(screen.queryByTestId("switcher-rename-tk-1")).toBeNull();
    expect(screen.queryByTestId("switcher-delete-tk-1")).toBeNull();
  });

  it("creates a child under the row it was launched from", () => {
    render(<SwitcherArtifactsList {...PROPS} />);
    openMenu("switcher-add-child-spec-1");
    fireEvent.click(screen.getByTestId("switcher-add-child-spec-1-ticket"));
    expect(holder.createCalls).toEqual([
      { parentId: "spec-1", artifactType: "ticket" },
    ]);
  });

  it("gives a viewer no create affordance on a row", () => {
    holder.role = "viewer";
    render(<SwitcherArtifactsList {...PROPS} />);
    expect(screen.queryByTestId("switcher-add-child-spec-1")).toBeNull();
  });
});
