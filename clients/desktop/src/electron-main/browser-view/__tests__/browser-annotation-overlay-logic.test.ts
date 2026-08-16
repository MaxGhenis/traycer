import { describe, expect, it } from "vitest";
import type { BrowserAnnotationMarkKind } from "../../../ipc-contracts/browser-annotation-types";
import {
  ANNOTATION_BUNDLE_BYTE_BUDGET,
  ANNOTATION_BUNDLE_ELEMENT_CAP,
  ANNOTATION_TINY_DRAG_PX,
  applyByteBudget,
  canAddElementMark,
  canMutateAnnotation,
  canRequestAttach,
  collapseCompleteDescendantSets,
  countElementMarks,
  eraseNewestAtPoint,
  isContainedInRegion,
  isElementVisuallyPresent,
  isScrollLockArmed,
  isTinyDrag,
  modeFromHotkey,
  normalizeDragRect,
  placeCommentBox,
  resolveRegionSelection,
  serializedCaptureBytes,
  shouldHandleModeHotkey,
  shouldSubmitCommentKey,
  shouldSwallowScrollInput,
  sortSmallestFirst,
  strokeBoundsFromPoints,
  svgPathFromPolygon,
  toMarkSnapshot,
  toggleElementMark,
  unionRects,
  validateElementMark,
  type AnnotationCssRect,
  type OverlayMarkModel,
  type RegionCandidate,
} from "../browser-annotation-overlay-logic";

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
): AnnotationCssRect {
  return { x, y, width, height };
}

function candidate(input: {
  readonly id: string;
  readonly ancestorIds: readonly string[];
  readonly bounds: AnnotationCssRect;
  readonly visible: boolean;
}): RegionCandidate {
  return {
    id: input.id,
    ancestorIds: input.ancestorIds,
    bounds: input.bounds,
    visible: input.visible,
    alreadyMarked: false,
  };
}

function marked(input: {
  readonly id: string;
  readonly ancestorIds: readonly string[];
  readonly bounds: AnnotationCssRect;
  readonly visible: boolean;
}): RegionCandidate {
  return { ...candidate(input), alreadyMarked: true };
}

function mark(input: {
  readonly id: string;
  readonly kind: BrowserAnnotationMarkKind;
  readonly bounds: AnnotationCssRect;
  readonly selector: string | null;
  readonly elementKey: string | null;
}): OverlayMarkModel {
  return {
    id: input.id,
    kind: input.kind,
    bounds: input.bounds,
    selector: input.selector,
    elementKey: input.elementKey,
  };
}

describe("modeFromHotkey", () => {
  it("maps V/R/D/E case-insensitively", () => {
    expect(modeFromHotkey("v")).toBe("select");
    expect(modeFromHotkey("V")).toBe("select");
    expect(modeFromHotkey("r")).toBe("region");
    expect(modeFromHotkey("R")).toBe("region");
    expect(modeFromHotkey("d")).toBe("draw");
    expect(modeFromHotkey("D")).toBe("draw");
    expect(modeFromHotkey("e")).toBe("erase");
    expect(modeFromHotkey("E")).toBe("erase");
  });

  it("returns null for keys that are not mode hotkeys", () => {
    expect(modeFromHotkey("Escape")).toBeNull();
    expect(modeFromHotkey("x")).toBeNull();
    expect(modeFromHotkey("")).toBeNull();
  });
});

describe("shouldHandleModeHotkey", () => {
  const base = {
    key: "v",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    focusInOverlayText: false,
  };

  it("is true for an unscoped mode key", () => {
    expect(shouldHandleModeHotkey(base)).toBe(true);
    expect(shouldHandleModeHotkey({ ...base, key: "R" })).toBe(true);
  });

  it("is false when focus is in overlay text", () => {
    expect(
      shouldHandleModeHotkey({ ...base, focusInOverlayText: true }),
    ).toBe(false);
  });

  it("is false with alt, ctrl, or meta", () => {
    expect(shouldHandleModeHotkey({ ...base, altKey: true })).toBe(false);
    expect(shouldHandleModeHotkey({ ...base, ctrlKey: true })).toBe(false);
    expect(shouldHandleModeHotkey({ ...base, metaKey: true })).toBe(false);
  });

  it("is false for a non-mode key", () => {
    expect(shouldHandleModeHotkey({ ...base, key: "Escape" })).toBe(false);
  });
});

