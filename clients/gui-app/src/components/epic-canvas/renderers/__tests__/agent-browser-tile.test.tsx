import "../../../../../__tests__/test-browser-apis";
import {
  cleanup,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBrowserTile } from "@/components/epic-canvas/renderers/agent-browser-tile";
import type {
  AgentBrowserViewTileUpsert,
  DesktopAgentBrowserViewBridge,
} from "@/lib/browser-view/desktop-agent-browser-view";
import type {
  BrowserViewBoundsUpdate,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";
import { TILE_KIND_AGENT_BROWSER } from "@/stores/epics/canvas/tile-kinds";
import type { AgentBrowserTileRef } from "@/stores/epics/canvas/types";

const bridgeHarness = vi.hoisted<{
  current: DesktopAgentBrowserViewBridge | null;
}>(() => ({ current: null }));

const visibilityHarness = vi.hoisted<{ visible: boolean }>(() => ({
  visible: true,
}));

vi.mock("@/components/epic-canvas/hooks/use-tab-host-id", () => ({
  useTabHostId: () => "host-test",
}));

vi.mock("@/components/epic-canvas/hooks/use-tile-body-visible", () => ({
  useTileBodyVisible: () => visibilityHarness.visible,
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => ({ agentBrowserView: bridgeHarness.current }),
}));

const NODE: AgentBrowserTileRef = {
  id: "agent-browser-page-1",
  instanceId: "agent-browser-instance-1",
  type: TILE_KIND_AGENT_BROWSER,
  name: "Agent browser",
  hostId: "host-test",
  url: "https://example.com",
};

class FakeAgentBrowserViewBridge implements DesktopAgentBrowserViewBridge {
  readonly upsertCalls: AgentBrowserViewTileUpsert[] = [];
  readonly releaseCalls: BrowserViewTileKey[] = [];
  readonly boundsCalls: BrowserViewBoundsUpdate[] = [];
  private readonly statusHandlers = new Set<
    (change: BrowserViewStatusChange) => void
  >();

  upsertTile(input: AgentBrowserViewTileUpsert): Promise<void> {
    this.upsertCalls.push(input);
    return Promise.resolve();
  }

  updateBounds(input: BrowserViewBoundsUpdate): Promise<void> {
    this.boundsCalls.push(input);
    return Promise.resolve();
  }

  releaseTile(input: BrowserViewTileKey): Promise<void> {
    this.releaseCalls.push(input);
    return Promise.resolve();
  }

  onStatusChange(handler: (change: BrowserViewStatusChange) => void): {
    dispose: () => void;
  } {
    this.statusHandlers.add(handler);
    return {
      dispose: () => {
        this.statusHandlers.delete(handler);
      },
    };
  }

  emitStatus(change: BrowserViewStatusChange): void {
    this.statusHandlers.forEach((handler) => handler(change));
  }

  get statusHandlerCount(): number {
    return this.statusHandlers.size;
  }
}

function tileKey(): BrowserViewTileKey {
  return {
    viewTabId: "view-tab-1",
    paneId: "pane-1",
    tileInstanceId: NODE.instanceId,
    pageSessionId: NODE.id,
  };
}

function renderAgentBrowserTile(): RenderResult {
  return render(
    <AgentBrowserTile node={NODE} viewTabId="view-tab-1" paneId="pane-1" />,
  );
}

describe("<AgentBrowserTile />", () => {
  beforeEach(() => {
    bridgeHarness.current = null;
    visibilityHarness.visible = true;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a dead state when the agent browser bridge is unavailable", () => {
    bridgeHarness.current = null;

    renderAgentBrowserTile();

    expect(screen.getByText("Agent browser unavailable")).toBeTruthy();
    expect(
      screen.getByText("Native browser views are unavailable."),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`agent-browser-tile-${NODE.instanceId}`),
    ).toBeTruthy();
  });

  it("upserts on mount and releases on unmount", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;

    const view = renderAgentBrowserTile();

    await waitFor(() => {
      expect(bridge.upsertCalls.length).toBeGreaterThanOrEqual(1);
    });
    expect(bridge.upsertCalls[0]).toEqual({
      ...tileKey(),
      url: NODE.url,
      visible: true,
    });
    expect(bridge.releaseCalls).toEqual([]);

    view.unmount();

    await waitFor(() => {
      expect(bridge.releaseCalls).toEqual([tileKey()]);
    });
  });

  it("subscribes to status changes for its tile key and ignores others", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;

    renderAgentBrowserTile();

    await waitFor(() => {
      expect(bridge.statusHandlerCount).toBe(1);
    });

    // Loading by default until a matching status arrives.
    expect(screen.getByText("Loading page")).toBeTruthy();

    bridge.emitStatus({
      viewTabId: "other-tab",
      paneId: "pane-1",
      tileInstanceId: NODE.instanceId,
      pageSessionId: NODE.id,
      url: NODE.url,
      title: "Other",
      status: "ready",
      reason: null,
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });
    expect(screen.getByText("Loading page")).toBeTruthy();

    bridge.emitStatus({
      ...tileKey(),
      url: NODE.url,
      title: "Example",
      status: "dead",
      reason: "crashed",
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });

    await waitFor(() => {
      expect(screen.getByText("Agent browser unavailable")).toBeTruthy();
    });
    expect(screen.getByText("crashed")).toBeTruthy();
  });

  it("disposes the status subscription on unmount", async () => {
    const bridge = new FakeAgentBrowserViewBridge();
    bridgeHarness.current = bridge;

    const view = renderAgentBrowserTile();
    await waitFor(() => {
      expect(bridge.statusHandlerCount).toBe(1);
    });

    view.unmount();
    expect(bridge.statusHandlerCount).toBe(0);
  });
});
