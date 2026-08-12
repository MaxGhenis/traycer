import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserViewManager,
  PRIMARY_PROFILE_LOCAL_STORAGE_ORIGIN_LIMIT,
  type BrowserViewDebugger,
  type BrowserViewManagerOptions,
  type BrowserViewPopupWebContents,
  type BrowserViewWebContents,
  type BrowserViewWindow,
  type ManagedBrowserView,
  type ManagedContentView,
} from "../browser-view-manager";
import type {
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
  BrowserViewCertificateErrorChange,
  BrowserViewDebugSnapshotChange,
  BrowserViewDownloadChange,
  BrowserViewFindChange,
  BrowserViewOpenTileRequest,
  BrowserViewControlRevokedChange,
  BrowserViewSnapshotInvalidatedChange,
  BrowserViewStatusChange,
  BrowserViewStorageStateApply,
  BrowserViewStorageStateApplyResult,
  BrowserViewStorageStateCapture,
  BrowserViewStorageStateCaptureResult,
  BrowserViewTileKey,
  BrowserViewTileUpsert,
} from "../../../ipc-contracts/browser-view-types";
import type {
  BrowserViewCertificateErrorChange as BrowserSessionCertificateErrorChange,
  BrowserViewDownloadChange as BrowserSessionDownloadChange,
} from "../browser-session";

const BASE_KEY: BrowserViewTileKey = {
  viewTabId: "view-tab-1",
  paneId: "pane-1",
  tileInstanceId: "tile-1",
  pageSessionId: "page-1",
};

function upsert(
  key: BrowserViewTileKey,
  url: string,
  visible: boolean,
): BrowserViewTileUpsert {
  return { ...key, url, visible, viewportPreset: "responsive" };
}

class FakeDebugger implements BrowserViewDebugger {
  attached = false;
  detached = false;
  deferCommands = false;
  readonly commandResolvers: Array<(value: unknown) => void> = [];
  readonly commands: Array<{
    readonly method: string;
    readonly params: Record<string, unknown>;
    readonly sessionId: string | undefined;
  }> = [];
  readonly passwordSelectors = new Set<string>();
  private readonly events = new EventEmitter();

  constructor(private readonly lifecycle: string[]) {}

  isAttached(): boolean {
    return this.attached;
  }

  attach(_protocolVersion: string): void {
    this.attached = true;
  }

  detach(): void {
    this.detached = true;
    this.attached = false;
  }

  sendCommand(
    method: string,
    commandParams: Record<string, unknown>,
    sessionId: string | undefined,
  ): Promise<unknown> {
    this.lifecycle.push(method);
    this.commands.push({ method, params: commandParams, sessionId });
    if (this.deferCommands) {
      return new Promise((resolve) => {
        this.commandResolvers.push(resolve);
      });
    }
    if (method === "Runtime.evaluate") {
      return Promise.resolve(this.evaluateRuntime(commandParams));
    }
    if (method === "Page.addScriptToEvaluateOnNewDocument") {
      return Promise.resolve({ identifier: "seed-script-1" });
    }
    return Promise.resolve(null);
  }

  private evaluateRuntime(commandParams: Record<string, unknown>): {
    readonly result: { readonly value: unknown };
  } {
    const expression =
      typeof commandParams.expression === "string"
        ? commandParams.expression
        : "";
    if (expression.includes("sensitiveAutocomplete")) {
      const selectorSensitive = [...this.passwordSelectors].some((selector) =>
        expression.includes(JSON.stringify(selector)),
      );
      const creditCardAutocompleteSensitive =
        expression.includes('startsWith("cc-")') &&
        expression.includes("cc-number");
      return {
        result: {
          value: {
            focused: true,
            sensitive: selectorSensitive || creditCardAutocompleteSensitive,
          },
        },
      };
    }
    if (expression.includes("getBoundingClientRect")) {
      return { result: { value: { x: 10, y: 10 } } };
    }
    return { result: { value: true } };
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.events.on(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.events.off(event, listener);
  }

  emitMessage(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): void {
    this.events.emit("message", {}, method, params, sessionId);
  }

  emitDetach(reason: string): void {
    this.attached = false;
    this.events.emit("detach", {}, reason);
  }
}

class FakeWebContents extends EventEmitter implements BrowserViewWebContents {
  readonly lifecycle: string[] = [];
  readonly debugger = new FakeDebugger(this.lifecycle);
  readonly navigationHistory = {
    canGoBack: () => this.canGoBackValue,
    canGoForward: () => this.canGoForwardValue,
    clear: () => {
      this.clearNavigationHistoryCalls += 1;
    },
    goBack: () => {
      this.goBackCalls += 1;
    },
    goForward: () => {
      this.goForwardCalls += 1;
    },
  };
  readonly loadUrls: string[] = [];
  readonly executedJavaScript: string[] = [];
  readonly captureVisibleStates: boolean[] = [];
  readonly findInPageCalls: Array<{
    readonly requestId: number;
    readonly text: string;
    readonly options: {
      readonly forward: boolean;
      readonly findNext: boolean;
      readonly matchCase: boolean;
    };
  }> = [];
  closeCalls = 0;
  reloadCalls = 0;
  goBackCalls = 0;
  goForwardCalls = 0;
  clearNavigationHistoryCalls = 0;
  stopFindCalls = 0;
  readonly backgroundThrottlingStates: boolean[] = [];
  canGoBackValue = false;
  canGoForwardValue = false;
  throwDeprecatedNavigation = false;
  destroyed = false;
  zoomFactor = 1;
  title = "";
  devToolsWebContentsId: number | null = null;
  openDevToolsCalls: unknown[] = [];
  windowOpenHandler:
    | ((details: {
        readonly url: string;
        readonly frameName: string;
        readonly features: string;
        readonly disposition: string;
      }) =>
        | { readonly action: "deny" }
        | {
            readonly action: "allow";
            readonly overrideBrowserWindowOptions: unknown;
            readonly outlivesOpener: boolean;
          })
    | null = null;
  private url = "about:blank";

  constructor(
    readonly id: number,
    private readonly readVisible: () => boolean,
  ) {
    super();
  }

  loadURL(url: string): Promise<unknown> {
    this.lifecycle.push("loadURL");
    this.url = url;
    this.loadUrls.push(url);
    if (url === "http://127.0.0.1:65535/") {
      return Promise.reject(new Error("ERR_CONNECTION_REFUSED"));
    }
    return Promise.resolve(null);
  }

  executeJavaScript(script: string): Promise<unknown> {
    this.executedJavaScript.push(script);
    return Promise.resolve([]);
  }

  capturePage(): Promise<{ toDataURL(): string }> {
    this.captureVisibleStates.push(this.readVisible());
    return Promise.resolve({
      toDataURL: () => `data:image/png;base64,${this.id}`,
    });
  }

  getURL(): string {
    return this.url;
  }

  getTitle(): string {
    return this.title;
  }

  canGoBack(): boolean {
    if (this.destroyed || this.throwDeprecatedNavigation) {
      throw new Error("deprecated canGoBack should not be used");
    }
    return this.canGoBackValue;
  }

  canGoForward(): boolean {
    if (this.destroyed || this.throwDeprecatedNavigation) {
      throw new Error("deprecated canGoForward should not be used");
    }
    return this.canGoForwardValue;
  }

  goBack(): void {
    this.goBackCalls += 1;
  }

  goForward(): void {
    this.goForwardCalls += 1;
  }

  close(): void {
    this.closeCalls += 1;
    this.destroyed = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  reload(): void {
    this.reloadCalls += 1;
  }

  findInPage(
    text: string,
    options: {
      readonly forward: boolean;
      readonly findNext: boolean;
      readonly matchCase: boolean;
    },
  ): number {
    const requestId = this.findInPageCalls.length + 1;
    this.findInPageCalls.push({ requestId, text, options });
    return requestId;
  }

  stopFindInPage(_action: "clearSelection"): void {
    this.stopFindCalls += 1;
  }

  getZoomFactor(): number {
    return this.zoomFactor;
  }

  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
  }

  setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottlingStates.push(allowed);
  }

  setDevToolsWebContents(webContents: { readonly id: number }): void {
    this.devToolsWebContentsId = webContents.id;
  }

  openDevTools(options: unknown): void {
    this.openDevToolsCalls.push(options);
  }

  setWindowOpenHandler(
    handler: (details: {
      readonly url: string;
      readonly frameName: string;
      readonly features: string;
      readonly disposition: string;
    }) =>
      | { readonly action: "deny" }
      | {
          readonly action: "allow";
          readonly overrideBrowserWindowOptions: unknown;
          readonly outlivesOpener: boolean;
        },
  ): void {
    this.windowOpenHandler = handler;
  }
}

class FakeBrowserView implements ManagedBrowserView {
  readonly webContents: FakeWebContents;
  readonly bounds: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  readonly visibleStates: boolean[] = [];

  constructor(webContentsId: number) {
    this.webContents = new FakeWebContents(webContentsId, () => this.visible);
  }

  setBounds(bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }): void {
    this.bounds.push(bounds);
  }

  setVisible(visible: boolean): void {
    this.visibleStates.push(visible);
  }

  get visible(): boolean {
    return this.visibleStates[this.visibleStates.length - 1] ?? false;
  }
}

class FakeContentView implements ManagedContentView {
  readonly children: ManagedBrowserView[] = [];

  addChildView(view: ManagedBrowserView): void {
    if (!this.children.includes(view)) {
      this.children.push(view);
    }
  }

  removeChildView(view: ManagedBrowserView): void {
    const index = this.children.indexOf(view);
    if (index !== -1) this.children.splice(index, 1);
  }
}

class FakeWindow implements BrowserViewWindow {
  readonly contentView = new FakeContentView();
  destroyed = false;
  visible = true;
  minimized = false;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isMinimized(): boolean {
    return this.minimized;
  }
}

class FakePopupWebContents extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }

  once(event: "destroyed", listener: () => void): this {
    return super.once(event, listener);
  }
}

class FakePopupWindow extends EventEmitter {
  readonly webContents: FakePopupWebContents;
  destroyed = false;
  closeCalls = 0;

  constructor(webContentsId: number) {
    super();
    this.webContents = new FakePopupWebContents(webContentsId);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  close(): void {
    this.closeCalls += 1;
    this.destroyed = true;
  }
}

class FakeDevToolsWindow {
  readonly webContents: { readonly id: number };
  destroyed = false;

