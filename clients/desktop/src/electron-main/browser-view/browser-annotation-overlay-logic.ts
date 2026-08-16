import type {
  BrowserAnnotationCssRect,
  BrowserAnnotationMarkKind,
  BrowserAnnotationMarkSnapshot,
  BrowserAnnotationMode,
} from "../../ipc-contracts/browser-annotation-types";

export const ANNOTATION_MODES: readonly BrowserAnnotationMode[] = [
  "select",
  "region",
  "draw",
  "erase",
];

export const ANNOTATION_BUNDLE_ELEMENT_CAP = 30;
export const ANNOTATION_BUNDLE_BYTE_BUDGET = 256_000;
export const ANNOTATION_TINY_DRAG_PX = 4;
export const ANNOTATION_STROKE_SIZE_PX = 4;
export const ANNOTATION_STROKE_HALO_SIZE_PX = 8;

const MODE_BY_HOTKEY: Readonly<Record<string, BrowserAnnotationMode>> = {
  v: "select",
  r: "region",
  d: "draw",
  e: "erase",
};

const SCROLL_LOCK_NAV_KEYS = new Set<string>([
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
]);

export function isAnnotationMode(value: string): value is BrowserAnnotationMode {
  return (
    value === "select" ||
    value === "region" ||
    value === "draw" ||
    value === "erase"
  );
}

export function modeFromHotkey(key: string): BrowserAnnotationMode | null {
  const mapped = MODE_BY_HOTKEY[key.toLowerCase()];
  return mapped === undefined ? null : mapped;
}

/**
 * V/R/D/E only while the page canvas has focus: no comment-box typing, and
 * no ctrl/meta/alt (so browser/page shortcuts are not stolen).
 */
export function shouldHandleModeHotkey(input: {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly focusInOverlayText: boolean;
}): boolean {
  if (input.focusInOverlayText) return false;
  if (input.altKey || input.ctrlKey || input.metaKey) return false;
  return modeFromHotkey(input.key) !== null;
}

export function isScrollLockArmed(markCount: number): boolean {
  return markCount > 0;
}

export function isScrollLockNavKey(key: string): boolean {
  return SCROLL_LOCK_NAV_KEYS.has(key);
}

/**
 * Wheel / pinch-zoom / touch-scroll / nav keys are swallowed only while
 * unattached marks exist. Ctrl/meta+wheel is zoom and is part of that lock.
 */
export function shouldSwallowScrollInput(input: {
  readonly armed: boolean;
  readonly kind: "wheel" | "touchmove" | "keydown";
  readonly key: string | null;
  readonly focusInOverlayText: boolean;
}): boolean {
  if (!input.armed) return false;
  if (input.kind === "wheel" || input.kind === "touchmove") return true;
  if (input.focusInOverlayText) return false;
  return input.key !== null && isScrollLockNavKey(input.key);
}

export type AnnotationCssRect = BrowserAnnotationCssRect;

export interface OverlayMarkModel {
  readonly id: string;
  readonly kind: BrowserAnnotationMarkKind;
  readonly bounds: AnnotationCssRect;
  readonly selector: string | null;
  readonly elementKey: string | null;
}

export interface RegionCandidate {
  readonly id: string;
  readonly ancestorIds: readonly string[];
  readonly bounds: AnnotationCssRect;
  readonly visible: boolean;
  readonly alreadyMarked: boolean;
}

export interface RegionResolveResult {
  readonly selected: readonly RegionCandidate[];
  readonly refusedCount: number;
  readonly reason: "empty" | "capped" | "ok";
}

export interface CommentBoxPlacement {
  readonly x: number;
  readonly y: number;
  readonly usedFallback: boolean;
}

export type ElementMarkValidation =
  | "ok"
  | "disconnected"
  | "hidden"
  | "moved";

