import { useSyncExternalStore } from "react";
import type {
  BrowserSessionsClientFrame,
  BrowserVisibleTileAction,
  BrowserVisibleTileGrant,
} from "@traycer/protocol/host/browser/contracts";

export type BrowserTileControlRequest = {
  readonly requestId: string;
  readonly grantId: string;
  readonly chatId: string;
  readonly agentRunId: string | null;
  readonly agentLabel: string;
  readonly tileInstanceId: string;
  readonly origin: string;
  readonly url: string | null;
  readonly requestedAt: number;
  readonly expiresAt: number;
  readonly sendFrame: (frame: BrowserSessionsClientFrame) => void;
};

export type BrowserTileActiveControl = BrowserTileControlRequest & {
  readonly grant: BrowserVisibleTileGrant;
};

export type BrowserTileControlActionRequest = {
  readonly requestId: string;
  readonly grantId: string;
  readonly tileInstanceId: string;
  readonly action: BrowserVisibleTileAction;
  readonly sendFrame: (frame: BrowserSessionsClientFrame) => void;
};

type BrowserTileControlSnapshot = {
  readonly pending: BrowserTileControlRequest | null;
  readonly pendingCount: number;
  readonly active: BrowserTileActiveControl | null;
};

const listeners = new Set<() => void>();
const pendingByTileInstanceId = new Map<
  string,
  readonly BrowserTileControlRequest[]
>();
const activeByTileInstanceId = new Map<string, BrowserTileActiveControl>();
const actionHandlerByTileInstanceId = new Map<
  string,
  (request: BrowserTileControlActionRequest) => void
>();
const snapshotCache = new Map<string, BrowserTileControlSnapshot>();

export function publishBrowserTileControlRequest(
  request: BrowserTileControlRequest,
): void {
  const pending = pendingByTileInstanceId.get(request.tileInstanceId) ?? [];
  if (pending.some((item) => item.requestId === request.requestId)) return;
  pendingByTileInstanceId.set(request.tileInstanceId, [...pending, request]);
  emit();
}

export function activateBrowserTileControl(input: {
  readonly request: BrowserTileControlRequest;
  readonly grant: BrowserVisibleTileGrant;
}): void {
  removePendingRequest(input.request.tileInstanceId, input.request.requestId);
  activeByTileInstanceId.set(input.request.tileInstanceId, {
    ...input.request,
    grant: input.grant,
  });
  emit();
}

export function clearBrowserTileControlRequest(input: {
  readonly tileInstanceId: string;
  readonly requestId: string;
}): void {
  removePendingRequest(input.tileInstanceId, input.requestId);
  emit();
}

export function clearBrowserTileActiveControl(input: {
  readonly tileInstanceId: string;
  readonly controlId: string;
}): void {
  const active = activeByTileInstanceId.get(input.tileInstanceId);
  if (active?.requestId === input.controlId) {
    activeByTileInstanceId.delete(input.tileInstanceId);
  }
  emit();
}

export function registerBrowserTileControlActionHandler(
  tileInstanceId: string,
  handler: (request: BrowserTileControlActionRequest) => void,
): () => void {
  actionHandlerByTileInstanceId.set(tileInstanceId, handler);
  return () => {
    if (actionHandlerByTileInstanceId.get(tileInstanceId) === handler) {
      actionHandlerByTileInstanceId.delete(tileInstanceId);
    }
  };
}

export function publishBrowserTileControlActionRequest(
  request: BrowserTileControlActionRequest,
): void {
  const handler = actionHandlerByTileInstanceId.get(request.tileInstanceId);
  if (handler !== undefined) {
    handler(request);
    return;
  }
  request.sendFrame({
    kind: "visibleTileControlActionResult",
    hasBinaryPayload: false,
    requestId: request.requestId,
    grantId: request.grantId,
    ok: false,
    reason: "Visible browser tile is not mounted.",
    value: null,
  });
}

export function useBrowserTileControlState(
  tileInstanceId: string,
): BrowserTileControlSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshotForTile(tileInstanceId),
    () => snapshotForTile(tileInstanceId),
  );
}

export function readBrowserTileControlSnapshotForTests(
  tileInstanceId: string,
): BrowserTileControlSnapshot {
  return snapshotForTile(tileInstanceId);
}

export function resetBrowserTileControlStoreForTests(): void {
  pendingByTileInstanceId.clear();
  activeByTileInstanceId.clear();
  actionHandlerByTileInstanceId.clear();
  snapshotCache.clear();
  emit();
}

function snapshotForTile(tileInstanceId: string): BrowserTileControlSnapshot {
  const pendingQueue = pendingByTileInstanceId.get(tileInstanceId) ?? [];
  const pending = pendingQueue[0] ?? null;
  const pendingCount = pendingQueue.length;
  const active = activeByTileInstanceId.get(tileInstanceId) ?? null;
  const cached = snapshotCache.get(tileInstanceId);
  if (
    cached?.pending === pending &&
    cached.pendingCount === pendingCount &&
    cached.active === active
  ) {
    return cached;
  }
  const next = { pending, pendingCount, active };
  snapshotCache.set(tileInstanceId, next);
  return next;
}

function removePendingRequest(tileInstanceId: string, requestId: string): void {
  const pending = pendingByTileInstanceId.get(tileInstanceId);
  if (pending === undefined) return;
  const next = pending.filter((item) => item.requestId !== requestId);
  if (next.length === 0) {
    pendingByTileInstanceId.delete(tileInstanceId);
    return;
  }
  pendingByTileInstanceId.set(tileInstanceId, next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}
