import {
  BrowserWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
} from "electron";
import {
  RunnerHostEvent,
  RunnerHostInvoke,
} from "../../ipc-contracts/ipc-channels";
import type {
  BrowserViewBounds,
  BrowserViewBoundsUpdate,
  BrowserViewTileKey,
  BrowserViewTileUpsert,
} from "../../ipc-contracts/browser-view-types";
import {
  BrowserViewManager,
  scheduleBrowserViewDebugSnapshot,
  type BrowserViewWindow,
  type ManagedBrowserView,
  type ManagedContentView,
} from "../browser-view/browser-view-manager";
import {
  createAgentBrowserViewWebPreferences,
  ensureAgentBrowserViewSession,
  onBrowserViewCertificateError,
  onBrowserViewDownloadChange,
  registerBrowserViewWebContents,
} from "../browser-view/browser-session";
import { applyAgentBrowserBackgroundPosture } from "../browser-view/agent-browser-posture";
import { log } from "../app/logger";
import type { RunnerIpcBridge } from "./runner-ipc-bridge";

const AGENT_BROWSER_VIEW_RELEASE_GRACE_MS = 500;

/**
 * IPC surface for the agent's own browser tile (ticket 02). This deliberately
 * mirrors only the subset of `registerBrowserViewIpc` needed to create,
 * position, show and release a tile in `AGENT_BROWSER_VIEW_PARTITION` -
 * driving (control grant/action), storage-state lending, find, zoom and
 * devtools belong to later tickets (03+) that build the agent's actual
 * REPL-driven surface, so they are not wired here. Popups are still routed
 * through the agent partition (never the user's) since that is a
 * containment property, not a driving feature.
 */
export function registerAgentBrowserViewIpc(bridge: RunnerIpcBridge): void {
  const manager = new BrowserViewManager({
    createView: createAgentBrowserView,
    getWindow: (windowId) =>
      toBrowserViewWindow(
        bridge.windowRegistry.getRecordById(windowId)?.window,
      ),
    createPopupWindowOptions: (windowId) =>
      createAgentBrowserPopupWindowOptions(bridge, windowId),
    createDevToolsWindow: (windowId) => createDevToolsWindow(bridge, windowId),
    registerPopupWebContents: (webContents) => {
      registerBrowserViewWebContents(webContents);
    },
    onDownloadChange: onBrowserViewDownloadChange,
    onCertificateError: onBrowserViewCertificateError,
    onWindowChange: (listener) => {
      bridge.windowRegistry.on("change", listener);
      return () => {
        bridge.windowRegistry.off("change", listener);
      };
    },
    notifyStatus: (windowId, change) => {
      bridge.safeSendToWindow(
        windowId,
        RunnerHostEvent.agentBrowserViewStatusChange,
        change,
      );
    },
    notifyFind: () => {},
    notifyDownload: () => {},
    notifyCertificateError: () => {},
    notifyOpenTileRequest: (windowId, change) => {
      // Not surfaced to the GUI yet: a page in the agent's browser opening a
      // target=_blank / window.open tab is swallowed rather than followed.
      // Containment still holds either way (see createAgentBrowserPopupWindowOptions
      // for the real-popup case) - this only means such links currently do
      // nothing visible instead of opening a second agent-owned tile.
      log.info("[agent-browser-view] open-tile request dropped (not wired)", {
        windowId,
        url: change.url,
      });
    },
    notifySnapshotInvalidated: () => {},
    notifyDebugSnapshot: () => {},
    notifyControlRevoked: () => {},
    scheduleDebugSnapshot: scheduleBrowserViewDebugSnapshot,
    applyStorageState: () =>
      Promise.reject(
        new Error(
          "Storage-state lending is not supported on the agent browser partition",
        ),
      ),
    captureStorageState: () =>
      Promise.reject(
        new Error(
          "Storage-state capture is not supported on the agent browser partition",
        ),
      ),
    releaseGraceMs: AGENT_BROWSER_VIEW_RELEASE_GRACE_MS,
  });

  bridge.handleInvoke(
    RunnerHostInvoke.agentBrowserViewUpsert,
    (event, payload) => {
      const windowId = readSenderWindowId(bridge, event);
      manager.upsertTile(windowId, parseTileUpsert(payload));
    },
  );

  bridge.handleInvoke(
    RunnerHostInvoke.agentBrowserViewUpdateBounds,
    (event, payload) => {
      const windowId = readSenderWindowId(bridge, event);
      manager.updateBounds(windowId, parseBoundsUpdate(payload));
    },
  );

  bridge.handleInvoke(
    RunnerHostInvoke.agentBrowserViewRelease,
    (event, payload) => {
      const windowId = readSenderWindowId(bridge, event);
      manager.releaseTile(windowId, parseTileKey(payload));
    },
  );

  bridge.disposeFns.push(() => {
    manager.dispose();
  });
}

