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
  | "hidden"
  | "live"
  | "finished"
  | "chip"
  | "dismissed-burst";

export type PipBurstOutcome = BrowserBurstOutcome;

export type PipStreamHealth = "live" | "stale" | "disconnected";

export type PipHostLifecycle =
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "failed";

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

export interface PipSnapshot {
  readonly phase: PipPhase;
  readonly target: PipTarget | null;
  readonly outcome: PipBurstOutcome | null;
  readonly streamHealth: PipStreamHealth;
  readonly moreLiveCount: number;
  readonly openTileEnabled: boolean;
  readonly pinned: boolean;
  readonly lingerActive: boolean;
  readonly caption: PipCaption | null;
}

export const HIDDEN_PIP_SNAPSHOT: PipSnapshot = {
  phase: "hidden",
  target: null,
  outcome: null,
  streamHealth: "live",
  moreLiveCount: 0,
  openTileEnabled: true,
  pinned: false,
  lingerActive: false,
  caption: null,
};

interface PipBurst extends PipTarget {
  readonly epicId: string;
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
  hostLifecycle: PipHostLifecycle;
}

const epics = new Map<string, EpicPipState>();
const liveBursts = new Map<string, PipBurst>();
const finishedBursts = new Map<string, FinishedPipBurst>();
const captionsByTab = new Map<string, PipCaption>();
const lastFinishedByEpic = new Map<string, string>();
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
  const startedAt = input.startedAt ?? nowFn();
  const burst: PipBurst = {
    epicId: input.epicId,
    hostId: input.hostId,
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    chatId: input.chatId,
    startedAt,
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
  recomputeEpic(input.epicId);
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
    lastFinishedByEpic.set(input.epicId, input.burstId);
  }
  dropCaptionsForBurst(input.burstId);
  const epic = getOrCreateEpic(input.epicId);
  if (epic.pinnedBurstId === input.burstId) {
    epic.pinnedBurstId = null;
  }
  if (epic.target !== null && epic.target.burstId === input.burstId) {
    if (epic.phase === "live" || epic.phase === "dismissed-burst") {
      if (epic.phase === "live") {
        epic.phase = "finished";
        epic.outcome = input.outcome;
        epic.lingerEndsAt = nowFn() + PIP_LINGER_MS;
        epic.streamHealth = "live";
        scheduleLinger(input.epicId);
      }
    }
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
    epic.hostLifecycle = lifecycle;
    epic.streamHealth = lifecycle === "live" ? "live" : "disconnected";
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
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
  readonly cellTitle: string;
}): void {
  getOrCreateEpic(input.epicId);
  captionsByTab.set(captionTabKey(input.sessionId, input.tabId), {
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    cellTitle: input.cellTitle,
    arrivedAt: nowFn(),
  });
  emit();
}

