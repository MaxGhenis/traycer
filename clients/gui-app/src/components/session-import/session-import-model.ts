import type { GuiHarnessId } from "@traycer/protocol/host/index";
import type {
  SessionImportCandidate,
  SessionImportFailureReason,
  SessionImportGroup,
  SessionImportGroupLocation,
  SessionImportSelection,
} from "@traycer/protocol/host/session-import/candidate";
import type { SessionImportScanTotals } from "@traycer/protocol/host/session-import/scan";
import type { SessionImportOutcome } from "@traycer/protocol/host/session-import/run";
import type { SessionImportProviderFailure } from "@traycer-clients/shared/host-transport/session-import-scan-client";
import {
  guiHarnessIdToProviderId,
  providerDisplayName,
} from "@/lib/provider-ordering";

/**
 * The wizard's whole state model, kept pure and away from the stream plumbing
 * and the markup.
 *
 * Two things make this worth its own module. Groups ARRIVE - the scan streams
 * one repo folder at a time - so "everything is pre-selected" is not a thing
 * the component can compute once from a finished list; it is a rule the
 * reducer applies to each group as it lands, without disturbing the choices
 * the user has already made about the groups that landed before it. And the
 * rendered shape (a folder header with per-provider counts and a tri-state
 * checkbox over rows that may be filtered out from under it) is a projection
 * of that state, not a copy of it.
 */

/** `(harness, nativeSessionId)` is the import's identity everywhere. */
export function sessionImportSelectionKey(
  harness: GuiHarnessId,
  nativeSessionId: string,
): string {
  return `${harness}:${nativeSessionId}`;
}

export function sessionImportGroupKey(
  location: SessionImportGroupLocation,
): string {
  return `${location.kind}:${location.path}`;
}

export type SessionImportProviderFilter = GuiHarnessId | "all";

export type SessionImportScanPhase = "scanning" | "complete" | "failed";

export interface SessionImportWizardState {
  readonly phase: SessionImportScanPhase;
  /** Groups in arrival order; the scan already orders them usefully. */
  readonly groups: ReadonlyArray<SessionImportGroup>;
  readonly providerFailures: ReadonlyArray<SessionImportProviderFailure>;
  readonly totals: SessionImportScanTotals | null;
  /** Non-null only when the scan itself fell over. */
  readonly scanErrorDetail: string | null;
  readonly selected: ReadonlySet<string>;
  readonly expandedGroups: ReadonlySet<string>;
  readonly query: string;
  readonly providerFilter: SessionImportProviderFilter;
}

export const SESSION_IMPORT_INITIAL_STATE: SessionImportWizardState = {
  phase: "scanning",
  groups: [],
  providerFailures: [],
  totals: null,
  scanErrorDetail: null,
  selected: new Set(),
  expandedGroups: new Set(),
  query: "",
  providerFilter: "all",
};

export type SessionImportWizardAction =
  | { readonly kind: "scanRestarted" }
  | { readonly kind: "scanGroupArrived"; readonly group: SessionImportGroup }
  | {
      readonly kind: "scanProviderFailed";
      readonly failure: SessionImportProviderFailure;
    }
  | {
      readonly kind: "scanCompleted";
      readonly totals: SessionImportScanTotals;
    }
  | { readonly kind: "scanFailed"; readonly detail: string }
  | { readonly kind: "sessionToggled"; readonly selectionKey: string }
  | {
      readonly kind: "groupSelectionSet";
      readonly groupKey: string;
      readonly selected: boolean;
    }
  | { readonly kind: "groupExpansionToggled"; readonly groupKey: string }
  | {
      readonly kind: "visibleSelectionSet";
      readonly selectionKeys: ReadonlyArray<string>;
      readonly selected: boolean;
    }
  | { readonly kind: "queryChanged"; readonly query: string }
  | {
      readonly kind: "providerFilterChanged";
      readonly providerFilter: SessionImportProviderFilter;
    };

export function isImportable(candidate: SessionImportCandidate): boolean {
  return candidate.state.kind === "importable";
}

