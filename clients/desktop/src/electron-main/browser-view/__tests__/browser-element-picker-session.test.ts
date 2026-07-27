import { describe, expect, it } from "vitest";
import { BrowserElementPickerSession } from "../browser-element-picker-session";
import { ELEMENT_PICKER_WORLD_NAME } from "../browser-element-picker-script";
import type { BrowserViewDebugger } from "../browser-view-manager";

const PAGE_URL = "http://localhost:5173/";

interface RecordedCommand {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

class FakeDebugger implements BrowserViewDebugger {
  readonly commands: RecordedCommand[] = [];
  holdFrameTree = false;
  failCancelEvaluate = false;
  private attached: boolean;
  private evaluateResolve: ((value: unknown) => void) | null = null;
  private frameTreeResolve: ((value: unknown) => void) | null = null;
  private readonly responses = new Map<string, unknown>([
    ["Page.enable", {}],
    ["Page.getFrameTree", { frameTree: { frame: { id: "FRAME-1" } } }],
    ["Page.createIsolatedWorld", { executionContextId: 77 }],
  ]);

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
    if (method === "Runtime.evaluate") {
      if (commandParams.awaitPromise === true) {
        return new Promise((resolve) => {
          this.evaluateResolve = resolve;
        });
      }
      // In-page cleanup (cancel) evaluate.
      return this.failCancelEvaluate
        ? Promise.reject(new Error("cancel evaluate failed"))
        : Promise.resolve({});
    }
    if (method === "Page.getFrameTree" && this.holdFrameTree) {
      return new Promise((resolve) => {
        this.frameTreeResolve = resolve;
      });
    }
    return Promise.resolve(this.responses.get(method) ?? {});
  }

  on(_event: string, _listener: (...args: unknown[]) => void): void {}
  off(_event: string, _listener: (...args: unknown[]) => void): void {}

  resolveEvaluate(value: unknown): void {
    this.evaluateResolve?.({ result: { value } });
  }

  resolveFrameTree(): void {
    this.frameTreeResolve?.({ frameTree: { frame: { id: "FRAME-1" } } });
  }

  commandMethods(): string[] {
    return this.commands.map((command) => command.method);
  }

  find(method: string): RecordedCommand | undefined {
    return this.commands.find((command) => command.method === method);
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

describe("BrowserElementPickerSession", () => {
  it("creates an isolated world and resolves a picked element", async () => {
    const webContents = new FakeWebContents(true);
    const session = new BrowserElementPickerSession(webContents, PAGE_URL);
    const runPromise = session.run();
    await flush();

    expect(webContents.debugger.commandMethods()).toEqual([
      "Page.enable",
      "Page.getFrameTree",
      "Page.createIsolatedWorld",
      "Runtime.evaluate",
    ]);
    const world = webContents.debugger.find("Page.createIsolatedWorld");
    expect(world?.params).toEqual({
      frameId: "FRAME-1",
      worldName: ELEMENT_PICKER_WORLD_NAME,
      grantUniveralAccess: false,
    });
    const evaluate = webContents.debugger.find("Runtime.evaluate");
    expect(evaluate?.params).toMatchObject({
      contextId: 77,
      awaitPromise: true,
      returnByValue: true,
    });

    webContents.debugger.resolveEvaluate({
      kind: "picked",
      element: {
        selector: "button#go",
        tagName: "button",
        elementId: "go",
        classNames: ["primary"],
        attributes: [{ name: "id", value: "go" }],
        outerHtml: '<button id="go">Go</button>',
        outerHtmlTruncated: false,
        textPreview: "Go",
        ariaRole: "button",
        accessibleName: "Go",
        boundingBox: {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          top: 0,
          right: 10,
          bottom: 10,
          left: 0,
        },
        computedStyles: [{ property: "display", value: "flex" }],
      },
    });

    const result = await runPromise;
    expect(result).toMatchObject({
      outcome: "picked",
      pageUrl: PAGE_URL,
      element: { selector: "button#go", tagName: "button" },
    });
  });

  it("returns unavailable when the debugger is not attached", async () => {
    const webContents = new FakeWebContents(false);
    const session = new BrowserElementPickerSession(webContents, PAGE_URL);
    const result = await session.run();
    expect(result).toEqual({
      outcome: "unavailable",
      reason: "debugger-not-attached",
    });
    expect(webContents.debugger.commands).toHaveLength(0);
  });

  it("cancel settles the run immediately without waiting for the in-page evaluate", async () => {
    const webContents = new FakeWebContents(true);
    const session = new BrowserElementPickerSession(webContents, PAGE_URL);
    const runPromise = session.run();
    await flush();

    // The awaited bootstrap evaluate is still pending; cancel must settle anyway.
    session.cancel();
    await expect(runPromise).resolves.toEqual({ outcome: "cancelled" });

    const cancelCommand = webContents.debugger.commands.find(
      (command) =>
        command.method === "Runtime.evaluate" &&
        command.params.awaitPromise !== true,
    );
    expect(cancelCommand?.params).toMatchObject({ contextId: 77 });
  });

  it("never injects the shield when cancel arrives before the isolated world exists", async () => {
    const webContents = new FakeWebContents(true);
    webContents.debugger.holdFrameTree = true;
    const session = new BrowserElementPickerSession(webContents, PAGE_URL);
    const runPromise = session.run();
    await flush();

    // Paused at Page.getFrameTree, before any contextId exists.
    expect(webContents.debugger.commandMethods()).toEqual([
      "Page.enable",
      "Page.getFrameTree",
    ]);

    session.cancel();
    await expect(runPromise).resolves.toEqual({ outcome: "cancelled" });

    webContents.debugger.resolveFrameTree();
    await flush();

    // The cancelled session bailed before creating the world / evaluating the
    // bootstrap, so the page-blocking shield is never installed.
    expect(webContents.debugger.commandMethods()).toEqual([
      "Page.enable",
      "Page.getFrameTree",
    ]);
  });

  it("settles as cancelled even when the in-page cleanup evaluate rejects", async () => {
    const webContents = new FakeWebContents(true);
    webContents.debugger.failCancelEvaluate = true;
    const session = new BrowserElementPickerSession(webContents, PAGE_URL);
    const runPromise = session.run();
    await flush();

    session.cancel();
    await expect(runPromise).resolves.toEqual({ outcome: "cancelled" });
    // A cleanup evaluate was still attempted despite settlement not depending on it.
    expect(
      webContents.debugger.commands.some(
        (command) =>
          command.method === "Runtime.evaluate" &&
          command.params.awaitPromise !== true,
      ),
    ).toBe(true);
  });

  it("dispose settles an in-flight pick as cancelled", async () => {
    const webContents = new FakeWebContents(true);
    const session = new BrowserElementPickerSession(webContents, PAGE_URL);
    const runPromise = session.run();
    await flush();

    session.dispose();
    await expect(runPromise).resolves.toEqual({ outcome: "cancelled" });
  });
});
