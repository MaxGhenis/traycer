import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionImportStatusResponse } from "@traycer/protocol/host/session-import/contracts";
import { SessionImportPromptRow } from "@/components/session-import/session-import-prompt-row";
import { GeneralSettingsPanel } from "@/components/settings/panels/general-settings-panel";
import { useOnboardingStore } from "@/stores/onboarding/onboarding-store";
import { useSessionImportPromptStore } from "@/stores/session-import/session-import-prompt-store";
import {
  progressEntryFrom,
  useSessionImportRunStore,
} from "@/stores/session-import/session-import-run-store";

/**
 * The two seams both entry-point surfaces sit on. Mocked at module level so
 * these tests drive "is the feature available" and "what does the host say
 * the status is" directly, instead of standing up the stream transport that
 * backs the real hooks.
 */
const sessionImportAvailableMock = vi.hoisted(() => ({ value: true }));
const sessionImportStatusMock = vi.hoisted(
  (): { data: SessionImportStatusResponse | undefined } => ({
    data: undefined,
  }),
);

vi.mock("@/hooks/session-import/use-session-import-available", () => ({
  useSessionImportAvailable: () => sessionImportAvailableMock.value,
}));

vi.mock("@/hooks/session-import/use-session-import-status-query", () => ({
  useSessionImportStatus: () => ({ data: sessionImportStatusMock.data }),
}));

// Stubbed so opening the dialog does not drag in the stream/host-transport
// stack the real dialog depends on.
vi.mock("@/components/session-import/session-import-dialog", () => ({
  SessionImportDialog: ({ onClose }: { readonly onClose: () => void }) => (
    <div data-testid="session-import-dialog-stub">
      <button type="button" onClick={onClose}>
        Close stub dialog
      </button>
    </div>
  ),
}));

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function statusOf(
  overrides: Partial<SessionImportStatusResponse>,
): SessionImportStatusResponse {
  return {
    active: null,
    lastCompleted: null,
    ...overrides,
  };
}

describe("SessionImportPromptRow", () => {
  beforeEach(() => {
    sessionImportAvailableMock.value = true;
    sessionImportStatusMock.data = undefined;
    useOnboardingStore.setState({ completedAt: null, step: 0 });
    useSessionImportPromptStore.setState({ dismissedAt: null });
  });

  afterEach(() => {
    cleanup();
  });

  function makeEligible(): void {
    sessionImportAvailableMock.value = true;
    useOnboardingStore.setState({ completedAt: 100, step: 0 });
    useSessionImportPromptStore.setState({ dismissedAt: null });
    sessionImportStatusMock.data = statusOf({});
  }

  it("is hidden when the host does not support session import", () => {
    makeEligible();
    sessionImportAvailableMock.value = false;

    render(<SessionImportPromptRow />);

    expect(screen.queryByTestId("session-import-prompt")).toBeNull();
  });

  it("is hidden when onboarding has never completed", () => {
    makeEligible();
    useOnboardingStore.setState({ completedAt: null, step: 0 });

    render(<SessionImportPromptRow />);

    expect(screen.queryByTestId("session-import-prompt")).toBeNull();
  });

  it("is hidden once already dismissed", () => {
    makeEligible();
    useSessionImportPromptStore.setState({ dismissedAt: Date.now() });

    render(<SessionImportPromptRow />);

    expect(screen.queryByTestId("session-import-prompt")).toBeNull();
  });

  it("is hidden while the status query has not answered yet, so it does not flash in and out", () => {
    makeEligible();
    sessionImportStatusMock.data = undefined;

    render(<SessionImportPromptRow />);

    expect(screen.queryByTestId("session-import-prompt")).toBeNull();
  });

  it("is hidden when something has already been imported on this host", () => {
    makeEligible();
    sessionImportStatusMock.data = statusOf({
      lastCompleted: {
        runId: "run-1",
        counts: { imported: 3, skippedAlreadyImported: 0, failed: 0 },
        at: Date.now(),
      },
    });

    render(<SessionImportPromptRow />);

    expect(screen.queryByTestId("session-import-prompt")).toBeNull();
  });

  it("is hidden when a run is already active", () => {
    makeEligible();
    sessionImportStatusMock.data = statusOf({
      active: { runId: "run-1", done: 1, total: 4 },
    });

    render(<SessionImportPromptRow />);

    expect(screen.queryByTestId("session-import-prompt")).toBeNull();
  });

  it("shows the row, with no session count in its copy, when every condition is met", () => {
    makeEligible();

    render(<SessionImportPromptRow />);

    const row = screen.getByTestId("session-import-prompt");
    expect(row).toBeTruthy();
    expect(
      screen.getByText(
        "Sessions from Claude Code and Codex can be imported as tasks.",
      ),
    ).toBeTruthy();
    // No digit anywhere in the row's copy: counting would require a
    // background scan, which the feature deliberately does not do.
    expect(/\d/.test(row.textContent)).toBe(false);
  });

  it("dismisses and removes the row when clicking Dismiss", () => {
    makeEligible();

    render(<SessionImportPromptRow />);

    expect(useSessionImportPromptStore.getState().dismissedAt).toBeNull();
    fireEvent.click(screen.getByTestId("session-import-prompt-dismiss"));

    expect(useSessionImportPromptStore.getState().dismissedAt).not.toBeNull();
    expect(screen.queryByTestId("session-import-prompt")).toBeNull();
  });

  it("mounts the import dialog when clicking Import", () => {
    makeEligible();

    render(<SessionImportPromptRow />);

    expect(screen.queryByTestId("session-import-dialog-stub")).toBeNull();
    fireEvent.click(screen.getByTestId("session-import-prompt-open"));

    expect(screen.getByTestId("session-import-dialog-stub")).toBeTruthy();
  });
});