function createAgentBrowserView(): ManagedBrowserView {
  // Same non-trusted-IPC-sender posture as the user's browser view: no
  // preload / Node integration, mediated entirely through this file's
  // handlers.
  ensureAgentBrowserViewSession();
  const view = new WebContentsView({
    webPreferences: createAgentBrowserViewWebPreferences(),
  });
  registerBrowserViewWebContents(view.webContents);
  applyAgentBrowserBackgroundPosture(view.webContents);
  return view;
}

function createAgentBrowserPopupWindowOptions(
  bridge: RunnerIpcBridge,
  windowId: string,
): BrowserWindowConstructorOptions {
  const parentWindow = bridge.windowRegistry.getRecordById(windowId)?.window;
  return {
    parent: isElectronBrowserWindow(parentWindow) ? parentWindow : undefined,
    show: true,
    width: 900,
    height: 700,
    backgroundColor: "#0b0b0d",
    // Popups opened from a page in the agent's browser must stay in the
    // agent partition - reusing the user's popup options here would be
    // exactly the "second route around" the partition boundary the ticket
    // warns against.
    webPreferences: createAgentBrowserViewWebPreferences(),
  };
}

function createDevToolsWindow(
  bridge: RunnerIpcBridge,
  windowId: string,
): BrowserWindow {
  const parentWindow = bridge.windowRegistry.getRecordById(windowId)?.window;
  return new BrowserWindow({
    parent: isElectronBrowserWindow(parentWindow) ? parentWindow : undefined,
    show: true,
    width: 1200,
    height: 800,
    backgroundColor: "#0b0b0d",
  });
}

function isElectronBrowserWindow(value: unknown): value is BrowserWindow {
  if (typeof BrowserWindow !== "function") return false;
  return value instanceof BrowserWindow;
}

function readSenderWindowId(
  bridge: RunnerIpcBridge,
  event: IpcMainInvokeEvent,
): string {
  const windowId = bridge.resolveSenderWindowId(event);
  if (windowId === null) {
    throw new Error("Agent browser view IPC sender window is not registered");
  }
  return windowId;
}

function parseTileUpsert(value: unknown): BrowserViewTileUpsert {
  const record = assertRecord(value, "Agent browser view upsert payload");
  return {
    ...parseTileKey(record),
    url: readString(record.url, "url"),
    visible: readBoolean(record.visible, "visible"),
    // Viewport presets (mobile/tablet/desktop chrome) are a driving/chrome
    // concern out of scope for ticket 02 - the agent tile always fills its
    // tile at "responsive".
    viewportPreset: "responsive",
  };
}

function parseBoundsUpdate(value: unknown): BrowserViewBoundsUpdate {
  const record = assertRecord(value, "Agent browser view bounds payload");
  return {
    ...parseTileKey(record),
    bounds: parseBounds(record.bounds),
  };
}

function parseTileKey(value: unknown): BrowserViewTileKey {
  const record = assertRecord(value, "Agent browser view tile key");
  return {
    viewTabId: readString(record.viewTabId, "viewTabId"),
    paneId: readString(record.paneId, "paneId"),
    tileInstanceId: readString(record.tileInstanceId, "tileInstanceId"),
    pageSessionId: readString(record.pageSessionId, "pageSessionId"),
  };
}

function parseBounds(value: unknown): BrowserViewBounds {
  const record = assertRecord(value, "Agent browser view bounds");
  return {
    x: readFiniteNumber(record.x, "x"),
    y: readFiniteNumber(record.y, "y"),
    width: readFiniteNumber(record.width, "width"),
    height: readFiniteNumber(record.height, "height"),
  };
}

function toBrowserViewWindow(value: unknown): BrowserViewWindow | null {
  if (!isRecord(value)) return null;
  const contentView = Reflect.get(value, "contentView");
  if (!isContentView(contentView)) return null;
  const isDestroyed = Reflect.get(value, "isDestroyed");
  const isVisible = Reflect.get(value, "isVisible");
  const isMinimized = Reflect.get(value, "isMinimized");
  if (typeof isDestroyed !== "function" || typeof isVisible !== "function") {
    return null;
  }
  return {
    contentView,
    isDestroyed: () => Boolean(isDestroyed.call(value)),
    isVisible: () => Boolean(isVisible.call(value)),
    isMinimized: () =>
      typeof isMinimized === "function" && Boolean(isMinimized.call(value)),
  };
}

function isContentView(value: unknown): value is ManagedContentView {
  if (!isRecord(value)) return false;
  return (
    typeof Reflect.get(value, "addChildView") === "function" &&
    typeof Reflect.get(value, "removeChildView") === "function"
  );
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`${label} must be an object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  throw new Error(`Agent browser view ${field} must be a string`);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`Agent browser view ${field} must be a boolean`);
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`Agent browser view ${field} must be a finite number`);
}
