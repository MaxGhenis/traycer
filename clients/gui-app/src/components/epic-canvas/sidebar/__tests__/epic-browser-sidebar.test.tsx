import "../../../../../__tests__/test-browser-apis";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  BrowserSessionInfo,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  BrowsersPanelActions,
  BrowsersPanelBody,
} from "@/components/epic-canvas/sidebar/epic-browser-sidebar";
import type { BrowserSessionsState } from "@/components/epic-canvas/renderers/browser-sessions-context";
import {
  findOpenArtifactInTab,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { makeBrowserSessionTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import {
  findElectronBrowserTabBinding,
  handleElectronBrowserTabFrame,
  registerElectronBrowserTab,
  resetElectronBrowserTabStoreForTests,
} from "@/lib/browser-view/electron-browser-tab-store";
import type {
  BrowserViewDurableTabRegistration,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
} from "@/lib/browser-view/desktop-agent-browser-view";

const closeSession = vi.fn<(sessionId: string) => void>();
const navigateNested = vi.fn(
  (_epicId: string, _tabId: string, prepare: () => unknown) => prepare(),
);

function forwardCloseSession(sessionId: string): void {
  closeSession(sessionId);
}

const sessionsState = vi.hoisted<{
  value: BrowserSessionsState;
}>(() => ({
  value: {
    lifecycle: "live",
    items: [],
    errorMessage: null,
    routingChatId: "chat-driver",
    closeSession: forwardCloseSession,
    requestPromoteState: vi.fn(),
    requestLendStorage: vi.fn(),
  },
}));

const chatsState = vi.hoisted(() => ({
  value: [
    { id: "chat-driver", title: "Checkout agent" },
    { id: "chat-other", title: "Other chat" },
  ],
}));

vi.mock("@/components/epic-canvas/renderers/browser-sessions-context", () => ({
  useBrowserSessionsContext: () => sessionsState.value,
}));

vi.mock("@/lib/epic-selectors", () => ({
  useEpicChatRecords: () => chatsState.value,
}));

vi.mock("@/hooks/host/use-reactive-active-host-id", () => ({
  useReactiveActiveHostId: () => "host-1",
}));

vi.mock("@/hooks/epic/use-epic-nested-focus-navigation", () => ({
  useEpicNestedFocusNavigation: () => navigateNested,
}));

class FakeBridge {
  registerDurableTab(_input: BrowserViewDurableTabRegistration): Promise<void> {
    return Promise.resolve();
  }

  dispatchCdp(
    _input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult> {
    return Promise.resolve({ kind: "cdpGetFrameTree", ok: true, frames: [] });
  }

  onStatusChange(_handler: (change: BrowserViewStatusChange) => void): {
    dispose: () => void;
  } {
    return { dispose: () => undefined };
  }

  onCdpSessionEnded(
    _handler: (change: AgentBrowserViewCdpSessionEndedChange) => void,
  ): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  onCdpTargetAttached(
    _handler: (change: AgentBrowserViewCdpTargetAttachedChange) => void,
  ): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  onTileHandoff(
    _handler: (change: AgentBrowserViewTileHandoffChange) => void,
  ): { dispose: () => void } {
    return { dispose: () => undefined };
  }
}

function tab(
  overrides: Partial<BrowserTabInfo> & Pick<BrowserTabInfo, "tabId" | "url">,
): BrowserTabInfo {
  return {
    originTier: "dev",
    status: "ready",
    title: null,
    viewed: false,
    drivenBy: [],
    ...overrides,
  };
}

function session(
  overrides: Partial<BrowserSessionInfo> &
    Pick<BrowserSessionInfo, "sessionId" | "name" | "profile" | "tabs">,
): BrowserSessionInfo {
  return {
    epicId: "epic-1",
    hostId: "host-1",
    createdBy: { chatId: "chat-driver", agentRunId: "run-1" },
    createdAt: 1,
    lastActivityAt: 2,
    ...overrides,
  };
}

function wrapper(node: ReactNode): ReactNode {
  return <TooltipProvider delayDuration={0}>{node}</TooltipProvider>;
}

function seedCanvasTab(): void {
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  useEpicCanvasStore.setState({
    tabsById: {
      "view-tab-1": {
        tabId: "view-tab-1",
        epicId: "epic-1",
        name: "Epic 1",
      },
    },
  });
}

describe("BrowsersPanelBody", () => {
  beforeEach(() => {
    closeSession.mockReset();
    navigateNested.mockClear();
    resetElectronBrowserTabStoreForTests();
    seedCanvasTab();
    sessionsState.value = {
      lifecycle: "live",
      items: [
        session({
          sessionId: "sess-primary",
          name: "Main",
          profile: "primary",
          tabs: [
            tab({
              tabId: "tab-live",
              url: "https://app.example/live",
              title: "Live page",
              status: "ready",
              viewed: true,
              drivenBy: [
                {
                  chatId: "chat-driver",
                  agentRunId: "run-1",
                  requestId: "req-1",
                },
              ],
            }),
          ],
        }),
        session({
          sessionId: "sess-dormant",
          name: "Agent browser",
          profile: "primary",
          tabs: [
            tab({
              tabId: "tab-dormant",
              url: "https://app.example/old",
              title: "Dormant page",
              status: "dormant",
            }),
          ],
        }),
        session({
          sessionId: "sess-iso",
          name: "Agent: checkout",
          profile: "isolated",
          tabs: [
            tab({
              tabId: "tab-iso",
              url: "https://checkout.example",
              title: "Checkout",
            }),
          ],
        }),
      ],
      errorMessage: null,
      routingChatId: "chat-driver",
      closeSession: forwardCloseSession,
      requestPromoteState: vi.fn(),
      requestLendStorage: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    resetElectronBrowserTabStoreForTests();
  });

  it("lists sessions by their active tab's title, with dormant styling and isolated-only badges", () => {
    render(
      wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />),
    );

    expect(screen.getByText("Live page")).toBeTruthy();
    expect(screen.getByText("Dormant page")).toBeTruthy();
    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.getByText("isolated")).toBeTruthy();
    // The primary-profile session must not render a badge - only the
    // isolated one earns one, per the row-redesign rule.
    expect(screen.queryByText("primary")).toBeNull();
    // The old placeholder session name never appears as a row's primary text.
    expect(screen.queryByText("Agent browser")).toBeNull();

    const dormantRow = screen.getByText("Dormant page").closest("div.group");
    expect(dormantRow?.className.split(/\s+/)).toContain("opacity-60");
    const liveRow = screen.getByText("Live page").closest("div.group");
    expect(liveRow?.className.split(/\s+/)).not.toContain("opacity-60");
  });

  it("gives every row a unique, title-derived accessible close name", () => {
    render(
      wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />),
    );

    expect(
      screen.getByRole("button", { name: "Close Live page" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close Dormant page" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close Checkout" }),
    ).toBeTruthy();
  });

  it("keeps close controls and row names unique across near-identical sessions", () => {
    const titles = ["Checkout", "Checkout 1", "Checkout 2", "Checkout 3"];
    sessionsState.value = {
      ...sessionsState.value,
      items: titles.map((title, index) =>
        session({
          sessionId: `sess-near-${index}`,
          name: "Agent browser",
          profile: "primary",
          tabs: [
            tab({
              tabId: `tab-near-${index}`,
              url: `https://checkout-${index}.example`,
              title,
              viewed: true,
            }),
          ],
        }),
      ),
    };

    render(
      wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />),
    );

    expect(screen.getAllByRole("button", { name: /^Close / })).toHaveLength(
      titles.length,
    );
    for (const title of titles) {
      const index = titles.indexOf(title);
      expect(
        screen.getByRole("button", { name: `Close ${title}` }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: `${title}checkout-${index}.example`,
        }),
      ).toBeTruthy();
    }
  });

  it("inherits the shared sidebar scroll container", () => {
    render(
      wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />),
    );

    const list = screen.getByTestId("epic-browsers-panel-list");
    const scrollContainer = list.closest('[data-sidebar="content"]');
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer?.className.split(/\s+/)).toContain("overflow-auto");
    expect(list.closest('[data-sidebar="group-content"]')).not.toBeNull();
  });

  it("skips empty sessions and handles malformed URLs with mixed tab status", () => {
    sessionsState.value = {
      ...sessionsState.value,
      items: [
        session({
          sessionId: "sess-empty-tabs",
          name: "Empty",
          profile: "primary",
          tabs: [],
        }),
        session({
          sessionId: "sess-invalid-url",
          name: "Agent browser",
          profile: "primary",
          tabs: [
            tab({
              tabId: "tab-invalid-url",
              url: "not a URL",
              title: "   ",
              viewed: true,
              status: "ready",
            }),
            tab({
              tabId: "tab-dormant-subrow",
              url: "https://old.example/path",
              title: "Old page",
              status: "dormant",
            }),
          ],
        }),
      ],
    };

    render(
      wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />),
    );

    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.queryByText("Agent browser")).toBeNull();
    expect(screen.queryByText("not a URL")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Close Browser" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open Old page" }).className,
    ).toContain("opacity-60");
    expect(screen.getByText("Browser").closest("div.group")?.className).not.toContain(
      "opacity-60",
    );
  });

  it("shows drivenBy attribution via real tooltip and opens the driving chat", async () => {
    const user = userEvent.setup();
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    const driveButton = screen.getByRole("button", {
      name: "Open driving chat Checkout agent",
    });
    await user.hover(driveButton);

    await waitFor(() => {
      expect(screen.getByText("Driven by Checkout agent")).toBeTruthy();
    });

    fireEvent.click(driveButton);
    expect(navigateNested).toHaveBeenCalledWith(
      "epic-1",
      "view-tab-1",
      expect.any(Function),
    );
    const opened = findOpenArtifactInTab("view-tab-1", "chat-driver");
    expect(opened).not.toBeNull();
  });

  it("close sends closeSession (host delete resource)", () => {
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    fireEvent.click(
      screen.getByRole("button", { name: "Close Live page" }),
    );
    expect(closeSession).toHaveBeenCalledWith("sess-primary");
  });

  it("row click opens a browser-session pointer tile when none is open", () => {
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    fireEvent.click(screen.getByRole("button", { name: /^Live page/i }));

    const expected = makeBrowserSessionTileRef({
      name: "Live page",
      hostId: "host-1",
      sessionId: "sess-primary",
      tabId: "tab-live",
    });
    const open = findOpenArtifactInTab("view-tab-1", expected.id);
    expect(open).not.toBeNull();
    if (open === null) throw new Error("expected open browser pointer");
    const tile =
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId[open.instanceId];
    expect(tile).toMatchObject({
      type: "browser-session",
      sessionId: "sess-primary",
      tabId: "tab-live",
      id: expected.id,
    });
  });

  it("row click focuses an existing pointer tile instead of opening a duplicate", () => {
    const existing = makeBrowserSessionTileRef({
      name: "Live page",
      hostId: "host-1",
      sessionId: "sess-primary",
      tabId: "tab-live",
    });
    useEpicCanvasStore.getState().openTileInTab("view-tab-1", existing);
    const beforeCount = Object.keys(
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId ?? {},
    ).length;

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));
    fireEvent.click(screen.getByRole("button", { name: /^Live page/i }));

    const afterCount = Object.keys(
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId ?? {},
    ).length;
    expect(afterCount).toBe(beforeCount);
    const focused = findOpenArtifactInTab("view-tab-1", existing.id);
    expect(typeof focused?.paneId).toBe("string");
    expect(focused?.instanceId).toBe(existing.instanceId);
  });

  it("row click focuses an existing native electron binding tile by registrationId", async () => {
    const bridge = new FakeBridge();
    const tileKey: BrowserViewTileKey = {
      viewTabId: "view-tab-1",
      paneId: "pane-1",
      tileInstanceId: "native-instance",
      pageSessionId: "reg-native-1",
    };
    registerElectronBrowserTab({
      epicId: "epic-1",
      hostId: "host-1",
      chatId: "chat-driver",
      registrationId: "reg-native-1",
      sessionId: "sess-primary",
      initialUrl: "https://app.example/live",
      title: "Live page",
      tileKey,
      bridge,
      onRegistered: null,
    });
    handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: "req-reg",
      registrationId: "reg-native-1",
      sessionId: "sess-primary",
      tabId: "tab-live",
    });
    await Promise.resolve();
    expect(
      findElectronBrowserTabBinding("sess-primary", "tab-live")?.registrationId,
    ).toBe("reg-native-1");

    useEpicCanvasStore.getState().openTileInTab("view-tab-1", {
      id: "reg-native-1",
      sessionId: "sess-primary",
      instanceId: "native-instance",
      type: "agent-browser",
      name: "Live page",
      hostId: "host-1",
      url: "https://app.example/live",
    });
    const beforeCount = Object.keys(
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId ?? {},
    ).length;

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));
    fireEvent.click(screen.getByRole("button", { name: /^Live page/i }));

    const afterCount = Object.keys(
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId ?? {},
    ).length;
    expect(afterCount).toBe(beforeCount);
    const focused = findOpenArtifactInTab("view-tab-1", "reg-native-1");
    expect(typeof focused?.paneId).toBe("string");
    expect(focused?.instanceId).toBe("native-instance");
  });

  it("shows the empty state with an Add browser action when there are no sessions", () => {
    sessionsState.value = { ...sessionsState.value, items: [] };
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(screen.getByTestId("epic-browsers-panel-empty")).toBeTruthy();
    expect(screen.getByText("No browsers yet.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add browser" }),
    ).toBeTruthy();
  });
});

describe("BrowsersPanelActions", () => {
  beforeEach(() => {
    navigateNested.mockClear();
    seedCanvasTab();
    sessionsState.value = {
      lifecycle: "live",
      items: [],
      errorMessage: null,
      routingChatId: null,
      closeSession: forwardCloseSession,
      requestPromoteState: vi.fn(),
      requestLendStorage: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  });

  it("opens a new browser tile via the header Add browser action", () => {
    render(
      wrapper(<BrowsersPanelActions epicId="epic-1" tabId="view-tab-1" />),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add browser" }));

    expect(navigateNested).toHaveBeenCalledWith(
      "epic-1",
      "view-tab-1",
      expect.any(Function),
    );
    const tilesByInstanceId =
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId ?? {};
    const opened = Object.values(tilesByInstanceId).find(
      (tile) => tile !== undefined && tile.type === "browser",
    );
    expect(opened).toBeTruthy();
  });
});
