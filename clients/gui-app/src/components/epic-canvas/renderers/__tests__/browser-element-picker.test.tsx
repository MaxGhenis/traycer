import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserElementPickerResultPanel,
  BrowserElementPickerToggle,
} from "@/components/epic-canvas/renderers/browser-element-picker";
import { useBrowserElementPicker } from "@/components/epic-canvas/renderers/use-browser-element-picker";
import {
  registerBrowserContextAttachmentHandler,
  type BrowserContextAttachmentPayload,
  type BrowserContextAttachmentResult,
} from "@/lib/browser-view/browser-context-attachments";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  BrowserViewControlAction,
  BrowserViewElementCapture,
  BrowserViewElementPickResult,
  BrowserViewStatus,
  BrowserViewTileKey,
  DesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";

const TILE: BrowserViewTileKey = {
  viewTabId: "view-tab",
  paneId: "pane",
  tileInstanceId: "tile",
  pageSessionId: "page",
};

const NEXT_TILE: BrowserViewTileKey = {
  viewTabId: "view-tab-next",
  paneId: "pane",
  tileInstanceId: "tile",
  pageSessionId: "page-next",
};

const ELEMENT: BrowserViewElementCapture = {
  selector: "main > button#go",
  tagName: "button",
  elementId: "go",
  classNames: ["primary"],
  attributes: [{ name: "id", value: "go" }],
  outerHtml: '<button id="go">Go</button>',
  outerHtmlTruncated: false,
  textPreview: "Go",
  ariaRole: "button",
  accessibleName: "Go",
  boundingBox: {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    top: 0,
    right: 10,
    bottom: 10,
    left: 0,
  },
  computedStyles: [{ property: "display", value: "flex" }],
};