export function sessionImportWizardReducer(
  state: SessionImportWizardState,
  action: SessionImportWizardAction,
): SessionImportWizardState {
  switch (action.kind) {
    case "scanRestarted": {
      // Keep the filters the user typed; the results below them are replaced.
      return {
        ...SESSION_IMPORT_INITIAL_STATE,
        query: state.query,
        providerFilter: state.providerFilter,
      };
    }
    case "scanGroupArrived": {
      const key = sessionImportGroupKey(action.group.location);
      if (
        state.groups.some(
          (group) => sessionImportGroupKey(group.location) === key,
        )
      ) {
        return state;
      }
      // Everything importable arrives pre-selected, missing folders included
      // (spec §5): those still import, just without a workspace.
      const selected = new Set(state.selected);
      for (const candidate of action.group.sessions) {
        if (!isImportable(candidate)) continue;
        selected.add(
          sessionImportSelectionKey(candidate.harness, candidate.nativeSessionId),
        );
      }
      return {
        ...state,
        groups: [...state.groups, action.group],
        selected,
      };
    }
    case "scanProviderFailed": {
      return {
        ...state,
        providerFailures: [...state.providerFailures, action.failure],
      };
    }
    case "scanCompleted": {
      return { ...state, phase: "complete", totals: action.totals };
    }
    case "scanFailed": {
      // A drop after the terminal frame is not a failure - the results the
      // user is looking at are complete and still true.
      if (state.phase === "complete") return state;
      return { ...state, phase: "failed", scanErrorDetail: action.detail };
    }
    case "sessionToggled": {
      const selected = new Set(state.selected);
      if (selected.has(action.selectionKey)) {
        selected.delete(action.selectionKey);
      } else {
        selected.add(action.selectionKey);
      }
      return { ...state, selected };
    }
    case "groupSelectionSet": {
      const group = state.groups.find(
        (candidate) =>
          sessionImportGroupKey(candidate.location) === action.groupKey,
      );
      if (group === undefined) return state;
      const selected = new Set(state.selected);
      for (const candidate of group.sessions) {
        if (!isImportable(candidate)) continue;
        const key = sessionImportSelectionKey(
          candidate.harness,
          candidate.nativeSessionId,
        );
        if (action.selected) selected.add(key);
        else selected.delete(key);
      }
      return { ...state, selected };
    }
    case "groupExpansionToggled": {
      const expandedGroups = new Set(state.expandedGroups);
      if (expandedGroups.has(action.groupKey)) {
        expandedGroups.delete(action.groupKey);
      } else {
        expandedGroups.add(action.groupKey);
      }
      return { ...state, expandedGroups };
    }
    case "visibleSelectionSet": {
      const selected = new Set(state.selected);
      for (const key of action.selectionKeys) {
        if (action.selected) selected.add(key);
        else selected.delete(key);
      }
      return { ...state, selected };
    }
    case "queryChanged": {
      return { ...state, query: action.query };
    }
    case "providerFilterChanged": {
      return { ...state, providerFilter: action.providerFilter };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

export interface SessionImportRowView {
  readonly selectionKey: string;
  readonly candidate: SessionImportCandidate;
  readonly title: string;
  readonly selected: boolean;
  readonly selectable: boolean;
  /** Short reason a row is not selectable, e.g. "In Traycer". */
  readonly unavailableLabel: string | null;
  /** The long form, for the row's tooltip. */
  readonly unavailableDetail: string | null;
}

export type SessionImportGroupSelectionState = "none" | "partial" | "all";

export interface SessionImportProviderCount {
  readonly harness: GuiHarnessId;
  readonly count: number;
}

export interface SessionImportGroupView {
  readonly groupKey: string;
  readonly name: string;
  readonly path: string;
  readonly missingFolder: boolean;
  readonly expanded: boolean;
  readonly providerCounts: ReadonlyArray<SessionImportProviderCount>;
  readonly rows: ReadonlyArray<SessionImportRowView>;
  readonly selectableCount: number;
  readonly selectedCount: number;
  readonly selectionState: SessionImportGroupSelectionState;
}

export interface SessionImportWizardView {
  readonly groups: ReadonlyArray<SessionImportGroupView>;
  /** Every session the scan has produced, before search / provider filter. */
  readonly totalSessions: number;
  /** How many survive the current filters. */
  readonly matchedSessions: number;
  /** Everything ticked, filtered-out rows included - that is what submits. */
  readonly selectedCount: number;
  readonly filtered: boolean;
  /** Ticked rows currently on screen, for the Select all / Clear pair. */
  readonly visibleSelectionKeys: ReadonlyArray<string>;
}

const UNTITLED_SESSION = "Untitled session";
const FIRST_PROMPT_PREVIEW_LENGTH = 140;

/** Native title first, then the opening prompt, then a neutral placeholder. */
export function candidateDisplayTitle(
  candidate: SessionImportCandidate,
): string {
  const title = candidate.title?.trim() ?? "";
  if (title.length > 0) return title;
  const prompt = candidate.firstPrompt?.replace(/\s+/g, " ").trim() ?? "";
  if (prompt.length === 0) return UNTITLED_SESSION;
  return prompt.length > FIRST_PROMPT_PREVIEW_LENGTH
    ? `${prompt.slice(0, FIRST_PROMPT_PREVIEW_LENGTH)}…`
    : prompt;
}

/** "Claude Code" / "Codex" - what the user calls the CLI they ran. */
export function harnessDisplayName(harness: GuiHarnessId): string {
  const providerId = guiHarnessIdToProviderId(harness);
  return providerId === null ? harness : providerDisplayName(providerId);
}

/** Last path segment, on either separator; the full path stays on the row. */
export function folderDisplayName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  const last = parts[parts.length - 1] ?? "";
  return last.length > 0 ? last : path;
}

const FAILURE_REASON_LABELS: Record<SessionImportFailureReason, string> = {
  source_unreadable: "Could not be read",
  source_empty: "Nothing to import",
  workspace_bind_failed: "No workspace could be resolved",
  creation_failed: "Task could not be created",
  internal_error: "Unexpected error",
};

export function sessionImportFailureLabel(
  reason: SessionImportFailureReason,
): string {
  return FAILURE_REASON_LABELS[reason];
}

function rowView(
  candidate: SessionImportCandidate,
  selected: ReadonlySet<string>,
): SessionImportRowView {
  const selectionKey = sessionImportSelectionKey(
    candidate.harness,
    candidate.nativeSessionId,
  );
  const title = candidateDisplayTitle(candidate);
  const state = candidate.state;
  if (state.kind === "already_in_traycer") {
    return {
      selectionKey,
      candidate,
      title,
      selected: false,
      selectable: false,
      unavailableLabel: "In Traycer",
      unavailableDetail: "Already imported - open it from your task list.",
    };
  }
  if (state.kind === "unreadable") {
    return {
      selectionKey,
      candidate,
      title,
      selected: false,
      selectable: false,
      unavailableLabel: "Unreadable",
      unavailableDetail: `${sessionImportFailureLabel(state.reason)}: ${state.detail}`,
    };
  }
  return {
    selectionKey,
    candidate,
    title,
    selected: selected.has(selectionKey),
    selectable: true,
    unavailableLabel: null,
    unavailableDetail: null,
  };
}

function matchesQuery(
  candidate: SessionImportCandidate,
  path: string,
  needle: string,
): boolean {
  if (needle.length === 0) return true;
  return (
    candidateDisplayTitle(candidate).toLowerCase().includes(needle) ||
    path.toLowerCase().includes(needle)
  );
}

function providerCountsFor(
  sessions: ReadonlyArray<SessionImportCandidate>,
): ReadonlyArray<SessionImportProviderCount> {
  const counts = new Map<GuiHarnessId, number>();
  for (const candidate of sessions) {
    counts.set(candidate.harness, (counts.get(candidate.harness) ?? 0) + 1);
  }
  return [...counts].map(([harness, count]) => ({ harness, count }));
}

function selectionStateFor(
  selectableCount: number,
  selectedCount: number,
): SessionImportGroupSelectionState {
  if (selectableCount === 0 || selectedCount === 0) return "none";
  return selectedCount === selectableCount ? "all" : "partial";
}

/**
 * Projects state into what the list renders.
 *
 * The counts on a group header describe the WHOLE group, not the filtered
 * slice: the header's checkbox toggles the whole group (that is the only way
 * to clear a folder without expanding it), so a header claiming "2" while
 * ticking 40 would be lying about its own control.
 */
export function buildSessionImportView(
  state: SessionImportWizardState,
): SessionImportWizardView {
  const needle = state.query.trim().toLowerCase();
  const groups: SessionImportGroupView[] = [];
  const visibleSelectionKeys: string[] = [];
  let totalSessions = 0;
  let matchedSessions = 0;

  for (const group of state.groups) {
    const path = group.location.path;
    totalSessions += group.sessions.length;

    const matching = group.sessions.filter(
      (candidate) =>
        (state.providerFilter === "all" ||
          candidate.harness === state.providerFilter) &&
        matchesQuery(candidate, path, needle),
    );
    matchedSessions += matching.length;
    if (matching.length === 0) continue;

    const rows = matching.map((candidate) => rowView(candidate, state.selected));
    for (const row of rows) {
      if (row.selectable) visibleSelectionKeys.push(row.selectionKey);
    }

    const selectable = group.sessions.filter(isImportable);
    const selectedCount = selectable.filter((candidate) =>
      state.selected.has(
        sessionImportSelectionKey(candidate.harness, candidate.nativeSessionId),
      ),
    ).length;

    groups.push({
      groupKey: sessionImportGroupKey(group.location),
      name: folderDisplayName(path),
      path,
      missingFolder: group.location.kind === "missing_folder",
      expanded: state.expandedGroups.has(
        sessionImportGroupKey(group.location),
      ),
      providerCounts: providerCountsFor(group.sessions),
      rows,
      selectableCount: selectable.length,
      selectedCount,
      selectionState: selectionStateFor(selectable.length, selectedCount),
    });
  }

  return {
    groups,
    totalSessions,
    matchedSessions,
    selectedCount: state.selected.size,
    filtered: needle.length > 0 || state.providerFilter !== "all",
    visibleSelectionKeys,
  };
}

export interface SessionImportFailureEntryView {
  readonly selectionKey: string;
  readonly title: string;
  readonly detail: string;
}

export interface SessionImportFailureGroupView {
  readonly reason: SessionImportFailureReason;
  readonly label: string;
  readonly entries: ReadonlyArray<SessionImportFailureEntryView>;
}

/**
 * Groups a finished run's failures by cause, because that is how a person acts
 * on them: "four sessions could not be read" is one problem with four
 * instances, not four problems. The closed reason enum is what makes the
 * grouping meaningful; `detail` is the per-session half and stays on the row.
 */
export interface SessionImportOutcomeEntry {
  readonly selectionKey: string;
  readonly nativeSessionId: string;
  readonly outcome: SessionImportOutcome;
}

export function groupSessionImportFailures(
  outcomes: Iterable<SessionImportOutcomeEntry>,
  titles: ReadonlyMap<string, string>,
): ReadonlyArray<SessionImportFailureGroupView> {
  const byReason = new Map<
    SessionImportFailureReason,
    SessionImportFailureEntryView[]
  >();
  for (const entry of outcomes) {
    const outcome = entry.outcome;
    if (outcome.kind !== "failed") continue;
    const bucket = byReason.get(outcome.reason) ?? [];
    bucket.push({
      selectionKey: entry.selectionKey,
      title: titles.get(entry.selectionKey) ?? entry.nativeSessionId,
      detail: outcome.detail,
    });
    byReason.set(outcome.reason, bucket);
  }
  return [...byReason].map(([reason, entries]) => ({
    reason,
    label: sessionImportFailureLabel(reason),
    entries,
  }));
}

/**
 * The wizard submits every ticked session, in the order the scan produced
 * them, plus the display titles the progress and summary views need - the
 * `progress` frame names a session by id only, and nothing else in the client
 * can turn that back into something a person recognises.
 */
export interface SessionImportSubmission {
  readonly selections: ReadonlyArray<SessionImportSelection>;
  readonly titles: ReadonlyMap<string, string>;
}

export function buildSessionImportSubmission(
  state: SessionImportWizardState,
): SessionImportSubmission {
  const selections: SessionImportSelection[] = [];
  const titles = new Map<string, string>();
  for (const group of state.groups) {
    for (const candidate of group.sessions) {
      const key = sessionImportSelectionKey(
        candidate.harness,
        candidate.nativeSessionId,
      );
      if (!state.selected.has(key)) continue;
      selections.push({
        harness: candidate.harness,
        nativeSessionId: candidate.nativeSessionId,
      });
      titles.set(key, candidateDisplayTitle(candidate));
    }
  }
  return { selections, titles };
}