  constructor(webContentsId: number) {
    this.webContents = { id: webContentsId };
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

interface Harness {
  readonly manager: BrowserViewManager;
  readonly windows: Map<string, FakeWindow>;
  readonly views: FakeBrowserView[];
  readonly statuses: BrowserViewStatusChange[];
  readonly finds: BrowserViewFindChange[];
  readonly downloads: BrowserViewDownloadChange[];
  readonly certificateErrors: BrowserViewCertificateErrorChange[];
  readonly openTileRequests: BrowserViewOpenTileRequest[];
  readonly debugSnapshots: BrowserViewDebugSnapshotChange[];
  readonly controlRevocations: BrowserViewControlRevokedChange[];
  readonly cdpSessionEndedNotifications: AgentBrowserViewCdpSessionEndedChange[];
  readonly cdpTargetAttachedNotifications: AgentBrowserViewCdpTargetAttachedChange[];
  readonly tileHandoffNotifications: AgentBrowserViewTileHandoffChange[];
  readonly snapshotInvalidations: BrowserViewSnapshotInvalidatedChange[];
  readonly storageStateApplications: BrowserViewStorageStateApply[];
  readonly storageStateCaptures: BrowserViewStorageStateCapture[];
  readonly primaryProfileCaptureSourceOrigins: string[][];
  readonly registeredPopupWebContents: BrowserViewPopupWebContents[];
  emitDownload(change: BrowserSessionDownloadChange): void;
  emitCertificateError(change: BrowserSessionCertificateErrorChange): void;
  emitWindowChange(): void;
}

type HarnessOptions = {
  readonly captureStorageState?: BrowserViewManagerOptions["captureStorageState"];
  readonly electronCreateDelayMs?: number;
};

const DEFAULT_CAPTURE_STORAGE_STATE: BrowserViewManagerOptions["captureStorageState"] =
  (_input, _webContents): Promise<BrowserViewStorageStateCaptureResult> =>
    Promise.resolve({
      storageState: { cookies: [], origins: [] },
      cookieCount: 0,
      cookieDomains: [],
      localStorageCount: 0,
      localStorageAvailable: true,
      localStorageReason: null,
    });

function createHarness(): Harness {
  return createHarnessWithOptions(undefined);
}

function createHarnessWithOptions(
  harnessOptions: HarnessOptions | undefined,
): Harness {
  const windows = new Map<string, FakeWindow>([
    ["window-1", new FakeWindow()],
    ["window-2", new FakeWindow()],
  ]);
  const views: FakeBrowserView[] = [];
  const statuses: BrowserViewStatusChange[] = [];
  const finds: BrowserViewFindChange[] = [];
  const downloads: BrowserViewDownloadChange[] = [];
  const certificateErrors: BrowserViewCertificateErrorChange[] = [];
  const openTileRequests: BrowserViewOpenTileRequest[] = [];
  const debugSnapshots: BrowserViewDebugSnapshotChange[] = [];
  const controlRevocations: BrowserViewControlRevokedChange[] = [];
  const cdpSessionEndedNotifications: AgentBrowserViewCdpSessionEndedChange[] =
    [];
  const cdpTargetAttachedNotifications: AgentBrowserViewCdpTargetAttachedChange[] =
    [];
  const tileHandoffNotifications: AgentBrowserViewTileHandoffChange[] = [];
  const snapshotInvalidations: BrowserViewSnapshotInvalidatedChange[] = [];
  const storageStateApplications: BrowserViewStorageStateApply[] = [];
  const storageStateCaptures: BrowserViewStorageStateCapture[] = [];
  const primaryProfileCaptureSourceOrigins: string[][] = [];
  const registeredPopupWebContents: BrowserViewPopupWebContents[] = [];
  const windowListeners = new Set<() => void>();
  const downloadListeners = new Set<
    (change: BrowserSessionDownloadChange) => void
  >();
  const certificateListeners = new Set<
    (change: BrowserSessionCertificateErrorChange) => void
  >();
  let nextWebContentsId = 1;
  const options: BrowserViewManagerOptions = {
    createView: () => {
      const view = new FakeBrowserView(nextWebContentsId);
      nextWebContentsId += 1;
      views.push(view);
      return view;
    },
    getWindow: (windowId) => windows.get(windowId) ?? null,
    onWindowChange: (listener) => {
      windowListeners.add(listener);
      return () => {
        windowListeners.delete(listener);
      };
    },
    createPopupWindowOptions: () => ({ width: 900 }),
    createDevToolsWindow: () => {
      const window = new FakeDevToolsWindow(nextWebContentsId);
      nextWebContentsId += 1;
      return window;
    },
    registerPopupWebContents: (webContents) => {
      registeredPopupWebContents.push(webContents);
    },
    onDownloadChange: (listener) => {
      downloadListeners.add(listener);
      return () => {
        downloadListeners.delete(listener);
      };
    },
    onCertificateError: (listener) => {
      certificateListeners.add(listener);
      return () => {
        certificateListeners.delete(listener);
      };
    },
    notifyStatus: (_windowId, change) => {
      statuses.push(change);
    },
    notifyFind: (_windowId, change) => {
      finds.push(change);
    },
    notifyDownload: (_windowId, change) => {
      downloads.push(change);
    },
    notifyCertificateError: (_windowId, change) => {
      certificateErrors.push(change);
    },
    notifyOpenTileRequest: (_windowId, change) => {
      openTileRequests.push(change);
    },
    notifySnapshotInvalidated: (_windowId, change) => {
      snapshotInvalidations.push(change);
    },
    notifyDebugSnapshot: (_windowId, change) => {
      debugSnapshots.push(change);
    },
    notifyControlRevoked: (_windowId, change) => {
      controlRevocations.push(change);
    },
    notifyCdpSessionEnded: (_windowId, change) => {
      cdpSessionEndedNotifications.push(change);
    },
    notifyCdpTargetAttached: (_windowId, change) => {
      cdpTargetAttachedNotifications.push(change);
    },
    notifyTileHandoff: (_windowId, change) => {
      tileHandoffNotifications.push(change);
    },
    scheduleDebugSnapshot: (callback) => {
      const timer = setTimeout(callback, 16);
      return {
        cancel: () => {
          clearTimeout(timer);
        },
      };
    },
    applyStorageState: (input) => {
      storageStateApplications.push(input);
      return Promise.resolve({
        status: "applied",
        cookieCount: 1,
        localStorageApplied: false,
        reason: "cookies-only",
      } satisfies BrowserViewStorageStateApplyResult);
    },
    captureStorageState: (input, webContents) => {
      storageStateCaptures.push(input);
      return (
        harnessOptions?.captureStorageState ?? DEFAULT_CAPTURE_STORAGE_STATE
      )(
        input,
        webContents,
      );
    },
    capturePrimaryProfile: (origins) => {
      primaryProfileCaptureSourceOrigins.push(
        origins.map((origin) => origin.origin),
      );
      return Promise.resolve({
        status: "captured",
        storageState: {
          cookies: [],
          origins: origins.map((origin) => ({
            origin: origin.origin,
            localStorage: origin.localStorage,
          })),
        },
        reason: null,
      });
    },
    capturePrimaryProfileLocalStorage: (origin, _webContents) =>
      Promise.resolve({
        origin,
        localStorage: [{ name: "k", value: origin }],
      }),
    releaseGraceMs: 10,
    electronCreateDelayMs: harnessOptions?.electronCreateDelayMs ?? 0,
  };
  return {
    manager: new BrowserViewManager(options),
    windows,
    views,
    statuses,
    finds,
    downloads,
    certificateErrors,
    openTileRequests,
    debugSnapshots,
    controlRevocations,
    cdpSessionEndedNotifications,
    cdpTargetAttachedNotifications,
    tileHandoffNotifications,
    snapshotInvalidations,
    storageStateApplications,
    storageStateCaptures,
    primaryProfileCaptureSourceOrigins,
    registeredPopupWebContents,
    emitDownload: (change) => {
      for (const listener of downloadListeners) listener(change);
    },
    emitCertificateError: (change) => {
      for (const listener of certificateListeners) listener(change);
    },
    emitWindowChange: () => {
      for (const listener of windowListeners) listener();
    },
  };
}

/** Ticket 12: flush the async closeEntry → pushTileHandoff → capture chain. */
async function flushCloseEntry(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("BrowserViewManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies handoff storage state through the configured browser store", async () => {
    const harness = createHarness();
    const storageState = {
      cookies: [],
      origins: [],
    };

    await expect(
      harness.manager.applyStorageState({
        storageState,
        sessionId: "session-manager-test",
        tabId: "tab-manager-test",
        purpose: "sync-back",
      }),
    ).resolves.toEqual({
      status: "applied",
      cookieCount: 1,
      localStorageApplied: false,
      reason: "cookies-only",
    });
    expect(harness.storageStateApplications).toEqual([
      {
        storageState,
        sessionId: "session-manager-test",
        tabId: "tab-manager-test",
        purpose: "sync-back",
      },
    ]);
  });

  it("releaseTile unbinds the view without destroying WebContents (ticket 05)", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 1, y: 2, width: 300, height: 200 },
    });
    const view = harness.views[0];

    expect(view.visible).toBe(true);
    expect(view.webContents.closeCalls).toBe(0);

