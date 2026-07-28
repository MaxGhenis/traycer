import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserViewManager,
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
    this.commands.push({ method, params: commandParams, sessionId });
    if (this.deferCommands) {
      return new Promise((resolve) => {
        this.commandResolvers.push(resolve);
      });
    }
    if (method === "Runtime.evaluate") {
      return Promise.resolve(this.evaluateRuntime(commandParams));
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
  readonly debugger = new FakeDebugger();
  readonly navigationHistory = {
    canGoBack: () => this.canGoBackValue,
    canGoForward: () => this.canGoForwardValue,
    goBack: () => {
      this.goBackCalls += 1;
    },
    goForward: () => {
      this.goForwardCalls += 1;
    },
  };
  readonly loadUrls: string[] = [];
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
  stopFindCalls = 0;
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
    this.url = url;
    this.loadUrls.push(url);
    if (url === "http://127.0.0.1:65535/") {
      return Promise.reject(new Error("ERR_CONNECTION_REFUSED"));
    }
    return Promise.resolve(null);
  }

  executeJavaScript(): Promise<unknown> {
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
  readonly snapshotInvalidations: BrowserViewSnapshotInvalidatedChange[];
  readonly storageStateApplications: BrowserViewStorageStateApply[];
  readonly storageStateCaptures: BrowserViewStorageStateCapture[];
  readonly registeredPopupWebContents: BrowserViewPopupWebContents[];
  emitDownload(change: BrowserSessionDownloadChange): void;
  emitCertificateError(change: BrowserSessionCertificateErrorChange): void;
  emitWindowChange(): void;
}

