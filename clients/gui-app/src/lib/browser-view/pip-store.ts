import { useSyncExternalStore } from "react";
import type { BrowserBurstOutcome } from "@traycer/protocol/host/browser/contracts";
import {
  isBrowserTileVisible,
  subscribeVisibleBrowserTiles,
} from "./visible-tile-registry";

/**
 * How long the finished frame stays expanded before collapsing to the chip.
 * A few seconds (F1). The host-side quiet/rejoin window is consumed before
 * `burstEnded` fires and is not this constant.
 */
export const PIP_LINGER_MS = 5_000;

/**
 * Minimum dwell on the displayed target before auto-follow may switch.
 * Core flows require a floor; they do not name a duration.
 */
export const PIP_SWITCH_DWELL_MS = 2_000;

/**
 * How long a caption stays visible after it arrives. There is no cell-end
 * frame; the GUI fades locally and drops the caption at burst end.
 */
export const PIP_CAPTION_HOLD_MS = 3_500;

/** Opacity transition for caption fade in/out. */
export const PIP_CAPTION_FADE_MS = 300;

export type PipPhase =
  "hidden" | "live" | "finished" | "chip" | "dismissed-burst";

export type PipBurstOutcome = BrowserBurstOutcome;

export type PipStreamHealth = "live" | "stale" | "disconnected";

export type PipHostLifecycle =
  "connecting" | "live" | "reconnecting" | "closed" | "failed";

export interface PipTarget {
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
  readonly chatId: string;
  readonly startedAt: number;
}

export interface PipCaption {
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
  readonly cellTitle: string;
  readonly arrivedAt: number;
}

interface LivePipRow {
  readonly target: PipTarget;
  readonly kind: "live";
  readonly outcome: null;
  readonly expiresAt: null;
  readonly caption: PipCaption | null;
}

interface LingeringPipRow {
  readonly target: PipTarget;
  readonly kind: "lingering";
  readonly outcome: PipBurstOutcome;
  readonly expiresAt: number;
}

export type PipRow = LivePipRow | LingeringPipRow;

export interface PipSnapshot {
  readonly phase: PipPhase;
  readonly target: PipTarget | null;
  readonly outcome: PipBurstOutcome | null;
  readonly streamHealth: PipStreamHealth;
  readonly openTileEnabled: boolean;
  readonly pinned: boolean;
  readonly lingerActive: boolean;
  readonly caption: PipCaption | null;
  readonly rows: readonly PipRow[];
}

export const HIDDEN_PIP_SNAPSHOT: PipSnapshot = {
  phase: "hidden",
  target: null,
  outcome: null,
  streamHealth: "live",
  openTileEnabled: true,
  pinned: false,
  lingerActive: false,
  caption: null,
  rows: [],
};

interface PipBurst extends PipTarget {
  readonly epicId: string;
  readonly arrivedAt: number;
  readonly arrivalOrder: number;
}

interface FinishedPipBurst extends PipBurst {
  readonly outcome: PipBurstOutcome;
  readonly endedAt: number;
}

interface EpicPipState {
  phase: PipPhase;
  target: PipTarget | null;
  outcome: PipBurstOutcome | null;
  pinnedBurstId: string | null;
  selectedAt: number;
  lingerEndsAt: number | null;
  dismissedAt: number | null;
  dismissedBurstId: string | null;
  streamHealth: PipStreamHealth;
}

const epics = new Map<string, EpicPipState>();
const liveBursts = new Map<string, PipBurst>();
const finishedBursts = new Map<string, FinishedPipBurst>();
const captionsByTab = new Map<string, PipCaption>();
const dismissals = new Map<string, Set<string>>();
interface PipTimerHandle {
  readonly cancel: () => void;
}

const lingerTimers = new Map<string, PipTimerHandle>();
const dwellTimers = new Map<string, PipTimerHandle>();
const snapshotCache = new Map<string, PipSnapshot>();
const hostLifecycles = new Map<string, PipHostLifecycle>();
const listeners = new Set<() => void>();

let activeHostId: string | null = null;
let nowFn: () => number = () => Date.now();
let nextArrivalOrder = 0;

function hostLifecycleKey(epicId: string, hostId: string): string {
  return `${epicId}\0${hostId}`;
}