function deferred(): {
  readonly promise: Promise<BrowserViewElementPickResult>;
  resolve: (value: BrowserViewElementPickResult) => void;
} {
  let resolve: (value: BrowserViewElementPickResult) => void = () => undefined;
  const promise = new Promise<BrowserViewElementPickResult>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createFakeBridge(
  pick: (input: BrowserViewTileKey) => Promise<BrowserViewElementPickResult>,
): {
  readonly bridge: DesktopBrowserViewBridge;
  readonly pickElement: (
    input: BrowserViewTileKey,
  ) => Promise<BrowserViewElementPickResult>;
  readonly cancelElementPick: (input: BrowserViewTileKey) => Promise<void>;
} {
  const pickElement = vi.fn(pick);
  const cancelElementPick = vi.fn((_input: BrowserViewTileKey) =>
    Promise.resolve(),
  );
  const disposable = { dispose: () => undefined };
  const bridge: DesktopBrowserViewBridge = {
    upsertTile: () => Promise.resolve(),
    registerDurableTab: () => Promise.resolve(),
    setViewportPreset: () => Promise.resolve(),
    updateBounds: () => Promise.resolve(),
    releaseTile: () => Promise.resolve(),
    reloadTile: () => Promise.resolve(),
    goBack: () => Promise.resolve(),
    goForward: () => Promise.resolve(),
    findInPage: () => Promise.resolve(),
    stopFindInPage: () => Promise.resolve(),
    cancelDownload: () => Promise.resolve(),
    trustCertificate: () => Promise.resolve(),
    zoomIn: () => Promise.resolve(),
    zoomOut: () => Promise.resolve(),
    resetZoom: () => Promise.resolve(),
    capturePage: (input) =>
      Promise.resolve({
        ...input,
        mediaType: "image/png",
        base64: "",
        byteLength: 0,
        sha256: "",
        capturedAt: 0,
      }),
    getDebugSnapshot: (input) =>
      Promise.resolve({ ...input, consoleEntries: [], networkEntries: [] }),
    clearDebugEvents: () => Promise.resolve(),
    pickElement,
    cancelElementPick,
    openDevTools: () => Promise.resolve(),
    occludeForOverlay: () =>
      Promise.resolve({ snapshots: [], restoredTiles: [] }),
    releaseOverlay: () => Promise.resolve({ restoredTiles: [] }),
    getCookieCryptoState: () =>
      Promise.resolve({
        mode: "real",
        persistence: "persistent",
        reason: "os-backed",
        storageBackend: null,
        encryptionAvailable: true,
        mockKeychainEnabled: false,
      }),
    setLabsState: () => Promise.resolve(),
    applyStorageState: () =>
      Promise.resolve({
        status: "applied" as const,
        cookieCount: 0,
        localStorageApplied: false as const,
        reason: "cookies-only" as const,
      }),
    captureStorageState: () =>
      Promise.resolve({
        storageState: { cookies: [], origins: [] },
        cookieCount: 0,
        cookieDomains: [],
        localStorageCount: 0,
        localStorageAvailable: true,
        localStorageReason: null,
      }),
    grantControl: (input) =>
      Promise.resolve({
        status: "granted" as const,
        controlId: input.controlId,
      }),
    revokeControl: () => Promise.resolve(),
    executeControlAction: (_input: BrowserViewControlAction) =>
      Promise.resolve({ status: "completed" as const, value: null }),
    onStatusChange: () => disposable,
    onFindChange: () => disposable,
    onDownloadChange: () => disposable,
    onCertificateError: () => disposable,
    onOpenTileRequest: () => disposable,
    onSnapshotInvalidated: () => disposable,
    onDebugSnapshotChange: () => disposable,
    onControlRevoked: () => disposable,
    // Ticket 09's borrowed-tile CDP members. Inert here - this fake exists
    // for the element picker, which never drives a tile.
    dispatchCdp: () =>
      Promise.resolve({
        kind: "cdpGetFrameTree" as const,
        ok: false as const,
        error: {
          kind: "tile_not_found" as const,
          message: "Fake bridge does not dispatch CDP.",
          code: null,
        },
      }),
    onCdpSessionEnded: () => disposable,
    onCdpTargetAttached: () => disposable,
    onTileHandoff: () => disposable,
  };
  return { bridge, pickElement, cancelElementPick };
}

function Harness(props: {
  readonly bridge: DesktopBrowserViewBridge | null;
  readonly tileKey: BrowserViewTileKey;
  readonly status: BrowserViewStatus;
}) {
  const controller = useBrowserElementPicker({
    browserView: props.bridge,
    tileKey: props.tileKey,
    status: props.status,
    targetChatId: "chat-1",
  });
  return (
    <TooltipProvider>
      <BrowserElementPickerToggle controller={controller} />
      <BrowserElementPickerResultPanel controller={controller} />
    </TooltipProvider>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useBrowserElementPicker", () => {
  it("disables the toggle until the page is ready", () => {
    const fake = createFakeBridge(() =>
      Promise.resolve({ outcome: "cancelled" }),
    );
    render(<Harness bridge={fake.bridge} tileKey={TILE} status="loading" />);
    expect(
      screen
        .getByRole("button", { name: "Inspect an element" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("picks an element and sends it through the attachment seam", async () => {
    const handler = vi.fn(
      (request: {
        readonly targetChatId: string;
        readonly payload: BrowserContextAttachmentPayload;
      }): BrowserContextAttachmentResult => ({
        status: "attached",
        payload: request.payload,
      }),
    );
    const registration = registerBrowserContextAttachmentHandler(handler);
    const pick = deferred();
    const fake = createFakeBridge(() => pick.promise);
    render(<Harness bridge={fake.bridge} tileKey={TILE} status="ready" />);

    fireEvent.click(screen.getByRole("button", { name: "Inspect an element" }));
    expect(fake.pickElement).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("browser-element-picker-hint")).toBeTruthy();

    pick.resolve({
      outcome: "picked",
      pageUrl: "http://x/",
      element: ELEMENT,
    });
    await flush();

    expect(screen.getByTestId("browser-element-picker-result")).toBeTruthy();
    expect(screen.getByText("main > button#go")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Send element to agent" }),
    );
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      targetChatId: "chat-1",
      payload: {
        kind: "browser-element",
        element: { selector: "main > button#go" },
      },
    });
    registration.dispose();
  });

  it("surfaces the iframe-not-inspectable state without a capture", async () => {
    const pick = deferred();
    const fake = createFakeBridge(() => pick.promise);
    render(<Harness bridge={fake.bridge} tileKey={TILE} status="ready" />);

    fireEvent.click(screen.getByRole("button", { name: "Inspect an element" }));
    pick.resolve({
      outcome: "iframe-not-inspectable",
      pageUrl: "http://x/",
      frameLabel: "https://embed.example/widget",
    });
    await flush();

    expect(screen.getByTestId("browser-element-picker-iframe")).toBeTruthy();
    expect(screen.queryByTestId("browser-element-picker-result")).toBeNull();
    expect(screen.getByText("https://embed.example/widget")).toBeTruthy();
  });

  it("cancels the pick when toggled off mid-pick", async () => {
    const pick = deferred();
    const fake = createFakeBridge(() => pick.promise);
    render(<Harness bridge={fake.bridge} tileKey={TILE} status="ready" />);

    const toggle = screen.getByRole("button", { name: "Inspect an element" });
    fireEvent.click(toggle);
    expect(screen.getByTestId("browser-element-picker-hint")).toBeTruthy();

    fireEvent.click(toggle);
    expect(fake.cancelElementPick).toHaveBeenCalledWith(TILE);
    expect(screen.queryByTestId("browser-element-picker-hint")).toBeNull();

    pick.resolve({ outcome: "cancelled" });
    await flush();
    expect(screen.queryByTestId("browser-element-picker-result")).toBeNull();
  });

  it("cancels on Escape pressed from the app renderer", async () => {
    const pick = deferred();
    const fake = createFakeBridge(() => pick.promise);
    render(<Harness bridge={fake.bridge} tileKey={TILE} status="ready" />);

    fireEvent.click(screen.getByRole("button", { name: "Inspect an element" }));
    expect(screen.getByTestId("browser-element-picker-hint")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(fake.cancelElementPick).toHaveBeenCalledWith(TILE);
    expect(screen.queryByTestId("browser-element-picker-hint")).toBeNull();

    pick.resolve({ outcome: "cancelled" });
    await flush();
  });

  it("clears the active picker state when the tile key changes mid-pick", async () => {
    const pick = deferred();
    const fake = createFakeBridge(() => pick.promise);
    const view = render(
      <Harness bridge={fake.bridge} tileKey={TILE} status="ready" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect an element" }));
    expect(screen.getByTestId("browser-element-picker-hint")).toBeTruthy();

    view.rerender(
      <Harness bridge={fake.bridge} tileKey={NEXT_TILE} status="ready" />,
    );

    expect(fake.cancelElementPick).toHaveBeenCalledTimes(1);
    expect(fake.cancelElementPick).toHaveBeenCalledWith(TILE);
    expect(screen.queryByTestId("browser-element-picker-hint")).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(fake.cancelElementPick).toHaveBeenCalledTimes(1);

    pick.resolve({
      outcome: "picked",
      pageUrl: "http://stale/",
      element: ELEMENT,
    });
    await flush();
    expect(screen.queryByTestId("browser-element-picker-result")).toBeNull();
  });
});
