import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BrowserDebugSession } from "../browser-debug-session";
import type { PipCaptureIpcPayload } from "../../../ipc-contracts/pip-capture-types";
import type {
  BrowserViewCapturedImage,
  BrowserViewDebugger,
  BrowserViewDevToolsWebContents,
  BrowserViewFindInPageOptions,
  BrowserViewOpenDevToolsOptions,
  BrowserViewWebContents,
  BrowserViewWindowOpenDetails,
  BrowserViewWindowOpenResult,
} from "../browser-view-manager";

vi.mock("../../app/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  describeLogError: (err: unknown) => String(err),
}));

const CAPTURE_MAX_WIDTH = 400;
const CAPTURE_MAX_HEIGHT = 300;
const CAPTURE_QUALITY = 80;

const FRAME_METADATA = {
  offsetTop: 0,
  pageScaleFactor: 1,
  deviceWidth: 800,
  deviceHeight: 600,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
  timestamp: 1.5,
};

interface RecordedCommand {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

class FakeDebugger implements BrowserViewDebugger {
  attached = false;
  deferCommands = false;
  readonly commands: RecordedCommand[] = [];
  readonly commandResolvers: Array<(value: unknown) => void> = [];
  private readonly events = new EventEmitter();

  isAttached(): boolean {
    return this.attached;
  }

  attach(_protocolVersion: string): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
  }

  sendCommand(
    method: string,
    commandParams: Record<string, unknown>,
    sessionId: string | undefined,
  ): Promise<unknown> {
    this.commands.push({ method, params: commandParams, sessionId });
    if (this.deferCommands) {
      return new Promise((resolve) => {
        this.commandResolvers.push(resolve);
      });
    }
    return Promise.resolve(null);
  }

  resolveDeferredCommands(): void {
    const resolvers = this.commandResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve(null);
    }
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.events.on(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.events.off(event, listener);
  }

  listenerCount(event: string): number {
    return this.events.listenerCount(event);
  }

  emitMessage(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): void {
    this.events.emit("message", {}, method, params, sessionId);
  }

  emitDetach(reason: string): void {
    this.attached = false;
    this.events.emit("detach", {}, reason);
  }

  commandMethods(): string[] {
    return this.commands.map((command) => command.method);
  }
}

class FakeWebContents implements BrowserViewWebContents {
  readonly id = 1;
  readonly debugger: FakeDebugger;
  readonly navigationHistory = undefined;

  constructor(browserDebugger: FakeDebugger) {
    this.debugger = browserDebugger;
  }

  loadURL(_url: string): Promise<unknown> {
    return Promise.resolve();
  }

  executeJavaScript(
    _script: string,
    _userGesture: boolean,
  ): Promise<unknown> {
    return Promise.resolve();
  }

  capturePage(): Promise<BrowserViewCapturedImage> {
    return Promise.resolve({
      toDataURL: () => "",
    });
  }

  getURL(): string {
    return "";
  }

  getTitle(): string {
    return "";
  }

  isDestroyed(): boolean {
    return false;
  }

  close(): void {}

  reload(): void {}

  findInPage(
    _text: string,
    _options: BrowserViewFindInPageOptions,
  ): number {
    return 0;
  }

  stopFindInPage(_action: "clearSelection"): void {}

  getZoomFactor(): number {
    return 1;
  }

  setZoomFactor(_factor: number): void {}

  setBackgroundThrottling(_allowed: boolean): void {}

  setDevToolsWebContents(
    _webContents: BrowserViewDevToolsWebContents,
  ): void {}

  openDevTools(_options: BrowserViewOpenDevToolsOptions): void {}

  setWindowOpenHandler(
    _handler: (
      details: BrowserViewWindowOpenDetails,
    ) => BrowserViewWindowOpenResult,
  ): void {}

  on(_event: string, _listener: (...args: unknown[]) => void): void {}

