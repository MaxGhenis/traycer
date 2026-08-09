import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserSessionsClientFrame,
  BrowserSessionsServerFrame,
} from "@traycer/protocol/host/browser/contracts";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
} from "@/lib/browser-view/desktop-agent-browser-view";
import type {
  BrowserViewDurableTabRegistration,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";
import {
  attachElectronBrowserTabStream,
  handleElectronBrowserTabFrame,
  registerElectronBrowserTab,
  resetElectronBrowserTabStoreForTests,
} from "@/lib/browser-view/electron-browser-tab-store";

const TILE_KEY: BrowserViewTileKey = {
  viewTabId: "view-1",
  paneId: "pane-1",
  tileInstanceId: "tile-1",
  pageSessionId: "page-1",
};

class FakeBridge {
  readonly registerDurableTabCalls: BrowserViewDurableTabRegistration[] = [];
  readonly statusHandlers = new Set<
    (change: BrowserViewStatusChange) => void
  >();
  readonly openTileHandlers = new Set<
    (change: { readonly url: string } & BrowserViewTileKey) => void
  >();
  readonly cdpSessionEndedHandlers = new Set<
    (change: AgentBrowserViewCdpSessionEndedChange) => void
  >();
  readonly cdpTargetAttachedHandlers = new Set<
    (change: AgentBrowserViewCdpTargetAttachedChange) => void
  >();
  readonly tileHandoffHandlers = new Set<
    (change: AgentBrowserViewTileHandoffChange) => void
  >();

  registerDurableTab(input: BrowserViewDurableTabRegistration): Promise<void> {
    this.registerDurableTabCalls.push(input);
    return Promise.resolve();
  }

  dispatchCdp(
    _input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult> {
    return Promise.resolve({
      kind: "cdpGetFrameTree",
      ok: true,
      frames: [],
    });
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

  onCdpSessionEnded(
    handler: (change: AgentBrowserViewCdpSessionEndedChange) => void,
  ): { dispose: () => void } {
    this.cdpSessionEndedHandlers.add(handler);
    return {
      dispose: () => {
        this.cdpSessionEndedHandlers.delete(handler);
      },
    };
  }

  onCdpTargetAttached(
    handler: (change: AgentBrowserViewCdpTargetAttachedChange) => void,
  ): { dispose: () => void } {
    this.cdpTargetAttachedHandlers.add(handler);
    return {
      dispose: () => {
        this.cdpTargetAttachedHandlers.delete(handler);
      },
    };
  }

  onTileHandoff(handler: (change: AgentBrowserViewTileHandoffChange) => void): {
    dispose: () => void;
  } {
    this.tileHandoffHandlers.add(handler);
    return {
      dispose: () => {
        this.tileHandoffHandlers.delete(handler);
      },
    };
  }

  emitStatus(change: BrowserViewStatusChange): void {
    for (const handler of this.statusHandlers) handler(change);
  }
}

describe("electron-browser-tab-store (ticket 05)", () => {
  afterEach(() => {
    resetElectronBrowserTabStoreForTests();
  });

  it("publishes registerElectronTab when a chat stream is attached", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream("chat-1", (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab({
      chatId: "chat-1",
      registrationId: "reg-1",
      sessionId: "session-1",
      initialUrl: "https://app.example",
      title: "App",
      tileKey: TILE_KEY,
      bridge,
      onRegistered: null,
    });

    expect(frames).toEqual([
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-1",
        sessionId: "session-1",
        tileInstanceId: "tile-1",
        initialUrl: "https://app.example",
        title: "App",
      }),
    ]);
  });

  it("re-publishes registration when the same registrationId reconnects", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream("chat-1", (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab({
      chatId: "chat-1",
      registrationId: "reg-stable",
      sessionId: "session-1",
      initialUrl: "https://app.example/a",
      title: "A",
      tileKey: TILE_KEY,
      bridge,
      onRegistered: null,
    });
    frames.length = 0;

    registerElectronBrowserTab({
      chatId: "chat-1",
      registrationId: "reg-stable",
      sessionId: "session-1",
      initialUrl: "https://app.example/b",
      title: "B",
      tileKey: { ...TILE_KEY, tileInstanceId: "tile-rebound" },
      bridge,
      onRegistered: null,
    });

    expect(frames).toEqual([
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-stable",
        tileInstanceId: "tile-rebound",
        initialUrl: "https://app.example/b",
        title: "B",
      }),
    ]);
  });

  it("on electronTabRegistered calls registerDurableTab and onRegistered with host-minted tabId", async () => {
    const bridge = new FakeBridge();
    const onRegistered = vi.fn();
    attachElectronBrowserTabStream("chat-1", () => {});

    registerElectronBrowserTab({
      chatId: "chat-1",
      registrationId: "reg-1",
      sessionId: "session-1",
      initialUrl: "https://app.example",
      title: null,
      tileKey: TILE_KEY,
      bridge,
      onRegistered,
    });

    const handled = handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: "req-1",
      registrationId: "reg-1",
      sessionId: "session-1",
      tabId: "host-minted-tab-99",
    } satisfies BrowserSessionsServerFrame);

    expect(handled).toBe(true);
    await Promise.resolve();
    expect(bridge.registerDurableTabCalls).toEqual([
      {
        ...TILE_KEY,
        sessionId: "session-1",
        tabId: "host-minted-tab-99",
      },
    ]);
    expect(onRegistered).toHaveBeenCalledWith("host-minted-tab-99");
  });

  it("forwards status changes as electronTabState only after host mint is known", async () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream("chat-1", (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab({
      chatId: "chat-1",
      registrationId: "reg-1",
      sessionId: "session-1",
      initialUrl: "https://app.example",
      title: null,
      tileKey: TILE_KEY,
      bridge,
      onRegistered: null,
    });
    frames.length = 0;

    bridge.emitStatus({
      ...TILE_KEY,
      url: "https://app.example/loading",
      title: "Loading",
      status: "loading",
      reason: null,
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });
    expect(frames).toEqual([]);

    handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: "req-1",
      registrationId: "reg-1",
      sessionId: "session-1",
      tabId: "tab-1",
    });
    await Promise.resolve();
    frames.length = 0;

    bridge.emitStatus({
      ...TILE_KEY,
      url: "https://app.example/ready",
      title: "Ready",
      status: "ready",
      reason: null,
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });

    expect(frames).toEqual([
      expect.objectContaining({
        kind: "electronTabState",
        registrationId: "reg-1",
        sessionId: "session-1",
        tabId: "tab-1",
        url: "https://app.example/ready",
        title: "Ready",
        status: "ready",
      }),
    ]);
  });

  it("does not publish registration frames when no chat stream is attached yet", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];

    registerElectronBrowserTab({
      chatId: "chat-pending",
      registrationId: "reg-pending",
      sessionId: "session-pending",
      initialUrl: "https://app.example",
      title: null,
      tileKey: TILE_KEY,
      bridge,
      onRegistered: null,
    });
    expect(frames).toEqual([]);

    attachElectronBrowserTabStream("chat-pending", (frame) => {
      frames.push(frame);
    });
    // attach only re-publishes records already known for that chat
    expect(frames).toEqual([
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-pending",
      }),
    ]);
  });
});
