import type { BrowserSessionsClientFrame } from "@traycer/protocol/host/browser/contracts";
import type {
  AgentBrowserViewCdpCommand,
  AgentBrowserViewCdpErrorInfo,
  AgentBrowserViewCdpResult,
} from "./desktop-agent-browser-view";

/**
 * `AgentBrowserViewCdpResult.resultJson` is `unknown` (it crosses the
 * unversioned IPC boundary, see `browser-view-types.ts` on the desktop side),
 * but the wire frame going out to host needs the same `z.json()`-compatible
 * type `promoteState.storageState` uses elsewhere in this contract - the
 * protocol intentionally does not structurally type this payload further.
 */
type BrowserCdpResultJsonValue = Extract<
  BrowserSessionsClientFrame,
  { readonly kind: "cdpEvaluateResult" }
>["resultJson"];

/**
 * Ticket 03's transport plumbing between the `browser.sessions` stream
 * subscription (`browser-session-dock.tsx`) and whichever `AgentBrowserTile`
 * instance owns the target `tileInstanceId` - the same per-tile registration
 * idiom as `browser-tile-control-store.ts`'s T18 control actions. This is the
 * bridge's mechanics only: it does not decide what to send or why, that is
 * ticket 04+'s runtime adapter.
 */
export type AgentBrowserCdpRequest = {
  readonly requestId: string;
  readonly tileInstanceId: string;
  readonly sessionId: string | null;
  readonly command: AgentBrowserViewCdpCommand;
  readonly sendFrame: (frame: BrowserSessionsClientFrame) => void;
};

const handlerByTileInstanceId = new Map<
  string,
  (request: AgentBrowserCdpRequest) => void
>();
const sendFrameByTileInstanceId = new Map<
  string,
  (frame: BrowserSessionsClientFrame) => void
>();

export function registerAgentBrowserCdpHandler(
  tileInstanceId: string,
  handler: (request: AgentBrowserCdpRequest) => void,
): () => void {
  handlerByTileInstanceId.set(tileInstanceId, handler);
  return () => {
    if (handlerByTileInstanceId.get(tileInstanceId) === handler) {
      handlerByTileInstanceId.delete(tileInstanceId);
    }
    if (sendFrameByTileInstanceId.has(tileInstanceId)) {
      sendFrameByTileInstanceId.delete(tileInstanceId);
    }
  };
}

export function publishAgentBrowserCdpRequest(
  request: AgentBrowserCdpRequest,
): void {
  sendFrameByTileInstanceId.set(request.tileInstanceId, request.sendFrame);
  const handler = handlerByTileInstanceId.get(request.tileInstanceId);
  if (handler !== undefined) {
    handler(request);
    return;
  }
  request.sendFrame(
    buildCdpResultFrame(request.requestId, request.tileInstanceId, {
      kind: request.command.kind,
      ok: false,
      error: {
        kind: "tile_not_found",
        message: "Agent browser tile is not mounted.",
        code: null,
      },
    }),
  );
}

/**
 * Best-effort, and deliberately not more than that: a detach that fires
 * before this tile has ever registered a `sendFrame` (i.e. before any
 * dispatch reached it) has nothing to notify through. This is NOT a
 * correctness hole - the guarantee that detach ends agent access is carried
 * by `BrowserViewManager.dispatchCdp`'s synchronous `isAttached()` check on
 * the electron-main side, not by this notification. Every dispatch attempt,
 * proactively notified or not, fails fast with `not_attached` once detached.
 * The only thing a missed notification costs is discovery latency in the
 * rare case nothing was ever dispatched before the detach - never a stale
 * agent access window.
 */
export function notifyAgentBrowserCdpSessionEnded(
  tileInstanceId: string,
  reason: string,
): void {
  const sendFrame = sendFrameByTileInstanceId.get(tileInstanceId);
  if (sendFrame === undefined) return;
  sendFrame({
    kind: "cdpSessionEnded",
    hasBinaryPayload: false,
    requestId: crypto.randomUUID(),
    tileInstanceId,
    reason,
  });
}