export function applyPipBurstStarted(input: {
  readonly epicId: string;
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
  readonly chatId: string;
  readonly startedAt: number | undefined;
}): void {
  const existing =
    liveBursts.get(input.burstId) ?? finishedBursts.get(input.burstId);
  const hadEligibleLive = listEligibleLive(input.epicId).length > 0;
  let arrivedAt: number;
  let arrivalOrder: number;
  if (existing === undefined) {
    arrivedAt = nowFn();
    arrivalOrder = nextArrivalOrder;
    nextArrivalOrder += 1;
  } else {
    arrivedAt = existing.arrivedAt;
    arrivalOrder = existing.arrivalOrder;
  }
  const startedAt = input.startedAt ?? nowFn();
  const burst: PipBurst = {
    epicId: input.epicId,
    hostId: input.hostId,
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    chatId: input.chatId,
    startedAt,
    arrivedAt,
    arrivalOrder,
  };
  liveBursts.set(input.burstId, burst);
  finishedBursts.delete(input.burstId);
  const epic = getOrCreateEpic(input.epicId);
  const dismissed = isDismissed(input.epicId, input.burstId);
  const sameBurstResume =
    epic.target !== null &&
    epic.target.burstId === input.burstId &&
    (epic.phase === "finished" || epic.phase === "chip");
  if (sameBurstResume && dismissed) {
    // Linger rejoin of a dismissed burst does not reset the dismissal.
    recomputeEpic(input.epicId);
    return;
  }
  if (sameBurstResume && !tileIsVisible(burst)) {
    goLive(input.epicId, burst);
    emit();
    return;
  }
  if (
    isTerminalLinger(epic, hadEligibleLive) &&
    !dismissed &&
    !tileIsVisible(burst)
  ) {
    goLive(input.epicId, burst);
    emit();
    return;
  }
  recomputeEpic(input.epicId);
}

function isTerminalLinger(
  epic: EpicPipState,
  hadEligibleLive: boolean,
): boolean {
  return (
    epic.phase === "finished" &&
    epic.lingerEndsAt !== null &&
    nowFn() < epic.lingerEndsAt &&
    !hadEligibleLive
  );
}

export function applyPipBurstEnded(input: {
  readonly epicId: string;
  readonly burstId: string;
  readonly outcome: PipBurstOutcome;
  readonly endedAt: number | undefined;
}): void {
  const live = liveBursts.get(input.burstId);
  liveBursts.delete(input.burstId);
  const endedAt = input.endedAt ?? nowFn();
  if (live !== undefined) {
    const finished: FinishedPipBurst = {
      ...live,
      outcome: input.outcome,
      endedAt,
    };
    finishedBursts.set(input.burstId, finished);
  }
  dropCaptionsForBurst(input.burstId);
  const epic = getOrCreateEpic(input.epicId);
  if (epic.pinnedBurstId === input.burstId) {
    epic.pinnedBurstId = null;
  }
  const remaining = listEligibleLive(input.epicId);
  const endedWasEligible =
    live !== undefined &&
    !isDismissed(input.epicId, input.burstId) &&
    !tileIsVisible(live);
  if (endedWasEligible && remaining.length === 0) {
    setTerminalTarget(input.epicId, finishedBursts.get(input.burstId));
  } else if (epic.target?.burstId === input.burstId && epic.phase === "live") {
    epic.phase = "finished";
    epic.outcome = input.outcome;
    epic.lingerEndsAt = nowFn() + PIP_LINGER_MS;
    epic.streamHealth = "live";
    scheduleLinger(input.epicId);
  }
  recomputeEpic(input.epicId);
}

export function applyPipHostLifecycle(
  epicId: string,
  hostId: string,
  lifecycle: PipHostLifecycle,
): void {
  hostLifecycles.set(hostLifecycleKey(epicId, hostId), lifecycle);
  const epic = getOrCreateEpic(epicId);
  if (epic.target !== null && epic.target.hostId === hostId) {
    epic.streamHealth = hostHealthFor(epicId, hostId);
  }
  emit();
}

/**
 * A host that left the epic-wide set no longer contributes live bursts,
 * except the currently displayed target (keep last frame + disconnected).
 */
