import type {
  BrowserAnnotationEndReason,
  BrowserAnnotationSessionEvent,
  BrowserAnnotationStartResult,
} from "../../ipc-contracts/browser-annotation-types";
import { describeLogError, log } from "../app/logger";
import {
  ANNOTATION_BINDING_NAME,
  ANNOTATION_CANCEL_EXPRESSION,
  ANNOTATION_HIDE_CHROME_EXPRESSION,
  ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION,
  ANNOTATION_WORLD_NAME,
  buildAnnotationOverlayBootstrap,
  buildAnnotationSetMarkCountExpression,
  sanitizeAnnotationBindingPayload,
} from "./browser-annotation-overlay-script";
import type { BrowserViewDebugger } from "./browser-view-manager";

export interface BrowserAnnotationWebContents {
  readonly id: number;
  readonly debugger: BrowserViewDebugger;
}

export interface BrowserAnnotationSessionOptions {
  readonly webContents: BrowserAnnotationWebContents;
  readonly onEvent: (event: BrowserAnnotationSessionEvent) => void;
}

/**
 * Long-lived guest overlay connection. One CDP binding carries events up;
 * named evaluates carry commands down. Unlike the one-shot picker, start()
 * resolves once the overlay is injected and the session stays open until
 * cancel / navigation / crash / tile close / a replacement start.
 */
export class BrowserAnnotationSession {
  private readonly webContents: BrowserAnnotationWebContents;
  private readonly onEvent: (event: BrowserAnnotationSessionEvent) => void;
  private readonly messageListener = (...args: unknown[]) => {
    this.handleDebuggerMessage(args);
  };
  private contextId: number | null = null;
  private ended = false;
  private started = false;
  private listening = false;

  constructor(options: BrowserAnnotationSessionOptions) {
    this.webContents = options.webContents;
    this.onEvent = options.onEvent;
  }

  isActive(): boolean {
    return this.started && !this.ended;
  }

  async start(): Promise<BrowserAnnotationStartResult> {
    const browserDebugger = this.webContents.debugger;
    if (this.ended) return { ok: false, reason: "inject-failed" };
    if (!browserDebugger.isAttached()) {
      return { ok: false, reason: "debugger-not-attached" };
    }
    try {
      await browserDebugger.sendCommand("Page.enable", {}, undefined);
      if (this.ended) return { ok: false, reason: "inject-failed" };
      await browserDebugger.sendCommand("Runtime.enable", {}, undefined);
      if (this.ended) return { ok: false, reason: "inject-failed" };
      await browserDebugger.sendCommand(
        "Runtime.addBinding",
        {
          name: ANNOTATION_BINDING_NAME,
          executionContextName: ANNOTATION_WORLD_NAME,
        },
        undefined,
      );
      if (this.ended) return { ok: false, reason: "inject-failed" };
      const frameTree = await browserDebugger.sendCommand(
        "Page.getFrameTree",
        {},
        undefined,
      );
      if (this.ended) return { ok: false, reason: "inject-failed" };
      const frameId = readMainFrameId(frameTree);
      if (frameId === null) {
        return { ok: false, reason: "no-main-frame" };
      }
      const world = await browserDebugger.sendCommand(
        "Page.createIsolatedWorld",
        {
          frameId,
          worldName: ANNOTATION_WORLD_NAME,
          grantUniveralAccess: false,
        },
        undefined,
      );
      const contextId = readExecutionContextId(world);
      if (contextId === null) {
        return { ok: false, reason: "no-isolated-world" };
      }
      this.contextId = contextId;
      if (this.ended) return { ok: false, reason: "inject-failed" };
      this.attachMessageListener();
      const evaluation = await browserDebugger.sendCommand(
        "Runtime.evaluate",
        {
          expression: buildAnnotationOverlayBootstrap(),
          contextId,
          awaitPromise: false,
          returnByValue: true,
          userGesture: true,
        },
        undefined,
      );
      if (this.ended) return { ok: false, reason: "inject-failed" };
      if (evaluateFailed(evaluation)) {
        this.teardownListeners();
        return { ok: false, reason: "inject-failed" };
      }
      this.started = true;
      return { ok: true };
    } catch (err) {
      if (this.ended) return { ok: false, reason: "inject-failed" };
      log.warn("[browser-view] annotation overlay inject failed", {
        error: describeLogError(err),
        webContentsId: this.webContents.id,
      });
      this.teardownListeners();
      return { ok: false, reason: "inject-failed" };
    }
  }

