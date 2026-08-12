import "../../../../../__tests__/test-browser-apis";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { BrowserSessionsProvider } from "@/components/epic-canvas/renderers/browser-session-dock";
import { useBrowserSessionsContext } from "@/components/epic-canvas/renderers/browser-sessions-context";
import {
  registerElectronBrowserTab,
  resetElectronBrowserTabStoreForTests,
} from "@/lib/browser-view/electron-browser-tab-store";
import type {
  BrowserViewDurableTabRegistration,
  BrowserViewStatusChange,
  BrowserViewTileKey,
} from "@/lib/browser-view/desktop-browser-view";
import type {
  AgentBrowserViewCdpDispatch,
  AgentBrowserViewCdpResult,
  AgentBrowserViewCdpSessionEndedChange,
  AgentBrowserViewCdpTargetAttachedChange,
  AgentBrowserViewTileHandoffChange,
} from "@/lib/browser-view/desktop-agent-browser-view";

type StreamConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

type CaptureBridge = {
  readonly capturePrimaryProfile: () => Promise<{
    readonly status: "captured" | "unavailable";
    readonly storageState: unknown;
    readonly reason: string | null;
  }>;
};

const hookState = vi.hoisted(() => ({
  streamClient: null as FakeStreamClient | null,
  durableTransport: null as FakeDurableTransport | null,
  openedHostIds: [] as string[],
  hostEntry: {
    hostId: "host-test",
    label: "Test host",
    kind: "local" as const,
    websocketUrl: null as string | null,
    version: "test-version",
    status: "available" as const,
  },
  hostClient: {
    getRequestContext: () => ({ credentials: null }),
    getRequestContextUserId: () => "user-test",
  },
  transportKey: "authenticated-host-test",
  ownerIdentityKey: "local\u0000host-test\u0000user-test",
  primaryProfileCaptureReady: true,
  browserViewBridge: null as CaptureBridge | null,
}));

vi.mock("@/hooks/host/use-reactive-active-host-id", () => ({
  useReactiveActiveHostId: () => "host-test",
}));

vi.mock("@/hooks/host/use-host-directory-entry", () => ({
  useHostDirectoryEntry: () => hookState.hostEntry,
}));

vi.mock("@/hooks/host/use-host-stream-client-for", () => ({
  authenticatedHostStreamKey: () =>
    hookState.hostEntry.websocketUrl === null ? null : hookState.transportKey,
  authenticatedOwnerIdentityKey: () => hookState.ownerIdentityKey,
}));

vi.mock("@/lib/host", () => ({
  useHostClient: () => hookState.hostClient,
}));

const openTransport = vi.hoisted(
  () => (hostId: string): FakeDurableTransport => {
    hookState.openedHostIds.push(hostId);
    const transport = hookState.durableTransport;
    if (transport === null) {
      throw new Error("expected durable stream transport");
    }
    transport.open();
    return transport;
  },
);

vi.mock("@/lib/host/use-durable-stream-transport", () => ({
  useDurableStreamTransportFactory: () => openTransport,
}));

vi.mock("@/lib/host/stream-auth-revalidator", () => ({
  useStreamAuthRevalidator: () => null,
}));

const runnerHostMock = vi.hoisted(() => ({
  browserView: { capturePrimaryProfile: vi.fn() },
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => runnerHostMock,
}));

vi.mock("@/lib/browser-view/desktop-browser-view", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/browser-view/desktop-browser-view")
    >();
  return {
    ...actual,
    resolveDesktopBrowserViewBridge: () => hookState.browserViewBridge,
    canCapturePrimaryProfile: () => hookState.primaryProfileCaptureReady,
  };
});

/**
 * Fake browser.sessions transport. When `dropUntilLive` is true, every client
 * frame is discarded until the stream reports `open` (provider lifecycle
 * `live`) - matching host behavior that drops pre-live readiness frames.
 */
class FakeStreamSession {
  readonly sentFrames: Array<Record<string, unknown>> = [];
  readonly droppedFrames: Array<Record<string, unknown>> = [];
  private readonly dropUntilLive: boolean;
  private transportLive = false;
  private serverHandler:
    | ((
        envelope: Record<string, unknown>,
        binaryPayload: Uint8Array | null,
      ) => void)
    | null = null;
  private statusHandler:
    ((status: StreamConnectionStatus, reason: null) => void) | null = null;
  closed = false;