export function dropPipHostLiveBursts(epicId: string, hostId: string): void {
  const epic = epics.get(epicId);
  const displayedBurstId = epic?.target?.burstId ?? null;
  for (const [burstId, burst] of liveBursts) {
    if (burst.epicId !== epicId || burst.hostId !== hostId) continue;
    if (burstId === displayedBurstId) continue;
    liveBursts.delete(burstId);
    dropCaptionsForBurst(burstId);
  }
  applyPipHostLifecycle(epicId, hostId, "closed");
  if (epic !== undefined) recomputeEpic(epicId);
}

export function applyPipCaption(input: {
  readonly epicId: string;
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
  readonly cellTitle: string;
}): void {
  getOrCreateEpic(input.epicId);
  captionsByTab.set(
    captionTabKey(input.epicId, input.hostId, input.sessionId, input.tabId),
    {
      sessionId: input.sessionId,
      tabId: input.tabId,
      burstId: input.burstId,
      cellTitle: input.cellTitle,
      arrivedAt: nowFn(),
    },
  );
  emit();
}

export function applyPipStreamHealth(
  epicId: string,
  health: PipStreamHealth,
): void {
  const epic = epics.get(epicId);
  if (epic === undefined) return;
  if (epic.streamHealth === health) return;
  const targetHostId = epic.target?.hostId;
  // A frame cannot arrive from a dead stream. Promote the sessions lifecycle
  // too so a stale close event cannot poison the next burst from this host.
  if (health === "live" && targetHostId !== undefined) {
    hostLifecycles.set(hostLifecycleKey(epicId, targetHostId), "live");
  }
  epic.streamHealth = health;
  emit();
}

export function applyPipVisibilityChanged(): void {
  for (const epicId of epics.keys()) {
    recomputeEpic(epicId);
  }
}

export function dismissPip(epicId: string): void {
  const epic = getOrCreateEpic(epicId);
  if (epic.target === null) return;
  if (epic.phase === "chip") {
    dismissPipChip(epicId);
    return;
  }
  if (epic.phase !== "live" && epic.phase !== "finished") return;
  addDismissal(epicId, epic.target.burstId);
  epic.phase = "dismissed-burst";
  epic.dismissedAt = nowFn();
  epic.dismissedBurstId = epic.target.burstId;
  if (epic.pinnedBurstId === epic.target.burstId) {
    epic.pinnedBurstId = null;
  }
  epic.lingerEndsAt = null;
  clearLinger(epicId);
  clearDwell(epicId);
  emit();
}

export function dismissPipChip(epicId: string): void {
  const epic = getOrCreateEpic(epicId);
  if (epic.phase !== "chip") return;
  epic.phase = "hidden";
  epic.lingerEndsAt = null;
  clearLinger(epicId);
  emit();
}

export function reexpandPip(epicId: string): void {
  const epic = getOrCreateEpic(epicId);
  if (epic.phase !== "chip") return;
  epic.phase = "finished";
  epic.lingerEndsAt = null;
  epic.streamHealth = "live";
  clearLinger(epicId);
  emit();
}

export function recallPip(input: {
  readonly epicId: string;
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
}): void {
  const { epicId, hostId, sessionId, tabId } = input;
  const live = findLiveBurstForTab(epicId, hostId, sessionId, tabId);
  const finished = findFinishedBurstForTab(epicId, hostId, sessionId, tabId);
  const target = live ?? finished;
  if (target === undefined) return;
  removeDismissal(epicId, target.burstId);
  const epic = getOrCreateEpic(epicId);
  // Pin only a still-live burst. A finished recall has already ended, so
  // F4.5 auto-follow must be free to follow the next live burst.
  epic.pinnedBurstId = live !== undefined ? target.burstId : null;
  if (live !== undefined && !tileIsVisible(live)) {
    goLive(epicId, live);
    emit();
    return;
  }
  if (finished !== undefined) {
    epic.phase = "finished";
    epic.target = toTarget(finished);
    epic.outcome = finished.outcome;
    epic.selectedAt = nowFn();
    epic.lingerEndsAt = null;
    epic.dismissedAt = null;
    epic.dismissedBurstId = null;
    epic.streamHealth = "live";
    clearLinger(epicId);
    clearDwell(epicId);
    emit();
    return;
  }
  recomputeEpic(epicId);
}

