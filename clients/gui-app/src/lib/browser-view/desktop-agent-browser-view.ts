import type { IRunnerHost } from "@traycer-clients/shared/platform/runner-host";
import type {
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
  BrowserViewViewportPresetChange,
  BrowserViewViewportPresetId,
} from "./desktop-browser-view";

export type {
  BrowserViewBoundsUpdate as AgentBrowserViewBoundsUpdate,
  BrowserViewDurableTabRegistration as AgentBrowserViewDurableTabRegistration,
  BrowserViewStatusChange as AgentBrowserViewStatusChange,
  BrowserViewTileKey as AgentBrowserViewTileKey,
};

export interface AgentBrowserViewTileUpsert extends BrowserViewTileKey {
  readonly url: string;
  readonly visible: boolean;
  readonly viewportPreset: BrowserViewViewportPresetId;
}

/**
 * Ticket 03's typed CDP bridge, mirrored here because gui-app and desktop are
 * separate Nx build graphs (see `BrowserViewControlActionCommand` in
 * `desktop-browser-view.ts` for the same precedent). One kind per enumerated
 * CDP method - never a generic `method: string, params: unknown` passthrough.
 */
export type AgentBrowserViewCdpCommand =
  | { readonly kind: "cdpNavigate"; readonly url: string }
  | {
      readonly kind: "cdpCaptureScreenshot";
      readonly format: "png" | "jpeg";
      readonly quality: number | null;
    }
  | { readonly kind: "cdpGetFrameTree" }
  | {
      readonly kind: "cdpCreateIsolatedWorld";
      readonly frameId: string;
      readonly worldName: string;
      readonly grantUniversalAccess: boolean;
    }
  | {
      readonly kind: "cdpEvaluate";
      readonly expression: string;
      readonly awaitPromise: boolean;
      readonly returnByValue: boolean;
      readonly contextId: number | null;
    }
  | {
      readonly kind: "cdpCallFunctionOn";
      readonly objectId: string | null;
      readonly executionContextId: number | null;
      readonly functionDeclaration: string;
      readonly argumentsJson: unknown;
      readonly returnByValue: boolean;
    }
  | { readonly kind: "cdpReleaseObject"; readonly objectId: string }
  | {
      readonly kind: "cdpDispatchMouseEvent";
      readonly type:
        "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      readonly x: number;
      readonly y: number;
      readonly button: "left" | "right" | "middle" | "none" | null;
      readonly clickCount: number | null;
      readonly deltaX: number | null;
      readonly deltaY: number | null;
    }
  | { readonly kind: "cdpInsertText"; readonly text: string }
  | {
      readonly kind: "cdpDispatchKeyEvent";
      readonly type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
      readonly key: string | null;
      readonly code: string | null;
      readonly text: string | null;
      readonly modifiers: number | null;
      readonly unmodifiedText: string | null;
      readonly windowsVirtualKeyCode: number | null;
      readonly location: number | null;
      readonly isKeypad: boolean | null;
      readonly autoRepeat: boolean | null;
      readonly commands: readonly string[] | null;
    }
  | {
      readonly kind: "cdpSetDeviceMetricsOverride";
      readonly width: number;
      readonly height: number;
      readonly deviceScaleFactor: number;
      readonly mobile: boolean;
    }
  | {
      readonly kind: "cdpSetAutoAttach";
      readonly autoAttach: boolean;
      readonly waitForDebuggerOnStart: boolean;
    }
  | {
      readonly kind: "cdpDescribeNode";
      readonly objectId: string;
      readonly depth: number | null;
      readonly pierce: boolean;
    }
  | {
      readonly kind: "cdpGetFullAXTree";
      readonly depth: number | null;
    };

export interface AgentBrowserViewCdpDispatch extends BrowserViewTileKey {
  readonly sessionId: string | null;
  readonly command: AgentBrowserViewCdpCommand;
}

export interface AgentBrowserViewCdpFrameInfo {
  readonly frameId: string;
  readonly parentFrameId: string | null;
  readonly url: string;
  readonly securityOrigin: string | null;
}

export interface AgentBrowserViewCdpErrorInfo {
  readonly kind: "not_attached" | "tile_not_found" | "cdp_error";
  readonly message: string;
  readonly code: number | null;
}

