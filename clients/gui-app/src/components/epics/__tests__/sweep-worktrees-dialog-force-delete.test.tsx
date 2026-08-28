import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { WorktreeBusyHolder } from "@traycer/protocol/framework/worktree-busy-holders";
import type { WorktreeHostEntryV14 } from "@traycer/protocol/host/index";
import { formatUnknownHolderConsequence } from "@/lib/worktree/teardown-holder-copy";

const HOLDERS: readonly WorktreeBusyHolder[] = [
  {
    ownerRef: {
      epicId: "epic-1",
      ownerKind: "terminal-agent",
      ownerId: "tui-1",
    },
    holdKind: "terminal-agent-pty",
    activity: "working",
    label: "Claude Code agent polite-ocelot is working",
    holderId: "epic-1:terminal-agent:tui-1",
  },
];

type SweepKickoff = {
  readonly worktrees: ReadonlyArray<{
    readonly stopOwners: boolean;
    readonly expectedHoldersRevision: string | undefined;
  }>;
};

type TestRow = {
  entry: WorktreeHostEntryV14;
  tier: "merged" | "at-base-commit" | "in-use" | "review";
  defaultChecked: boolean;
  disabled: boolean;
  note: "in-use" | "not-landed" | "shared" | null;
  holders: readonly WorktreeBusyHolder[];
  holdersStatus: "none" | "loading" | "ready" | "unknown";
  holdersRevision?: string | undefined;
};

const testState = vi.hoisted(() => {
  const parseSweepVariables = (value: unknown): SweepKickoff => {
    if (value === null || typeof value !== "object") {
      return { worktrees: [] };
    }
    if (!("worktrees" in value) || !Array.isArray(value.worktrees)) {
      return { worktrees: [] };
    }
    return {
      worktrees: value.worktrees.map((target: unknown) => {
        if (target === null || typeof target !== "object") {
          return { stopOwners: false, expectedHoldersRevision: undefined };
        }
        const stopOwners =
          "stopOwners" in target && target.stopOwners === true;
        const expectedHoldersRevision =
          "expectedHoldersRevision" in target &&
          typeof target.expectedHoldersRevision === "string"
            ? target.expectedHoldersRevision
            : undefined;
        return { stopOwners, expectedHoldersRevision };
      }),
    };
  };
  return {
    mutate: vi.fn(),
    parseSweepVariables,
    lastVariables: {
      worktrees: new Array<{
        readonly stopOwners: boolean;
        readonly expectedHoldersRevision: string | undefined;
      }>(),
    },
    holdersChanged: [] as Array<{
      worktreePath: string;
      holders: readonly WorktreeBusyHolder[];
      holdersRevision: string | undefined;
    }>,
    rows: [] as TestRow[],
    refresh: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@/hooks/epic/use-epic-sweep-worktree-candidates-query", () => ({
  useEpicSweepWorktreeCandidatesForClient: () => ({
    hostId: "host-1",
    rows: testState.rows,
    isPending: false,
    isError: false,
    checkedAt: Date.now(),
    canRefresh: true,
    refresh: testState.refresh,
  }),
}));

vi.mock("@/hooks/epic/use-epic-sweep-worktrees-mutation", () => ({
  useEpicSweepWorktrees: () => ({
    isPending: false,
    mutate: (
      variables: unknown,
      options: { onSuccess?: (result: unknown) => void } | undefined,
    ) => {
      testState.lastVariables = testState.parseSweepVariables(variables);
      testState.mutate(variables);
      options?.onSuccess?.({
        hostId: "host-1",
        removed: [],
        failed: [],
        uncertain: [],
        holdersChanged: testState.holdersChanged,
      });
    },
  }),
  useSweepingWorktreePaths: () => new Set<string>(),
}));

vi.mock("@/components/worktree/worktree-pr-metadata", () => ({
  WorktreePrPills: () => null,
}));

import { SweepWorktreesDialog } from "@/components/epics/sweep-worktrees-dialog";

function worktreeEntry(
  over: Partial<WorktreeHostEntryV14> & { readonly worktreePath: string },
): WorktreeHostEntryV14 {
  return {
    worktreePath: over.worktreePath,
    branch: over.branch ?? "feat-busy",
    repoLabel: "traycerai/traycer",
    repoIdentifier: { owner: "traycerai", repo: "traycer" },
    inUse: over.inUse ?? false,
    uncommittedCount: over.uncommittedCount ?? 0,
    gitRemovable: true,
    scripts: null,
    owners: over.owners ?? [],
    lastActivityAt: null,
    branchStatus: over.branchStatus ?? null,
    createdAt: null,
    prState: over.prState ?? "merged",
    prNumber: 1,
    prUrl: "https://example.test/pr/1",
    mergedHeadShaMatches: true,
    submodules: [],
    atBaseCommit: over.atBaseCommit ?? false,
    resolvedAt: Date.now(),
  };
}

function renderDialog(): void {
  render(
    <SweepWorktreesDialog
      epicIds={["epic-1"]}
      hostClient={null}
      taskTitle="Task"
      onOpenChange={vi.fn()}
    />,
  );
}

