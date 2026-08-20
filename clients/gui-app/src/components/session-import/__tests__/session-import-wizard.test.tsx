import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { GuiHarnessId } from "@traycer/protocol/host/index";
import type {
  SessionImportCandidate,
  SessionImportCandidateState,
  SessionImportGroup,
} from "@traycer/protocol/host/session-import/candidate";
import type { SessionImportScanTotals } from "@traycer/protocol/host/session-import/scan";
import type {
  SessionImportScanCallbacks,
  SessionImportScanClientOptions,
} from "@traycer-clients/shared/host-transport/session-import-scan-client";
import type { SessionImportRunRequest } from "@/components/session-import/session-import-run-handle";
import {
  harnessDisplayName,
  sessionImportGroupKey,
} from "@/components/session-import/session-import-model";

/**
 * Captures the callbacks the REAL `useSessionImportScan` hook hands to
 * `SessionImportScanClient`, so a test can play server frames straight into
 * the reducer via `onGroup` / `onProviderFailed` / `onComplete` - the same
 * seam `migration-run-controller.test.tsx` uses for the migration stream.
 * Mocking one level up (the hook itself) would skip the reducer entirely,
 * which is the thing this suite is meant to cover.
 */
interface ScanClientHarness {
  callbacks: SessionImportScanCallbacks | null;
  readonly close: Mock<() => void>;
}

const scanClient = vi.hoisted((): ScanClientHarness => ({
  callbacks: null,
  close: vi.fn(),
}));

const startSessionImportRunMock = vi.hoisted(() =>
  vi.fn<(request: SessionImportRunRequest) => void>(),
);
const analyticsTrackMock = vi.hoisted(() => vi.fn());

vi.mock(
  "@traycer-clients/shared/host-transport/session-import-scan-client",
  () => ({
    SessionImportScanClient: class {
      constructor(options: SessionImportScanClientOptions) {
        scanClient.callbacks = options.callbacks;
      }

      close(): void {
        scanClient.close();
      }
    },
  }),
);

// A non-null stub is all `useSessionImportScan` needs to proceed past its
// null-guard; the fake `SessionImportScanClient` above never touches it. Its
// identity must be STABLE: the real `useWsStreamClient` is a
// `useSyncExternalStore` read that returns the same client across renders, and
// the scan effect keys its subscription on that identity - a stub minted per
// render would re-subscribe forever.
const wsStreamClientStub = vi.hoisted(() => ({ stream: "test" }));
vi.mock("@/lib/host/stream-runtime-context", () => ({
  useWsStreamClient: () => wsStreamClientStub,
}));

vi.mock("@/components/session-import/session-import-run-handle", () => ({
  startSessionImportRun: startSessionImportRunMock,
}));

vi.mock("@/lib/analytics", () => ({
  Analytics: { getInstance: () => ({ track: analyticsTrackMock }) },
  AnalyticsEvent: { SessionImportStarted: "session_import_started" },
}));

import { SessionImportWizard } from "@/components/session-import/session-import-wizard";
import { useSessionImportRunStore } from "@/stores/session-import/session-import-run-store";

const ZERO_TOTALS: SessionImportScanTotals = {
  groups: 0,
  sessions: 0,
  importable: 0,
  alreadyInTraycer: 0,
  unreadable: 0,
};

const IMPORTABLE_STATE: SessionImportCandidateState = { kind: "importable" };

function alreadyInTraycerState(): SessionImportCandidateState {
  return { kind: "already_in_traycer", epicId: "epic-1", chatId: "chat-1" };
}

function unreadableState(): SessionImportCandidateState {
  return {
    kind: "unreadable",
    reason: "source_unreadable",
    detail: "Corrupt session file",
  };
}

function candidate(input: {
  readonly harness: GuiHarnessId;
  readonly nativeSessionId: string;
  readonly title: string;
  readonly state: SessionImportCandidateState;
}): SessionImportCandidate {
  return {
    harness: input.harness,
    nativeSessionId: input.nativeSessionId,
    title: input.title,
    firstPrompt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    messageCount: null,
    hasSubagents: false,
    state: input.state,
  };
}

function importableCandidate(
  harness: GuiHarnessId,
  nativeSessionId: string,
  title: string,
): SessionImportCandidate {
  return candidate({
    harness,
    nativeSessionId,
    title,
    state: IMPORTABLE_STATE,
  });
}

function alreadyInTraycerCandidate(
  harness: GuiHarnessId,
  nativeSessionId: string,
  title: string,
): SessionImportCandidate {
  return candidate({
    harness,
    nativeSessionId,
    title,
    state: alreadyInTraycerState(),
  });
}

