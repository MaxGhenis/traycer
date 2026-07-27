import type { BrowserViewElementPickResult } from "../../ipc-contracts/browser-view-types";
import { describeLogError, log } from "../app/logger";
import {
  ELEMENT_PICKER_CANCEL_EXPRESSION,
  ELEMENT_PICKER_WORLD_NAME,
  buildElementPickerBootstrap,
  sanitizeElementPickPayload,
} from "./browser-element-picker-script";
import type { BrowserViewDebugger } from "./browser-view-manager";

/**
 * The narrow slice of a browser-view webContents the picker needs: an id for
 * logging and the in-process CDP debugger. `BrowserViewWebContents` satisfies
 * this structurally, so the manager passes `entry.view.webContents` directly.
 */
export interface BrowserElementPickerWebContents {
  readonly id: number;
  readonly debugger: BrowserViewDebugger;
}

/**
 * Drives one top-frame element pick over the already-attached in-process CDP
 * connection (decision #13 - no remote debugging port). The picker logic runs
 * in a dedicated isolated world so page JS cannot tamper with the result; the
 * bootstrap resolves once the user clicks, presses Escape, or the pick is
 * cancelled. The awaited `Runtime.evaluate` blocks on that in-page promise, so
 * a single command spans the whole interaction with no per-hover IPC.
 */
export class BrowserElementPickerSession {
  private readonly webContents: BrowserElementPickerWebContents;
  private readonly pageUrl: string;
  private contextId: number | null = null;
  private settled = false;
  private ended = false;
  private resolveResult:
    ((result: BrowserViewElementPickResult) => void) | null = null;

  constructor(webContents: BrowserElementPickerWebContents, pageUrl: string) {
    this.webContents = webContents;
    this.pageUrl = pageUrl;
  }

  run(): Promise<BrowserViewElementPickResult> {
    const promise = new Promise<BrowserViewElementPickResult>((resolve) => {
      this.resolveResult = resolve;
    });
    void this.start();
    return promise;
  }

  /**
   * User toggle-off / renderer cancel. Terminal and deterministic: settles the
   * pending run as `cancelled` immediately, independent of whether the in-page
   * cancel evaluate lands. `ended` is re-checked at every phase boundary in
   * `start()`, so a cancel that arrives before the isolated world exists
   * guarantees the interaction-blocking shield is never injected.
   */
  cancel(): void {
    this.end();
  }

  /** Force-ends the pick (navigation / renderer gone / tile close). */
  dispose(): void {
    this.end();
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    // Best-effort in-page teardown of the shield if it was already installed;
    // settlement below never depends on this landing.
    this.sendCancel();
    this.settle({ outcome: "cancelled" });
  }

  private async start(): Promise<void> {
    const browserDebugger = this.webContents.debugger;
    // `end()` always settles before setting `ended`, so any `ended` check that
    // returns here relies on the run already being resolved as cancelled.
    if (this.ended) return;
    if (!browserDebugger.isAttached()) {
      this.settle({ outcome: "unavailable", reason: "debugger-not-attached" });
      return;
    }
    try {
      // Idempotent post-commit; the debug session already enabled Page. The
      // OOPIF spike's "Page.enable hangs on an uncommitted document" gotcha
      // does not apply here - a pick only starts once the page is ready.
      await browserDebugger.sendCommand("Page.enable", {}, undefined);
      if (this.ended) return;
      const frameTree = await browserDebugger.sendCommand(
        "Page.getFrameTree",
        {},
        undefined,
      );
      if (this.ended) return;
      const frameId = readMainFrameId(frameTree);
      if (frameId === null) {
        this.settle({ outcome: "unavailable", reason: "no-main-frame" });
        return;
      }
      const world = await browserDebugger.sendCommand(
        "Page.createIsolatedWorld",
        {
          frameId,
          worldName: ELEMENT_PICKER_WORLD_NAME,
          grantUniveralAccess: false,
        },
        undefined,
      );
      const contextId = readExecutionContextId(world);
      if (contextId === null) {
        this.settle({ outcome: "unavailable", reason: "no-isolated-world" });
        return;
      }
      this.contextId = contextId;
      // Final gate before injection: a cancel that raced in at any point above
      // means the bootstrap - and therefore the page-blocking shield - is never
      // evaluated.
      if (this.ended) return;
      const evaluation = await browserDebugger.sendCommand(
        "Runtime.evaluate",
        {
          expression: buildElementPickerBootstrap(),
          contextId,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        undefined,
      );
      this.settle(
        sanitizeElementPickPayload(readEvaluateValue(evaluation), this.pageUrl),
      );
    } catch (err) {
      if (this.ended) return;
      log.warn("[browser-view] element picker evaluate failed", {
        error: describeLogError(err),
        webContentsId: this.webContents.id,
      });
      this.settle({ outcome: "unavailable", reason: "evaluate-failed" });
    }
  }

  private sendCancel(): void {
    if (this.contextId === null) return;
    const browserDebugger = this.webContents.debugger;
    if (!browserDebugger.isAttached()) return;
    browserDebugger
      .sendCommand(
        "Runtime.evaluate",
        {
          expression: ELEMENT_PICKER_CANCEL_EXPRESSION,
          contextId: this.contextId,
          returnByValue: true,
        },
        undefined,
      )
      .catch(() => undefined);
  }

  private settle(result: BrowserViewElementPickResult): void {
    if (this.settled) return;
    this.settled = true;
    const resolve = this.resolveResult;
    this.resolveResult = null;
    if (resolve !== null) resolve(result);
  }
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