/**
 * Same best-effort caveat as `notifyAgentBrowserCdpSessionEnded`: a tile
 * that has never had a request published has no captured `sendFrame` to
 * push through. Unlike detach, there is no synchronous fallback here (this
 * is pure discovery, not a failure mode) - a genuinely missed attach means
 * that child session simply cannot be dispatched to until rediscovered.
 *
 * Ticket 29 (review round 1, P1) - named deferral, not silently accepted:
 * the host side now retains and replays attachments across
 * `ElectronTileRuntimeAdapter` re-creation (`browser-session-manager.ts`),
 * and the borrowed tile now forwards this event at all (`browser-tile.tsx`,
 * previously missing entirely). What remains open is the narrowest case -
 * an OOPIF attaching before EITHER of those has ever run for this tile once
 * (e.g. a genuinely fresh Electron-main subscription with no prior
 * dispatch anywhere in this renderer's lifetime) - since `Target.
 * attachedToTarget` fires exactly once and this store has no pull-based
 * "what is currently attached" query to fall back on, only the push event.
 * Closing that fully needs a new query IPC method on the electron-main
 * bridge, which is real protocol/manager surgery outside this ticket's
 * scope. It fails safe, not silently wrong: `composeFrame`'s best-effort
 * child handling degrades to the bare iframe ref line, never a crash.
 */
export function notifyAgentBrowserCdpTargetAttached(
  tileInstanceId: string,
  event: {
    readonly sessionId: string;
    readonly targetId: string;
    readonly targetType: string;
    readonly url: string;
    readonly waitingForDebugger: boolean;
  },
): void {
  const sendFrame = sendFrameByTileInstanceId.get(tileInstanceId);
  if (sendFrame === undefined) return;
  sendFrame({
    kind: "cdpTargetAttached",
    hasBinaryPayload: false,
    requestId: crypto.randomUUID(),
    tileInstanceId,
    sessionId: event.sessionId,
    targetId: event.targetId,
    targetType: event.targetType,
    url: event.url,
    waitingForDebugger: event.waitingForDebugger,
  });
}

export function resetAgentBrowserCdpStoreForTests(): void {
  handlerByTileInstanceId.clear();
  sendFrameByTileInstanceId.clear();
}

type CdpResultFrameEnvelope = {
  readonly hasBinaryPayload: false;
  readonly requestId: string;
  readonly tileInstanceId: string;
  readonly ok: boolean;
  readonly error: AgentBrowserViewCdpErrorInfo | null;
};

export function buildCdpResultFrame(
  requestId: string,
  tileInstanceId: string,
  result: AgentBrowserViewCdpResult,
): BrowserSessionsClientFrame {
  const envelope: CdpResultFrameEnvelope = {
    hasBinaryPayload: false,
    requestId,
    tileInstanceId,
    ok: result.ok,
    error: result.ok ? null : result.error,
  };
  if (!result.ok) {
    return buildCdpFailureResultFrame(envelope, result.kind);
  }
  return buildCdpSuccessResultFrame(envelope, result);
}