export function selectPipRow(target: PipTarget): void {
  const live = liveBursts.get(target.burstId);
  if (live === undefined || !targetsEqual(live, target)) return;
  if (isDismissed(live.epicId, live.burstId) || tileIsVisible(live)) return;
  const epic = getOrCreateEpic(live.epicId);
  epic.pinnedBurstId = live.burstId;
  goLive(live.epicId, live);
  emit();
}

export function dismissPipRow(epicId: string, burstId: string): void {
  addDismissal(epicId, burstId);
  recomputeEpic(epicId);
}

export function dismissPipRowSet(epicId: string): void {
  const epic = getOrCreateEpic(epicId);
  if (epic.target === null) return;
  const rows = listPipRows(epicId, epic.target.burstId);
  addDismissal(epicId, epic.target.burstId);
  for (const row of rows) addDismissal(epicId, row.target.burstId);
  epic.phase = "dismissed-burst";
  epic.dismissedAt = nowFn();
  epic.dismissedBurstId = epic.target.burstId;
  epic.pinnedBurstId = null;
  epic.lingerEndsAt = null;
  clearLinger(epicId);
  clearDwell(epicId);
  emit();
}

export function setPipActiveHostId(hostId: string | null): void {
  if (activeHostId === hostId) return;
  activeHostId = hostId;
  for (const epicId of epics.keys()) {
    recomputeEpic(epicId);
  }
}

export function getPipSnapshot(epicId: string): PipSnapshot {
  cacheSnapshot(epicId);
  return snapshotCache.get(epicId) ?? HIDDEN_PIP_SNAPSHOT;
}

export function getPipDismissalsForTests(epicId: string): ReadonlySet<string> {
  return dismissals.get(epicId) ?? new Set<string>();
}

export function subscribePipStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePipSnapshot(epicId: string): PipSnapshot {
  return useSyncExternalStore(
    subscribePipStore,
    () => getPipSnapshot(epicId),
    () => getPipSnapshot(epicId),
  );
}

export function setPipNowForTests(now: () => number): void {
  nowFn = now;
}

export function resetPipStoreForTests(): void {
  for (const timer of lingerTimers.values()) timer.cancel();
  for (const timer of dwellTimers.values()) timer.cancel();
  lingerTimers.clear();
  dwellTimers.clear();
  epics.clear();
  liveBursts.clear();
  finishedBursts.clear();
  captionsByTab.clear();
  dismissals.clear();
  snapshotCache.clear();
  hostLifecycles.clear();
  listeners.clear();
  activeHostId = null;
  nowFn = () => Date.now();
  nextArrivalOrder = 0;
}

function recomputeEpic(epicId: string): void {
  const epic = getOrCreateEpic(epicId);
  const eligible = listEligibleLive(epicId);
  switch (epic.phase) {
    case "dismissed-burst":
      recomputeDismissed(epicId, epic, eligible);
      break;
    case "chip":
      recomputeChip(epicId, epic, eligible);
      break;
    case "finished":
      recomputeFinished(epicId, epic, eligible);
      break;
    case "hidden":
      recomputeHidden(epicId, epic, eligible);
      break;
    case "live":
      recomputeLive(epicId, epic, eligible);
      break;
  }
  emit();
}

function recomputeDismissed(
  epicId: string,
  epic: EpicPipState,
  eligible: readonly PipBurst[],
): void {
  const next = selectNextAfterDismissal(epic, eligible);
  if (next !== null) goLive(epicId, next);
}

function recomputeChip(
  epicId: string,
  epic: EpicPipState,
  eligible: readonly PipBurst[],
): void {
  const next = selectFollowTarget(epic, eligible);
  if (next !== null) {
    goLive(epicId, next);
    return;
  }
  if (epic.target !== null && tileIsVisible(epic.target)) {
    epic.phase = "hidden";
  }
}

