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
import {
  BROWSER_TILE_DND_TYPE,
  readEpicCanvasDragSourceData,
} from "@/components/epic-canvas/dnd/dnd";
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
import { resetPipStoreForTests } from "@/lib/browser-view/pip-store";
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
import { usePanelHeaderSearchStore } from "@/stores/epics/panel-header-search-store";
import { usePanelHeaderMenuStore } from "@/stores/epics/panel-header-menu-store";

const dndState = vi.hoisted(() => ({
  draggables: [] as Array<{
    readonly id: string | number;
    readonly data: unknown;
  }>,
}));

const browserHostPinState = vi.hoisted(() => ({
  selection: null as string | null,
  setSelection: vi.fn((selection: string | null) => {
    browserHostPinState.selection = selection;
  }),
}));

const browserHostProviderState = vi.hoisted(() => ({
  hostIds: [] as Array<string | null>,
}));

const browserHostOptionsState = vi.hoisted(() => ({
  hosts: [
    { hostId: "host-1", name: "Home Mac", connectable: true },
    { hostId: "host-2", name: "Work Mac", connectable: true },
  ],
  isLoading: false,
  listsFailed: false,
  retryLists: vi.fn(),
}));

vi.mock("@/hooks/host/use-surface-host-pin", () => ({
  useTabSurfaceKey: (kind: string, tabId: string) => `${kind}:${tabId}`,
  useSurfaceHostPin: () => ({
    selection: browserHostPinState.selection,
    honoredSelection: browserHostPinState.selection,
    setSelection: browserHostPinState.setSelection,
    resolvedHostId: browserHostPinState.selection ?? "host-1",
    followingHostId: "host-1",
    isPinned: browserHostPinState.selection !== null,
    latchOnFirstUse: () => undefined,
  }),
  useSurfaceHostClient: () => null,
}));

vi.mock("@/hooks/host/use-host-client-for-host-id", () => ({
  useHostDirectoryEntryForHostId: (hostId: string | null) => ({
    label: hostId === "host-2" ? "Work Mac" : "Home Mac",
  }),
}));

vi.mock("@/components/settings/host-scope/use-host-options", () => ({
  useHostOptions: () => ({
    hosts: browserHostOptionsState.hosts,
    activeHostId: "host-1",
    isLoading: browserHostOptionsState.isLoading,
    listsFailed: browserHostOptionsState.listsFailed,
    retryLists: browserHostOptionsState.retryLists,
  }),
}));

vi.mock("@/components/settings/host-scope/host-option-row", () => ({
  HostOptionRow: (props: { readonly host: { readonly name: string } }) => (
    <span>{props.host.name}</span>
  ),
}));

vi.mock("@/components/epic-canvas/renderers/browser-session-dock", () => ({
  BrowserSessionsHostProvider: (props: {
    readonly hostId: string | null;
    readonly children: ReactNode;
  }) => {
    browserHostProviderState.hostIds.push(props.hostId);
    return props.children;
  },
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: (input: {
    readonly id: string | number;
    readonly data: unknown;
  }) => {
    dndState.draggables.push(input);
    return {
      attributes: {},
      listeners: {},
      setNodeRef: () => undefined,
      isDragging: false,
    };
  },
}));

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
    retry: vi.fn(),
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

