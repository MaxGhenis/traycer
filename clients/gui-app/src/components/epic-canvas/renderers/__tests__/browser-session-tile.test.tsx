import "../../../../../__tests__/test-browser-apis";
import { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserSessionInfo,
  BrowserSessionsClientFrame,
} from "@traycer/protocol/host/browser/contracts";
import { BrowserSessionTile } from "@/components/epic-canvas/renderers/browser-session-tile";
import type { BrowserSessionsState } from "@/components/epic-canvas/renderers/browser-sessions-context";
import type { BrowserSessionTileRef } from "@/stores/epics/canvas/types";
import { TILE_KIND_BROWSER_SESSION } from "@/stores/epics/canvas/tile-kinds";
import {
  attachElectronBrowserTabStream,
  handleElectronBrowserTabFrame,
  registerElectronBrowserTab,
  resetElectronBrowserTabStoreForTests,
} from "@/lib/browser-view/electron-browser-tab-store";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
  AgentBrowserViewTileUpsert,
  DesktopAgentBrowserViewBridge,
} from "@/lib/browser-view/desktop-agent-browser-view";
import type {
  BrowserViewBoundsUpdate,
  BrowserViewDurableTabRegistration,
  BrowserViewOpenTileRequest,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";
import { createSingleTileCanvas } from "@/stores/epics/canvas/actions";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import { collectPanes } from "@/stores/epics/canvas/tile-tree";

const sessionsState = vi.hoisted<{
  value: BrowserSessionsState;
}>(() => ({
  value: {
    lifecycle: "live",
    items: [],
    errorMessage: null,
    routingChatId: "chat-route",
    closeSession: vi.fn(),
    requestPromoteState: vi.fn(),
    requestLendStorage: vi.fn(),
  },
}));

const bridgeHarness = vi.hoisted<{
  current: FakeAgentBrowserViewBridge | null;
  // Stable host object so AgentBrowserTile's useMemo(browserView) does not
  // churn identity on every render (which would re-fire registration).
  readonly runnerHost: {
    agentBrowserView: DesktopAgentBrowserViewBridge | null;
  };
}>(() => ({
  current: null,
  runnerHost: { agentBrowserView: null },
}));

const peekHarness = vi.hoisted<{
  mounts: number;
}>(() => ({ mounts: 0 }));

vi.mock("@/components/epic-canvas/renderers/browser-sessions-context", () => ({
  useBrowserSessionsContext: () => sessionsState.value,
}));

vi.mock("@/components/epic-canvas/hooks/use-tab-host-id", () => ({
  useTabHostId: () => "host-test",
}));

vi.mock("@/components/epic-canvas/hooks/use-tile-body-visible", () => ({
  useTileBodyVisible: () => true,
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => bridgeHarness.runnerHost,
}));
vi.mock("@/components/epic-canvas/renderers/browser-peek-tile", () => ({
  BrowserPeekTile: (props: {
    readonly node: { readonly sessionId: string; readonly tabId: string };
    readonly onMigrated: (() => void) | undefined;
  }) => {
    const mounted = useRef(false);
    if (!mounted.current) {
      mounted.current = true;
      peekHarness.mounts += 1;
    }
    return (
      <div
        data-testid="browser-peek-tile"
        data-session={props.node.sessionId}
        data-tab={props.node.tabId}
        onClick={() => props.onMigrated?.()}
      />
    );
  },
}));

class FakeAgentBrowserViewBridge implements DesktopAgentBrowserViewBridge {
  readonly upsertCalls: AgentBrowserViewTileUpsert[] = [];
  readonly registerDurableTabCalls: BrowserViewDurableTabRegistration[] = [];
  private readonly statusHandlers = new Set<
    (change: BrowserViewStatusChange) => void
  >();
  private readonly openTileHandlers = new Set<
    (change: BrowserViewOpenTileRequest) => void
  >();

  upsertTile(input: AgentBrowserViewTileUpsert): Promise<void> {
    this.upsertCalls.push(input);
    return Promise.resolve();
  }

  registerDurableTab(input: BrowserViewDurableTabRegistration): Promise<void> {
    this.registerDurableTabCalls.push(input);
    return Promise.resolve();
  }

  updateBounds(_input: BrowserViewBoundsUpdate): Promise<void> {
    return Promise.resolve();
  }

  releaseTile(_input: BrowserViewTileKey): Promise<void> {
    return Promise.resolve();
  }

  dispatchCdp(
    _input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult> {
    return Promise.resolve({ kind: "cdpGetFrameTree", ok: true, frames: [] });
  }

  onStatusChange(handler: (change: BrowserViewStatusChange) => void): {
    dispose: () => void;
  } {
    this.statusHandlers.add(handler);
    return {
      dispose: () => {
        this.statusHandlers.delete(handler);
      },
    };
  }

  onOpenTileRequest(handler: (change: BrowserViewOpenTileRequest) => void): {
    dispose: () => void;
  } {
    this.openTileHandlers.add(handler);
    return {
      dispose: () => {
        this.openTileHandlers.delete(handler);
      },
    };
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

const NODE: BrowserSessionTileRef = {
  id: "browser-session:sess-1:tab-1",
  instanceId: "pointer-instance-1",
  type: TILE_KIND_BROWSER_SESSION,
  name: "Pointer tab",
  hostId: "host-test",
  sessionId: "sess-1",
  tabId: "tab-1",
};

function sessionFor(
  status: "ready" | "dormant" | "navigating" | "crashed",
): BrowserSessionInfo {
  return {
    sessionId: "sess-1",
    epicId: "epic-1",
    hostId: "host-test",
    profile: "primary",
    name: "Main",
    createdBy: { chatId: "chat-route", agentRunId: "run-1" },
    createdAt: 1,
    lastActivityAt: 2,
    tabs: [
      {
        tabId: "tab-1",
        url: "https://example.com/page",
        originTier: "dev",
        status,
        title: "Example",
        viewed: false,
        drivenBy: [],
      },
    ],
  };
}

interface SeedCanvasResult {
  readonly viewTabId: string;
  readonly paneId: string;
}

function seedCanvas(node: BrowserSessionTileRef): SeedCanvasResult {
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  const viewTabId = "view-tab-1";
  useEpicCanvasStore.setState({
    tabsById: {
      [viewTabId]: { tabId: viewTabId, epicId: "epic-1", name: "Epic" },
    },
    canvasByTabId: {
      [viewTabId]: createSingleTileCanvas(node),
    },
  });
  const canvas = useEpicCanvasStore.getState().canvasByTabId[viewTabId];
  if (canvas === undefined) throw new Error("expected seeded canvas");
  const pane = collectPanes(canvas.root)[0];
  return { viewTabId, paneId: pane.id };
}

function renderTile(
  status: "ready" | "dormant" | "navigating" | "crashed",
): SeedCanvasResult {
  sessionsState.value = {
    lifecycle: "live",
    items: [sessionFor(status)],
    errorMessage: null,
    routingChatId: "chat-route",
    closeSession: vi.fn(),
    requestPromoteState: vi.fn(),
    requestLendStorage: vi.fn(),
  };
  const ids = seedCanvas(NODE);
  render(
    <BrowserSessionTile
      node={NODE}
      viewTabId={ids.viewTabId}
      paneId={ids.paneId}
      epicId="epic-1"
    />,
  );
  return ids;
}

describe("BrowserSessionTile (ticket 08 pointer view)", () => {
  beforeEach(() => {
    resetElectronBrowserTabStoreForTests();
    peekHarness.mounts = 0;
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    bridgeHarness.runnerHost.agentBrowserView = bridge;
  });

  afterEach(() => {
    cleanup();
    resetElectronBrowserTabStoreForTests();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    bridgeHarness.current = null;
    bridgeHarness.runnerHost.agentBrowserView = null;
  });

  it("renders unavailable when the tab is gone from the epic sessions stream", () => {
    sessionsState.value = {
      lifecycle: "live",
      items: [],
      errorMessage: null,
      routingChatId: "chat-route",
      closeSession: vi.fn(),
      requestPromoteState: vi.fn(),
      requestLendStorage: vi.fn(),
    };
    const ids = seedCanvas(NODE);
    render(
      <BrowserSessionTile
        node={NODE}
        viewTabId={ids.viewTabId}
        paneId={ids.paneId}
        epicId="epic-1"
      />,
    );
    expect(
      screen.getByText("Browser tab is no longer available."),
    ).toBeTruthy();
  });

  it("opens dormant tabs via native register/activate path (not screencast first)", () => {
    renderTile("dormant");
    // activateBeforeNativeView defers upsert until the host mints a tabId;
    // the load-bearing seam is the native tile + registration, not screencast.
    expect(screen.queryByTestId("browser-peek-tile")).toBeNull();
    expect(
      screen.getByTestId("agent-browser-tile-pointer-instance-1"),
    ).toBeTruthy();
    expect(screen.getByText("Loading page")).toBeTruthy();
  });

  it("renders screencast for ready headless tabs with no electron binding", () => {
    renderTile("ready");
    const peek = screen.getByTestId("browser-peek-tile");
    expect(peek.getAttribute("data-session")).toBe("sess-1");
    expect(peek.getAttribute("data-tab")).toBe("tab-1");
  });

  it("swaps the screencast tile for native view on migrated terminal status", async () => {
    const ids = renderTile("ready");
    expect(screen.getByTestId("browser-peek-tile")).toBeTruthy();
    expect(peekHarness.mounts).toBe(1);
    fireEvent.click(screen.getByTestId("browser-peek-tile"));

    const bridge = bridgeHarness.current;
    if (bridge === null) throw new Error("expected browser view bridge");
    registerElectronBrowserTab({
      epicId: "epic-1",
      hostId: "host-test",
      chatId: "chat-route",
      registrationId: NODE.id,
      sessionId: NODE.sessionId,
      requestedTabId: NODE.tabId,
      initialUrl: "https://example.com/page",
      title: "Example",
      tileKey: {
        viewTabId: ids.viewTabId,
        paneId: ids.paneId,
        tileInstanceId: NODE.instanceId,
        pageSessionId: NODE.id,
      },
      bridge,
      onRegistered: () => {},
      onActivatedHeadless: null,
      background: false,
    });
    handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: "migration-native",
      registrationId: NODE.id,
      sessionId: NODE.sessionId,
      tabId: NODE.tabId,
    });

    await waitFor(() => {
      expect(screen.queryByTestId("browser-peek-tile")).toBeNull();
      expect(
        screen.getByTestId("agent-browser-tile-pointer-instance-1"),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Browser tab is no longer available.")).toBeNull();
    expect(peekHarness.mounts).toBe(1);
  });

  it("resubscribes after terminal status once rollback settles headless", async () => {
    const ids = seedCanvas(NODE);
    const initialSession = sessionFor("ready");
    sessionsState.value = {
      lifecycle: "live",
      items: [initialSession],
      errorMessage: null,
      routingChatId: "chat-route",
      closeSession: vi.fn(),
      requestPromoteState: vi.fn(),
      requestLendStorage: vi.fn(),
    };
    const view = render(
      <BrowserSessionTile
        node={NODE}
        viewTabId={ids.viewTabId}
        paneId={ids.paneId}
        epicId="epic-1"
      />,
    );
    expect(peekHarness.mounts).toBe(1);

    fireEvent.click(screen.getByTestId("browser-peek-tile"));
    expect(screen.getByTestId("browser-peek-tile")).toBeTruthy();
    expect(peekHarness.mounts).toBe(1);

    act(() => {
      sessionsState.value = {
        ...sessionsState.value,
        items: [
          {
            ...initialSession,
            migration: { revision: 1, runtime: "headless" },
          },
        ],
      };
      view.rerender(
        <BrowserSessionTile
          node={NODE}
          viewTabId={ids.viewTabId}
          paneId={ids.paneId}
          epicId="epic-1"
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("browser-peek-tile")).toBeTruthy();
      expect(peekHarness.mounts).toBe(2);
    });
    expect(
      screen.queryByTestId("agent-browser-tile-pointer-instance-1"),
    ).toBeNull();
  });

  it("falls back to existing screencast on BROWSER_TAB_ACTIVATED_HEADLESS instead of a second native view", async () => {
    renderTile("dormant");
    expect(screen.queryByTestId("browser-peek-tile")).toBeNull();

    act(() => {
      handleElectronBrowserTabFrame({
        kind: "electronTabRegistrationFailed",
        hasBinaryPayload: false,
        requestId: "req-fail",
        registrationId: NODE.id,
        sessionId: NODE.sessionId,
        tabId: NODE.tabId,
        code: "BROWSER_TAB_ACTIVATED_HEADLESS",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("browser-peek-tile")).toBeTruthy();
    });
    // Still a single peek surface; no second native mount path after fallback.
    expect(screen.getAllByTestId("browser-peek-tile")).toHaveLength(1);
  });

  /**
   * Ticket 09 scenario-7: stream-driven re-renders of a stable dormant pointer
   * must not re-enter registerElectronBrowserTab. That path republishes
   * `registerElectronTab` whenever the effect deps change; an unstable
   * `onActivatedHeadless` callback identity is the regression that causes it.
   */
  it("does not republish registerElectronTab when a dormant pointer only receives a stream refresh", async () => {
    const bridge = bridgeHarness.current;
    expect(bridge).not.toBeNull();
    if (bridge === null) {
      throw new Error("expected agent browser bridge");
    }
    const published: BrowserSessionsClientFrame[] = [];
    const detachStream = attachElectronBrowserTabStream(
      "epic-1",
      "host-test",
      (frame) => {
        published.push(frame);
      },
    );

    const dormantSession = sessionFor("dormant");
    sessionsState.value = {
      lifecycle: "live",
      items: [dormantSession],
      errorMessage: null,
      routingChatId: "chat-route",
      closeSession: vi.fn(),
      requestPromoteState: vi.fn(),
      requestLendStorage: vi.fn(),
    };
    const ids = seedCanvas(NODE);
    const { rerender } = render(
      <BrowserSessionTile
        node={NODE}
        viewTabId={ids.viewTabId}
        paneId={ids.paneId}
        epicId="epic-1"
      />,
    );

    await waitFor(() => {
      expect(
        published.filter((frame) => frame.kind === "registerElectronTab"),
      ).toHaveLength(1);
    });
    expect(
      published.find((frame) => frame.kind === "registerElectronTab"),
    ).toMatchObject({ requestedTabId: NODE.tabId });
    const registrationFramesAfterMount = published.filter(
      (frame) => frame.kind === "registerElectronTab",
    ).length;
    const durableCallsAfterMount = bridge.registerDurableTabCalls.length;

    // Ack once so a second registration path would also call registerDurableTab.
    act(() => {
      handleElectronBrowserTabFrame({
        kind: "electronTabRegistered",
        hasBinaryPayload: false,
        requestId: "req-reg-stable",
        registrationId: NODE.id,
        sessionId: NODE.sessionId,
        tabId: NODE.tabId,
      });
    });
    await waitFor(() => {
      expect(bridge.registerDurableTabCalls.length).toBe(
        durableCallsAfterMount + 1,
      );
    });
    const durableCallsAfterAck = bridge.registerDurableTabCalls.length;
    const registrationFramesAfterAck = published.filter(
      (frame) => frame.kind === "registerElectronTab",
    ).length;
    // Ack must not itself re-enter registration publication.
    expect(registrationFramesAfterAck).toBe(registrationFramesAfterMount);

    // Stream-only refresh: lastActivityAt moves, pointer identity is unchanged.
    act(() => {
      sessionsState.value = {
        ...sessionsState.value,
        items: [
          {
            ...dormantSession,
            lastActivityAt: dormantSession.lastActivityAt + 1000,
          },
        ],
      };
      rerender(
        <BrowserSessionTile
          node={NODE}
          viewTabId={ids.viewTabId}
          paneId={ids.paneId}
          epicId="epic-1"
        />,
      );
    });

    expect(
      published.filter((frame) => frame.kind === "registerElectronTab"),
    ).toHaveLength(registrationFramesAfterMount);
    expect(bridge.registerDurableTabCalls.length).toBe(durableCallsAfterAck);

    detachStream();
  });
});
