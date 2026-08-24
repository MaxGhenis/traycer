import type { ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TreeChevron, TreeChevronSpacer } from "@/components/ui/tree-chevron";
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
 * The 44px min height plus the sheet's coarse-pointer touch scope satisfy the
 * touch-target guideline. The chevron reaches it WITHOUT a 44px box: it is the
 * desktop tree's small glyph, costing one icon's width in the flow, and grows
 * its hit area with an overlay that bleeds into the row's padding. A boxed
 * control here would spend a tenth of the viewport on the one row element that
 * carries no information - and expand/collapse still cannot be the hardest
 * thing on the row to hit, which the overlay is what guarantees.
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
    <div
      className="flex min-w-0 items-center gap-1"
      style={{
        paddingLeft: `${Math.min(nesting.depth, SWITCHER_ROW_MAX_INDENT_DEPTH) * SWITCHER_ROW_INDENT_PX + SWITCHER_ROW_BASE_PAD_LEFT}px`,
      }}
    >
      {nesting.hasChildren ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={nesting.onToggle}
          aria-label={`${nesting.expanded ? "Collapse" : "Expand"} ${label}`}
          aria-expanded={nesting.expanded}
          data-testid={`${selectTestId}-toggle`}
          // The `before` overlay is the touch target: 32x44 of tappable area
          // over a control that only occupies an icon's width in the flow. It
          // bleeds outward into the row's own padding, which is dead space, so
          // it costs the label nothing and never overlaps the row body.
          className="relative size-4 shrink-0 p-0 text-muted-foreground before:absolute before:-inset-x-2 before:-inset-y-3.5 before:content-['']"
        >
          <TreeChevron expanded={nesting.expanded} onToggle={undefined} />
        </Button>
      ) : (
        // Keeps every leaf's icon on its siblings' column. Without it a leaf
        // CHILD would render left of its own parent, since one indent step is
        // narrower than the chevron - the nesting would read inverted.
        <span className="flex size-4 shrink-0 items-center justify-center">
          <TreeChevronSpacer />
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        data-testid={selectTestId}
        aria-current={active ? "true" : undefined}
        className="flex min-h-11 min-w-0 flex-1 items-center justify-start gap-2 rounded-md px-2 text-left font-normal"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            {labelPrefix}
            <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
              {label}
            </span>
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
    // The same leading chevron column the item rows carry, so the "+" and this
    // row's label sit on their columns rather than half a step to their left.
    <div className="flex min-w-0 items-center gap-1">
      <span className="size-4 shrink-0" aria-hidden="true" />
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        data-testid={testId}
        className="flex min-h-11 min-w-0 flex-1 items-center justify-start gap-2 rounded-md px-2 text-left font-normal text-muted-foreground"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Plus className="size-4" />
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