function recomputeFinished(
  epicId: string,
  epic: EpicPipState,
  eligible: readonly PipBurst[],
): void {
  const resume =
    epic.target !== null ? liveBursts.get(epic.target.burstId) : undefined;
  if (
    resume !== undefined &&
    !isDismissed(epicId, resume.burstId) &&
    !tileIsVisible(resume)
  ) {
    goLive(epicId, resume);
    return;
  }
  if (epic.target !== null && tileIsVisible(epic.target)) {
    const next = selectFollowTarget(epic, eligible);
    if (next !== null) goLive(epicId, next);
    else {
      epic.phase = "hidden";
      epic.lingerEndsAt = null;
      clearLinger(epicId);
    }
    return;
  }
  const next = selectFollowTarget(epic, eligible);
  const lingerPending =
    epic.lingerEndsAt !== null && nowFn() < epic.lingerEndsAt;
  if (lingerPending) {
    scheduleLinger(epicId);
    return;
  }
  if (next !== null && next.burstId !== epic.target?.burstId) {
    goLive(epicId, next);
    return;
  }
  if (epic.lingerEndsAt !== null) {
    goChip(epic);
    return;
  }
}

function recomputeHidden(
  epicId: string,
  epic: EpicPipState,
  eligible: readonly PipBurst[],
): void {
  const next = selectFollowTarget(epic, eligible);
  if (next !== null) goLive(epicId, next);
}

function recomputeLive(
  epicId: string,
  epic: EpicPipState,
  eligible: readonly PipBurst[],
): void {
  if (epic.target === null) {
    const next = selectFollowTarget(epic, eligible);
    if (next !== null) goLive(epicId, next);
    else epic.phase = "hidden";
    return;
  }
  const currentLive = liveBursts.get(epic.target.burstId);
  if (currentLive === undefined) return;
  if (isDismissed(epicId, currentLive.burstId)) {
    epic.phase = "dismissed-burst";
    epic.dismissedAt = nowFn();
    epic.dismissedBurstId = currentLive.burstId;
    clearLinger(epicId);
    clearDwell(epicId);
    return;
  }
  if (tileIsVisible(currentLive)) {
    const next = selectFollowTarget(epic, eligible);
    if (next !== null) goLive(epicId, next);
    else {
      epic.phase = "hidden";
      clearDwell(epicId);
    }
    return;
  }
  if (epic.pinnedBurstId === currentLive.burstId) return;
  const best = selectMostRecent(eligible);
  if (best === null || best.burstId === currentLive.burstId) {
    clearDwell(epicId);
    return;
  }
  const sameBoundary = best.startedAt === currentLive.startedAt;
  if (sameBoundary || nowFn() - epic.selectedAt >= PIP_SWITCH_DWELL_MS) {
    goLive(epicId, best);
    return;
  }
  scheduleDwell(epicId, PIP_SWITCH_DWELL_MS - (nowFn() - epic.selectedAt));
}

function goLive(epicId: string, burst: PipBurst): void {
  const epic = getOrCreateEpic(epicId);
  const switched =
    epic.target === null || epic.target.burstId !== burst.burstId;
  epic.phase = "live";
  epic.target = toTarget(burst);
  epic.outcome = null;
  epic.selectedAt = switched ? nowFn() : epic.selectedAt;
  epic.lingerEndsAt = null;
  epic.dismissedAt = null;
  epic.dismissedBurstId = null;
  if (switched) {
    epic.streamHealth = hostHealthFor(epicId, burst.hostId);
  }
  clearLinger(epicId);
  clearDwell(epicId);
}

function setTerminalTarget(
  epicId: string,
  burst: FinishedPipBurst | undefined,
): void {
  if (burst === undefined) return;
  const epic = getOrCreateEpic(epicId);
  epic.phase = "finished";
  epic.target = toTarget(burst);
  epic.outcome = burst.outcome;
  epic.selectedAt = nowFn();
  epic.lingerEndsAt = nowFn() + PIP_LINGER_MS;
  epic.dismissedAt = null;
  epic.dismissedBurstId = null;
  epic.streamHealth = "live";
  clearLinger(epicId);
  clearDwell(epicId);
  scheduleLinger(epicId);
}

function goChip(epic: EpicPipState): void {
  epic.phase = "chip";
  epic.lingerEndsAt = null;
}