    harness.manager.releaseTile("window-1", BASE_KEY);
    expect(view.visible).toBe(false);
    expect(view.webContents.closeCalls).toBe(0);
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
    // No grace-period destruction: tile close is unbind only.
    vi.advanceTimersByTime(60_000);
    expect(view.webContents.closeCalls).toBe(0);
    expect(harness.tileHandoffNotifications).toEqual([]);
  });

  it("rebinds the same WebContents when a released tile is reopened (ticket 05)", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 1, y: 2, width: 300, height: 200 },
    });
    const view = harness.views[0];
    expect(view.visible).toBe(true);

    harness.manager.releaseTile("window-1", BASE_KEY);
    expect(view.visible).toBe(false);

    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );

    expect(view.webContents.closeCalls).toBe(0);
    expect(view.visible).toBe(true);
    expect(harness.views).toHaveLength(1);
    expect(harness.windows.get("window-1")?.contentView.children).toContain(
      view,
    );
  });

  it("applies fixed viewport presets within the tile bounds", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 1200, height: 900 },
    });
    const view = harness.views[0];

    harness.manager.setViewportPreset("window-1", {
      ...BASE_KEY,
      viewportPreset: "mobile",
    });

    expect(view.bounds.at(-1)).toEqual({
      x: 405,
      y: 28,
      width: 390,
      height: 844,
    });
  });

  it("opens manual DevTools with a dedicated WebContents", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];

    harness.manager.openDevTools("window-1", BASE_KEY);

    expect(view.webContents.devToolsWebContentsId).toBe(2);
    expect(view.webContents.openDevToolsCalls).toEqual([
      {
        mode: "detach",
        activate: true,
        title: "Traycer Browser DevTools",
      },
    ]);
  });

  it("does not share webContents when a browser tile is duplicated", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.upsertTile(
      "window-1",
      upsert(
        {
          ...BASE_KEY,
          tileInstanceId: "tile-2",
          pageSessionId: "page-2",
        },
        "http://localhost:3000",
        true,
      ),
    );

    expect(harness.views).toHaveLength(2);
    expect(harness.views[0].webContents.id).not.toBe(
      harness.views[1].webContents.id,
    );
  });

  it("keeps background tabs hidden and non-interactive", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", false),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    expect(view.visible).toBe(false);

    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    expect(view.visible).toBe(true);

    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", false),
    );
    expect(view.visible).toBe(false);
  });

  it("commit-event-fires-BEFORE-listener-attaches -> readiness still resolves", async () => {
    const harness = createHarness();
    const backgroundKey: BrowserViewTileKey = {
      viewTabId: "background-before-listener",
      paneId: "background-before-listener",
      tileInstanceId: "background-before-listener-tile",
      pageSessionId: "background-before-listener-page",
    };
    const loadURL = vi
      .spyOn(FakeWebContents.prototype, "loadURL")
      .mockImplementation(function (this: FakeWebContents, url) {
        this.lifecycle.push("loadURL");
        this.loadUrls.push(url);
        if (url === "about:blank") return Promise.resolve(null);
        this.emit("did-frame-navigate", {}, url, 200, "OK", true);
        return new Promise<unknown>(() => {});
      });
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...backgroundKey,
      sessionId: "session-background-before-listener",
      tabId: "tab-background-before-listener",
      url: "https://example.com/background-before-listener",
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");
    const outcomePromise = Promise.race([
      creation.then(() => "ready" as const),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 100);
      }),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await outcomePromise;
    if (outcome === "timed-out") {
      view.webContents.emit(
        "did-frame-navigate",
        {},
        "https://example.com/background-before-listener",
        200,
        "OK",
        true,
      );
      await creation;
    }
    loadURL.mockRestore();
    expect(outcome).toBe("ready");
  });

  it("commit-after-attach -> readiness still resolves", async () => {
    const harness = createHarness();
    const backgroundKey: BrowserViewTileKey = {
      viewTabId: "background",
      paneId: "background",
      tileInstanceId: "background-tile",
      pageSessionId: "background-page",
    };
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...backgroundKey,
      sessionId: "session-background",
      tabId: "tab-background",
      url: "https://example.com/background",
      seedStorageState: {
        cookies: [],
        origins: [
          {
            origin: "https://example.com",
            localStorage: [{ name: "token", value: "carried" }],
          },
        ],
      },
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");

    vi.spyOn(view.webContents, "loadURL").mockImplementation((url) => {
      view.webContents.lifecycle.push("loadURL");
      view.webContents.loadUrls.push(url);
      return new Promise<unknown>(() => {});
    });

    let settled = false;
    void creation.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
    expect(view.visible).toBe(false);
    await vi.waitFor(() => {
      expect(view.webContents.loadUrls).toEqual([
        "about:blank",
        "https://example.com/background",
      ]);
    });

    view.webContents.emit(
      "did-frame-navigate",
      {},
      "https://example.com/background",
      200,
      "OK",
      true,
    );
    const outcomePromise = Promise.race([
      creation.then(() => "ready" as const),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 100);
      }),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcomePromise).toBe("ready");
    expect(settled).toBe(true);
    expect(view.webContents.debugger.attached).toBe(true);
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
    expect(view.webContents.debugger.commands).toContainEqual({
      method: "Page.addScriptToEvaluateOnNewDocument",
      params: { source: expect.stringContaining('"token"') },
      sessionId: undefined,
    });
    expect(view.webContents.debugger.commands).toContainEqual({
      method: "Page.removeScriptToEvaluateOnNewDocument",
      params: { identifier: "seed-script-1" },
      sessionId: undefined,
    });
    expect(harness.views).toHaveLength(1);
    expect(harness.manager.snapshotForTests()[0]).toMatchObject({
      parentWindowId: null,
      visible: false,
      status: "ready",
      requestedUrl: "https://example.com/background",
    });
    const hiddenCdp = await harness.manager.dispatchCdp("window-1", {
      ...backgroundKey,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });
    expect(hiddenCdp.ok).toBe(true);

    const openedKey: BrowserViewTileKey = {
      ...backgroundKey,
      viewTabId: "view-tab-opened",
      paneId: "pane-opened",
      tileInstanceId: "tile-opened",
    };
    harness.manager.upsertTile(
      "window-1",
      upsert(openedKey, "https://example.com/background", true),
    );
    harness.manager.updateBounds("window-1", {
      ...openedKey,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    expect(harness.views).toHaveLength(1);
    expect(harness.views[0]).toBe(view);
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([
      view,
    ]);
    expect(view.visible).toBe(true);

    harness.manager.releaseTile("window-1", openedKey);
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
    expect(view.visible).toBe(false);
    expect(view.webContents.closeCalls).toBe(0);

    harness.manager.upsertTile(
      "window-1",
      upsert(openedKey, "https://example.com/background", true),
    );
    expect(harness.views).toHaveLength(1);
    expect(harness.views[0]).toBe(view);
    expect(view.webContents.closeCalls).toBe(0);
    expect(view.webContents.loadUrls).toEqual([
      "about:blank",
      "https://example.com/background",
    ]);

    const cdp = await harness.manager.dispatchCdp("window-1", {
      ...openedKey,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });
    expect(cdp.ok).toBe(true);
  });

  it("unbound-readiness probe does not wait for paint or rAF", async () => {
    const harness = createHarness();
    const backgroundKey: BrowserViewTileKey = {
      viewTabId: "unbound-readiness",
      paneId: "unbound-readiness",
      tileInstanceId: "unbound-readiness-tile",
      pageSessionId: "unbound-readiness-page",
    };
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...backgroundKey,
      sessionId: "session-unbound-readiness",
      tabId: "tab-unbound-readiness",
      url: "https://example.com/unbound-readiness",
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");

    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
    view.webContents.emit("did-finish-load");
    const outcomePromise = Promise.race([
      creation.then(() => "ready" as const),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 100);
      }),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await outcomePromise;

    expect(outcome).toBe("ready");
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
    expect(
      view.webContents.executedJavaScript.some((script) =>
        /requestAnimationFrame|(?:^|[^\w])paint(?:[^\w]|$)/i.test(script),
      ),
    ).toBe(false);
  });

  it("registers a background entry before delayed create readiness settles", async () => {
    const harness = createHarnessWithOptions({ electronCreateDelayMs: 6_000 });
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-delayed-background",
      tabId: "tab-source",
      url: "https://example.com/delayed-background",
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");

    let settled = false;
    void creation.then(() => {
      settled = true;
    });
    view.webContents.emit("did-finish-load");
    await Promise.resolve();

    expect(harness.manager.snapshotForTests()).toHaveLength(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(5_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await creation;
    expect(settled).toBe(true);
  });

  it("installs localStorage only at create before the first background load", async () => {
    const harness = createHarness();
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-background-seeded",
      tabId: "tab-background-seeded",
      url: "https://example.com/background",
      seedStorageState: {
        cookies: [],
        origins: [
          {
            origin: "https://example.com",
            localStorage: [{ name: "token", value: "carried" }],
          },
        ],
      },
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");

    view.webContents.emit("did-finish-load");
    await creation;

    expect(view.webContents.lifecycle).toEqual([
      "loadURL",
      "Page.addScriptToEvaluateOnNewDocument",
      "loadURL",
      "Page.removeScriptToEvaluateOnNewDocument",
    ]);
    expect(view.webContents.loadUrls).toEqual([
      "about:blank",
      "https://example.com/background",
    ]);
    expect(view.webContents.debugger.commands).toContainEqual({
      method: "Page.addScriptToEvaluateOnNewDocument",
      params: { source: expect.stringContaining('"token"') },
      sessionId: undefined,
    });
    expect(view.webContents.debugger.commands).toContainEqual({
      method: "Page.removeScriptToEvaluateOnNewDocument",
      params: { identifier: "seed-script-1" },
      sessionId: undefined,
    });
    expect(harness.storageStateApplications).toEqual([]);
  });

  it("does not publish the prime about:blank URL when requested navigation fails before commit", async () => {
    const harness = createHarness();
    const requestedUrl = "https://example.com/prime-failure";
    const seedError = new Error("seed install failed");
    const loadURL = vi
      .spyOn(FakeWebContents.prototype, "loadURL")
      .mockImplementation(function (this: FakeWebContents, url) {
        this.lifecycle.push("loadURL");
        this.loadUrls.push(url);
        if (url === "about:blank") {
          this.emit("did-frame-navigate", {}, "about:blank", 200, "OK", true);
        }
        return Promise.resolve(null);
      });
    const sendCommand = vi
      .spyOn(FakeDebugger.prototype, "sendCommand")
      .mockImplementation((method) => {
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          return Promise.reject(seedError);
        }
        return Promise.resolve(null);
      });

    try {
      const creation = harness.manager.createBackgroundTab("window-1", {
        ...BASE_KEY,
        sessionId: "session-prime-failure",
        tabId: "tab-prime-failure",
        url: requestedUrl,
        seedStorageState: {
          cookies: [],
          origins: [
            {
              origin: "https://example.com",
              localStorage: [{ name: "token", value: "carried" }],
            },
          ],
        },
      });
      const view = harness.views[0];
      if (view === undefined) throw new Error("expected background view");
      await expect(creation).rejects.toThrow("seed install failed");
      expect(view.webContents.loadUrls).toEqual(["about:blank"]);
      expect(view.webContents.clearNavigationHistoryCalls).toBe(1);
      expect(harness.statuses.map((status) => status.url)).not.toContain(
        "about:blank",
      );
      expect(harness.manager.snapshotForTests()).toEqual([]);
    } finally {
      loadURL.mockRestore();
      sendCommand.mockRestore();
    }
  });

  it("rejects a duplicate background runtime key without overwriting the first view", async () => {
    const harness = createHarness();
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-duplicate-runtime",
      tabId: "tab-duplicate-runtime",
      url: "https://example.com/duplicate-runtime",
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");
    await Promise.resolve();

    await expect(
      harness.manager.createBackgroundTab("window-1", {
        ...BASE_KEY,
        tileInstanceId: "tile-duplicate-runtime-second",
        pageSessionId: "page-duplicate-runtime-second",
        sessionId: "session-duplicate-runtime",
        tabId: "tab-duplicate-runtime",
        url: "https://example.com/duplicate-runtime-second",
      }),
    ).rejects.toThrow(
      "Browser runtime tab session-duplicate-runtime/tab-duplicate-runtime already exists.",
    );
    expect(harness.views).toHaveLength(1);
    expect(harness.manager.snapshotForTests()).toHaveLength(1);

    view.webContents.emit("did-finish-load");
    await creation;
  });

  it("load-failure -> rejects", async () => {
    const harness = createHarness();
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-background-load-failure",
      tabId: "tab-background-load-failure",
      url: "http://127.0.0.1:65535/",
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");

    await expect(creation).rejects.toThrow("ERR_CONNECTION_REFUSED");
    expect(view.webContents.closeCalls).toBe(1);
    expect(harness.manager.snapshotForTests()).toEqual([]);
  });

  it("sets background throttling off while driven and restores it when idle", async () => {
    const harness = createHarness();
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-background-throttle",
      tabId: "tab-background-throttle",
      url: "https://example.com/background",
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");

    harness.manager.setBackgroundThrottling("window-1", {
      ...BASE_KEY,
      enabled: false,
    });
    harness.manager.setBackgroundThrottling("window-1", {
      ...BASE_KEY,
      enabled: true,
    });

    expect(view.webContents.backgroundThrottlingStates).toEqual([false, true]);
    view.webContents.emit("did-finish-load");
    await creation;
  });

  it("reparents the same view across panes and windows without reloading", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    const nextKey = {
      ...BASE_KEY,
      viewTabId: "view-tab-2",
      paneId: "pane-2",
    };

    harness.manager.upsertTile(
      "window-2",
      upsert(nextKey, "http://localhost:3000", true),
    );

    expect(harness.views).toHaveLength(1);
    expect(view.webContents.loadUrls).toEqual(["http://localhost:3000"]);
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
    expect(harness.windows.get("window-2")?.contentView.children).toEqual([
      view,
    ]);
    expect(harness.manager.snapshotForTests()[0]?.key).toMatchObject({
      windowId: "window-2",
      viewTabId: "view-tab-2",
      paneId: "pane-2",
      tileInstanceId: "tile-1",
    });
  });

  it("gates native visibility on the owning window visibility", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    expect(view.visible).toBe(true);

    const window = harness.windows.get("window-1");
    expect(window).toBeDefined();
    if (window === undefined) return;
    window.visible = false;
    harness.emitWindowChange();
    expect(view.visible).toBe(false);

    window.visible = true;
    window.minimized = true;
    harness.emitWindowChange();
    expect(view.visible).toBe(false);

    window.minimized = false;
    harness.emitWindowChange();
    expect(view.visible).toBe(true);
  });

  it("enables debugger domains only after the first committed navigation", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    expect(view.webContents.debugger.commands).toEqual([]);

    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();

    expect(view.webContents.debugger.attached).toBe(true);
    expect(view.webContents.debugger.commands).toEqual([
      { method: "Page.enable", params: {}, sessionId: undefined },
      { method: "Runtime.enable", params: {}, sessionId: undefined },
      { method: "Log.enable", params: {}, sessionId: undefined },
      { method: "Network.enable", params: {}, sessionId: undefined },
      { method: "DOM.enable", params: {}, sessionId: undefined },
      {
        method: "Target.setAutoAttach",
        params: {
          autoAttach: true,
          flatten: true,
          waitForDebuggerOnStart: false,
        },
        sessionId: undefined,
      },
    ]);
  });

  it("enables Runtime, Log, and Network for flattened child sessions", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];

    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();
    view.webContents.debugger.emitMessage(
      "Target.attachedToTarget",
      {
        sessionId: "child-session",
        targetInfo: { type: "iframe" },
      },
      undefined,
    );
    await Promise.resolve();

    expect(view.webContents.debugger.commands).toContainEqual({
      method: "Runtime.enable",
      params: {},
      sessionId: "child-session",
    });
    expect(view.webContents.debugger.commands).toContainEqual({
      method: "Log.enable",
      params: {},
      sessionId: "child-session",
    });
    expect(view.webContents.debugger.commands).toContainEqual({
      method: "Network.enable",
      params: {},
      sessionId: "child-session",
    });
    expect(view.webContents.debugger.commands).not.toContainEqual({
      method: "Page.enable",
      sessionId: "child-session",
    });
  });

  it("projects console and network debug rows and clears them on request", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();

    view.webContents.debugger.emitMessage(
      "Runtime.consoleAPICalled",
      {
        type: "error",
        timestamp: 1234,
        args: [{ type: "string", value: "boom" }],
        stackTrace: {
          callFrames: [
            {
              functionName: "fail",
              url: "http://localhost:3000/app.js",
              lineNumber: 7,
              columnNumber: 12,
            },
          ],
        },
      },
      undefined,
    );
    view.webContents.debugger.emitMessage(
      "Network.requestWillBeSent",
      {
        requestId: "request-1",
        type: "Fetch",
        wallTime: 1_750_000_000,
        timestamp: 100_000,
        request: {
          url: "http://localhost:3000/api",
          method: "GET",
        },
      },
      undefined,
    );
    view.webContents.debugger.emitMessage(
      "Network.loadingFailed",
      {
        requestId: "request-1",
        timestamp: 100_001.234,
        errorText: "net::ERR_FAILED",
      },
      undefined,
    );

    const snapshot = harness.manager.getDebugSnapshot("window-1", BASE_KEY);
    expect(snapshot.consoleEntries).toMatchObject([
      {
        level: "error",
        text: "boom",
        url: "http://localhost:3000/app.js",
        lineNumber: 7,
      },
    ]);
    expect(snapshot.networkEntries).toMatchObject([
      {
        id: "root:request-1",
        url: "http://localhost:3000/api",
        method: "GET",
        status: "failed",
        startedAt: 1_750_000_000_000,
        completedAt: 1_750_000_001_234,
        durationMs: 1234,
        failureText: "net::ERR_FAILED",
      },
    ]);
    vi.advanceTimersByTime(16);
    expect(harness.debugSnapshots.at(-1)?.networkEntries).toHaveLength(1);

    harness.manager.clearDebugEvents("window-1", BASE_KEY);
    expect(
      harness.manager.getDebugSnapshot("window-1", BASE_KEY),
    ).toMatchObject({
      consoleEntries: [],
      networkEntries: [],
    });
  });

  it("coalesces bursty debug snapshots before crossing IPC", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();

    Array.from({ length: 25 }, (_value, index) => index).forEach((index) => {
      view.webContents.debugger.emitMessage(
        "Runtime.consoleAPICalled",
        {
          type: "log",
          timestamp: index,
          args: [{ type: "string", value: `row-${index}` }],
        },
        undefined,
      );
    });

    expect(harness.debugSnapshots).toHaveLength(0);
    vi.advanceTimersByTime(15);
    expect(harness.debugSnapshots).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(harness.debugSnapshots).toHaveLength(1);
    expect(harness.debugSnapshots[0]?.consoleEntries).toHaveLength(25);
  });

  it("truncates oversized console text and URLs before snapshotting", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();

    const longText = "x".repeat(5000);
    const longUrl = `http://localhost:3000/${"u".repeat(3000)}`;
    view.webContents.debugger.emitMessage(
      "Runtime.consoleAPICalled",
      {
        type: "error",
        timestamp: 1234,
        args: [{ type: "string", value: longText }],
        stackTrace: {
          callFrames: [
            {
              functionName: "fail",
              url: longUrl,
              lineNumber: 7,
              columnNumber: 12,
            },
          ],
        },
      },
      undefined,
    );
    view.webContents.debugger.emitMessage(
      "Network.requestWillBeSent",
      {
        requestId: "request-long",
        timestamp: 100_000,
        wallTime: 1_750_000_000,
        request: {
          url: longUrl,
          method: "GET",
        },
      },
      undefined,
    );

    const snapshot = harness.manager.getDebugSnapshot("window-1", BASE_KEY);
    expect(snapshot.consoleEntries[0]?.text).toHaveLength(4096);
    expect(snapshot.consoleEntries[0]?.text.endsWith("...")).toBe(true);
    expect(snapshot.consoleEntries[0]?.url).toHaveLength(2048);
    expect(snapshot.consoleEntries[0]?.url?.endsWith("...")).toBe(true);
    expect(snapshot.networkEntries[0]?.url).toHaveLength(2048);
    expect(snapshot.networkEntries[0]?.url.endsWith("...")).toBe(true);
  });

  it("captures a content-addressed page screenshot", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    harness.views[0].webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );

    const result = await harness.manager.capturePage("window-1", BASE_KEY);

    expect(result).toMatchObject({
      ...BASE_KEY,
      mediaType: "image/png",
      base64: "1",
    });
    expect(result.byteLength).toBeGreaterThanOrEqual(0);
    expect(result.sha256).toHaveLength(64);
    expect(result.capturedAt).toBeGreaterThan(0);
  });

  it("rejects screenshot capture while loading or occluded", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });

    await expect(
      harness.manager.capturePage("window-1", BASE_KEY),
    ).rejects.toThrow("tile is still loading");

    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await harness.manager.occludeForOverlay("window-1", {
      overlayId: "command-palette",
      tiles: [BASE_KEY],
    });

    await expect(
      harness.manager.capturePage("window-1", BASE_KEY),
    ).rejects.toThrow("tile is occluded");
  });

  it("keeps the debugger attached after releaseTile so the durable tab stays drivable (ticket 05)", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();
    expect(view.webContents.debugger.attached).toBe(true);

    harness.manager.releaseTile("window-1", BASE_KEY);
    vi.advanceTimersByTime(60_000);

    expect(view.webContents.debugger.attached).toBe(true);
    expect(view.webContents.debugger.detached).toBe(false);
    expect(view.webContents.closeCalls).toBe(0);
  });

  it("allows dispatchCdp after releaseTile while the durable WebContents remains live (ticket 05)", async () => {
    const harness = createHarness();
    const view = await upsertAndAttach(harness, "window-1", BASE_KEY);
    expect(view.webContents.debugger.attached).toBe(true);

    harness.manager.releaseTile("window-1", BASE_KEY);

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });

    expect(result.ok).toBe(true);
    expect(view.webContents.closeCalls).toBe(0);
  });

  it("still dispatches CDP after release when debugger was attached by posture keepalive (ticket 05)", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.debugger.attach("1.3");
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();
    expect(view.webContents.debugger.attached).toBe(true);

    harness.manager.releaseTile("window-1", BASE_KEY);

    const afterRelease = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });
    expect(afterRelease.ok).toBe(true);
    expect(view.webContents.debugger.attached).toBe(true);
  });

  it("rebind after release keeps the same debug session without requiring navigation (ticket 05)", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    await Promise.resolve();
    expect(view.webContents.debugger.attached).toBe(true);

    harness.manager.releaseTile("window-1", BASE_KEY);
    expect(view.webContents.debugger.attached).toBe(true);

    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    await Promise.resolve();

    expect(view.webContents.debugger.attached).toBe(true);
    expect(view.webContents.closeCalls).toBe(0);
    expect(harness.views).toHaveLength(1);
  });

  it("ignores subframe in-page navigations when projecting tile URL", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );
    const statusCount = harness.statuses.length;

    view.webContents.emit(
      "did-navigate-in-page",
      {},
      "http://iframe.example/#step",
      false,
      1,
      2,
    );

    expect(harness.statuses).toHaveLength(statusCount);
    expect(harness.manager.snapshotForTests()[0]?.requestedUrl).toBe(
      "http://localhost:3000",
    );

    view.webContents.emit(
      "did-navigate-in-page",
      {},
      "http://localhost:3000/#top",
      true,
      1,
      2,
    );

    expect(harness.statuses.at(-1)).toMatchObject({
      url: "http://localhost:3000/#top",
    });
    expect(harness.manager.snapshotForTests()[0]?.requestedUrl).toBe(
      "http://localhost:3000/#top",
    );
  });

  it("captures a snapshot before hiding a browser view for an overlay", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    expect(view.visible).toBe(true);

    const result = await harness.manager.occludeForOverlay("window-1", {
      overlayId: "command-palette",
      tiles: [BASE_KEY],
    });

    expect(view.webContents.captureVisibleStates).toEqual([true]);
    expect(view.visible).toBe(false);
    expect(result.restoredTiles).toEqual([]);
    expect(result.snapshots).toEqual([
      {
        ...BASE_KEY,
        dataUrl: "data:image/png;base64,1",
        stale: false,
      },
    ]);
    expect(harness.manager.snapshotForTests()[0]).toMatchObject({
      overlayOwnerIds: ["command-palette"],
      overlaySnapshotStale: false,
    });
  });

  it("keeps nested overlay ownership ref-counted until the last owner closes", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];

    await harness.manager.occludeForOverlay("window-1", {
      overlayId: "dialog",
      tiles: [BASE_KEY],
    });
    await harness.manager.occludeForOverlay("window-1", {
      overlayId: "dropdown",
      tiles: [BASE_KEY],
    });

    expect(view.webContents.captureVisibleStates).toEqual([true]);
    expect(view.visible).toBe(false);
    expect(harness.manager.snapshotForTests()[0]?.overlayOwnerIds).toEqual([
      "dialog",
      "dropdown",
    ]);

    expect(
      harness.manager.releaseOverlay("window-1", {
        overlayId: "dropdown",
      }),
    ).toEqual({ restoredTiles: [] });
    expect(view.visible).toBe(false);
    expect(harness.manager.snapshotForTests()[0]?.overlayOwnerIds).toEqual([
      "dialog",
    ]);

    expect(
      harness.manager.releaseOverlay("window-1", {
        overlayId: "dialog",
      }),
    ).toEqual({ restoredTiles: [BASE_KEY] });
    expect(view.visible).toBe(true);
    expect(harness.manager.snapshotForTests()[0]?.overlayOwnerIds).toEqual([]);
  });

  it("restores overlay-owned views in reverse occlusion order", async () => {
    const harness = createHarness();
    const secondKey: BrowserViewTileKey = {
      ...BASE_KEY,
      tileInstanceId: "tile-2",
      pageSessionId: "page-2",
    };
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    harness.manager.upsertTile(
      "window-1",
      upsert(secondKey, "http://localhost:3001", true),
    );
    harness.manager.updateBounds("window-1", {
      ...secondKey,
      bounds: { x: 500, y: 0, width: 500, height: 300 },
    });

    await harness.manager.occludeForOverlay("window-1", {
      overlayId: "drag",
      tiles: [BASE_KEY, secondKey],
    });

    expect(
      harness.manager
        .releaseOverlay("window-1", {
          overlayId: "drag",
        })
        .restoredTiles.map((tile) => tile.tileInstanceId),
    ).toEqual(["tile-2", "tile-1"]);
  });

  it("invalidates a hidden snapshot when the page repaints", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    await harness.manager.occludeForOverlay("window-1", {
      overlayId: "toast",
      tiles: [BASE_KEY],
    });

    view.webContents.emit("paint");

    expect(harness.snapshotInvalidations.at(-1)).toEqual({
      ...BASE_KEY,
      reason: "paint",
    });
    expect(harness.manager.snapshotForTests()[0]).toMatchObject({
      overlaySnapshotStale: true,
    });
  });

  it("guards browser history navigation with Chromium availability", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];

    harness.manager.goBack("window-1", BASE_KEY);
    harness.manager.goForward("window-1", BASE_KEY);

    expect(view.webContents.goBackCalls).toBe(0);
    expect(view.webContents.goForwardCalls).toBe(0);

    view.webContents.canGoBackValue = true;
    view.webContents.canGoForwardValue = true;
    view.webContents.emit("did-navigate", {}, "http://localhost:3000", 0, 0);
    harness.manager.goBack("window-1", BASE_KEY);
    harness.manager.goForward("window-1", BASE_KEY);

    expect(view.webContents.goBackCalls).toBe(1);
    expect(view.webContents.goForwardCalls).toBe(1);
    expect(harness.statuses.at(-1)).toMatchObject({
      status: "loading",
      canGoBack: true,
      canGoForward: true,
    });
  });

  it("uses navigationHistory instead of deprecated webContents history checks", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.canGoBackValue = true;
    view.webContents.canGoForwardValue = true;
    view.webContents.emit("did-navigate", {}, "http://localhost:3000", 0, 0);
    view.webContents.throwDeprecatedNavigation = true;

    expect(() => {
      harness.manager.goBack("window-1", BASE_KEY);
      harness.manager.goForward("window-1", BASE_KEY);
    }).not.toThrow();

    expect(view.webContents.goBackCalls).toBe(1);
    expect(view.webContents.goForwardCalls).toBe(1);
    expect(harness.statuses.at(-1)).toMatchObject({
      status: "loading",
      canGoBack: true,
      canGoForward: true,
    });
  });

  it("reports a failed initial load as a dead browser tile", async () => {
    const harness = createHarness();

    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://127.0.0.1:65535/", true),
    );
    await Promise.resolve();

    expect(harness.statuses.at(-1)).toMatchObject({
      ...BASE_KEY,
      status: "dead",
      reason: "Navigation failed",
      canGoBack: false,
      canGoForward: false,
    });
  });

  it("keeps the durable WebContents after release even when a subsequent load fails (ticket 05)", async () => {
    const harness = createHarness();

    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://127.0.0.1:65535/", true),
    );
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected view");
    harness.manager.releaseTile("window-1", BASE_KEY);

    view.webContents.emit(
      "did-fail-load",
      {},
      -102,
      "CONNECTION_REFUSED",
      "http://127.0.0.1:65535/",
      true,
    );
    await Promise.resolve();

    // Tile unbind is not a close: failed loads must not destroy the entry.
    expect(view.webContents.closeCalls).toBe(0);
    expect(harness.tileHandoffNotifications).toEqual([]);
  });

  it("runs in-page find and forwards native match updates", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];

    harness.manager.findInPage("window-1", {
      ...BASE_KEY,
      requestId: 7,
      query: "needle",
      matchCase: true,
      forward: true,
      findNext: false,
    });

    expect(view.webContents.findInPageCalls).toEqual([
      {
        requestId: 1,
        text: "needle",
        options: {
          forward: true,
          findNext: false,
          matchCase: true,
        },
      },
    ]);
    expect(harness.finds.at(-1)).toMatchObject({
      requestId: 7,
      query: "needle",
      matchCase: true,
      status: "searching",
    });

    view.webContents.emit(
      "found-in-page",
      {},
      {
        requestId: 1,
        matches: 3,
        activeMatchOrdinal: 2,
        finalUpdate: true,
      },
    );
    expect(harness.finds.at(-1)).toMatchObject({
      requestId: 7,
      status: "ready",
      current: 2,
      total: 3,
      finalUpdate: true,
    });

    harness.manager.findInPage("window-1", {
      ...BASE_KEY,
      requestId: 7,
      query: "needle",
      matchCase: true,
      forward: true,
      findNext: true,
    });
    expect(view.webContents.findInPageCalls.at(-1)).toEqual({
      requestId: 2,
      text: "needle",
      options: {
        forward: true,
        findNext: true,
        matchCase: true,
      },
    });
    view.webContents.emit(
      "found-in-page",
      {},
      {
        requestId: 2,
        matches: 3,
        activeMatchOrdinal: 3,
        finalUpdate: true,
      },
    );
    expect(harness.finds.at(-1)).toMatchObject({
      requestId: 7,
      status: "ready",
      current: 3,
      total: 3,
      finalUpdate: true,
    });

    harness.manager.stopFindInPage("window-1", {
      ...BASE_KEY,
      requestId: 8,
    });

    expect(view.webContents.stopFindCalls).toBe(1);
    expect(harness.finds.at(-1)).toMatchObject({
      requestId: 8,
      query: "",
      status: "idle",
      finalUpdate: true,
    });
  });

  it("updates zoom from manager calls and chromium keyboard shortcuts", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];

    harness.manager.zoomIn("window-1", BASE_KEY);

    expect(view.webContents.zoomFactor).toBe(1.1);
    expect(harness.statuses.at(-1)).toMatchObject({ zoomPercent: 110 });

    const preventDefault = vi.fn();
    view.webContents.emit(
      "before-input-event",
      { preventDefault },
      { type: "keyDown", key: "-", control: true },
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(view.webContents.zoomFactor).toBe(1);
    expect(harness.statuses.at(-1)).toMatchObject({ zoomPercent: 100 });

    view.webContents.emit(
      "before-input-event",
      { preventDefault },
      { type: "keyDown", key: "+", meta: true },
    );
    view.webContents.emit(
      "before-input-event",
      { preventDefault },
      { type: "keyDown", key: "0", meta: true },
    );

    expect(view.webContents.zoomFactor).toBe(1);
    expect(harness.statuses.at(-1)).toMatchObject({ zoomPercent: 100 });
  });

  it("routes target blank to a tile and featureful window.open popups to registered child windows", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "https://app.test/root", true),
    );
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "https://app.test/root",
      200,
      "OK",
      true,
    );
    const handler = view.webContents.windowOpenHandler;
    if (handler === null) throw new Error("window open handler missing");

    const targetBlankResult = handler({
      url: "/docs",
      frameName: "_blank",
      features: "",
      disposition: "new-window",
    });

    expect(targetBlankResult).toEqual({ action: "deny" });
    expect(harness.openTileRequests.at(-1)).toMatchObject({
      ...BASE_KEY,
      url: "https://app.test/docs",
      disposition: "new-window",
    });

    const popupResult = handler({
      url: "https://auth.test/login",
      frameName: "oauth",
      features: "width=500,height=640",
      disposition: "new-window",
    });

    expect(popupResult).toMatchObject({
      action: "allow",
      overrideBrowserWindowOptions: { width: 900 },
      outlivesOpener: false,
    });

    const popup = new FakePopupWindow(55);
    view.webContents.emit("did-create-window", popup);

    expect(harness.registeredPopupWebContents).toHaveLength(1);
    expect(harness.registeredPopupWebContents[0]?.id).toBe(55);
  });

  it("maps browser session download and certificate events to the owning tile", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "https://app.test/root", true),
    );
    const view = harness.views[0];

    harness.emitDownload({
      webContentsId: view.webContents.id,
      downloadId: "download-1",
      url: "https://app.test/file.zip",
      filename: "file.zip",
      mimeType: "application/zip",
      totalBytes: 100,
      receivedBytes: 25,
      state: "progressing",
      savePath: "/tmp/file.zip",
      dangerType: null,
      canCancel: true,
    });

    expect(harness.downloads.at(-1)).toMatchObject({
      ...BASE_KEY,
      downloadId: "download-1",
      receivedBytes: 25,
      state: "progressing",
    });

    harness.emitCertificateError({
      webContentsId: view.webContents.id,
      certificateErrorId: "cert-error-1",
      url: "https://self-signed.test/",
      hostname: "self-signed.test",
      error: "ERR_CERT_AUTHORITY_INVALID",
      fingerprint: "fingerprint",
      subject: "self-signed.test",
      issuer: "self-signed.test",
    });

    expect(harness.certificateErrors.at(-1)).toMatchObject({
      ...BASE_KEY,
      certificateErrorId: "cert-error-1",
      hostname: "self-signed.test",
    });
    expect(harness.statuses.at(-1)).toMatchObject({
      status: "dead",
      reason: "Certificate error",
    });
    expect(
      harness.manager.canTrustCertificateError("window-1", {
        ...BASE_KEY,
        certificateErrorId: "cert-error-1",
      }),
    ).toBe(true);

    harness.manager.clearCertificateError("window-1", {
      ...BASE_KEY,
      certificateErrorId: "cert-error-1",
    });

    expect(view.webContents.reloadCalls).toBe(1);
    expect(harness.statuses.at(-1)).toMatchObject({ status: "loading" });
  });

  it("marks a crashed renderer dead and closes the durable entry (ticket 05)", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    view.webContents.emit("render-process-gone", {}, { reason: "crashed" });

    expect(view.visible).toBe(false);
    expect(harness.statuses.at(-1)).toMatchObject({
      status: "dead",
      reason: "crashed",
    });
    // Ticket 05: renderer crash is a destructive close of the durable entry.
    await flushCloseEntry();
    expect(view.webContents.closeCalls).toBe(1);
    harness.manager.reloadTile("window-1", BASE_KEY);
    expect(view.webContents.reloadCalls).toBe(0);
  });

  it("ends an active element pick on same-document navigation", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    view.webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );

    const pickPromise = harness.manager.pickElement("window-1", BASE_KEY);
    // A synchronous SPA route change while the pick is establishing must end it.
    view.webContents.emit(
      "did-navigate-in-page",
      {},
      "http://localhost:3000/#step",
      true,
      1,
      2,
    );

    await expect(pickPromise).resolves.toEqual({ outcome: "cancelled" });
  });

  it("ends an active element pick when the renderer cancels", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    harness.views[0].webContents.emit(
      "did-frame-navigate",
      {},
      "http://localhost:3000",
      200,
      "OK",
      true,
    );

    const pickPromise = harness.manager.pickElement("window-1", BASE_KEY);
    harness.manager.cancelElementPick("window-1", BASE_KEY);

    await expect(pickPromise).resolves.toEqual({ outcome: "cancelled" });
  });

  it("cancels a queued control action before it reaches CDP when native input takes over", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    view.webContents.debugger.deferCommands = true;
    const grant = harness.manager.grantControl("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      origin: "http://localhost:3000",
      expiresAt: Date.now() + 60_000,
    });

    expect(grant).toEqual({ status: "granted", controlId: "control-1" });

    const first = harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-1",
      sensitiveApprovalId: null,
      action: { kind: "scroll", deltaX: 0, deltaY: 120 },
    });
    const second = harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-2",
      sensitiveApprovalId: null,
      action: { kind: "scroll", deltaX: 0, deltaY: 120 },
    });

    await Promise.resolve();
    expect(view.webContents.debugger.commands).toHaveLength(1);
    view.webContents.emit("input-event", {}, { type: "mouseDown" });
    view.webContents.debugger.commandResolvers[0]?.(null);

    await expect(first).resolves.toEqual({
      status: "cancelled",
      reason: "user took over",
    });
    await expect(second).resolves.toEqual({
      status: "cancelled",
      reason: "user took over",
    });
    expect(view.webContents.debugger.commands).toHaveLength(1);
    expect(harness.controlRevocations).toContainEqual(
      expect.objectContaining({
        controlId: "control-1",
        reason: "user took over",
      }),
    );
  });

  it("requires approval before typing into password fields", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.debugger.passwordSelectors.add("input[type=password]");
    const grant = harness.manager.grantControl("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      origin: "http://localhost:3000",
      expiresAt: Date.now() + 60_000,
    });

    expect(grant).toEqual({ status: "granted", controlId: "control-1" });

    const result = await harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-password",
      sensitiveApprovalId: null,
      action: {
        kind: "type",
        selector: "input[type=password]",
        text: "secret",
      },
    });

    expect(result).toMatchObject({
      status: "needs-approval",
      reason: "Typing into a password field requires explicit approval.",
    });
    expect(
      view.webContents.debugger.commands.some(
        (command) => command.method === "Input.insertText",
      ),
    ).toBe(false);
  });

  it("types into password fields only after the desktop approval id is returned", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.debugger.passwordSelectors.add("input[type=password]");
    harness.manager.grantControl("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      origin: "http://localhost:3000",
      expiresAt: Date.now() + 60_000,
    });
    const first = await harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-password",
      sensitiveApprovalId: null,
      action: {
        kind: "type",
        selector: "input[type=password]",
        text: "secret",
      },
    });
    if (first.status !== "needs-approval") {
      throw new Error("expected password typing to need approval");
    }

    const approved = await harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-password",
      sensitiveApprovalId: first.approvalId,
      action: {
        kind: "type",
        selector: "input[type=password]",
        text: "secret",
      },
    });

    expect(approved).toEqual({ status: "completed", value: null });
    expect(view.webContents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "Input.insertText",
        params: { text: "secret" },
      }),
    );
  });

  it("rejects sensitive approval retries when the typed text changes", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    view.webContents.debugger.passwordSelectors.add("input[type=password]");
    harness.manager.grantControl("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      origin: "http://localhost:3000",
      expiresAt: Date.now() + 60_000,
    });
    const first = await harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-password",
      sensitiveApprovalId: null,
      action: {
        kind: "type",
        selector: "input[type=password]",
        text: "approved-text",
      },
    });
    if (first.status !== "needs-approval") {
      throw new Error("expected password typing to need approval");
    }

    const changedText = await harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-password",
      sensitiveApprovalId: first.approvalId,
      action: {
        kind: "type",
        selector: "input[type=password]",
        text: "changed-text",
      },
    });

    expect(changedText).toMatchObject({
      status: "needs-approval",
      reason: "Typing into a password field requires explicit approval.",
    });
    expect(
      view.webContents.debugger.commands.some(
        (command) => command.method === "Input.insertText",
      ),
    ).toBe(false);
  });

  it("requires approval before typing into credit-card autocomplete fields", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    harness.manager.grantControl("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      origin: "http://localhost:3000",
      expiresAt: Date.now() + 60_000,
    });

    const result = await harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-cc",
      sensitiveApprovalId: null,
      action: {
        kind: "type",
        selector: 'input[autocomplete="cc-number"]',
        text: "4111111111111111",
      },
    });

    expect(result).toMatchObject({
      status: "needs-approval",
      reason: "Typing into a password field requires explicit approval.",
    });
    expect(
      view.webContents.debugger.commands.some(
        (command) => command.method === "Input.insertText",
      ),
    ).toBe(false);
  });

  it("types into non-password fields without approval", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    harness.manager.grantControl("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      origin: "http://localhost:3000",
      expiresAt: Date.now() + 60_000,
    });

    const result = await harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-type",
      sensitiveApprovalId: null,
      action: {
        kind: "type",
        selector: "input[name=query]",
        text: "hello",
      },
    });

    expect(result).toEqual({ status: "completed", value: null });
    expect(view.webContents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "Input.insertText",
        params: { text: "hello" },
      }),
    );
  });
});

