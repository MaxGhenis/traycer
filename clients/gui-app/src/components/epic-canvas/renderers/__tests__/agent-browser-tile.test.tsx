import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBrowserTile } from "@/components/epic-canvas/renderers/agent-browser-tile";
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
import {
  handleElectronBrowserTabFrame,
  resetElectronBrowserTabStoreForTests,
} from "@/lib/browser-view/electron-browser-tab-store";
import { appLogger } from "@/lib/logger";
import { createSingleTileCanvas } from "@/stores/epics/canvas/actions";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import { TILE_KIND_AGENT_BROWSER } from "@/stores/epics/canvas/tile-kinds";
import { collectPanes } from "@/stores/epics/canvas/tile-tree";
import {
  isAgentBrowserTileRef,
  type AgentBrowserTileRef,
} from "@/stores/epics/canvas/types";

const bridgeHarness = vi.hoisted<{
  current: DesktopAgentBrowserViewBridge | null;
}>(() => ({ current: null }));

const visibilityHarness = vi.hoisted<{ visible: boolean }>(() => ({
  visible: true,
}));

vi.mock("@/components/epic-canvas/hooks/use-tab-host-id", () => ({
  useTabHostId: () => "host-test",
}));

vi.mock("@/components/epic-canvas/hooks/use-tile-body-visible", () => ({
  useTileBodyVisible: () => visibilityHarness.visible,
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => ({ agentBrowserView: bridgeHarness.current }),
}));

const NODE: AgentBrowserTileRef = {
  id: "agent-browser-page-1",
  sessionId: "agent-browser-session-1",
  instanceId: "agent-browser-instance-1",
  type: TILE_KIND_AGENT_BROWSER,
  name: "Agent browser",
  hostId: "host-test",
  url: "https://example.com",
};

class FakeAgentBrowserViewBridge implements DesktopAgentBrowserViewBridge {
  readonly upsertCalls: AgentBrowserViewTileUpsert[] = [];
  readonly releaseCalls: BrowserViewTileKey[] = [];
  readonly boundsCalls: BrowserViewBoundsUpdate[] = [];
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

  updateBounds(input: BrowserViewBoundsUpdate): Promise<void> {
    this.boundsCalls.push(input);
    return Promise.resolve();
  }

