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

const EPIC = "epic-1";
const HOST = "host-1";
const OTHER_EPIC = "epic-2";
const OTHER_HOST = "host-2";

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

function baseRegistration(
  overrides: Partial<Parameters<typeof registerElectronBrowserTab>[0]> &
    Pick<
      Parameters<typeof registerElectronBrowserTab>[0],
      "registrationId" | "sessionId" | "bridge"
    >,
): Parameters<typeof registerElectronBrowserTab>[0] {
  return {
    epicId: EPIC,
    hostId: HOST,
    chatId: "chat-1",
    initialUrl: "https://app.example",
    title: null,
    tileKey: TILE_KEY,
    onRegistered: null,
    ...overrides,
  };
}

describe("electron-browser-tab-store (ticket 05/08 epic+host routing)", () => {
  afterEach(() => {
    resetElectronBrowserTabStoreForTests();
  });

  it("publishes registerElectronTab when the epic+host stream is attached", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-1",
        sessionId: "session-1",
        title: "App",
        bridge,
      }),
    );

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

  it("does not publish records from another epic or host into this stream", () => {
    const bridge = new FakeBridge();
    const localFrames: BrowserSessionsClientFrame[] = [];
    const otherEpicFrames: BrowserSessionsClientFrame[] = [];
    const otherHostFrames: BrowserSessionsClientFrame[] = [];

    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      localFrames.push(frame);
    });
    attachElectronBrowserTabStream(OTHER_EPIC, HOST, (frame) => {
      otherEpicFrames.push(frame);
    });
    attachElectronBrowserTabStream(EPIC, OTHER_HOST, (frame) => {
      otherHostFrames.push(frame);
    });

    registerElectronBrowserTab(
      baseRegistration({
        epicId: EPIC,
        hostId: HOST,
        registrationId: "reg-local",
        sessionId: "session-local",
        bridge,
      }),
    );
    registerElectronBrowserTab(
      baseRegistration({
        epicId: OTHER_EPIC,
        hostId: HOST,
        registrationId: "reg-other-epic",
        sessionId: "session-other-epic",
        bridge,
      }),
    );
    registerElectronBrowserTab(
      baseRegistration({
        epicId: EPIC,
        hostId: OTHER_HOST,
        registrationId: "reg-other-host",
        sessionId: "session-other-host",
        bridge,
      }),
    );

    expect(localFrames).toEqual([
      expect.objectContaining({ registrationId: "reg-local" }),
    ]);
    expect(otherEpicFrames).toEqual([
      expect.objectContaining({ registrationId: "reg-other-epic" }),
    ]);
    expect(otherHostFrames).toEqual([
      expect.objectContaining({ registrationId: "reg-other-host" }),
    ]);
  });

  it("re-publishes only matching epic+host registrations on attach", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-local",
        sessionId: "session-local",
        bridge,
      }),
    );
    registerElectronBrowserTab(
      baseRegistration({
        epicId: OTHER_EPIC,
        hostId: HOST,
        registrationId: "reg-other",
        sessionId: "session-other",
        bridge,
      }),
    );

    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    expect(frames).toEqual([
      expect.objectContaining({ registrationId: "reg-local" }),
    ]);
  });

  it("re-publishes registration when the same registrationId reconnects", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-stable",
        sessionId: "session-1",
        initialUrl: "https://app.example/a",
        title: "A",
        bridge,
      }),
    );
    frames.length = 0;

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-stable",
        sessionId: "session-1",
        initialUrl: "https://app.example/b",
        title: "B",
        tileKey: { ...TILE_KEY, tileInstanceId: "tile-rebound" },
        bridge,
      }),
    );

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
    attachElectronBrowserTabStream(EPIC, HOST, () => {});

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-1",
        sessionId: "session-1",
        bridge,
        onRegistered,
      }),
    );

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
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-1",
        sessionId: "session-1",
        bridge,
      }),
    );
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

  it("does not publish registration frames when no epic+host stream is attached yet", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];

    registerElectronBrowserTab(
      baseRegistration({
        chatId: null,
        registrationId: "reg-pending",
        sessionId: "session-pending",
        bridge,
      }),
    );
    expect(frames).toEqual([]);

    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });
    expect(frames).toEqual([
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-pending",
      }),
    ]);
  });

  it("invokes onActivatedHeadless for typed BROWSER_TAB_ACTIVATED_HEADLESS failures", () => {
    const bridge = new FakeBridge();
    const onActivatedHeadless = vi.fn();
    attachElectronBrowserTabStream(EPIC, HOST, () => {});

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-headless",
        sessionId: "session-1",
        bridge,
        onActivatedHeadless,
      }),
    );

    const handled = handleElectronBrowserTabFrame({
      kind: "electronTabRegistrationFailed",
      hasBinaryPayload: false,
      requestId: "req-fail",
      registrationId: "reg-headless",
      sessionId: "session-1",
      tabId: "tab-headless-1",
      code: "BROWSER_TAB_ACTIVATED_HEADLESS",
    } satisfies BrowserSessionsServerFrame);

    expect(handled).toBe(true);
    expect(onActivatedHeadless).toHaveBeenCalledWith("tab-headless-1");
  });
});