function createHarness(): Harness {
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
  const snapshotInvalidations: BrowserViewSnapshotInvalidatedChange[] = [];
  const storageStateApplications: BrowserViewStorageStateApply[] = [];
  const storageStateCaptures: BrowserViewStorageStateCapture[] = [];
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
    captureStorageState: (input) => {
      storageStateCaptures.push(input);
      return Promise.resolve({
        storageState: { cookies: [], origins: [] },
        cookieCount: 0,
        cookieDomains: [],
        localStorageCount: 0,
        localStorageAvailable: true,
        localStorageReason: null,
      });
    },
    releaseGraceMs: 10,
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
    snapshotInvalidations,
    storageStateApplications,
    storageStateCaptures,
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
      harness.manager.applyStorageState({ storageState }),
    ).resolves.toEqual({
      status: "applied",
      cookieCount: 1,
      localStorageApplied: false,
      reason: "cookies-only",
    });
    expect(harness.storageStateApplications).toEqual([{ storageState }]);
  });

  it("closes webContents after a released tile is not claimed again", () => {
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
    vi.advanceTimersByTime(9);
    expect(view.webContents.closeCalls).toBe(0);

    vi.advanceTimersByTime(1);
    expect(view.webContents.closeCalls).toBe(1);
    expect(harness.windows.get("window-1")?.contentView.children).toEqual([]);
  });

  it("hides released views during grace and shows them again when reclaimed", () => {
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

    vi.advanceTimersByTime(5);
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );

    expect(view.webContents.closeCalls).toBe(0);
    expect(view.visible).toBe(true);
    vi.advanceTimersByTime(10);
    expect(view.webContents.closeCalls).toBe(0);
    expect(harness.views).toHaveLength(1);
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

  it("detaches the debugger when the tile closes after release grace", async () => {
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
    vi.advanceTimersByTime(10);

    expect(view.webContents.debugger.detached).toBe(true);
    expect(view.webContents.closeCalls).toBe(1);
  });

  it("ends CDP access synchronously on releaseTile, not only once the grace period tears the view down", async () => {
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

    // The debugger must already be detached before any part of the grace
    // period elapses - "released" and "still drivable via CDP" must never
    // both be true, even for the 10ms this harness's `releaseGraceMs`
    // configures. The webContents itself is not torn down yet (that is
    // still deferred to the grace period, so a fast release+reclaim can
    // reuse it), only the CDP access ends immediately.
    expect(view.webContents.debugger.detached).toBe(true);
    expect(view.webContents.closeCalls).toBe(0);
  });

  it("rejects dispatchCdp with not_attached immediately after releaseTile, while the view is still open", async () => {
    const harness = createHarness();
    const view = await upsertAndAttach(harness, "window-1", BASE_KEY);
    expect(view.webContents.debugger.attached).toBe(true);

    harness.manager.releaseTile("window-1", BASE_KEY);

    // Stronger than checking debugger.detached alone: the public dispatch
    // gate must refuse access the moment release returns, even though the
    // webContents is still alive for the grace window (closeCalls still 0).
    // That is the property a caller relying on "released means undrivable"
    // actually needs.
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
    expect(view.webContents.closeCalls).toBe(0);
  });

  it("refuses dispatchCdp after releaseTile even when the debugger was attached by something other than BrowserDebugSession", async () => {
    // Ticket 15 P1-2: agent-browser-posture.ts's background keepalive
    // attaches webContents.debugger directly, independently of
    // BrowserDebugSession, and typically wins the race against it (it runs
    // at view-creation time, before any navigation commit). When that
    // happens, BrowserDebugSession.enableAfterCommit() sees the debugger is
    // already attached and never marks itself the attacher
    // (`attachedBySession` stays false), so its own dispose() skips
    // detach() entirely - releaseTile's fix must not depend on
    // BrowserDebugSession having been the one to attach.
    const harness = createHarness();
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    const view = harness.views[0];
    // Simulate the posture keepalive's independent attach, ahead of the
    // navigation commit that would otherwise let BrowserDebugSession attach
    // it first.
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

    const beforeRelease = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });
    expect(beforeRelease.ok).toBe(true);

    harness.manager.releaseTile("window-1", BASE_KEY);

    const afterRelease = await harness.manager.dispatchCdp("window-1", {
      ...BASE_KEY,
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
    });
    expect(afterRelease).toEqual({
      kind: "cdpGetFrameTree",
      ok: false,
      error: {
        kind: "not_attached",
        message: "Agent browser tile's debugger is not attached.",
        code: null,
      },
    });
    // The gate is what refuses it; the debugger itself is also expected to
    // end up detached (the unconditional secondary cleanup), but that is not
    // what this test is pinning - "rejects dispatchCdp..." above covers the
    // BrowserDebugSession-attached case, this one covers the other attacher.
    expect(view.webContents.debugger.detached).toBe(true);
  });

  it("re-arms the debug session when a released tile is reclaimed within the grace period", async () => {
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
    expect(view.webContents.debugger.detached).toBe(true);

    vi.advanceTimersByTime(5);
    // Reclaimed with the SAME url, so nothing navigates and no commit event
    // fires - re-arming CDP access can only come from the reclaim path
    // itself, which is exactly what this pins.
    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://localhost:3000", true),
    );
    await Promise.resolve();

    expect(view.webContents.debugger.attached).toBe(true);

    vi.advanceTimersByTime(10);
    expect(view.webContents.closeCalls).toBe(0);
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

  it("does not emit status from a failed load after the tile was released", async () => {
    const harness = createHarness();

    harness.manager.upsertTile(
      "window-1",
      upsert(BASE_KEY, "http://127.0.0.1:65535/", true),
    );
    const beforeReleaseStatusCount = harness.statuses.length;
    harness.manager.releaseTile("window-1", BASE_KEY);
    vi.advanceTimersByTime(10);
    await Promise.resolve();

    expect(harness.views[0].webContents.closeCalls).toBe(1);
    expect(harness.statuses).toHaveLength(beforeReleaseStatusCount);
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

  it("marks a crashed renderer dead and reloads on request", () => {
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

    harness.manager.reloadTile("window-1", BASE_KEY);
    expect(view.webContents.reloadCalls).toBe(1);
    expect(harness.statuses.at(-1)).toMatchObject({ status: "loading" });
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
