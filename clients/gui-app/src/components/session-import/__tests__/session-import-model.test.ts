import type {
  SessionImportCandidate,
  SessionImportGroup,
  SessionImportGroupLocation,
} from "@traycer/protocol/host/session-import/candidate";
import type { SessionImportScanTotals } from "@traycer/protocol/host/session-import/scan";
import type { SessionImportOutcome } from "@traycer/protocol/host/session-import/run";
import type { SessionImportProviderFailure } from "@traycer-clients/shared/host-transport/session-import-scan-client";
import { describe, expect, it } from "vitest";
import {
  buildSessionImportSubmission,
  buildSessionImportView,
  candidateDisplayTitle,
  groupSessionImportFailures,
  sessionImportFailureLabel,
  sessionImportGroupKey,
  sessionImportSelectionKey,
  sessionImportWizardReducer,
  SESSION_IMPORT_INITIAL_STATE,
  type SessionImportOutcomeEntry,
  type SessionImportWizardAction,
  type SessionImportWizardState,
} from "@/components/session-import/session-import-model";

/**
 * Every test builds its own candidates and groups rather than sharing
 * literals, so a test that mutates a field (a title, a state) can never leak
 * into another - the reducer's whole job is to react to what arrives, and a
 * shared fixture would hide which arrival caused which effect.
 */
let candidateSequence = 0;

function candidate(
  overrides: Partial<SessionImportCandidate>,
): SessionImportCandidate {
  candidateSequence += 1;
  return {
    harness: "claude",
    nativeSessionId: `session-${candidateSequence}`,
    title: `Session ${candidateSequence}`,
    firstPrompt: null,
    createdAt: 0,
    updatedAt: 0,
    messageCount: null,
    hasSubagents: false,
    state: { kind: "importable" },
    ...overrides,
  };
}

function group(
  location: SessionImportGroupLocation,
  sessions: ReadonlyArray<SessionImportCandidate>,
): SessionImportGroup {
  return { location, sessions: [...sessions] };
}

function folderLocation(path: string): SessionImportGroupLocation {
  return { kind: "folder", path, workspaceId: null };
}

function applyActions(
  actions: ReadonlyArray<SessionImportWizardAction>,
): SessionImportWizardState {
  return actions.reduce(
    sessionImportWizardReducer,
    SESSION_IMPORT_INITIAL_STATE,
  );
}

describe("sessionImportWizardReducer - selection defaults as groups stream in", () => {
  it("pre-selects every importable candidate in an arriving group, skipping already-imported and unreadable ones", () => {
    const importableA = candidate({ nativeSessionId: "s1" });
    const importableB = candidate({ nativeSessionId: "s2" });
    const alreadyImported = candidate({
      nativeSessionId: "s3",
      state: { kind: "already_in_traycer", epicId: "epic-1", chatId: "chat-1" },
    });
    const unreadable = candidate({
      nativeSessionId: "s4",
      state: {
        kind: "unreadable",
        reason: "source_unreadable",
        detail: "corrupt",
      },
    });
    const arrivingGroup = group(folderLocation("/repo/a"), [
      importableA,
      importableB,
      alreadyImported,
      unreadable,
    ]);

    const state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
    ]);

    expect(state.selected).toEqual(
      new Set([
        sessionImportSelectionKey("claude", "s1"),
        sessionImportSelectionKey("claude", "s2"),
      ]),
    );
  });

  it("pre-selects importable candidates in a missing_folder group too", () => {
    const orphaned = candidate({ nativeSessionId: "s1" });
    const arrivingGroup = group(
      { kind: "missing_folder", path: "/gone" },
      [orphaned],
    );

    const state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
    ]);

    expect(state.selected.has(sessionImportSelectionKey("claude", "s1"))).toBe(
      true,
    );
  });

  it("keeps a user's deselection of a group-A candidate when group B arrives", () => {
    const a1 = candidate({ nativeSessionId: "a1" });
    const a2 = candidate({ nativeSessionId: "a2" });
    const groupA = group(folderLocation("/repo/a"), [a1, a2]);
    const b1 = candidate({ nativeSessionId: "b1" });
    const groupB = group(folderLocation("/repo/b"), [b1]);
    const keyA1 = sessionImportSelectionKey("claude", "a1");

    const state = applyActions([
      { kind: "scanGroupArrived", group: groupA },
      { kind: "sessionToggled", selectionKey: keyA1 },
      { kind: "scanGroupArrived", group: groupB },
    ]);

    expect(state.selected.has(keyA1)).toBe(false);
    expect(state.selected.has(sessionImportSelectionKey("claude", "a2"))).toBe(
      true,
    );
    expect(state.selected.has(sessionImportSelectionKey("claude", "b1"))).toBe(
      true,
    );
  });

  it("is a no-op when a group with the same location kind + path arrives twice", () => {
    const first = candidate({ nativeSessionId: "s1" });
    const firstArrival = group(folderLocation("/repo/a"), [first]);
    const stateAfterFirst = sessionImportWizardReducer(
      SESSION_IMPORT_INITIAL_STATE,
      { kind: "scanGroupArrived", group: firstArrival },
    );

    // A distinct object, but the same location kind + path - a re-broadcast
    // of a group the reducer has already applied.
    const secondArrival = group(folderLocation("/repo/a"), [
      candidate({ nativeSessionId: "s1" }),
    ]);
    const stateAfterSecond = sessionImportWizardReducer(stateAfterFirst, {
      kind: "scanGroupArrived",
      group: secondArrival,
    });

    expect(stateAfterSecond).toBe(stateAfterFirst);
    expect(stateAfterSecond.groups).toHaveLength(1);
  });
});

