import { describe, expect, it } from "vitest";
import {
  isScrollLockArmed,
  modeFromHotkey,
  shouldHandleModeHotkey,
  shouldSwallowScrollInput,
} from "../browser-annotation-overlay-logic";

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
