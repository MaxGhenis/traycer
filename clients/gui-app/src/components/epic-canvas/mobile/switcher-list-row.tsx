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
 * ~26px. Density was ruled the higher priority for this surface.
 *
 * The touch target survives that because it never came from the row's height:
 * `mobile-shell-touch-targets.css` gives every `[data-slot="button"]` under the
 * sheet an `::after` of `height: max(100%, 44px)`, centred - a px literal, and
 * the only measurement here immune to the 15px root font that renders every rem
 * utility at 0.9375x. A 26px row still owns a 44px vertical hit box.
 *
 * The PRICED cost: `ui/select.tsx` warns that slop overhanging flush-stacked
 * rows can capture a neighbour's taps, and at this row height the 44px slop does
 * overhang. Accepted for this surface only. If mis-taps show up in use the
 * lever is a visual `min-h-9`, not a return to 41px.
 *
 * The chevron is desktop's `<span>` glyph rendered as a sibling `<button>`: it
 * needs a real accessible name and `aria-expanded`, since a phone has no
 * double-click, drag or context menu to expand by, and a button cannot nest
 * inside a button. It keeps `data-slot="button"` so the scope's slop reaches it.
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
          // that attribute is what the sheet's touch scope selects on, and its
          // slop is the only thing here measured in real pixels. The root font
          // is 15px, so every rem utility renders at 0.9375x and a `h-11` is
          // 41.25px; the scope's `height: max(100%, 44px)` is a true 44.
          data-slot="button"
          // Desktop's glyph, untouched. Only the hit box grows on a coarse
          // pointer, and it grows invisibly - the scope forces the pseudo
          // transparent, and the control itself paints no background, border or
          // box in any state; a press dims the glyph instead.
          className="flex shrink-0 items-center justify-center bg-transparent text-muted-foreground transition-opacity active:opacity-50"
        >
          <TreeChevron expanded={nesting.expanded} onToggle={undefined} />
        </button>
      ) : (
        // Desktop's spacer, in a slot the same width as the chevron's at both
        // pointer densities: a leaf's icon sits on its siblings' column.
        <span className="flex shrink-0 items-center justify-center">
          <TreeChevronSpacer />
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        data-testid={selectTestId}
        aria-current={active ? "true" : undefined}
        className="flex min-h-7 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md py-1 pr-2 text-left text-ui-sm font-normal"
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
        className="flex shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <TreeChevronSpacer />
      </span>
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        data-testid={testId}
        className="flex min-h-7 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md py-1 pr-2 text-left text-ui-sm font-normal text-muted-foreground"
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