describe("buildSessionImportView - disabled rows", () => {
  it("projects an already_in_traycer row as unselectable with an 'In Traycer' label", () => {
    const alreadyImported = candidate({
      nativeSessionId: "s1",
      state: { kind: "already_in_traycer", epicId: "epic-1", chatId: "chat-1" },
    });
    const state = applyActions([
      {
        kind: "scanGroupArrived",
        group: group(folderLocation("/repo/a"), [alreadyImported]),
      },
    ]);

    const view = buildSessionImportView(state);
    expect(view.groups[0]?.rows).toHaveLength(1);
    const row = view.groups[0]?.rows[0];

    expect(row.selectable).toBe(false);
    expect(row.selected).toBe(false);
    expect(row.unavailableLabel).toBe("In Traycer");
  });

  it("projects an unreadable row's unavailableDetail with both the reason label and the raw detail", () => {
    const unreadable = candidate({
      nativeSessionId: "s1",
      state: {
        kind: "unreadable",
        reason: "source_unreadable",
        detail: "database is locked",
      },
    });
    const state = applyActions([
      {
        kind: "scanGroupArrived",
        group: group(folderLocation("/repo/a"), [unreadable]),
      },
    ]);

    const view = buildSessionImportView(state);
    expect(view.groups[0]?.rows).toHaveLength(1);
    const row = view.groups[0]?.rows[0];

    expect(row.selectable).toBe(false);
    expect(row.unavailableDetail).toContain(
      sessionImportFailureLabel("source_unreadable"),
    );
    expect(row.unavailableDetail).toContain("database is locked");
  });
});

