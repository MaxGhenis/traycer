import type { ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TreeChevron, TreeChevronSpacer } from "@/components/ui/tree-chevron";
import { SwitcherRowLabel } from "@/components/epic-canvas/mobile/switcher-row-label";
import {
  SWITCHER_ROW_BASE_PAD_LEFT,
  SWITCHER_ROW_INDENT_PX,
  SWITCHER_ROW_MAX_INDENT_DEPTH,
  type SwitcherRowNesting,
} from "@/components/epic-canvas/mobile/switcher-row-nesting";

/**
 * One row in a switcher category list: an indent-and-chevron nesting cluster,
 * leading icon, truncating label, an optional second line of row metadata, a
 * badge slot, a trailing metadata slot, a check on the active tile, and an
 * optional "…" actions slot. Tapping the row body activates the tile; the
 * chevron and the actions slot are SIBLING buttons, so neither their taps nor
 * their touch targets ever trigger a row open.
 *
 * The paint AND the rhythm are the DESKTOP sidebar row's, not a phone design:
 * the same indent constants (re-exported, never restated), the same `min-h-7`
 * row, `py-1`, `gap-1.5`, `text-ui-sm`, the same `h-3.5 w-[1.125rem]` icon slot,
 * the same small inline chevron glyph, and no inter-row gap - the list is a
 * plain `flex-col`, as the sidebar's is. A phone shows the tree this product
 * already has.
 *
 * It carries NO coarse-pointer height floor, and that is a deliberate reversal.
 * An earlier version took `pointer-coarse:min-h-11` the way every row in
 * `ui/dropdown-menu.tsx` and `ui/select.tsx` does; against a desktop screenshot
 * the result read as a different product - ~41px rows where the sidebar has
 * ~26px. Density was ruled the higher priority for this surface, and what that
 * costs the touch target - which the sheet's hit-slop does NOT buy back here -
 * is stated below.
 *
 * `h-auto` is load-bearing. `ui/button`'s default size sets a FIXED `h-8`, which
 * beats a smaller `min-h-7` - so without it the floor here is inert and the row
 * is 30px whatever this says. Desktop gets 26px for free because its row is a
 * bare `<button>` with no height variant at all.
 *
 * For the same reason NO control in this row may carry an explicit coarse-pointer
 * HEIGHT. The wrapper is `items-center`, so its height is the tallest child, and
 * a 44px control silently pins the whole row open however short the row button
 * gets - which is exactly how an earlier `size-11` on the "…" trigger held the
 * row at 41px while the row itself measured 27.5.
 *
 * Nor does anything here reach 44px through the sheet's touch slop: this list
 * opts OUT of it (`data-touch-slop-opt-out`). A 44px pseudo cannot tile a 27.5px
 * pitch - it overhangs its neighbours by 16.5px and takes their taps, which is
 * measurable as a menu trigger losing exactly half that overhang off its top.
 * The honest ceiling on a flush list is its own pitch, so every control here
 * `self-stretch`es to the row height and owns its true box. Secondary controls
 * are therefore BELOW the 44px guideline by explicit choice: desktop-compact
 * rows and 44px targets cannot both hold, and density was the ruling. The row
 * body remains the full-width primary target.
 *
 * The chevron column is desktop's, exactly: `TreeChevron`'s own box, whose
 * `-mx-0.5` pulls a `size-3` glyph down to 7.5px of flow. An earlier version
 * widened it to a `w-6` slot for the touch target, and that 15px per row read
 * as dead space between the chevron and the title - the gap compounding with
 * every level of indent beside it.
 *
 * So the chevron is SMALL, and deliberately: it is the same trade as the row
 * height, taken again. Density was ruled the priority for this surface, and a
 * chevron sized for a fingertip is the widest single thing standing between a
 * deep row and its own name. The row body remains the full-width primary
 * target; expand/collapse is a precise tap on a small glyph, as it is on
 * desktop.
 *
 * The chevron is desktop's `<span>` glyph rendered as a sibling `<button>`: it
 * needs a real accessible name and `aria-expanded`, since a phone has no
 * double-click, drag or context menu to expand by, and a button cannot nest
 * inside a button. It keeps `data-slot="button"` so this list's slop OPT-OUT
 * can target it: the attribute is what both that rule and the scope's own
 * select on, and without it the 44px pseudo would attach here unopposed.
 *
 * `secondaryLabel` and `badge` exist so a category whose desktop row carries
 * per-row metadata (a terminal's runtime status, its resource usage) can show
 * the same thing here instead of dropping it: the row is one component, so a
 * surface cannot quietly say less than its desktop counterpart. Categories
 * with nothing to add pass null.
 */
