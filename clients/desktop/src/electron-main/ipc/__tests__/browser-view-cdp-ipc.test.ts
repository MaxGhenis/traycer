import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentBrowserViewCdpCommand,
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  BrowserViewBackgroundTabCreate,
} from "../../../ipc-contracts/browser-view-types";
import type { BrowserViewManagerOptions } from "../../browser-view/browser-view-manager";
import { parseBrowserViewCdpCommand } from "../browser-view-cdp-payload";

type DispatchCdpCall = {
  readonly windowId: string;
  readonly input: AgentBrowserViewCdpDispatch;
};

type BackgroundTabCreateCall = {
  readonly windowId: string;
  readonly input: BrowserViewBackgroundTabCreate;
};

type InvokeHandler = (
  event: unknown,
  payload: unknown,
) => unknown | Promise<unknown>;

const captured = vi.hoisted(() => ({
  managerOptions: null as BrowserViewManagerOptions | null,
  dispatchCdpCalls: [] as DispatchCdpCall[],
  backgroundTabCreates: [] as BackgroundTabCreateCall[],
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

vi.mock("../../app/browser-labs-state", () => ({
  setInAppBrowserBetaEnabledMarker: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../app/cert-trust", () => ({
  trustBrowserCertificate: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../browser-view/browser-view-manager", () => ({
  BrowserViewManager: class {
    constructor(options: BrowserViewManagerOptions) {
      captured.managerOptions = options;
    }

    dispatchCdp(
      windowId: string,
      input: AgentBrowserViewCdpDispatch,
    ): Promise<{
      readonly kind: "cdpGetFrameTree";
      readonly ok: true;
      readonly frames: [];
    }> {
      captured.dispatchCdpCalls.push({ windowId, input });
      return Promise.resolve({
        kind: "cdpGetFrameTree",
        ok: true,
        frames: [],
      });
    }

    createBackgroundTab(
      windowId: string,
      input: BrowserViewBackgroundTabCreate,
    ): Promise<void> {
      captured.backgroundTabCreates.push({ windowId, input });
      return Promise.resolve();
    }

    dispose(): void {}
  },
  scheduleBrowserViewDebugSnapshot: vi.fn(),
}));

vi.mock("../../browser-view/browser-session", () => ({
  createBrowserViewWebPreferences: vi.fn(() => ({})),
  cancelBrowserViewDownload: vi.fn(),
  clearBrowserViewPendingCertificateError: vi.fn(),
  ensureBrowserViewSession: vi.fn(),
  onBrowserViewCertificateError: vi.fn(),
  onBrowserViewDownloadChange: vi.fn(),
  readBrowserViewPendingCertificateError: vi.fn(() => null),
  registerBrowserViewWebContents: vi.fn(),
}));

vi.mock("../../browser-view/browser-cookie-crypto", () => ({
  getBrowserCookieCryptoState: vi.fn(() =>
    Promise.resolve({
      mode: "real",
      persistence: "persistent",
      reason: "os-backed",
      storageBackend: null,
      encryptionAvailable: true,
      mockKeychainEnabled: false,
    }),
  ),
}));

vi.mock("../../browser-view/browser-storage-state", () => ({
  captureBrowserOriginLocalStorage: vi.fn(() => Promise.resolve(null)),
  captureBrowserPrimaryProfile: vi.fn(() =>
    Promise.resolve({
      status: "captured",
      storageState: { cookies: [], origins: [] },
      reason: null,
    }),
  ),
  applyBrowserViewStorageState: vi.fn(() =>
    Promise.resolve({
      status: "applied",
      cookieCount: 0,
      localStorageApplied: false,
      reason: "cookies-only",
    }),
  ),
  captureBrowserViewStorageState: vi.fn(() =>
    Promise.resolve({
      storageState: { cookies: [], origins: [] },
      cookieCount: 0,
      cookieDomains: [],
      localStorageCount: 0,
      localStorageAvailable: true,
      localStorageReason: null,
    }),
  ),
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

function findInvokeHandler(
  bridge: {
    readonly handleInvoke: {
      readonly mock: {
        readonly calls: ReadonlyArray<ReadonlyArray<unknown>>;
      };
    };
  },
  channel: string,
): InvokeHandler {
  const match = bridge.handleInvoke.mock.calls.find(
    (call) => call[0] === channel,
  );
  if (match === undefined) {
    throw new Error(`No invoke handler registered for ${channel}`);
  }
  const handler = match[1];
  if (typeof handler !== "function") {
    throw new Error(`Invoke handler for ${channel} is not a function`);
  }
  return handler as InvokeHandler;
}

const VALID_COMMAND_PAYLOADS: ReadonlyArray<{
  readonly name: string;
  readonly payload: Record<string, unknown>;
  readonly expected: AgentBrowserViewCdpCommand;
}> = [
  {
    name: "cdpNavigate",
    payload: { kind: "cdpNavigate", url: "https://example.com/path" },
    expected: { kind: "cdpNavigate", url: "https://example.com/path" },
  },
  {
    name: "cdpCaptureScreenshot",
    payload: {
      kind: "cdpCaptureScreenshot",
      format: "jpeg",
      quality: 80,
    },
    expected: {
      kind: "cdpCaptureScreenshot",
      format: "jpeg",
      quality: 80,
    },
  },
  {
    name: "cdpGetFrameTree",
    payload: { kind: "cdpGetFrameTree" },
    expected: { kind: "cdpGetFrameTree" },
  },
  {
    name: "cdpCreateIsolatedWorld",
    payload: {
      kind: "cdpCreateIsolatedWorld",
      frameId: "frame-1",
      worldName: "agent-world",
      grantUniversalAccess: true,
    },
    expected: {
      kind: "cdpCreateIsolatedWorld",
      frameId: "frame-1",
      worldName: "agent-world",
      grantUniversalAccess: true,
    },
  },
  {
    name: "cdpEvaluate",
    payload: {
      kind: "cdpEvaluate",
      expression: "1 + 1",
      awaitPromise: true,
      returnByValue: false,
      contextId: 7,
    },
    expected: {
      kind: "cdpEvaluate",
      expression: "1 + 1",
      awaitPromise: true,
      returnByValue: false,
      contextId: 7,
    },
  },
  {
    name: "cdpCallFunctionOn",
    payload: {
      kind: "cdpCallFunctionOn",
      objectId: "obj-1",
      executionContextId: null,
      functionDeclaration: "function() { return 1; }",
      argumentsJson: [{ value: 1 }],
      returnByValue: true,
    },
    expected: {
      kind: "cdpCallFunctionOn",
      objectId: "obj-1",
      executionContextId: null,
      functionDeclaration: "function() { return 1; }",
      argumentsJson: [{ value: 1 }],
      returnByValue: true,
    },
  },
  {
    name: "cdpReleaseObject",
    payload: { kind: "cdpReleaseObject", objectId: "obj-2" },
    expected: { kind: "cdpReleaseObject", objectId: "obj-2" },
  },
  {
    name: "cdpDispatchMouseEvent",
    payload: {
      kind: "cdpDispatchMouseEvent",
      type: "mousePressed",
      x: 10,
      y: 20,
      button: "left",
      clickCount: 1,
      deltaX: null,
      deltaY: null,
    },
    expected: {
      kind: "cdpDispatchMouseEvent",
      type: "mousePressed",
      x: 10,
      y: 20,
      button: "left",
      clickCount: 1,
      deltaX: null,
      deltaY: null,
    },
  },
  {
    name: "cdpInsertText",
    payload: { kind: "cdpInsertText", text: "hello" },
    expected: { kind: "cdpInsertText", text: "hello" },
  },
  {
    name: "cdpDispatchKeyEvent",
    payload: {
      kind: "cdpDispatchKeyEvent",
      type: "keyDown",
      key: "a",
      code: "KeyA",
      text: "a",
    },
    expected: {
      kind: "cdpDispatchKeyEvent",
      type: "keyDown",
      key: "a",
      code: "KeyA",
      text: "a",
    },
  },
  {
    name: "cdpSetDeviceMetricsOverride",
    payload: {
      kind: "cdpSetDeviceMetricsOverride",
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    },
    expected: {
      kind: "cdpSetDeviceMetricsOverride",
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    },
  },
  {
    name: "cdpSetAutoAttach",
    payload: {
      kind: "cdpSetAutoAttach",
      autoAttach: true,
      waitForDebuggerOnStart: false,
    },
    expected: {
      kind: "cdpSetAutoAttach",
      autoAttach: true,
      waitForDebuggerOnStart: false,
    },
  },
  {
    name: "cdpDescribeNode",
    payload: {
      kind: "cdpDescribeNode",
      objectId: "obj-3",
      depth: 1,
      pierce: true,
    },
    expected: {
      kind: "cdpDescribeNode",
      objectId: "obj-3",
      depth: 1,
      pierce: true,
    },
  },
  {
    name: "cdpGetFullAXTree",
    payload: { kind: "cdpGetFullAXTree", depth: null },
    expected: { kind: "cdpGetFullAXTree", depth: null },
  },
];

describe("browser view CDP IPC (ticket 09 borrowed tile)", () => {
  beforeEach(() => {
    captured.managerOptions = null;
    captured.dispatchCdpCalls = [];
    captured.backgroundTabCreates = [];
    vi.clearAllMocks();
  });

  it("registers browserViewCdpDispatch and hands a parsed payload to the manager", async () => {
    const { registerBrowserViewIpc } = await import("../browser-view-ipc");
    const { RunnerHostInvoke } =
      await import("../../../ipc-contracts/ipc-channels");

    const bridge = makeBridge();
    registerBrowserViewIpc(bridge as never);

    const channelNames = bridge.handleInvoke.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(channelNames).toContain(RunnerHostInvoke.browserViewCdpDispatch);

    const handler = findInvokeHandler(
      bridge,
      RunnerHostInvoke.browserViewCdpDispatch,
    );
    const payload = {
      viewTabId: "view-tab-1",
      paneId: "pane-1",
      tileInstanceId: "browser-instance-1",
      pageSessionId: "browser-page-1",
      sessionId: "child-session-1",
      command: {
        kind: "cdpNavigate",
        url: "https://example.com/borrowed",
      },
    };

    await handler({}, payload);

    expect(bridge.resolveSenderWindowId).toHaveBeenCalled();
    expect(captured.dispatchCdpCalls).toEqual([
      {
        windowId: "window-1",
        input: {
          viewTabId: "view-tab-1",
          paneId: "pane-1",
          tileInstanceId: "browser-instance-1",
          pageSessionId: "browser-page-1",
          sessionId: "child-session-1",
          command: {
            kind: "cdpNavigate",
            url: "https://example.com/borrowed",
          },
        },
      },
    ]);
  });

  it("forwards CDP session-ended and target-attached on the user-tile channels", async () => {
    const { registerBrowserViewIpc } = await import("../browser-view-ipc");
    const { RunnerHostEvent } =
      await import("../../../ipc-contracts/ipc-channels");

    const bridge = makeBridge();
    registerBrowserViewIpc(bridge as never);

    const options = captured.managerOptions;
    if (options === null) {
      throw new Error("BrowserViewManager was not constructed");
    }

    const sessionEnded: AgentBrowserViewCdpSessionEndedChange = {
      viewTabId: "view-tab-1",
      paneId: "pane-1",
      tileInstanceId: "browser-instance-1",
      pageSessionId: "browser-page-1",
      reason: "devtools-opened",
    };
    options.notifyCdpSessionEnded("window-1", sessionEnded);
    expect(bridge.safeSendToWindow).toHaveBeenCalledWith(
      "window-1",
      RunnerHostEvent.browserViewCdpSessionEnded,
      sessionEnded,
    );

    const targetAttached: AgentBrowserViewCdpTargetAttachedChange = {
      viewTabId: "view-tab-1",
      paneId: "pane-1",
      tileInstanceId: "browser-instance-1",
      pageSessionId: "browser-page-1",
      sessionId: "child-1",
      targetId: "target-1",
      targetType: "iframe",
      url: "https://example.com/child",
      waitingForDebugger: false,
    };
    options.notifyCdpTargetAttached("window-2", targetAttached);
    expect(bridge.safeSendToWindow).toHaveBeenCalledWith(
      "window-2",
      RunnerHostEvent.browserViewCdpTargetAttached,
      targetAttached,
    );

    // Discriminating: the agent-tile event channels must not be used here.
    // A no-op notify would pass "no crash"; wrong-channel would still send.
    expect(bridge.safeSendToWindow).not.toHaveBeenCalledWith(
      expect.anything(),
      RunnerHostEvent.agentBrowserViewCdpSessionEnded,
      expect.anything(),
    );
    expect(bridge.safeSendToWindow).not.toHaveBeenCalledWith(
      expect.anything(),
      RunnerHostEvent.agentBrowserViewCdpTargetAttached,
      expect.anything(),
    );
  });

  it("passes the background storage seed through the IPC parser", async () => {
    const { registerBrowserViewIpc } = await import("../browser-view-ipc");
    const { RunnerHostInvoke } =
      await import("../../../ipc-contracts/ipc-channels");

    const bridge = makeBridge();
    registerBrowserViewIpc(bridge as never);
    const handler = findInvokeHandler(
      bridge,
      RunnerHostInvoke.browserViewCreateBackgroundTab,
    );
    const seedStorageState = {
      cookies: [],
      origins: [
        {
          origin: "https://example.com",
          localStorage: [{ name: "token", value: "carried" }],
        },
      ],
    };

    await handler({}, {
      viewTabId: "view-tab-1",
      paneId: "pane-1",
      tileInstanceId: "tile-1",
      pageSessionId: "page-1",
      sessionId: "session-1",
      tabId: "tab-1",
      url: "https://example.com/background",
      seedStorageState,
    });

    expect(captured.backgroundTabCreates).toEqual([
      {
        windowId: "window-1",
        input: expect.objectContaining({
          sessionId: "session-1",
          tabId: "tab-1",
          url: "https://example.com/background",
          seedStorageState,
        }),
      },
    ]);
  });

  describe("parseBrowserViewCdpCommand (shared by agent and borrowed tiles)", () => {
    it.each(VALID_COMMAND_PAYLOADS)(
      "round-trips every field of $name",
      ({ payload, expected }) => {
        expect(parseBrowserViewCdpCommand(payload)).toEqual(expected);
      },
    );

    it("rejects an unknown command kind rather than coercing", () => {
      expect(() => parseBrowserViewCdpCommand({ kind: "cdpEval" })).toThrow(
        /Unknown browser view CDP command kind: cdpEval/,
      );
    });

    it("rejects a wrong-typed required field on cdpNavigate.url", () => {
      expect(() =>
        parseBrowserViewCdpCommand({
          kind: "cdpNavigate",
          url: 42,
        }),
      ).toThrow(/command\.url must be a string/);
    });

    it("rejects an invalid cdpDispatchMouseEvent.type enum value", () => {
      expect(() =>
        parseBrowserViewCdpCommand({
          kind: "cdpDispatchMouseEvent",
          type: "click",
          x: 0,
          y: 0,
          button: null,
          clickCount: null,
          deltaX: null,
          deltaY: null,
        }),
      ).toThrow(/mouse event type is invalid/);
    });

    it("coerces missing cdpCallFunctionOn.argumentsJson to null rather than dropping the field", () => {
      // Documented opacity path: argumentsJson is not schema-checked, but a
      // missing key still becomes null so both tile kinds see the same shape.
      expect(
        parseBrowserViewCdpCommand({
          kind: "cdpCallFunctionOn",
          objectId: null,
          executionContextId: 1,
          functionDeclaration: "function() {}",
          returnByValue: true,
        }),
      ).toEqual({
        kind: "cdpCallFunctionOn",
        objectId: null,
        executionContextId: 1,
        functionDeclaration: "function() {}",
        argumentsJson: null,
        returnByValue: true,
      });
    });
  });
});