describe("buildSessionImportView - group header counts and tri-state", () => {
  it("keeps a group header's selectableCount/selectedCount over the whole group, not the filtered slice", () => {
    const matching = candidate({
      nativeSessionId: "match",
      title: "Fix login bug",
    });
    const other = candidate({
      nativeSessionId: "other",
      title: "Refactor styles",
    });
    const arrivingGroup = group(folderLocation("/repo/a"), [
      matching,
      other,
    ]);

    const state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
      { kind: "queryChanged", query: "login" },
    ]);
    const view = buildSessionImportView(state);

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]?.rows).toHaveLength(1);
    expect(view.groups[0]?.selectableCount).toBe(2);
    expect(view.groups[0]?.selectedCount).toBe(2);
  });

  it("computes selectionState as all, then partial, then none as candidates are untoggled, and none for a group with zero importable candidates", () => {
    const s1 = candidate({ nativeSessionId: "s1" });
    const s2 = candidate({ nativeSessionId: "s2" });
    const groupA = group(folderLocation("/repo/a"), [s1, s2]);
    const onlyUnavailable = candidate({
      nativeSessionId: "s3",
      state: { kind: "already_in_traycer", epicId: "e", chatId: "c" },
    });
    const groupB = group(folderLocation("/repo/b"), [onlyUnavailable]);

    let state = applyActions([
      { kind: "scanGroupArrived", group: groupA },
      { kind: "scanGroupArrived", group: groupB },
    ]);
    let view = buildSessionImportView(state);
    expect(view.groups.find((g) => g.path === "/repo/a")?.selectionState).toBe(
      "all",
    );
    expect(view.groups.find((g) => g.path === "/repo/b")?.selectionState).toBe(
      "none",
    );

    state = sessionImportWizardReducer(state, {
      kind: "sessionToggled",
      selectionKey: sessionImportSelectionKey("claude", "s1"),
    });
    view = buildSessionImportView(state);
    expect(view.groups.find((g) => g.path === "/repo/a")?.selectionState).toBe(
      "partial",
    );

    state = sessionImportWizardReducer(state, {
      kind: "sessionToggled",
      selectionKey: sessionImportSelectionKey("claude", "s2"),
    });
    view = buildSessionImportView(state);
    expect(view.groups.find((g) => g.path === "/repo/a")?.selectionState).toBe(
      "none",
    );
  });

  it("groupSelectionSet with selected:false clears only that group's importable candidates", () => {
    const a1 = candidate({ nativeSessionId: "a1" });
    const groupA = group(folderLocation("/repo/a"), [a1]);
    const b1 = candidate({ nativeSessionId: "b1" });
    const groupB = group(folderLocation("/repo/b"), [b1]);

    const state = applyActions([
      { kind: "scanGroupArrived", group: groupA },
      { kind: "scanGroupArrived", group: groupB },
      {
        kind: "groupSelectionSet",
        groupKey: sessionImportGroupKey(groupA.location),
        selected: false,
      },
    ]);

    expect(state.selected.has(sessionImportSelectionKey("claude", "a1"))).toBe(
      false,
    );
    expect(state.selected.has(sessionImportSelectionKey("claude", "b1"))).toBe(
      true,
    );
  });
});

describe("buildSessionImportView - search + provider filter", () => {
  it("keeps a candidate whose title matches the query and drops one that doesn't; a folder-path match keeps every row in the group", () => {
    const matching = candidate({
      nativeSessionId: "s1",
      title: "Fix login bug",
    });
    const nonMatching = candidate({
      nativeSessionId: "s2",
      title: "Refactor styles",
    });
    const arrivingGroup = group(folderLocation("/Users/dev/my-project"), [
      matching,
      nonMatching,
    ]);

    let state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
      { kind: "queryChanged", query: "login" },
    ]);
    let view = buildSessionImportView(state);
    expect(view.groups[0]?.rows.map((row) => row.selectionKey)).toEqual([
      sessionImportSelectionKey("claude", "s1"),
    ]);

    state = sessionImportWizardReducer(state, {
      kind: "queryChanged",
      query: "my-project",
    });
    view = buildSessionImportView(state);
    expect(view.groups[0]?.rows).toHaveLength(2);
  });

  it("matches a title:null candidate by firstPrompt, and candidateDisplayTitle falls back title -> firstPrompt -> Untitled session, collapsing/truncating a long prompt", () => {
    const withTitle = candidate({ title: "Explicit title" });
    expect(candidateDisplayTitle(withTitle)).toBe("Explicit title");

    const untitled = candidate({ title: null, firstPrompt: null });
    expect(candidateDisplayTitle(untitled)).toBe("Untitled session");

    const whitespacePrompt = candidate({
      title: null,
      firstPrompt: "  fix   the   bug  ",
    });
    expect(candidateDisplayTitle(whitespacePrompt)).toBe("fix the bug");

    const longPrompt = "word ".repeat(60).trim();
    expect(longPrompt.length).toBeGreaterThan(140);
    const longPromptCandidate = candidate({
      nativeSessionId: "long",
      title: null,
      firstPrompt: longPrompt,
    });
    expect(candidateDisplayTitle(longPromptCandidate)).toBe(
      `${longPrompt.slice(0, 140)}…`,
    );

    const state = applyActions([
      {
        kind: "scanGroupArrived",
        group: group(folderLocation("/repo/a"), [longPromptCandidate]),
      },
      { kind: "queryChanged", query: "word" },
    ]);
    const view = buildSessionImportView(state);
    expect(view.groups[0]?.rows).toHaveLength(1);
  });

  it("narrows matchedSessions via the provider filter without changing totalSessions or selectedCount", () => {
    const claudeCandidate = candidate({ harness: "claude", nativeSessionId: "c1" });
    const codexCandidate = candidate({ harness: "codex", nativeSessionId: "x1" });
    const arrivingGroup = group(folderLocation("/repo/a"), [
      claudeCandidate,
      codexCandidate,
    ]);

    const state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
      { kind: "providerFilterChanged", providerFilter: "claude" },
    ]);
    const view = buildSessionImportView(state);

    expect(view.matchedSessions).toBe(1);
    expect(view.totalSessions).toBe(2);
    expect(view.selectedCount).toBe(2);
  });

  it("limits visibleSelectionKeys to visible selectable rows, and visibleSelectionSet toggles exactly those", () => {
    const claudeCandidate = candidate({ harness: "claude", nativeSessionId: "c1" });
    const codexCandidate = candidate({ harness: "codex", nativeSessionId: "x1" });
    const alreadyImported = candidate({
      harness: "claude",
      nativeSessionId: "c2",
      state: { kind: "already_in_traycer", epicId: "e", chatId: "c" },
    });
    const arrivingGroup = group(folderLocation("/repo/a"), [
      claudeCandidate,
      codexCandidate,
      alreadyImported,
    ]);

    let state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
      { kind: "providerFilterChanged", providerFilter: "claude" },
    ]);
    const view = buildSessionImportView(state);
    expect(view.visibleSelectionKeys).toEqual([
      sessionImportSelectionKey("claude", "c1"),
    ]);

    state = sessionImportWizardReducer(state, {
      kind: "visibleSelectionSet",
      selectionKeys: view.visibleSelectionKeys,
      selected: false,
    });

    expect(state.selected.has(sessionImportSelectionKey("claude", "c1"))).toBe(
      false,
    );
    // Filtered out of the view by the provider filter - untouched by the toggle.
    expect(state.selected.has(sessionImportSelectionKey("codex", "x1"))).toBe(
      true,
    );
  });

  it("omits a group whose every row is filtered out", () => {
    const onlyCandidate = candidate({ nativeSessionId: "s1", title: "Alpha" });
    const state = applyActions([
      {
        kind: "scanGroupArrived",
        group: group(folderLocation("/repo/a"), [onlyCandidate]),
      },
      { kind: "queryChanged", query: "does-not-match-anything" },
    ]);

    const view = buildSessionImportView(state);
    expect(view.groups).toHaveLength(0);
  });
});