export type AgentBrowserViewCdpResult =
  | {
      readonly kind: "cdpNavigate";
      readonly ok: true;
      readonly frameId: string | null;
      readonly loaderId: string | null;
      readonly errorText: string | null;
    }
  | {
      readonly kind: "cdpCaptureScreenshot";
      readonly ok: true;
      readonly dataBase64: string;
    }
  | {
      readonly kind: "cdpGetFrameTree";
      readonly ok: true;
      readonly frames: readonly AgentBrowserViewCdpFrameInfo[];
    }
  | {
      readonly kind: "cdpCreateIsolatedWorld";
      readonly ok: true;
      readonly executionContextId: number | null;
    }
  | {
      readonly kind: "cdpEvaluate";
      readonly ok: true;
      readonly resultJson: unknown;
      readonly objectId: string | null;
      readonly exceptionDescription: string | null;
    }
  | {
      readonly kind: "cdpCallFunctionOn";
      readonly ok: true;
      readonly resultJson: unknown;
      readonly objectId: string | null;
      readonly exceptionDescription: string | null;
    }
  | { readonly kind: "cdpReleaseObject"; readonly ok: true }
  | { readonly kind: "cdpDispatchMouseEvent"; readonly ok: true }
  | { readonly kind: "cdpInsertText"; readonly ok: true }
  | { readonly kind: "cdpDispatchKeyEvent"; readonly ok: true }
  | { readonly kind: "cdpSetDeviceMetricsOverride"; readonly ok: true }
  | { readonly kind: "cdpSetAutoAttach"; readonly ok: true }
  | {
      readonly kind: "cdpDescribeNode";
      readonly ok: true;
      readonly nodeId: number | null;
      readonly backendNodeId: number | null;
      readonly nodeName: string | null;
      readonly frameId: string | null;
    }
  | {
      readonly kind: "cdpGetFullAXTree";
      readonly ok: true;
      readonly nodesJson: unknown;
    }
  | {
      readonly kind: AgentBrowserViewCdpCommand["kind"];
      readonly ok: false;
      readonly error: AgentBrowserViewCdpErrorInfo;
    };

export interface AgentBrowserViewCdpSessionEndedChange extends BrowserViewTileKey {
  readonly reason: string;
}

export interface AgentBrowserViewCdpTargetAttachedChange extends BrowserViewTileKey {
  readonly sessionId: string;
  readonly targetId: string;
  readonly targetType: string;
  readonly url: string;
  readonly waitingForDebugger: boolean;
}

export interface AgentBrowserViewTileHandoffSiblingTab {
  readonly tabId: string;
  readonly url: string;
  readonly capturedStorageState: unknown;
}

export interface AgentBrowserViewTileHandoffChange extends BrowserViewTileKey {
  readonly capturedUrl: string;
  readonly capturedStorageState: unknown;
  readonly siblingTabs: readonly AgentBrowserViewTileHandoffSiblingTab[];
  readonly reason: "gui-quit" | "tile-released" | "crash-no-capture";
}

export interface DesktopAgentBrowserViewBridge {
  upsertTile(input: AgentBrowserViewTileUpsert): Promise<void>;
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
  onStatusChange(handler: (change: BrowserViewStatusChange) => void): {
    dispose: () => void;
  };
  onFindChange(handler: (change: BrowserViewFindChange) => void): {
    dispose: () => void;
  };
  onDownloadChange(handler: (change: BrowserViewDownloadChange) => void): {
    dispose: () => void;
  };
  onCertificateError(
    handler: (change: BrowserViewCertificateErrorChange) => void,
  ): {
    dispose: () => void;
  };
  onOpenTileRequest(handler: (change: BrowserViewOpenTileRequest) => void): {
    dispose: () => void;
  };
  onSnapshotInvalidated(
    handler: (change: BrowserViewSnapshotInvalidatedChange) => void,
  ): {
    dispose: () => void;
  };
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
    handler: (change: AgentBrowserViewCdpSessionEndedChange) => void,
  ): {
    dispose: () => void;
  };
  onCdpTargetAttached(
    handler: (change: AgentBrowserViewCdpTargetAttachedChange) => void,
  ): {
    dispose: () => void;
  };
  onTileHandoff(handler: (change: AgentBrowserViewTileHandoffChange) => void): {
    dispose: () => void;
  };
}