describe("isScrollLockArmed", () => {
  it("is false at zero and true above zero", () => {
    expect(isScrollLockArmed(0)).toBe(false);
    expect(isScrollLockArmed(1)).toBe(true);
    expect(isScrollLockArmed(4)).toBe(true);
  });
});

describe("shouldSwallowScrollInput", () => {
  it("swallows nothing while unlocked", () => {
    expect(
      shouldSwallowScrollInput({
        armed: false,
        kind: "wheel",
        key: null,
        focusInOverlayText: false,
      }),
    ).toBe(false);
    expect(
      shouldSwallowScrollInput({
        armed: false,
        kind: "touchmove",
        key: null,
        focusInOverlayText: false,
      }),
    ).toBe(false);
    expect(
      shouldSwallowScrollInput({
        armed: false,
        kind: "keydown",
        key: "ArrowDown",
        focusInOverlayText: false,
      }),
    ).toBe(false);
  });

  it("swallows wheel and touchmove when armed", () => {
    expect(
      shouldSwallowScrollInput({
        armed: true,
        kind: "wheel",
        key: null,
        focusInOverlayText: false,
      }),
    ).toBe(true);
    expect(
      shouldSwallowScrollInput({
        armed: true,
        kind: "touchmove",
        key: null,
        focusInOverlayText: false,
      }),
    ).toBe(true);
  });

  it("swallows nav keys when armed and focus is not in overlay text", () => {
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
      "Spacebar",
    ]) {
      expect(
        shouldSwallowScrollInput({
          armed: true,
          kind: "keydown",
          key,
          focusInOverlayText: false,
        }),
      ).toBe(true);
    }
    expect(
      shouldSwallowScrollInput({
        armed: true,
        kind: "keydown",
        key: "a",
        focusInOverlayText: false,
      }),
    ).toBe(false);
  });

  it("does not swallow nav keys when armed and focus is in overlay text", () => {
    expect(
      shouldSwallowScrollInput({
        armed: true,
        kind: "keydown",
        key: "ArrowDown",
        focusInOverlayText: true,
      }),
    ).toBe(false);
  });
});

describe("region drag geometry", () => {
  it("exports the tiny-drag threshold of 4 CSS pixels", () => {
    expect(ANNOTATION_TINY_DRAG_PX).toBe(4);
  });

  it("normalizes a drag rect independently of pointer order", () => {
    const forward = normalizeDragRect(10, 20, 4, 6);
    const reverse = normalizeDragRect(4, 6, 10, 20);
    const mixed = normalizeDragRect(10, 6, 4, 20);
    expect(forward).toEqual(rect(4, 6, 6, 14));
    expect(reverse).toEqual(forward);
    expect(mixed).toEqual(forward);
  });

  it("treats a drag as tiny when either edge is under ANNOTATION_TINY_DRAG_PX", () => {
    expect(isTinyDrag(rect(0, 0, 3, 20))).toBe(true);
    expect(isTinyDrag(rect(0, 0, 20, 3))).toBe(true);
    expect(isTinyDrag(rect(0, 0, 3, 3))).toBe(true);
    expect(isTinyDrag(rect(0, 0, ANNOTATION_TINY_DRAG_PX, ANNOTATION_TINY_DRAG_PX))).toBe(
      false,
    );
    expect(isTinyDrag(rect(0, 0, 8, 8))).toBe(false);
  });
});

describe("isContainedInRegion", () => {
  it("accepts a candidate whose center is inside and majority of area overlaps", () => {
    const candidateBox = rect(0, 0, 100, 100);
    const region = rect(0, 0, 80, 80);
    expect(isContainedInRegion(candidateBox, region)).toBe(true);
  });

  it("rejects a candidate whose center is outside the region", () => {
    const candidateBox = rect(0, 0, 100, 100);
    const region = rect(0, 0, 40, 40);
    expect(isContainedInRegion(candidateBox, region)).toBe(false);
  });

  it("rejects a candidate whose center is inside but most of its area is outside", () => {
    const candidateBox = rect(0, 0, 100, 100);
    const region = rect(20, 30, 80, 40);
    expect(isContainedInRegion(candidateBox, region)).toBe(false);
  });

  it("rejects an exact half-overlap even when the center sits on the region edge", () => {
    const candidateBox = rect(0, 0, 100, 100);
    const region = rect(0, 0, 100, 50);
    expect(isContainedInRegion(candidateBox, region)).toBe(false);
  });
});

