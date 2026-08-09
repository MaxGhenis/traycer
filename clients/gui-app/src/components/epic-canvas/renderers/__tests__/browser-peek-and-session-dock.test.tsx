import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPeekTile } from "@/components/epic-canvas/renderers/browser-peek-tile";
import {
  BrowserSessionDock,
  BrowserSessionsProvider,
} from "@/components/epic-canvas/renderers/browser-session-dock";
import {
  activateBrowserTileControl,
  readBrowserTileControlSnapshotForTests,
  resetBrowserTileControlStoreForTests,
} from "@/lib/browser-view/browser-tile-control-store";
import type { BrowserPeekTileRef } from "@/stores/epics/canvas/types";

const hookState = vi.hoisted(() => ({
  streamClient: null as FakeStreamClient | null,
  streamClientFactory: null as (() => FakeStreamClient | null) | null,
  visible: true,
}));

const splitPaneWithNodeMock = vi.hoisted(() => ({ fn: vi.fn() }));
const openFreshBrowserTileMock = vi.hoisted(() => ({ fn: vi.fn() }));
const applyStorageStateMock = vi.hoisted(() => ({ fn: vi.fn() }));
const captureStorageStateMock = vi.hoisted(() => ({ fn: vi.fn() }));
const runnerHostMock = vi.hoisted(() => ({ browserView: {} }));

vi.mock("@/components/epic-canvas/hooks/use-tab-host-id", () => ({
  useTabHostId: () => "host-test",
}));

