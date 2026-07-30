import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionsClientFrame } from "@traycer/protocol/host/browser/contracts";
import { BrowserTile } from "@/components/epic-canvas/renderers/browser-tile";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  publishAgentBrowserCdpRequest,
  resetAgentBrowserCdpStoreForTests,
} from "@/lib/browser-view/agent-browser-cdp-store";
import {
  publishBorrowedTileAttachment,
  readBorrowedTileAttachmentForTests,
  resetBorrowedTileStoreForTests,
  type BrowserBorrowedTileAttachment,
} from "@/lib/browser-view/browser-borrowed-tile-store";
import type {
  BrowserCookieCryptoState,
  BrowserViewCertificateErrorChange,
  BrowserViewCertificateTrust,
  BrowserViewCapturePageResult,
  BrowserViewControlAction,
  BrowserViewControlActionResult,
  BrowserViewControlGrant,
  BrowserViewControlGrantResult,
  BrowserViewControlRevokedChange,
  BrowserViewControlRevoke,
  BrowserViewDownloadCancel,
  BrowserViewDownloadChange,
  BrowserViewDebugSnapshotChange,
  BrowserViewElementPickResult,
  BrowserViewFindChange,
  BrowserViewFindRequest,
  BrowserViewFindStop,
  BrowserViewOpenTileRequest,
  BrowserViewOverlayOcclusion,
  BrowserViewOverlayOcclusionResult,
  BrowserViewOverlayRelease,
  BrowserViewOverlayReleaseResult,
  BrowserViewSnapshotInvalidatedChange,
  BrowserViewStatusChange,
  BrowserViewTileKey,
  BrowserViewViewportPresetChange,
  DesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
} from "@/lib/browser-view/desktop-agent-browser-view";
import { TILE_KIND_BROWSER } from "@/stores/epics/canvas/tile-kinds";
import type { BrowserTileRef } from "@/stores/epics/canvas/types";

const bridgeHarness = vi.hoisted<{
  current: DesktopBrowserViewBridge | null;
}>(() => ({ current: null }));

// Stable host identity: BrowserTile memoizes resolveDesktopBrowserViewBridge
// on the runnerHost reference. A new object per render would re-run that
// memo, fire the releaseTile cleanup, and make "did detach release the tile?"
// unobservable under the mock.
const runnerHostHarness = vi.hoisted(() => ({
  host: {
    get browserView() {
      return bridgeHarness.current;
    },
  },
}));

const updateBrowserTileUrlMock = vi.hoisted(() => ({
  fn: vi.fn(),
}));

const updateBrowserTileViewportPresetMock = vi.hoisted(() => ({
  fn: vi.fn(),
}));

vi.mock("@/components/epic-canvas/hooks/use-tab-host-id", () => ({
  useTabHostId: () => "host-test",
}));

vi.mock("@/components/epic-canvas/hooks/use-tile-body-visible", () => ({
  useTileBodyVisible: () => false,
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => runnerHostHarness.host,
}));

// Ticket 12: `BrowserTileBorrowedBanner` calls `useStopBrowserAgentActivity`,
// which needs a `HostRuntimeProvider` this file's harness does not set up -
// mocked the same way `useTabHostId`/`useRunnerHost` above are, rather than
// building out the provider stack for a hook these tests do not exercise.
const stopBrowserAgentActivityMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@/hooks/browser/use-stop-browser-agent-activity-mutation", () => ({
  useStopBrowserAgentActivity: () => stopBrowserAgentActivityMock,
}));