async function upsertAndAttach(
  harness: Harness,
  windowId: string,
  key: BrowserViewTileKey,
): Promise<FakeBrowserView> {
  harness.manager.upsertTile(
    windowId,
    upsert(key, "http://localhost:3000", true),
  );
  const view = harness.views[harness.views.length - 1];
  view.webContents.emit(
    "did-frame-navigate",
    {},
    "http://localhost:3000",
    200,
    "OK",
    true,
  );
  await Promise.resolve();
  return view;
}

describe("BrowserViewManager CDP dispatch", () => {
  it("keeps agent CDP dispatch independent when native input cancels visible control", async () => {
    const harness = createHarness();
    await upsertAndAttach(harness, "window-1", BASE_KEY);
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected view");
    view.webContents.debugger.deferCommands = true;
    const commandsBeforeControl = view.webContents.debugger.commands.length;

    expect(
      harness.manager.grantControl("window-1", {
        ...BASE_KEY,
        controlId: "control-1",
        chatId: "chat-1",
        agentRunId: "agent-1",
        agentLabel: "Agent One",
        origin: "http://localhost:3000",
        expiresAt: Date.now() + 60_000,
      }),
    ).toEqual({ status: "granted", controlId: "control-1" });

    const control = harness.manager.executeControlAction("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      actionId: "action-1",
      sensitiveApprovalId: null,
      action: { kind: "scroll", deltaX: 0, deltaY: 120 },
    });
    await Promise.resolve();
    expect(view.webContents.debugger.commands).toHaveLength(
      commandsBeforeControl + 1,
    );

    view.webContents.emit("input-event", {}, { type: "mouseDown" });
    const agent = harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });
    await Promise.resolve();
    expect(view.webContents.debugger.commands).toHaveLength(
      commandsBeforeControl + 2,
    );

    view.webContents.debugger.commandResolvers[0]?.(null);
    view.webContents.debugger.commandResolvers[1]?.(null);
    await expect(control).resolves.toEqual({
      status: "cancelled",
      reason: "user took over",
    });
    await expect(agent).resolves.toMatchObject({
      kind: "cdpGetFrameTree",
      ok: true,
    });
    expect(harness.controlRevocations).toContainEqual(
      expect.objectContaining({
        controlId: "control-1",
        reason: "user took over",
      }),
    );
  });

  it("dispatches cdpNavigate as Page.navigate and returns the typed result", async () => {
    const harness = createHarness();
    await upsertAndAttach(harness, "window-1", BASE_KEY);

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpNavigate", url: "https://example.com" },
    });

    expect(harness.views[0].webContents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "Page.navigate",
        params: { url: "https://example.com" },
        sessionId: undefined,
      }),
    );
    expect(result).toEqual({
      kind: "cdpNavigate",
      ok: true,
      frameId: null,
      loaderId: null,
      errorText: null,
    });
  });

  it("dispatches cdpEvaluate as Runtime.evaluate, routing sessionId through to the debugger", async () => {
    const harness = createHarness();
    await upsertAndAttach(harness, "window-1", BASE_KEY);

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: "child-session-1",
      command: {
        kind: "cdpEvaluate",
        expression: "1 + 1",
        awaitPromise: false,
        returnByValue: true,
        contextId: null,
      },
    });

    expect(harness.views[0].webContents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "Runtime.evaluate",
        sessionId: "child-session-1",
      }),
    );
    expect(result).toMatchObject({ kind: "cdpEvaluate", ok: true });
  });

  it("enriches a generic 'Uncaught' cdpEvaluate exception with the page's own error text", async () => {
    const harness = createHarness();
    const view = await upsertAndAttach(harness, "window-1", BASE_KEY);
    view.webContents.debugger.deferCommands = true;

    const pending = harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: {
        kind: "cdpEvaluate",
        expression: "(() => { throw new Error('page-boom') })()",
        awaitPromise: false,
        returnByValue: true,
        contextId: null,
      },
    });
    // A bare "Uncaught" loses the page's own error text; the model needs the
    // real reason from `exception.description`, not the generic CDP
    // placeholder that `exceptionDetails.text` alone carries here.
    view.webContents.debugger.commandResolvers.at(-1)?.({
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "Error: page-boom\n    at <anonymous>:1:7" },
      },
    });
    const result = await pending;

    expect(result).toMatchObject({
      kind: "cdpEvaluate",
      ok: true,
      exceptionDescription:
        "Uncaught: Error: page-boom\n    at <anonymous>:1:7",
    });
  });

  it("enriches a generic 'Uncaught (in promise)' with the rejected value when there is no description", async () => {
    const harness = createHarness();
    const view = await upsertAndAttach(harness, "window-1", BASE_KEY);
    view.webContents.debugger.deferCommands = true;

    const pending = harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: {
        kind: "cdpEvaluate",
        expression: "Promise.reject('boom')",
        awaitPromise: true,
        returnByValue: true,
        contextId: null,
      },
    });
    // Rejected primitives have no `exception.description` - without the
    // value fallback they vanish behind the bare placeholder (mirrors the
    // host-side playwright-cdp-dispatch enrichment for the same CDP shape).
    view.webContents.debugger.commandResolvers.at(-1)?.({
      exceptionDetails: {
        text: "Uncaught (in promise)",
        exception: { value: "boom" },
      },
    });
    const result = await pending;

    expect(result).toMatchObject({
      kind: "cdpEvaluate",
      ok: true,
      exceptionDescription: 'Uncaught (in promise): "boom"',
    });
  });

  it("dispatches cdpDispatchMouseEvent as Input.dispatchMouseEvent", async () => {
    const harness = createHarness();
    await upsertAndAttach(harness, "window-1", BASE_KEY);

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: {
        kind: "cdpDispatchMouseEvent",
        type: "mouseMoved",
        x: 5,
        y: 5,
        button: null,
        clickCount: null,
        deltaX: null,
        deltaY: null,
      },
    });

    expect(harness.views[0].webContents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "Input.dispatchMouseEvent",
        params: expect.objectContaining({ type: "mouseMoved", x: 5, y: 5 }),
      }),
    );
    expect(result).toEqual({ kind: "cdpDispatchMouseEvent", ok: true });
  });

  it("dispatches cdpSetAutoAttach as Target.setAutoAttach with flatten always true", async () => {
    const harness = createHarness();
    await upsertAndAttach(harness, "window-1", BASE_KEY);

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: {
        kind: "cdpSetAutoAttach",
        autoAttach: true,
        waitForDebuggerOnStart: false,
      },
    });

    expect(harness.views[0].webContents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "Target.setAutoAttach",
        params: {
          autoAttach: true,
          flatten: true,
          waitForDebuggerOnStart: false,
        },
      }),
    );
    expect(result).toEqual({ kind: "cdpSetAutoAttach", ok: true });
  });

  it("dispatches cdpDescribeNode as DOM.describeNode with the caller's objectId", async () => {
    const harness = createHarness();
    await upsertAndAttach(harness, "window-1", BASE_KEY);

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: {
        kind: "cdpDescribeNode",
        objectId: "object-1",
        depth: null,
        pierce: false,
      },
    });

    expect(harness.views[0].webContents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "DOM.describeNode",
        params: { objectId: "object-1", pierce: false },
      }),
    );
    expect(result).toEqual({
      kind: "cdpDescribeNode",
      ok: true,
      nodeId: null,
      backendNodeId: null,
      nodeName: null,
      frameId: null,
    });
  });

  it("returns not_attached without sending any CDP command when the debugger has never attached", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });

    expect(result).toEqual({
      kind: "cdpGetFrameTree",
      ok: false,
      error: {
        kind: "not_attached",
        message: "Agent browser tile's debugger is not attached.",
        code: null,
      },
    });
    expect(view.webContents.debugger.commands).toHaveLength(0);
  });

  it("returns tile_not_found for a dispatch against an unknown tile", async () => {
    const harness = createHarness();

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });

    expect(result).toEqual({
      kind: "cdpGetFrameTree",
      ok: false,
      error: {
        kind: "tile_not_found",
        message: "Agent browser tile is not available.",
        code: null,
      },
    });
  });

  it("debugger detach ends agent access rather than merely logging it - revokes an active control grant and notifies the CDP bridge", async () => {
    const harness = createHarness();
    const view = await upsertAndAttach(harness, "window-1", BASE_KEY);
    const grant = harness.manager.grantControl("window-1", {
      ...BASE_KEY,
      controlId: "control-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      origin: "http://localhost:3000",
      expiresAt: Date.now() + 60_000,
    });
    expect(grant).toEqual({ status: "granted", controlId: "control-1" });

    view.webContents.debugger.emitDetach("target closed");

    expect(harness.cdpSessionEndedNotifications).toContainEqual(
      expect.objectContaining({
        tileInstanceId: BASE_KEY.tileInstanceId,
        reason: "target closed",
      }),
    );
    expect(harness.controlRevocations).toContainEqual(
      expect.objectContaining({
        controlId: "control-1",
        reason: "debugger detached: target closed",
      }),
    );
  });

  it("a dispatch issued right after detach fails fast with not_attached rather than hanging", async () => {
    const harness = createHarness();
    const view = await upsertAndAttach(harness, "window-1", BASE_KEY);

    view.webContents.debugger.emitDetach("target closed");

    const result = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });

    expect(result).toEqual({
      kind: "cdpGetFrameTree",
      ok: false,
      error: {
        kind: "not_attached",
        message: "Agent browser tile's debugger is not attached.",
        code: null,
      },
    });
  });
});