describe("sessionImportWizardReducer - frame folding into view state", () => {
  it("moves phase to complete with totals on scanCompleted, and ignores a scanFailed that arrives afterward", () => {
    const totals: SessionImportScanTotals = {
      groups: 1,
      sessions: 1,
      importable: 1,
      alreadyInTraycer: 0,
      unreadable: 0,
    };
    const state = sessionImportWizardReducer(SESSION_IMPORT_INITIAL_STATE, {
      kind: "scanCompleted",
      totals,
    });
    expect(state.phase).toBe("complete");
    expect(state.totals).toEqual(totals);

    const afterFailed = sessionImportWizardReducer(state, {
      kind: "scanFailed",
      detail: "socket dropped",
    });
    expect(afterFailed).toBe(state);
  });

  it("sets phase to failed with the detail when scanFailed arrives while still scanning", () => {
    const state = sessionImportWizardReducer(SESSION_IMPORT_INITIAL_STATE, {
      kind: "scanFailed",
      detail: "host unreachable",
    });
    expect(state.phase).toBe("failed");
    expect(state.scanErrorDetail).toBe("host unreachable");
  });

  it("accumulates scanProviderFailed entries without touching groups or selection", () => {
    const arrivingGroup = group(folderLocation("/repo/a"), [
      candidate({ nativeSessionId: "s1" }),
    ]);
    const failureA: SessionImportProviderFailure = {
      harness: "codex",
      reason: "source_unreadable",
      detail: "boom",
    };
    const failureB: SessionImportProviderFailure = {
      harness: "grok",
      reason: "internal_error",
      detail: "timed out",
    };

    const state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
      { kind: "scanProviderFailed", failure: failureA },
      { kind: "scanProviderFailed", failure: failureB },
    ]);

    expect(state.providerFailures).toEqual([failureA, failureB]);
    expect(state.groups).toEqual([arrivingGroup]);
    expect(state.selected.has(sessionImportSelectionKey("claude", "s1"))).toBe(
      true,
    );
  });

  it("clears groups/selection/phase on scanRestarted but preserves query and providerFilter", () => {
    const arrivingGroup = group(folderLocation("/repo/a"), [
      candidate({ nativeSessionId: "s1" }),
    ]);

    const state = applyActions([
      { kind: "scanGroupArrived", group: arrivingGroup },
      { kind: "queryChanged", query: "login" },
      { kind: "providerFilterChanged", providerFilter: "codex" },
      {
        kind: "scanCompleted",
        totals: {
          groups: 1,
          sessions: 1,
          importable: 1,
          alreadyInTraycer: 0,
          unreadable: 0,
        },
      },
      { kind: "scanRestarted" },
    ]);

    expect(state.groups).toEqual([]);
    expect(state.selected.size).toBe(0);
    expect(state.phase).toBe("scanning");
    expect(state.totals).toBeNull();
    expect(state.query).toBe("login");
    expect(state.providerFilter).toBe("codex");
  });
});

