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
 * The row owns its coarse-pointer height (`pointer-coarse:min-h-11`), the way
 * every tappable row in `ui/dropdown-menu.tsx` and `ui/select.tsx` does, rather
 * than leaning on the sheet's touch scope: that scope's slop is vertical-only
 * and centred, so on flush-stacked rows it is the row's own height that has to
 * be right.
 *
 * The chevron is the desktop tree's small glyph, not a 44px box. A boxed
 * control would spend a tenth of a phone viewport on the one row element
 * carrying no information, and it would spend it on EVERY row, since the column
 * is reserved. It widens to 32px on a coarse pointer instead - real width, not
 * overhanging slop, because its horizontal neighbour is the row body and slop
 * there would steal the taps that open the row.
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
      className="flex min-w-0 items-center gap-1 pointer-coarse:min-h-11"
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
          className="h-11 w-4 shrink-0 p-0 text-muted-foreground pointer-coarse:w-8"
        >
          <TreeChevron expanded={nesting.expanded} onToggle={undefined} />
        </Button>
      ) : (
        // Keeps every leaf's icon on its siblings' column, and matches the
        // chevron BUTTON's width at both pointer densities. Without it a leaf
        // CHILD would render left of its own parent, since one indent step is
        // narrower than the chevron - the nesting would read inverted.
        <span className="flex h-4 w-4 shrink-0 items-center justify-center pointer-coarse:w-8">
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
    <div className="flex min-w-0 items-center gap-1 pointer-coarse:min-h-11">
      <span
        className="h-4 w-4 shrink-0 pointer-coarse:w-8"
        aria-hidden="true"
      />
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