describe("collapseCompleteDescendantSets", () => {
  it("keeps the parent when the parent and every descendant are selected", () => {
    const card = candidate({
      id: "card",
      ancestorIds: [],
      bounds: rect(0, 0, 200, 200),
      visible: true,
    });
    const fragments = Array.from({ length: 15 }, (_unused, index) =>
      candidate({
        id: `frag-${String(index).padStart(2, "0")}`,
        ancestorIds: ["card"],
        bounds: rect(8 + index * 10, 8, 8, 8),
        visible: true,
      }),
    );
    const collapsed = collapseCompleteDescendantSets([card, ...fragments]);
    expect(collapsed.map((entry) => entry.id)).toEqual(["card"]);
  });

  it("keeps an incomplete child subset when the parent is not selected", () => {
    const children = [
      candidate({
        id: "c1",
        ancestorIds: ["card"],
        bounds: rect(8, 8, 20, 20),
        visible: true,
      }),
      candidate({
        id: "c2",
        ancestorIds: ["card"],
        bounds: rect(40, 8, 20, 20),
        visible: true,
      }),
    ];
    const collapsed = collapseCompleteDescendantSets(children);
    expect(collapsed.map((entry) => entry.id)).toEqual(["c1", "c2"]);
  });

  it("drops a grandchild when the grandparent is selected even if the middle parent is not", () => {
    const grandparent = candidate({
      id: "gp",
      ancestorIds: [],
      bounds: rect(0, 0, 300, 300),
      visible: true,
    });
    const grandchild = candidate({
      id: "gc",
      ancestorIds: ["p", "gp"],
      bounds: rect(40, 40, 20, 20),
      visible: true,
    });
    const collapsed = collapseCompleteDescendantSets([grandparent, grandchild]);
    expect(collapsed.map((entry) => entry.id)).toEqual(["gp"]);
  });
});

describe("sortSmallestFirst", () => {
  it("orders by area then by stable id", () => {
    const big = candidate({
      id: "big",
      ancestorIds: [],
      bounds: rect(0, 0, 100, 100),
      visible: true,
    });
    const small = candidate({
      id: "small",
      ancestorIds: [],
      bounds: rect(0, 0, 10, 10),
      visible: true,
    });
    const tieB = candidate({
      id: "tie-b",
      ancestorIds: [],
      bounds: rect(0, 0, 20, 20),
      visible: true,
    });
    const tieA = candidate({
      id: "tie-a",
      ancestorIds: [],
      bounds: rect(0, 0, 20, 20),
      visible: true,
    });
    expect(sortSmallestFirst([big, tieB, small, tieA]).map((entry) => entry.id)).toEqual(
      ["small", "tie-a", "tie-b", "big"],
    );
  });
});