function buildCdpFailureResultFrame(
  envelope: CdpResultFrameEnvelope,
  // Named separately from `AgentBrowserViewCdpResult`'s own `kind` field:
  // switching on `result.kind` directly (post `!result.ok` narrow) resolves
  // the default branch to `any` rather than `never`, a TS narrowing quirk
  // that shows up when a union member's discriminant literal values overlap
  // with other members' (all ten `ok: true` kinds appear again here).
  commandKind: AgentBrowserViewCdpCommand["kind"],
): BrowserSessionsClientFrame {
  switch (commandKind) {
    case "cdpNavigate":
      return {
        kind: "cdpNavigateResult",
        ...envelope,
        frameId: null,
        loaderId: null,
        errorText: null,
      };
    case "cdpCaptureScreenshot":
      return {
        kind: "cdpCaptureScreenshotResult",
        ...envelope,
        dataBase64: null,
      };
    case "cdpGetFrameTree":
      return { kind: "cdpGetFrameTreeResult", ...envelope, frames: null };
    case "cdpCreateIsolatedWorld":
      return {
        kind: "cdpCreateIsolatedWorldResult",
        ...envelope,
        executionContextId: null,
      };
    case "cdpEvaluate":
      return {
        kind: "cdpEvaluateResult",
        ...envelope,
        resultJson: null,
        objectId: null,
        exceptionDescription: null,
      };
    case "cdpCallFunctionOn":
      return {
        kind: "cdpCallFunctionOnResult",
        ...envelope,
        resultJson: null,
        objectId: null,
        exceptionDescription: null,
      };
    case "cdpReleaseObject":
      return { kind: "cdpReleaseObjectResult", ...envelope };
    case "cdpDispatchMouseEvent":
      return { kind: "cdpDispatchMouseEventResult", ...envelope };
    case "cdpInsertText":
      return { kind: "cdpInsertTextResult", ...envelope };
    case "cdpDispatchKeyEvent":
      return { kind: "cdpDispatchKeyEventResult", ...envelope };
    case "cdpSetDeviceMetricsOverride":
      return { kind: "cdpSetDeviceMetricsOverrideResult", ...envelope };
    case "cdpSetAutoAttach":
      return { kind: "cdpSetAutoAttachResult", ...envelope };
    case "cdpDescribeNode":
      return {
        kind: "cdpDescribeNodeResult",
        ...envelope,
        nodeId: null,
        backendNodeId: null,
        nodeName: null,
        frameId: null,
      };
    case "cdpGetFullAXTree":
      return { kind: "cdpGetFullAXTreeResult", ...envelope, nodesJson: null };
    default: {
      const exhaustive: never = commandKind;
      throw new Error(
        `Unhandled CDP command kind: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

function buildCdpSuccessResultFrame(
  envelope: CdpResultFrameEnvelope,
  result: Extract<AgentBrowserViewCdpResult, { readonly ok: true }>,
): BrowserSessionsClientFrame {
  switch (result.kind) {
    case "cdpNavigate":
      return {
        kind: "cdpNavigateResult",
        ...envelope,
        frameId: result.frameId,
        loaderId: result.loaderId,
        errorText: result.errorText,
      };
    case "cdpCaptureScreenshot":
      return {
        kind: "cdpCaptureScreenshotResult",
        ...envelope,
        dataBase64: result.dataBase64,
      };
    case "cdpGetFrameTree":
      return {
        kind: "cdpGetFrameTreeResult",
        ...envelope,
        frames: [...result.frames],
      };
    case "cdpCreateIsolatedWorld":
      return {
        kind: "cdpCreateIsolatedWorldResult",
        ...envelope,
        executionContextId: result.executionContextId,
      };
    case "cdpEvaluate":
      return {
        kind: "cdpEvaluateResult",
        ...envelope,
        resultJson: result.resultJson as BrowserCdpResultJsonValue,
        objectId: result.objectId,
        exceptionDescription: result.exceptionDescription,
      };
    case "cdpCallFunctionOn":
      return {
        kind: "cdpCallFunctionOnResult",
        ...envelope,
        resultJson: result.resultJson as BrowserCdpResultJsonValue,
        objectId: result.objectId,
        exceptionDescription: result.exceptionDescription,
      };
    case "cdpReleaseObject":
      return { kind: "cdpReleaseObjectResult", ...envelope };
    case "cdpDispatchMouseEvent":
      return { kind: "cdpDispatchMouseEventResult", ...envelope };
    case "cdpInsertText":
      return { kind: "cdpInsertTextResult", ...envelope };
    case "cdpDispatchKeyEvent":
      return { kind: "cdpDispatchKeyEventResult", ...envelope };
    case "cdpSetDeviceMetricsOverride":
      return { kind: "cdpSetDeviceMetricsOverrideResult", ...envelope };
    case "cdpSetAutoAttach":
      return { kind: "cdpSetAutoAttachResult", ...envelope };
    case "cdpDescribeNode":
      return {
        kind: "cdpDescribeNodeResult",
        ...envelope,
        nodeId: result.nodeId,
        backendNodeId: result.backendNodeId,
        nodeName: result.nodeName,
        frameId: result.frameId,
      };
    case "cdpGetFullAXTree":
      return {
        kind: "cdpGetFullAXTreeResult",
        ...envelope,
        nodesJson: result.nodesJson as BrowserCdpResultJsonValue,
      };
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled CDP result: ${JSON.stringify(exhaustive)}`);
    }
  }
}