// -------------------------------------------------------------------------
// Ticket 12: closeEntry re-entrancy + handoff reason mapping
// -------------------------------------------------------------------------

describe("BrowserViewManager closeEntry re-entrancy and handoff reason mapping (ticket 12)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function upsertLiveTile(harness: Harness): FakeBrowserView {
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    if (view === undefined) {
      throw new Error("expected a view after upsert");
    }
    return view;
  }

  it("window destruction only unbinds durable entries; it does not hand off or close them (ticket 05)", async () => {
    const harness = createHarness();
    const view = upsertLiveTile(harness);
    const window = harness.windows.get("window-1");
    if (window === undefined) throw new Error("missing window-1");
    window.destroyed = true;

    harness.emitWindowChange();
    harness.emitWindowChange();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toEqual([]);
    expect(view.webContents.closeCalls).toBe(0);
    expect(view.visible).toBe(false);
  });

  it("releaseTile does not hand off; dispose still destroys the durable entry once (ticket 05)", async () => {
    const harness = createHarness();
    const view = upsertLiveTile(harness);

    harness.manager.releaseTile("window-1", BASE_KEY);
    expect(harness.tileHandoffNotifications).toEqual([]);
    expect(view.webContents.closeCalls).toBe(0);

    harness.manager.dispose();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toHaveLength(1);
    expect(harness.tileHandoffNotifications[0]?.reason).toBe("gui-quit");
    expect(view.webContents.closeCalls).toBe(1);
  });

  it("maps dispose teardown to reason gui-quit", async () => {
    const harness = createHarness();
    const view = upsertLiveTile(harness);

    harness.manager.dispose();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toEqual([
      expect.objectContaining({
        ...BASE_KEY,
        siblingTabs: [],
        reason: "gui-quit",
      }),
    ]);
    expect(view.webContents.closeCalls).toBe(1);
  });

  it("drains registered live entries and skips tiles mid-activation", async () => {
    const harness = createHarness();
    const liveKey = {
      ...BASE_KEY,
      tileInstanceId: "tile-live",
      pageSessionId: "page-live",
    };
    const activatingKey = {
      ...BASE_KEY,
      tileInstanceId: "tile-activating",
      pageSessionId: "page-activating",
    };

    harness.manager.upsertTile(
      "window-1",
      upsert(liveKey, "https://app.example/live", true),
    );
    harness.manager.registerDurableTab("window-1", {
      ...liveKey,
      sessionId: "session-live",
      tabId: "tab-live",
    });
    harness.manager.upsertTile(
      "window-1",
      upsert(activatingKey, "https://app.example/activating", true),
    );

    await harness.manager.drainBrowserHandoffs();

    expect(harness.tileHandoffNotifications).toEqual([
      expect.objectContaining({
        ...liveKey,
        capturedUrl: "https://app.example/live",
        capturedStorageState: { cookies: [], origins: [] },
        reason: "gui-quit",
      }),
    ]);
    expect(harness.storageStateCaptures).toHaveLength(1);
  });

  it("skips dead entries and prevents a drained entry from being pushed by dispose", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "https://app.example/live", true),
    );
    harness.manager.registerDurableTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-live",
      tabId: "tab-live",
    });
    const liveView = harness.views[0];
    if (liveView === undefined) throw new Error("missing live view");

    await harness.manager.drainBrowserHandoffs();
    expect(harness.tileHandoffNotifications).toHaveLength(1);

    const deadKey = {
      ...BASE_KEY,
      tileInstanceId: "tile-dead",
      pageSessionId: "page-dead",
    };
    harness.manager.upsertTile(
      "window-1",
      upsert(deadKey, "https://app.example/dead", true),
    );
    harness.manager.registerDurableTab("window-1", {
      ...deadKey,
      sessionId: "session-dead",
      tabId: "tab-dead",
    });
    const deadView = harness.views[1];
    if (deadView === undefined) throw new Error("missing dead view");
    deadView.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    await flushCloseEntry();
    expect(harness.tileHandoffNotifications).toHaveLength(2);
    expect(harness.tileHandoffNotifications.at(-1)?.reason).toBe(
      "crash-no-capture",
    );

    await harness.manager.drainBrowserHandoffs();
    harness.manager.dispose();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toHaveLength(2);
    expect(liveView.webContents.closeCalls).toBe(1);
  });

  it("aggregates every live durable tab into one handoff during group dispose", async () => {
    const harness = createHarness();
    const tabs = [
      {
        key: BASE_KEY,
        url: "https://app.example/primary",
        tabId: "tab-primary",
      },
      {
        key: {
          ...BASE_KEY,
          viewTabId: "view-tab-2",
          paneId: "pane-2",
          tileInstanceId: "tile-2",
          pageSessionId: "page-2",
        },
        url: "https://app.example/sibling-a",
        tabId: "tab-sibling-a",
      },
      {
        key: {
          ...BASE_KEY,
          viewTabId: "view-tab-3",
          paneId: "pane-3",
          tileInstanceId: "tile-3",
          pageSessionId: "page-3",
        },
        url: "https://app.example/sibling-b",
        tabId: "tab-sibling-b",
      },
    ] as const;

    for (const tab of tabs) {
      harness.manager.upsertTile("window-1", upsert(tab.key, tab.url, true));
      harness.manager.registerDurableTab("window-1", {
        ...tab.key,
        sessionId: "session-multi-tab",
        tabId: tab.tabId,
      });
    }

    harness.manager.dispose();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toHaveLength(1);
    expect(harness.tileHandoffNotifications[0]).toEqual({
      ...tabs[0].key,
      capturedUrl: tabs[0].url,
      capturedStorageState: { cookies: [], origins: [] },
      siblingTabs: [
        {
          tabId: tabs[1].tabId,
          url: tabs[1].url,
          capturedStorageState: { cookies: [], origins: [] },
        },
        {
          tabId: tabs[2].tabId,
          url: tabs[2].url,
          capturedStorageState: { cookies: [], origins: [] },
        },
      ],
      reason: "gui-quit",
    });
    expect(harness.views.map((view) => view.webContents.closeCalls)).toEqual([
      1,
      1,
      1,
    ]);
  });

  it("waits for a delayed sibling capture before closing its WebContents", async () => {
    const captureResolvers: Array<() => void> = [];
    const captureCalls: Array<{
      readonly webContentsId: number;
      readonly destroyed: boolean;
    }> = [];
    const harness = createHarnessWithOptions({
      captureStorageState: (_input, webContents) => {
        captureCalls.push({
          webContentsId: webContents.id,
          destroyed: webContents.isDestroyed(),
        });
        return new Promise<BrowserViewStorageStateCaptureResult>((resolve) => {
          captureResolvers.push(() => {
            resolve({
              storageState: { cookies: [], origins: [] },
              cookieCount: 0,
              cookieDomains: [],
              localStorageCount: 0,
              localStorageAvailable: true,
              localStorageReason: null,
            });
          });
        });
      },
    });
    const siblingKey: BrowserViewTileKey = {
      ...BASE_KEY,
      viewTabId: "view-tab-2",
      paneId: "pane-2",
      tileInstanceId: "tile-2",
      pageSessionId: "page-2",
    };
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "https://app.example/primary", true),
    );
    harness.manager.registerDurableTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-delayed-handoff",
      tabId: "tab-primary",
    });
    harness.manager.upsertTile(
      "window-1",
      upsert(siblingKey, "https://app.example/sibling", true),
    );
    harness.manager.registerDurableTab("window-1", {
      ...siblingKey,
      sessionId: "session-delayed-handoff",
      tabId: "tab-sibling",
    });

    harness.manager.dispose();
    await flushCloseEntry();

    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]).toEqual({
      webContentsId: harness.views[0]?.webContents.id,
      destroyed: false,
    });
    expect(harness.views[1]?.webContents.closeCalls).toBe(0);
    const releasePrimary = captureResolvers[0];
    if (releasePrimary === undefined) throw new Error("primary capture missing");
    releasePrimary();
    await flushCloseEntry();

    expect(captureCalls).toHaveLength(2);
    expect(captureCalls[1]).toEqual({
      webContentsId: harness.views[1]?.webContents.id,
      destroyed: false,
    });
    // This is the regression guard: the sibling is already claimed and its
    // own closeEntry is running, but it must remain live until aggregation
    // captures it.
    expect(harness.views[1]?.webContents.closeCalls).toBe(0);

    const releaseSibling = captureResolvers[1];
    if (releaseSibling === undefined) throw new Error("sibling capture missing");
    releaseSibling();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toHaveLength(1);
    expect(harness.views.map((view) => view.webContents.closeCalls)).toEqual([
      1,
      1,
    ]);
  });

  it("crash closes with crash-no-capture and skips storage capture (ticket 05)", async () => {
    const harness = createHarness();
    const view = upsertLiveTile(harness);
    const capturesBefore = harness.storageStateCaptures.length;
    view.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(harness.statuses.at(-1)).toMatchObject({ status: "dead" });
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toHaveLength(1);
    expect(harness.tileHandoffNotifications[0]).toMatchObject({
      ...BASE_KEY,
      reason: "crash-no-capture",
      capturedStorageState: null,
    });
    expect(harness.storageStateCaptures.length).toBe(capturesBefore);
    expect(view.webContents.closeCalls).toBe(1);
  });

  it("crash then dispose overrides reason to crash-no-capture regardless of gui-quit path", async () => {
    const harness = createHarness();
    const view = upsertLiveTile(harness);
    view.webContents.emit("render-process-gone", {}, { reason: "crashed" });

    harness.manager.dispose();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toHaveLength(1);
    expect(harness.tileHandoffNotifications[0]).toMatchObject({
      ...BASE_KEY,
      reason: "crash-no-capture",
      capturedStorageState: null,
    });
    expect(view.webContents.closeCalls).toBe(1);
  });

  it("crash then destroyed-window reconcile also reports crash-no-capture", async () => {
    const harness = createHarness();
    const view = upsertLiveTile(harness);
    view.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    const window = harness.windows.get("window-1");
    if (window === undefined) throw new Error("missing window-1");
    window.destroyed = true;

    harness.emitWindowChange();
    await flushCloseEntry();

    expect(harness.tileHandoffNotifications).toEqual([
      expect.objectContaining({
        reason: "crash-no-capture",
        capturedStorageState: null,
      }),
    ]);
    expect(view.webContents.closeCalls).toBe(1);
  });
});