export function normalizeDragRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): AnnotationCssRect {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  return {
    x,
    y,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function isTinyDrag(rect: AnnotationCssRect): boolean {
  return (
    rect.width < ANNOTATION_TINY_DRAG_PX || rect.height < ANNOTATION_TINY_DRAG_PX
  );
}

export function rectArea(rect: AnnotationCssRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function rectIntersection(
  a: AnnotationCssRect,
  b: AnnotationCssRect,
): AnnotationCssRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function pointInRect(
  x: number,
  y: number,
  rect: AnnotationCssRect,
): boolean {
  return (
    x >= rect.x &&
    y >= rect.y &&
    x <= rect.x + rect.width &&
    y <= rect.y + rect.height
  );
}

export function rectsOverlap(
  a: AnnotationCssRect,
  b: AnnotationCssRect,
): boolean {
  return rectIntersection(a, b) !== null;
}

export function centerOf(rect: AnnotationCssRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Containment: the candidate's center is inside the region AND a majority
 * of the candidate's area is inside the region.
 */
export function isContainedInRegion(
  candidate: AnnotationCssRect,
  region: AnnotationCssRect,
): boolean {
  const center = centerOf(candidate);
  if (!pointInRect(center.x, center.y, region)) return false;
  const overlap = rectIntersection(candidate, region);
  if (overlap === null) return false;
  const area = rectArea(candidate);
  if (area <= 0) return false;
  return rectArea(overlap) / area > 0.5;
}

export function isVisibleRegionCandidate(input: {
  readonly visible: boolean;
  readonly bounds: AnnotationCssRect;
}): boolean {
  if (!input.visible) return false;
  return input.bounds.width >= 2 && input.bounds.height >= 2;
}

/**
 * When a parent and its descendants all qualify, keep the parent
 * (a card, not fifteen fragments). Equivalent to dropping any
 * candidate that has a selected ancestor.
 */
export function collapseCompleteDescendantSets(
  candidates: readonly RegionCandidate[],
): RegionCandidate[] {
  const selectedIds = new Set(candidates.map((candidate) => candidate.id));
  return candidates.filter((candidate) => {
    for (const ancestorId of candidate.ancestorIds) {
      if (selectedIds.has(ancestorId)) return false;
    }
    return true;
  });
}

export function sortSmallestFirst(
  candidates: readonly RegionCandidate[],
): RegionCandidate[] {
  return [...candidates].sort((left, right) => {
    const areaDelta = rectArea(left.bounds) - rectArea(right.bounds);
    if (areaDelta !== 0) return areaDelta;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/**
 * Visible candidates -> containment -> include already-marked
 * representatives -> collapse complete descendant sets to parent ->
 * drop already-marked -> smallest-first -> bundle-wide element cap.
 */
export function resolveRegionSelection(input: {
  readonly candidates: readonly RegionCandidate[];
  readonly region: AnnotationCssRect;
  readonly existingElementCount: number;
  readonly elementCap: number;
}): RegionResolveResult {
  const visible = input.candidates.filter((candidate) =>
    isVisibleRegionCandidate(candidate),
  );
  const contained = visible.filter((candidate) =>
    isContainedInRegion(candidate.bounds, input.region),
  );
  const alreadyMarked = input.candidates.filter(
    (candidate) => candidate.alreadyMarked,
  );
  const forCollapse = mergeCandidatesById(contained, alreadyMarked);
  const collapsed = collapseCompleteDescendantSets(forCollapse);
  const fresh = collapsed.filter((candidate) => !candidate.alreadyMarked);
  const ordered = sortSmallestFirst(fresh);
  if (ordered.length === 0) {
    return { selected: [], refusedCount: 0, reason: "empty" };
  }
  const remaining = Math.max(0, input.elementCap - input.existingElementCount);
  const selected = ordered.slice(0, remaining);
  const refusedCount = ordered.length - selected.length;
  return {
    selected,
    refusedCount,
    reason: refusedCount > 0 ? "capped" : "ok",
  };
}

function mergeCandidatesById(
  primary: readonly RegionCandidate[],
  extra: readonly RegionCandidate[],
): RegionCandidate[] {
  const byId = new Map<string, RegionCandidate>();
  for (const candidate of primary) {
    byId.set(candidate.id, candidate);
  }
  for (const candidate of extra) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
}

export function countElementMarks(marks: readonly OverlayMarkModel[]): number {
  let count = 0;
  for (const mark of marks) {
    if (mark.kind === "element") count += 1;
  }
  return count;
}

export function addMark(
  marks: readonly OverlayMarkModel[],
  mark: OverlayMarkModel,
): OverlayMarkModel[] {
  return [...marks, mark];
}

export function removeMarkById(
  marks: readonly OverlayMarkModel[],
  id: string,
): OverlayMarkModel[] {
  return marks.filter((mark) => mark.id !== id);
}

export function toggleElementMark(
  marks: readonly OverlayMarkModel[],
  spec: {
    readonly id: string;
    readonly elementKey: string;
    readonly bounds: AnnotationCssRect;
    readonly selector: string;
  },
): OverlayMarkModel[] {
  const existingIndex = marks.findIndex(
    (mark) => mark.kind === "element" && mark.elementKey === spec.elementKey,
  );
  if (existingIndex >= 0) {
    return marks.filter((_, index) => index !== existingIndex);
  }
  return addMark(marks, {
    id: spec.id,
    kind: "element",
    bounds: spec.bounds,
    selector: spec.selector,
    elementKey: spec.elementKey,
  });
}

export function canAddElementMark(
  marks: readonly OverlayMarkModel[],
  elementCap: number,
): boolean {
  return countElementMarks(marks) < elementCap;
}

/**
 * Newest-first bounding-box hit-test over the one ordered stack.
 */
export function eraseNewestAtPoint(
  marks: readonly OverlayMarkModel[],
  x: number,
  y: number,
): { readonly marks: OverlayMarkModel[]; readonly removed: OverlayMarkModel | null } {
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    if (mark === undefined) continue;
    if (!pointInRect(x, y, mark.bounds)) continue;
    return {
      marks: marks.filter((_, current) => current !== index),
      removed: mark,
    };
  }
  return { marks: [...marks], removed: null };
}

export function unionRects(
  rects: readonly AnnotationCssRect[],
): AnnotationCssRect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxRight = Math.max(maxRight, rect.x + rect.width);
    maxBottom = Math.max(maxBottom, rect.y + rect.height);
  }
  return {
    x: minX,
    y: minY,
    width: maxRight - minX,
    height: maxBottom - minY,
  };
}

export function toMarkSnapshot(mark: OverlayMarkModel): BrowserAnnotationMarkSnapshot {
  return {
    id: mark.id,
    kind: mark.kind,
    bounds: mark.bounds,
    selector: mark.kind === "element" ? mark.selector : null,
  };
}

export function isElementVisuallyPresent(input: {
  readonly connected: boolean;
  readonly width: number;
  readonly height: number;
  readonly display: string;
  readonly visibility: string;
  readonly opacity: number;
}): boolean {
  if (!input.connected) return false;
  if (input.width < 1 || input.height < 1) return false;
  if (input.display === "none") return false;
  if (input.visibility === "hidden" || input.visibility === "collapse") {
    return false;
  }
  if (input.opacity === 0) return false;
  return true;
}

export function validateElementMark(input: {
  readonly connected: boolean;
  readonly visible: boolean;
  readonly currentBox: AnnotationCssRect;
  readonly markBox: AnnotationCssRect;
}): ElementMarkValidation {
  if (!input.connected) return "disconnected";
  if (!input.visible) return "hidden";
  if (!rectsOverlap(input.currentBox, input.markBox)) return "moved";
  return "ok";
}

export function serializedCaptureBytes(payload: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function canMutateAnnotation(attachPending: boolean): boolean {
  return !attachPending;
}

export function canRequestAttach(input: {
  readonly attachPending: boolean;
  readonly markCount: number;
}): boolean {
  if (input.attachPending) return false;
  return input.markCount > 0;
}

export function applyByteBudget<T>(input: {
  readonly items: readonly T[];
  readonly existingBytes: number;
  readonly budget: number;
}): { readonly kept: readonly T[]; readonly refusedCount: number } {
  const kept: T[] = [];
  let bytes = input.existingBytes;
  let refusedCount = 0;
  for (const item of input.items) {
    const size = serializedCaptureBytes(item);
    if (bytes + size > input.budget) {
      refusedCount += 1;
      continue;
    }
    kept.push(item);
    bytes += size;
  }
  return { kept, refusedCount };
}

export function strokeBoundsFromPoints(
  points: readonly { readonly x: number; readonly y: number }[],
  pad: number,
): AnnotationCssRect | null {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/**
 * Closed SVG path for a perfect-freehand outline polygon.
 */
export function svgPathFromPolygon(
  points: readonly (readonly [number, number])[],
): string {
  if (points.length === 0) return "";
  const first = points[0];
  if (first === undefined) return "";
  const parts: string[] = ["M", String(first[0]), String(first[1]), "Q"];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    parts.push(
      String(current[0]),
      String(current[1]),
      String((current[0] + next[0]) / 2),
      String((current[1] + next[1]) / 2),
    );
  }
  parts.push("Z");
  return parts.join(" ");
}

export function placeCommentBox(input: {
  readonly union: AnnotationCssRect | null;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly box: { readonly width: number; readonly height: number };
  readonly pillBottom: number;
}): CommentBoxPlacement {
  const margin = 12;
  const maxX = Math.max(margin, input.viewport.width - input.box.width - margin);
  const maxY = Math.max(margin, input.viewport.height - input.box.height - margin);
  const fallbackX = maxX;
  const fallbackY = maxY;
  const clamp = (x: number, y: number): CommentBoxPlacement => ({
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(Math.max(margin, input.pillBottom + 8), y)),
    usedFallback: false,
  });

  if (input.union === null) {
    return { x: fallbackX, y: fallbackY, usedFallback: true };
  }

  let x = input.union.x;
  let y = input.union.y + input.union.height + 8;
  const fitsBelow =
    y + input.box.height <= input.viewport.height - margin &&
    y >= input.pillBottom + 8;
  if (!fitsBelow) {
    y = input.union.y - input.box.height - 8;
  }
  const fitsAbove =
    y >= input.pillBottom + 8 && y + input.box.height <= input.viewport.height - margin;
  if (!fitsAbove) {
    return { x: fallbackX, y: fallbackY, usedFallback: true };
  }
  const placed = clamp(x, y);
  return { ...placed, usedFallback: false };
}

export function shouldSubmitCommentKey(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  if (input.key !== "Enter") return false;
  if (input.shiftKey || input.altKey || input.ctrlKey || input.metaKey) {
    return false;
  }
  return true;
}
