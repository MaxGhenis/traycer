/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findRemScaledTouchSizes,
  isRemScaledTouchSize,
  utilityOf,
} from "./rem-scaled-touch-size";

/**
 * A touch target must be floored in PIXELS, because every rem in this app is
 * elastic.
 *
 * `providers/theme-provider.tsx` writes the root font size straight onto
 * `documentElement.style.fontSize` from a user setting the store clamps to
 * 10-20px. So `pointer-coarse:min-h-11` is 27.5px at the floor, 41.25px at the
 * 15px default, and only clears 44px above a ~16px root - it renders as a
 * correct touch target at no size a developer is likely to test at, and is
 * smallest for exactly the reader who chose the smallest text.
 *
 * The idiom spread because it read as sanctioned: it was documented as the way
 * to size a portalled row, and the lanes that copied it did so deliberately,
 * for consistency. A guard is the half of the fix that survives that - a
 * converted call site can be re-seeded by the next person who greps for a
 * nearby example, and a comment cannot fail a build.
 *
 * Scope is every `.ts`/`.tsx` under `src/`, comments removed. A class that
 * genuinely wants the rem is kept by annotating it with {@link ALLOW_MARKER}
 * and a reason, which keeps the exemption ON the line it excuses rather than in
 * a file-level list that silently widens.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Opt-out for a rem size that is not a touch target, or that must track the
 * reader's text for a stronger reason. Must be followed by a reason, which is
 * one of exactly two claims:
 *
 * 1. Nothing here is tappable - a decorative disc, an indicator bar.
 * 2. The control is not ours to size - a stock primitive this app never
 *    renders, kept byte-identical to upstream.
 *
 * The `(?!\*\/)` guard is inherited from `muted-fill-on-raised-surface-lint`,
 * where a bare `\S` honoured a reasonless JSX waiver: the comment's own closing
 * `*` is a non-space character after the colon, so the mechanism built to force
 * a reason accepted one with none.
 */
const ALLOW_MARKER = /touch-target-ok:\s*(?!\*\/)\S/;

/**
 * How many lines above a flagged class an annotation may sit and still cover
 * it. Prose inserted between a marker and its class list orphans the marker,
 * which the stale-marker arm below catches from the other direction.
 */
const MARKER_LOOKBEHIND = 4;

function collectSourceFiles(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...collectSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) found.push(full);
  }
  return found;
}

/**
 * Prose about a class is not that class.
 *
 * This matters more here than in the sibling guards: the fix for this defect is
 * a comment naming the token it replaced, so nearly every converted call site
 * now spells `min-h-11` in prose one line above the literal that replaced it.
 * Scanning raw source would redden on the documentation of the fix.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("{/*")
  );
}

interface Flagged {
  readonly file: string;
  readonly line: number;
  readonly tokens: readonly string[];
}

function flaggedLines(file: string): readonly Flagged[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const flagged: Flagged[] = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const tokens = findRemScaledTouchSizes(line);
    if (tokens.length === 0) return;
    flagged.push({ file, line: index + 1, tokens });
  });
  return flagged;
}

/** Whether a {@link ALLOW_MARKER} sits within reach above `line`. */
function isWaived(file: string, line: number): boolean {
  const lines = readFileSync(file, "utf8").split("\n");
  const start = Math.max(0, line - 1 - MARKER_LOOKBEHIND);
  return lines
    .slice(start, line)
    .some((candidate) => ALLOW_MARKER.test(candidate));
}

function describeFlagged(entry: Flagged): string {
  return `${path.relative(SRC_DIR, entry.file)}:${entry.line} -> ${entry.tokens.join(" ")}`;
}

/**
 * The matcher is unit-tested BEFORE it is trusted over the tree, because a
 * regex that matches nothing is indistinguishable from a clean tree. The first
 * version of this rule in a sibling lane silently missed the axis-suffixed
 * `-inset-y-2.5`, and the sweep it guarded read as complete.
 */