vi.mock("@/stores/epics/canvas/store", () => ({
  useEpicCanvasStore: (
    selector: (state: {
      readonly updateBrowserTileUrlInTab: typeof updateBrowserTileUrlMock.fn;
      readonly updateBrowserTileViewportPresetInTab: typeof updateBrowserTileViewportPresetMock.fn;
      readonly canvasByTabId: Record<string, unknown>;
    }) => unknown,
  ) =>
    selector({
      updateBrowserTileUrlInTab: updateBrowserTileUrlMock.fn,
      updateBrowserTileViewportPresetInTab:
        updateBrowserTileViewportPresetMock.fn,
      canvasByTabId: {
        "view-tab-1": {
          activePaneId: "pane-chat",
          sizesByGroupId: {},
          root: {
            kind: "group",
            id: "group-1",
            direction: "horizontal",
            children: [
              {
                kind: "pane",
                id: "pane-chat",
                tabInstanceIds: ["chat-instance-1"],
                activeTabId: "chat-instance-1",
                previewTabId: null,
                activationHistory: ["chat-instance-1"],
              },
              {
                kind: "pane",
                id: "pane-1",
                tabInstanceIds: ["browser-instance-1"],
                activeTabId: "browser-instance-1",
                previewTabId: null,
                activationHistory: ["browser-instance-1"],
              },
            ],
          },
          tilesByInstanceId: {
            "chat-instance-1": {
              id: "chat-1",
              instanceId: "chat-instance-1",
              type: "chat",
              name: "Chat",
              hostId: "host-test",
            },
            "browser-instance-1": {
              id: "browser-page-1",
              instanceId: "browser-instance-1",
              type: TILE_KIND_BROWSER,
              name: "Browser",
              hostId: "host-test",
              url: "https://example.com",
              viewportPreset: "responsive",
            },
          },
        },
      },
    }),
}));

const NODE: BrowserTileRef = {
  id: "browser-page-1",
  instanceId: "browser-instance-1",
  type: TILE_KIND_BROWSER,
  name: "Browser",
  hostId: "host-test",
  url: "https://example.com",
  viewportPreset: "responsive",
};

const REAL_STATE: BrowserCookieCryptoState = {
  mode: "real",
  persistence: "persistent",
  reason: "os-backed",
  storageBackend: null,
  encryptionAvailable: true,
  mockKeychainEnabled: false,
};

/**
 * Shape copied from browser-tile.test.tsx so this file stays independent of
 * the in-flight edits on that suite. `dispatchCdp` / `emitCdpSessionEnded`
 * are the load-bearing bits for borrowed-tile containment.
 */
class FakeBrowserViewBridge implements DesktopBrowserViewBridge {
  readonly cdpDispatchCalls: AgentBrowserViewCdpDispatch[] = [];
  // Ticket 09: ending a borrowed attachment must never close the user's tab.
  // releaseTile is the bridge call that tears the native view down; session
  // cleanup may call it for agent-created tiles, never for ones the user opened.
  readonly releaseTileCalls: BrowserViewTileKey[] = [];
  private readonly statusHandlers = new Set<
    (change: BrowserViewStatusChange) => void
  >();
  private readonly findHandlers = new Set<
    (change: BrowserViewFindChange) => void
  >();
  private readonly downloadHandlers = new Set<
    (change: BrowserViewDownloadChange) => void
  >();
  private readonly certificateHandlers = new Set<
    (change: BrowserViewCertificateErrorChange) => void
  >();
  private readonly openTileHandlers = new Set<
    (change: BrowserViewOpenTileRequest) => void
  >();
  private readonly controlRevokedHandlers = new Set<
    (change: BrowserViewControlRevokedChange) => void
  >();
  private readonly cdpSessionEndedHandlers = new Set<
    (change: AgentBrowserViewCdpSessionEndedChange) => void
  >();
  private readonly cdpTargetAttachedHandlers = new Set<
    (change: AgentBrowserViewCdpTargetAttachedChange) => void
  >();
  private readonly tileHandoffHandlers = new Set<
    (change: AgentBrowserViewTileHandoffChange) => void
  >();

  constructor(private readonly cryptoState: BrowserCookieCryptoState) {}

  upsertTile(): Promise<void> {
    return Promise.resolve();
  }

  updateBounds(): Promise<void> {
    return Promise.resolve();
  }

  setViewportPreset(_input: BrowserViewViewportPresetChange): Promise<void> {
    return Promise.resolve();
  }