  releaseTile(input: BrowserViewTileKey): Promise<void> {
    this.releaseCalls.push(input);
    return Promise.resolve();
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

  emitOpenTileRequest(change: BrowserViewOpenTileRequest): void {
    this.openTileHandlers.forEach((handler) => handler(change));
  }

  get openTileHandlerCount(): number {
    return this.openTileHandlers.size;
  }

  emitStatus(change: BrowserViewStatusChange): void {
    this.statusHandlers.forEach((handler) => handler(change));
  }

  get statusHandlerCount(): number {
    return this.statusHandlers.size;
  }

  readonly dispatchCdpCalls: AgentBrowserViewCdpDispatch[] = [];
  private readonly cdpSessionEndedHandlers = new Set<
    (change: AgentBrowserViewCdpSessionEndedChange) => void
  >();

  dispatchCdp(
    input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult> {
    this.dispatchCdpCalls.push(input);
    return Promise.resolve({
      kind: input.command.kind,
      ok: false,
      error: {
        kind: "not_attached",
        message: "Not attached in test.",
        code: null,
      },
    });
  }

  onCdpSessionEnded(
    handler: (change: AgentBrowserViewCdpSessionEndedChange) => void,
  ): { dispose: () => void } {
    this.cdpSessionEndedHandlers.add(handler);
    return {
      dispose: () => {
        this.cdpSessionEndedHandlers.delete(handler);
      },
    };
  }

  emitCdpSessionEnded(change: AgentBrowserViewCdpSessionEndedChange): void {
    this.cdpSessionEndedHandlers.forEach((handler) => handler(change));
  }

  private readonly cdpTargetAttachedHandlers = new Set<
    (change: AgentBrowserViewCdpTargetAttachedChange) => void
  >();

  onCdpTargetAttached(
    handler: (change: AgentBrowserViewCdpTargetAttachedChange) => void,
  ): { dispose: () => void } {
    this.cdpTargetAttachedHandlers.add(handler);
    return {
      dispose: () => {
        this.cdpTargetAttachedHandlers.delete(handler);
      },
    };
  }

  emitCdpTargetAttached(change: AgentBrowserViewCdpTargetAttachedChange): void {
    this.cdpTargetAttachedHandlers.forEach((handler) => handler(change));
  }

  private readonly tileHandoffHandlers = new Set<
    (change: AgentBrowserViewTileHandoffChange) => void
  >();

  onTileHandoff(handler: (change: AgentBrowserViewTileHandoffChange) => void): {
    dispose: () => void;
  } {
    this.tileHandoffHandlers.add(handler);
    return {
      dispose: () => {
        this.tileHandoffHandlers.delete(handler);
      },
    };
  }

  emitTileHandoff(change: AgentBrowserViewTileHandoffChange): void {
    this.tileHandoffHandlers.forEach((handler) => handler(change));
  }
}

const VIEW_TAB_ID = "view-tab-1";

function tileKey(paneId: string): BrowserViewTileKey {
  return {
    viewTabId: VIEW_TAB_ID,
    paneId,
    tileInstanceId: NODE.instanceId,
    pageSessionId: NODE.id,
  };
}

function seedAgentBrowserCanvas(): string {
  const canvas = createSingleTileCanvas(NODE);
  if (canvas.root === null) throw new Error("expected canvas root");
  const pane = collectPanes(canvas.root).at(0);
  if (pane === undefined) throw new Error("expected a pane");
  useEpicCanvasStore.setState({
    tabsById: {
      [VIEW_TAB_ID]: {
        tabId: VIEW_TAB_ID,
        epicId: "epic-1",
        name: "Agent browser tab",
      },
    },
    canvasByTabId: {
      [VIEW_TAB_ID]: canvas,
    },
  });
  return pane.id;
}

function agentBrowserTilesOnCanvas(): AgentBrowserTileRef[] {
  const canvas = useEpicCanvasStore.getState().canvasByTabId[VIEW_TAB_ID];
  if (canvas === undefined) return [];
  return Object.values(canvas.tilesByInstanceId).filter(
    (tile): tile is AgentBrowserTileRef =>
      tile !== undefined && isAgentBrowserTileRef(tile),
  );
}

function renderAgentBrowserTile(paneId: string): RenderResult {
  return render(
    <AgentBrowserTile node={NODE} viewTabId={VIEW_TAB_ID} paneId={paneId} />,
  );
}

describe("<AgentBrowserTile />", () => {
  beforeEach(() => {
    bridgeHarness.current = null;
    visibilityHarness.visible = true;
    resetElectronBrowserTabStoreForTests();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  });

  afterEach(() => {
    cleanup();
    resetElectronBrowserTabStoreForTests();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  });

  it("renders a dead state when the agent browser bridge is unavailable", () => {
    bridgeHarness.current = null;
    const paneId = seedAgentBrowserCanvas();

    renderAgentBrowserTile(paneId);

    expect(screen.getByText("Agent browser unavailable")).toBeTruthy();
    expect(
      screen.getByText("Native browser views are unavailable."),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`agent-browser-tile-${NODE.instanceId}`),
    ).toBeTruthy();
  });

  it("upserts on mount and releases on unmount", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    const paneId = seedAgentBrowserCanvas();
    const key = tileKey(paneId);

    const view = renderAgentBrowserTile(paneId);

    await waitFor(() => {
      expect(bridge.upsertCalls.length).toBeGreaterThanOrEqual(1);
    });
    expect(bridge.upsertCalls[0]).toEqual({
      ...key,
      url: NODE.url,
      visible: true,
    });
    expect(bridge.releaseCalls).toEqual([]);

    view.unmount();

    await waitFor(() => {
      expect(bridge.releaseCalls).toEqual([key]);
    });
  });

  it("subscribes to status changes for its tile key and ignores others", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    const paneId = seedAgentBrowserCanvas();
    const key = tileKey(paneId);

    renderAgentBrowserTile(paneId);

    // Tile component + electron-browser-tab-store both subscribe.
    await waitFor(() => {
      expect(bridge.statusHandlerCount).toBeGreaterThanOrEqual(1);
    });

    // Loading by default until a matching status arrives.
    expect(screen.getByText("Loading page")).toBeTruthy();

    bridge.emitStatus({
      viewTabId: "other-tab",
      paneId,
      tileInstanceId: NODE.instanceId,
      pageSessionId: NODE.id,
      url: NODE.url,
      title: "Other",
      status: "ready",
      reason: null,
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });
    expect(screen.getByText("Loading page")).toBeTruthy();

    bridge.emitStatus({
      ...key,
      url: NODE.url,
      title: "Example",
      status: "dead",
      reason: "crashed",
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });

    await waitFor(() => {
      expect(screen.getByText("Agent browser unavailable")).toBeTruthy();
    });
    expect(screen.getByText("crashed")).toBeTruthy();
  });