  constructor(options: { readonly dropUntilLive: boolean }) {
    this.dropUntilLive = options.dropUntilLive;
  }

  sendClientFrame(
    frame: Record<string, unknown>,
    _binaryPayload: Uint8Array | null,
  ): void {
    if (this.dropUntilLive && !this.transportLive) {
      this.droppedFrames.push(frame);
      return;
    }
    this.sentFrames.push(frame);
  }

  onServerFrame(
    handler: (
      envelope: Record<string, unknown>,
      binaryPayload: Uint8Array | null,
    ) => void,
  ): void {
    this.serverHandler = handler;
  }

  onStatusChange(
    handler: (status: StreamConnectionStatus, reason: null) => void,
  ): void {
    this.statusHandler = handler;
  }

  close(): void {
    this.closed = true;
  }

  emitStatus(status: StreamConnectionStatus): void {
    if (this.dropUntilLive) {
      this.transportLive = status === "open";
    }
    this.statusHandler?.(status, null);
  }

  emit(
    envelope: Record<string, unknown>,
    binaryPayload: Uint8Array | null,
  ): void {
    this.serverHandler?.(envelope, binaryPayload);
  }
}

class FakeStreamClient {
  readonly sessions: FakeStreamSession[] = [];
  readonly subscribes: Array<{
    readonly method: string;
    readonly params: unknown;
  }> = [];
  readonly wireSubscriptions: Array<{
    readonly endpoint: string;
    readonly method: string;
    readonly params: unknown;
  }> = [];
  readonly reconnects: Array<{
    readonly reason: string;
    readonly endpoint: string;
  }> = [];
  private readonly dropUntilLive: boolean;
  private endpoint: string;
  private readonly subscriptionBySession = new Map<
    FakeStreamSession,
    { readonly method: string; readonly params: unknown }
  >();
  closed = false;

  constructor(options: {
    readonly dropUntilLive: boolean;
    readonly endpoint: string;
  }) {
    this.dropUntilLive = options.dropUntilLive;
    this.endpoint = options.endpoint;
  }

  subscribe(method: string, params: unknown): FakeStreamSession {
    const session = new FakeStreamSession({
      dropUntilLive: this.dropUntilLive,
    });
    this.sessions.push(session);
    this.subscribes.push({ method, params });
    this.subscriptionBySession.set(session, { method, params });
    this.wireSubscriptions.push({
      endpoint: this.endpoint,
      method,
      params,
    });
    return session;
  }

  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  reconnectAll(reason: string): void {
    if (this.closed) return;
    this.reconnects.push({ reason, endpoint: this.endpoint });
    for (const session of this.sessions) {
      const subscription = this.subscriptionBySession.get(session);
      if (subscription === undefined) continue;
      session.emitStatus("reconnecting");
      this.wireSubscriptions.push({
        endpoint: this.endpoint,
        ...subscription,
      });
      session.emitStatus("open");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const session of this.sessions) {
      session.close();
    }
  }
}

class FakeDurableTransport {
  readonly wsStreamClient: FakeStreamClient;
  readonly dialedEndpoints: string[] = [];
  private readonly initialEndpoint: string;
  closed = false;
  private opened = false;

  constructor(options: {
    readonly dropUntilLive: boolean;
    readonly initialEndpoint: string;
  }) {
    this.initialEndpoint = options.initialEndpoint;
    this.wsStreamClient = new FakeStreamClient({
      dropUntilLive: options.dropUntilLive,
      endpoint: options.initialEndpoint,
    });
  }

  open(): void {
    if (this.opened || this.closed) return;
    this.opened = true;
    this.dialedEndpoints.push(this.initialEndpoint);
  }

  moveEndpoint(endpoint: string): void {
    if (this.closed) return;
    this.dialedEndpoints.push(endpoint);
    this.wsStreamClient.setEndpoint(endpoint);
    this.wsStreamClient.reconnectAll("host-endpoint-change");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wsStreamClient.close();
  }
}

class FakeBridge {
  registerDurableTab(_input: BrowserViewDurableTabRegistration): Promise<void> {
    return Promise.resolve();
  }

