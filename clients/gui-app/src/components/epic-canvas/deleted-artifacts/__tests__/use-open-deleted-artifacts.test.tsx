import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deletedArtifactsTileId } from "@/stores/epics/canvas/tile-schema/deleted-artifacts-tile";
import type { EpicCanvasTileRef } from "@/stores/epics/canvas/types";

const navigation = vi.hoisted(() => ({
  openTileInEpic: vi.fn<(epicId: string, node: EpicCanvasTileRef) => null>(
    () => null,
  ),
}));

vi.mock("@/hooks/epic/use-epic-tile-navigation", () => ({
  useEpicTileNavigation: () => navigation,
}));

import { useOpenDeletedArtifacts } from "../use-open-deleted-artifacts";

describe("useOpenDeletedArtifacts", () => {
  beforeEach(() => navigation.openTileInEpic.mockClear());

  it("reopens with the same content id so the canvas focuses the existing tile", () => {
    const { result } = renderHook(() =>
      useOpenDeletedArtifacts("epic-a", "host-a"),
    );

    result.current();
    result.current();

    expect(navigation.openTileInEpic).toHaveBeenCalledTimes(2);
    const first = navigation.openTileInEpic.mock.calls[0][1];
    const second = navigation.openTileInEpic.mock.calls[1][1];
    expect(first.id).toBe(deletedArtifactsTileId("epic-a"));
    expect(second.id).toBe(first.id);
    expect(second.instanceId).not.toBe(first.instanceId);
  });

  it("does not open without a session host", () => {
    const { result } = renderHook(() =>
      useOpenDeletedArtifacts("epic-a", null),
    );

    result.current();

    expect(navigation.openTileInEpic).not.toHaveBeenCalled();
  });
});