describe("SessionImportSettingsRow (via GeneralSettingsPanel)", () => {
  beforeEach(() => {
    sessionImportAvailableMock.value = true;
    sessionImportStatusMock.data = undefined;
    useOnboardingStore.setState({ completedAt: null, step: 0 });
    useSessionImportPromptStore.setState({ dismissedAt: null });
    useSessionImportRunStore.getState().reset();
    navigateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  function renderPanel(): void {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <GeneralSettingsPanel />
      </QueryClientProvider>,
    );
  }

  it("is hidden entirely when session import is unavailable", () => {
    sessionImportAvailableMock.value = false;

    renderPanel();

    expect(screen.queryByTestId("settings-import-sessions")).toBeNull();
    expect(screen.queryByText("Import sessions")).toBeNull();
  });

  it("shows the idle description when nothing is running and nothing has completed", () => {
    sessionImportStatusMock.data = statusOf({});

    renderPanel();

    expect(screen.getByTestId("settings-import-sessions")).toBeTruthy();
    expect(
      screen.getByText("Bring sessions from Claude Code and Codex in as tasks."),
    ).toBeTruthy();
  });

  it("shows 'Importing N of M…' from the run store, winning over the status query", () => {
    sessionImportStatusMock.data = statusOf({
      lastCompleted: {
        runId: "run-old",
        counts: { imported: 9, skippedAlreadyImported: 0, failed: 0 },
        at: Date.now(),
      },
    });

    useSessionImportRunStore.getState().markStarting(new Map());
    useSessionImportRunStore.getState().applyStarted({
      runId: "run-live",
      total: 5,
    });
    useSessionImportRunStore.getState().applyProgress(
      progressEntryFrom({
        harness: "claude",
        nativeSessionId: "session-1",
        outcome: {
          kind: "imported",
          epicId: "epic-1",
          chatId: "chat-1",
        },
      }),
    );

    renderPanel();

    expect(screen.getByText("Importing 1 of 5…")).toBeTruthy();
    expect(screen.queryByText(/Last import:/)).toBeNull();
  });

  it("shows 'Importing N of M…' from status.active when the run store is idle (post-restart)", () => {
    sessionImportStatusMock.data = statusOf({
      active: { runId: "run-remote", done: 2, total: 6 },
    });

    renderPanel();

    expect(screen.getByText("Importing 2 of 6…")).toBeTruthy();
  });

  it("shows the last-import caption when status.lastCompleted is set and nothing is active", () => {
    sessionImportStatusMock.data = statusOf({
      lastCompleted: {
        runId: "run-done",
        counts: { imported: 7, skippedAlreadyImported: 1, failed: 0 },
        at: Date.now(),
      },
    });

    renderPanel();

    expect(screen.getByText("Last import: 7 imported.")).toBeTruthy();
  });
});
