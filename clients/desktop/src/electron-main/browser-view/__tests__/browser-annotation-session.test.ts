import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { BrowserAnnotationSessionEvent } from "../../../ipc-contracts/browser-annotation-types";
import {
  ANNOTATION_BINDING_NAME,
  ANNOTATION_CANCEL_EXPRESSION,
  ANNOTATION_HIDE_CHROME_EXPRESSION,
  ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION,
  ANNOTATION_WORLD_NAME,
  buildAnnotationOverlayBootstrap,
  buildAnnotationSetMarkCountExpression,
} from "../browser-annotation-overlay-script";
import { BrowserAnnotationSession } from "../browser-annotation-session";
import type { BrowserViewDebugger } from "../browser-view-manager";

vi.mock("../../app/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  describeLogError: (err: unknown) => String(err),
}));

interface RecordedCommand {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

class FakeDebugger implements BrowserViewDebugger {
  readonly commands: RecordedCommand[] = [];
  holdFrameTree = false;
  failEvaluate = false;
  missingFrame = false;
  missingWorld = false;
  private attached: boolean;
  private frameTreeResolve: ((value: unknown) => void) | null = null;
  private readonly events = new EventEmitter();

  constructor(attached: boolean) {
    this.attached = attached;
  }

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
    if (method === "Page.getFrameTree") {
      if (this.holdFrameTree) {
        return new Promise((resolve) => {
          this.frameTreeResolve = resolve;
        });
      }
      if (this.missingFrame) {
        return Promise.resolve({ frameTree: { frame: {} } });
      }
      return Promise.resolve({ frameTree: { frame: { id: "FRAME-1" } } });
    }
    if (method === "Page.createIsolatedWorld") {
      if (this.missingWorld) {
        return Promise.resolve({});
      }
      return Promise.resolve({ executionContextId: 77 });
    }
    if (method === "Runtime.evaluate") {
      if (this.failEvaluate) {
        return Promise.resolve({
          exceptionDetails: { text: "inject failed" },
        });
      }
      return Promise.resolve({ result: { value: true } });
    }
    return Promise.resolve({});
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.events.on(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.events.off(event, listener);
  }

  emitMessage(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): void {
    this.events.emit("message", {}, method, params, sessionId);
  }

  resolveFrameTree(): void {
    this.frameTreeResolve?.({ frameTree: { frame: { id: "FRAME-1" } } });
  }

  listenerCount(event: string): number {
    return this.events.listenerCount(event);
  }

  commandMethods(): string[] {
    return this.commands.map((command) => command.method);
  }

  find(method: string): RecordedCommand | undefined {
    return this.commands.find((command) => command.method === method);
  }