  off(_event: string, _listener: (...args: unknown[]) => void): void {}
}

interface CaptureHarness {
  readonly session: BrowserDebugSession;
  readonly dbg: FakeDebugger;
  readonly frames: PipCaptureIpcPayload[];
  readonly snapshot: { changes: number };
  readonly detached: string[];
}

function createHarness(): CaptureHarness {
  const dbg = new FakeDebugger();
  const frames: PipCaptureIpcPayload[] = [];
  const snapshot = { changes: 0 };
  const detached: string[] = [];
  const session = new BrowserDebugSession({
    webContents: new FakeWebContents(dbg),
    onSnapshotChange: () => {
      snapshot.changes += 1;
    },
    onDetached: (reason) => {
      detached.push(reason);
    },
    onTargetAttached: () => undefined,
  });
  return { session, dbg, frames, snapshot, detached };
}

async function startCapture(harness: CaptureHarness): Promise<void> {
  await harness.session.startPipCapture({
    maxWidth: CAPTURE_MAX_WIDTH,
    maxHeight: CAPTURE_MAX_HEIGHT,
    quality: CAPTURE_QUALITY,
    onFrame: (payload) => {
      harness.frames.push(payload);
    },
  });
}

function screencastFrameParams(
  sessionId: number,
  bytes: readonly number[],
): Record<string, unknown> {
  return {
    data: Buffer.from(bytes).toString("base64"),
    metadata: { ...FRAME_METADATA },
    sessionId,
  };
}

function emitScreencastFrame(
  dbg: FakeDebugger,
  sessionId: number,
  bytes: readonly number[],
  cdpSessionId: string | undefined,
): void {
  dbg.emitMessage(
    "Page.screencastFrame",
    screencastFrameParams(sessionId, bytes),
    cdpSessionId,
  );
}

