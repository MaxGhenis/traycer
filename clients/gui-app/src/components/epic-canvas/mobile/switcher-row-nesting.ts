/** Indent per tree level, and the pad the shallowest row still gets. Wider than
 *  the desktop sidebar's 16px: a phone row carries no vertical guide rail, so
 *  the step itself has to carry the level, and it is read at arm's length. */
export const SWITCHER_ROW_INDENT_PX = 20;
export const SWITCHER_ROW_BASE_PAD_LEFT = 8;
/**
 * Where the indent stops growing. Depth is USER-controlled - every agent row
 * offers "New child agent" - and the row already spends its width on a 44px
 * chevron, the status icon, the trailing time and the actions button. Past this
 * level a narrow phone would have nothing left for the label, so the row would
 * stop identifying its agent; the chevron state and the parent order still
 * carry the nesting from there.
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