  it("disposes the component status subscription on unmount", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    const paneId = seedAgentBrowserCanvas();

    const view = renderAgentBrowserTile(paneId);
    await waitFor(() => {
      // Component + registration-store forwarding.
      expect(bridge.statusHandlerCount).toBe(2);
    });

    view.unmount();
    // Store forwarding stays until store reset; only the tile effect is disposed.
    expect(bridge.statusHandlerCount).toBe(1);
  });

  it("adopts target=_blank open-tile requests into the same session only after electronTabRegistered", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    const paneId = seedAgentBrowserCanvas();
    const key = tileKey(paneId);
    const warn = vi.spyOn(appLogger, "warn").mockImplementation(() => {});

    renderAgentBrowserTile(paneId);
    await waitFor(() => {
      expect(bridge.openTileHandlerCount).toBe(1);
    });
    expect(agentBrowserTilesOnCanvas()).toHaveLength(1);

    // Pre-ack: durable tabId is unknown, so popup must not create a tile.
    act(() => {
      bridge.emitOpenTileRequest({
        ...key,
        url: "https://example.com/popup-before-ack",
        disposition: "foreground-tab",
      });
    });
    expect(agentBrowserTilesOnCanvas()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "[agent-browser] popup dropped before durable tab registration",
      { url: "https://example.com/popup-before-ack" },
    );

    act(() => {
      handleElectronBrowserTabFrame({
        kind: "electronTabRegistered",
        hasBinaryPayload: false,
        requestId: "req-reg-1",
        registrationId: NODE.id,
        sessionId: NODE.sessionId,
        tabId: "host-minted-tab-1",
      });
    });
    await waitFor(() => {
      expect(bridge.registerDurableTabCalls).toEqual([
        {
          ...key,
          sessionId: NODE.sessionId,
          tabId: "host-minted-tab-1",
        },
      ]);
    });
    // Wait for durableTabId state to re-arm the open-tile effect.
    await waitFor(() => {
      expect(bridge.openTileHandlerCount).toBe(1);
    });

    act(() => {
      bridge.emitOpenTileRequest({
        ...key,
        url: "https://example.com/popup-after-ack",
        disposition: "foreground-tab",
      });
    });

    await waitFor(() => {
      expect(agentBrowserTilesOnCanvas()).toHaveLength(2);
    });
    const tiles = agentBrowserTilesOnCanvas();
    const popup = tiles.find((tile) => tile.instanceId !== NODE.instanceId);
    expect(popup).toBeDefined();
    expect(popup?.sessionId).toBe(NODE.sessionId);
    expect(popup?.url).toBe("https://example.com/popup-after-ack");

    warn.mockRestore();
  });
});
