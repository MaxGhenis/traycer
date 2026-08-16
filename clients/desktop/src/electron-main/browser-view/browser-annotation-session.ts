import type {
  BrowserAnnotationAttachPayload,
  BrowserAnnotationAttachRequest,
  BrowserAnnotationEndReason,
  BrowserAnnotationSessionEvent,
  BrowserAnnotationStartResult,
} from "../../ipc-contracts/browser-annotation-types";
import { describeLogError, log } from "../app/logger";
import {
  buildAnnotationAttachPayload,
  cropAnnotationPng,
  mintAnnotationId,
} from "./browser-annotation-crop";
import {
  ANNOTATION_BINDING_NAME,
  ANNOTATION_CANCEL_EXPRESSION,
  ANNOTATION_CAPTURE_FAILED_EXPRESSION,
  ANNOTATION_HIDE_CHROME_EXPRESSION,
  ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION,
  ANNOTATION_VIEWPORT_SIZE_EXPRESSION,
  ANNOTATION_WAIT_FOR_PAINT_EXPRESSION,
  ANNOTATION_WORLD_NAME,
  buildAnnotationOverlayBootstrap,
  buildAnnotationSetTargetChatLabelExpression,
  sanitizeAnnotationBindingPayload,
} from "./browser-annotation-overlay-script";
import type {
  BrowserViewCapturedImage,
  BrowserViewDebugger,
} from "./browser-view-manager";

export interface BrowserAnnotationWebContents {
  readonly id: number;
  readonly debugger: BrowserViewDebugger;
  capturePage(): Promise<BrowserViewCapturedImage>;
  getURL(): string;
  getTitle(): string;
}

export interface BrowserAnnotationSessionIdentity {
  readonly tabId: string;
  readonly sessionId: string;
}

export interface BrowserAnnotationAttachedResult {
  readonly payload: BrowserAnnotationAttachPayload;
  readonly pngBytes: Uint8Array;
}

export interface BrowserAnnotationSessionOptions {
  readonly webContents: BrowserAnnotationWebContents;
  readonly identity: BrowserAnnotationSessionIdentity;
  readonly onEvent: (event: BrowserAnnotationSessionEvent) => void;
  readonly onAttached: (result: BrowserAnnotationAttachedResult) => void;
}

/**
 * Long-lived guest overlay connection. One CDP binding carries events up;
 * named evaluates carry commands down. Unlike the one-shot picker, start()
 * resolves once the overlay is injected and the session stays open until
 * cancel / navigation / crash / tile close / a replacement start.
 */
export class BrowserAnnotationSession {
  private readonly webContents: BrowserAnnotationWebContents;
  private readonly identity: BrowserAnnotationSessionIdentity;
  private readonly onEvent: (event: BrowserAnnotationSessionEvent) => void;
  private readonly onAttached: (result: BrowserAnnotationAttachedResult) => void;
  private readonly messageListener = (...args: unknown[]) => {
    this.handleDebuggerMessage(args);
  };
  private contextId: number | null = null;
  private ended = false;
  private started = false;
  private listening = false;
  private capturing = false;
  private markCount = 0;

  constructor(options: BrowserAnnotationSessionOptions) {
    this.webContents = options.webContents;
    this.identity = options.identity;
    this.onEvent = options.onEvent;
    this.onAttached = options.onAttached;
  }

  isActive(): boolean {
    return this.started && !this.ended;
  }

  scrollLockArmed(): boolean {
    return this.isActive() && this.markCount > 0;
  }

  async start(): Promise<BrowserAnnotationStartResult> {
    const browserDebugger = this.webContents.debugger;
    if (this.ended) return { ok: false, reason: "inject-failed" };
    if (!browserDebugger.isAttached()) {
      return { ok: false, reason: "debugger-not-attached" };
    }
    try {
      await browserDebugger.sendCommand("Page.enable", {}, undefined);
      if (this.ended) return this.abortStart("inject-failed");
      await browserDebugger.sendCommand("Runtime.enable", {}, undefined);
      if (this.ended) return this.abortStart("inject-failed");
      await browserDebugger.sendCommand(
        "Runtime.addBinding",
        {
          name: ANNOTATION_BINDING_NAME,
          executionContextName: ANNOTATION_WORLD_NAME,
        },
        undefined,
      );
      if (this.ended) return this.abortStart("inject-failed");
      const frameTree = await browserDebugger.sendCommand(
        "Page.getFrameTree",
        {},
        undefined,
      );
      if (this.ended) return this.abortStart("inject-failed");
      const frameId = readMainFrameId(frameTree);
      if (frameId === null) {
        return this.abortStart("no-main-frame");
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
        return this.abortStart("no-isolated-world");
      }
      this.contextId = contextId;
      if (this.ended) return this.abortStart("inject-failed");
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
      if (this.ended) return this.abortStart("inject-failed");
      if (evaluateFailed(evaluation)) {
        return this.abortStart("inject-failed");
      }
      this.started = true;
      return { ok: true };
    } catch (err) {
      if (!this.ended) {
        log.warn("[browser-view] annotation overlay inject failed", {
          error: describeLogError(err),
          webContentsId: this.webContents.id,
        });
      }
      return this.abortStart("inject-failed");
    }
  }

