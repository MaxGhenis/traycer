import { afterEach, describe, expect, it } from "vitest";
import { sanitizePersistedCanvasState } from "@/stores/epics/canvas/canvas-persistence";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";

describe("canvas Phase-migration persistence", () => {
  it("restores the persisted slot-local migration mode", () => {
    const state = sanitizePersistedCanvasState({
      tabsById: {
        "phase-tab": {
          tabId: "phase-tab",
          epicId: "phase-1",
          name: "Legacy Phase",
          surfaceMode: { kind: "phase-migration", phaseId: "phase-1" },
        },
      },
      canvasByTabId: {},
      openTabOrder: ["phase-tab"],
      activeTabId: "phase-tab",
      mostRecentTabIdByEpicId: { "phase-1": "phase-tab" },
      artifactTreeByEpicId: {},
    });

    expect(state.tabsById["phase-tab"]?.surfaceMode).toEqual({
      kind: "phase-migration",
      phaseId: "phase-1",
    });
  });
});

describe("canvas PiP geometry persistence", () => {
  afterEach(() => {
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  });

  it("keeps well-formed pipGeometryByEpicId and drops malformed entries", () => {
    const state = sanitizePersistedCanvasState({
      tabsById: {},
      pipGeometryByEpicId: {
        "epic-good": { x: 12, y: 24, width: 320, height: 200 },
        "epic-string": { x: "12", y: 24, width: 320, height: 200 },
        "epic-nan": { x: Number.NaN, y: 24, width: 320, height: 200 },
        "epic-missing": { x: 12, y: 24, width: 320 },
        "epic-not-object": "nope",
      },
    });

    expect(state.pipGeometryByEpicId).toEqual({
      "epic-good": { x: 12, y: 24, width: 320, height: 200 },
    });
  });

  it("setPipGeometry writes pipGeometryByEpicId", () => {
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    useEpicCanvasStore.getState().setPipGeometry("epic-1", {
      x: 40,
      y: 80,
      width: 320,
      height: 200,
    });
    expect(useEpicCanvasStore.getState().pipGeometryByEpicId["epic-1"]).toEqual({
      x: 40,
      y: 80,
      width: 320,
      height: 200,
    });
  });
});