  releaseTile(input: BrowserViewTileKey): Promise<void> {
    this.releaseTileCalls.push(input);
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

  findInPage(_input: BrowserViewFindRequest): Promise<void> {
    return Promise.resolve();
  }

  stopFindInPage(_input: BrowserViewFindStop): Promise<void> {
    return Promise.resolve();
  }

  cancelDownload(_input: BrowserViewDownloadCancel): Promise<void> {
    return Promise.resolve();
  }

  trustCertificate(_input: BrowserViewCertificateTrust): Promise<void> {
    return Promise.resolve();
  }

  zoomIn(_input: BrowserViewTileKey): Promise<void> {
    return Promise.resolve();
  }

  zoomOut(_input: BrowserViewTileKey): Promise<void> {
    return Promise.resolve();
  }

  resetZoom(_input: BrowserViewTileKey): Promise<void> {
    return Promise.resolve();
  }

  capturePage(
    input: BrowserViewTileKey,
  ): Promise<BrowserViewCapturePageResult> {
    return Promise.resolve({
      ...input,
      mediaType: "image/png",
      base64: "",
      byteLength: 0,
      sha256: "",
      capturedAt: 0,
    });
  }

  getDebugSnapshot(
    input: BrowserViewTileKey,
  ): Promise<BrowserViewDebugSnapshotChange> {
    return Promise.resolve({
      ...input,
      consoleEntries: [],
      networkEntries: [],
    });
  }

  clearDebugEvents(): Promise<void> {
    return Promise.resolve();
  }

  pickElement(
    _input: BrowserViewTileKey,
  ): Promise<BrowserViewElementPickResult> {
    return Promise.resolve({ outcome: "cancelled" });
  }

  cancelElementPick(_input: BrowserViewTileKey): Promise<void> {
    return Promise.resolve();
  }

  openDevTools(_input: BrowserViewTileKey): Promise<void> {
    return Promise.resolve();
  }

  occludeForOverlay(
    _input: BrowserViewOverlayOcclusion,
  ): Promise<BrowserViewOverlayOcclusionResult> {
    return Promise.resolve({ snapshots: [], restoredTiles: [] });
  }

  releaseOverlay(
    _input: BrowserViewOverlayRelease,
  ): Promise<BrowserViewOverlayReleaseResult> {
    return Promise.resolve({ restoredTiles: [] });
  }

  getCookieCryptoState(): Promise<BrowserCookieCryptoState> {
    return Promise.resolve(this.cryptoState);
  }

  setLabsState(): Promise<void> {
    return Promise.resolve();
  }

  applyStorageState(): Promise<{
    readonly status: "applied";
    readonly cookieCount: 0;
    readonly localStorageApplied: false;
    readonly reason: "cookies-only";
  }> {
    return Promise.resolve({
      status: "applied",
      cookieCount: 0,
      localStorageApplied: false,
      reason: "cookies-only",
    });
  }

  captureStorageState(): Promise<{
    readonly storageState: { readonly cookies: []; readonly origins: [] };
    readonly cookieCount: 0;
    readonly cookieDomains: [];
    readonly localStorageCount: 0;
    readonly localStorageAvailable: true;
    readonly localStorageReason: null;
  }> {
    return Promise.resolve({
      storageState: { cookies: [], origins: [] },
      cookieCount: 0,
      cookieDomains: [],
      localStorageCount: 0,
      localStorageAvailable: true,
      localStorageReason: null,
    });
  }

  grantControl(
    input: BrowserViewControlGrant,
  ): Promise<BrowserViewControlGrantResult> {
    return Promise.resolve({ status: "granted", controlId: input.controlId });
  }

  revokeControl(_input: BrowserViewControlRevoke): Promise<void> {
    return Promise.resolve();
  }

  executeControlAction(
    _input: BrowserViewControlAction,
  ): Promise<BrowserViewControlActionResult> {
    return Promise.resolve({ status: "completed", value: null });
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

  onFindChange(handler: (change: BrowserViewFindChange) => void): {
    dispose: () => void;
  } {
    this.findHandlers.add(handler);
    return {
      dispose: () => {
        this.findHandlers.delete(handler);
      },
    };
  }

  onDownloadChange(handler: (change: BrowserViewDownloadChange) => void): {
    dispose: () => void;
  } {
    this.downloadHandlers.add(handler);
    return {
      dispose: () => {
        this.downloadHandlers.delete(handler);
      },
    };
  }

  onCertificateError(
    handler: (change: BrowserViewCertificateErrorChange) => void,
  ): {
    dispose: () => void;
  } {
    this.certificateHandlers.add(handler);
    return {
      dispose: () => {
        this.certificateHandlers.delete(handler);
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

  onSnapshotInvalidated(
    _handler: (change: BrowserViewSnapshotInvalidatedChange) => void,
  ): {
    dispose: () => void;
  } {
    return { dispose: () => undefined };
  }

  onDebugSnapshotChange(
    _handler: (change: BrowserViewDebugSnapshotChange) => void,
  ): {
    dispose: () => void;
  } {
    return { dispose: () => undefined };
  }

  onControlRevoked(
    handler: (change: BrowserViewControlRevokedChange) => void,
  ): {
    dispose: () => void;
  } {
    this.controlRevokedHandlers.add(handler);
    return {
      dispose: () => {
        this.controlRevokedHandlers.delete(handler);
      },
    };
  }

  dispatchCdp(
    input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult> {
    this.cdpDispatchCalls.push(input);
    return Promise.resolve({
      kind: "cdpGetFrameTree" as const,
      ok: true as const,
      frames: [],
    });
  }

  onCdpSessionEnded(
    handler: (change: AgentBrowserViewCdpSessionEndedChange) => void,
  ): {
    dispose: () => void;
  } {
    this.cdpSessionEndedHandlers.add(handler);
    return {
      dispose: () => {
        this.cdpSessionEndedHandlers.delete(handler);
      },
    };
  }

  onCdpTargetAttached(
    handler: (change: AgentBrowserViewCdpTargetAttachedChange) => void,
  ): {
    dispose: () => void;
  } {
    this.cdpTargetAttachedHandlers.add(handler);
    return {
      dispose: () => {
        this.cdpTargetAttachedHandlers.delete(handler);
      },
    };
  }

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

  emitCdpSessionEnded(change: AgentBrowserViewCdpSessionEndedChange): void {
    this.cdpSessionEndedHandlers.forEach((handler) => handler(change));
  }

  emitCdpTargetAttached(change: AgentBrowserViewCdpTargetAttachedChange): void {
    this.cdpTargetAttachedHandlers.forEach((handler) => handler(change));
  }
}

function tileKey(): BrowserViewTileKey {
  return {
    viewTabId: "view-tab-1",
    paneId: "pane-1",
    tileInstanceId: NODE.instanceId,
    pageSessionId: NODE.id,
  };
}

function makeAttachment(input: {
  readonly attachmentId: string;
  readonly agentLabel: string;
  readonly expiresAt: number;
  readonly sendFrame: (frame: BrowserSessionsClientFrame) => void;
}): BrowserBorrowedTileAttachment {
  return {
    attachmentId: input.attachmentId,
    tileInstanceId: NODE.instanceId,
    chatId: "chat-1",
    agentRunId: "run-1",
    agentLabel: input.agentLabel,
    attachedAt: Date.now(),
    expiresAt: input.expiresAt,
    sendFrame: input.sendFrame,
  };
}

function expectUserTileStillOpen(bridge: FakeBrowserViewBridge): void {
  expect(bridge.releaseTileCalls).toEqual([]);
  expect(screen.getByTestId(`browser-tile-${NODE.instanceId}`)).toBeTruthy();
}

function renderBrowserTile(): void {
  render(
    <TooltipProvider>
      <BrowserTile
        node={NODE}
        viewTabId="view-tab-1"
        paneId="pane-1"
        epicId="epic-1"
      />
    </TooltipProvider>,
  );
}

function publishCdpForTile(
  requestId: string,
  sendFrame: (frame: BrowserSessionsClientFrame) => void,
): void {
  publishAgentBrowserCdpRequest({
    requestId,
    tileInstanceId: NODE.instanceId,
    sessionId: null,
    command: { kind: "cdpGetFrameTree" },
    sendFrame,
  });
}

describe("<BrowserTile /> borrowed-tile attach", () => {
  let bridge: FakeBrowserViewBridge;

  beforeEach(() => {
    bridge = new FakeBrowserViewBridge(REAL_STATE);
    bridgeHarness.current = bridge;
    updateBrowserTileUrlMock.fn.mockReset();
    updateBrowserTileViewportPresetMock.fn.mockReset();
    resetBorrowedTileStoreForTests();
    resetAgentBrowserCdpStoreForTests();
  });

  afterEach(() => {
    cleanup();
    resetBorrowedTileStoreForTests();
    resetAgentBrowserCdpStoreForTests();
    bridgeHarness.current = null;
  });

  it("blocks CDP until a live attachment registers the handler, then reaches dispatchCdp", async () => {
    renderBrowserTile();

    const blockedSendFrame =
      vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishCdpForTile("req-blocked", blockedSendFrame);

    expect(bridge.cdpDispatchCalls).toEqual([]);
    expect(blockedSendFrame).toHaveBeenCalledTimes(1);
    expect(blockedSendFrame.mock.calls[0]?.[0]).toMatchObject({
      kind: "cdpGetFrameTreeResult",
      requestId: "req-blocked",
      tileInstanceId: NODE.instanceId,
      ok: false,
      error: { kind: "tile_not_found" },
    });

    act(() => {
      publishBorrowedTileAttachment(
        makeAttachment({
          attachmentId: "att-1",
          agentLabel: "Codex",
          expiresAt: Date.now() + 60_000,
          sendFrame: vi.fn(),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Codex is driving this tab/)).toBeTruthy();
    });

    const allowedSendFrame =
      vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishCdpForTile("req-allowed", allowedSendFrame);

    await waitFor(() => {
      expect(bridge.cdpDispatchCalls).toHaveLength(1);
    });
    expect(bridge.cdpDispatchCalls[0]).toMatchObject({
      ...tileKey(),
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });
  });

  it("unregisters the CDP handler when Detach is clicked without releasing the user tile", async () => {
    renderBrowserTile();

    act(() => {
      publishBorrowedTileAttachment(
        makeAttachment({
          attachmentId: "att-detach",
          agentLabel: "Claude",
          expiresAt: Date.now() + 60_000,
          sendFrame: vi.fn(),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /detach/i })).toBeTruthy();
    });

    const beforeDetachSendFrame =
      vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishCdpForTile("req-before-detach", beforeDetachSendFrame);
    await waitFor(() => {
      expect(bridge.cdpDispatchCalls).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /detach/i }));

    await waitFor(() => {
      expect(readBorrowedTileAttachmentForTests(NODE.instanceId)).toBeNull();
    });

    const afterDetachSendFrame =
      vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishCdpForTile("req-after-detach", afterDetachSendFrame);

    expect(bridge.cdpDispatchCalls).toHaveLength(1);
    expect(afterDetachSendFrame).toHaveBeenCalledTimes(1);
    expect(afterDetachSendFrame.mock.calls[0]?.[0]).toMatchObject({
      ok: false,
      error: { kind: "tile_not_found" },
    });
    // Detach ends agent access only - the user's tab stays open.
    expectUserTileStillOpen(bridge);
  });

  it("renders the agent label and Detach control while attached, and removes them after detaching", async () => {
    renderBrowserTile();

    expect(screen.queryByText(/is driving this tab/)).toBeNull();
    expect(screen.queryByRole("button", { name: /detach/i })).toBeNull();

    act(() => {
      publishBorrowedTileAttachment(
        makeAttachment({
          attachmentId: "att-banner",
          agentLabel: "Grok",
          expiresAt: Date.now() + 60_000,
          sendFrame: vi.fn(),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Grok is driving this tab/)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /detach/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /detach/i }));

    await waitFor(() => {
      expect(screen.queryByText(/is driving this tab/)).toBeNull();
    });
    expect(screen.queryByRole("button", { name: /detach/i })).toBeNull();
    expectUserTileStillOpen(bridge);
  });

  it("ends the attachment when onCdpSessionEnded fires without releasing the user tile", async () => {
    renderBrowserTile();

    act(() => {
      publishBorrowedTileAttachment(
        makeAttachment({
          attachmentId: "att-session-end",
          agentLabel: "Amp",
          expiresAt: Date.now() + 60_000,
          sendFrame: vi.fn(),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Amp is driving this tab/)).toBeTruthy();
    });

    act(() => {
      bridge.emitCdpSessionEnded({
        ...tileKey(),
        reason: "devtools-opened",
      });
    });

    await waitFor(() => {
      expect(readBorrowedTileAttachmentForTests(NODE.instanceId)).toBeNull();
    });
    expect(screen.queryByText(/Amp is driving this tab/)).toBeNull();

    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishCdpForTile("req-after-session-end", sendFrame);
    expect(bridge.cdpDispatchCalls).toHaveLength(0);
    expect(sendFrame.mock.calls[0]?.[0]).toMatchObject({
      ok: false,
      error: { kind: "tile_not_found" },
    });
    // Debugger detach ends the attachment; it does not close the tab.
    expectUserTileStillOpen(bridge);
  });

  /**
   * Ticket 29 (review round 1, P1): borrowed path previously forwarded CDP
   * dispatch but not Target.attachedToTarget - a genuine OOPIF on a borrowed
   * tab was never discoverable. Mirror of AgentBrowserTile's attach forward.
   */
  it("forwards onCdpTargetAttached for this tile to notifyAgentBrowserCdpTargetAttached and ignores other tiles (ticket 29 review P1)", async () => {
    renderBrowserTile();

    act(() => {
      publishBorrowedTileAttachment(
        makeAttachment({
          attachmentId: "att-target-attached",
          agentLabel: "Claude",
          expiresAt: Date.now() + 60_000,
          sendFrame: vi.fn(),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Claude is driving this tab/)).toBeTruthy();
    });

    // Seed a sendFrame for this tile so notifyAgentBrowserCdpTargetAttached
    // has a sink (same registration path a real dispatch uses).
    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishCdpForTile("req-seed-attach-forward", sendFrame);
    await waitFor(() => {
      expect(bridge.cdpDispatchCalls).toHaveLength(1);
    });
    sendFrame.mockClear();

    act(() => {
      bridge.emitCdpTargetAttached({
        ...tileKey(),
        sessionId: "oopif-session-1",
        targetId: "CHILD-1",
        targetType: "iframe",
        url: "https://child.example/form",
        waitingForDebugger: false,
      });
    });

    expect(sendFrame).toHaveBeenCalledTimes(1);
    expect(sendFrame.mock.calls[0]?.[0]).toMatchObject({
      kind: "cdpTargetAttached",
      tileInstanceId: NODE.instanceId,
      sessionId: "oopif-session-1",
      targetId: "CHILD-1",
      targetType: "iframe",
      url: "https://child.example/form",
      waitingForDebugger: false,
    });

    // Different tile key must be filtered by isStatusForTile - no extra
    // notify / sendFrame call.
    act(() => {
      bridge.emitCdpTargetAttached({
        viewTabId: "view-tab-other",
        paneId: "pane-other",
        tileInstanceId: "other-tile",
        pageSessionId: "other-page",
        sessionId: "oopif-other",
        targetId: "CHILD-OTHER",
        targetType: "iframe",
        url: "https://other.example/",
        waitingForDebugger: false,
      });
    });

    expect(sendFrame).toHaveBeenCalledTimes(1);
    expectUserTileStillOpen(bridge);
  });

  it("drops the attachment on local expiry without releasing the user tile", () => {
    // Avoid waitFor under fake timers - it polls with real timers and hangs.
    // Store expiry + React's sync external store flush are both act()-visible.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      renderBrowserTile();

      act(() => {
        publishBorrowedTileAttachment(
          makeAttachment({
            attachmentId: "att-expiry",
            agentLabel: "Expiring",
            expiresAt: Date.now() + 5_000,
            sendFrame: vi.fn(),
          }),
        );
      });

      expect(screen.getByText(/Expiring is driving this tab/)).toBeTruthy();
      expectUserTileStillOpen(bridge);

      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      expect(readBorrowedTileAttachmentForTests(NODE.instanceId)).toBeNull();
      expect(screen.queryByText(/Expiring is driving this tab/)).toBeNull();
      expectUserTileStillOpen(bridge);

      const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
      publishCdpForTile("req-after-expiry", sendFrame);
      expect(bridge.cdpDispatchCalls).toEqual([]);
      expect(sendFrame.mock.calls[0]?.[0]).toMatchObject({
        ok: false,
        error: { kind: "tile_not_found" },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