vi.mock("@/components/epic-canvas/hooks/use-canvas-host-id", () => ({
  useCanvasHostId: () => "host-1",
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
    dndState.draggables = [];
    browserHostPinState.selection = null;
    browserHostPinState.setSelection.mockClear();
    browserHostProviderState.hostIds = [];
    browserHostOptionsState.hosts = [
      { hostId: "host-1", name: "Home Mac", connectable: true },
      { hostId: "host-2", name: "Work Mac", connectable: true },
    ];
    browserHostOptionsState.isLoading = false;
    browserHostOptionsState.listsFailed = false;
    browserHostOptionsState.retryLists.mockClear();
    closeSession.mockReset();
    navigateNested.mockClear();
    resetElectronBrowserTabStoreForTests();
    usePanelHeaderSearchStore.setState(
      usePanelHeaderSearchStore.getInitialState(),
      true,
    );
    usePanelHeaderMenuStore.setState(
      usePanelHeaderMenuStore.getInitialState(),
      true,
    );
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
      retry: vi.fn(),
      closeSession: forwardCloseSession,
      requestPromoteState: vi.fn(),
      requestLendStorage: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    resetElectronBrowserTabStoreForTests();
    resetPipStoreForTests();
  });

  it("lists every tab as a flat peer row, with dormant styling and isolated-only badges", () => {
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(screen.getByText("Live page")).toBeTruthy();
    expect(screen.getByText("Dormant page")).toBeTruthy();
    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.getByText("isolated")).toBeTruthy();
    // The primary-profile session must not render a badge - only the
    // isolated one earns one, per the row-redesign rule.
    expect(screen.queryByText("primary")).toBeNull();
    // The old placeholder session name never appears as a row's primary text.
    expect(screen.queryByText("Agent browser")).toBeNull();

    const dormantRow = screen.getByTestId(
      "epic-browser-sidebar-row-tab-dormant",
    );
    expect(dormantRow.className.split(/\s+/)).toContain("opacity-60");
    const liveRow = screen.getByTestId("epic-browser-sidebar-row-tab-live");
    expect(liveRow.className.split(/\s+/)).not.toContain("opacity-60");
    expect(liveRow.className.split(/\s+/)).toContain("cursor-pointer");
    expect(
      screen
        .getByRole("button", { name: /^Live page/i })
        .className.split(/\s+/),
    ).toContain("cursor-pointer");
  });

  it("registers each row as a browser tile drag source", () => {
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    const live = dndState.draggables.find((entry) =>
      String(entry.id).includes("browser-tile:sess-primary:tab-live"),
    );
    expect(live).toBeTruthy();
    expect(readEpicCanvasDragSourceData(live?.data)).toMatchObject({
      kind: BROWSER_TILE_DND_TYPE,
      epicId: "epic-1",
      viewTabId: "view-tab-1",
      tile: {
        type: "browser-session",
        sessionId: "sess-primary",
        tabId: "tab-live",
      },
    });
  });

  it("switches only the panel subscription when its host filter is pinned", () => {
    browserHostPinState.selection = "host-2";

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(browserHostProviderState.hostIds).toContain("host-2");
  });

  it("filters the flat list by title, hostname, or URL", () => {
    usePanelHeaderSearchStore
      .getState()
      .openSearch("view-tab-1", "browsers", "checkout.example");

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.queryByText("Live page")).toBeNull();
    expect(screen.queryByText("Dormant page")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1 browser result.");
  });

  it("gives every row a unique, title-derived accessible close name", () => {
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(
      screen.getByRole("button", { name: "Close Live page" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close Dormant page" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close Checkout" })).toBeTruthy();
  });

  it("disambiguates duplicate host fallback titles with each tab's origin", () => {
    sessionsState.value = {
      ...sessionsState.value,
      items: [3000, 5173].map((port) =>
        session({
          sessionId: `sess-localhost-${port}`,
          name: "Agent browser",
          profile: "primary",
          tabs: [
            tab({
              tabId: `tab-localhost-${port}`,
              url: `http://127.0.0.1:${port}`,
              viewed: true,
            }),
          ],
        }),
      ),
    };

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    const closeButtons = screen.getAllByRole("button", {
      name: /^Close 127\.0\.0\.1 \(/,
    });
    expect(closeButtons).toHaveLength(2);
    const closeLabels = closeButtons.map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(closeLabels).toEqual([
      "Close 127.0.0.1 (127.0.0.1:3000)",
      "Close 127.0.0.1 (127.0.0.1:5173)",
    ]);
    expect(screen.queryByText("127.0.0.1:3000")).toBeNull();
    expect(screen.queryByText("127.0.0.1:5173")).toBeNull();
    expect(screen.getAllByText("127.0.0.1")).toHaveLength(4);
  });

  it("falls back to tab ids when duplicate titles also share no origin", () => {
    const sessionIds = [
      "sess-fallback-1",
      "sess-fallback-2",
      "sess-fallback-3",
    ];
    sessionsState.value = {
      ...sessionsState.value,
      items: sessionIds.map((sessionId, index) =>
        session({
          sessionId,
          name: "Agent browser",
          profile: "primary",
          tabs: [
            tab({
              tabId: `tab-fallback-${index}`,
              url: "",
              title: "Checkout",
              viewed: true,
            }),
          ],
        }),
      ),
    };

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    const closeLabels = screen
      .getAllByRole("button", { name: /^Close Checkout \(/ })
      .map((button) => button.getAttribute("aria-label"));
    expect(new Set(closeLabels).size).toBe(sessionIds.length);
    for (const [index] of sessionIds.entries()) {
      expect(closeLabels).toContain(`Close Checkout (tab-fallback-${index})`);
    }
  });

  it("keeps the plain close name when the active title is unique", () => {
    sessionsState.value = {
      ...sessionsState.value,
      items: [
        session({
          sessionId: "sess-unique-title",
          name: "Agent browser",
          profile: "primary",
          tabs: [
            tab({
              tabId: "tab-unique-title",
              url: "https://unique.example",
              title: "Unique page",
              viewed: true,
            }),
          ],
        }),
      ],
    };

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(
      screen.getByRole("button", { name: "Close Unique page" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Close Unique page \(/ }),
    ).toBeNull();
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

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

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
          name: `${title}, https://checkout-${index}.example`,
        }),
      ).toBeTruthy();
    }
  });

  it("inherits the shared sidebar scroll container", () => {
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

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

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.queryByText("Agent browser")).toBeNull();
    expect(screen.queryByText("not a URL")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Close / })).toBeNull();
    expect(screen.getByText("Old page")).toBeTruthy();
    expect(
      screen.getByTestId("epic-browser-sidebar-row-tab-dormant-subrow")
        .className,
    ).toContain("opacity-60");
    expect(
      screen.getByTestId("epic-browser-sidebar-row-tab-invalid-url").className,
    ).not.toContain("opacity-60");
  });

  it("shows a retryable unavailable state instead of an empty list", () => {
    const retry = vi.fn();
    sessionsState.value = {
      ...sessionsState.value,
      lifecycle: "failed",
      items: [],
      errorMessage: "Host connection failed.",
      retry,
    };

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    expect(screen.getByText("Browsers unavailable.")).toBeTruthy();
    expect(screen.queryByText("No browsers yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows drivenBy attribution via real tooltip and opens the driving chat", async () => {
    const user = userEvent.setup();
    const drivingSession = sessionsState.value.items[0];
    sessionsState.value = {
      ...sessionsState.value,
      items: [
        { ...drivingSession, hostId: "host-2" },
        ...sessionsState.value.items.slice(1),
      ],
    };
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
    if (opened === null) throw new Error("expected driving chat tile");
    expect(
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId[opened.instanceId],
    ).toMatchObject({ hostId: "host-2" });
  });

  it("close sends closeSession (host delete resource)", () => {
    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));

    fireEvent.click(screen.getByRole("button", { name: "Close Live page" }));
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
      viewportPreset: "responsive",
      runtime: "isolated",
    });
    const beforeCount = Object.keys(
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId ?? {},
    ).length;

    render(wrapper(<BrowsersPanelBody epicId="epic-1" tabId="view-tab-1" />));
    const liveDrag = dndState.draggables.find((entry) =>
      String(entry.id).includes("browser-tile:sess-primary:tab-live"),
    );
    expect(readEpicCanvasDragSourceData(liveDrag?.data)).toMatchObject({
      kind: BROWSER_TILE_DND_TYPE,
      tile: {
        id: "reg-native-1",
        type: "agent-browser",
        sessionId: "sess-primary",
      },
    });
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
    expect(screen.getByRole("button", { name: "Add browser" })).toBeTruthy();
  });
});

