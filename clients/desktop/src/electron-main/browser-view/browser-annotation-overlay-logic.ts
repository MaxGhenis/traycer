import type { BrowserAnnotationMode } from "../../ipc-contracts/browser-annotation-types";

export const ANNOTATION_MODES: readonly BrowserAnnotationMode[] = [
  "select",
  "region",
  "draw",
  "erase",
];

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
