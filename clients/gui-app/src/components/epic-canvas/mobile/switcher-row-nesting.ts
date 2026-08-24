/**
 * Indent per tree level, and the pad the shallowest row gets.
 *
 * TIGHTER than the desktop sidebar's 16px, and the base pad is zero, because a
 * ~400px viewport has no width to spare: everything left of the label - indent,
 * chevron column, icon - is width the label does not get, and a row that cannot
 * show its name has stopped doing its job. A root row therefore starts flush
 * with the create row above it, and the step is sized to be the smallest one
 * still legible at arm's length rather than the most emphatic.
 */
export const SWITCHER_ROW_INDENT_PX = 12;
export const SWITCHER_ROW_BASE_PAD_LEFT = 0;
/**
 * Where the indent stops growing. Depth is USER-controlled - every agent row
 * offers "New child agent" - and the row also spends width on the chevron
 * column, the status icon, the trailing metadata and the actions button. Past
 * this level a narrow phone would have too little left for the label; the
 * chevron state and the parent order still carry the nesting from there.
 */
export const SWITCHER_ROW_MAX_INDENT_DEPTH = 4;

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
