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

export interface DesktopAgentBrowserViewBridge {
  upsertTile(input: AgentBrowserViewTileUpsert): Promise<void>;
  updateBounds(input: BrowserViewBoundsUpdate): Promise<void>;
  releaseTile(input: BrowserViewTileKey): Promise<void>;
  onStatusChange(handler: (change: BrowserViewStatusChange) => void): {
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
