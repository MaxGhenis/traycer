import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserTileNameForUrl,
  normalizeBrowserAddressInput,
  openFreshBrowserTileFromBrowserPage,
  routeBrowserLink,
  type BrowserLinkSource,
} from "@/lib/browser-view/browser-link-routing-core";
import { createSingleTileCanvas } from "@/stores/epics/canvas/actions";
import { collectPanes } from "@/stores/epics/canvas/tile-tree";
import { makeBrowserTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import {
  isBrowserTileRef,
  type BrowserTileRef,
  type EpicCanvasTileRef,
  type EpicCanvasState,
} from "@/stores/epics/canvas/types";
import { useSettingsStore } from "@/stores/settings/settings-store";

const VIEW_TAB_ID = "view-tab-routing";
const HOST_ID = "host-routing";
const SOURCE_TILE: EpicCanvasTileRef = {
  id: "ticket-routing",
  instanceId: "ticket-routing-instance",
  type: "ticket",
  name: "Ticket",
  hostId: HOST_ID,
};

function resetStores(): void {
  useEpicCanvasStore.setState({
    canvasByTabId: {},
    tabsById: {},
  });
  useSettingsStore.setState({
    inAppBrowserBetaEnabled: false,
    browserLinkDefaultMode: "in-app",
    terminalBrowserLinkOpenMode: "in-app",
    markdownBrowserLinkOpenMode: "in-app",
    browserDevOrigins: [],
  });
}

function mockRunnerHost() {
  return {
    openExternalLink: vi.fn(() => Promise.resolve()),
  };
}

function seedCanvas(node: EpicCanvasTileRef): BrowserLinkSource {
  const canvas = createSingleTileCanvas(node);
  const pane = singlePane(canvas);
  useEpicCanvasStore.setState({
    tabsById: {
      [VIEW_TAB_ID]: {
        tabId: VIEW_TAB_ID,
        epicId: "epic-routing",
        name: "Routing",
      },
    },
    canvasByTabId: {
      [VIEW_TAB_ID]: canvas,
    },
  });
  return {
    viewTabId: VIEW_TAB_ID,
    paneId: pane.id,
    hostId: node.hostId,
  };
}

function singlePane(canvas: EpicCanvasState) {
  const pane = collectPanes(canvas.root).at(0);
  if (pane === undefined) throw new Error("expected a pane");
  return pane;
}

function browserTiles(): ReadonlyArray<BrowserTileRef> {
  const canvas = useEpicCanvasStore.getState().canvasByTabId[VIEW_TAB_ID];
  if (canvas === undefined) return [];
  return Object.values(canvas.tilesByInstanceId).filter(
    (tile): tile is BrowserTileRef =>
      tile !== undefined && isBrowserTileRef(tile),
  );
}

describe("browser link routing", () => {
  beforeEach(resetStores);
  afterEach(resetStores);

  it("keeps web links external while the browser beta is disabled", () => {
    const source = seedCanvas(SOURCE_TILE);
    const runnerHost = mockRunnerHost();

    const result = routeBrowserLink({
      runnerHost,
      source,
      kind: "terminal",
      url: "https://example.test/docs",
      event: null,
    });

    expect(result).toBe("external");
    expect(runnerHost.openExternalLink).toHaveBeenCalledWith(
      "https://example.test/docs",
    );
    expect(browserTiles()).toHaveLength(0);
  });

  it("opens http links in a new browser page session when enabled", () => {
    const source = seedCanvas(SOURCE_TILE);
    const runnerHost = mockRunnerHost();
    useSettingsStore.setState({ inAppBrowserBetaEnabled: true });

    const result = routeBrowserLink({
      runnerHost,
      source,
      kind: "markdown",
      url: "https://example.test/docs",
      event: null,
    });

    expect(result).toBe("in-app");
    expect(runnerHost.openExternalLink).not.toHaveBeenCalled();
    expect(browserTiles()).toMatchObject([
      {
        type: "browser",
        hostId: HOST_ID,
        name: "example.test",
        url: "https://example.test/docs",
      },
    ]);
  });

  it("does not derive browser page-session identity from URL", () => {
    const source = seedCanvas(SOURCE_TILE);
    const runnerHost = mockRunnerHost();
    const backgroundBrowser = makeBrowserTileRef({
      name: "Background browser",
      hostId: HOST_ID,
      url: "https://example.test/reuse",
      viewportPreset: "responsive",
    });
    useSettingsStore.setState({ inAppBrowserBetaEnabled: true });
    useEpicCanvasStore
      .getState()
      .openTileInBackgroundTab(VIEW_TAB_ID, backgroundBrowser);

    routeBrowserLink({
      runnerHost,
      source,
      kind: "terminal",
      url: "https://example.test/reuse",
      event: null,
    });

    const tiles = browserTiles();
    expect(tiles).toHaveLength(2);
    expect(tiles.map((tile) => tile.url)).toEqual([
      "https://example.test/reuse",
      "https://example.test/reuse",
    ]);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(2);
  });

  it("reuses a focused browser tile in another pane for non-browser source links", () => {
    const source = seedCanvas(SOURCE_TILE);
    const runnerHost = mockRunnerHost();
    const browserTile = makeBrowserTileRef({
      name: "Browser",
      hostId: HOST_ID,
      url: "https://old.example/",
      viewportPreset: "responsive",
    });
    useSettingsStore.setState({ inAppBrowserBetaEnabled: true });
    useEpicCanvasStore
      .getState()
      .splitPaneWithNode(VIEW_TAB_ID, source.paneId, "right", browserTile);

    const result = routeBrowserLink({
      runnerHost,
      source,
      kind: "terminal",
      url: "https://new.example/docs",
      event: null,
    });

    const tiles = browserTiles();
    expect(result).toBe("in-app");
    expect(runnerHost.openExternalLink).not.toHaveBeenCalled();
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      id: browserTile.id,
      instanceId: browserTile.instanceId,
      url: "https://new.example/docs",
    });
  });

  it("updates an active browser tile through the mutable URL path", () => {
    const browserTile = makeBrowserTileRef({
      name: "Old",
      hostId: HOST_ID,
      url: "https://old.example/",
      viewportPreset: "responsive",
    });
    const source = seedCanvas(browserTile);
    const runnerHost = mockRunnerHost();
    useSettingsStore.setState({ inAppBrowserBetaEnabled: true });

    const result = routeBrowserLink({
      runnerHost,
      source,
      kind: "markdown",
      url: "https://new.example/docs",
      event: null,
    });

    const tiles = browserTiles();
    expect(result).toBe("in-app");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      id: browserTile.id,
      instanceId: browserTile.instanceId,
      url: "https://new.example/docs",
    });
  });

  it("honors per-kind settings and the alt-click override", () => {
    const source = seedCanvas(SOURCE_TILE);
    const runnerHost = mockRunnerHost();
    useSettingsStore.setState({
      inAppBrowserBetaEnabled: true,
      browserLinkDefaultMode: "per-kind",
      terminalBrowserLinkOpenMode: "in-app",
      markdownBrowserLinkOpenMode: "external",
    });

    expect(
      routeBrowserLink({
        runnerHost,
        source,
        kind: "markdown",
        url: "https://example.test/markdown",
        event: null,
      }),
    ).toBe("external");
    expect(
      routeBrowserLink({
        runnerHost,
        source,
        kind: "markdown",
        url: "https://example.test/markdown-alt",
        event: { altKey: true },
      }),
    ).toBe("in-app");
    expect(
      routeBrowserLink({
        runnerHost,
        source,
        kind: "terminal",
        url: "https://example.test/terminal-alt",
        event: { altKey: true },
      }),
    ).toBe("external");

    expect(browserTiles().map((tile) => tile.url)).toEqual([
      "https://example.test/markdown-alt",
    ]);
  });

  it("records terminal dev-server origins from URL output only", () => {
    const source = seedCanvas(SOURCE_TILE);
    const runnerHost = mockRunnerHost();
    useSettingsStore.setState({ inAppBrowserBetaEnabled: true });

    routeBrowserLink({
      runnerHost,
      source,
      kind: "terminal",
      url: "http://localhost:5173/ready",
      event: null,
    });
    routeBrowserLink({
      runnerHost,
      source,
      kind: "terminal",
      url: "http://localhost:5173/again",
      event: null,
    });
    routeBrowserLink({
      runnerHost,
      source,
      kind: "markdown",
      url: "http://localhost:5174/docs",
      event: null,
    });

    expect(useSettingsStore.getState().browserDevOrigins).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("opens browser page popup requests as fresh browser tiles", () => {
    const browserTile = makeBrowserTileRef({
      name: "Source browser",
      hostId: HOST_ID,
      url: "https://source.example/",
      viewportPreset: "responsive",
    });
    const source = seedCanvas(browserTile);

    const opened = openFreshBrowserTileFromBrowserPage({
      viewTabId: source.viewTabId,
      paneId: source.paneId,
      hostId: source.hostId,
      url: "https://popup.example/oauth",
    });

    const tiles = browserTiles();
    expect(opened).toBe(true);
    expect(tiles).toHaveLength(2);
    expect(tiles.map((tile) => tile.url)).toEqual([
      "https://source.example/",
      "https://popup.example/oauth",
    ]);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(2);
  });
});

describe("browser address helpers", () => {
  it("normalizes address bar input conservatively", () => {
    expect(normalizeBrowserAddressInput("example.test/docs")).toBe(
      "https://example.test/docs",
    );
    expect(normalizeBrowserAddressInput("localhost:5173")).toBe(
      "http://localhost:5173",
    );
    expect(normalizeBrowserAddressInput("about:blank")).toBe("about:blank");
    expect(normalizeBrowserAddressInput("   ")).toBe("about:blank");
  });

  it("derives browser tile names from URL hostnames", () => {
    expect(browserTileNameForUrl("https://docs.example.test/path")).toBe(
      "docs.example.test",
    );
    expect(browserTileNameForUrl("about:blank")).toBe("New browser");
  });
});