describe("buildSessionImportSubmission", () => {
  it("emits one selection per ticked candidate in scan order, with a titles map that includes the firstPrompt fallback", () => {
    const a1 = candidate({ nativeSessionId: "a1", title: "Fix login bug" });
    const a2 = candidate({
      nativeSessionId: "a2",
      title: null,
      firstPrompt: "add dark mode toggle",
    });
    const groupA = group(folderLocation("/repo/a"), [a1, a2]);
    const b1 = candidate({ nativeSessionId: "b1", title: "Refactor auth" });
    const groupB = group(folderLocation("/repo/b"), [b1]);

    let state = applyActions([
      { kind: "scanGroupArrived", group: groupA },
      { kind: "scanGroupArrived", group: groupB },
    ]);
    // Deselect b1 so the submission proves it only carries ticked candidates.
    state = sessionImportWizardReducer(state, {
      kind: "sessionToggled",
      selectionKey: sessionImportSelectionKey("claude", "b1"),
    });

    const submission = buildSessionImportSubmission(state);

    expect(submission.selections).toEqual([
      { harness: "claude", nativeSessionId: "a1" },
      { harness: "claude", nativeSessionId: "a2" },
    ]);
    expect(
      submission.titles.get(sessionImportSelectionKey("claude", "a1")),
    ).toBe("Fix login bug");
    expect(
      submission.titles.get(sessionImportSelectionKey("claude", "a2")),
    ).toBe("add dark mode toggle");
  });
});

describe("groupSessionImportFailures", () => {
  it("buckets failed outcomes by reason, ignores non-failed outcomes, and falls back to the raw id when no title is known", () => {
    const knownKey = sessionImportSelectionKey("claude", "s1");
    const titles = new Map<string, string>([[knownKey, "Fix login bug"]]);

    const failedOutcomeA: SessionImportOutcome = {
      kind: "failed",
      reason: "source_unreadable",
      detail: "disk error",
    };
    const failedOutcomeB: SessionImportOutcome = {
      kind: "failed",
      reason: "source_unreadable",
      detail: "permission denied",
    };
    const importedOutcome: SessionImportOutcome = {
      kind: "imported",
      epicId: "epic-1",
      chatId: "chat-1",
    };
    const skippedOutcome: SessionImportOutcome = {
      kind: "skipped_already_imported",
      epicId: "epic-2",
      chatId: "chat-2",
    };

    const outcomes: ReadonlyArray<SessionImportOutcomeEntry> = [
      { selectionKey: knownKey, nativeSessionId: "s1", outcome: failedOutcomeA },
      {
        selectionKey: sessionImportSelectionKey("claude", "s2"),
        nativeSessionId: "s2",
        outcome: failedOutcomeB,
      },
      {
        selectionKey: sessionImportSelectionKey("codex", "s3"),
        nativeSessionId: "s3",
        outcome: importedOutcome,
      },
      {
        selectionKey: sessionImportSelectionKey("codex", "s4"),
        nativeSessionId: "s4",
        outcome: skippedOutcome,
      },
    ];

    const groups = groupSessionImportFailures(outcomes, titles);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe("source_unreadable");
    expect(groups[0]?.label).toBe(sessionImportFailureLabel("source_unreadable"));
    expect(groups[0]?.entries).toEqual([
      { selectionKey: knownKey, title: "Fix login bug", detail: "disk error" },
      {
        selectionKey: sessionImportSelectionKey("claude", "s2"),
        title: "s2",
        detail: "permission denied",
      },
    ]);
  });
});
