import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionImportProgress } from "@/components/session-import/session-import-progress";
import { sessionImportTone } from "@/components/session-import/session-import-tone";
import { useSessionImportRunStore } from "@/stores/session-import/session-import-run-store";

/**
 * The two things the progress view has to get right about WHOSE run it is
 * showing and WHERE the tasks will appear - both invisible to the wizard
 * tests, which never see an attached run or the onboarding ground.
 */
describe("SessionImportProgress", () => {
  beforeEach(() => {
    useSessionImportRunStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("says the submitted selection was not started when it attached to a run in flight", () => {
    useSessionImportRunStore.getState().markStarting(new Map());
    useSessionImportRunStore
      .getState()
      .applyStarted({ runId: "run-1", total: 4, attached: true });

    render(<SessionImportProgress tone={sessionImportTone("dialog")} />);

    expect(
      screen.getByTestId("session-import-progress-attached").textContent,
    ).toBe(
      "An import was already running - showing its progress. Your selection was not started.",
    );
    expect(screen.getByText("Importing 0 of 4…")).toBeTruthy();
  });

  it("shows no such notice for a run this window started", () => {
    useSessionImportRunStore.getState().markStarting(new Map());
    useSessionImportRunStore
      .getState()
      .applyStarted({ runId: "run-1", total: 4, attached: false });

    render(<SessionImportProgress tone={sessionImportTone("dialog")} />);

    expect(screen.queryByTestId("session-import-progress-attached")).toBeNull();
  });

  it("points the tour at the end of onboarding and the dialog at the task list", () => {
    useSessionImportRunStore.getState().markStarting(new Map());
    useSessionImportRunStore
      .getState()
      .applyStarted({ runId: "run-1", total: 1, attached: false });
    useSessionImportRunStore.getState().applyComplete({
      runId: "run-1",
      counts: { imported: 1, skippedAlreadyImported: 0, failed: 0 },
    });

    render(<SessionImportProgress tone={sessionImportTone("onboarding")} />);
    expect(
      screen.getByText(
        "They'll be in your task list when you finish the tour.",
      ),
    ).toBeTruthy();

    cleanup();
    render(<SessionImportProgress tone={sessionImportTone("dialog")} />);
    expect(
      screen.getByText("Your tasks are in the list on the left."),
    ).toBeTruthy();
  });
});