describe("BrowserViewManager primary profile capture (ticket 06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("snapshots plain localStorage at navigation time and keeps an MRU of 8 origins", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "https://origin-0.example/", true),
    );
    const view = harness.views[0];
    if (view === undefined) throw new Error("missing view");

    for (
      let i = 0;
      i < PRIMARY_PROFILE_LOCAL_STORAGE_ORIGIN_LIMIT + 3;
      i += 1
    ) {
      const url = `https://origin-${i}.example/path`;
      view.webContents.emit("did-navigate", {}, url, 0, true);
      // rememberPrimaryProfileOrigin captures localStorage asynchronously.
      await Promise.resolve();
      await Promise.resolve();
    }

    const result = await harness.manager.capturePrimaryProfile();

    expect(result.status).toBe("captured");
    expect(harness.primaryProfileCaptureSourceOrigins).toHaveLength(1);
    const origins = harness.primaryProfileCaptureSourceOrigins[0] ?? [];
    expect(origins).toHaveLength(PRIMARY_PROFILE_LOCAL_STORAGE_ORIGIN_LIMIT);
    expect(origins[0]).toBe(
      `https://origin-${PRIMARY_PROFILE_LOCAL_STORAGE_ORIGIN_LIMIT + 2}.example`,
    );
    expect(origins.at(-1)).toBe("https://origin-3.example");
    // Capture path receives plain snapshots, not live WebContents handles.
    expect(result.storageState).toEqual({
      cookies: [],
      origins: origins.map((origin) => ({
        origin,
        localStorage: [{ name: "k", value: origin }],
      })),
    });
  });
});