type AgentBrowserViewBridgeMethod = (
  this: unknown,
  ...args: unknown[]
) => unknown;
type AgentBrowserViewBridgeSource = Record<string, unknown>;
type AgentBrowserViewRequiredMethod =
  (typeof REQUIRED_AGENT_BROWSER_VIEW_BRIDGE_METHODS)[number];
type AgentBrowserViewOptionalMethod =
  (typeof OPTIONAL_AGENT_BROWSER_VIEW_BRIDGE_METHODS)[number];
type AgentBrowserViewBridgeMethodSet = {
  readonly [MethodName in AgentBrowserViewRequiredMethod]: AgentBrowserViewBridgeMethod;
} & {
  readonly [MethodName in AgentBrowserViewOptionalMethod]:
    | AgentBrowserViewBridgeMethod
    | undefined;
};

/**
 * Strict preload gate: only the pre-chrome agent surface. A renderer newer
 * than its preload (desktop hot-reload) must still resolve a working
 * lifecycle/CDP/occlusion bridge. Every chrome method added in the
 * unification work degrades independently.
 */
export const REQUIRED_AGENT_BROWSER_VIEW_BRIDGE_METHODS = [
  "upsertTile",
  "registerDurableTab",
  "updateBounds",
  "releaseTile",
  "onStatusChange",
  "onOpenTileRequest",
  "dispatchCdp",
  "occludeForOverlay",
  "releaseOverlay",
  "onCdpSessionEnded",
  "onCdpTargetAttached",
  "onTileHandoff",
] as const satisfies readonly (keyof DesktopAgentBrowserViewBridge)[];

export const OPTIONAL_AGENT_BROWSER_VIEW_BRIDGE_METHODS = [
  "setViewportPreset",
  "reloadTile",
  "goBack",
  "goForward",
  "findInPage",
  "stopFindInPage",
  "cancelDownload",
  "trustCertificate",
  "zoomIn",
  "zoomOut",
  "resetZoom",
  "openDevTools",
  "onFindChange",
  "onDownloadChange",
  "onCertificateError",
  "onSnapshotInvalidated",
] as const satisfies readonly (keyof DesktopAgentBrowserViewBridge)[];

export interface AgentBrowserViewOptionalSurface {
  readonly setViewportPreset: boolean;
  readonly reloadTile: boolean;
  readonly goBack: boolean;
  readonly goForward: boolean;
  readonly findInPage: boolean;
  readonly stopFindInPage: boolean;
  readonly cancelDownload: boolean;
  readonly trustCertificate: boolean;
  readonly zoomIn: boolean;
  readonly zoomOut: boolean;
  readonly resetZoom: boolean;
  readonly openDevTools: boolean;
  readonly onFindChange: boolean;
  readonly onDownloadChange: boolean;
  readonly onCertificateError: boolean;
  readonly onSnapshotInvalidated: boolean;
}

