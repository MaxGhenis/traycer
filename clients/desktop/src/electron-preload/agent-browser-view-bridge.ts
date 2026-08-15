import { ipcRenderer } from "electron";
import {
  RunnerHostEvent,
  RunnerHostInvoke,
} from "../ipc-contracts/ipc-channels";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
  BrowserViewBoundsUpdate,
  BrowserViewCertificateErrorChange,
  BrowserViewCertificateTrust,
  BrowserViewDownloadCancel,
  BrowserViewDownloadChange,
  BrowserViewDurableTabRegistration,
  BrowserViewFindChange,
  BrowserViewFindRequest,
  BrowserViewFindStop,
  BrowserViewOpenTileRequest,
  BrowserViewOverlayOcclusion,
  BrowserViewSnapshotInvalidatedChange,
  BrowserViewOverlayOcclusionResult,
  BrowserViewOverlayRelease,
  BrowserViewOverlayReleaseResult,
  BrowserViewStatusChange,
  BrowserViewTileKey,
  BrowserViewTileUpsert,
  BrowserViewViewportPresetChange,
} from "../ipc-contracts/browser-view-types";
import { subscribe, type Disposable, type Listener } from "./subscribe";

export interface AgentBrowserViewBridgeSurface {
  agentBrowserView: {
    upsertTile(input: BrowserViewTileUpsert): Promise<void>;
    registerDurableTab(input: BrowserViewDurableTabRegistration): Promise<void>;
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
    openDevTools(input: BrowserViewTileKey): Promise<void>;
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
    dispatchCdp(
      input: AgentBrowserViewCdpDispatch,
    ): Promise<AgentBrowserViewCdpResult>;
    occludeForOverlay(
      input: BrowserViewOverlayOcclusion,
    ): Promise<BrowserViewOverlayOcclusionResult>;
    releaseOverlay(
      input: BrowserViewOverlayRelease,
    ): Promise<BrowserViewOverlayReleaseResult>;
    onCdpSessionEnded(
      handler: Listener<AgentBrowserViewCdpSessionEndedChange>,
    ): Disposable;
    onCdpTargetAttached(
      handler: Listener<AgentBrowserViewCdpTargetAttachedChange>,
    ): Disposable;
    onTileHandoff(
      handler: Listener<AgentBrowserViewTileHandoffChange>,
    ): Disposable;
  };
}

export function buildAgentBrowserViewBridge(): AgentBrowserViewBridgeSurface {
  return {
    agentBrowserView: {
      upsertTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewUpsert,
          input,
        ) as Promise<void>,
      registerDurableTab: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewRegisterDurableTab,
          input,
        ) as Promise<void>,
      updateBounds: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewUpdateBounds,
          input,
        ) as Promise<void>,
      setViewportPreset: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewSetViewportPreset,
          input,
        ) as Promise<void>,
      releaseTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewRelease,
          input,
        ) as Promise<void>,
      reloadTile: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewReload,
          input,
        ) as Promise<void>,
      goBack: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewGoBack,
          input,
        ) as Promise<void>,
      goForward: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewGoForward,
          input,
        ) as Promise<void>,
      findInPage: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewFindInPage,
          input,
        ) as Promise<void>,
      stopFindInPage: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewStopFindInPage,
          input,
        ) as Promise<void>,
      cancelDownload: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewCancelDownload,
          input,
        ) as Promise<void>,
      trustCertificate: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewTrustCertificate,
          input,
        ) as Promise<void>,
      zoomIn: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewZoomIn,
          input,
        ) as Promise<void>,
      zoomOut: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewZoomOut,
          input,
        ) as Promise<void>,
      resetZoom: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewResetZoom,
          input,
        ) as Promise<void>,
      openDevTools: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewOpenDevTools,
          input,
        ) as Promise<void>,
      onStatusChange: (handler) =>
        subscribe<BrowserViewStatusChange>(
          RunnerHostEvent.agentBrowserViewStatusChange,
          handler,
        ),
      onFindChange: (handler) =>
        subscribe<BrowserViewFindChange>(
          RunnerHostEvent.agentBrowserViewFindChange,
          handler,
        ),
      onDownloadChange: (handler) =>
        subscribe<BrowserViewDownloadChange>(
          RunnerHostEvent.agentBrowserViewDownloadChange,
          handler,
        ),
      onCertificateError: (handler) =>
        subscribe<BrowserViewCertificateErrorChange>(
          RunnerHostEvent.agentBrowserViewCertificateError,
          handler,
        ),
      onOpenTileRequest: (handler) =>
        subscribe<BrowserViewOpenTileRequest>(
          RunnerHostEvent.agentBrowserViewOpenTileRequest,
          handler,
        ),
      onSnapshotInvalidated: (handler) =>
        subscribe<BrowserViewSnapshotInvalidatedChange>(
          RunnerHostEvent.agentBrowserViewSnapshotInvalidated,
          handler,
        ),
      dispatchCdp: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewCdpDispatch,
          input,
        ) as Promise<AgentBrowserViewCdpResult>,
      occludeForOverlay: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewOccludeForOverlay,
          input,
        ) as Promise<BrowserViewOverlayOcclusionResult>,
      releaseOverlay: (input) =>
        ipcRenderer.invoke(
          RunnerHostInvoke.agentBrowserViewReleaseOverlay,
          input,
        ) as Promise<BrowserViewOverlayReleaseResult>,
      onCdpSessionEnded: (handler) =>
        subscribe<AgentBrowserViewCdpSessionEndedChange>(
          RunnerHostEvent.agentBrowserViewCdpSessionEnded,
          handler,
        ),
      onCdpTargetAttached: (handler) =>
        subscribe<AgentBrowserViewCdpTargetAttachedChange>(
          RunnerHostEvent.agentBrowserViewCdpTargetAttached,
          handler,
        ),
      onTileHandoff: (handler) =>
        subscribe<AgentBrowserViewTileHandoffChange>(
          RunnerHostEvent.agentBrowserViewTileHandoff,
          handler,
        ),
    },
  };
}
