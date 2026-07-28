import { ipcRenderer } from "electron";
import {
  RunnerHostEvent,
  RunnerHostInvoke,
} from "../ipc-contracts/ipc-channels";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpInteractionObservedChange,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
  BrowserCookieCryptoState,
  BrowserLabsStateUpdate,
  BrowserViewBoundsUpdate,
  BrowserViewCapturePageResult,
  BrowserViewCertificateErrorChange,
  BrowserViewCertificateTrust,
  BrowserViewControlAction,
  BrowserViewControlActionResult,
  BrowserViewControlGrant,
  BrowserViewControlGrantResult,
  BrowserViewControlRevokedChange,
  BrowserViewControlRevoke,
  BrowserViewDebugSnapshotChange,
  BrowserViewDownloadCancel,
  BrowserViewDownloadChange,
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
  BrowserViewStorageStateApply,
  BrowserViewStorageStateApplyResult,
  BrowserViewStorageStateCapture,
  BrowserViewStorageStateCaptureResult,
  BrowserViewTileKey,
  BrowserViewTileUpsert,
  BrowserViewViewportPresetChange,
} from "../ipc-contracts/browser-view-types";
import { subscribe, type Disposable, type Listener } from "./subscribe";

export interface BrowserViewBridgeSurface {
  browserView: {
    upsertTile(input: BrowserViewTileUpsert): Promise<void>;
    updateBounds(input: BrowserViewBoundsUpdate): Promise<void>;
    setViewportPreset(input: BrowserViewViewportPresetChange): Promise<void>;
    releaseTile(input: BrowserViewTileKey): Promise<void>;
    reloadTile(input: BrowserViewTileKey): Promise<void>;
    goBack(input: BrowserViewTileKey): Promise<void>;
    goForward(input: BrowserViewTileKey): Promise<void>;
    findInPage(input: BrowserViewFindRequest): Promise<void>;
    stopFindInPage(input: BrowserViewFindStop): Promise<void>;
    cancelDownload(input: BrowserViewDownloadCancel): Promise<void>;
    trustCertificate(input: BrowserViewCertificateTrust): Promise<void>;
    zoomIn(input: BrowserViewTileKey): Promise<void>;
    zoomOut(input: BrowserViewTileKey): Promise<void>;
    resetZoom(input: BrowserViewTileKey): Promise<void>;
    capturePage(
      input: BrowserViewTileKey,
    ): Promise<BrowserViewCapturePageResult>;
    getDebugSnapshot(
      input: BrowserViewTileKey,
    ): Promise<BrowserViewDebugSnapshotChange>;
    clearDebugEvents(input: BrowserViewTileKey): Promise<void>;
    pickElement(
      input: BrowserViewTileKey,
    ): Promise<BrowserViewElementPickResult>;
    cancelElementPick(input: BrowserViewTileKey): Promise<void>;
    openDevTools(input: BrowserViewTileKey): Promise<void>;
    occludeForOverlay(
      input: BrowserViewOverlayOcclusion,
    ): Promise<BrowserViewOverlayOcclusionResult>;
    releaseOverlay(
      input: BrowserViewOverlayRelease,
    ): Promise<BrowserViewOverlayReleaseResult>;
    getCookieCryptoState(): Promise<BrowserCookieCryptoState>;
    setLabsState(input: BrowserLabsStateUpdate): Promise<void>;
    applyStorageState(
      input: BrowserViewStorageStateApply,
    ): Promise<BrowserViewStorageStateApplyResult>;
    captureStorageState(
      input: BrowserViewStorageStateCapture,
    ): Promise<BrowserViewStorageStateCaptureResult>;
    grantControl(
      input: BrowserViewControlGrant,
    ): Promise<BrowserViewControlGrantResult>;
    revokeControl(input: BrowserViewControlRevoke): Promise<void>;
    executeControlAction(
      input: BrowserViewControlAction,
    ): Promise<BrowserViewControlActionResult>;
    onStatusChange(handler: Listener<BrowserViewStatusChange>): Disposable;
    onFindChange(handler: Listener<BrowserViewFindChange>): Disposable;
    onDownloadChange(handler: Listener<BrowserViewDownloadChange>): Disposable;
    onCertificateError(
      handler: Listener<BrowserViewCertificateErrorChange>,
    ): Disposable;
    onOpenTileRequest(
      handler: Listener<BrowserViewOpenTileRequest>,
    ): Disposable;
    onSnapshotInvalidated(
      handler: Listener<BrowserViewSnapshotInvalidatedChange>,
    ): Disposable;
    onDebugSnapshotChange(
      handler: Listener<BrowserViewDebugSnapshotChange>,
    ): Disposable;
    onControlRevoked(
      handler: Listener<BrowserViewControlRevokedChange>,
    ): Disposable;
    // Ticket 09: borrowed-tile driving over ticket 03's typed CDP bridge.
    // Same three members the agent's own tile bridge exposes, because a
    // borrowed tile gets the same curated surface - only its lifetime
    // differs (see `browser-borrowed-tile.ts` on the host side).
    dispatchCdp(
      input: AgentBrowserViewCdpDispatch,
    ): Promise<AgentBrowserViewCdpResult>;
    onCdpSessionEnded(
      handler: Listener<AgentBrowserViewCdpSessionEndedChange>,
    ): Disposable;
    onCdpTargetAttached(
      handler: Listener<AgentBrowserViewCdpTargetAttachedChange>,
    ): Disposable;
    onCdpInteractionObserved(
      handler: Listener<AgentBrowserViewCdpInteractionObservedChange>,
    ): Disposable;
    onTileHandoff(
      handler: Listener<AgentBrowserViewTileHandoffChange>,
    ): Disposable;
  };
}