  finds(method: string): RecordedCommand[] {
    return this.commands.filter((command) => command.method === method);
  }
}

class FakeWebContents {
  readonly id = 9;
  readonly debugger: FakeDebugger;
  constructor(attached: boolean) {
    this.debugger = new FakeDebugger(attached);
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface SessionHarness {
  readonly session: BrowserAnnotationSession;
  readonly webContents: FakeWebContents;
  readonly events: BrowserAnnotationSessionEvent[];
}

function createHarness(attached: boolean): SessionHarness {
  const webContents = new FakeWebContents(attached);
  const events: BrowserAnnotationSessionEvent[] = [];
  const session = new BrowserAnnotationSession({
    webContents,
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { session, webContents, events };
}

const VALID_UNION = { x: 1, y: 2, width: 10, height: 20 };

const VALID_ATTACH_PAYLOAD = {
  marks: [
    {
      id: "m1",
      kind: "element" as const,
      bounds: VALID_UNION,
      selector: "button#go",
    },
  ],
  elements: [
    {
      selector: "button#go",
      tagName: "BUTTON",
      elementId: "go",
      classNames: ["primary"],
      outerHtml: "<button>Go</button>",
      outerHtmlTruncated: false,
      textPreview: "Go",
      ariaRole: "button",
      accessibleName: "Go",
      boundingBox: {
        x: 1,
        y: 2,
        width: 10,
        height: 20,
        top: 2,
        right: 11,
        bottom: 22,
        left: 1,
      },
    },
  ],
  comment: "look here",
  unionRect: VALID_UNION,
};

function emitBinding(
  debuggerInstance: FakeDebugger,
  payload: unknown,
  executionContextId: number | undefined,
): void {
  const params: Record<string, unknown> = {
    name: ANNOTATION_BINDING_NAME,
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
  if (executionContextId !== undefined) {
    params.executionContextId = executionContextId;
  }
  debuggerInstance.emitMessage("Runtime.bindingCalled", params, undefined);
}

describe("BrowserAnnotationSession", () => {
  it("injects the isolated world and binding once on start", async () => {
    const harness = createHarness(true);
    await expect(harness.session.start()).resolves.toEqual({ ok: true });
    expect(harness.session.isActive()).toBe(true);

    expect(harness.webContents.debugger.commandMethods()).toEqual([
      "Page.enable",
      "Runtime.enable",
      "Runtime.addBinding",
      "Page.getFrameTree",
      "Page.createIsolatedWorld",
      "Runtime.evaluate",
    ]);

    expect(harness.webContents.debugger.find("Runtime.addBinding")?.params).toEqual({
      name: ANNOTATION_BINDING_NAME,
      executionContextName: ANNOTATION_WORLD_NAME,
    });
    expect(
      harness.webContents.debugger.find("Page.createIsolatedWorld")?.params,
    ).toEqual({
      frameId: "FRAME-1",
      worldName: ANNOTATION_WORLD_NAME,
      grantUniveralAccess: false,
    });
    expect(harness.webContents.debugger.find("Runtime.evaluate")?.params).toEqual({
      expression: buildAnnotationOverlayBootstrap(),
      contextId: 77,
      awaitPromise: false,
      returnByValue: true,
      userGesture: true,
    });
  });

  it("returns debugger-not-attached without sending commands", async () => {
    const harness = createHarness(false);
    await expect(harness.session.start()).resolves.toEqual({
      ok: false,
      reason: "debugger-not-attached",
    });
    expect(harness.webContents.debugger.commands).toHaveLength(0);
    expect(harness.webContents.debugger.listenerCount("message")).toBe(0);
  });

  it("returns no-main-frame when the frame tree has no id", async () => {
    const harness = createHarness(true);
    harness.webContents.debugger.missingFrame = true;
    await expect(harness.session.start()).resolves.toEqual({
      ok: false,
      reason: "no-main-frame",
    });
    expect(harness.webContents.debugger.listenerCount("message")).toBe(0);
  });

  it("returns inject-failed and removes the listener when evaluate fails", async () => {
    const harness = createHarness(true);
    harness.webContents.debugger.failEvaluate = true;
    await expect(harness.session.start()).resolves.toEqual({
      ok: false,
      reason: "inject-failed",
    });
    expect(harness.webContents.debugger.listenerCount("message")).toBe(0);
    expect(harness.events).toEqual([]);
  });

  it("round-trips a binding stateChanged event as a sanitized onEvent", async () => {
    const harness = createHarness(true);
    await harness.session.start();

    emitBinding(
      harness.webContents.debugger,
      { type: "stateChanged", mode: "select", markCount: 0 },
      77,
    );

    expect(harness.events).toEqual([
      { type: "stateChanged", mode: "select", markCount: 0 },
    ]);
  });

  it("ignores a binding from another isolated world", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    emitBinding(
      harness.webContents.debugger,
      { type: "stateChanged", mode: "draw", markCount: 1 },
      99,
    );
    expect(harness.events).toEqual([]);
  });

  it("ignores a binding that is not __traycerAnnotation", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    harness.webContents.debugger.emitMessage(
      "Runtime.bindingCalled",
      {
        name: "__traycerOther",
        payload: JSON.stringify({
          type: "stateChanged",
          mode: "select",
          markCount: 0,
        }),
        executionContextId: 77,
      },
      undefined,
    );
    expect(harness.events).toEqual([]);
  });

  it("drops raw unknown binding types", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    emitBinding(harness.webContents.debugger, { type: "mystery" }, 77);
    emitBinding(
      harness.webContents.debugger,
      { type: "ended", reason: "navigation" },
      77,
    );
    expect(harness.events).toEqual([]);
  });

  it("accepts a valid attachRequested envelope from the binding", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    emitBinding(
      harness.webContents.debugger,
      { type: "attachRequested", payload: VALID_ATTACH_PAYLOAD },
      77,
    );
    expect(harness.events).toEqual([
      {
        type: "attachRequested",
        payload: {
          marks: [
            {
              id: "m1",
              kind: "element",
              bounds: VALID_UNION,
              selector: "button#go",
            },
          ],
          elements: [
            {
              selector: "button#go",
              tagName: "button",
              elementId: "go",
              classNames: ["primary"],
              attributes: [],
              outerHtml: "<button>Go</button>",
              outerHtmlTruncated: false,
              textPreview: "Go",
              ariaRole: "button",
              accessibleName: "Go",
              boundingBox: {
                x: 1,
                y: 2,
                width: 10,
                height: 20,
                top: 2,
                right: 11,
                bottom: 22,
                left: 1,
              },
              computedStyles: [],
            },
          ],
          comment: "look here",
          unionRect: VALID_UNION,
        },
      },
    ]);
  });

  it("rejects a guest-supplied annotationId or screenshot nested under payload", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    emitBinding(
      harness.webContents.debugger,
      {
        type: "attachRequested",
        payload: { ...VALID_ATTACH_PAYLOAD, annotationId: "guest-id" },
      },
      77,
    );
    emitBinding(
      harness.webContents.debugger,
      {
        type: "attachRequested",
        payload: {
          ...VALID_ATTACH_PAYLOAD,
          marks: [
            {
              ...VALID_ATTACH_PAYLOAD.marks[0],
              screenshot: "data:image/png;base64,abc",
            },
          ],
        },
      },
      77,
    );
    expect(harness.events).toEqual([]);
  });

  it("rejects a guest-supplied annotationId or screenshot on attachRequested", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    emitBinding(
      harness.webContents.debugger,
      {
        type: "attachRequested",
        annotationId: "guest-id",
        payload: VALID_ATTACH_PAYLOAD,
      },
      77,
    );
    emitBinding(
      harness.webContents.debugger,
      {
        type: "attachRequested",
        screenshot: "data:image/png;base64,abc",
        payload: VALID_ATTACH_PAYLOAD,
      },
      77,
    );
    expect(harness.events).toEqual([]);
  });