describe("SweepWorktreesDialog ergonomics", () => {
  afterEach(() => {
    cleanup();
    testState.mutate.mockReset();
    testState.lastVariables = { worktrees: [] };
    testState.holdersChanged = [];
    testState.refresh.mockClear();
  });

  it("executes a safe-only selection from step 1 without opening review", () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/idle",
          branch: "feat-idle",
          inUse: false,
        }),
        tier: "merged",
        defaultChecked: true,
        disabled: false,
        note: null,
        holders: [],
        holdersStatus: "none",
      },
    ];
    renderDialog();
    expect(screen.queryByText("Review this sweep")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sweep selected" }));
    expect(testState.mutate).toHaveBeenCalledTimes(1);
    expect(testState.lastVariables.worktrees[0]?.stopOwners).toBe(false);
  });

  it("opens review for in-use, unproven, and shared selections; typing only for unproven", async () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/busy",
          branch: "feat-busy",
          inUse: true,
        }),
        tier: "in-use",
        defaultChecked: false,
        disabled: false,
        note: "in-use",
        holders: HOLDERS,
        holdersStatus: "ready",
        holdersRevision: "rev-1",
      },
    ];
    renderDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-busy" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review consequences" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Review this sweep")).toBeTruthy();
    });
    expect(screen.queryByTestId("sweep-typed-confirm")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Stop work & sweep" }),
    ).toBeTruthy();
  });

  it("requires typing sweep only when an unproven row is selected", async () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/review",
          branch: "feat-review",
          inUse: false,
          uncommittedCount: 2,
          prState: "none",
          branchStatus: { ahead: 2, behind: 0, mergedIntoDefault: false },
        }),
        tier: "review",
        defaultChecked: false,
        disabled: false,
        note: "not-landed",
        holders: [],
        holdersStatus: "none",
      },
    ];
    renderDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-review" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review consequences" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("sweep-typed-confirm")).toBeTruthy();
    });
    const confirm = screen.getByRole("button", { name: "Sweep anyway" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByTestId("sweep-typed-confirm"), {
      target: { value: "sweep" },
    });
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });

  it("renders known holders inside the owning row, not a pooled footer", () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/busy",
          branch: "feat-busy",
          inUse: true,
        }),
        tier: "in-use",
        defaultChecked: false,
        disabled: false,
        note: "in-use",
        holders: HOLDERS,
        holdersStatus: "ready",
        holdersRevision: "rev-1",
      },
    ];
    renderDialog();
    expect(screen.queryByTestId("teardown-disclosure")).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-busy" }),
    );
    expect(screen.getByTestId("teardown-disclosure-inline").textContent).toContain(
      "Terminal agent “Claude Code agent polite-ocelot” is working — will be stopped",
    );
    expect(screen.queryByText("Run directory")).toBeNull();
  });

  it("attributes unknown holders per worktree and discloses stopping", () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/octopus",
          branch: "feat-octopus",
          inUse: true,
        }),
        tier: "in-use",
        defaultChecked: false,
        disabled: false,
        note: "in-use",
        holders: [],
        holdersStatus: "unknown",
      },
    ];
    renderDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-octopus" }),
    );
    expect(screen.getByTestId("teardown-disclosure-inline").textContent).toContain(
      formatUnknownHolderConsequence("feat-octopus"),
    );
  });

  it("select-all includes unproven rows, excludes in-use, and deselect-all clears in-use", () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/idle",
          branch: "feat-idle",
          inUse: false,
        }),
        tier: "merged",
        defaultChecked: true,
        disabled: false,
        note: null,
        holders: [],
        holdersStatus: "none",
      },
      {
        entry: worktreeEntry({
          worktreePath: "/wt/review",
          branch: "feat-review",
          inUse: false,
          uncommittedCount: 1,
          prState: "none",
        }),
        tier: "review",
        defaultChecked: false,
        disabled: false,
        note: "not-landed",
        holders: [],
        holdersStatus: "none",
      },
      {
        entry: worktreeEntry({
          worktreePath: "/wt/busy",
          branch: "feat-busy",
          inUse: true,
        }),
        tier: "in-use",
        defaultChecked: false,
        disabled: false,
        note: "in-use",
        holders: HOLDERS,
        holdersStatus: "ready",
        holdersRevision: "rev-1",
      },
    ];
    renderDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-busy" }),
    );
    expect(
      screen
        .getByRole("checkbox", { name: "Sweep worktree feat-busy" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByTestId("sweep-worktrees-select-all"));
    expect(
      screen
        .getByRole("checkbox", { name: "Sweep worktree feat-review" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("checkbox", { name: "Sweep worktree feat-busy" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Deselect all" }));
    expect(
      screen
        .getByRole("checkbox", { name: "Sweep worktree feat-busy" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("drops a checked override when an idle row refreshes to in-use", async () => {
    const idle = {
      entry: worktreeEntry({
        worktreePath: "/wt/flip",
        branch: "feat-flip",
        inUse: false,
      }),
      tier: "merged" as const,
      defaultChecked: false,
      disabled: false,
      note: null,
      holders: [] as const,
      holdersStatus: "none" as const,
    };
    testState.rows = [idle];
    const { rerender } = render(
      <SweepWorktreesDialog
        epicIds={["epic-1"]}
        hostClient={null}
        taskTitle="Task"
        onOpenChange={vi.fn()}
      />,
    );
    const checkbox = () =>
      screen.getByRole("checkbox", { name: "Sweep worktree feat-flip" });
    fireEvent.click(checkbox());
    expect(checkbox().getAttribute("aria-checked")).toBe("true");
    testState.rows = [
      {
        ...idle,
        entry: worktreeEntry({
          worktreePath: "/wt/flip",
          branch: "feat-flip",
          inUse: true,
        }),
        tier: "in-use",
        note: "in-use",
        holdersStatus: "unknown",
      },
    ];
    rerender(
      <SweepWorktreesDialog
        epicIds={["epic-1"]}
        hostClient={null}
        taskTitle="Task"
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(checkbox().getAttribute("aria-checked")).toBe("false");
    });
  });

  it("clears consent when a path vanishes from a completed snapshot then reappears in-use", async () => {
    const idle = {
      entry: worktreeEntry({
        worktreePath: "/wt/flip",
        branch: "feat-flip",
        inUse: false,
      }),
      tier: "merged" as const,
      defaultChecked: false,
      disabled: false,
      note: null,
      holders: [] as const,
      holdersStatus: "none" as const,
    };
    testState.rows = [idle];
    const { rerender } = render(
      <SweepWorktreesDialog
        epicIds={["epic-1"]}
        hostClient={null}
        taskTitle="Task"
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-flip" }),
    );
    testState.rows = [];
    rerender(
      <SweepWorktreesDialog
        epicIds={["epic-1"]}
        hostClient={null}
        taskTitle="Task"
        onOpenChange={vi.fn()}
      />,
    );
    testState.rows = [
      {
        ...idle,
        entry: worktreeEntry({
          worktreePath: "/wt/flip",
          branch: "feat-flip",
          inUse: true,
        }),
        tier: "in-use",
        note: "in-use",
        holdersStatus: "unknown",
      },
    ];
    rerender(
      <SweepWorktreesDialog
        epicIds={["epic-1"]}
        hostClient={null}
        taskTitle="Task"
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        screen
          .getByRole("checkbox", { name: "Sweep worktree feat-flip" })
          .getAttribute("aria-checked"),
      ).toBe("false");
    });
  });

  it("returns to review with What is running changed when holders change", async () => {
    testState.holdersChanged = [
      {
        worktreePath: "/wt/busy",
        holders: HOLDERS,
        holdersRevision: "rev-2",
      },
    ];
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/busy",
          branch: "feat-busy",
          inUse: true,
        }),
        tier: "in-use",
        defaultChecked: false,
        disabled: false,
        note: "in-use",
        holders: HOLDERS,
        holdersStatus: "ready",
        holdersRevision: "rev-1",
      },
    ];
    renderDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-busy" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review consequences" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Review this sweep")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop work & sweep" }));
    await waitFor(() => {
      expect(screen.getByTestId("sweep-inventory-changed").textContent).toContain(
        "What is running changed",
      );
    });
    expect(screen.getByText("Review this sweep")).toBeTruthy();
  });

  it("Back from review preserves selection; Escape is owned by the dialog", async () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/busy",
          branch: "feat-busy",
          inUse: true,
        }),
        tier: "in-use",
        defaultChecked: false,
        disabled: false,
        note: "in-use",
        holders: HOLDERS,
        holdersStatus: "ready",
        holdersRevision: "rev-1",
      },
    ];
    renderDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-busy" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review consequences" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("sweep-worktrees-back")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("sweep-worktrees-back"));
    expect(
      screen
        .getByRole("checkbox", { name: "Sweep worktree feat-busy" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("echoes expectedHoldersRevision on the in-use kickoff", async () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/busy",
          branch: "feat-busy",
          inUse: true,
        }),
        tier: "in-use",
        defaultChecked: false,
        disabled: false,
        note: "in-use",
        holders: HOLDERS,
        holdersStatus: "ready",
        holdersRevision: "rev-1",
      },
    ];
    renderDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sweep worktree feat-busy" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review consequences" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Stop work & sweep" }),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop work & sweep" }));
    expect(testState.mutate).toHaveBeenCalledTimes(1);
    expect(
      testState.lastVariables.worktrees[0]?.expectedHoldersRevision,
    ).toBe("rev-1");
  });

  it("shows the safe-summary copy for a proven-idle selection", () => {
    testState.rows = [
      {
        entry: worktreeEntry({
          worktreePath: "/wt/idle",
          branch: "feat-idle",
          inUse: false,
        }),
        tier: "merged",
        defaultChecked: true,
        disabled: false,
        note: null,
        holders: [],
        holdersStatus: "none",
      },
    ];
    renderDialog();
    expect(screen.getByTestId("sweep-worktrees-safe-summary").textContent).toBe(
      "1 worktree and 1 local branch will be removed. Nothing is running in them, and no unmerged work was found.",
    );
  });
});