export function applyPipStreamHealth(
  epicId: string,
  health: PipStreamHealth,
): void {
  const epic = epics.get(epicId);
  if (epic === undefined) return;
  if (epic.streamHealth === health) return;
  if (epic.hostLifecycle !== "live" && health !== "disconnected") return;
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
  readonly sessionId: string;
  readonly tabId: string;
}): void {
  const { epicId, sessionId, tabId } = input;
  const live = findLiveBurstForTab(epicId, sessionId, tabId);
  const finished = findFinishedBurstForTab(epicId, sessionId, tabId);
  const target = live ?? finished;
  if (target === undefined) return;
  removeDismissal(epicId, target.burstId);
  const epic = getOrCreateEpic(epicId);
  epic.pinnedBurstId = target.burstId;
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

export function setPipActiveHostId(hostId: string | null): void {
  if (activeHostId === hostId) return;
  activeHostId = hostId;
  for (const epicId of epics.keys()) {
    recomputeEpic(epicId);
  }
}

export function getPipSnapshot(epicId: string): PipSnapshot {
  return snapshotCache.get(epicId) ?? deriveSnapshot(epicId);
}

export function getPipDismissalsForTests(
  epicId: string,
): ReadonlySet<string> {
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
  lastFinishedByEpic.clear();
  dismissals.clear();
  snapshotCache.clear();
  hostLifecycles.clear();
  listeners.clear();
  activeHostId = null;
  nowFn = () => Date.now();
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
    epic.phase = "hidden";
    epic.lingerEndsAt = null;
    clearLinger(epicId);
    return;
  }
  if (epic.lingerEndsAt !== null && nowFn() >= epic.lingerEndsAt) {
    const next = selectFollowTarget(epic, eligible);
    if (next !== null) goLive(epicId, next);
    else goChip(epic);
    return;
  }
  scheduleLinger(epicId);
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
    epic.phase = "hidden";
    clearDwell(epicId);
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
    const lifecycle =
      hostLifecycles.get(hostLifecycleKey(epicId, burst.hostId)) ?? "live";
    epic.hostLifecycle = lifecycle;
    epic.streamHealth = hostHealthFor(epicId, burst.hostId);
  }
  clearLinger(epicId);
  clearDwell(epicId);
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
  sessionId: string,
  tabId: string,
): PipBurst | undefined {
  let found: PipBurst | undefined;
  for (const burst of liveBursts.values()) {
    if (
      burst.epicId === epicId &&
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
  sessionId: string,
  tabId: string,
): FinishedPipBurst | undefined {
  let found: FinishedPipBurst | undefined;
  for (const burst of finishedBursts.values()) {
    if (
      burst.epicId === epicId &&
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
      moreLiveCount: 0,
      openTileEnabled: epic.outcome !== "closed",
      pinned: epic.pinnedBurstId !== null,
      lingerActive: false,
      caption: null,
    };
  }
  const eligible = listEligibleLive(epicId);
  const displayedId = epic.target?.burstId;
  const moreLiveCount = eligible.filter(
    (burst) => burst.burstId !== displayedId,
  ).length;
  return {
    phase: epic.phase,
    target: epic.target,
    outcome: epic.outcome,
    streamHealth: epic.streamHealth,
    moreLiveCount,
    openTileEnabled: epic.outcome !== "closed",
    pinned: epic.pinnedBurstId !== null,
    lingerActive:
      epic.phase === "finished" &&
      epic.lingerEndsAt !== null &&
      nowFn() < epic.lingerEndsAt,
    caption: displayedCaption(epic),
  };
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
    left.moreLiveCount === right.moreLiveCount &&
    left.openTileEnabled === right.openTileEnabled &&
    left.pinned === right.pinned &&
    left.lingerActive === right.lingerActive &&
    targetsEqual(left.target, right.target) &&
    captionsEqual(left.caption, right.caption)
  );
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
    hostLifecycle: "live",
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

function displayedCaption(epic: EpicPipState): PipCaption | null {
  if (epic.phase !== "live" || epic.target === null) return null;
  const caption = captionsByTab.get(
    captionTabKey(epic.target.sessionId, epic.target.tabId),
  );
  if (caption === undefined) return null;
  if (caption.burstId !== epic.target.burstId) return null;
  return caption;
}

function dropCaptionsForBurst(burstId: string): void {
  for (const [key, caption] of captionsByTab) {
    if (caption.burstId === burstId) captionsByTab.delete(key);
  }
}

function captionTabKey(sessionId: string, tabId: string): string {
  return `${sessionId}\u001f${tabId}`;
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
  if (lifecycle === undefined || lifecycle === "live") return "live";
  return "disconnected";
}

function scheduleLinger(epicId: string): void {
  if (lingerTimers.has(epicId)) return;
  const epic = epics.get(epicId);
  if (epic === undefined || epic.lingerEndsAt === null) return;
  const delay = Math.max(0, epic.lingerEndsAt - nowFn());
  lingerTimers.set(epicId, startPipTimer(delay, () => {
    lingerTimers.delete(epicId);
    recomputeEpic(epicId);
  }));
}

function clearLinger(epicId: string): void {
  const timer = lingerTimers.get(epicId);
  if (timer === undefined) return;
  timer.cancel();
  lingerTimers.delete(epicId);
}

function scheduleDwell(epicId: string, delay: number): void {
  if (dwellTimers.has(epicId)) return;
  dwellTimers.set(epicId, startPipTimer(delay, () => {
    dwellTimers.delete(epicId);
    recomputeEpic(epicId);
  }));
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