  it("cancel evaluates the cancel hook, removes the listener, and emits cancelled after start", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    expect(harness.webContents.debugger.listenerCount("message")).toBe(1);

    harness.session.cancel();
    await flush();

    expect(harness.session.isActive()).toBe(false);
    expect(harness.events).toEqual([{ type: "cancelled" }]);
    expect(harness.webContents.debugger.listenerCount("message")).toBe(0);
    const cancelEvaluate = harness.webContents.debugger
      .finds("Runtime.evaluate")
      .find((command) => command.params.expression === ANNOTATION_CANCEL_EXPRESSION);
    expect(cancelEvaluate?.params).toMatchObject({ contextId: 77 });
    expect(harness.webContents.debugger.find("Runtime.removeBinding")?.params).toEqual({
      name: ANNOTATION_BINDING_NAME,
    });
  });

  it("cancel after a failed start does not emit cancelled", async () => {
    const harness = createHarness(false);
    await harness.session.start();
    harness.session.cancel();
    expect(harness.events).toEqual([]);
    expect(harness.webContents.debugger.find("Runtime.removeBinding")).toBeUndefined();
  });

  it("guest cancelled binding ends the session and removes the listener", async () => {
    const harness = createHarness(true);
    await harness.session.start();
    emitBinding(harness.webContents.debugger, { type: "cancelled" }, 77);
    await flush();

    expect(harness.session.isActive()).toBe(false);
    expect(harness.events).toEqual([{ type: "cancelled" }]);
    expect(harness.webContents.debugger.listenerCount("message")).toBe(0);
    expect(harness.webContents.debugger.find("Runtime.removeBinding")?.params).toEqual({
      name: ANNOTATION_BINDING_NAME,
    });
  });

  it.each([
    "navigation",
    "crash",
    "tile-close",
    "replaced",
  ] as const)("dispose(%s) emits ended and removes the listener", async (reason) => {
    const harness = createHarness(true);
    await harness.session.start();
    harness.session.dispose(reason);
    await flush();

    expect(harness.events).toEqual([{ type: "ended", reason }]);
    expect(harness.webContents.debugger.listenerCount("message")).toBe(0);
    expect(harness.session.isActive()).toBe(false);
  });

  it("a second session on the same debugger after dispose has no leftover listeners from the first", async () => {
    const webContents = new FakeWebContents(true);
    const firstEvents: BrowserAnnotationSessionEvent[] = [];
    const first = new BrowserAnnotationSession({
      webContents,
      onEvent: (event) => {
        firstEvents.push(event);
      },
    });
    await first.start();
    expect(webContents.debugger.listenerCount("message")).toBe(1);
    first.dispose("replaced");
    expect(webContents.debugger.listenerCount("message")).toBe(0);

    const secondEvents: BrowserAnnotationSessionEvent[] = [];
    const second = new BrowserAnnotationSession({
      webContents,
      onEvent: (event) => {
        secondEvents.push(event);
      },
    });
    await second.start();
    expect(webContents.debugger.listenerCount("message")).toBe(1);

    emitBinding(
      webContents.debugger,
      { type: "stateChanged", mode: "region", markCount: 2 },
      77,
    );
    expect(firstEvents).toEqual([{ type: "ended", reason: "replaced" }]);
    expect(secondEvents).toEqual([
      { type: "stateChanged", mode: "region", markCount: 2 },
    ]);

    second.dispose("tile-close");
    expect(webContents.debugger.listenerCount("message")).toBe(0);
  });

  it("evaluates hideChromeForCapture, resetAfterAttach, and setMarkCountForTests", async () => {
    const harness = createHarness(true);
    await harness.session.start();

    await harness.session.hideChromeForCapture();
    await harness.session.resetAfterAttach();
    await harness.session.setMarkCountForTests(3);

    const expressions = harness.webContents.debugger
      .finds("Runtime.evaluate")
      .map((command) => command.params.expression);
    expect(expressions).toContain(ANNOTATION_HIDE_CHROME_EXPRESSION);
    expect(expressions).toContain(ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION);
    expect(expressions).toContain(buildAnnotationSetMarkCountExpression(3));
    expect(buildAnnotationSetMarkCountExpression(3)).toContain(
      "__traycerAnnotationSetMarkCount",
    );
  });

  it("leaves no message listener after dispose or cancel", async () => {
    const cancelled = createHarness(true);
    await cancelled.session.start();
    cancelled.session.cancel();
    expect(cancelled.webContents.debugger.listenerCount("message")).toBe(0);

    const disposed = createHarness(true);
    await disposed.session.start();
    disposed.session.dispose("navigation");
    expect(disposed.webContents.debugger.listenerCount("message")).toBe(0);
  });
});
