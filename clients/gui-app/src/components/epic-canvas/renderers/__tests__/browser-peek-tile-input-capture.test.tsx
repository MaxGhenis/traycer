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
import type { BrowserPeekTileRef } from "@/stores/epics/canvas/types";

const hookState = vi.hoisted(() => ({
  streamClient: null as FakeStreamClient | null,
  visible: true,
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

const JPEG_SEQ_7 = new Uint8Array([1, 2, 3]);
const JPEG_SEQ_8 = new Uint8Array([4, 5, 6]);

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

function imeInput(): HTMLElement {
  return screen.getByRole("textbox", { name: "Browser IME input" });
}

function peekTile(): HTMLElement {
  return screen.getByTestId(`browser-peek-tile-${PEEK_NODE.instanceId}`);
}

function framesOfKind(
  stream: FakeStreamSession,
  kind: string,
): Array<Record<string, unknown>> {
  return stream.sentFrames.filter((frame) => frame.kind === kind);
}

function pointerEventInit(input: {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons: number;
  readonly detail: number;
}): {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons: number;
  readonly detail: number;
} {
  return {
    pointerId: 1,
    clientX: input.clientX,
    clientY: input.clientY,
    button: input.button,
    buttons: input.buttons,
    detail: input.detail,
  };
}

function emitStarted(stream: FakeStreamSession): void {
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
}

function emitJpegFrame(
  stream: FakeStreamSession,
  sequence: number,
  bytes: Uint8Array,
): void {
  stream.emit(
    {
      kind: "frame",
      hasBinaryPayload: true,
      sequence,
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
    bytes,
  );
}

function loadScreencastImage(): HTMLImageElement {
  const image = screen.getByAltText("Browser screencast");
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  fireEvent.load(image);
  return image;
}

function presentLiveFrame(
  stream: FakeStreamSession,
  sequence: number,
  bytes: Uint8Array,
): HTMLImageElement {
  act(() => {
    emitStarted(stream);
    emitJpegFrame(stream, sequence, bytes);
  });
  return loadScreencastImage();
}

function armPeekTile(stream: FakeStreamSession): void {
  fireEvent.focus(overlayButton());
  act(() => {
    stream.emit({ kind: "armed", hasBinaryPayload: false, armEpoch: 1 }, null);
  });
}

function emitArmed(stream: FakeStreamSession, armEpoch: number): void {
  act(() => {
    stream.emit({ kind: "armed", hasBinaryPayload: false, armEpoch }, null);
  });
}

function installAnimationFrameQueue(): {
  readonly runNextFrame: () => void;
  readonly pendingCount: () => number;
} {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
    callbacks.delete(handle);
  });
  return {
    runNextFrame: () => {
      const entry = Array.from(callbacks.entries()).at(0);
      if (entry === undefined) {
        throw new Error("Expected a pending animation frame.");
      }
      const [handle, callback] = entry;
      callbacks.delete(handle);
      callback(0);
    },
    pendingCount: () => callbacks.size,
  };
}

describe("BrowserPeekTile input capture", () => {
  beforeEach(() => {
    hookState.visible = true;
    hookState.streamClient = new FakeStreamClient(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("captures pointerId 1 on the overlay button at pointerdown", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();
    const setPointerCapture = vi.spyOn(button, "setPointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );

    expect(setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("releases pointer capture on pointerup", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();
    const releasePointerCapture = vi.spyOn(button, "releasePointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );

    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("releases pointer capture on pointercancel", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();
    const releasePointerCapture = vi.spyOn(button, "releasePointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerCancel(button, { pointerId: 1 });

    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(framesOfKind(stream, "pointer")).toEqual([]);
  });

  it("sends a matching clamped up on pointercancel after an accepted down", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();
    const releasePointerCapture = vi.spyOn(button, "releasePointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerCancel(button, { pointerId: 1 });

    expect(framesOfKind(stream, "pointer")).toEqual([
      expect.objectContaining({
        type: "down",
        button: "left",
        buttons: 1,
        clickCount: 1,
        normalizedX: 0.5,
        normalizedY: 0.5,
        seq: 0,
      }),
      expect.objectContaining({
        type: "up",
        button: "left",
        buttons: 0,
        clickCount: 1,
        normalizedX: 0.5,
        normalizedY: 0.5,
        seq: 1,
      }),
    ]);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("releases pointer capture when the server revokes the arm", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();
    const releasePointerCapture = vi.spyOn(button, "releasePointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    act(() => {
      stream.emit(
        {
          kind: "revoked",
          hasBinaryPayload: false,
          armEpoch: 1,
          cause: "stolen",
        },
        null,
      );
    });

    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("releases pointer capture on blur-disarm", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();
    const releasePointerCapture = vi.spyOn(button, "releasePointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.blur(imeInput(), { relatedTarget: document.body });

    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(framesOfKind(stream, "disarm")).toContainEqual({
      kind: "disarm",
      hasBinaryPayload: false,
      armEpoch: 1,
    });
    expect(peekTile().querySelector(".ring-primary")).toBeNull();
  });

  it("releases pointer capture when the stream leaves open", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();
    const releasePointerCapture = vi.spyOn(button, "releasePointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    act(() => {
      stream.emitStatus("reconnecting");
    });

    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("keeps the same screencast image mounted across sequence changes", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    const first = presentLiveFrame(stream, 7, JPEG_SEQ_7);

    act(() => {
      emitJpegFrame(stream, 8, JPEG_SEQ_8);
    });
    const second = screen.getByAltText("Browser screencast");

    expect(second).toBe(first);
    expect(second.getAttribute("src")).toBe("data:image/jpeg;base64,BAUG");
  });

  it("sends clamped clickCount on armed down/up and 0 on move/wheel", async () => {
    const frames = installAnimationFrameQueue();
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 9,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 9,
      }),
    );
    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 200,
        clientY: 150,
        button: -1,
        buttons: 0,
        detail: 3,
      }),
    );
    frames.runNextFrame();
    await Promise.resolve();
    button.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 0,
        deltaY: 16,
        deltaMode: 0,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(framesOfKind(stream, "pointer")).toEqual([
      expect.objectContaining({
        type: "down",
        clickCount: 8,
        seq: 0,
      }),
      expect.objectContaining({
        type: "up",
        clickCount: 8,
        seq: 1,
      }),
      expect.objectContaining({
        type: "move",
        clickCount: 0,
        seq: 2,
      }),
      expect.objectContaining({
        type: "wheel",
        clickCount: 0,
        seq: 3,
      }),
    ]);
  });

  it("emits at most one move per animation frame and keeps the latest sample", async () => {
    const frames = installAnimationFrameQueue();
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();

    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 100,
        clientY: 100,
        button: -1,
        buttons: 0,
        detail: 0,
      }),
    );
    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 200,
        clientY: 150,
        button: -1,
        buttons: 0,
        detail: 0,
      }),
    );
    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: -1,
        buttons: 0,
        detail: 0,
      }),
    );
    expect(framesOfKind(stream, "pointer")).toEqual([]);
    expect(frames.pendingCount()).toBe(1);

    // React 19 act() can collapse rAF; flush the queued callback directly.
    frames.runNextFrame();
    await Promise.resolve();

    expect(framesOfKind(stream, "pointer")).toEqual([
      expect.objectContaining({
        type: "move",
        normalizedX: 0.5,
        normalizedY: 0.5,
        clickCount: 0,
        seq: 0,
      }),
    ]);
  });

  it("flushes a pending move before down, up, and wheel", async () => {
    const frames = installAnimationFrameQueue();
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();

    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 200,
        clientY: 150,
        button: -1,
        buttons: 0,
        detail: 0,
      }),
    );
    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    expect(framesOfKind(stream, "pointer").map((frame) => frame.type)).toEqual([
      "move",
      "down",
    ]);

    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 480,
        clientY: 360,
        button: -1,
        buttons: 1,
        detail: 0,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 480,
        clientY: 360,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );
    expect(framesOfKind(stream, "pointer").map((frame) => frame.type)).toEqual([
      "move",
      "down",
      "move",
      "up",
    ]);

    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 100,
        clientY: 100,
        button: -1,
        buttons: 0,
        detail: 0,
      }),
    );
    button.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 0,
        deltaY: 8,
        deltaMode: 0,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();

    expect(framesOfKind(stream, "pointer").map((frame) => frame.type)).toEqual([
      "move",
      "down",
      "move",
      "up",
      "move",
      "wheel",
    ]);
    expect(frames.pendingCount()).toBe(0);
  });

  it("normalizes armed wheel deltas and drops wheels outside the image", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();
    Object.defineProperty(button, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(button, "clientHeight", {
      configurable: true,
      value: 600,
    });

    button.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 0,
        deltaY: 2,
        deltaMode: 1,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );
    button.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 1,
        deltaY: 1,
        deltaMode: 2,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );
    button.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 0,
        deltaY: 4,
        deltaMode: 1,
        clientX: -20,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(framesOfKind(stream, "pointer")).toEqual([
      expect.objectContaining({
        type: "wheel",
        deltaX: 0,
        deltaY: 32,
        clickCount: 0,
        seq: 0,
      }),
      expect.objectContaining({
        type: "wheel",
        deltaX: 800,
        deltaY: 600,
        clickCount: 0,
        seq: 1,
      }),
    ]);
  });

  it("does not listen for wheel while unarmed", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();

    button.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 0,
        deltaY: 16,
        deltaMode: 0,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(framesOfKind(stream, "pointer")).toEqual([]);
  });

  it("forwards Escape as a repeating rawKeyDown without disarming", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    armPeekTile(stream);

    fireEvent.keyDown(imeInput(), {
      key: "Escape",
      code: "Escape",
      repeat: true,
    });

    expect(framesOfKind(stream, "keyboard")).toEqual([
      expect.objectContaining({
        kind: "keyboard",
        type: "rawKeyDown",
        key: "Escape",
        code: "Escape",
        autoRepeat: true,
        seq: 0,
      }),
    ]);
    expect(framesOfKind(stream, "disarm")).toEqual([]);
    expect(peekTile().querySelector(".ring-primary")).not.toBeNull();
  });

  it("forwards autoRepeat on a held letter", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    armPeekTile(stream);

    fireEvent.keyDown(imeInput(), {
      key: "a",
      code: "KeyA",
      repeat: true,
    });

    expect(framesOfKind(stream, "keyboard")).toEqual([
      expect.objectContaining({
        type: "rawKeyDown",
        key: "a",
        code: "KeyA",
        autoRepeat: true,
        seq: 0,
      }),
      expect.objectContaining({
        type: "char",
        key: "a",
        code: "KeyA",
        autoRepeat: true,
        seq: 1,
      }),
    ]);
  });

  it("disarms, pauses, and releases capture when the tile is hidden", () => {
    const view = render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();
    const releasePointerCapture = vi.spyOn(button, "releasePointerCapture");

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    hookState.visible = false;
    view.rerender(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);

    expect(framesOfKind(stream, "disarm")).toContainEqual({
      kind: "disarm",
      hasBinaryPayload: false,
      armEpoch: 1,
    });
    expect(framesOfKind(stream, "setPaused")).toContainEqual({
      kind: "setPaused",
      hasBinaryPayload: false,
      paused: true,
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(peekTile().querySelector(".ring-primary")).toBeNull();
  });

  it("delivers a buffered cold click after arm confirmation", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );
    expect(framesOfKind(stream, "arm")).toContainEqual({
      kind: "arm",
      hasBinaryPayload: false,
      armEpoch: 1,
    });
    expect(framesOfKind(stream, "pointer")).toEqual([]);

    emitArmed(stream, 1);

    expect(framesOfKind(stream, "pointer")).toEqual([
      expect.objectContaining({
        type: "down",
        castSequence: 7,
        clickCount: 1,
        normalizedX: 0.5,
        normalizedY: 0.5,
        seq: 0,
      }),
      expect.objectContaining({
        type: "up",
        castSequence: 7,
        clickCount: 1,
        normalizedX: 0.5,
        normalizedY: 0.5,
        seq: 1,
      }),
    ]);
    expect(peekTile().querySelector(".ring-primary")).not.toBeNull();
  });

  it("drops a buffered click when the presented sequence changes before arm", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );
    act(() => {
      emitJpegFrame(stream, 8, JPEG_SEQ_8);
    });
    loadScreencastImage();
    emitArmed(stream, 1);

    expect(framesOfKind(stream, "pointer")).toEqual([]);
    expect(peekTile().querySelector(".ring-primary")).not.toBeNull();
  });

  it("does not replay a cold down when arm confirms before the matching up", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    emitArmed(stream, 1);
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );

    expect(framesOfKind(stream, "pointer")).toEqual([]);
    expect(peekTile().querySelector(".ring-primary")).not.toBeNull();
  });

  it("turns a buffered drag into arm-only", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: 410,
        clientY: 300,
        button: -1,
        buttons: 1,
        detail: 0,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 410,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );
    emitArmed(stream, 1);

    expect(framesOfKind(stream, "pointer")).toEqual([]);
    expect(peekTile().querySelector(".ring-primary")).not.toBeNull();
  });

  it("does not deliver a buffered gesture after a stream reset", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );
    act(() => {
      stream.emitStatus("reconnecting");
    });
    emitArmed(stream, 1);

    expect(framesOfKind(stream, "pointer")).toEqual([]);
  });

  it("drops both pointer frames when an armed down starts in the letterbox", () => {
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    const image = presentLiveFrame(stream, 7, JPEG_SEQ_7);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 800, 800),
    );
    armPeekTile(stream);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 50,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 400,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );

    expect(framesOfKind(stream, "pointer")).toEqual([]);
  });

  it("drops an armed down outside the image and clamps a captured move/up to the edge", async () => {
    const frames = installAnimationFrameQueue();
    render(<BrowserPeekTile epicId="epic-1" node={PEEK_NODE} />);
    const stream = liveStream();
    presentLiveFrame(stream, 7, JPEG_SEQ_7);
    armPeekTile(stream);
    const button = overlayButton();

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: -20,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    expect(framesOfKind(stream, "pointer")).toEqual([]);

    fireEvent.pointerDown(
      button,
      pointerEventInit({
        clientX: 400,
        clientY: 300,
        button: 0,
        buttons: 1,
        detail: 1,
      }),
    );
    fireEvent.pointerMove(
      button,
      pointerEventInit({
        clientX: -20,
        clientY: 300,
        button: -1,
        buttons: 1,
        detail: 0,
      }),
    );
    frames.runNextFrame();
    await Promise.resolve();
    fireEvent.pointerUp(
      button,
      pointerEventInit({
        clientX: -20,
        clientY: 300,
        button: 0,
        buttons: 0,
        detail: 1,
      }),
    );

    expect(framesOfKind(stream, "pointer")).toEqual([
      expect.objectContaining({
        type: "down",
        normalizedX: 0.5,
        normalizedY: 0.5,
        seq: 0,
      }),
      expect.objectContaining({
        type: "move",
        normalizedX: 0,
        normalizedY: 0.5,
        seq: 1,
      }),
      expect.objectContaining({
        type: "up",
        normalizedX: 0,
        normalizedY: 0.5,
        seq: 2,
      }),
    ]);
  });
});
