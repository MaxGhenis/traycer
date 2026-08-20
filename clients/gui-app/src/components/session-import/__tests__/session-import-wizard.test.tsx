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
import type { StreamCloseReason } from "@traycer-clients/shared/host-transport/i-stream-session";
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

/**
 * The wizard navigates through the shared epic-open helper, so the assertion
 * that matters here is "the row asked for that epic" - the helper's own
 * empty-draft/tab-intent behaviour is covered where it lives.
 */
const openEpicFromListMock = vi.hoisted(() =>
  vi.fn<
    (
      navigate: unknown,
      epicId: string,
      pathname: string,
      options: { readonly title: string | undefined; readonly source: string },
    ) => void
  >(),
);
vi.mock("@/lib/commands/actions/open-epic-from-list", () => ({
  openEpicFromList: openEpicFromListMock,
}));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouter: () => ({ state: { location: { pathname: "/tasks" } } }),
  };
});

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
    sessions: [...input.sessions],
  };
}

function missingFolderGroup(input: {
  readonly path: string;
  readonly sessions: ReadonlyArray<SessionImportCandidate>;
}): SessionImportGroup {
  return {
    location: { kind: "missing_folder", path: input.path },
    sessions: [...input.sessions],
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

const FATAL_CLOSE: StreamCloseReason = {
  kind: "fatalError",
  details: {
    code: "INTERNAL",
    reason: "The host stopped answering mid-scan.",
    incompatibleMethods: null,
    upgradeGuidance: null,
  },
};

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
  openEpicFromListMock.mockClear();
  navigateMock.mockClear();
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

    const unavailableRows = rows.filter(
      (row) => row.getAttribute("data-selectable") === "false",
    );
    expect(unavailableRows).toHaveLength(2);
    for (const row of unavailableRows) {
      expect(row.getAttribute("aria-checked")).not.toBe("true");
    }

    const selectableRows = rows.filter(
      (row) => row.getAttribute("data-selectable") === "true",
    );
    expect(selectableRows).toHaveLength(1);
    expect(selectableRows[0].getAttribute("aria-checked")).toBe("true");
  });

  it("keeps an unavailable row's tooltip reachable and refuses to toggle it", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            importableCandidate("claude", "s1", "Importable session"),
            unreadableCandidate("claude", "s2", "Broken session"),
          ],
        }),
      );
    });
    fireEvent.click(screen.getByTestId("session-import-group-toggle"));

    const row = screen.getByRole("checkbox", { name: "Broken session" });
    // A DOM-disabled button emits no pointer events in a real browser, which
    // is exactly what used to silence this tooltip. jsdom dispatches to
    // disabled nodes anyway, so the absent attribute is the honest proxy.
    expect(row.hasAttribute("disabled")).toBe(false);
    expect(row.getAttribute("aria-disabled")).toBe("true");

    fireEvent.focus(row);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "Corrupt session file",
    );

    fireEvent.click(row);
    expect(screen.getByTestId("session-import-submit").textContent).toBe(
      "Import 1 session",
    );
  });

  it("opens the task an already-imported session became, letting the dialog close first", () => {
    const onClose = vi.fn();
    render(
      <SessionImportWizard
        surface="dialog"
        onImportStarted={vi.fn()}
        secondaryAction={{ label: "Close", onSelect: onClose }}
      />,
    );
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            alreadyInTraycerCandidate("claude", "s1", "Already there"),
          ],
        }),
      );
    });
    fireEvent.click(screen.getByTestId("session-import-group-toggle"));

    fireEvent.click(screen.getByRole("button", { name: "Already there" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openEpicFromListMock).toHaveBeenCalledTimes(1);
    const [, epicId, pathname, options] = openEpicFromListMock.mock.calls[0];
    expect(epicId).toBe("epic-1");
    expect(pathname).toBe("/tasks");
    expect(options.title).toBe("Already there");
  });

  it("counts only pickable sessions in the footer's denominator", () => {
    renderWizard(vi.fn());
    const callbacks = requireCallbacks();

    act(() => {
      callbacks.onGroup(
        folderGroup({
          path: "/repo/a",
          sessions: [
            importableCandidate("claude", "s1", "Importable session"),
            alreadyInTraycerCandidate("claude", "s2", "Already there"),
            unreadableCandidate("claude", "s3", "Broken session"),
          ],
        }),
      );
    });

    expect(
      screen.getByTestId("session-import-selection-count").textContent,
    ).toBe("1 of 1 selected");
  });

  it("shows the scan's own failure inline, with the groups it already delivered still on screen", () => {
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
    act(() => {
      callbacks.onConnectionStatus("closed", FATAL_CLOSE);
    });

    expect(
      screen.getByTestId("session-import-scan-error").textContent,
    ).toContain("The host stopped answering mid-scan.");
    expect(screen.getAllByTestId("session-import-group")).toHaveLength(1);
    expect(screen.queryByTestId("session-import-empty")).toBeNull();
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
