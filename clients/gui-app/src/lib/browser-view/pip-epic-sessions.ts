/**
 * Epic-wide `browser.sessions` fan-in for the agent-browser PiP.
 *
 * The sidebar's `BrowserSessionsProvider` stays bound to the active host.
 * This manager sits beside it: one subscription per reachable host, items
 * tagged with that host's id, burst frames forwarded into `pip-store`.
 *
 * Plain object (not a hook-per-host) so the host set can be data-driven.
 * Dispose closes every subscription; there is no retained detached state.
 */
import { useSyncExternalStore } from "react";
import {
  browserSessionsServerFrameSchema,
  type BrowserSessionInfo,
  type BrowserSessionsServerFrame,
} from "@traycer/protocol/host/browser/contracts";
import type { DurableStreamTransport } from "@/lib/host/durable-stream-transport";
import { appLogger } from "@/lib/logger";
import {
  applyPipBurstEnded,
  applyPipBurstStarted,
  applyPipCaption,
  applyPipHostLifecycle,
  dropPipHostLiveBursts,
  getPipSnapshot,
  type PipHostLifecycle,
} from "./pip-store";

const BROWSER_SESSIONS_METHOD = "browser.sessions";
const FANOUT_WARN_AT = 4;

const itemsByEpic = new Map<string, readonly BrowserSessionInfo[]>();
const itemsListeners = new Set<() => void>();

export function getPipEpicSessionItems(
  epicId: string,
): readonly BrowserSessionInfo[] {
  return itemsByEpic.get(epicId) ?? EMPTY_PIP_EPIC_SESSIONS;
}

export function subscribePipEpicSessionItems(listener: () => void): () => void {
  itemsListeners.add(listener);
  return () => {
    itemsListeners.delete(listener);
  };
}

export function usePipEpicSessionItems(
  epicId: string,
): readonly BrowserSessionInfo[] {
  return useSyncExternalStore(
    subscribePipEpicSessionItems,
    () => getPipEpicSessionItems(epicId),
    () => getPipEpicSessionItems(epicId),
  );
}

export function findPipEpicSession(
  items: readonly BrowserSessionInfo[],
  hostId: string,
  sessionId: string,
): BrowserSessionInfo | undefined {
  return items.find(
    (session) => session.hostId === hostId && session.sessionId === sessionId,
  );
}

export function setPipEpicSessionItemsForTests(
  epicId: string,
  items: readonly BrowserSessionInfo[],
): void {
  publishItems(epicId, items);
}

export function resetPipEpicSessionsForTests(): void {
  itemsByEpic.clear();
  itemsListeners.clear();
}

const EMPTY_PIP_EPIC_SESSIONS: readonly BrowserSessionInfo[] = [];

function publishItems(
  epicId: string,
  items: readonly BrowserSessionInfo[],
): void {
  const previous = itemsByEpic.get(epicId);
  if (previous !== undefined && sessionsEqual(previous, items)) return;
  itemsByEpic.set(epicId, items);
  itemsListeners.forEach((listener) => {
    listener();
  });
}

