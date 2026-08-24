import { useEffect, useMemo } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import type { GuiHarnessId } from "@traycer/protocol/host/index";
import type {
  SessionImportGroup,
  SessionImportSelection,
} from "@traycer/protocol/host/session-import/candidate";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Analytics, AnalyticsEvent } from "@/lib/analytics";
import { openEpicFromList } from "@/lib/commands/actions/open-epic-from-list";
import {
  buildSessionImportSubmission,
  buildSessionImportView,
  harnessDisplayName,
  sessionImportSelectionKey,
  type SessionImportProviderFilter,
} from "@/components/session-import/session-import-model";
import { SessionImportGroupItem } from "@/components/session-import/session-import-group";
import { SessionImportProgress } from "@/components/session-import/session-import-progress";
import { useSessionImportScan } from "@/components/session-import/use-session-import-scan";
import { startSessionImportRun } from "@/components/session-import/session-import-run-handle";
import {
  sessionImportTone,
  type SessionImportSurface,
} from "@/components/session-import/session-import-tone";
import { useSessionImportRunStore } from "@/stores/session-import/session-import-run-store";

export interface SessionImportSecondaryAction {
  readonly label: string;
  readonly onSelect: () => void;
}

/**
 * The one import surface, used by the onboarding act and the Settings dialog
 * alike (spec D3). It scans while it is open, never before (D13), and hands the
 * user's selection to the app-wide run controller rather than owning the run
 * itself - which is what lets it be closed mid-import.
 */