describe("resolveRegionSelection", () => {
  const covering = rect(0, 0, 400, 400);

  it("exports the bundle element cap of 30", () => {
    expect(ANNOTATION_BUNDLE_ELEMENT_CAP).toBe(30);
  });

  it("returns reason empty when nothing visible is contained", () => {
    const result = resolveRegionSelection({
      candidates: [
        candidate({
          id: "hidden",
          ancestorIds: [],
          bounds: rect(10, 10, 40, 40),
          visible: false,
        }),
        candidate({
          id: "tiny",
          ancestorIds: [],
          bounds: rect(10, 10, 1, 8),
          visible: true,
        }),
        candidate({
          id: "outside",
          ancestorIds: [],
          bounds: rect(500, 500, 40, 40),
          visible: true,
        }),
      ],
      region: rect(0, 0, 80, 80),
      existingElementCount: 0,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result).toEqual({ selected: [], refusedCount: 0, reason: "empty" });
  });

  it("collapses a fully selected card to the parent through the pipeline", () => {
    const card = candidate({
      id: "card",
      ancestorIds: [],
      bounds: rect(0, 0, 200, 200),
      visible: true,
    });
    const fragments = Array.from({ length: 15 }, (_unused, index) =>
      candidate({
        id: `frag-${String(index).padStart(2, "0")}`,
        ancestorIds: ["card"],
        bounds: rect(8 + index * 10, 8, 8, 8),
        visible: true,
      }),
    );
    const result = resolveRegionSelection({
      candidates: [card, ...fragments],
      region: covering,
      existingElementCount: 0,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result.reason).toBe("ok");
    expect(result.refusedCount).toBe(0);
    expect(result.selected.map((entry) => entry.id)).toEqual(["card"]);
  });

  it("keeps an incomplete child subset when the parent is outside the region", () => {
    const card = candidate({
      id: "card",
      ancestorIds: [],
      bounds: rect(0, 0, 200, 200),
      visible: true,
    });
    const c1 = candidate({
      id: "c1",
      ancestorIds: ["card"],
      bounds: rect(4, 4, 24, 24),
      visible: true,
    });
    const c2 = candidate({
      id: "c2",
      ancestorIds: ["card"],
      bounds: rect(36, 4, 24, 24),
      visible: true,
    });
    const result = resolveRegionSelection({
      candidates: [card, c1, c2],
      region: rect(0, 0, 80, 40),
      existingElementCount: 0,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result.reason).toBe("ok");
    expect(result.selected.map((entry) => entry.id)).toEqual(["c1", "c2"]);
  });

  it("drops a grandchild when the grandparent is selected and the middle parent is not contained", () => {
    const grandparent = candidate({
      id: "gp",
      ancestorIds: [],
      bounds: rect(0, 0, 200, 200),
      visible: true,
    });
    const parent = candidate({
      id: "p",
      ancestorIds: ["gp"],
      bounds: rect(180, 0, 100, 20),
      visible: true,
    });
    const grandchild = candidate({
      id: "gc",
      ancestorIds: ["p", "gp"],
      bounds: rect(20, 20, 30, 30),
      visible: true,
    });
    const result = resolveRegionSelection({
      candidates: [grandparent, parent, grandchild],
      region: rect(0, 0, 200, 200),
      existingElementCount: 0,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result.selected.map((entry) => entry.id)).toEqual(["gp"]);
  });

  it("sorts the surviving set smallest-first with id tie-break", () => {
    const result = resolveRegionSelection({
      candidates: [
        candidate({
          id: "big",
          ancestorIds: [],
          bounds: rect(0, 0, 80, 80),
          visible: true,
        }),
        candidate({
          id: "tie-b",
          ancestorIds: [],
          bounds: rect(0, 0, 20, 20),
          visible: true,
        }),
        candidate({
          id: "tie-a",
          ancestorIds: [],
          bounds: rect(10, 10, 20, 20),
          visible: true,
        }),
      ],
      region: covering,
      existingElementCount: 0,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result.selected.map((entry) => entry.id)).toEqual([
      "tie-a",
      "tie-b",
      "big",
    ]);
  });

  it("caps at ANNOTATION_BUNDLE_ELEMENT_CAP and reports refusedCount with reason capped", () => {
    const candidates = Array.from({ length: 35 }, (_unused, index) =>
      candidate({
        id: `el-${String(index).padStart(2, "0")}`,
        ancestorIds: [],
        bounds: rect(index * 4, 0, 8, 8),
        visible: true,
      }),
    );
    const result = resolveRegionSelection({
      candidates,
      region: covering,
      existingElementCount: 0,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result.reason).toBe("capped");
    expect(result.selected).toHaveLength(ANNOTATION_BUNDLE_ELEMENT_CAP);
    expect(result.refusedCount).toBe(5);
    expect(result.selected[0]?.id).toBe("el-00");
    expect(result.selected[29]?.id).toBe("el-29");
  });

  it("counts existingElementCount toward the cap on a second drag", () => {
    const candidates = Array.from({ length: 25 }, (_unused, index) =>
      candidate({
        id: `next-${String(index).padStart(2, "0")}`,
        ancestorIds: [],
        bounds: rect(index * 4, 20, 8, 8),
        visible: true,
      }),
    );
    const result = resolveRegionSelection({
      candidates,
      region: covering,
      existingElementCount: 15,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result.reason).toBe("capped");
    expect(result.selected).toHaveLength(15);
    expect(result.refusedCount).toBe(10);
  });

  it("returns capped with an empty selected set when the existing count already fills the cap", () => {
    const result = resolveRegionSelection({
      candidates: [
        candidate({
          id: "extra",
          ancestorIds: [],
          bounds: rect(0, 0, 20, 20),
          visible: true,
        }),
      ],
      region: covering,
      existingElementCount: ANNOTATION_BUNDLE_ELEMENT_CAP,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result).toEqual({
      selected: [],
      refusedCount: 1,
      reason: "capped",
    });
  });

  it("does not let already-marked elements eat the last cap slot on an overlapping second drag", () => {
    const already: RegionCandidate[] = [];
    for (let index = 0; index < 29; index += 1) {
      already.push(
        marked({
          id: `have-${String(index).padStart(2, "0")}`,
          ancestorIds: [],
          bounds: rect(index * 4, 0, 8, 8),
          visible: true,
        }),
      );
    }
    const freshA = candidate({
      id: "fresh-a",
      ancestorIds: [],
      bounds: rect(0, 40, 8, 8),
      visible: true,
    });
    const freshB = candidate({
      id: "fresh-b",
      ancestorIds: [],
      bounds: rect(20, 40, 8, 8),
      visible: true,
    });
    const result = resolveRegionSelection({
      candidates: [...already, freshA, freshB],
      region: covering,
      existingElementCount: 29,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result.reason).toBe("capped");
    expect(result.selected.map((entry) => entry.id)).toEqual(["fresh-a"]);
    expect(result.refusedCount).toBe(1);
  });

  it("reports empty, not capped, when a second drag only hits already-marked elements", () => {
    const already = marked({
      id: "have",
      ancestorIds: [],
      bounds: rect(0, 0, 40, 40),
      visible: true,
    });
    const result = resolveRegionSelection({
      candidates: [already],
      region: covering,
      existingElementCount: 29,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result).toEqual({ selected: [], refusedCount: 0, reason: "empty" });
  });

  it("collapses a new child into an already-marked parent before applying the cap", () => {
    const parent = marked({
      id: "card",
      ancestorIds: [],
      bounds: rect(0, 0, 200, 200),
      visible: true,
    });
    const child = candidate({
      id: "frag",
      ancestorIds: ["card"],
      bounds: rect(8, 8, 16, 16),
      visible: true,
    });
    const result = resolveRegionSelection({
      candidates: [parent, child],
      region: covering,
      existingElementCount: 29,
      elementCap: ANNOTATION_BUNDLE_ELEMENT_CAP,
    });
    expect(result).toEqual({ selected: [], refusedCount: 0, reason: "empty" });
  });
});

describe("marks stack", () => {
  const elementA = mark({
    id: "el-a",
    kind: "element",
    bounds: rect(0, 0, 100, 100),
    selector: "h1",
    elementKey: "key-a",
  });
  const regionB = mark({
    id: "rg-b",
    kind: "region",
    bounds: rect(50, 50, 80, 80),
    selector: null,
    elementKey: null,
  });
  const strokeC = mark({
    id: "st-c",
    kind: "stroke",
    bounds: rect(80, 80, 30, 30),
    selector: null,
    elementKey: null,
  });

  it("erases newest-first across mixed element, region, and stroke marks", () => {
    const stacked = [elementA, regionB, strokeC];
    const first = eraseNewestAtPoint(stacked, 90, 90);
    expect(first.removed?.id).toBe("st-c");
    expect(first.marks.map((entry) => entry.id)).toEqual(["el-a", "rg-b"]);
    const second = eraseNewestAtPoint(first.marks, 90, 90);
    expect(second.removed?.id).toBe("rg-b");
    expect(second.marks.map((entry) => entry.id)).toEqual(["el-a"]);
    const third = eraseNewestAtPoint(second.marks, 10, 10);
    expect(third.removed?.id).toBe("el-a");
    expect(third.marks).toEqual([]);
  });

  it("lets the newer mark win when two bounds overlap the same point", () => {
    const older = mark({
      id: "older",
      kind: "region",
      bounds: rect(0, 0, 100, 100),
      selector: null,
      elementKey: null,
    });
    const newer = mark({
      id: "newer",
      kind: "element",
      bounds: rect(0, 0, 100, 100),
      selector: "div",
      elementKey: "key-newer",
    });
    const hit = eraseNewestAtPoint([older, newer], 40, 40);
    expect(hit.removed?.id).toBe("newer");
    expect(hit.marks.map((entry) => entry.id)).toEqual(["older"]);
  });

  it("leaves the stack unchanged on a miss", () => {
    const stacked = [elementA, regionB, strokeC];
    const miss = eraseNewestAtPoint(stacked, 400, 400);
    expect(miss.removed).toBeNull();
    expect(miss.marks).toEqual(stacked);
    expect(miss.marks).not.toBe(stacked);
  });

  it("toggles an element mark off when the same elementKey is selected again", () => {
    const spec = {
      id: "el-1",
      elementKey: "node-7",
      bounds: rect(4, 8, 16, 16),
      selector: "main > button",
    };
    const added = toggleElementMark([], spec);
    expect(added).toHaveLength(1);
    expect(added[0]).toEqual(
      mark({
        id: "el-1",
        kind: "element",
        bounds: spec.bounds,
        selector: spec.selector,
        elementKey: spec.elementKey,
      }),
    );
    const removed = toggleElementMark(added, { ...spec, id: "el-2" });
    expect(removed).toEqual([]);
  });

  it("counts only element marks toward the bundle cap", () => {
    const elements = Array.from({ length: 28 }, (_unused, index) =>
      mark({
        id: `el-${index}`,
        kind: "element",
        bounds: rect(index, 0, 8, 8),
        selector: "div",
        elementKey: `key-${index}`,
      }),
    );
    const mixed = [
      ...elements,
      mark({
        id: "rg",
        kind: "region",
        bounds: rect(0, 0, 40, 40),
        selector: null,
        elementKey: null,
      }),
      mark({
        id: "st",
        kind: "stroke",
        bounds: rect(0, 0, 12, 12),
        selector: null,
        elementKey: null,
      }),
    ];
    expect(countElementMarks(mixed)).toBe(28);
    expect(canAddElementMark(mixed, ANNOTATION_BUNDLE_ELEMENT_CAP)).toBe(true);
    const atCap = [
      ...mixed,
      mark({
        id: "el-28",
        kind: "element",
        bounds: rect(28, 0, 8, 8),
        selector: "div",
        elementKey: "key-28",
      }),
      mark({
        id: "el-29",
        kind: "element",
        bounds: rect(29, 0, 8, 8),
        selector: "div",
        elementKey: "key-29",
      }),
    ];
    expect(countElementMarks(atCap)).toBe(ANNOTATION_BUNDLE_ELEMENT_CAP);
    expect(canAddElementMark(atCap, ANNOTATION_BUNDLE_ELEMENT_CAP)).toBe(false);
  });

  it("arms scroll lock from the stack length and disarms when the last mark is erased", () => {
    expect(isScrollLockArmed([].length)).toBe(false);
    const one = [elementA];
    expect(isScrollLockArmed(one.length)).toBe(true);
    const afterMiss = eraseNewestAtPoint(one, 500, 500);
    expect(isScrollLockArmed(afterMiss.marks.length)).toBe(true);
    const afterHit = eraseNewestAtPoint(one, 10, 10);
    expect(afterHit.marks).toEqual([]);
    expect(isScrollLockArmed(afterHit.marks.length)).toBe(false);
  });
});

describe("element mark validation", () => {
  const box = rect(10, 20, 40, 30);

  it("flags a disconnected element", () => {
    expect(
      validateElementMark({
        connected: false,
        visible: true,
        currentBox: box,
        markBox: box,
      }),
    ).toBe("disconnected");
  });

  it("flags display none, visibility hidden/collapse, opacity 0, and zero size as hidden", () => {
    const present = {
      connected: true,
      width: 12,
      height: 12,
      display: "block",
      visibility: "visible",
      opacity: 1,
    };
    expect(isElementVisuallyPresent(present)).toBe(true);
    expect(
      isElementVisuallyPresent({ ...present, display: "none" }),
    ).toBe(false);
    expect(
      isElementVisuallyPresent({ ...present, visibility: "hidden" }),
    ).toBe(false);
    expect(
      isElementVisuallyPresent({ ...present, visibility: "collapse" }),
    ).toBe(false);
    expect(isElementVisuallyPresent({ ...present, opacity: 0 })).toBe(false);
    expect(isElementVisuallyPresent({ ...present, width: 0 })).toBe(false);
    expect(isElementVisuallyPresent({ ...present, height: 0 })).toBe(false);

    expect(
      validateElementMark({
        connected: true,
        visible: isElementVisuallyPresent({ ...present, display: "none" }),
        currentBox: box,
        markBox: box,
      }),
    ).toBe("hidden");
  });

  it("flags a moved element that no longer overlaps its mark", () => {
    expect(
      validateElementMark({
        connected: true,
        visible: true,
        currentBox: rect(200, 200, 20, 20),
        markBox: box,
      }),
    ).toBe("moved");
  });

  it("keeps a still-overlapping element as ok", () => {
    expect(
      validateElementMark({
        connected: true,
        visible: true,
        currentBox: rect(40, 40, 20, 20),
        markBox: box,
      }),
    ).toBe("ok");
  });
});

describe("toMarkSnapshot", () => {
  it("forces stroke and region selectors to null and never emits points", () => {
    const stroke = toMarkSnapshot(
      mark({
        id: "st",
        kind: "stroke",
        bounds: rect(1, 2, 3, 4),
        selector: "canvas",
        elementKey: "ignored",
      }),
    );
    const region = toMarkSnapshot(
      mark({
        id: "rg",
        kind: "region",
        bounds: rect(5, 6, 7, 8),
        selector: "section",
        elementKey: null,
      }),
    );
    const element = toMarkSnapshot(
      mark({
        id: "el",
        kind: "element",
        bounds: rect(9, 10, 11, 12),
        selector: "main > h1",
        elementKey: "key-el",
      }),
    );
    expect(stroke).toEqual({
      id: "st",
      kind: "stroke",
      bounds: rect(1, 2, 3, 4),
      selector: null,
    });
    expect(region).toEqual({
      id: "rg",
      kind: "region",
      bounds: rect(5, 6, 7, 8),
      selector: null,
    });
    expect(element.selector).toBe("main > h1");
    expect(Object.keys(stroke)).toEqual(["id", "kind", "bounds", "selector"]);
    expect(stroke).not.toHaveProperty("points");
    expect(element).not.toHaveProperty("elementKey");
    expect(element).not.toHaveProperty("points");
  });
});

describe("applyByteBudget", () => {
  it("exports the 256_000 byte budget", () => {
    expect(ANNOTATION_BUNDLE_BYTE_BUDGET).toBe(256_000);
  });

  it("keeps earlier items and refuses those that would exceed the bundle budget", () => {
    const item = { blob: "a".repeat(100_000) };
    const size = serializedCaptureBytes(item);
    expect(size * 2).toBeLessThan(ANNOTATION_BUNDLE_BYTE_BUDGET);
    expect(size * 3).toBeGreaterThan(ANNOTATION_BUNDLE_BYTE_BUDGET);
    const result = applyByteBudget({
      items: [item, item, item],
      existingBytes: 0,
      budget: ANNOTATION_BUNDLE_BYTE_BUDGET,
    });
    expect(result.kept).toHaveLength(2);
    expect(result.refusedCount).toBe(1);
  });

  it("counts existingBytes toward the budget", () => {
    const item = { blob: "b".repeat(1_000) };
    const result = applyByteBudget({
      items: [item],
      existingBytes: ANNOTATION_BUNDLE_BYTE_BUDGET - 10,
      budget: ANNOTATION_BUNDLE_BYTE_BUDGET,
    });
    expect(result.kept).toEqual([]);
    expect(result.refusedCount).toBe(1);
  });

  it("counts UTF-8 bytes, not UTF-16 code units, at the budget boundary", () => {
    const euro = "€";
    expect(euro.length).toBe(1);
    expect(new TextEncoder().encode(euro).byteLength).toBe(3);
    const payload = { text: euro.repeat(100) };
    const units = JSON.stringify(payload).length;
    const bytes = serializedCaptureBytes(payload);
    expect(bytes).toBeGreaterThan(units);
    const result = applyByteBudget({
      items: [payload],
      existingBytes: ANNOTATION_BUNDLE_BYTE_BUDGET - units - 1,
      budget: ANNOTATION_BUNDLE_BYTE_BUDGET,
    });
    expect(result.kept).toEqual([]);
    expect(result.refusedCount).toBe(1);
  });
});

describe("attach pending guards", () => {
  it("rejects a second attach while one is already pending", () => {
    expect(
      canRequestAttach({ attachPending: false, markCount: 2 }),
    ).toBe(true);
    expect(
      canRequestAttach({ attachPending: true, markCount: 2 }),
    ).toBe(false);
    expect(
      canRequestAttach({ attachPending: false, markCount: 0 }),
    ).toBe(false);
  });

  it("blocks mark mutations while capture is deferred", () => {
    expect(canMutateAnnotation(false)).toBe(true);
    expect(canMutateAnnotation(true)).toBe(false);
  });
});

describe("unionRects", () => {
  it("returns null for an empty list and unions mixed mark bounds", () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        rect(0, 0, 10, 10),
        rect(20, 5, 10, 10),
        rect(5, 20, 10, 5),
      ]),
    ).toEqual(rect(0, 0, 30, 25));
  });
});

describe("placeCommentBox", () => {
  const viewport = { width: 800, height: 600 };
  const box = { width: 200, height: 80 };

  it("prefers placing the box below the union and clamps x into the viewport", () => {
    const placed = placeCommentBox({
      union: rect(-40, 100, 50, 40),
      viewport,
      box,
      pillBottom: 40,
    });
    expect(placed.usedFallback).toBe(false);
    expect(placed.y).toBe(148);
    expect(placed.x).toBe(12);
  });

  it("falls back to a corner when the union cannot host the box above or below", () => {
    const placed = placeCommentBox({
      union: rect(10, 10, 380, 280),
      viewport: { width: 400, height: 300 },
      box,
      pillBottom: 40,
    });
    expect(placed.usedFallback).toBe(true);
    expect(placed.x).toBe(400 - 200 - 12);
    expect(placed.y).toBe(300 - 80 - 12);
  });

  it("uses the corner fallback when there is no union yet", () => {
    const placed = placeCommentBox({
      union: null,
      viewport,
      box,
      pillBottom: 40,
    });
    expect(placed).toEqual({
      x: 800 - 200 - 12,
      y: 600 - 80 - 12,
      usedFallback: true,
    });
  });
});

describe("shouldSubmitCommentKey", () => {
  const base = {
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };

  it("submits on unmodified Enter and not on Shift+Enter", () => {
    expect(shouldSubmitCommentKey(base)).toBe(true);
    expect(shouldSubmitCommentKey({ ...base, shiftKey: true })).toBe(false);
    expect(shouldSubmitCommentKey({ ...base, altKey: true })).toBe(false);
    expect(shouldSubmitCommentKey({ ...base, ctrlKey: true })).toBe(false);
    expect(shouldSubmitCommentKey({ ...base, metaKey: true })).toBe(false);
    expect(shouldSubmitCommentKey({ ...base, key: "e" })).toBe(false);
  });
});

describe("stroke geometry helpers", () => {
  it("builds a closed SVG path from a polygon and an empty string from none", () => {
    expect(svgPathFromPolygon([])).toBe("");
    const path = svgPathFromPolygon([
      [1, 2],
      [5, 2],
      [5, 6],
    ]);
    expect(path.startsWith("M 1 2 Q")).toBe(true);
    expect(path.endsWith(" Z")).toBe(true);
  });

  it("pads stroke bounds from raw points and returns null for an empty stroke", () => {
    expect(strokeBoundsFromPoints([], 8)).toBeNull();
    expect(
      strokeBoundsFromPoints(
        [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
        8,
      ),
    ).toEqual(rect(2, 12, 36, 36));
  });
});