  cancel(): void {
    this.end("cancelled");
  }

  dispose(reason: BrowserAnnotationEndReason): void {
    this.end(reason);
  }

  hideChromeForCapture(): Promise<void> {
    return this.evaluateNamed(ANNOTATION_HIDE_CHROME_EXPRESSION);
  }

  resetAfterAttach(): Promise<void> {
    return this.evaluateNamed(ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION);
  }

  setMarkCountForTests(count: number): Promise<void> {
    return this.evaluateNamed(buildAnnotationSetMarkCountExpression(count));
  }

  private end(reason: BrowserAnnotationEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.sendCancel();
    this.teardownListeners();
    this.removeBinding();
    if (!this.started) return;
    if (reason === "cancelled") {
      this.onEvent({ type: "cancelled" });
      return;
    }
    this.onEvent({ type: "ended", reason });
  }

  private attachMessageListener(): void {
    if (this.listening) return;
    this.webContents.debugger.on("message", this.messageListener);
    this.listening = true;
  }

  private teardownListeners(): void {
    if (!this.listening) return;
    this.webContents.debugger.off("message", this.messageListener);
    this.listening = false;
  }

  private handleDebuggerMessage(args: readonly unknown[]): void {
    if (this.ended) return;
    const event = readCdpEvent(args);
    if (event === null) return;
    if (event.method !== "Runtime.bindingCalled") return;
    if (event.params.name !== ANNOTATION_BINDING_NAME) return;
    if (
      this.contextId !== null &&
      typeof event.params.executionContextId === "number" &&
      event.params.executionContextId !== this.contextId
    ) {
      return;
    }
    const sanitized = sanitizeAnnotationBindingPayload(event.params.payload);
    if (sanitized === null) return;
    if (sanitized.type === "cancelled") {
      this.end("cancelled");
      return;
    }
    this.onEvent(sanitized);
  }

  private sendCancel(): void {
    void this.evaluateNamed(ANNOTATION_CANCEL_EXPRESSION);
  }

  private removeBinding(): void {
    const browserDebugger = this.webContents.debugger;
    if (!browserDebugger.isAttached()) return;
    browserDebugger
      .sendCommand(
        "Runtime.removeBinding",
        { name: ANNOTATION_BINDING_NAME },
        undefined,
      )
      .catch(() => undefined);
  }

  private async evaluateNamed(expression: string): Promise<void> {
    if (this.contextId === null) return;
    const browserDebugger = this.webContents.debugger;
    if (!browserDebugger.isAttached()) return;
    try {
      await browserDebugger.sendCommand(
        "Runtime.evaluate",
        {
          expression,
          contextId: this.contextId,
          returnByValue: true,
        },
        undefined,
      );
    } catch {
      return;
    }
  }
}

interface CdpEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function readCdpEvent(args: readonly unknown[]): CdpEvent | null {
  const method = args[1];
  if (typeof method !== "string") return null;
  const params = isRecord(args[2]) ? args[2] : {};
  return { method, params };
}

function readMainFrameId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const frameTree = value.frameTree;
  if (!isRecord(frameTree)) return null;
  const frame = frameTree.frame;
  if (!isRecord(frame)) return null;
  return typeof frame.id === "string" ? frame.id : null;
}

function readExecutionContextId(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const id = value.executionContextId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

function evaluateFailed(value: unknown): boolean {
  if (!isRecord(value)) return true;
  if (isRecord(value.exceptionDetails)) return true;
  const result = value.result;
  if (!isRecord(result)) return true;
  return result.value !== true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
