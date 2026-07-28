import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentBrowserPostureDebugger,
  AgentBrowserPostureWebContents,
} from "../agent-browser-posture";

vi.mock("../../app/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  describeLogError: (err: unknown) => String(err),
}));

interface RecordedCommand {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

class FakeDebugger implements AgentBrowserPostureDebugger {
  attached: boolean;
  attachCalls = 0;
  readonly commands: RecordedCommand[] = [];
  attachError: Error | null = null;

  constructor(attached: boolean) {
    this.attached = attached;
  }

  isAttached(): boolean {
    return this.attached;
  }

  attach(_protocolVersion: string): void {
    this.attachCalls += 1;
    if (this.attachError !== null) {
      throw this.attachError;
    }
    this.attached = true;
  }

  sendCommand(
    method: string,
    commandParams: Record<string, unknown> | undefined,
    _sessionId: string | undefined,
  ): Promise<unknown> {
    this.commands.push({ method, params: commandParams });
    return Promise.resolve(null);
  }
}

class FakeWebContents
  extends EventEmitter
  implements AgentBrowserPostureWebContents
{
  readonly debugger: FakeDebugger;
  destroyed = false;
  focusCalls = 0;
  showCalls = 0;
  setFocusableCalls = 0;

  constructor(attached: boolean) {
    super();
    this.debugger = new FakeDebugger(attached);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  focus(): void {
    this.focusCalls += 1;
  }

  // Not on real WebContents as "show", but track any accidental activation
  // helpers tests may later grow; posture must never reach for window APIs.
  show(): void {
    this.showCalls += 1;
  }

  setFocusable(_focusable: boolean): void {
    this.setFocusableCalls += 1;
  }
}

function asWebContents(fake: FakeWebContents): AgentBrowserPostureWebContents {
  return fake;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function postureCommandMethods(fake: FakeWebContents): string[] {
  return fake.debugger.commands.map((command) => command.method);
}

describe("applyAgentBrowserBackgroundPosture", () => {
  it("attaches the debugger when not already attached and sends both CDP posture commands", async () => {
    const { applyAgentBrowserBackgroundPosture } =
      await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();

    expect(webContents.debugger.attachCalls).toBe(1);
    expect(webContents.debugger.attached).toBe(true);
    expect(postureCommandMethods(webContents)).toEqual([
      "Page.setWebLifecycleState",
      "Emulation.setFocusEmulationEnabled",
    ]);
    expect(webContents.debugger.commands).toEqual([
      {
        method: "Page.setWebLifecycleState",
        params: { state: "active" },
      },
      {
        method: "Emulation.setFocusEmulationEnabled",
        params: { enabled: true },
      },
    ]);
  });

  it("does not re-attach when the debugger is already attached", async () => {
    const { applyAgentBrowserBackgroundPosture } =
      await import("../agent-browser-posture");
    const webContents = new FakeWebContents(true);

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();

    expect(webContents.debugger.attachCalls).toBe(0);
    expect(postureCommandMethods(webContents)).toEqual([
      "Page.setWebLifecycleState",
      "Emulation.setFocusEmulationEnabled",
    ]);
  });

  it("re-sends both CDP posture commands on every did-navigate", async () => {
    const { applyAgentBrowserBackgroundPosture } =
      await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();
    expect(webContents.debugger.commands).toHaveLength(2);

    webContents.emit("did-navigate", {}, "https://example.com/a");
    await flush();
    expect(webContents.debugger.commands).toHaveLength(4);

    webContents.emit("did-navigate", {}, "https://other.example/b");
    await flush();
    expect(webContents.debugger.commands).toHaveLength(6);

    expect(postureCommandMethods(webContents)).toEqual([
      "Page.setWebLifecycleState",
      "Emulation.setFocusEmulationEnabled",
      "Page.setWebLifecycleState",
      "Emulation.setFocusEmulationEnabled",
      "Page.setWebLifecycleState",
      "Emulation.setFocusEmulationEnabled",
    ]);
    // Attach once on first send, not again on navigate when still attached.
    expect(webContents.debugger.attachCalls).toBe(1);
  });

  it("never focuses, shows, or otherwise activates the webContents", async () => {
    const { applyAgentBrowserBackgroundPosture } =
      await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    webContents.emit("did-navigate", {}, "https://example.com");
    await flush();

    expect(webContents.focusCalls).toBe(0);
    expect(webContents.showCalls).toBe(0);
    expect(webContents.setFocusableCalls).toBe(0);
  });

  it("skips CDP when webContents is already destroyed", async () => {
    const { applyAgentBrowserBackgroundPosture } =
      await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);
    webContents.destroyed = true;

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();

    expect(webContents.debugger.attachCalls).toBe(0);
    expect(webContents.debugger.commands).toEqual([]);
  });

  it("stops sending commands when debugger attach throws", async () => {
    const { applyAgentBrowserBackgroundPosture } =
      await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);
    webContents.debugger.attachError = new Error("attach refused");

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();

    expect(webContents.debugger.attachCalls).toBe(1);
    expect(webContents.debugger.commands).toEqual([]);
  });

  it("does not re-attach on did-navigate once setAgentBrowserPostureReleased marks the tile released", async () => {
    // Ticket 15 P1-2: this keepalive attaching the debugger independently of
    // BrowserDebugSession, and re-attaching it on every navigation, is what
    // let a released-but-still-open agent tile stay silently drivable. This
    // guard is what closes that specific leak.
    const {
      applyAgentBrowserBackgroundPosture,
      setAgentBrowserPostureReleased,
    } = await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();
    expect(webContents.debugger.commands).toHaveLength(2);

    setAgentBrowserPostureReleased(asWebContents(webContents), true);
    webContents.debugger.attached = false;
    webContents.emit("did-navigate", {}, "https://example.com/a");
    await flush();

    expect(webContents.debugger.commands).toHaveLength(2);
    expect(webContents.debugger.attachCalls).toBe(1);
  });

  it("resumes re-attaching on did-navigate after setAgentBrowserPostureReleased clears the released mark", async () => {
    const {
      applyAgentBrowserBackgroundPosture,
      setAgentBrowserPostureReleased,
    } = await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();
    setAgentBrowserPostureReleased(asWebContents(webContents), true);
    webContents.debugger.attached = false;
    webContents.emit("did-navigate", {}, "https://example.com/a");
    await flush();
    expect(webContents.debugger.commands).toHaveLength(2);

    setAgentBrowserPostureReleased(asWebContents(webContents), false);
    webContents.emit("did-navigate", {}, "https://example.com/b");
    await flush();

    expect(webContents.debugger.commands).toHaveLength(4);
    expect(webContents.debugger.attachCalls).toBe(2);
  });

  it("treats a webContents that never went through setAgentBrowserPostureReleased as not released", async () => {
    const { applyAgentBrowserBackgroundPosture } =
      await import("../agent-browser-posture");
    const webContents = new FakeWebContents(false);

    applyAgentBrowserBackgroundPosture(asWebContents(webContents));
    await flush();
    webContents.emit("did-navigate", {}, "https://example.com/a");
    await flush();

    expect(webContents.debugger.commands).toHaveLength(4);
  });
});