export function buildBrowserViewBridge(): BrowserViewBridgeSurface {
  return {
    browserView: {
      upsertTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewUpsert,
          input,
        ) as Promise<void>,
      updateBounds: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewUpdateBounds,
          input,
        ) as Promise<void>,
      setViewportPreset: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewSetViewportPreset,
          input,
        ) as Promise<void>,
      releaseTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewRelease,
          input,
        ) as Promise<void>,
      reloadTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewReload,
          input,
        ) as Promise<void>,
      goBack: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewGoBack,
          input,
        ) as Promise<void>,
      goForward: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewGoForward,
          input,
        ) as Promise<void>,
      findInPage: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewFindInPage,
          input,
        ) as Promise<void>,
      stopFindInPage: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewStopFindInPage,
          input,
        ) as Promise<void>,
      cancelDownload: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewCancelDownload,
          input,
        ) as Promise<void>,
      trustCertificate: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewTrustCertificate,
          input,
        ) as Promise<void>,
      zoomIn: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewZoomIn,
          input,
        ) as Promise<void>,
      zoomOut: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewZoomOut,
          input,
        ) as Promise<void>,
      resetZoom: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewResetZoom,
          input,
        ) as Promise<void>,
      capturePage: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewCapturePage,
          input,
        ) as Promise<BrowserViewCapturePageResult>,
      getDebugSnapshot: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewGetDebugSnapshot,
          input,
        ) as Promise<BrowserViewDebugSnapshotChange>,
      clearDebugEvents: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewClearDebugEvents,
          input,
        ) as Promise<void>,
      pickElement: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewPickElement,
          input,
        ) as Promise<BrowserViewElementPickResult>,
      cancelElementPick: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewCancelElementPick,
          input,
        ) as Promise<void>,
      openDevTools: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewOpenDevTools,
          input,
        ) as Promise<void>,
      occludeForOverlay: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewOccludeForOverlay,
          input,
        ) as Promise<BrowserViewOverlayOcclusionResult>,
      releaseOverlay: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewReleaseOverlay,
          input,
        ) as Promise<BrowserViewOverlayReleaseResult>,
      getCookieCryptoState: () =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewCookieCryptoStateGet,
        ) as Promise<BrowserCookieCryptoState>,
      setLabsState: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewLabsStateSet,
          input,
        ) as Promise<void>,
      applyStorageState: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewStorageStateApply,
          input,
        ) as Promise<BrowserViewStorageStateApplyResult>,
      captureStorageState: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewStorageStateCapture,
          input,
        ) as Promise<BrowserViewStorageStateCaptureResult>,
      grantControl: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewControlGrant,
          input,
        ) as Promise<BrowserViewControlGrantResult>,
      revokeControl: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewControlRevoke,
          input,
        ) as Promise<void>,
      executeControlAction: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewControlAction,
          input,
        ) as Promise<BrowserViewControlActionResult>,
      onStatusChange: (handler) =>
        subscribe<BrowserViewStatusChange>(
          RunnerHostEvent.browserViewStatusChange,
          handler,
        ),
      onFindChange: (handler) =>
        subscribe<BrowserViewFindChange>(
          RunnerHostEvent.browserViewFindChange,
          handler,
        ),
      onDownloadChange: (handler) =>
        subscribe<BrowserViewDownloadChange>(
          RunnerHostEvent.browserViewDownloadChange,
          handler,
        ),
      onCertificateError: (handler) =>
        subscribe<BrowserViewCertificateErrorChange>(
          RunnerHostEvent.browserViewCertificateError,
          handler,
        ),
      onOpenTileRequest: (handler) =>
        subscribe<BrowserViewOpenTileRequest>(
          RunnerHostEvent.browserViewOpenTileRequest,
          handler,
        ),
      onSnapshotInvalidated: (handler) =>
        subscribe<BrowserViewSnapshotInvalidatedChange>(
          RunnerHostEvent.browserViewSnapshotInvalidated,
          handler,
        ),
      onDebugSnapshotChange: (handler) =>
        subscribe<BrowserViewDebugSnapshotChange>(
          RunnerHostEvent.browserViewDebugSnapshotChange,
          handler,
        ),
      onControlRevoked: (handler) =>
        subscribe<BrowserViewControlRevokedChange>(
          RunnerHostEvent.browserViewControlRevoked,
          handler,
        ),
      dispatchCdp: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.browserViewCdpDispatch,
          input,
        ) as Promise<AgentBrowserViewCdpResult>,
      onCdpSessionEnded: (handler) =>
        subscribe<AgentBrowserViewCdpSessionEndedChange>(
          RunnerHostEvent.browserViewCdpSessionEnded,
          handler,
        ),
      onCdpTargetAttached: (handler) =>
        subscribe<AgentBrowserViewCdpTargetAttachedChange>(
          RunnerHostEvent.browserViewCdpTargetAttached,
          handler,
        ),
      onCdpInteractionObserved: (handler) =>
        subscribe<AgentBrowserViewCdpInteractionObservedChange>(
          RunnerHostEvent.browserViewCdpInteractionObserved,
          handler,
        ),
      onTileHandoff: (handler) =>
        subscribe<AgentBrowserViewTileHandoffChange>(
          RunnerHostEvent.browserViewTileHandoff,
          handler,
        ),
    },
  };
}