function selectFollowTarget(
  epic: EpicPipState,
  eligible: readonly PipBurst[],
): PipBurst | null {
  if (epic.pinnedBurstId !== null) {
    const pinned = eligible.find(
      (burst) => burst.burstId === epic.pinnedBurstId,
    );
    if (pinned !== undefined) return pinned;
  }
  return selectMostRecent(eligible);
}

function selectNextAfterDismissal(
  epic: EpicPipState,
  eligible: readonly PipBurst[],
): PipBurst | null {
  const dismissedAt = epic.dismissedAt ?? 0;
  const dismissedBurstId = epic.dismissedBurstId;
  const newer = eligible.filter(
    (burst) =>
      burst.burstId !== dismissedBurstId && burst.startedAt > dismissedAt,
  );
  return selectMostRecent(newer);
}

function selectMostRecent(candidates: readonly PipBurst[]): PipBurst | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const candidate of candidates) {
    if (compareBursts(candidate, best) < 0) best = candidate;
  }
  return best;
}

function compareBursts(left: PipBurst, right: PipBurst): number {
  if (left.startedAt !== right.startedAt) {
    return right.startedAt - left.startedAt;
  }
  const leftActive = activeHostId !== null && left.hostId === activeHostId;
  const rightActive = activeHostId !== null && right.hostId === activeHostId;
  if (leftActive !== rightActive) return leftActive ? -1 : 1;
  return right.burstId.localeCompare(left.burstId);
}

function listEligibleLive(epicId: string): PipBurst[] {
  const out: PipBurst[] = [];
  for (const burst of liveBursts.values()) {
    if (burst.epicId !== epicId) continue;
    if (isDismissed(epicId, burst.burstId)) continue;
    if (tileIsVisible(burst)) continue;
    out.push(burst);
  }
  return out;
}

function findLiveBurstForTab(
  epicId: string,
  hostId: string,
  sessionId: string,
  tabId: string,
): PipBurst | undefined {
  let found: PipBurst | undefined;
  for (const burst of liveBursts.values()) {
    if (
      burst.epicId === epicId &&
      burst.hostId === hostId &&
      burst.sessionId === sessionId &&
      burst.tabId === tabId
    ) {
      if (found === undefined || burst.startedAt >= found.startedAt) {
        found = burst;
      }
    }
  }
  return found;
}

function findFinishedBurstForTab(
  epicId: string,
  hostId: string,
  sessionId: string,
  tabId: string,
): FinishedPipBurst | undefined {
  let found: FinishedPipBurst | undefined;
  for (const burst of finishedBursts.values()) {
    if (
      burst.epicId === epicId &&
      burst.hostId === hostId &&
      burst.sessionId === sessionId &&
      burst.tabId === tabId
    ) {
      if (found === undefined || burst.endedAt >= found.endedAt) {
        found = burst;
      }
    }
  }
  return found;
}

function deriveSnapshot(epicId: string): PipSnapshot {
  const epic = epics.get(epicId);
  if (epic === undefined) return HIDDEN_PIP_SNAPSHOT;
  if (epic.phase === "hidden" || epic.phase === "dismissed-burst") {
    return {
      phase: epic.phase,
      target: epic.target,
      outcome: epic.outcome,
      streamHealth: epic.streamHealth,
      openTileEnabled: epic.outcome !== "closed",
      pinned: epic.pinnedBurstId !== null,
      lingerActive: false,
      caption: null,
      rows: [],
    };
  }
  const displayedId = epic.target?.burstId;
  return {
    phase: epic.phase,
    target: epic.target,
    outcome: epic.outcome,
    streamHealth: epic.streamHealth,
    openTileEnabled: epic.outcome !== "closed",
    pinned: epic.pinnedBurstId !== null,
    lingerActive:
      epic.phase === "finished" &&
      epic.lingerEndsAt !== null &&
      nowFn() < epic.lingerEndsAt,
    caption: displayedCaption(epicId, epic),
    rows: listPipRows(epicId, displayedId),
  };
}