vi.mock("@/components/epic-canvas/hooks/use-tile-body-visible", () => ({
  useTileBodyVisible: () => hookState.visible,
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

vi.mock("@/providers/use-runner-host", () => ({
  // Stable identity: a fresh object each render would re-run the sessions
  // effect (browserView is memoized on runnerHost) and orphan the stream the
  // test is holding.
  useRunnerHost: () => runnerHostMock,
}));

vi.mock("@/hooks/epic/use-epic-nested-focus-navigation", () => ({
  useEpicNestedFocusNavigation:
    () =>
    (_epicId: string, _tabId: string, prepare: () => unknown): unknown =>
      prepare(),
}));

vi.mock("@/lib/browser-view/desktop-browser-view", () => ({
  resolveDesktopBrowserViewBridge: () => ({
    applyStorageState: applyStorageStateMock.fn,
    captureStorageState: captureStorageStateMock.fn,
  }),
  canCapturePrimaryProfile: () => false,
}));

function renderDock(): void {
  render(
    <BrowserSessionsProvider epicId="epic-1" routingChatId="chat-1">
      <BrowserSessionDock chatId="chat-1" viewTabId="tab-1" paneId="pane-1" />
    </BrowserSessionsProvider>,
  );
}

/** Latest stream session (React StrictMode remount may open more than one). */
function liveStream(): FakeStreamSession {
  const sessions = hookState.streamClient?.sessions ?? [];
  const stream = sessions.at(-1);
  if (stream === undefined) {
    throw new Error("expected browser.sessions stream");
  }
  return stream;
}

vi.mock(
  "@/lib/browser-view/browser-link-routing-core",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/browser-view/browser-link-routing-core")
      >();
    return {
      ...actual,
      openFreshBrowserTileFromBrowserPage: openFreshBrowserTileMock.fn,
    };
  },
);

vi.mock("@/stores/epics/canvas/store", () => ({
  useEpicCanvasStore: (
    selector: (state: {
      readonly splitPaneWithNode: typeof splitPaneWithNodeMock.fn;
      readonly prepareSplitPaneWithNodeFocusTarget: typeof splitPaneWithNodeMock.fn;
      readonly canvasByTabId: Record<string, unknown>;
      readonly tabsById: Record<string, { readonly epicId: string }>;
    }) => unknown,
  ) =>
    selector({
      splitPaneWithNode: splitPaneWithNodeMock.fn,
      prepareSplitPaneWithNodeFocusTarget: splitPaneWithNodeMock.fn,
      tabsById: { "tab-1": { epicId: "epic-1" } },
      canvasByTabId: {
        "tab-1": {
          activePaneId: "pane-1",
          sizesByGroupId: {},
          root: {
            kind: "group",
            id: "group-1",
            direction: "horizontal",
            children: [
              {
                kind: "pane",
                id: "pane-browser",
                tabInstanceIds: ["browser-instance-1"],
                activeTabId: "browser-instance-1",
                previewTabId: null,
                activationHistory: ["browser-instance-1"],
              },
              {
                kind: "pane",
                id: "pane-1",
                tabInstanceIds: ["chat-instance-1"],
                activeTabId: "chat-instance-1",
                previewTabId: null,
                activationHistory: ["chat-instance-1"],
              },
            ],
          },
          tilesByInstanceId: {
            "browser-instance-1": {
              id: "browser-page-1",
              instanceId: "browser-instance-1",
              type: "browser",
              name: "Browser",
              hostId: "host-test",
              url: "http://localhost:3000/dashboard",
              viewportPreset: "responsive",
            },
            "chat-instance-1": {
              id: "chat-1",
              instanceId: "chat-instance-1",
              type: "chat",
              name: "Chat",
              hostId: "host-test",
            },
          },
        },
      },
    }),
}));

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

const PEEK_NODE: BrowserPeekTileRef = {
  id: "browser-peek-headless-1",
  instanceId: "peek-instance-1",
  type: "browser-peek",
  name: "Peek app.local",
  hostId: "host-test",
  chatId: "chat-1",
  sessionId: "headless-1",
  tabId: "headless-tab-1",
  initialUrl: "http://localhost:3000",
};

const HEADLESS_SESSION = {
  sessionId: "headless-1",
  epicId: "epic-1",
  hostId: "host-test",
  profile: "primary" as const,
  name: "Agent browser",
  createdBy: { chatId: "chat-1", agentRunId: "agent-1" },
  createdAt: 1,
  lastActivityAt: 2,
  tabs: [
    {
      tabId: "headless-tab-1",
      url: "http://localhost:3000",
      originTier: "dev" as const,
      status: "ready" as const,
      title: "Local app",
      drivenBy: [],
    },
  ],
};

describe("BrowserSessionDock", () => {
  beforeEach(() => {
    hookState.visible = true;
    hookState.streamClient = new FakeStreamClient();
    hookState.streamClientFactory = null;
    splitPaneWithNodeMock.fn.mockReset();
    openFreshBrowserTileMock.fn.mockReset();
    applyStorageStateMock.fn.mockReset();
    captureStorageStateMock.fn.mockReset();
    applyStorageStateMock.fn.mockResolvedValue({
      status: "applied",
      cookieCount: 1,
      localStorageApplied: false,
      reason: "cookies-only",
    });
    captureStorageStateMock.fn.mockResolvedValue({
      storageState: {
        cookies: [{ name: "sid", value: "1" }],
        origins: [
          {
            origin: "http://localhost:3000",
            localStorage: [{ name: "token", value: "abc" }],
          },
        ],
      },
      cookieCount: 1,
      cookieDomains: ["localhost"],
      localStorageCount: 1,
      localStorageAvailable: true,
      localStorageReason: null,
    });
    resetBrowserTileControlStoreForTests();
  });

  afterEach(() => {
    cleanup();
    hookState.streamClientFactory = null;
    resetBrowserTileControlStoreForTests();
  });

  it("does not dispatch during render when the stream client identity churns", () => {
    hookState.streamClientFactory = () => new FakeStreamClient();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    renderDock();

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Too many re-renders"),
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
  });

  it("opens a read-only peek tile for a headless session", () => {
    renderDock();
    const stream = liveStream();

    act(() => {
      stream.emit(
        {
          kind: "snapshot",
          hasBinaryPayload: false,
          sessions: [HEADLESS_SESSION],
        },
        null,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Peek" }));

    expect(splitPaneWithNodeMock.fn).toHaveBeenCalledWith(
      "tab-1",
      "pane-1",
      "right",
      expect.objectContaining({
        type: "browser-peek",
        chatId: "chat-1",
        sessionId: "headless-1",
        tabId: "headless-tab-1",
        initialUrl: "http://localhost:3000",
      }),
    );
  });

  it("requests promote state before opening a visible handoff", async () => {
    renderDock();
    const stream = liveStream();
    act(() => {
      stream.emit(
        {
          kind: "snapshot",
          hasBinaryPayload: false,
          sessions: [HEADLESS_SESSION],
        },
        null,
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Continue at URL (handoff)" }),
    );
    const request = stream.sentFrames.find(
      (frame) => frame.kind === "getPromoteState",
    );
    expect(request).toMatchObject({
      kind: "getPromoteState",
      sessionId: "headless-1",
    });

    act(() => {
      stream.emit(
        {
          kind: "promoteState",
          hasBinaryPayload: false,
          requestId:
            request?.kind === "getPromoteState" ? request.requestId : "",
          url: "http://localhost:3000/dashboard",
          storageState: { cookies: [], origins: [] },
        },
        null,
      );
    });

    await screen.findByText(/in-page JS, SPA state, and live sockets/i);
    expect(applyStorageStateMock.fn).toHaveBeenCalledWith({
      storageState: { cookies: [], origins: [] },
    });
    expect(openFreshBrowserTileMock.fn).toHaveBeenCalledWith({
      viewTabId: "tab-1",
      paneId: "pane-1",
      hostId: "host-test",
      url: "http://localhost:3000/dashboard",
    });
  });

  it("opens without cookie replay and surfaces degraded browser persistence", async () => {
    applyStorageStateMock.fn.mockResolvedValue({
      status: "skipped-degraded",
      cookieCount: 0,
      localStorageApplied: false,
      reason: "mock-keychain",
    });
    renderDock();
    const stream = liveStream();
    act(() => {
      stream.emit(
        {
          kind: "snapshot",
          hasBinaryPayload: false,
          sessions: [HEADLESS_SESSION],
        },
        null,
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Continue at URL (handoff)" }),
    );
    const request = stream.sentFrames.find(
      (frame) => frame.kind === "getPromoteState",
    );
    act(() => {
      stream.emit(
        {
          kind: "promoteState",
          hasBinaryPayload: false,
          requestId:
            request?.kind === "getPromoteState" ? request.requestId : "",
          url: "http://localhost:3000/dashboard",
          storageState: { cookies: [], origins: [] },
        },
        null,
      );
    });

    await screen.findByText(/without cookie replay/i);
    expect(screen.getByText(/mock-keychain/i)).toBeTruthy();
    expect(openFreshBrowserTileMock.fn).toHaveBeenCalledWith({
      viewTabId: "tab-1",
      paneId: "pane-1",
      hostId: "host-test",
      url: "http://localhost:3000/dashboard",
    });
  });

  it("lends selected visible-origin auth to one headless session", async () => {
    renderDock();
    const stream = liveStream();
    act(() => {
      stream.emit(
        {
          kind: "snapshot",
          hasBinaryPayload: false,
          sessions: [HEADLESS_SESSION],
        },
        null,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Review auth" }));
    await waitFor(() => {
      expect(captureStorageStateMock.fn).toHaveBeenCalled();
    });
    const consent = await screen.findByTestId("browser-auth-lend-consent");
    expect(consent.textContent).toMatch(
      /Lends the cookies your browser would send to/i,
    );
    expect(within(consent).getByText("http://localhost:3000")).toBeTruthy();
    expect(screen.getByText(/Cookie domains \(1\): localhost/i)).toBeTruthy();
    expect(screen.getByText(/1 localStorage item included/i)).toBeTruthy();
    expect(
      screen.getByText(/Localhost cookies are shared across ports/i),
    ).toBeTruthy();
    expect(
      stream.sentFrames.some((frame) => frame.kind === "lendStorage"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm lend" }));
    const request = await waitFor(() => {
      const sent = stream.sentFrames.find(
        (frame) => frame.kind === "lendStorage",
      );
      expect(sent).toBeDefined();
      return sent;
    });

    expect(captureStorageStateMock.fn).toHaveBeenCalledWith({
      viewTabId: "tab-1",
      paneId: "pane-browser",
      tileInstanceId: "browser-instance-1",
      pageSessionId: "browser-page-1",
      origin: "http://localhost:3000",
    });
    expect(request).toMatchObject({
      kind: "lendStorage",
      sessionId: "headless-1",
      origin: "http://localhost:3000",
      storage: {
        cookies: [{ name: "sid", value: "1" }],
        origins: [
          {
            origin: "http://localhost:3000",
            localStorage: [{ name: "token", value: "abc" }],
          },
        ],
      },
    });

    act(() => {
      stream.emit(
        {
          kind: "lendResult",
          hasBinaryPayload: false,
          requestId: request?.requestId,
          ok: true,
          reason: null,
        },
        null,
      );
    });

    await screen.findByText(
      /Lent 1 cookie your browser would send to http:\/\/localhost:3000 and 1 localStorage item/i,
    );
  });

  it("fails closed and does not open a handoff for malformed storageState", async () => {
    applyStorageStateMock.fn.mockRejectedValue(
      new Error("Browser storageState cookies must be an array"),
    );
    renderDock();
    const stream = liveStream();
    act(() => {
      stream.emit(
        {
          kind: "snapshot",
          hasBinaryPayload: false,
          sessions: [HEADLESS_SESSION],
        },
        null,
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Continue at URL (handoff)" }),
    );
    const request = stream.sentFrames.find(
      (frame) => frame.kind === "getPromoteState",
    );
    act(() => {
      stream.emit(
        {
          kind: "promoteState",
          hasBinaryPayload: false,
          requestId:
            request?.kind === "getPromoteState" ? request.requestId : "",
          url: "http://localhost:3000/dashboard",
          storageState: { cookies: "bad", origins: [] },
        },
        null,
      );
    });

    await screen.findByText(/cookies must be an array/i);
    expect(openFreshBrowserTileMock.fn).not.toHaveBeenCalled();
  });

  it("clears an expired queued control prompt by request id and tile id", () => {
    renderDock();
    const stream = liveStream();
    act(() => {
      stream.emit(
        {
          kind: "visibleTileControlRequest",
          hasBinaryPayload: false,
          requestId: "request-1",
          grantId: "grant-1",
          chatId: "chat-1",
          agentRunId: "agent-1",
          agentLabel: "Agent One",
          tileInstanceId: "tile-1",
          origin: "http://localhost:3000",
          url: "http://localhost:3000/app",
          requestedAt: 1,
          expiresAt: 61,
        },
        null,
      );
      stream.emit(
        {
          kind: "visibleTileControlRequest",
          hasBinaryPayload: false,
          requestId: "request-2",
          grantId: "grant-2",
          chatId: "chat-1",
          agentRunId: "agent-2",
          agentLabel: "Agent Two",
          tileInstanceId: "tile-1",
          origin: "http://localhost:3000",
          url: "http://localhost:3000/app",
          requestedAt: 2,
          expiresAt: 62,
        },
        null,
      );
    });
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toMatchObject({
      pending: { requestId: "request-1" },
      pendingCount: 2,
    });
    const activeRequest = {
      requestId: "active-request",
      grantId: "active-grant",
      chatId: "chat-1",
      agentRunId: "agent-active",
      agentLabel: "Active Agent",
      tileInstanceId: "tile-1",
      origin: "http://localhost:3000",
      url: "http://localhost:3000/app",
      requestedAt: 0,
      expiresAt: 60,
      sendFrame: vi.fn(),
    };
    act(() => {
      activateBrowserTileControl({
        request: activeRequest,
        grant: {
          grantId: "active-grant",
          chatId: "chat-1",
          tileInstanceId: "tile-1",
          origin: "http://localhost:3000",
          dataLevel: "control",
          expiresAt: 60,
        },
      });
    });

    act(() => {
      stream.emit(
        {
          kind: "visibleTileControlResult",
          hasBinaryPayload: false,
          requestId: "request-1",
          tileInstanceId: "tile-1",
          ok: false,
          reason: "Visible tile control request expired.",
          grant: null,
        },
        null,
      );
    });

    expect(readBrowserTileControlSnapshotForTests("tile-1")).toMatchObject({
      pending: { requestId: "request-2" },
      pendingCount: 1,
      active: { requestId: "active-request" },
    });
  });
});

describe("BrowserPeekTile", () => {
  beforeEach(() => {
    hookState.visible = true;
    hookState.streamClient = new FakeStreamClient();
    hookState.streamClientFactory = null;
  });

  afterEach(() => {
    cleanup();
    hookState.streamClientFactory = null;
  });

  it("does not dispatch during render when the peek stream client identity churns", () => {
    hookState.streamClientFactory = () => new FakeStreamClient();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Too many re-renders"),
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
  });

  it("renders JPEG frames and acks each frame", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    act(() => {
      stream.emitStatus("open");
      stream.emit(
        {
          kind: "started",
          hasBinaryPayload: false,
          frameWidth: 800,
          frameHeight: 600,
          deviceScaleFactor: 1,
        },
        null,
      );
      stream.emit(
        {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 7,
          metadata: {
            offsetTop: 0,
            pageScaleFactor: 1,
            deviceWidth: 800,
            deviceHeight: 600,
            scrollOffsetX: 0,
            scrollOffsetY: 0,
            timestamp: 1,
          },
        },
        new Uint8Array([1, 2, 3]),
      );
    });

    expect(
      screen.getByAltText("Read-only browser screencast").getAttribute("src"),
    ).toBe("data:image/jpeg;base64,AQID");
    expect(stream.sentFrames).toContainEqual({
      kind: "ack",
      hasBinaryPayload: false,
      sequence: 7,
    });
  });

  it("pauses the stream when the tile is hidden", () => {
    const { rerender } = render(
      <BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />,
    );
    const stream = liveStream();

    hookState.visible = false;
    rerender(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);

    expect(stream.sentFrames).toContainEqual({
      kind: "setPaused",
      hasBinaryPayload: false,
      paused: true,
    });
  });
});