export function resolveDesktopAgentBrowserViewBridge(
  runnerHost: IRunnerHost | object,
): DesktopAgentBrowserViewBridge | null {
  const value = readAgentBrowserViewSource(runnerHost);
  if (value === null) return null;
  const methods = readAgentBrowserViewBridgeMethods(value);
  return {
    upsertTile: (input) => callBridgeVoid(value, methods.upsertTile, input),
    registerDurableTab: (input) =>
      callBridgeVoid(value, methods.registerDurableTab, input),
    updateBounds: (input) => callBridgeVoid(value, methods.updateBounds, input),
    setViewportPreset: (input) =>
      callOptionalBridgeVoid(value, methods.setViewportPreset, input),
    releaseTile: (input) => callBridgeVoid(value, methods.releaseTile, input),
    reloadTile: (input) =>
      callOptionalBridgeVoid(value, methods.reloadTile, input),
    goBack: (input) => callOptionalBridgeVoid(value, methods.goBack, input),
    goForward: (input) =>
      callOptionalBridgeVoid(value, methods.goForward, input),
    findInPage: (input) =>
      callOptionalBridgeVoid(value, methods.findInPage, input),
    stopFindInPage: (input) =>
      callOptionalBridgeVoid(value, methods.stopFindInPage, input),
    cancelDownload: (input) =>
      callOptionalBridgeVoid(value, methods.cancelDownload, input),
    trustCertificate: (input) =>
      callOptionalBridgeVoid(value, methods.trustCertificate, input),
    zoomIn: (input) => callOptionalBridgeVoid(value, methods.zoomIn, input),
    zoomOut: (input) => callOptionalBridgeVoid(value, methods.zoomOut, input),
    resetZoom: (input) =>
      callOptionalBridgeVoid(value, methods.resetZoom, input),
    openDevTools: (input) =>
      callOptionalBridgeVoid(value, methods.openDevTools, input),
    onStatusChange: (handler) =>
      readDisposable(methods.onStatusChange.call(value, handler)),
    onFindChange: (handler) =>
      readOptionalDisposable(value, methods.onFindChange, handler),
    onDownloadChange: (handler) =>
      readOptionalDisposable(value, methods.onDownloadChange, handler),
    onCertificateError: (handler) =>
      readOptionalDisposable(value, methods.onCertificateError, handler),
    onOpenTileRequest: (handler) =>
      readDisposable(methods.onOpenTileRequest.call(value, handler)),
    onSnapshotInvalidated: (handler) =>
      readOptionalDisposable(value, methods.onSnapshotInvalidated, handler),
    dispatchCdp: (input) =>
      Promise.resolve(
        methods.dispatchCdp.call(value, input),
      ) as Promise<AgentBrowserViewCdpResult>,
    occludeForOverlay: (input) =>
      Promise.resolve(
        methods.occludeForOverlay.call(value, input),
      ) as Promise<BrowserViewOverlayOcclusionResult>,
    releaseOverlay: (input) =>
      Promise.resolve(
        methods.releaseOverlay.call(value, input),
      ) as Promise<BrowserViewOverlayReleaseResult>,
    onCdpSessionEnded: (handler) =>
      readDisposable(methods.onCdpSessionEnded.call(value, handler)),
    onCdpTargetAttached: (handler) =>
      readDisposable(methods.onCdpTargetAttached.call(value, handler)),
    onTileHandoff: (handler) =>
      readDisposable(methods.onTileHandoff.call(value, handler)),
  };
}

function readAgentBrowserViewSource(
  runnerHost: IRunnerHost | object,
): AgentBrowserViewBridgeSource | null {
  if (!isRecord(runnerHost)) return null;
  const value = runnerHost.agentBrowserView;
  if (!isRecord(value)) return null;
  if (!hasRequiredAgentBrowserViewBridgeMethods(value)) return null;
  return value;
}

function readAgentBrowserViewBridgeMethods(
  value: AgentBrowserViewBridgeSource,
): AgentBrowserViewBridgeMethodSet {
  return {
    upsertTile: readBridgeMethod(value, "upsertTile"),
    registerDurableTab: readBridgeMethod(value, "registerDurableTab"),
    updateBounds: readBridgeMethod(value, "updateBounds"),
    setViewportPreset: readOptionalBridgeMethod(value, "setViewportPreset"),
    releaseTile: readBridgeMethod(value, "releaseTile"),
    reloadTile: readOptionalBridgeMethod(value, "reloadTile"),
    goBack: readOptionalBridgeMethod(value, "goBack"),
    goForward: readOptionalBridgeMethod(value, "goForward"),
    findInPage: readOptionalBridgeMethod(value, "findInPage"),
    stopFindInPage: readOptionalBridgeMethod(value, "stopFindInPage"),
    cancelDownload: readOptionalBridgeMethod(value, "cancelDownload"),
    trustCertificate: readOptionalBridgeMethod(value, "trustCertificate"),
    zoomIn: readOptionalBridgeMethod(value, "zoomIn"),
    zoomOut: readOptionalBridgeMethod(value, "zoomOut"),
    resetZoom: readOptionalBridgeMethod(value, "resetZoom"),
    openDevTools: readOptionalBridgeMethod(value, "openDevTools"),
    onStatusChange: readBridgeMethod(value, "onStatusChange"),
    onFindChange: readOptionalBridgeMethod(value, "onFindChange"),
    onDownloadChange: readOptionalBridgeMethod(value, "onDownloadChange"),
    onCertificateError: readOptionalBridgeMethod(value, "onCertificateError"),
    onOpenTileRequest: readBridgeMethod(value, "onOpenTileRequest"),
    onSnapshotInvalidated: readOptionalBridgeMethod(
      value,
      "onSnapshotInvalidated",
    ),
    dispatchCdp: readBridgeMethod(value, "dispatchCdp"),
    occludeForOverlay: readBridgeMethod(value, "occludeForOverlay"),
    releaseOverlay: readBridgeMethod(value, "releaseOverlay"),
    onCdpSessionEnded: readBridgeMethod(value, "onCdpSessionEnded"),
    onCdpTargetAttached: readBridgeMethod(value, "onCdpTargetAttached"),
    onTileHandoff: readBridgeMethod(value, "onTileHandoff"),
  };
}