function sessionsEqual(
  left: readonly BrowserSessionInfo[],
  right: readonly BrowserSessionInfo[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export interface PipEpicSessionsSubscriptionRequest {
  readonly hostId: string;
  readonly epicId: string;
  readonly chatId: string;
  readonly onFrame: (frame: BrowserSessionsServerFrame) => void;
  readonly onLifecycle: (lifecycle: PipHostLifecycle) => void;
}

export interface PipEpicSessionsSubscriptionHandle {
  readonly close: () => void;
}

export type PipEpicSessionsOpener = (
  request: PipEpicSessionsSubscriptionRequest,
) => PipEpicSessionsSubscriptionHandle;

export function createPipEpicSessionsOpener(
  openTransport: (hostId: string) => DurableStreamTransport,
): PipEpicSessionsOpener {
  return (request) => openPipEpicSessionsSubscription(openTransport, request);
}

function openPipEpicSessionsSubscription(
  openTransport: (hostId: string) => DurableStreamTransport,
  request: PipEpicSessionsSubscriptionRequest,
): PipEpicSessionsSubscriptionHandle {
  const { hostId } = request;
  const transport = openTransport(hostId);
  const client = transport.wsStreamClient;
  let closed = false;
  try {
    const session = client.subscribe(BROWSER_SESSIONS_METHOD, {
      epicId: request.epicId,
      chatId: request.chatId,
    });
    session.onServerFrame((envelope, binaryPayload) => {
      if (closed || binaryPayload !== null) return;
      const parsed = browserSessionsServerFrameSchema.safeParse(envelope);
      if (!parsed.success) return;
      request.onFrame(parsed.data);
    });
    session.onStatusChange((status, reason) => {
      if (closed) return;
      if (status === "open") {
        request.onLifecycle("live");
        return;
      }
      if (status === "reconnecting") {
        request.onLifecycle("reconnecting");
        return;
      }
      if (status === "connecting") {
        request.onLifecycle("connecting");
        return;
      }
      if (reason === null || reason.kind === "caller") return;
      request.onLifecycle("failed");
    });
    return {
      close: () => {
        if (closed) return;
        closed = true;
        try {
          session.close();
        } finally {
          transport.close();
        }
      },
    };
  } catch (cause) {
    transport.close();
    throw cause;
  }
}

interface HostSlot {
  readonly hostId: string;
  handle: PipEpicSessionsSubscriptionHandle | null;
  items: readonly BrowserSessionInfo[];
  generation: number;
}

export class PipEpicSessionsManager {
  private readonly epicId: string;
  private readonly opener: PipEpicSessionsOpener;
  private readonly hosts = new Map<string, HostSlot>();
  private desiredHostIds: readonly string[] = [];
  private chatId: string | null = null;
  private attached = false;
  private disposed = false;

  constructor(epicId: string, opener: PipEpicSessionsOpener) {
    this.epicId = epicId;
    this.opener = opener;
  }

  setChatId(chatId: string | null): void {
    if (this.disposed || this.chatId === chatId) return;
    this.chatId = chatId;
    this.closeEveryHost();
    this.reconcile();
  }

  setHostIds(hostIds: readonly string[]): void {
    if (this.disposed) return;
    if (sameHostIds(this.desiredHostIds, hostIds)) return;
    this.desiredHostIds = [...hostIds];
    if (hostIds.length > FANOUT_WARN_AT) {
      appLogger.warn("[pip] epic-wide sessions fan-out", {
        epicId: this.epicId,
        hostCount: hostIds.length,
      });
    }
    this.reconcile();
  }

  attach(): void {
    if (this.disposed || this.attached) return;
    this.attached = true;
    this.reconcile();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.attached = false;
    this.closeEveryHost();
    this.hosts.clear();
    // Do not clear the epic items map: a second EpicSurface for the same
    // epic may still be publishing. Tests call resetPipEpicSessionsForTests.
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getOpenHostIds(): readonly string[] {
    const open: string[] = [];
    for (const slot of this.hosts.values()) {
      if (slot.handle !== null) open.push(slot.hostId);
    }
    return open;
  }

  private reconcile(): void {
    if (!this.attached || this.disposed) return;
    const desired = new Set(this.desiredHostIds);
    for (const [hostId, slot] of Array.from(this.hosts.entries())) {
      if (desired.has(hostId)) continue;
      this.dropHost(slot);
      this.hosts.delete(hostId);
    }
    if (this.chatId === null) {
      this.closeEveryHost();
      this.publishMergedItems();
      return;
    }
    for (const hostId of desired) {
      let slot = this.hosts.get(hostId);
      if (slot === undefined) {
        slot = {
          hostId,
          handle: null,
          items: [],
          generation: 0,
        };
        this.hosts.set(hostId, slot);
      }
      if (slot.handle === null) this.openHost(slot);
    }
    this.publishMergedItems();
  }

  private openHost(slot: HostSlot): void {
    const chatId = this.chatId;
    if (chatId === null) return;
    slot.generation += 1;
    const generation = slot.generation;
    try {
      slot.handle = this.opener({
        hostId: slot.hostId,
        epicId: this.epicId,
        chatId,
        onFrame: (frame) => {
          if (slot.generation !== generation) return;
          this.applyFrame(slot, frame);
        },
        onLifecycle: (lifecycle) => {
          if (slot.generation !== generation) return;
          applyPipHostLifecycle(this.epicId, slot.hostId, lifecycle);
        },
      });
    } catch (cause) {
      slot.handle = null;
      appLogger.warn("[pip] epic-wide sessions subscribe failed", {
        epicId: this.epicId,
        hostId: slot.hostId,
        error: cause instanceof Error ? cause.message : "unknown",
      });
    }
  }

  private applyFrame(slot: HostSlot, frame: BrowserSessionsServerFrame): void {
    if (frame.kind === "burstStarted") {
      applyPipBurstStarted({
        epicId: this.epicId,
        hostId: slot.hostId,
        sessionId: frame.sessionId,
        tabId: frame.tabId,
        burstId: frame.burstId,
        chatId: frame.chatId,
        startedAt: undefined,
      });
      return;
    }
    if (frame.kind === "burstEnded") {
      applyPipBurstEnded({
        epicId: this.epicId,
        burstId: frame.burstId,
        outcome: frame.outcome,
        endedAt: undefined,
      });
      return;
    }
    if (frame.kind === "caption") {
      applyPipCaption({
        epicId: this.epicId,
        sessionId: frame.sessionId,
        tabId: frame.tabId,
        burstId: frame.burstId,
        cellTitle: frame.cellTitle,
      });
      return;
    }
    if (frame.kind === "snapshot") {
      this.resetHostBurstGeneration(slot.hostId);
      slot.items = frame.sessions.map((session) =>
        tagSession(slot.hostId, session),
      );
      this.publishMergedItems();
      return;
    }
    if (frame.kind === "sessionCreated" || frame.kind === "sessionUpdated") {
      slot.items = upsertSession(
        slot.items,
        tagSession(slot.hostId, frame.session),
      );
      this.publishMergedItems();
      return;
    }
    if (frame.kind === "sessionClosed") {
      slot.items = slot.items.filter(
        (session) => session.sessionId !== frame.sessionId,
      );
      this.publishMergedItems();
    }
  }

  /**
   * A host snapshot is a burst-generation boundary. Late subscribers only
   * hear still-open bursts as a following `burstStarted` replay; anything
   * that ended while we were unmounted never arrives. Drop this host's prior
   * live bursts, then finish a leftover live target on this host so it cannot
   * pose as live until a replay restores it.
   *
   * `dropPipHostLiveBursts` keeps the displayed target (last-frame +
   * disconnected). That leftover is finished here because the store has no
   * hide-current-target API and this file must not edit pip-store.
   */
  private resetHostBurstGeneration(hostId: string): void {
    const pip = getPipSnapshot(this.epicId);
    dropPipHostLiveBursts(this.epicId, hostId);
    if (
      pip.phase !== "live" ||
      pip.target === null ||
      pip.target.hostId !== hostId
    ) {
      return;
    }
    applyPipBurstEnded({
      epicId: this.epicId,
      burstId: pip.target.burstId,
      outcome: "finished",
      endedAt: undefined,
    });
  }

  private dropHost(slot: HostSlot): void {
    this.closeSlot(slot);
    slot.items = [];
    dropPipHostLiveBursts(this.epicId, slot.hostId);
  }

  private closeEveryHost(): void {
    for (const slot of this.hosts.values()) {
      this.closeSlot(slot);
      slot.items = [];
    }
  }

  private closeSlot(slot: HostSlot): void {
    slot.generation += 1;
    const handle = slot.handle;
    slot.handle = null;
    handle?.close();
  }

  private publishMergedItems(): void {
    const merged: BrowserSessionInfo[] = [];
    for (const hostId of this.desiredHostIds) {
      const slot = this.hosts.get(hostId);
      if (slot === undefined) continue;
      for (const item of slot.items) merged.push(item);
    }
    publishItems(this.epicId, merged);
  }
}

function tagSession(
  hostId: string,
  session: BrowserSessionInfo,
): BrowserSessionInfo {
  if (session.hostId === hostId) return session;
  return { ...session, hostId };
}

function upsertSession(
  current: readonly BrowserSessionInfo[],
  next: BrowserSessionInfo,
): readonly BrowserSessionInfo[] {
  const existing = current.findIndex(
    (session) => session.sessionId === next.sessionId,
  );
  if (existing === -1) return [...current, next];
  return current.map((session, index) => (index === existing ? next : session));
}

function sameHostIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].toSorted((a, b) => a.localeCompare(b));
  const sortedRight = [...right].toSorted((a, b) => a.localeCompare(b));
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}