function listPipRows(
  epicId: string,
  displayedBurstId: string | undefined,
): PipRow[] {
  const rows: Array<{ readonly row: PipRow; readonly order: number }> = [];
  for (const burst of liveBursts.values()) {
    if (!burstIsRowEligible(epicId, burst, displayedBurstId)) continue;
    rows.push({
      row: {
        target: toTarget(burst),
        kind: "live",
        outcome: null,
        expiresAt: null,
        caption: freshCaptionForBurst(burst),
      },
      order: burst.arrivalOrder,
    });
  }
  for (const [burstId, burst] of finishedBursts) {
    const expiresAt = burst.endedAt + PIP_LINGER_MS;
    if (nowFn() >= expiresAt) {
      if (burstId !== displayedBurstId) finishedBursts.delete(burstId);
      continue;
    }
    if (!burstIsRowEligible(epicId, burst, displayedBurstId)) continue;
    rows.push({
      row: {
        target: toTarget(burst),
        kind: "lingering",
        outcome: burst.outcome,
        expiresAt,
      },
      order: burst.arrivalOrder,
    });
  }
  rows.sort((left, right) => left.order - right.order);
  return rows.map(({ row }) => row);
}

function burstIsRowEligible(
  epicId: string,
  burst: PipBurst,
  displayedBurstId: string | undefined,
): boolean {
  return (
    burst.epicId === epicId &&
    burst.burstId !== displayedBurstId &&
    !isDismissed(epicId, burst.burstId) &&
    !tileIsVisible(burst)
  );
}

function cacheSnapshot(epicId: string): void {
  const next = deriveSnapshot(epicId);
  const previous = snapshotCache.get(epicId);
  if (previous !== undefined && snapshotsEqual(previous, next)) return;
  snapshotCache.set(epicId, next);
}

function snapshotsEqual(left: PipSnapshot, right: PipSnapshot): boolean {
  return (
    left.phase === right.phase &&
    left.outcome === right.outcome &&
    left.streamHealth === right.streamHealth &&
    left.openTileEnabled === right.openTileEnabled &&
    left.pinned === right.pinned &&
    left.lingerActive === right.lingerActive &&
    targetsEqual(left.target, right.target) &&
    captionsEqual(left.caption, right.caption) &&
    rowsEqual(left.rows, right.rows)
  );
}

function rowsEqual(left: readonly PipRow[], right: readonly PipRow[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return (
      row.kind === other.kind &&
      row.outcome === other.outcome &&
      row.expiresAt === other.expiresAt &&
      targetsEqual(row.target, other.target) &&
      (row.kind !== "live" ||
        (other.kind === "live" && captionsEqual(row.caption, other.caption)))
    );
  });
}

function captionsEqual(
  left: PipCaption | null,
  right: PipCaption | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.sessionId === right.sessionId &&
    left.tabId === right.tabId &&
    left.burstId === right.burstId &&
    left.cellTitle === right.cellTitle &&
    left.arrivedAt === right.arrivedAt
  );
}

function targetsEqual(
  left: PipTarget | null,
  right: PipTarget | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.hostId === right.hostId &&
    left.sessionId === right.sessionId &&
    left.tabId === right.tabId &&
    left.burstId === right.burstId &&
    left.chatId === right.chatId &&
    left.startedAt === right.startedAt
  );
}

function getOrCreateEpic(epicId: string): EpicPipState {
  const existing = epics.get(epicId);
  if (existing !== undefined) return existing;
  const created: EpicPipState = {
    phase: "hidden",
    target: null,
    outcome: null,
    pinnedBurstId: null,
    selectedAt: 0,
    lingerEndsAt: null,
    dismissedAt: null,
    dismissedBurstId: null,
    streamHealth: "live",
  };
  epics.set(epicId, created);
  return created;
}

function addDismissal(epicId: string, burstId: string): void {
  const set = dismissals.get(epicId) ?? new Set<string>();
  set.add(burstId);
  dismissals.set(epicId, set);
}

function removeDismissal(epicId: string, burstId: string): void {
  dismissals.get(epicId)?.delete(burstId);
}

function isDismissed(epicId: string, burstId: string): boolean {
  return dismissals.get(epicId)?.has(burstId) === true;
}

function tileIsVisible(target: PipTarget): boolean {
  return isBrowserTileVisible({
    hostId: target.hostId,
    sessionId: target.sessionId,
    tabId: target.tabId,
  });
}