function hasRequiredAgentBrowserViewBridgeMethods(
  value: AgentBrowserViewBridgeSource,
): boolean {
  return REQUIRED_AGENT_BROWSER_VIEW_BRIDGE_METHODS.every((methodName) =>
    isBridgeMethod(value[methodName]),
  );
}

export function probeAgentBrowserViewOptionalSurface(
  runnerHost: IRunnerHost | object,
): AgentBrowserViewOptionalSurface | null {
  const value = readAgentBrowserViewSource(runnerHost);
  if (value === null) return null;
  return {
    setViewportPreset: isBridgeMethod(value.setViewportPreset),
    reloadTile: isBridgeMethod(value.reloadTile),
    goBack: isBridgeMethod(value.goBack),
    goForward: isBridgeMethod(value.goForward),
    findInPage: isBridgeMethod(value.findInPage),
    stopFindInPage: isBridgeMethod(value.stopFindInPage),
    cancelDownload: isBridgeMethod(value.cancelDownload),
    trustCertificate: isBridgeMethod(value.trustCertificate),
    zoomIn: isBridgeMethod(value.zoomIn),
    zoomOut: isBridgeMethod(value.zoomOut),
    resetZoom: isBridgeMethod(value.resetZoom),
    openDevTools: isBridgeMethod(value.openDevTools),
    onFindChange: isBridgeMethod(value.onFindChange),
    onDownloadChange: isBridgeMethod(value.onDownloadChange),
    onCertificateError: isBridgeMethod(value.onCertificateError),
    onSnapshotInvalidated: isBridgeMethod(value.onSnapshotInvalidated),
  };
}

function readBridgeMethod(
  value: AgentBrowserViewBridgeSource,
  name: AgentBrowserViewRequiredMethod,
): AgentBrowserViewBridgeMethod {
  const method = value[name];
  if (isBridgeMethod(method)) return method;
  return function missingAgentBrowserViewBridgeMethod() {
    throw new Error(
      `Desktop agent browser view bridge method ${name} is missing.`,
    );
  };
}

function readOptionalBridgeMethod(
  value: AgentBrowserViewBridgeSource,
  name: AgentBrowserViewOptionalMethod,
): AgentBrowserViewBridgeMethod | undefined {
  const method = value[name];
  if (isBridgeMethod(method)) return method;
  return undefined;
}

function callOptionalBridgeVoid(
  value: AgentBrowserViewBridgeSource,
  method: AgentBrowserViewBridgeMethod | undefined,
  input: unknown,
): Promise<void> {
  if (method === undefined) {
    return Promise.reject(
      new Error("Desktop agent browser view chrome method is unavailable."),
    );
  }
  return callBridgeVoid(value, method, input);
}

function readOptionalDisposable(
  value: AgentBrowserViewBridgeSource,
  method: AgentBrowserViewBridgeMethod | undefined,
  handler: unknown,
): { dispose: () => void } {
  if (method === undefined) return { dispose: () => undefined };
  return readDisposable(method.call(value, handler));
}

function isBridgeMethod(value: unknown): value is AgentBrowserViewBridgeMethod {
  return typeof value === "function";
}

function callBridgeVoid(
  value: AgentBrowserViewBridgeSource,
  method: AgentBrowserViewBridgeMethod,
  input: unknown,
): Promise<void> {
  return Promise.resolve(method.call(value, input)).then(() => undefined);
}

function readDisposable(value: unknown): { dispose: () => void } {
  if (isRecord(value)) {
    const dispose = value.dispose;
    if (typeof dispose === "function") {
      return {
        dispose: () => {
          dispose.call(value);
        },
      };
    }
  }
  return { dispose: () => undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