export function SwitcherListRow(props: {
  readonly icon: ReactNode;
  readonly label: string;
  /** Rendered immediately before the label, inside the truncating cluster. */
  readonly labelPrefix: ReactNode;
  /** Second line under the label (a terminal's runtime status); null for none. */
  readonly secondaryLabel: string | null;
  /** Right-aligned chip (a row's resource usage); null for none. */
  readonly badge: ReactNode;
  /** Right-aligned metadata (relative time, shared glyph); null for none. */
  readonly trailing: ReactNode;
  readonly nesting: SwitcherRowNesting;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly actions: ReactNode;
  readonly selectTestId: string;
}) {
  const {
    icon,
    label,
    labelPrefix,
    secondaryLabel,
    badge,
    trailing,
    nesting,
    active,
    onSelect,
    actions,
    selectTestId,
  } = props;
  return (
    // `min-w-0` at both this wrapper and the button: the label's truncate
    // only engages while every flex level above it may shrink below its
    // content. One level with an auto min-width re-inflates the row to the
    // full label width, and the list scrolls sideways instead of ellipsizing.
    //
    // The indent lives here rather than on the row button, because the chevron
    // is a sibling of that button; desktop, whose chevron sits inside it, pads
    // the button itself. Same resulting geometry, same constants.
    <div
      className="flex min-w-0 items-center gap-1.5"
      style={{
        paddingLeft: `${Math.min(nesting.depth, SWITCHER_ROW_MAX_INDENT_DEPTH) * SWITCHER_ROW_INDENT_PX + SWITCHER_ROW_BASE_PAD_LEFT}px`,
      }}
    >
      {nesting.hasChildren ? (
        <button
          type="button"
          onClick={nesting.onToggle}
          aria-label={`${nesting.expanded ? "Collapse" : "Expand"} ${label}`}
          aria-expanded={nesting.expanded}
          data-testid={`${selectTestId}-toggle`}
          // `data-slot`, though this is a bare element rather than `ui/button`:
          // the sheet's touch scope selects on that attribute, and so does the
          // opt-out this list sits under. Without it the scope's 44px `::after`
          // would attach here and the opt-out could not reach it - a chevron
          // taking taps from the row above.
          data-slot="button"
          // Desktop's glyph, untouched, and its hit box is exactly its painted
          // box: `self-stretch` takes the row's full height, and the control
          // paints no background, border or box in any state; a press dims the
          // glyph instead.
          className="flex shrink-0 items-center justify-center self-stretch bg-transparent text-muted-foreground transition-opacity active:opacity-50"
        >
          <TreeChevron expanded={nesting.expanded} onToggle={undefined} />
        </button>
      ) : (
        // Desktop's spacer, in a slot the same width as the chevron's at both
        // pointer densities: a leaf's icon sits on its siblings' column.
        <span className="flex shrink-0 items-center justify-center self-stretch">
          <TreeChevronSpacer />
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        data-testid={selectTestId}
        aria-current={active ? "true" : undefined}
        className="flex h-auto min-h-7 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md py-1 pr-2 text-left text-ui-sm font-normal"
      >
        <span className="inline-flex h-3.5 w-[1.125rem] shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            {labelPrefix}
            <SwitcherRowLabel label={label} />
          </span>
          {secondaryLabel === null ? null : (
            <span className="min-w-0 truncate text-ui-xs text-muted-foreground">
              {secondaryLabel}
            </span>
          )}
        </span>
        {badge}
        {trailing}
        {active ? (
          <Check
            className="size-4 shrink-0 text-primary"
            aria-label="Current tab"
          />
        ) : null}
      </Button>
      {actions}
    </div>
  );
}

/**
 * The "make another one" row at the head of a category list. Same geometry and
 * weight as the item rows below it, so creating reads as one more entry in the
 * list rather than a banner over it; the leading "+" is what marks it apart.
 */
export function SwitcherNewItemRow(props: {
  readonly label: string;
  readonly onSelect: () => void;
  readonly testId: string;
}) {
  const { label, onSelect, testId } = props;
  return (
    // Carries a root row's indent and its chevron slot, so the "+" and this
    // row's label sit on the columns the rows below them use.
    <div
      className="flex min-w-0 items-center gap-1.5"
      style={{ paddingLeft: `${SWITCHER_ROW_BASE_PAD_LEFT}px` }}
    >
      <span
        className="flex shrink-0 items-center justify-center self-stretch"
        aria-hidden="true"
      >
        <TreeChevronSpacer />
      </span>
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        data-testid={testId}
        className="flex h-auto min-h-7 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md py-1 pr-2 text-left text-ui-sm font-normal text-muted-foreground"
      >
        <span className="inline-flex h-3.5 w-[1.125rem] shrink-0 items-center justify-center">
          <Plus className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-sm">{label}</span>
      </Button>
    </div>
  );
}

export function SwitcherListEmpty(props: { readonly message: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center p-6 text-center text-ui-sm text-muted-foreground">
      {props.message}
    </div>
  );
}

/**
 * Right-aligned header bar hosting a category's "+" create affordance. Renders
 * nothing when `action` is null (a viewer with no create rights).
 */
export function SwitcherListHeader(props: { readonly action: ReactNode }) {
  if (props.action === null) return null;
  return (
    <div className="flex shrink-0 items-center justify-end px-2 pt-1.5">
      {props.action}
    </div>
  );
}
