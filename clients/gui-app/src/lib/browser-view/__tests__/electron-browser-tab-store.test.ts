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
  drainElectronBrowserHandoffs,
  findElectronBrowserTabBinding,
  handleElectronBrowserTabFrame,
  registerElectronBrowserTab,
  resetElectronBrowserTabStoreForTests,
  updateElectronBrowserTabView,
} from "@/lib/browser-view/electron-browser-tab-store";
import { createSingleTileCanvas } from "@/stores/epics/canvas/actions";
import { collectPanes } from "@/stores/epics/canvas/tile-tree";
import { makeBrowserTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import {
  isAgentBrowserTileRef,
  type AgentBrowserTileRef,
  type BrowserTileRef,
  type EpicCanvasState,
} from "@/stores/epics/canvas/types";

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

  emitTileHandoff(change: AgentBrowserViewTileHandoffChange): void {
    for (const handler of this.tileHandoffHandlers) handler(change);
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

  it("forwards aggregated sibling tabs in a tileHandoff frame", () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });
    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-handoff",
        sessionId: "session-handoff",
        bridge,
      }),
    );
    frames.length = 0;

    const primaryStorage = { cookies: [], origins: [] };
    const siblingStorage = {
      cookies: [],
      origins: [
        {
          origin: "https://sibling.example",
          localStorage: [{ name: "token", value: "carried" }],
        },
      ],
    };
    bridge.emitTileHandoff({
      ...TILE_KEY,
      capturedUrl: "https://app.example/after",
      capturedStorageState: primaryStorage,
      siblingTabs: [
        {
          tabId: "tab-sibling",
          url: "https://sibling.example/after",
          capturedStorageState: siblingStorage,
        },
      ],
      reason: "gui-quit",
    });

    expect(frames).toEqual([
      expect.objectContaining({
        kind: "tileHandoff",
        tileInstanceId: TILE_KEY.tileInstanceId,
        capturedUrl: "https://app.example/after",
        capturedStorageState: primaryStorage,
        siblingTabs: [
          {
            tabId: "tab-sibling",
            url: "https://sibling.example/after",
            capturedStorageState: siblingStorage,
          },
        ],
        reason: "gui-quit",
      }),
    ]);
  });

  it("waits for the matching tileHandoff actionAck before completing the drain", async () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });
    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-handoff-ack",
        sessionId: "session-handoff-ack",
        bridge,
      }),
    );
    frames.length = 0;

    bridge.emitTileHandoff({
      ...TILE_KEY,
      capturedUrl: "https://app.example/after",
      capturedStorageState: null,
      siblingTabs: [],
      reason: "gui-quit",
    });

    const frame = frames[0];
    if (frame.kind !== "tileHandoff") {
      throw new Error("tile handoff frame missing");
    }
    const drain = drainElectronBrowserHandoffs();
    const pending = Symbol("pending");
    await expect(Promise.race([drain, Promise.resolve(pending)])).resolves.toBe(
      pending,
    );

    expect(
      handleElectronBrowserTabFrame({
        kind: "actionAck",
        hasBinaryPayload: false,
        requestId: "wrong-request",
        ok: true,
        reason: null,
      } satisfies BrowserSessionsServerFrame),
    ).toBe(false);
    await expect(Promise.race([drain, Promise.resolve(pending)])).resolves.toBe(
      pending,
    );

    expect(
      handleElectronBrowserTabFrame({
        kind: "actionAck",
        hasBinaryPayload: false,
        requestId: frame.requestId,
        ok: true,
        reason: null,
      } satisfies BrowserSessionsServerFrame),
    ).toBe(true);
    await expect(drain).resolves.toBeUndefined();
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

