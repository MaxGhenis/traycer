import "../../../../../__tests__/test-browser-apis";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPeekTile } from "@/components/epic-canvas/renderers/browser-peek-tile";
import { SCREENCAST_UNSUPPORTED_INTERACTION_TOASTS } from "@/components/epic-canvas/renderers/use-screencast-tile-chrome";
import type { BrowserPeekTileRef } from "@/stores/epics/canvas/types";

const toast = vi.hoisted(() => vi.fn());

const hookState = vi.hoisted(() => ({
  streamClient: null as FakeStreamClient | null,
  visible: true,
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/components/epic-canvas/hooks/use-tab-host-id", () => ({
  useTabHostId: () => "host-test",
}));

vi.mock("@/components/epic-canvas/hooks/use-tile-body-visible", () => ({
  useTileBodyVisible: () => hookState.visible,
}));

vi.mock("@/hooks/host/use-host-directory-entry", () => ({
  useHostDirectoryEntry: () => ({ hostId: "host-test" }),
}));

vi.mock("@/hooks/host/use-host-stream-client-for", () => ({
  useHostStreamClientFor: () => hookState.streamClient,
  authenticatedHostStreamKey: () => "authenticated-host-test",
  authenticatedOwnerIdentityKey: () => "local\u0000host-test\u0000user-test",
}));

vi.mock("@/lib/host/stream-auth-revalidator", () => ({
  useStreamAuthRevalidator: () => null,
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
  private currentStatus: "connecting" | "open" | "reconnecting" | "closed" =
    "connecting";
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
    if (this.currentStatus === "open") handler("open", null);
  }

  close(): void {
    this.closed = true;
  }

  emitStatus(status: "connecting" | "open" | "reconnecting" | "closed"): void {
    this.currentStatus = status;
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

  constructor(private readonly autoOpen: boolean) {}

  subscribe(method: string, params: unknown): FakeStreamSession {
    const session = new FakeStreamSession();
    this.sessions.push(session);
    this.subscribes.push({ method, params });
    if (this.autoOpen) session.emitStatus("open");
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

const URL_A = "https://example.com/a";
const URL_B = "https://example.com/b";
const URL_C = "https://example.com/c";
const DRAFT_URL = "https://draft.example/path";

function liveStream(): FakeStreamSession {
  const sessions = hookState.streamClient?.sessions ?? [];
  const stream = sessions.at(-1);
  if (stream === undefined) {
    throw new Error("expected browser.screencast stream");
  }
  return stream;
}

function overlayButton(): HTMLElement {
  return screen.getByRole("button", { name: "Browser screencast controls" });
}

function addressInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Browser address" });
}

function framesOfKind(
  stream: FakeStreamSession,
  kind: string,
): Array<Record<string, unknown>> {
  return stream.sentFrames.filter((frame) => frame.kind === kind);
}

function emitNavState(stream: FakeStreamSession, url: string): void {
  act(() => {
    stream.emit(
      {
        kind: "navState",
        hasBinaryPayload: false,
        url,
        canGoBack: false,
        canGoForward: false,
        loading: false,
      },
      null,
    );
  });
}

function emitUnsupported(
  stream: FakeStreamSession,
  feature: "fileUpload" | "download",
): void {
  act(() => {
    stream.emit(
      {
        kind: "unsupportedInteraction",
        hasBinaryPayload: false,
        feature,
      },
      null,
    );
  });
}

async function flushMacrotask(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function armPeekTile(stream: FakeStreamSession): void {
  fireEvent.focus(overlayButton());
  act(() => {
    stream.emit({ kind: "armed", hasBinaryPayload: false, armEpoch: 1 }, null);
  });
}

describe("BrowserPeekTile toolbar chrome", () => {
  beforeEach(() => {
    hookState.visible = true;
    hookState.streamClient = new FakeStreamClient(true);
    toast.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hides the controlling chip until armed and release disarms that epoch", async () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();

    expect(screen.queryByText("Controlling")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Release control" }),
    ).toBeNull();

    armPeekTile(stream);
    await flushMacrotask();

    expect(screen.getByText("Controlling")).not.toBeNull();
    const release = screen.getByRole("button", { name: "Release control" });
    expect(release.textContent).toBe("Release");

    fireEvent.click(release);
    await flushMacrotask();

    expect(screen.queryByText("Controlling")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Release control" }),
    ).toBeNull();
    expect(framesOfKind(stream, "disarm")).toEqual([
      {
        kind: "disarm",
        hasBinaryPayload: false,
        armEpoch: 1,
      },
    ]);
  });

  it("toasts once per unsupportedInteraction feature", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();

    expect(SCREENCAST_UNSUPPORTED_INTERACTION_TOASTS.fileUpload).toBe(
      "File upload not supported",
    );
    expect(SCREENCAST_UNSUPPORTED_INTERACTION_TOASTS.download).toBe(
      "Download saved on the host",
    );

    emitUnsupported(stream, "fileUpload");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenNthCalledWith(
      1,
      SCREENCAST_UNSUPPORTED_INTERACTION_TOASTS.fileUpload,
    );

    emitUnsupported(stream, "download");
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenNthCalledWith(
      2,
      SCREENCAST_UNSUPPORTED_INTERACTION_TOASTS.download,
    );
  });

  it("keeps the focused address draft when the agent navigates", async () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();

    emitNavState(stream, URL_A);
    expect(addressInput().value).toBe(URL_A);

    const input = addressInput();
    fireEvent.focus(input);
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: DRAFT_URL } });
    expect(addressInput().value).toBe(DRAFT_URL);

    emitNavState(stream, URL_B);
    expect(addressInput().value).toBe(DRAFT_URL);

    fireEvent.blur(addressInput());
    fireEvent.focusOut(addressInput());
    await flushMacrotask();
    expect(addressInput().value).toBe(URL_B);

    emitNavState(stream, URL_C);
    expect(addressInput().value).toBe(URL_C);
  });

  it("auto-arms from a cold toolbar back click and sends goBack only after confirmation", async () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();

    act(() => {
      stream.emit(
        {
          kind: "navState",
          hasBinaryPayload: false,
          url: URL_A,
          canGoBack: true,
          canGoForward: false,
          loading: false,
        },
        null,
      );
    });
    await flushMacrotask();

    const back = screen.getByRole("button", { name: "Back" });
    expect((back as HTMLButtonElement).disabled).toBe(false);
    expect(framesOfKind(stream, "arm")).toEqual([]);
    expect(framesOfKind(stream, "goBack")).toEqual([]);

    fireEvent.click(back);

    expect(framesOfKind(stream, "arm")).toEqual([
      { kind: "arm", hasBinaryPayload: false, armEpoch: 1 },
    ]);
    expect(framesOfKind(stream, "goBack")).toEqual([]);

    act(() => {
      stream.emit(
        { kind: "armed", hasBinaryPayload: false, armEpoch: 1 },
        null,
      );
    });
    await flushMacrotask();

    expect(framesOfKind(stream, "goBack")).toEqual([
      {
        kind: "goBack",
        hasBinaryPayload: false,
        armEpoch: 1,
        seq: 0,
      },
    ]);
  });
});
