import { expect } from "vitest";

/**
 * Recognises the Tailwind idioms that express a touch target in `rem`.
 *
 * The root font size is a USER SETTING: `providers/theme-provider.tsx` writes
 * it straight onto `documentElement.style.fontSize`, and the store clamps it to
 * 10-20px (`clampUiFontSize`). Every rem in this app is therefore elastic, and
 * the 15px figure quoted around these controls is only the default. A target
 * sized in rem is smallest for the reader who chose the smallest text, which
 * inverts the reason a minimum target exists at all: `min-h-11` is 2.75rem -
 * 27.5px at the floor, 41.25px at the default, and >=44px only above a ~16px
 * root.
 *
 * Three shapes are rejected, and the boundaries are deliberate:
 *
 * 1. `min-h-11` / `h-11` / `size-11`. `11` is the rem spelling of 44px at a
 *    16px root and is written for no other reason, so it is a touch-target
 *    attempt wherever it appears. `w-11` is NOT included - a width is a layout
 *    measure here (a swatch, an indicator bar), and `min-w-44` is 11rem of menu
 *    width rather than 44px of anything.
 * 2. A negative INSET of any nonzero size. `inset` scopes all four edges at
 *    once, and pushing all four past the control's own box is hit slop by
 *    definition. Zero is excluded because `inset-0` is root-independent.
 *
 *    The single-edge offsets (`-top` / `-right` / `-bottom` / `-left`) are
 *    deliberately NOT included, even on a pseudo-element. That reads like the
 *    same idiom spelled one edge at a time, and the tree says otherwise: every
 *    negative pseudo offset in this app is a painted indicator nudged just
 *    outside its box (`after:-right-0.5 after:w-0.5 after:bg-primary` in
 *    `split-tab-item.tsx`, the active-tab bar in `ui/tabs.tsx`). Slop must
 *    never paint, so those are categorically not it, and flagging them would
 *    mean four waivers that excuse nothing and teach a false rule.
 * 3. Any rem-valued `min-h` / `min-w` / `size` / `inset` behind a
 *    `pointer-coarse` variant. Gating on the coarse pointer is what declares
 *    the utility a touch affordance, so the value must be a literal there even
 *    when the same utility is unremarkable elsewhere: a bare `size-7` is an
 *    icon box, `pointer-coarse:before:size-7` is a hit area.
 *
 * The sanctioned replacements are the same ones the three touch-target
 * stylesheets use: `min-h-[44px]` for a row that stacks flush with its
 * neighbours, and `max(100%, 44px)` for a pseudo that must hold the floor at
 * any root size while still growing with a larger control.
 *
 * An arbitrary value is judged by its UNIT, not by its brackets: `-inset-2.5`
 * and `-inset-y-[0.625rem]` are the same elastic quantity spelled two ways, so
 * both are rejected, while `-inset-y-[2px]` is root-independent and is not.
 * Reading brackets alone as "already a literal" would leave the whole defect
 * reachable through one extra pair of characters.
 */

/**
 * The utility of a class token, with any variant chain removed.
 *
 * Bracket- and paren-aware, because an arbitrary value may contain its own
 * colon (`[-webkit-mask-image:linear-gradient(...)]`) and splitting on the
 * last colon blindly would take the utility to be a fragment of that value.
 */
export function utilityOf(token: string): string {
  let depth = 0;
  let lastColon = -1;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) lastColon = index;
  }
  return token.slice(lastColon + 1);
}

/** The rem spelling of a 44px box. See shape 1 above. */
const REM_44PX_BOX = /^(?:min-h|h|size)-11$/;

/** A rem-valued scale step, or an arbitrary value in a font-relative unit. */
const ELASTIC_VALUE = /^(?:(?!0$)[0-9.]+|\[[^\]]*[0-9.](?:r?em)\])$/;

/** Hit slop pushed outside the control's own box. See shape 2 above. */
const NEGATIVE_INSET_SLOP = /^-inset(?:-[xy])?-(.+)$/;

/**
 * A size or inset. Applied only under a `pointer-coarse` variant - see shape 3
 * above. The VALUE decides: `min-h-[44px]` is a literal and passes,
 * `min-h-[2.75rem]` is the same elastic quantity as `min-h-11` and does not.
 */
const SIZE_UTILITY = /^-?(?:min-h|min-w|size|inset)(?:-[xy])?-(.+)$/;

/** The value a utility was given, or null if it is not that utility. */
function valueOf(utility: string, pattern: RegExp): string | null {
  const match = pattern.exec(utility);
  return match === null ? null : match[1];
}

/** Whether one class token sizes a touch target in a font-relative unit. */
export function isRemScaledTouchSize(token: string): boolean {
  const utility = utilityOf(token);
  if (REM_44PX_BOX.test(utility)) return true;

  const inset = valueOf(utility, NEGATIVE_INSET_SLOP);
  if (inset !== null && ELASTIC_VALUE.test(inset)) return true;

  if (!token.includes("pointer-coarse:")) return false;
  const size = valueOf(utility, SIZE_UTILITY);
  return size !== null && ELASTIC_VALUE.test(size);
}

/**
 * Every rem-scaled touch size in a class list, in order.
 *
 * Split on whitespace and quotes ONLY. Splitting on brackets or parens too
 * would tear `size-[max(100%,44px)]` into pieces that no longer look like the
 * replacement idiom, which is the one string this must never mistake.
 */
export function findRemScaledTouchSizes(subject: string): readonly string[] {
  return subject
    .split(/[\s"'`]+/)
    .filter((token) => token.length > 0)
    .filter(isRemScaledTouchSize);
}

/**
 * Asserts a class list floors its touch target in pixels.
 *
 * Pairs with a `toContain("…44px…")` assertion: alone, that would still pass on
 * a class list carrying both idioms, and a test that pins the rem token instead
 * makes the defect unlandable from the file it lives in.
 */
export function expectNoRemScaledTouchSize(subject: string): void {
  expect(findRemScaledTouchSizes(subject)).toEqual([]);
}