function unreadableCandidate(
  harness: GuiHarnessId,
  nativeSessionId: string,
  title: string,
): SessionImportCandidate {
  return candidate({
    harness,
    nativeSessionId,
    title,
    state: unreadableState(),
  });
}

function folderGroup(input: {
  readonly path: string;
  readonly sessions: ReadonlyArray<SessionImportCandidate>;
}): SessionImportGroup {
  return {
    location: { kind: "folder", path: input.path, workspaceId: null },
    sessions: input.sessions,
  };
}

function missingFolderGroup(input: {
  readonly path: string;
  readonly sessions: ReadonlyArray<SessionImportCandidate>;
}): SessionImportGroup {
  return {
    location: { kind: "missing_folder", path: input.path },
    sessions: input.sessions,
  };
}

function renderWizard(onImportStarted: () => void): void {
  render(
    <SessionImportWizard
      surface="dialog"
      onImportStarted={onImportStarted}
      secondaryAction={null}
    />,
  );
}

function requireCallbacks(): SessionImportScanCallbacks {
  const callbacks = scanClient.callbacks;
  if (callbacks === null) {
    throw new Error("Expected the scan client's callbacks to be captured.");
  }
  return callbacks;
}

function requireGroupElement(groupKey: string): HTMLElement {
  const groups = screen.getAllByTestId("session-import-group");
  const match = groups.find(
    (element) => element.getAttribute("data-group-key") === groupKey,
  );
  if (match === undefined) {
    throw new Error(`Expected a group element for key ${groupKey}`);
  }
  return match;
}

beforeEach(() => {
  scanClient.callbacks = null;
  scanClient.close.mockClear();
  startSessionImportRunMock.mockClear();
  analyticsTrackMock.mockClear();
  useSessionImportRunStore.getState().reset();
});

afterEach(() => {
  cleanup();
  useSessionImportRunStore.getState().reset();
});