describe("BrowsersPanelActions", () => {
  beforeEach(() => {
    navigateNested.mockClear();
    browserHostPinState.selection = null;
    browserHostPinState.setSelection.mockClear();
    browserHostOptionsState.hosts = [
      { hostId: "host-1", name: "Home Mac", connectable: true },
      { hostId: "host-2", name: "Work Mac", connectable: true },
    ];
    browserHostOptionsState.isLoading = false;
    browserHostOptionsState.listsFailed = false;
    browserHostOptionsState.retryLists.mockClear();
    seedCanvasTab();
    usePanelHeaderSearchStore.setState(
      usePanelHeaderSearchStore.getInitialState(),
      true,
    );
    usePanelHeaderMenuStore.setState(
      usePanelHeaderMenuStore.getInitialState(),
      true,
    );
    sessionsState.value = {
      lifecycle: "live",
      items: [],
      errorMessage: null,
      routingChatId: null,
      retry: vi.fn(),
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

  it("opens a new browser on the panel's filtered host", () => {
    browserHostPinState.selection = "host-2";
    render(
      wrapper(<BrowsersPanelActions epicId="epic-1" tabId="view-tab-1" />),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add browser" }));

    const opened = Object.values(
      useEpicCanvasStore.getState().canvasByTabId["view-tab-1"]
        ?.tilesByInstanceId ?? {},
    ).find((tile) => tile !== undefined && tile.type === "browser");
    expect(opened).toMatchObject({ hostId: "host-2" });
  });

  it("opens browser search from the header action", () => {
    render(
      wrapper(<BrowsersPanelActions epicId="epic-1" tabId="view-tab-1" />),
    );

    fireEvent.click(screen.getByRole("button", { name: "Search browsers" }));

    expect(
      usePanelHeaderSearchStore.getState().openBySurfaceKey[
        JSON.stringify(["view-tab-1", "browsers"])
      ],
    ).toBe(true);
  });

  it("opens the host filter as the final header action", async () => {
    const user = userEvent.setup();
    render(
      wrapper(<BrowsersPanelActions epicId="epic-1" tabId="view-tab-1" />),
    );

    await user.click(
      screen.getByRole("button", { name: "Filter browsers by host" }),
    );

    const filterMenu = screen.getByTestId("epic-browsers-panel-filter-menu");
    expect(filterMenu.getAttribute("data-side")).toBe("right");
    await user.click(screen.getByRole("menuitem", { name: "Host, Home Mac" }));
    const hostMenu = screen.getByTestId("epic-browsers-panel-host-menu");
    expect(hostMenu.getAttribute("data-side")).toBe("right");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Work Mac" }));
    expect(browserHostPinState.setSelection).toHaveBeenCalledWith("host-2");
  });

  it("shows and clears an active host filter", async () => {
    const user = userEvent.setup();
    browserHostPinState.selection = "host-2";
    render(
      wrapper(<BrowsersPanelActions epicId="epic-1" tabId="view-tab-1" />),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Filter browsers by host, 1 filter active",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Host, Work Mac" }));
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Follow active host/ }),
    );

    expect(browserHostPinState.setSelection).toHaveBeenCalledWith(null);
  });

  it("loads host choices progressively in the right-side submenu", async () => {
    const user = userEvent.setup();
    browserHostOptionsState.hosts = [];
    browserHostOptionsState.isLoading = true;
    render(
      wrapper(<BrowsersPanelActions epicId="epic-1" tabId="view-tab-1" />),
    );

    await user.click(
      screen.getByRole("button", { name: "Filter browsers by host" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Host, Home Mac" }));

    expect(screen.getByText("Loading hosts…")).toBeTruthy();
  });
});
