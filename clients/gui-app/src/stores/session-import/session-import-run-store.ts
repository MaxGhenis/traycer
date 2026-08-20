import { create } from "zustand";
import type { GuiHarnessId } from "@traycer/protocol/host/index";
import type {
  SessionImportOutcome,
  SessionImportRunCounts,
} from "@traycer/protocol/host/session-import/run";
import { sessionImportSelectionKey } from "@/components/session-import/session-import-model";

/**
 * Live state of the one import run this client is watching.
 *
 * A module-level store rather than wizard state because the run deliberately
 * outlives its wizard: the user is told to close it and carry on, and the
 * Settings entry shows the same progress from a different surface. It also
 * outlives its SOCKET, so every frame is folded idempotently - a re-subscribe
 * replays `started` and every `progress` frame already produced, and a replay
 * that double-counted would show "14 of 8 imported".
 */

export type SessionImportRunStatus =
  | "idle"
  | "starting"
  | "running"
  | "complete"
  | "error";

export interface SessionImportProgressEntry {
  readonly selectionKey: string;
  readonly harness: GuiHarnessId;
  readonly nativeSessionId: string;
  readonly outcome: SessionImportOutcome;
}

export interface SessionImportRunState {
  readonly status: SessionImportRunStatus;
  readonly runId: string | null;
  readonly total: number;
  /** Keyed so a replayed frame overwrites rather than appends. */
  readonly outcomes: ReadonlyMap<string, SessionImportProgressEntry>;
  /** Display titles captured at submit; empty when we attached mid-run. */
  readonly titles: ReadonlyMap<string, string>;
  /** The session the last frame was about - the progress line's caption. */
  readonly lastTitle: string | null;
  /** Authoritative counts, present only once the run reports `complete`. */
  readonly finalCounts: SessionImportRunCounts | null;
}

interface SessionImportRunActions {
  readonly markStarting: (titles: ReadonlyMap<string, string>) => void;
  readonly applyStarted: (input: {
    readonly runId: string;
    readonly total: number;
  }) => void;
  readonly applyProgress: (entry: SessionImportProgressEntry) => void;
  readonly applyComplete: (input: {
    readonly runId: string;
    readonly counts: SessionImportRunCounts;
  }) => void;
  readonly applyError: () => void;
  readonly reset: () => void;
}

const INITIAL_STATE: SessionImportRunState = {
  status: "idle",
  runId: null,
  total: 0,
  outcomes: new Map(),
  titles: new Map(),
  lastTitle: null,
  finalCounts: null,
};

/** Sessions the run has reported on, however they turned out. */
export function sessionImportDoneCount(state: SessionImportRunState): number {
  return state.outcomes.size;
}

export function sessionImportCountsFromOutcomes(
  outcomes: ReadonlyMap<string, SessionImportProgressEntry>,
): SessionImportRunCounts {
  let imported = 0;
  let skippedAlreadyImported = 0;
  let failed = 0;
  for (const entry of outcomes.values()) {
    if (entry.outcome.kind === "imported") imported += 1;
    else if (entry.outcome.kind === "skipped_already_imported") {
      skippedAlreadyImported += 1;
    } else failed += 1;
  }
  return { imported, skippedAlreadyImported, failed };
}

/**
 * The summary view's numbers: the run's own once it has reported them, and
 * until then what the frames seen so far add up to. Takes the two fields it
 * reads rather than the whole state so a component can call it from a `useMemo`
 * over stable slices instead of minting a fresh object inside a selector.
 */
export function sessionImportRunCounts(input: {
  readonly outcomes: ReadonlyMap<string, SessionImportProgressEntry>;
  readonly finalCounts: SessionImportRunCounts | null;
}): SessionImportRunCounts {
  return input.finalCounts ?? sessionImportCountsFromOutcomes(input.outcomes);
}

export function sessionImportIsRunning(state: SessionImportRunState): boolean {
  return state.status === "starting" || state.status === "running";
}

export const useSessionImportRunStore = create<
  SessionImportRunState & SessionImportRunActions
>((set) => ({
  ...INITIAL_STATE,
  markStarting: (titles) =>
    set({
      ...INITIAL_STATE,
      status: "starting",
      titles,
    }),
  applyStarted: ({ runId, total }) =>
    set((prev) =>
      // A different run id means this is not the run we were tracking; drop
      // the stale outcomes rather than mixing two runs' progress.
      prev.runId !== null && prev.runId !== runId
        ? { ...INITIAL_STATE, status: "running", runId, total }
        : { ...prev, status: "running", runId, total },
    ),
  applyProgress: (entry) =>
    set((prev) => {
      const outcomes = new Map(prev.outcomes);
      outcomes.set(entry.selectionKey, entry);
      return {
        ...prev,
        status: prev.status === "complete" ? prev.status : "running",
        outcomes,
        lastTitle: prev.titles.get(entry.selectionKey) ?? prev.lastTitle,
      };
    }),
  applyComplete: ({ runId, counts }) =>
    set((prev) => ({
      ...prev,
      status: "complete",
      runId,
      finalCounts: counts,
    })),
  // A drop after the run has completed is not an error - the summary the user
  // is reading is final.
  applyError: () =>
    set((prev) =>
      prev.status === "complete" || prev.status === "idle"
        ? prev
        : { ...prev, status: "error" },
    ),
  reset: () => set(INITIAL_STATE),
}));

export function progressEntryFrom(input: {
  readonly harness: GuiHarnessId;
  readonly nativeSessionId: string;
  readonly outcome: SessionImportOutcome;
}): SessionImportProgressEntry {
  return {
    selectionKey: sessionImportSelectionKey(
      input.harness,
      input.nativeSessionId,
    ),
    harness: input.harness,
    nativeSessionId: input.nativeSessionId,
    outcome: input.outcome,
  };
}