describe("<SessionImportWizard />", () => {
  it("fills in progressively as group frames arrive and clears the spinner on complete", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    expect(screen.getByTestId("session-import-scan-spinner")).toBeTruthy();
    expect(screen.queryAllByTestId("session-import-group")).toHaveLength(0);

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [importableCandidate("claude", "s1", "First session")],
        }),
      );
    });

    expect(screen.queryAllByTestId("session-import-group")).toHaveLength(1);
    expect(screen.getByTestId("session-import-scan-spinner")).toBeTruthy();

    act(() => {
      callbacks.onComplete(ZERO_TOTALS);
    });

    expect(screen.queryByTestId("session-import-scan-spinner")).toBeNull();
  });

  it("keeps a group's rows collapsed until its toggle is clicked, twice", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            importableCandidate("claude", "s1", "Session one"),
            importableCandidate("claude", "s2", "Session two"),
            importableCandidate("claude", "s3", "Session three"),
          ],
        }),
      );
    });

    expect(screen.queryAllByTestId("session-import-row")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("session-import-group-toggle"));
    expect(screen.getAllByTestId("session-import-row")).toHaveLength(3);

    fireEvent.click(screen.getByTestId("session-import-group-toggle"));
    expect(screen.queryAllByTestId("session-import-row")).toHaveLength(0);
  });

  it("pre-selects every importable candidate, including a missing-folder group's", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            importableCandidate("claude", "s1", "Session one"),
            importableCandidate("claude", "s2", "Session two"),
          ],
        }),
      );
    });
    act(() => {
      callbacks.onGroup(
        missingFolderGroup({
          path: "/repo/gone",
          sessions: [importableCandidate("codex", "s3", "Orphaned session")],
        }),
      );
    });

    expect(screen.getByTestId("session-import-submit").textContent).toBe(
      "Import 3 sessions",
    );
    expect(screen.getByTestId("session-import-missing-folder")).toBeTruthy();
  });

  it("marks non-importable rows disabled and unticked, the importable one ticked", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            importableCandidate("claude", "s1", "Importable session"),
            alreadyInTraycerCandidate("claude", "s2", "Already imported"),
            unreadableCandidate("claude", "s3", "Broken session"),
          ],
        }),
      );
    });
    fireEvent.click(screen.getByTestId("session-import-group-toggle"));

    const rows = screen.getAllByTestId("session-import-row");
    expect(rows).toHaveLength(3);

    const disabledRows = rows.filter((row) => row.hasAttribute("disabled"));
    expect(disabledRows).toHaveLength(2);
    for (const row of disabledRows) {
      expect(row.getAttribute("aria-checked")).toBe("false");
    }

    const enabledRow = rows.find((row) => !row.hasAttribute("disabled"));
    if (enabledRow === undefined) {
      throw new Error("Expected exactly one enabled row.");
    }
    expect(enabledRow.getAttribute("aria-checked")).toBe("true");
  });

  it("clears and restores one group's selection via its own checkbox, leaving the other group alone", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            importableCandidate("claude", "s1", "Session one"),
            importableCandidate("claude", "s2", "Session two"),
          ],
        }),
      );
    });
    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/b",
          sessions: [importableCandidate("codex", "s3", "Session three")],
        }),
      );
    });

    expect(screen.getByTestId("session-import-submit").textContent).toBe(
      "Import 3 sessions",
    );

    const groupAKey = sessionImportGroupKey({
      kind: "folder",
      path: "/repo/a",
      workspaceId: null,
    });
    const groupASelect = within(requireGroupElement(groupAKey)).getByTestId(
      "session-import-group-select",
    );

    fireEvent.click(groupASelect);
    expect(screen.getByTestId("session-import-submit").textContent).toBe(
      "Import 1 session",
    );

    fireEvent.click(groupASelect);
    expect(screen.getByTestId("session-import-submit").textContent).toBe(
      "Import 3 sessions",
    );
  });

  it("narrows visible groups on search without changing the submit count", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/alpha",
          sessions: [importableCandidate("claude", "s1", "Alpha work")],
        }),
      );
    });
    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/beta",
          sessions: [importableCandidate("claude", "s2", "Beta work")],
        }),
      );
    });

    expect(screen.getAllByTestId("session-import-group")).toHaveLength(2);
    expect(screen.getByTestId("session-import-submit").textContent).toBe(
      "Import 2 sessions",
    );

    fireEvent.change(screen.getByTestId("session-import-search"), {
      target: { value: "alpha" },
    });

    expect(screen.getAllByTestId("session-import-group")).toHaveLength(1);
    expect(screen.getByTestId("session-import-submit").textContent).toBe(
      "Import 2 sessions",
    );

    fireEvent.change(screen.getByTestId("session-import-search"), {
      target: { value: "" },
    });

    expect(screen.getAllByTestId("session-import-group")).toHaveLength(2);
  });

  it("shows the provider filter only once a second harness appears, and narrows on selection", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [importableCandidate("claude", "s1", "Claude session")],
        }),
      );
    });

    expect(
      screen.queryAllByTestId("session-import-provider-filter"),
    ).toHaveLength(0);

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/b",
          sessions: [importableCandidate("codex", "s2", "Codex session")],
        }),
      );
    });

    expect(
      screen.getAllByTestId("session-import-provider-filter").length,
    ).toBeGreaterThan(1);
    expect(screen.getAllByTestId("session-import-group")).toHaveLength(2);

    const providerFilterGroup = screen.getByRole("radiogroup", {
      name: "Filter by provider",
    });
    fireEvent.click(
      within(providerFilterGroup).getByText(harnessDisplayName("codex")),
    );

    expect(screen.getAllByTestId("session-import-group")).toHaveLength(1);
  });

  it("shows an inline provider-failure notice without blocking groups delivered after it", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onProviderFailed({
        harness: "codex",
        reason: "source_unreadable",
        detail: "Could not read ~/.codex/sessions",
      });
    });

    const notice = screen.getByTestId("session-import-provider-failure");
    expect(notice.textContent).toContain("Could not read ~/.codex/sessions");

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [importableCandidate("claude", "s1", "Claude session")],
        }),
      );
    });

    expect(screen.getAllByTestId("session-import-group")).toHaveLength(1);
    expect(screen.getByTestId("session-import-provider-failure")).toBeTruthy();
  });

  it("submits ticked candidates with a titles map keyed by harness:nativeSessionId and notifies the caller", () => {
    const onImportStarted = vi.fn();
    renderWizard(onImportStarted);
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            importableCandidate("claude", "s1", "Alpha session"),
            alreadyInTraycerCandidate("claude", "s2", "Already there"),
          ],
        }),
      );
    });

    fireEvent.click(screen.getByTestId("session-import-submit"));

    expect(startSessionImportRunMock).toHaveBeenCalledTimes(1);
    const request = startSessionImportRunMock.mock.calls[0][0];
    expect(request.selections).toEqual([
      { harness: "claude", nativeSessionId: "s1" },
    ]);
    expect(request.titles.size).toBe(1);
    expect(request.titles.get("claude:s1")).toBe("Alpha session");
    expect(onImportStarted).toHaveBeenCalledTimes(1);
    expect(analyticsTrackMock).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when the scan completes with nothing found", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onComplete(ZERO_TOTALS);
    });

    expect(screen.getByTestId("session-import-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("session-import-group")).toHaveLength(0);
  });
});