describe("electron-browser-tab-store focus/MRU viewed (ticket 13)", () => {
  afterEach(() => {
    resetElectronBrowserTabStoreForTests();
  });

  async function registerMintedTab(input: {
    readonly bridge: FakeBridge;
    readonly registrationId: string;
    readonly sessionId: string;
    readonly tabId: string;
    readonly tileKey?: BrowserViewTileKey;
  }): Promise<void> {
    registerElectronBrowserTab(
      baseRegistration({
        registrationId: input.registrationId,
        sessionId: input.sessionId,
        bridge: input.bridge,
        tileKey: input.tileKey ?? {
          ...TILE_KEY,
          tileInstanceId: input.registrationId,
          pageSessionId: input.sessionId,
        },
      }),
    );
    handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: `req-${input.registrationId}`,
      registrationId: input.registrationId,
      sessionId: input.sessionId,
      tabId: input.tabId,
    });
    await Promise.resolve();
    input.bridge.emitStatus({
      ...(input.tileKey ?? {
        ...TILE_KEY,
        tileInstanceId: input.registrationId,
        pageSessionId: input.sessionId,
      }),
      url: `https://app.example/${input.registrationId}`,
      title: input.registrationId,
      status: "ready",
      reason: null,
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });
  }

  function electronTabStateFrames(
    frames: readonly BrowserSessionsClientFrame[],
  ): BrowserSessionsClientFrame[] {
    return frames.filter((frame) => frame.kind === "electronTabState");
  }

  it("keeps at most one viewed tab per epic+host across regular and agent registrations", async () => {
    const regularBridge = new FakeBridge();
    const agentBridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    await registerMintedTab({
      bridge: regularBridge,
      registrationId: "reg-regular",
      sessionId: "session-regular",
      tabId: "tab-regular",
    });
    await registerMintedTab({
      bridge: agentBridge,
      registrationId: "reg-agent",
      sessionId: "session-agent",
      tabId: "tab-agent",
    });
    frames.length = 0;

    updateElectronBrowserTabView({
      sessionId: "session-regular",
      registrationId: "reg-regular",
      visible: true,
      focused: false,
    });
    expect(electronTabStateFrames(frames)).toEqual([
      expect.objectContaining({
        sessionId: "session-regular",
        tabId: "tab-regular",
        viewed: true,
      }),
    ]);
    frames.length = 0;

    updateElectronBrowserTabView({
      sessionId: "session-regular",
      registrationId: "reg-regular",
      visible: true,
      focused: true,
    });
    frames.length = 0;

    updateElectronBrowserTabView({
      sessionId: "session-agent",
      registrationId: "reg-agent",
      visible: true,
      focused: true,
    });

    const states = electronTabStateFrames(frames);
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "electronTabState",
          sessionId: "session-regular",
          tabId: "tab-regular",
          viewed: false,
        }),
        expect.objectContaining({
          kind: "electronTabState",
          sessionId: "session-agent",
          tabId: "tab-agent",
          viewed: true,
        }),
      ]),
    );
    expect(
      states.filter(
        (frame) => frame.kind === "electronTabState" && frame.viewed,
      ),
    ).toHaveLength(1);
  });

  it("preserves MRU viewed when focus leaves browser tiles (non-browser focus)", async () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    await registerMintedTab({
      bridge,
      registrationId: "reg-1",
      sessionId: "session-1",
      tabId: "tab-1",
    });
    frames.length = 0;

    updateElectronBrowserTabView({
      sessionId: "session-1",
      registrationId: "reg-1",
      visible: true,
      focused: true,
    });
    expect(electronTabStateFrames(frames)).toEqual([
      expect.objectContaining({
        kind: "electronTabState",
        tabId: "tab-1",
        viewed: true,
      }),
    ]);
    frames.length = 0;

    // Pane loses focus to a chat/editor surface while the tile stays mounted.
    updateElectronBrowserTabView({
      sessionId: "session-1",
      registrationId: "reg-1",
      visible: true,
      focused: false,
    });
    expect(electronTabStateFrames(frames)).toEqual([]);

    // A later status publish still reports the MRU tile as viewed.
    bridge.emitStatus({
      ...TILE_KEY,
      tileInstanceId: "reg-1",
      pageSessionId: "session-1",
      url: "https://app.example/still-viewed",
      title: "Still viewed",
      status: "ready",
      reason: null,
      canGoBack: false,
      canGoForward: false,
      zoomPercent: 100,
    });
    expect(electronTabStateFrames(frames)).toEqual([
      expect.objectContaining({
        kind: "electronTabState",
        tabId: "tab-1",
        url: "https://app.example/still-viewed",
        viewed: true,
      }),
    ]);
  });

  it("hands viewed to the next MRU tile on close/unbind, or clears when none remain", async () => {
    const bridgeA = new FakeBridge();
    const bridgeB = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    await registerMintedTab({
      bridge: bridgeA,
      registrationId: "reg-a",
      sessionId: "session-a",
      tabId: "tab-a",
    });
    await registerMintedTab({
      bridge: bridgeB,
      registrationId: "reg-b",
      sessionId: "session-b",
      tabId: "tab-b",
    });

    updateElectronBrowserTabView({
      sessionId: "session-a",
      registrationId: "reg-a",
      visible: true,
      focused: true,
    });
    updateElectronBrowserTabView({
      sessionId: "session-b",
      registrationId: "reg-b",
      visible: true,
      focused: true,
    });
    frames.length = 0;

    // Unbind the currently viewed tile (effect cleanup / tile close).
    updateElectronBrowserTabView({
      sessionId: "session-b",
      registrationId: "reg-b",
      visible: false,
      focused: false,
    });
    expect(electronTabStateFrames(frames)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "electronTabState",
          sessionId: "session-b",
          tabId: "tab-b",
          viewed: false,
        }),
        expect.objectContaining({
          kind: "electronTabState",
          sessionId: "session-a",
          tabId: "tab-a",
          viewed: true,
        }),
      ]),
    );
    expect(
      electronTabStateFrames(frames).filter(
        (frame) => frame.kind === "electronTabState" && frame.viewed,
      ),
    ).toHaveLength(1);
    frames.length = 0;

    // Unbind the last remaining MRU tile - previous clears viewed; none remain.
    updateElectronBrowserTabView({
      sessionId: "session-a",
      registrationId: "reg-a",
      visible: false,
      focused: false,
    });
    expect(electronTabStateFrames(frames)).toEqual([
      expect.objectContaining({
        kind: "electronTabState",
        sessionId: "session-a",
        tabId: "tab-a",
        viewed: false,
      }),
    ]);
  });

  it("publishes viewed transitions only on the existing electronTabState path", async () => {
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    await registerMintedTab({
      bridge,
      registrationId: "reg-1",
      sessionId: "session-1",
      tabId: "tab-1",
    });
    frames.length = 0;

    updateElectronBrowserTabView({
      sessionId: "session-1",
      registrationId: "reg-1",
      visible: true,
      focused: true,
    });

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.kind).toBe("electronTabState");
      if (frame.kind === "electronTabState") {
        expect(frame).toEqual(
          expect.objectContaining({
            registrationId: "reg-1",
            sessionId: "session-1",
            tabId: "tab-1",
            status: "ready",
            viewed: true,
          }),
        );
      }
    }
  });
});