  cancel(): void {
    this.end("cancelled");
  }

  dispose(reason: BrowserAnnotationEndReason): void {
    this.end(reason);
  }

  hideChromeForCapture(): Promise<void> {
    return this.evaluateCommand(ANNOTATION_HIDE_CHROME_EXPRESSION, false, true);
  }

  resetAfterAttach(): Promise<void> {
    return this.evaluateCommand(
      ANNOTATION_RESET_AFTER_ATTACH_EXPRESSION,
      false,
      true,
    ).then(() => {
      this.markCount = 0;
    });
  }

  captureFailed(): Promise<void> {
    return this.evaluateCommand(
      ANNOTATION_CAPTURE_FAILED_EXPRESSION,
      false,
      false,
    );
  }

  setTargetChatLabel(label: string): Promise<void> {
    return this.evaluateCommand(
      buildAnnotationSetTargetChatLabelExpression(label),
      false,
      false,
    );
  }

  private abortStart(
    reason: "inject-failed" | "no-main-frame" | "no-isolated-world",
  ): BrowserAnnotationStartResult {
    this.teardownListeners();
    this.removeBinding();
    this.contextId = null;
    return { ok: false, reason };
  }

  private end(reason: BrowserAnnotationEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.markCount = 0;
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
    if (sanitized.type === "attachRequested") {
      void this.captureAttach(sanitized.payload);
      return;
    }
    if (sanitized.type === "stateChanged") {
      this.markCount = sanitized.markCount;
    }
    this.onEvent(sanitized);
  }

  private sendCancel(): void {
    void this.evaluateCommand(ANNOTATION_CANCEL_EXPRESSION, false, false);
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

  private async captureAttach(
    request: BrowserAnnotationAttachRequest,
  ): Promise<void> {
    if (!this.isActive() || this.capturing) return;
    this.capturing = true;
    try {
      await this.hideChromeForCapture();
      await this.evaluateCommand(
        ANNOTATION_WAIT_FOR_PAINT_EXPRESSION,
        true,
        true,
      );
      const viewport = await this.readViewportCssSize();
      const image = await this.webContents.capturePage();
      if (!this.isActive()) return;
      const pngBytes =
        viewport === null
          ? null
          : cropAnnotationPng(image, request.unionRect, viewport);
      if (pngBytes === null) {
        if (this.isActive()) await this.captureFailed();
        return;
      }
      const payload = buildAnnotationAttachPayload({
        annotationId: mintAnnotationId(),
        tabId: this.identity.tabId,
        sessionId: this.identity.sessionId,
        pageUrl: this.webContents.getURL(),
        pageTitle: this.webContents.getTitle(),
        capturedAt: Date.now(),
        comment: request.comment,
        marks: request.marks,
        elements: request.elements,
      });
      await this.resetAfterAttach();
      if (!this.isActive()) return;
      this.onAttached({ payload, pngBytes });
    } catch (err) {
      log.warn("[browser-view] annotation capture failed", {
        error: describeLogError(err),
        webContentsId: this.webContents.id,
      });
      if (this.isActive()) {
        await this.captureFailed();
      }
    } finally {
      this.capturing = false;
    }
  }

  private async readViewportCssSize(): Promise<{
    readonly width: number;
    readonly height: number;
  } | null> {
    const evaluation = await this.evaluateRaw(
      ANNOTATION_VIEWPORT_SIZE_EXPRESSION,
      false,
    );
    const value = readEvaluateValue(evaluation);
    if (!isRecord(value)) return null;
    const width = value.width;
    const height = value.height;
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
      return null;
    }
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
      return null;
    }
    return { width, height };
  }

  private async evaluateCommand(
    expression: string,
    awaitPromise: boolean,
    required: boolean,
  ): Promise<void> {
    if (!required) {
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
            awaitPromise,
          },
          undefined,
        );
      } catch {
        return;
      }
      return;
    }
    const evaluation = await this.evaluateRaw(expression, awaitPromise);
    if (evaluateFailed(evaluation)) {
      throw new Error("annotation overlay command did not confirm");
    }
  }

  private async evaluateRaw(
    expression: string,
    awaitPromise: boolean,
  ): Promise<unknown> {
    if (this.contextId === null) {
      throw new Error("annotation isolated world is gone");
    }
    const browserDebugger = this.webContents.debugger;
    if (!browserDebugger.isAttached()) {
      throw new Error("annotation debugger is not attached");
    }
    return browserDebugger.sendCommand(
      "Runtime.evaluate",
      {
        expression,
        contextId: this.contextId,
        returnByValue: true,
        awaitPromise,
      },
      undefined,
    );
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

function readEvaluateValue(value: unknown): unknown {
  if (!isRecord(value)) return null;
  if (isRecord(value.exceptionDetails)) return null;
  const result = value.result;
  if (!isRecord(result)) return null;
  return result.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