describe("BrowserViewManager durable runtime registration (ticket 05)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registerDurableTab rekeys the runtime entry so rebind finds the same WebContents after release", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...BASE_KEY,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected view");

    harness.manager.registerDurableTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-durable",
      tabId: "tab-durable-1",
    });

    harness.manager.releaseTile("window-1", BASE_KEY);
    expect(view.webContents.closeCalls).toBe(0);
    expect(view.visible).toBe(false);

    // Same pageSessionId transfers the durable entry after host mint.
    const reboundKey: BrowserViewTileKey = {
      ...BASE_KEY,
      tileInstanceId: "tile-rebound",
    };
    harness.manager.upsertTile(
      "window-1",
      upsert(reboundKey, "http://localhost:3000", true),
    );
    harness.manager.updateBounds("window-1", {
      ...reboundKey,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
    });

    expect(harness.views).toHaveLength(1);
    expect(view.webContents.closeCalls).toBe(0);
    expect(view.visible).toBe(true);
    expect(harness.windows.get("window-1")?.contentView.children).toContain(
      view,
    );
  });

  it("releaseDurableTab destroys WebContents without a tile handoff", async () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", false),
    );
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected view");

    harness.manager.registerDurableTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-release",
      tabId: "tab-release",
    });
    await harness.manager.releaseDurableTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-release",
      tabId: "tab-release",
    });

    expect(view.webContents.closeCalls).toBe(1);
    expect(harness.tileHandoffNotifications).toEqual([]);
    expect(harness.manager.snapshotForTests()).toEqual([]);
  });

  it("releaseDurableTab closes a background entry when the failure tab id differs from its runtime id", async () => {
    const harness = createHarness();
    const creation = harness.manager.createBackgroundTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-headless-loss",
      tabId: "tab-source",
      url: "https://example.com/headless-loss",
    });
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected background view");
    view.webContents.emit("did-finish-load");
    await creation;

    harness.manager.registerDurableTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-headless-loss",
      tabId: "tab-minted",
    });
    await harness.manager.releaseDurableTab("window-1", {
      ...BASE_KEY,
      sessionId: "session-headless-loss",
      tabId: "tab-failure-source",
    });

    expect(view.webContents.closeCalls).toBe(1);
    expect(harness.manager.snapshotForTests()).toEqual([]);
  });

  it("target=_blank open requests still surface so same-session popup tabs can register", () => {
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "https://app.test/root", true),
    );
    const view = harness.views[0];
    if (view === undefined) throw new Error("expected view");
    const handler = view.webContents.windowOpenHandler;
    if (handler === null) throw new Error("window open handler missing");

    const result = handler({
      url: "https://app.test/popup",
      frameName: "_blank",
      features: "",
      disposition: "foreground-tab",
    });

    expect(result).toEqual({ action: "deny" });
    expect(harness.openTileRequests).toEqual([
      expect.objectContaining({
        ...BASE_KEY,
        url: "https://app.test/popup",
        disposition: "foreground-tab",
      }),
    ]);
  });
});