  dispatchCdp(
    _input: AgentBrowserViewCdpDispatch,
  ): Promise<AgentBrowserViewCdpResult> {
    return Promise.resolve({ kind: "cdpGetFrameTree", ok: true, frames: [] });
  }

  onStatusChange(_handler: (change: BrowserViewStatusChange) => void): {
    dispose: () => void;
  } {
    return { dispose: () => undefined };
  }

  onCdpSessionEnded(
    _handler: (change: AgentBrowserViewCdpSessionEndedChange) => void,
  ): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  onCdpTargetAttached(
    _handler: (change: AgentBrowserViewCdpTargetAttachedChange) => void,
  ): { dispose: () => void } {
    return { dispose: () => undefined };
  }

  onTileHandoff(
    _handler: (change: AgentBrowserViewTileHandoffChange) => void,
  ): { dispose: () => void } {
    return { dispose: () => undefined };
  }
}

const TILE_KEY: BrowserViewTileKey = {
  viewTabId: "view-1",
  paneId: "pane-1",
  tileInstanceId: "tile-1",
  pageSessionId: "page-1",
};
const INITIAL_ENDPOINT = "ws://host-a/stream";
const RESTARTED_ENDPOINT = "ws://host-b/stream";

function Probe(): ReactNode {
  const sessions = useBrowserSessionsContext();
  return (
    <div>
      <span data-testid="lifecycle">{sessions.lifecycle}</span>
      <span data-testid="count">{sessions.items.length}</span>
      <span data-testid="routing">{sessions.routingChatId ?? "null"}</span>
      <ul>
        {sessions.items.map((session) => (
          <li key={session.sessionId}>{session.name}</li>
        ))}
      </ul>
      <button type="button" onClick={() => sessions.closeSession("sess-1")}>
        close
      </button>
    </div>
  );
}

function renderProvider(routingChatId: string | null): void {
  render(
    <BrowserSessionsProvider epicId="epic-1" routingChatId={routingChatId}>
      <Probe />
    </BrowserSessionsProvider>,
  );
}

/**
 * Mirrors `EpicBrowserSessionsScope` in epic-surface.tsx: lexicographic first
 * chat id is the deterministic transport routing metadata for the one epic
 * browser.sessions stream mounted above sidebar + canvas.
 */
function selectRoutingChatId(chatIds: readonly string[]): string | null {
  return (
    [...chatIds].toSorted((left, right) => left.localeCompare(right))[0] ?? null
  );
}

function readinessFrames(
  frames: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> {
  return frames.filter((frame) => frame.kind === "primaryProfileCaptureReady");
}

function registrationFrames(
  frames: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> {
  return frames.filter((frame) => frame.kind === "registerElectronTab");
}

function installCaptureBridge(): void {
  const capturePrimaryProfile = vi.fn(() =>
    Promise.resolve({
      status: "captured" as const,
      storageState: {
        cookies: [{ name: "t09_auth", value: "signed-in" }],
      },
      reason: null,
    }),
  );
  hookState.browserViewBridge = { capturePrimaryProfile };
}

async function expectCaptureServiced(
  stream: FakeStreamSession,
  requestId: string,
): Promise<void> {
  act(() => {
    stream.emit(
      {
        kind: "capturePrimaryProfile",
        hasBinaryPayload: false,
        requestId,
      },
      null,
    );
  });
  await waitFor(() => {
    expect(stream.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "primaryProfileCaptured",
        requestId,
        status: "captured",
      }),
    );
  });
}

function installTransport(dropUntilLive: boolean): void {
  const transport = new FakeDurableTransport({
    dropUntilLive,
    initialEndpoint: INITIAL_ENDPOINT,
  });
  hookState.durableTransport = transport;
  hookState.streamClient = transport.wsStreamClient;
  hookState.openedHostIds = [];
  hookState.hostEntry = {
    ...hookState.hostEntry,
    websocketUrl: INITIAL_ENDPOINT,
  };
}

