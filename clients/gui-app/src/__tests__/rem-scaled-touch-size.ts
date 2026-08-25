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
 * 2. A negative inset of any nonzero size. Its only purpose is to push a
 *    pseudo-element past the control's own box, which is hit slop by
 *    definition. Zero is excluded because `inset-0` is root-independent.
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

/** Hit slop pushed outside the control's own box. See shape 2 above. */
const NEGATIVE_INSET_SLOP = /^-inset(?:-[xy])?-(?!0$)[0-9.]+$/;

/**
 * A rem-valued size or inset. Applied only under a `pointer-coarse` variant -
 * see shape 3 above. A bracketed value (`min-h-[44px]`, `size-[max(100%,44px)]`)
 * has no bare number in that position and is deliberately not matched.
 */
const REM_VALUED_SIZE =
  /^-?(?:min-h|min-w|size|inset)(?:-[xy])?-(?!0$)[0-9.]+$/;

/** Whether one class token sizes a touch target in rem. */
export function isRemScaledTouchSize(token: string): boolean {
  const utility = utilityOf(token);
  if (REM_44PX_BOX.test(utility)) return true;
  if (NEGATIVE_INSET_SLOP.test(utility)) return true;
  return token.includes("pointer-coarse:") && REM_VALUED_SIZE.test(utility);
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
