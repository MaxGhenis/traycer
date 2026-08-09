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

const hookState = vi.hoisted(() => ({
  streamClient: null as FakeStreamClient | null,
  streamClientFactory: null as (() => FakeStreamClient | null) | null,
  primaryProfileCaptureReady: true,
}));

vi.mock("@/hooks/host/use-reactive-active-host-id", () => ({
  useReactiveActiveHostId: () => "host-test",
}));

vi.mock("@/hooks/host/use-host-directory-entry", () => ({
  useHostDirectoryEntry: () => ({ hostId: "host-test" }),
}));

vi.mock("@/hooks/host/use-host-stream-client-for", () => ({
  useHostStreamClientFor: () =>
    hookState.streamClientFactory === null
      ? hookState.streamClient
      : hookState.streamClientFactory(),
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
    resolveDesktopBrowserViewBridge: () => null,
    canCapturePrimaryProfile: () => hookState.primaryProfileCaptureReady,
  };
});

class FakeStreamSession {
  readonly sentFrames: Array<Record<string, unknown>> = [];
  private serverHandler:
    | ((
        envelope: Record<string, unknown>,
        binaryPayload: Uint8Array | null,
      ) => void)
    | null = null;
  private statusHandler:
    | ((
        status: "connecting" | "open" | "reconnecting" | "closed",
        reason: null,
      ) => void)
    | null = null;
  closed = false;

  sendClientFrame(frame: Record<string, unknown>): void {
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
    handler: (
      status: "connecting" | "open" | "reconnecting" | "closed",
      reason: null,
    ) => void,
  ): void {
    this.statusHandler = handler;
  }

  close(): void {
    this.closed = true;
  }

  emitStatus(status: "connecting" | "open" | "reconnecting" | "closed"): void {
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

  subscribe(method: string, params: unknown): FakeStreamSession {
    const session = new FakeStreamSession();
    this.sessions.push(session);
    this.subscribes.push({ method, params });
    return session;
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

describe("BrowserSessionsProvider (ticket 08 epic subscription)", () => {
  beforeEach(() => {
    hookState.streamClient = new FakeStreamClient();
    hookState.streamClientFactory = null;
    hookState.primaryProfileCaptureReady = true;
    resetElectronBrowserTabStoreForTests();
  });

  afterEach(() => {
    cleanup();
    hookState.streamClientFactory = null;
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
    expect(stream?.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "primaryProfileCaptureReady",
        hasBinaryPayload: false,
      }),
    );
  });

  it("skips primaryProfileCaptureReady when capture is unavailable", () => {
    hookState.primaryProfileCaptureReady = false;
    renderProvider("chat-alpha");
    const stream = hookState.streamClient?.sessions[0];
    expect(
      stream?.sentFrames.some(
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

  it("preserves capture-ready + re-registration across stream client reconnect", async () => {
    const first = new FakeStreamClient();
    const second = new FakeStreamClient();
    hookState.streamClientFactory = () => first;

    const bridge = new FakeBridge();
    registerElectronBrowserTab({
      epicId: "epic-1",
      hostId: "host-test",
      chatId: "chat-alpha",
      registrationId: "reg-1",
      sessionId: "session-1",
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

    expect(first.subscribes).toHaveLength(1);
    expect(first.sessions[0]?.sentFrames).toContainEqual(
      expect.objectContaining({ kind: "primaryProfileCaptureReady" }),
    );
    expect(first.sessions[0]?.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-1",
      }),
    );

    hookState.streamClientFactory = () => second;
    rerender(
      <BrowserSessionsProvider epicId="epic-1" routingChatId="chat-alpha">
        <Probe />
      </BrowserSessionsProvider>,
    );

    await waitFor(() => {
      expect(first.sessions[0]?.closed).toBe(true);
      expect(second.subscribes).toEqual([
        {
          method: "browser.sessions",
          params: { epicId: "epic-1", chatId: "chat-alpha" },
        },
      ]);
    });
    expect(second.sessions[0]?.sentFrames).toContainEqual(
      expect.objectContaining({ kind: "primaryProfileCaptureReady" }),
    );
    expect(second.sessions[0]?.sentFrames).toContainEqual(
      expect.objectContaining({
        kind: "registerElectronTab",
        registrationId: "reg-1",
      }),
    );
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