describe("the rem-scaled touch size matcher", () => {
  const REJECTED = [
    "min-h-11",
    "h-11",
    "size-11",
    "-inset-2.5",
    "-inset-x-2.5",
    "-inset-y-2.5",
    "-inset-y-1.5",
    "after:-inset-2",
    "pointer-coarse:min-h-11",
    "pointer-coarse:before:-inset-y-2.5",
    "pointer-coarse:before:size-7",
    "pointer-coarse:before:inset-x-1.5",
    // Brackets are not a literal. A font-relative arbitrary value is the same
    // elastic quantity as the scale step it spells out, so reading brackets
    // alone as "already fixed" would leave the defect one keystroke away.
    "-inset-y-[0.625rem]",
    "pointer-coarse:before:min-h-[2.75rem]",
    "after:-inset-[2em]",
  ];

  const ACCEPTED = [
    "min-h-[44px]",
    "size-[44px]",
    "size-[max(100%,44px)]",
    "h-[max(100%,44px)]",
    "pointer-coarse:min-h-[44px]",
    "pointer-coarse:before:size-[max(100%,44px)]",
    "pointer-coarse:before:h-[max(100%,44px)]",
    "pointer-coarse:before:inset-x-0",
    "top-1/2",
    "left-1/2",
    "-translate-x-1/2",
    "-translate-y-1/2",
    "pointer-coarse:before:-translate-y-1/2",
    // A width is a layout measure, not a finger measure: these are a glyph
    // swatch, an active-tab bar, and 11rem of menu width respectively.
    "w-11",
    "min-w-44",
    // An icon box with no coarse-pointer gate is not claiming to be a target.
    "size-7",
    "size-4",
    "inset-0",
    // A px arbitrary value is root-independent - the thing this rule wants.
    "-inset-y-[2px]",
    "after:-inset-[3px]",
    // A single-edge negative offset is not this idiom, on a pseudo-element or
    // anywhere else. Every one in this app is a painted indicator nudged just
    // outside its box - `split-tab-item.tsx`'s side bar, `ui/tabs.tsx`'s
    // active-tab bar - and slop must never paint. Rejecting these would mean
    // four waivers that excuse nothing.
    "-top-2",
    "after:-right-0.5",
    "before:-left-0.5",
    "group-data-[orientation=vertical]/tabs:after:-right-1",
    // A percentage offset does not track the root font size either.
    "after:-top-1/2",
  ];

  it.each(REJECTED)("rejects %s", (token) => {
    expect(isRemScaledTouchSize(token)).toBe(true);
  });

  it.each(ACCEPTED)("accepts %s", (token) => {
    expect(isRemScaledTouchSize(token)).toBe(false);
  });

  it("finds every offender in a realistic class list, not just the first", () => {
    // Both idioms on one element is the shape a partial conversion leaves
    // behind, and the shape a `toContain("44px")` assertion cannot see.
    expect(
      findRemScaledTouchSizes(
        "flex min-h-[44px] w-full items-center pointer-coarse:min-h-11 after:-inset-y-2.5",
      ),
    ).toEqual(["pointer-coarse:min-h-11", "after:-inset-y-2.5"]);
  });

  it("reads the utility through an arbitrary value that contains a colon", () => {
    // A blind split on the last colon would take the utility to be a fragment
    // of the gradient and match nothing at all.
    expect(
      utilityOf(
        "[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]",
      ),
    ).toBe(
      "[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]",
    );
  });
});

describe("touch targets across the app", () => {
  const files = collectSourceFiles(SRC_DIR);

  it("scans a tree big enough for the result to mean anything", () => {
    // A collector that silently walked the wrong directory would report zero
    // offenders, which is the same output as a clean tree.
    expect(files.length).toBeGreaterThan(500);
  });

  it("sizes every touch target in pixels, never in rem", () => {
    const offenders = files
      .flatMap(flaggedLines)
      .filter((entry) => !isWaived(entry.file, entry.line))
      .map(describeFlagged);

    expect(offenders).toEqual([]);
  });

  it("leaves no waiver excusing nothing", () => {
    // A marker orphaned by prose inserted above its class list reads as an
    // honoured exemption while excusing nothing - the failure mode that
    // reached the tree in the sibling `muted-fill` guard.
    const stale = files
      .flatMap((file) => {
        const lines = readFileSync(file, "utf8").split("\n");
        return lines.flatMap((line, index) => {
          if (!ALLOW_MARKER.test(line)) return [];
          const covers = lines
            .slice(index + 1, index + 1 + MARKER_LOOKBEHIND)
            .some(
              (candidate) =>
                !isCommentLine(candidate) &&
                findRemScaledTouchSizes(candidate).length > 0,
            );
          return covers ? [] : [`${path.relative(SRC_DIR, file)}:${index + 1}`];
        });
      })
      .filter((entry) => entry.length > 0);

    expect(stale).toEqual([]);
  });
});