function displayedCaption(
  epicId: string,
  epic: EpicPipState,
): PipCaption | null {
  if (epic.phase !== "live" || epic.target === null) return null;
  const caption = captionsByTab.get(
    captionTabKey(
      epicId,
      epic.target.hostId,
      epic.target.sessionId,
      epic.target.tabId,
    ),
  );
  if (caption === undefined) return null;
  if (caption.burstId !== epic.target.burstId) return null;
  if (captionFreshness(caption, nowFn()) === "expired") {
    captionsByTab.delete(
      captionTabKey(
        epicId,
        epic.target.hostId,
        epic.target.sessionId,
        epic.target.tabId,
      ),
    );
    return null;
  }
  return caption;
}

function freshCaptionForBurst(burst: PipBurst): PipCaption | null {
  const caption = captionsByTab.get(
    captionTabKey(burst.epicId, burst.hostId, burst.sessionId, burst.tabId),
  );
  if (caption === undefined || caption.burstId !== burst.burstId) return null;
  if (captionFreshness(caption, nowFn()) === "expired") {
    captionsByTab.delete(
      captionTabKey(burst.epicId, burst.hostId, burst.sessionId, burst.tabId),
    );
    return null;
  }
  return caption;
}

export function captionFreshness(
  caption: PipCaption,
  now: number,
): "visible" | "fading" | "expired" {
  const elapsed = now - caption.arrivedAt;
  if (elapsed >= PIP_CAPTION_HOLD_MS + PIP_CAPTION_FADE_MS) return "expired";
  if (elapsed >= PIP_CAPTION_HOLD_MS) return "fading";
  return "visible";
}

function dropCaptionsForBurst(burstId: string): void {
  for (const [key, caption] of captionsByTab) {
    if (caption.burstId === burstId) captionsByTab.delete(key);
  }
}

function captionTabKey(
  epicId: string,
  hostId: string,
  sessionId: string,
  tabId: string,
): string {
  return `${epicId}\u001f${hostId}\u001f${sessionId}\u001f${tabId}`;
}

function toTarget(burst: PipTarget): PipTarget {
  return {
    hostId: burst.hostId,
    sessionId: burst.sessionId,
    tabId: burst.tabId,
    burstId: burst.burstId,
    chatId: burst.chatId,
    startedAt: burst.startedAt,
  };
}

function hostHealthFor(epicId: string, hostId: string): PipStreamHealth {
  const lifecycle = hostLifecycles.get(hostLifecycleKey(epicId, hostId));
  if (lifecycle === undefined) return "live";
  if (lifecycle === "live" || lifecycle === "connecting") return "live";
  return "disconnected";
}

function scheduleLinger(epicId: string): void {
  if (lingerTimers.has(epicId)) return;
  const epic = epics.get(epicId);
  if (epic === undefined || epic.lingerEndsAt === null) return;
  const delay = Math.max(0, epic.lingerEndsAt - nowFn());
  lingerTimers.set(
    epicId,
    startPipTimer(delay, () => {
      lingerTimers.delete(epicId);
      recomputeEpic(epicId);
    }),
  );
}

function clearLinger(epicId: string): void {
  const timer = lingerTimers.get(epicId);
  if (timer === undefined) return;
  timer.cancel();
  lingerTimers.delete(epicId);
}

function scheduleDwell(epicId: string, delay: number): void {
  if (dwellTimers.has(epicId)) return;
  dwellTimers.set(
    epicId,
    startPipTimer(delay, () => {
      dwellTimers.delete(epicId);
      recomputeEpic(epicId);
    }),
  );
}

function clearDwell(epicId: string): void {
  const timer = dwellTimers.get(epicId);
  if (timer === undefined) return;
  timer.cancel();
  dwellTimers.delete(epicId);
}

function startPipTimer(delay: number, onFire: () => void): PipTimerHandle {
  const id = setTimeout(onFire, delay);
  return {
    cancel: () => {
      clearTimeout(id);
    },
  };
}

function emit(): void {
  for (const epicId of epics.keys()) {
    cacheSnapshot(epicId);
  }
  listeners.forEach((listener) => {
    listener();
  });
}

subscribeVisibleBrowserTiles(() => {
  applyPipVisibilityChanged();
});
