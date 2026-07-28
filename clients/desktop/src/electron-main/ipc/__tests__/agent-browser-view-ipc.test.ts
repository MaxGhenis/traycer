import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserViewManagerOptions,
  BrowserViewWebContents,
} from "../../browser-view/browser-view-manager";

/**
 * `captureStorageState`'s second argument is never read by the agent
 * manager's rejection stub - every method here throws if actually invoked,
 * so a wiring bug that starts reading it fails loudly instead of silently.
 */
function makeUnusedWebContentsStub(): BrowserViewWebContents {
  const notUsed = (): never => {
    throw new Error("not used by the agent storage-state rejection stub");
  };
  return {
    id: 1,
    debugger: {
      isAttached: notUsed,
      attach: notUsed,
      detach: notUsed,
      sendCommand: notUsed,
      on: notUsed,
      off: notUsed,
    },
    navigationHistory: undefined,
    loadURL: notUsed,
    executeJavaScript: notUsed,
    capturePage: notUsed,
    getURL: notUsed,
    getTitle: notUsed,
    isDestroyed: notUsed,
    close: notUsed,
    reload: notUsed,
    findInPage: notUsed,
    stopFindInPage: notUsed,
    getZoomFactor: notUsed,
    setZoomFactor: notUsed,
    setDevToolsWebContents: notUsed,
    openDevTools: notUsed,
    setWindowOpenHandler: notUsed,
    on: notUsed,
    off: notUsed,
  };
}

const captured = vi.hoisted(() => ({
  managerOptions: null as BrowserViewManagerOptions | null,
}));

vi.mock("electron", () => {
  class BrowserWindow {
    constructor(_options: unknown) {}
  }
  class WebContentsView {
    readonly webContents = {
      id: 1,
      once: () => undefined,
    };
    constructor(_options: unknown) {}
  }
  return {
    BrowserWindow,
    WebContentsView,
    dialog: {
      showSaveDialogSync: () => undefined,
      showMessageBoxSync: () => 0,
    },
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler: () => undefined,
        setPermissionCheckHandler: () => undefined,
        setDevicePermissionHandler: () => undefined,
        setUSBProtectedClassesHandler: () => undefined,
        setBluetoothPairingHandler: () => undefined,
        setDisplayMediaRequestHandler: () => undefined,
        on: () => undefined,
      }),
    },
    app: {
      commandLine: {
        hasSwitch: () => false,
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "unknown",
    },
  };
});

vi.mock("../../app/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  describeLogError: (err: unknown) => String(err),
}));

vi.mock("../../browser-view/browser-view-manager", () => ({
  BrowserViewManager: class {
    constructor(options: BrowserViewManagerOptions) {
      captured.managerOptions = options;
    }
    dispose(): void {}
  },
  scheduleBrowserViewDebugSnapshot: vi.fn(),
}));

vi.mock("../../browser-view/agent-browser-posture", () => ({
  applyAgentBrowserBackgroundPosture: vi.fn(),
}));

function makeBridge() {
  return {
    handleInvoke: vi.fn(),
    disposeFns: [] as Array<() => void>,
    windowRegistry: {
      getRecordById: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
    },
    safeSendToWindow: vi.fn(),
    resolveSenderWindowId: vi.fn(() => "window-1"),
  };
}

describe("registerAgentBrowserViewIpc", () => {
  beforeEach(() => {
    captured.managerOptions = null;
    vi.clearAllMocks();
  });

  it("wires popup window options to the agent partition, never the user partition", async () => {
    const { registerAgentBrowserViewIpc } =
      await import("../agent-browser-view-ipc");
    const {
      AGENT_BROWSER_VIEW_PARTITION,
      BROWSER_VIEW_PARTITION,
      BROWSER_VIEW_EPHEMERAL_PARTITION,
      createAgentBrowserViewWebPreferences,
    } = await import("../../browser-view/browser-session");

    const bridge = makeBridge();
    registerAgentBrowserViewIpc(bridge as never);

    const options = captured.managerOptions;
    if (options === null) {
      throw new Error("BrowserViewManager was not constructed");
    }

    const popupOptions = options.createPopupWindowOptions("window-1");
    const agentPrefs = createAgentBrowserViewWebPreferences();

    expect(popupOptions.webPreferences).toEqual(agentPrefs);
    expect(popupOptions.webPreferences?.partition).toBe(
      AGENT_BROWSER_VIEW_PARTITION,
    );
    expect(popupOptions.webPreferences?.partition).not.toBe(
      BROWSER_VIEW_PARTITION,
    );
    expect(popupOptions.webPreferences?.partition).not.toBe(
      BROWSER_VIEW_EPHEMERAL_PARTITION,
    );
    expect(popupOptions.webPreferences?.partition?.startsWith("persist:")).toBe(
      false,
    );
  });

  it("registers only the four agent browser invoke channels", async () => {
    const { registerAgentBrowserViewIpc } =
      await import("../agent-browser-view-ipc");
    const { RunnerHostInvoke } =
      await import("../../../ipc-contracts/ipc-channels");

    const bridge = makeBridge();
    registerAgentBrowserViewIpc(bridge as never);

    const channelNames = bridge.handleInvoke.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(channelNames).toEqual([
      RunnerHostInvoke.agentBrowserViewUpsert,
      RunnerHostInvoke.agentBrowserViewUpdateBounds,
      RunnerHostInvoke.agentBrowserViewRelease,
      // Ticket 03's typed CDP bridge. This assertion is an allowlist, not a
      // count - it exists so a new channel onto the agent's tile has to be
      // added here deliberately, which is the whole point of it being exact.
      RunnerHostInvoke.agentBrowserViewCdpDispatch,
    ]);
  });

  it("rejects storage-state apply/capture on the agent manager options", async () => {
    const { registerAgentBrowserViewIpc } =
      await import("../agent-browser-view-ipc");

    const bridge = makeBridge();
    registerAgentBrowserViewIpc(bridge as never);

    const options = captured.managerOptions;
    if (options === null) {
      throw new Error("BrowserViewManager was not constructed");
    }

    await expect(
      options.applyStorageState({
        storageState: { cookies: [], origins: [] },
      }),
    ).rejects.toThrow(/not supported on the agent browser partition/i);

    await expect(
      options.captureStorageState(
        {
          viewTabId: "v",
          paneId: "p",
          tileInstanceId: "t",
          pageSessionId: "s",
          origin: "https://example.com",
        },
        makeUnusedWebContentsStub(),
      ),
    ).rejects.toThrow(/not supported on the agent browser partition/i);
  });
});