describe("BrowserDebugSession PiP capture", () => {
  it("startPipCapture emits started and sends Page.enable then Page.startScreencast", async () => {
    const harness = createHarness();
    expect(harness.session.isPipCapturing()).toBe(false);

    await startCapture(harness);

    expect(harness.session.isPipCapturing()).toBe(true);
    expect(harness.frames).toEqual([
      {
        frame: {
          kind: "started",
          hasBinaryPayload: false,
          frameWidth: CAPTURE_MAX_WIDTH,
          frameHeight: CAPTURE_MAX_HEIGHT,
          deviceScaleFactor: 1,
        },
        jpegBytes: null,
      },
    ]);
    expect(harness.dbg.commandMethods()).toEqual([
      "Page.enable",
      "Page.startScreencast",
    ]);
    expect(harness.dbg.commands[0]).toEqual({
      method: "Page.enable",
      params: {},
      sessionId: undefined,
    });
    expect(harness.dbg.commands[1]).toEqual({
      method: "Page.startScreencast",
      params: {
        format: "jpeg",
        quality: CAPTURE_QUALITY,
        maxWidth: CAPTURE_MAX_WIDTH,
        maxHeight: CAPTURE_MAX_HEIGHT,
      },
      sessionId: undefined,
    });
  });

  it("forwards a Page.screencastFrame, acks immediately, and increments sequence", async () => {
    const harness = createHarness();
    await startCapture(harness);

    emitScreencastFrame(harness.dbg, 11, [1, 2, 3], undefined);
    await Promise.resolve();
    emitScreencastFrame(harness.dbg, 12, [4, 5, 6], undefined);

    expect(harness.frames.slice(1)).toEqual([
      {
        frame: {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 0,
          metadata: FRAME_METADATA,
        },
        jpegBytes: Uint8Array.from([1, 2, 3]),
      },
      {
        frame: {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 1,
          metadata: FRAME_METADATA,
        },
        jpegBytes: Uint8Array.from([4, 5, 6]),
      },
    ]);
    expect(
      harness.dbg.commands.filter(
        (command) => command.method === "Page.screencastFrameAck",
      ),
    ).toEqual([
      {
        method: "Page.screencastFrameAck",
        params: { sessionId: 11 },
        sessionId: undefined,
      },
      {
        method: "Page.screencastFrameAck",
        params: { sessionId: 12 },
        sessionId: undefined,
      },
    ]);
  });

  it("stopPipCapture sends Page.stopScreencast, drops listeners, and ignores later frames", async () => {
    const harness = createHarness();
    await startCapture(harness);
    expect(harness.dbg.listenerCount("message")).toBe(1);
    expect(harness.dbg.listenerCount("detach")).toBe(1);

    harness.session.stopPipCapture();

    expect(harness.session.isPipCapturing()).toBe(false);
    expect(harness.dbg.commandMethods()).toContain("Page.stopScreencast");
    expect(
      harness.dbg.commands.find(
        (command) => command.method === "Page.stopScreencast",
      ),
    ).toEqual({
      method: "Page.stopScreencast",
      params: {},
      sessionId: undefined,
    });
    expect(harness.dbg.listenerCount("message")).toBe(0);
    expect(harness.dbg.listenerCount("detach")).toBe(0);

    const framesAfterStop = harness.frames.length;
    emitScreencastFrame(harness.dbg, 11, [1, 2, 3], undefined);
    expect(harness.frames).toHaveLength(framesAfterStop);
    expect(
      harness.dbg.commands.filter(
        (command) => command.method === "Page.screencastFrameAck",
      ),
    ).toHaveLength(0);
  });

  it("mid-stream detach emits stalled, stops capture, and does not send Page.stopScreencast", async () => {
    const harness = createHarness();
    await startCapture(harness);
    emitScreencastFrame(harness.dbg, 11, [1, 2, 3], undefined);

    harness.dbg.emitDetach("gone");

    expect(harness.session.isPipCapturing()).toBe(false);
    expect(harness.frames.at(-1)).toEqual({
      frame: { kind: "stalled", hasBinaryPayload: false },
      jpegBytes: null,
    });
    expect(harness.dbg.commandMethods()).not.toContain("Page.stopScreencast");
    expect(harness.dbg.listenerCount("message")).toBe(0);
    expect(harness.dbg.listenerCount("detach")).toBe(0);

    const framesAfterDetach = harness.frames.length;
    emitScreencastFrame(harness.dbg, 12, [4, 5, 6], undefined);
    expect(harness.frames).toHaveLength(framesAfterDetach);
  });

  it("dispose while capturing emits stalled and removes listeners", async () => {
    const harness = createHarness();
    await startCapture(harness);

    harness.session.dispose();

    expect(harness.session.isPipCapturing()).toBe(false);
    expect(harness.frames.at(-1)).toEqual({
      frame: { kind: "stalled", hasBinaryPayload: false },
      jpegBytes: null,
    });
    expect(harness.dbg.listenerCount("message")).toBe(0);
    expect(harness.dbg.listenerCount("detach")).toBe(0);
    expect(harness.dbg.commandMethods()).not.toContain("Page.stopScreencast");
  });

  it("drops a same-turn frame if the previous one is still in flight, and never queues", async () => {
    const harness = createHarness();
    await startCapture(harness);

    emitScreencastFrame(harness.dbg, 11, [1, 2, 3], undefined);
    emitScreencastFrame(harness.dbg, 12, [4, 5, 6], undefined);

    expect(harness.frames.slice(1)).toEqual([
      {
        frame: {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 0,
          metadata: FRAME_METADATA,
        },
        jpegBytes: Uint8Array.from([1, 2, 3]),
      },
    ]);
    expect(
      harness.dbg.commands.filter(
        (command) => command.method === "Page.screencastFrameAck",
      ),
    ).toEqual([
      {
        method: "Page.screencastFrameAck",
        params: { sessionId: 11 },
        sessionId: undefined,
      },
      {
        method: "Page.screencastFrameAck",
        params: { sessionId: 12 },
        sessionId: undefined,
      },
    ]);

    await Promise.resolve();
    emitScreencastFrame(harness.dbg, 13, [7, 8, 9], undefined);

    expect(harness.frames.slice(1)).toEqual([
      {
        frame: {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 0,
          metadata: FRAME_METADATA,
        },
        jpegBytes: Uint8Array.from([1, 2, 3]),
      },
      {
        frame: {
          kind: "frame",
          hasBinaryPayload: true,
          sequence: 1,
          metadata: FRAME_METADATA,
        },
        jpegBytes: Uint8Array.from([7, 8, 9]),
      },
    ]);
  });

  it("does not feed Page.screencastFrame into the console/network path", async () => {
    const harness = createHarness();
    harness.session.enableAfterCommit();
    await startCapture(harness);
    expect(harness.session.snapshot()).toEqual({
      consoleEntries: [],
      networkEntries: [],
    });

    const changesAfterStart = harness.snapshot.changes;
    emitScreencastFrame(harness.dbg, 11, [1, 2, 3], undefined);

    expect(harness.snapshot.changes).toBe(changesAfterStart);
    expect(harness.session.snapshot()).toEqual({
      consoleEntries: [],
      networkEntries: [],
    });
    expect(harness.frames).toHaveLength(2);
    expect(harness.dbg.commandMethods()).toContain("Page.startScreencast");
    expect(harness.dbg.commandMethods()).toContain("Page.screencastFrameAck");

    harness.dbg.emitMessage(
      "Network.requestWillBeSent",
      {
        requestId: "req-1",
        request: { url: "https://example.com/", method: "GET" },
        timestamp: 1,
        wallTime: 1,
      },
      undefined,
    );
    expect(harness.snapshot.changes).toBe(changesAfterStart + 1);
    expect(harness.session.snapshot().networkEntries).toHaveLength(1);
  });

  it("acks early frames but emits started before any forwarded frame", async () => {
    const harness = createHarness();
    harness.dbg.deferCommands = true;

    const start = startCapture(harness);
    emitScreencastFrame(harness.dbg, 11, [1, 2, 3], undefined);

    expect(harness.frames).toEqual([]);
    expect(
      harness.dbg.commands.filter(
        (command) => command.method === "Page.screencastFrameAck",
      ),
    ).toEqual([
      {
        method: "Page.screencastFrameAck",
        params: { sessionId: 11 },
        sessionId: undefined,
      },
    ]);

    harness.dbg.deferCommands = false;
    harness.dbg.resolveDeferredCommands();
    await start;

    expect(harness.frames).toEqual([
      {
        frame: {
          kind: "started",
          hasBinaryPayload: false,
          frameWidth: CAPTURE_MAX_WIDTH,
          frameHeight: CAPTURE_MAX_HEIGHT,
          deviceScaleFactor: 1,
        },
        jpegBytes: null,
      },
    ]);
    expect(harness.session.isPipCapturing()).toBe(true);

    emitScreencastFrame(harness.dbg, 12, [4, 5, 6], undefined);
    expect(harness.frames[1]).toEqual({
      frame: {
        kind: "frame",
        hasBinaryPayload: true,
        sequence: 0,
        metadata: FRAME_METADATA,
      },
      jpegBytes: Uint8Array.from([4, 5, 6]),
    });
  });

  it("ignores child-target Page.screencastFrame events", async () => {
    const harness = createHarness();
    await startCapture(harness);

    emitScreencastFrame(harness.dbg, 11, [1, 2, 3], "child-session");

    expect(harness.frames).toHaveLength(1);
    expect(harness.frames[0]?.frame.kind).toBe("started");
    expect(
      harness.dbg.commands.filter(
        (command) => command.method === "Page.screencastFrameAck",
      ),
    ).toHaveLength(0);
  });
});
