import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import {
  BROWSER_VIEW_SURFACE_ATTRIBUTE,
  getBrowserViewSnapshot,
  listBrowserOverlayTiles,
  resetBrowserOverlayCoordinatorForTests,
  setBrowserViewSnapshot,
} from "@/lib/browser-view/browser-overlay-coordinator";
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
  host: { agentBrowserView: DesktopAgentBrowserViewBridge | null };
  current: DesktopAgentBrowserViewBridge | null;
}>(() => {
  const host: { agentBrowserView: DesktopAgentBrowserViewBridge | null } = {
    agentBrowserView: null,
  };
  return {
    host,
    get current() {
      return host.agentBrowserView;
    },
    set current(value: DesktopAgentBrowserViewBridge | null) {
      host.agentBrowserView = value;
    },
  };
});

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
  useRunnerHost: () => bridgeHarness.host,
}));

const NODE: AgentBrowserTileRef = {
  id: "agent-browser-page-1",
  sessionId: "agent-browser-session-1",
  instanceId: "agent-browser-instance-1",
  type: TILE_KIND_AGENT_BROWSER,
  name: "Agent browser",
  hostId: "host-test",
  url: "https://example.com",
  viewportPreset: "responsive",
  runtime: "isolated",
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

  onSnapshotInvalidated(): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  setViewportPreset(): Promise<void> {
    return Promise.resolve();
  }

  reloadTile(): Promise<void> {
    return Promise.resolve();
  }

  goBack(): Promise<void> {
    return Promise.resolve();
  }

  goForward(): Promise<void> {
    return Promise.resolve();
  }

  findInPage(): Promise<void> {
    return Promise.resolve();
  }

  stopFindInPage(): Promise<void> {
    return Promise.resolve();
  }

  cancelDownload(): Promise<void> {
    return Promise.resolve();
  }

  trustCertificate(): Promise<void> {
    return Promise.resolve();
  }

  zoomIn(): Promise<void> {
    return Promise.resolve();
  }

  zoomOut(): Promise<void> {
    return Promise.resolve();
  }

  resetZoom(): Promise<void> {
    return Promise.resolve();
  }

  openDevTools(): Promise<void> {
    return Promise.resolve();
  }

  onFindChange(): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  onDownloadChange(): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  onCertificateError(): { dispose: () => void } {
    return { dispose: () => undefined };
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

  occludeForOverlay(): Promise<{
    readonly snapshots: never[];
    readonly restoredTiles: never[];
  }> {
    return Promise.resolve({ snapshots: [], restoredTiles: [] });
  }

  releaseOverlay(): Promise<{ readonly restoredTiles: never[] }> {
    return Promise.resolve({ restoredTiles: [] });
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

function emitStatus(
  bridge: FakeAgentBrowserViewBridge,
  key: BrowserViewTileKey,
  status: BrowserViewStatusChange["status"],
  reason: string | null,
): void {
  bridge.emitStatus({
    ...key,
    url: NODE.url,
    title: "Example",
    status,
    reason,
    canGoBack: false,
    canGoForward: false,
    zoomPercent: 100,
  });
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
    resetBrowserOverlayCoordinatorForTests();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetElectronBrowserTabStoreForTests();
    resetBrowserOverlayCoordinatorForTests();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  });

  it("registers with the overlay coordinator on mount and unregisters on unmount", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    const paneId = seedAgentBrowserCanvas();
    const key = tileKey(paneId);

    const view = renderAgentBrowserTile(paneId);

    await waitFor(() => {
      expect(
        listBrowserOverlayTiles().some(
          (tile) =>
            tile.key.viewTabId === key.viewTabId &&
            tile.key.paneId === key.paneId &&
            tile.key.tileInstanceId === key.tileInstanceId &&
            tile.key.pageSessionId === key.pageSessionId,
        ),
      ).toBe(true);
    });

    view.unmount();

    expect(listBrowserOverlayTiles()).toEqual([]);
  });

  it("mounts a view surface and renders a registered overlay snapshot", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    const paneId = seedAgentBrowserCanvas();
    const key = tileKey(paneId);

    renderAgentBrowserTile(paneId);

    await waitFor(() => {
      expect(
        listBrowserOverlayTiles().some(
          (tile) =>
            tile.key.viewTabId === key.viewTabId &&
            tile.key.paneId === key.paneId &&
            tile.key.tileInstanceId === key.tileInstanceId &&
            tile.key.pageSessionId === key.pageSessionId,
        ),
      ).toBe(true);
    });
    expect(
      document.querySelector(`[${BROWSER_VIEW_SURFACE_ATTRIBUTE}]`),
    ).not.toBeNull();
    expect(document.querySelector("[data-browser-view-snapshot]")).toBeNull();

    act(() => {
      setBrowserViewSnapshot({
        ...key,
        dataUrl: "data:image/png;base64,abc",
        stale: false,
      });
    });

    expect(getBrowserViewSnapshot(key)).toEqual({
      dataUrl: "data:image/png;base64,abc",
      stale: false,
    });
    await waitFor(() => {
      expect(
        document.querySelector("[data-browser-view-snapshot]"),
      ).not.toBeNull();
    });
  });

  it("renders a dead state when the agent browser bridge is unavailable", () => {
    bridgeHarness.current = null;
    const paneId = seedAgentBrowserCanvas();

    renderAgentBrowserTile(paneId);

    expect(screen.getByText("Agent browser unavailable")).toBeTruthy();
    expect(
      screen.getByText("Native browser views are unavailable."),
    ).toBeTruthy();
    const overlay = screen.getByRole("alert");
    expect(overlay.getAttribute("aria-live")).toBe("assertive");
    expect(overlay.getAttribute("aria-busy")).toBe("false");
    expect(screen.queryByText(`Host ${NODE.hostId}`)).toBeNull();
    expect(screen.getByRole("button", { name: "Host details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close tab" })).toBeNull();
    expect(
      screen.getByTestId(`agent-browser-tile-${NODE.instanceId}`),
    ).toBeTruthy();
  });

  it("shows the host id only through the real Host details tooltip", async () => {
    bridgeHarness.current = null;
    const paneId = seedAgentBrowserCanvas();
    const user = userEvent.setup();

    renderAgentBrowserTile(paneId);

    expect(screen.queryByText(`Host ${NODE.hostId}`)).toBeNull();
    const trigger = screen.getByRole("button", { name: "Host details" });
    await user.hover(trigger);

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      `Host ${NODE.hostId}`,
    );
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
      viewportPreset: "responsive",
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
    expect(screen.getByText("Reconnecting to this session")).toBeTruthy();
    const loadingOverlay = screen.getByRole("status");
    expect(loadingOverlay.getAttribute("aria-live")).toBe("polite");
    expect(loadingOverlay.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText(`Host ${NODE.hostId}`)).toBeNull();
    expect(screen.getByRole("button", { name: "Host details" })).toBeTruthy();

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
    expect(screen.getByText("Reconnecting to this session")).toBeTruthy();

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
    expect(screen.queryByText(`Host ${NODE.hostId}`)).toBeNull();
    expect(screen.getByRole("button", { name: "Host details" })).toBeTruthy();
  });

  it("switches loading to unreachable after the timeout", () => {
    vi.useFakeTimers();
    try {
      const bridge = new FakeAgentBrowserViewBridge();
      bridgeHarness.current = bridge;
      const paneId = seedAgentBrowserCanvas();

      renderAgentBrowserTile(paneId);

      expect(screen.getByText("Reconnecting to this session")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(12_001);
      });

      expect(
        screen.getByText("This session's host isn't responding"),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Close tab" })).toBeTruthy();
      const unreachableOverlay = screen.getByRole("alert");
      expect(unreachableOverlay.getAttribute("aria-live")).toBe("assertive");
      expect(unreachableOverlay.getAttribute("aria-busy")).toBe("false");
      expect(screen.queryByText("Reconnecting to this session")).toBeNull();
      expect(screen.queryByText(`Host ${NODE.hostId}`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries an unreachable session by re-upserting and re-arms loading", () => {
    vi.useFakeTimers();
    try {
      const bridge = new FakeAgentBrowserViewBridge();
      bridgeHarness.current = bridge;
      const paneId = seedAgentBrowserCanvas();

      renderAgentBrowserTile(paneId);
      const initialUpsertCount = bridge.upsertCalls.length;
      act(() => {
        vi.advanceTimersByTime(12_001);
      });
      expect(
        screen.getByText("This session's host isn't responding"),
      ).toBeTruthy();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      });

      expect(screen.getByText("Reconnecting to this session")).toBeTruthy();
      expect(
        screen.queryByText("This session's host isn't responding"),
      ).toBeNull();
      expect(bridge.upsertCalls.length).toBeGreaterThan(initialUpsertCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the canvas tile from the unreachable state", () => {
    vi.useFakeTimers();
    try {
      const bridge = new FakeAgentBrowserViewBridge();
      bridgeHarness.current = bridge;
      const paneId = seedAgentBrowserCanvas();

      renderAgentBrowserTile(paneId);
      act(() => {
        vi.advanceTimersByTime(12_001);
      });

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
      });

      expect(agentBrowserTilesOnCanvas()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a real reconnect leak the loading timeout", () => {
    vi.useFakeTimers();
    try {
      const bridge = new FakeAgentBrowserViewBridge();
      bridgeHarness.current = bridge;
      const paneId = seedAgentBrowserCanvas();
      const key = tileKey(paneId);

      renderAgentBrowserTile(paneId);
      act(() => {
        emitStatus(bridge, key, "ready", null);
      });
      act(() => {
        vi.advanceTimersByTime(12_001);
      });

      expect(
        screen.queryByText("This session's host isn't responding"),
      ).toBeNull();
      expect(screen.getByText("Reconnecting to this session")).toBeTruthy();
      expect(
        screen.getByText("Reconnecting to this session").parentElement
          ?.className ?? "",
      ).toContain("opacity-0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("documents the stale unreachable state after loading-ready-loading", () => {
    vi.useFakeTimers();
    try {
      const bridge = new FakeAgentBrowserViewBridge();
      bridgeHarness.current = bridge;
      const paneId = seedAgentBrowserCanvas();
      const key = tileKey(paneId);

      renderAgentBrowserTile(paneId);
      act(() => {
        vi.advanceTimersByTime(12_001);
      });
      expect(
        screen.getByText("This session's host isn't responding"),
      ).toBeTruthy();

      act(() => {
        emitStatus(bridge, key, "ready", null);
      });
      act(() => {
        emitStatus(bridge, key, "loading", null);
      });

      expect(
        screen.getByText("This session's host isn't responding"),
      ).toBeTruthy();
      expect(screen.queryByText("Reconnecting to this session")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it("does not upsert the stale canvas URL after address navigate then visibility or Retry", () => {
    vi.useFakeTimers();
    try {
      const bridge = new FakeAgentBrowserViewBridge();
      bridgeHarness.current = bridge;
      const paneId = seedAgentBrowserCanvas();
      const nextUrl = "https://next.example/";
      const view = renderAgentBrowserTile(paneId);

      expect(bridge.upsertCalls.length).toBeGreaterThanOrEqual(1);
      expect(bridge.upsertCalls[0]?.url).toBe(NODE.url);

      fireEvent.change(screen.getByLabelText("Browser address"), {
        target: { value: nextUrl },
      });
      const addressForm = screen
        .getByLabelText("Browser address")
        .closest("form");
      if (addressForm === null) {
        throw new Error("browser address input must be wrapped in a form");
      }
      fireEvent.submit(addressForm);
      expect(bridge.upsertCalls.at(-1)?.url).toBe(nextUrl);

      visibilityHarness.visible = false;
      view.rerender(
        <AgentBrowserTile
          node={NODE}
          viewTabId={VIEW_TAB_ID}
          paneId={paneId}
        />,
      );
      expect(bridge.upsertCalls.at(-1)?.url).toBe(nextUrl);

      visibilityHarness.visible = true;
      view.rerender(
        <AgentBrowserTile
          node={NODE}
          viewTabId={VIEW_TAB_ID}
          paneId={paneId}
        />,
      );
      expect(bridge.upsertCalls.at(-1)?.url).toBe(nextUrl);

      act(() => {
        vi.advanceTimersByTime(12_001);
      });
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(bridge.upsertCalls.at(-1)?.url).toBe(nextUrl);
      expect(
        bridge.upsertCalls
          .slice(1)
          .every((call) => call.url === nextUrl),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("upserts a persisted non-responsive viewport preset on remount", async () => {
    const mobileNode: AgentBrowserTileRef = {
      ...NODE,
      viewportPreset: "mobile",
    };
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;
    const canvas = createSingleTileCanvas(mobileNode);
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

    const first = render(
      <AgentBrowserTile
        node={mobileNode}
        viewTabId={VIEW_TAB_ID}
        paneId={pane.id}
      />,
    );
    await waitFor(() => {
      expect(bridge.upsertCalls.length).toBeGreaterThanOrEqual(1);
    });
    expect(bridge.upsertCalls[0]?.viewportPreset).toBe("mobile");

    first.unmount();
    bridge.upsertCalls.length = 0;

    render(
      <AgentBrowserTile
        node={mobileNode}
        viewTabId={VIEW_TAB_ID}
        paneId={pane.id}
      />,
    );
    await waitFor(() => {
      expect(bridge.upsertCalls.length).toBeGreaterThanOrEqual(1);
    });
    expect(bridge.upsertCalls[0]?.viewportPreset).toBe("mobile");
    expect(
      bridge.upsertCalls.every((call) => call.viewportPreset === "mobile"),
    ).toBe(true);
  });
});