export function SessionImportWizard(props: {
  readonly surface: SessionImportSurface;
  /** Called once a run has been submitted, so the caller can move on. */
  readonly onImportStarted: () => void;
  readonly secondaryAction: SessionImportSecondaryAction | null;
}) {
  const { surface, onImportStarted, secondaryAction } = props;
  const tone = sessionImportTone(surface);
  const runStatus = useSessionImportRunStore((state) => state.status);
  const runIdle = runStatus === "idle";

  // Opening the wizard retires a FINISHED run's summary, so a second visit
  // scans afresh instead of re-reading last time's result. Mount-only on
  // purpose: a run that finishes while this is open still shows its summary,
  // because that summary is what the user is waiting for.
  useEffect(() => {
    const run = useSessionImportRunStore.getState();
    if (run.status === "complete" || run.status === "error") run.reset();
  }, []);

  const { state, dispatch } = useSessionImportScan(runIdle);
  const view = useMemo(() => buildSessionImportView(state), [state]);

  const navigate = useNavigate();
  // `useRouter` is stable; the live pathname is read off `router.state` at open
  // time rather than subscribed to, so routing does not re-render a live scan.
  const router = useRouter();

  const openImportedEpic = (epicId: string, title: string): void => {
    // The dialog surface is modal, so it has to let go of the screen before the
    // task it is sending the user to opens behind it. Onboarding passes no
    // secondary action and simply routes.
    if (secondaryAction !== null) secondaryAction.onSelect();
    openEpicFromList(navigate, epicId, router.state.location.pathname, {
      title,
      source: "direct_ui",
    });
  };

  const providerOptions = useMemo(() => {
    const harnesses = new Set<GuiHarnessId>();
    for (const group of state.groups) {
      for (const candidate of group.sessions) harnesses.add(candidate.harness);
    }
    // The filter survives a rescan, so the harness it names has to stay on
    // offer even when this scan found nothing for it: its lit chip is the only
    // thing on screen that explains why every row disappeared.
    if (state.providerFilter !== "all") harnesses.add(state.providerFilter);
    return [...harnesses];
  }, [state.groups, state.providerFilter]);

  if (!runIdle) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <SessionImportProgress tone={tone} />
        {secondaryAction !== null ? (
          <div className="flex shrink-0 justify-end pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={tone.secondaryButton}
              onClick={secondaryAction.onSelect}
            >
              {secondaryAction.label}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const submit = (): void => {
    const submission = buildSessionImportSubmission(state);
    if (submission.selections.length === 0) return;
    Analytics.getInstance().track(AnalyticsEvent.SessionImportStarted, {
      surface,
      session_count: submission.selections.length,
      group_count: submittedGroupCount(state.groups, submission.selections),
    });
    startSessionImportRun(submission);
    onImportStarted();
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2",
              tone.faint,
            )}
          />
          <Input
            type="search"
            value={state.query}
            aria-label="Search sessions"
            placeholder="Search sessions or folders"
            data-testid="session-import-search"
            onChange={(event) =>
              dispatch({ kind: "queryChanged", query: event.target.value })
            }
            className={cn("h-8 pl-8 text-ui-sm", tone.input)}
          />
        </div>
        {/*
         * One harness needs no filter - but an ACTIVE filter always needs its
         * row, or a rescan down to a single harness would leave the user
         * looking at an empty list with no control that can clear it.
         */}
        {providerOptions.length > 1 || state.providerFilter !== "all" ? (
          <div
            role="radiogroup"
            aria-label="Filter by provider"
            className={cn(
              "flex shrink-0 items-center gap-0.5 rounded-md border p-0.5",
              tone.border,
            )}
          >
            <ProviderFilterOption
              label="All"
              value="all"
              active={state.providerFilter === "all"}
              tone={tone}
              onSelect={(value) =>
                dispatch({
                  kind: "providerFilterChanged",
                  providerFilter: value,
                })
              }
            />
            {providerOptions.map((harness) => (
              <ProviderFilterOption
                key={harness}
                label={harnessDisplayName(harness)}
                value={harness}
                active={state.providerFilter === harness}
                tone={tone}
                onSelect={(value) =>
                  dispatch({
                    kind: "providerFilterChanged",
                    providerFilter: value,
                  })
                }
              />
            ))}
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("text-ui-xs", tone.secondaryButton)}
            disabled={view.visibleSelectionKeys.length === 0}
            onClick={() =>
              dispatch({
                kind: "visibleSelectionSet",
                selectionKeys: view.visibleSelectionKeys,
                selected: true,
              })
            }
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("text-ui-xs", tone.secondaryButton)}
            disabled={view.visibleSelectionKeys.length === 0}
            onClick={() =>
              dispatch({
                kind: "visibleSelectionSet",
                selectionKeys: view.visibleSelectionKeys,
                selected: false,
              })
            }
          >
            Clear
          </Button>
        </div>
      </div>

      {state.scanErrorDetail !== null ? (
        <p
          data-testid="session-import-scan-error"
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1.5 text-ui-xs",
            tone.warningSurface,
          )}
        >
          The scan stopped before it finished. {state.scanErrorDetail}
        </p>
      ) : null}

      {state.providerFailures.map((failure) => (
        <p
          key={failure.harness}
          data-testid="session-import-provider-failure"
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1.5 text-ui-xs",
            tone.warningSurface,
          )}
        >
          {harnessDisplayName(failure.harness)} sessions could not be read.{" "}
          {failure.detail}
        </p>
      ))}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
        {view.groups.map((group) => (
          <SessionImportGroupItem
            key={group.groupKey}
            group={group}
            tone={tone}
            onToggleExpanded={(groupKey) =>
              dispatch({ kind: "groupExpansionToggled", groupKey })
            }
            onSetGroupSelection={(groupKey, selected) =>
              dispatch({ kind: "groupSelectionSet", groupKey, selected })
            }
            onToggleSession={(selectionKey) =>
              dispatch({ kind: "sessionToggled", selectionKey })
            }
            onOpenEpic={openImportedEpic}
          />
        ))}
        {state.phase === "scanning" ? (
          <div className="flex shrink-0 items-center gap-2 px-1 py-2">
            <AgentSpinningDots
              className={tone.faint}
              testId="session-import-scan-spinner"
              variant={undefined}
            />
            <span className={cn("text-ui-xs", tone.faint)}>
              Looking for sessions on this machine…
            </span>
          </div>
        ) : null}
        {state.phase !== "scanning" && view.groups.length === 0 ? (
          <p
            data-testid="session-import-empty"
            className={cn("px-1 py-6 text-center text-ui-sm", tone.muted)}
          >
            {emptyMessage(state.phase === "failed", view.totalSessions > 0)}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <span
          data-testid="session-import-selection-count"
          className={cn("text-ui-xs", tone.faint)}
        >
          {view.selectedCount} of {view.selectableSessions} selected
        </span>
        <div className="flex items-center gap-2">
          {secondaryAction !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={tone.secondaryButton}
              onClick={secondaryAction.onSelect}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            data-testid="session-import-submit"
            disabled={view.selectedCount === 0}
            className={tone.primaryButton}
            onClick={submit}
          >
            Import {view.selectedCount}{" "}
            {view.selectedCount === 1 ? "session" : "sessions"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * How many repos the submission actually brings over.
 *
 * Every other number on the event describes the import, so this one has to as
 * well. `state.groups.length` counts the SCAN instead - folders the user
 * cleared outright, and folders that only ever held unreadable or
 * already-imported rows - which would read as "imported 3 sessions across 40
 * repos". The selections are the source of truth rather than `state.selected`,
 * so this cannot drift from whatever the submission decided to send.
 */
function submittedGroupCount(
  groups: ReadonlyArray<SessionImportGroup>,
  selections: ReadonlyArray<SessionImportSelection>,
): number {
  const submitted = new Set(
    selections.map((selection) =>
      sessionImportSelectionKey(selection.harness, selection.nativeSessionId),
    ),
  );
  return groups.filter((group) =>
    group.sessions.some((candidate) =>
      submitted.has(
        sessionImportSelectionKey(candidate.harness, candidate.nativeSessionId),
      ),
    ),
  ).length;
}

function emptyMessage(failed: boolean, filteredOut: boolean): string {
  if (failed) return "Traycer could not read your session folders.";
  if (filteredOut) return "No sessions match your search.";
  return "No Claude Code or Codex sessions found on this machine.";
}

function ProviderFilterOption(props: {
  readonly label: string;
  readonly value: SessionImportProviderFilter;
  readonly active: boolean;
  readonly tone: { readonly filterActive: string; readonly filterIdle: string };
  readonly onSelect: (value: SessionImportProviderFilter) => void;
}) {
  const { label, value, active, tone, onSelect } = props;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-testid="session-import-provider-filter"
      onClick={() => onSelect(value)}
      className={cn(
        "rounded px-2 py-1 text-ui-xs transition-colors",
        active ? tone.filterActive : tone.filterIdle,
      )}
    >
      {label}
    </button>
  );
}