describe("BrowserSessionsProvider (ticket 08 epic subscription)", () => {
  beforeEach(() => {
    installTransport(false);
    hookState.primaryProfileCaptureReady = true;
    hookState.browserViewBridge = null;
    resetElectronBrowserTabStoreForTests();
  });

  afterEach(() => {
    cleanup();
    hookState.browserViewBridge = null;
    resetElectronBrowserTabStoreForTests();
  });

  it("opens exactly one browser.sessions subscription with the routing chat id", () => {
    renderProvider("chat-beta");
    const client = hookState.streamClient;
    expect(client?.subscribes).toEqual([
      {
        method: "browser.sessions",
        params: { epicId: "epic-1", chatId: "chat-beta" },
      },
    ]);
    expect(screen.getByTestId("routing").textContent).toBe("chat-beta");
  });

  it("selects the lexicographically first chat for deterministic reconnect routing", () => {
    expect(selectRoutingChatId(["chat-z", "chat-a", "chat-m"])).toBe("chat-a");
    expect(selectRoutingChatId([])).toBeNull();
  });

  it("does not open a stream when routingChatId is null (zero-chat epic)", () => {
    renderProvider(null);
    expect(hookState.streamClient?.subscribes).toEqual([]);
    expect(screen.getByTestId("routing").textContent).toBe("null");
  });

  it("emits primaryProfileCaptureReady once when capture is available", () => {
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(stream).toBeDefined();
    if (stream === undefined) {
      throw new Error("expected browser.sessions stream session");
    }
    // Readiness is advertised on the live transition, not post-subscribe.
    act(() => {
      stream.emitStatus("open");
    });
    expect(stream.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "primaryProfileCaptureReady",
        hasBinaryPayload: false,
      }),
    );
    expect(readinessFrames(stream.sentFrames)).toHaveLength(1);
  });

  it("skips primaryProfileCaptureReady when capture is unavailable", () => {
    hookState.primaryProfileCaptureReady = false;
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(stream).toBeDefined();
    if (stream === undefined) {
      throw new Error("expected browser.sessions stream session");
    }
    act(() => {
      stream.emitStatus("open");
    });
    expect(
      stream.sentFrames.some(
        (frame) => frame.kind === "primaryProfileCaptureReady",
      ),
    ).toBe(false);
  });

  it("re-publishes pending electron tab registrations when the stream attaches", () => {
    const bridge = new FakeBridge();
    registerElectronBrowserTab({
      epicId: "epic-1",
      hostId: "host-test",
      chatId: "chat-alpha",
      registrationId: "reg-pending",
      sessionId: "session-pending",
      initialUrl: "https://app.example",
      title: "Pending",
      tileKey: TILE_KEY,
      bridge,
      onRegistered: null,
    });

    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(stream?.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-pending",
        sessionId: "session-pending",
      }),
    );
  });

  it("redials the same durable transport on a host restart and replays readiness", async () => {
    installTransport(true);
    const transport = hookState.durableTransport;
    expect(transport).toBeDefined();
    if (transport === null) {
      throw new Error("expected durable stream transport");
    }
    const bridge = new FakeBridge();
    registerElectronBrowserTab({
      epicId: "epic-1",
      hostId: "host-test",
      chatId: "chat-alpha",
      registrationId: "reg-1",
      sessionId: "session-1",
      requestedTabId: "durable-tab-1",
      initialUrl: "https://app.example",
      title: "App",
      tileKey: TILE_KEY,
      bridge,
      onRegistered: null,
    });

    const { rerender } = render(
      <BrowserSessionsProvider epicId="epic-1" routingChatId="chat-alpha">
        <Probe />
      </BrowserSessionsProvider>,
    );
    const client = transport.wsStreamClient;
    await waitFor(() => {
      expect(hookState.openedHostIds).toEqual(["host-test"]);
      expect(client.subscribes).toEqual([
        {
          method: "browser.sessions",
          params: { epicId: "epic-1", chatId: "chat-alpha" },
        },
      ]);
    });
    expect(transport.dialedEndpoints).toEqual([INITIAL_ENDPOINT]);
    expect(client.wireSubscriptions).toEqual([
      {
        endpoint: INITIAL_ENDPOINT,
        method: "browser.sessions",
        params: { epicId: "epic-1", chatId: "chat-alpha" },
      },
    ]);

    const stream = client.sessions[0];
    expect(stream).toBeDefined();
    // Pre-live frames are dropped; the first open replays the registration.
    expect(registrationFrames(stream.sentFrames)).toHaveLength(0);
    expect(registrationFrames(stream.droppedFrames)).toHaveLength(1);
    act(() => {
      stream.emitStatus("open");
    });
    expect(stream.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-1",
      }),
    );
    expect(stream.sentFrames).toContainEqual(
      expect.objectContaining({ kind: "primaryProfileCaptureReady" }),
    );

    act(() => {
      hookState.hostEntry = {
        ...hookState.hostEntry,
        websocketUrl: null,
      };
      rerender(
        <BrowserSessionsProvider epicId="epic-1" routingChatId="chat-alpha">
          <Probe />
        </BrowserSessionsProvider>,
      );
    });
    expect(hookState.openedHostIds).toEqual(["host-test"]);
    expect(transport.closed).toBe(false);
    expect(stream.closed).toBe(false);

    act(() => {
      hookState.hostEntry = {
        ...hookState.hostEntry,
        websocketUrl: RESTARTED_ENDPOINT,
      };
      rerender(
        <BrowserSessionsProvider epicId="epic-1" routingChatId="chat-alpha">
          <Probe />
        </BrowserSessionsProvider>,
      );
      transport.moveEndpoint(RESTARTED_ENDPOINT);
    });
    expect(hookState.openedHostIds).toEqual(["host-test"]);
    expect(transport.dialedEndpoints).toEqual([
      INITIAL_ENDPOINT,
      RESTARTED_ENDPOINT,
    ]);
    expect(client.reconnects).toEqual([
      { reason: "host-endpoint-change", endpoint: RESTARTED_ENDPOINT },
    ]);
    // The durable client keeps the public subscription and re-declares it on
    // the new socket; the provider must not replace or close this session.
    expect(client.subscribes).toHaveLength(1);
    expect(client.wireSubscriptions).toHaveLength(2);
    expect(client.wireSubscriptions[1]).toEqual({
      endpoint: RESTARTED_ENDPOINT,
      method: "browser.sessions",
      params: { epicId: "epic-1", chatId: "chat-alpha" },
    });
    expect(stream.closed).toBe(false);
    const replayedRegistrations = registrationFrames(stream.sentFrames);
    expect(replayedRegistrations).toHaveLength(2);
    expect(replayedRegistrations[1]).toMatchObject({
      sessionId: "session-1",
      registrationId: "reg-1",
      requestedTabId: "durable-tab-1",
    });
    expect(readinessFrames(stream.sentFrames)).toHaveLength(2);

    cleanup();
    expect(transport.closed).toBe(true);
    expect(stream.closed).toBe(true);
  });

  it("surfaces live snapshot sessions and closeSession delete frames", () => {
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    act(() => {
      stream?.emit(
        {
          kind: "snapshot",
          hasBinaryPayload: false,
          sessions: [
            {
              sessionId: "sess-1",
              epicId: "epic-1",
              hostId: "host-test",
              profile: "primary",
              name: "Main",
              createdBy: { chatId: "chat-alpha", agentRunId: "run-1" },
              createdAt: 1,
              lastActivityAt: 2,
              tabs: [
                {
                  tabId: "tab-1",
                  url: "https://example.com",
                  originTier: "dev",
                  status: "ready",
                  title: "Example",
                  viewed: false,
                  drivenBy: [],
                },
              ],
            },
          ],
        },
        null,
      );
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByText("Main")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "close" }).click();
    });
    expect(stream?.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "closeSession",
        sessionId: "sess-1",
      }),
    );
  });
});

