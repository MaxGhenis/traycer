import type { IRunnerHost } from "@traycer-clients/shared/platform/runner-host";
import type {
  BrowserViewBoundsUpdate,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "./desktop-browser-view";

export type {
  BrowserViewBoundsUpdate as AgentBrowserViewBoundsUpdate,
  BrowserViewStatusChange as AgentBrowserViewStatusChange,
  BrowserViewTileKey as AgentBrowserViewTileKey,
};

export interface AgentBrowserViewTileUpsert extends BrowserViewTileKey {
  readonly url: string;
  readonly visible: boolean;
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

export interface DesktopAgentBrowserViewBridge {
  upsertTile(input: AgentBrowserViewTileUpsert): Promise<void>;
  updateBounds(input: BrowserViewBoundsUpdate): Promise<void>;
  releaseTile(input: BrowserViewTileKey): Promise<void>;
  onStatusChange(handler: (change: BrowserViewStatusChange) => void): {
    dispose: () => void;
  };
  dispatchCdp(
    input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult>;
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
}

type AgentBrowserViewBridgeMethod = (
  this: unknown,
  ...args: unknown[]
) => unknown;
type AgentBrowserViewBridgeSource = Record<string, unknown>;
type AgentBrowserViewBridgeMethodSet = {
  readonly [
    MethodName in keyof DesktopAgentBrowserViewBridge
  ]: AgentBrowserViewBridgeMethod;
};

const REQUIRED_AGENT_BROWSER_VIEW_BRIDGE_METHODS = [
  "upsertTile",
  "updateBounds",
  "releaseTile",
  "onStatusChange",
  "dispatchCdp",
  "onCdpSessionEnded",
  "onCdpTargetAttached",
] satisfies readonly (keyof DesktopAgentBrowserViewBridge)[];

export function resolveDesktopAgentBrowserViewBridge(
  runnerHost: IRunnerHost,
): DesktopAgentBrowserViewBridge | null {
  const value = readAgentBrowserViewSource(runnerHost);
  if (value === null) return null;
  const methods = readAgentBrowserViewBridgeMethods(value);
  return {
    upsertTile: (input) => callBridgeVoid(value, methods.upsertTile, input),
    updateBounds: (input) => callBridgeVoid(value, methods.updateBounds, input),
    releaseTile: (input) => callBridgeVoid(value, methods.releaseTile, input),
    onStatusChange: (handler) =>
      readDisposable(methods.onStatusChange.call(value, handler)),
    dispatchCdp: (input) =>
      Promise.resolve(
        methods.dispatchCdp.call(value, input),
      ) as Promise<AgentBrowserViewCdpResult>,
    onCdpSessionEnded: (handler) =>
      readDisposable(methods.onCdpSessionEnded.call(value, handler)),
    onCdpTargetAttached: (handler) =>
      readDisposable(methods.onCdpTargetAttached.call(value, handler)),
  };
}

function readAgentBrowserViewSource(
  runnerHost: IRunnerHost,
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
    updateBounds: readBridgeMethod(value, "updateBounds"),
    releaseTile: readBridgeMethod(value, "releaseTile"),
    onStatusChange: readBridgeMethod(value, "onStatusChange"),
    dispatchCdp: readBridgeMethod(value, "dispatchCdp"),
    onCdpSessionEnded: readBridgeMethod(value, "onCdpSessionEnded"),
    onCdpTargetAttached: readBridgeMethod(value, "onCdpTargetAttached"),
  };
}

function hasRequiredAgentBrowserViewBridgeMethods(
  value: AgentBrowserViewBridgeSource,
): boolean {
  return REQUIRED_AGENT_BROWSER_VIEW_BRIDGE_METHODS.every((methodName) =>
    isBridgeMethod(value[methodName]),
  );
}

function readBridgeMethod(
  value: AgentBrowserViewBridgeSource,
  name: keyof DesktopAgentBrowserViewBridge,
): AgentBrowserViewBridgeMethod {
  const method = value[name];
  if (isBridgeMethod(method)) return method;
  return function missingAgentBrowserViewBridgeMethod() {
    throw new Error(
      `Desktop agent browser view bridge method ${name} is missing.`,
    );
  };
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
