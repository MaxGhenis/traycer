/** Indent per tree level, and the pad the shallowest row still gets. Wider than
 *  the desktop sidebar's 16px: a phone row carries no vertical guide rail, so
 *  the step itself has to carry the level, and it is read at arm's length. */
export const SWITCHER_ROW_INDENT_PX = 20;
export const SWITCHER_ROW_BASE_PAD_LEFT = 8;

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