/**
 * Ticket-08-lift: real transport drops client frames until the stream is
 * live (`open`). Synchronous post-subscribe readiness is therefore lost;
 * readiness must be emitted on the live transition (and again after
 * reconnect), idempotently per connection.
 */
describe("BrowserSessionsProvider (ticket 08-lift live readiness)", () => {
  beforeEach(() => {
    installTransport(true);
    hookState.primaryProfileCaptureReady = true;
    hookState.browserViewBridge = null;
    resetElectronBrowserTabStoreForTests();
  });

  afterEach(() => {
    cleanup();
    hookState.browserViewBridge = null;
    resetElectronBrowserTabStoreForTests();
  });

  it("replays a cold electron registration only after the stream becomes live", () => {
    registerElectronBrowserTab({
      epicId: "epic-1",
      hostId: "host-test",
      chatId: "chat-alpha",
      registrationId: "reg-cold",
      sessionId: "session-cold",
      initialUrl: "https://app.example/cold",
      title: "Cold",
      tileKey: TILE_KEY,
      bridge: new FakeBridge(),
      onRegistered: null,
    });
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(stream).toBeDefined();
    if (stream === undefined) {
      throw new Error("expected browser.sessions stream session");
    }

    expect(registrationFrames(stream.sentFrames)).toHaveLength(0);
    expect(registrationFrames(stream.droppedFrames)).toHaveLength(1);

    act(() => {
      stream.emitStatus("open");
    });
    expect(registrationFrames(stream.sentFrames)).toHaveLength(1);
    expect(stream.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-cold",
      }),
    );

    act(() => {
      stream.emitStatus("open");
    });
    expect(registrationFrames(stream.sentFrames)).toHaveLength(1);
  });

  it("replays electron registrations once on the next live after reconnect", () => {
    registerElectronBrowserTab({
      epicId: "epic-1",
      hostId: "host-test",
      chatId: "chat-alpha",
      registrationId: "reg-reconnect",
      sessionId: "session-reconnect",
      initialUrl: "https://app.example/reconnect",
      title: "Reconnect",
      tileKey: TILE_KEY,
      bridge: new FakeBridge(),
      onRegistered: null,
    });
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(stream).toBeDefined();
    if (stream === undefined) {
      throw new Error("expected browser.sessions stream session");
    }

    act(() => {
      stream.emitStatus("open");
    });
    expect(registrationFrames(stream.sentFrames)).toHaveLength(1);

    act(() => {
      stream.emitStatus("reconnecting");
      stream.emitStatus("open");
    });
    expect(registrationFrames(stream.sentFrames)).toHaveLength(2);

    act(() => {
      stream.emitStatus("open");
    });
    expect(registrationFrames(stream.sentFrames)).toHaveLength(2);
  });

  it("emits no capture-ready pre-live, then exactly one after first live so a fresh primary capture is serviced", async () => {
    installCaptureBridge();
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(stream).toBeDefined();
    if (stream === undefined) {
      throw new Error("expected browser.sessions stream session");
    }

    // Pre-live: production may attempt sync readiness, but the gate drops it.
    expect(readinessFrames(stream.sentFrames)).toHaveLength(0);
    expect(screen.getByTestId("lifecycle").textContent).toBe("connecting");

    act(() => {
      stream.emitStatus("open");
    });
    expect(screen.getByTestId("lifecycle").textContent).toBe("live");
    // Desired behavior: re-publish readiness on the live transition.
    expect(readinessFrames(stream.sentFrames)).toHaveLength(1);

    await expectCaptureServiced(stream, "req-fresh-primary-1");

    // Idempotent: repeated live notification on the same connection must not
    // duplicate readiness frames.
    act(() => {
      stream.emitStatus("open");
    });
    expect(readinessFrames(stream.sentFrames)).toHaveLength(1);
  });

  it("emits exactly one readiness on the next live after reconnect and services a fresh capture", async () => {
    installCaptureBridge();
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(stream).toBeDefined();
    if (stream === undefined) {
      throw new Error("expected browser.sessions stream session");
    }

    act(() => {
      stream.emitStatus("open");
    });
    expect(readinessFrames(stream.sentFrames)).toHaveLength(1);
    await expectCaptureServiced(stream, "req-primary-before-reconnect");

    act(() => {
      stream.emitStatus("reconnecting");
    });
    expect(screen.getByTestId("lifecycle").textContent).toBe("reconnecting");
    // Frames during reconnect are dropped; readiness count stays at one.
    expect(readinessFrames(stream.sentFrames)).toHaveLength(1);

    act(() => {
      stream.emitStatus("open");
    });
    expect(screen.getByTestId("lifecycle").textContent).toBe("live");
    // Next live transition: exactly one additional readiness frame.
    expect(readinessFrames(stream.sentFrames)).toHaveLength(2);

    await expectCaptureServiced(stream, "req-primary-after-reconnect");

    act(() => {
      stream.emitStatus("open");
    });
    expect(readinessFrames(stream.sentFrames)).toHaveLength(2);
  });
});