describe("electron-browser-tab-store createElectronTab (ticket 14)", () => {
  const VIEW_TAB_ID = "view-create-electron";
  const SOURCE_BROWSER: BrowserTileRef = makeBrowserTileRef({
    name: "Source browser",
    hostId: HOST,
    url: "https://app.example/source",
    viewportPreset: "responsive",
  });

  function resetCanvas(): void {
    useEpicCanvasStore.setState({
      canvasByTabId: {},
      tabsById: {},
    });
  }

  function seedSourcePane(): {
    readonly paneId: string;
    readonly tileKey: BrowserViewTileKey;
  } {
    const canvas = createSingleTileCanvas(SOURCE_BROWSER);
    const pane = collectPanes(canvas.root).at(0);
    if (pane === undefined) throw new Error("expected a pane");
    useEpicCanvasStore.setState({
      tabsById: {
        [VIEW_TAB_ID]: {
          tabId: VIEW_TAB_ID,
          epicId: EPIC,
          name: "Create electron",
        },
      },
      canvasByTabId: {
        [VIEW_TAB_ID]: canvas,
      },
    });
    return {
      paneId: pane.id,
      tileKey: {
        viewTabId: VIEW_TAB_ID,
        paneId: pane.id,
        tileInstanceId: SOURCE_BROWSER.instanceId,
        pageSessionId: SOURCE_BROWSER.id,
      },
    };
  }

  function agentBrowserTiles(
    canvas: EpicCanvasState | undefined,
  ): AgentBrowserTileRef[] {
    if (canvas === undefined) return [];
    return Object.values(canvas.tilesByInstanceId).filter(
      (tile): tile is AgentBrowserTileRef =>
        tile !== undefined && isAgentBrowserTileRef(tile),
    );
  }

  afterEach(() => {
    resetElectronBrowserTabStoreForTests();
    resetCanvas();
  });

  it("resolves sourceTabId, splits an agent tile beside the pane, and acks only after electronTabRegistered", async () => {
    const { paneId: sourcePaneId, tileKey } = seedSourcePane();
    const sourceBridge = new FakeBridge();
    const agentBridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-source",
        sessionId: "session-shared",
        bridge: sourceBridge,
        tileKey,
        initialUrl: "https://app.example/source",
      }),
    );
    handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: "req-source-mint",
      registrationId: "reg-source",
      sessionId: "session-shared",
      tabId: "tab-source-1",
    });
    await Promise.resolve();
    expect(
      findElectronBrowserTabBinding("session-shared", "tab-source-1"),
    ).not.toBeNull();
    frames.length = 0;

    const handled = handleElectronBrowserTabFrame({
      kind: "createElectronTab",
      hasBinaryPayload: false,
      requestId: "req-create-1",
      sessionId: "session-shared",
      sourceTabId: "tab-source-1",
      url: "https://example.com/agent",
    } satisfies BrowserSessionsServerFrame);
    expect(handled).toBe(true);

    // No ack until host registration completes.
    expect(frames.some((frame) => frame.kind === "electronTabCreated")).toBe(
      false,
    );

    const canvas = useEpicCanvasStore.getState().canvasByTabId[VIEW_TAB_ID];
    if (canvas === undefined || canvas.root === null) {
      throw new Error("expected canvas after createElectronTab");
    }
    // Pin right-adjacent split beside the seeded source pane: not replace,
    // not open-elsewhere. Root is a horizontal group; collectPanes order is
    // source first, then a distinct pane holding the agent tile.
    expect(canvas.root.kind).toBe("group");
    if (canvas.root.kind !== "group") {
      throw new Error("expected horizontal group root after right split");
    }
    expect(canvas.root.direction).toBe("horizontal");
    const panes = collectPanes(canvas.root);
    expect(panes).toHaveLength(2);
    const [sourcePane, agentPane] = panes;
    expect(sourcePane.id).toBe(sourcePaneId);
    expect(sourcePane.tabInstanceIds).toContain(SOURCE_BROWSER.instanceId);
    expect(agentPane.id).not.toBe(sourcePaneId);

    const agents = agentBrowserTiles(canvas);
    expect(agents).toHaveLength(1);
    const [agentTile] = agents;
    expect(agentTile.sessionId).toBe("session-shared");
    expect(agentTile.url).toBe("https://example.com/agent");
    expect(agentTile.id).not.toBe("reg-source");
    expect(agentTile.instanceId).not.toBe(tileKey.tileInstanceId);
    expect(agentPane.tabInstanceIds).toContain(agentTile.instanceId);
    expect(sourcePane.tabInstanceIds).not.toContain(agentTile.instanceId);

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: agentTile.id,
        sessionId: "session-shared",
        bridge: agentBridge,
        tileKey: {
          viewTabId: VIEW_TAB_ID,
          paneId: agentPane.id,
          tileInstanceId: agentTile.instanceId,
          pageSessionId: agentTile.id,
        },
        initialUrl: agentTile.url,
      }),
    );
    frames.length = 0;

    handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: "req-agent-mint",
      registrationId: agentTile.id,
      sessionId: "session-shared",
      tabId: "tab-agent-minted-9",
    });
    await Promise.resolve();

    expect(frames).toContainEqual(
      expect.objectContaining({
        kind: "electronTabCreated",
        requestId: "req-create-1",
        sessionId: "session-shared",
        tabId: "tab-agent-minted-9",
        reason: null,
      }),
    );
    expect(
      findElectronBrowserTabBinding("session-shared", "tab-agent-minted-9"),
    ).not.toBeNull();
  });

  it("sends electronTabCreated null/reason when placement fails", () => {
    // Source binding exists, but the canvas/pane is gone so placement returns null.
    const bridge = new FakeBridge();
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    registerElectronBrowserTab(
      baseRegistration({
        registrationId: "reg-orphan-source",
        sessionId: "session-orphan",
        bridge,
        tileKey: {
          viewTabId: "missing-view",
          paneId: "missing-pane",
          tileInstanceId: "tile-orphan",
          pageSessionId: "page-orphan",
        },
      }),
    );
    handleElectronBrowserTabFrame({
      kind: "electronTabRegistered",
      hasBinaryPayload: false,
      requestId: "req-orphan-mint",
      registrationId: "reg-orphan-source",
      sessionId: "session-orphan",
      tabId: "tab-orphan-source",
    });
    frames.length = 0;

    const handled = handleElectronBrowserTabFrame({
      kind: "createElectronTab",
      hasBinaryPayload: false,
      requestId: "req-create-fail",
      sessionId: "session-orphan",
      sourceTabId: "tab-orphan-source",
      url: "https://example.com/fail",
    } satisfies BrowserSessionsServerFrame);

    expect(handled).toBe(true);
    expect(frames).toEqual([
      expect.objectContaining({
        kind: "electronTabCreated",
        requestId: "req-create-fail",
        sessionId: "session-orphan",
        tabId: null,
        reason: "The source browser tile is no longer available.",
      }),
    ]);
  });

  it("returns false when sourceTabId has no local binding", () => {
    const frames: BrowserSessionsClientFrame[] = [];
    attachElectronBrowserTabStream(EPIC, HOST, (frame) => {
      frames.push(frame);
    });

    const handled = handleElectronBrowserTabFrame({
      kind: "createElectronTab",
      hasBinaryPayload: false,
      requestId: "req-unbound",
      sessionId: "session-missing",
      sourceTabId: "tab-missing",
      url: "https://example.com",
    } satisfies BrowserSessionsServerFrame);

    expect(handled).toBe(false);
    expect(frames).toEqual([]);
  });
});
