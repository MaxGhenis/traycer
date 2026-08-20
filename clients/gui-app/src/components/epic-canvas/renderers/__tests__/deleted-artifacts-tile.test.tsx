import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletedArtifactEntry } from "@traycer/protocol/host/epic/artifact-versions";
import { makeDeletedArtifactsTileRef } from "@/stores/epics/canvas/tile-schema/deleted-artifacts-tile";

const state = vi.hoisted(() => ({
  entries: [] as DeletedArtifactEntry[],
  loading: false,
  error: false,
  pendingArtifactId: null as string | null,
  mutations: [] as Array<{
    readonly epicId: string;
    readonly artifactId: string;
  }>,
}));

vi.mock("@/hooks/host/use-tab-host-client", () => ({
  useTabHostClient: () => null,
}));

vi.mock("@/hooks/host/use-host-query", () => ({
  useHostQuery: () => ({
    data: { entries: state.entries },
    isLoading: state.loading,
    isError: state.error,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/host/use-host-scoped-mutation", () => ({
  useHostScopedMutationForClient: () => ({
    isPending: state.pendingArtifactId !== null,
    variables: { artifactId: state.pendingArtifactId ?? "" },
    mutate: (variables: {
      readonly epicId: string;
      readonly artifactId: string;
    }) => {
      state.mutations.push(variables);
    },
  }),
}));

import { DeletedArtifactsTile } from "../deleted-artifacts-tile";

const EPIC_ID = "epic-a";

function renderTile(): void {
  render(
    <DeletedArtifactsTile
      node={makeDeletedArtifactsTileRef(EPIC_ID, "host-a")}
    />,
  );
}

describe("<DeletedArtifactsTile />", () => {
  beforeEach(() => {
    state.entries = [];
    state.loading = false;
    state.error = false;
    state.pendingArtifactId = null;
    state.mutations = [];
  });

  afterEach(cleanup);

  it("renders an epic-scoped empty state", () => {
    renderTile();

    expect(screen.getByText("No deleted artifacts")).toBeTruthy();
    expect(
      screen.getByText(
        "Restore artifacts retained in this epic's version history.",
      ),
    ).toBeTruthy();
  });

  it("restores a retained artifact", () => {
    state.entries = [
      {
        artifactId: "artifact-a",
        title: "Recovered plan",
        deletedAt: 1_700_000_000_000,
        versionCount: 3,
        lastContentHash: "a".repeat(64),
        unrestorable: null,
      },
    ];
    renderTile();

    fireEvent.click(screen.getByRole("button", { name: "Restore artifact" }));

    expect(state.mutations).toEqual([
      { epicId: EPIC_ID, artifactId: "artifact-a" },
    ]);
  });

  it("explains and disables unrecoverable entries", () => {
    state.entries = [
      {
        artifactId: "artifact-scalars",
        title: "Lost metadata",
        deletedAt: 1_700_000_000_000,
        versionCount: 2,
        lastContentHash: "a".repeat(64),
        unrestorable: "missing_scalars",
      },
      {
        artifactId: "artifact-blob",
        title: "Lost body",
        deletedAt: 1_700_000_100_000,
        versionCount: 1,
        lastContentHash: "b".repeat(64),
        unrestorable: "missing_blob",
      },
    ];
    renderTile();

    expect(
      screen.getByText(
        "Cannot restore: the artifact's title, kind, or tree position is missing.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Cannot restore: the saved artifact body is missing."),
    ).toBeTruthy();
    for (const button of screen.getAllByRole("button", {
      name: "Restore artifact",
    })) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });
});
