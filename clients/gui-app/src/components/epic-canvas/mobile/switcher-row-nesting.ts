/**
 * The switcher tree's indent geometry IS the desktop sidebar's, re-exported
 * rather than restated: same step, same base pad, so the two surfaces cannot
 * drift a pixel apart. A phone shows the desktop tree, sized for touch - it does
 * not get a tree of its own design.
 */
export {
  INDENT_PX as SWITCHER_ROW_INDENT_PX,
  BASE_PAD_LEFT as SWITCHER_ROW_BASE_PAD_LEFT,
} from "@/components/epic-canvas/sidebar/epic-sidebar-tree-shared";
/**
 * Where the indent stops growing. The desktop tree has no such cap - it has a
 * resizable panel - and at the depths agents actually reach this never engages,
 * so the two surfaces indent identically in practice. It exists for the case a
 * phone cannot survive: depth is USER-controlled, every agent row offers "New
 * child agent", and past this level a ~400px row would have nothing left for
 * the label. The chevron state and the parent order carry the nesting there.
 */
export const SWITCHER_ROW_MAX_INDENT_DEPTH = 6;

/** The nesting controls of a row that has children, or the spacer that keeps a
 *  leaf's icon on the same optical column as its siblings'. */
export interface SwitcherRowNesting {
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

/** A leaf at the top level: the shape a category that has no tree passes. */
export const SWITCHER_ROW_FLAT: SwitcherRowNesting = {
  depth: 0,
  hasChildren: false,
  expanded: false,
  onToggle: () => undefined,
};
