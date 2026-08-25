/**
 * Hit-area slop for an icon control that renders inside a portal.
 *
 * The app's three touch-target stylesheets (settings, home, mobile shell) all
 * grow a control's hit area with a DESCENDANT selector rooted at a scope
 * attribute. Portalled content is reparented to the document body, so no
 * ancestor of it carries a scope and those rules can never match — a control
 * living in a portal has to own its target itself, at the primitive.
 *
 * This is a pure hit area and must never paint: the pseudo has no background,
 * and the control's own box is untouched, so a variant that fills on hover or
 * while expanded looks identical at every pointer type. Growing the box
 * instead (`size-11`) would be a visual change, since the fill follows the box.
 *
 * It rides `::before` deliberately. An element has a single `::after`, and the
 * scope stylesheets claim it — a portalled surface may still set a scope
 * attribute on its own content (a dialog whose body reuses a scoped surface),
 * which would put a control in reach of both rules at once. `::before` cannot
 * collide with them.
 *
 * The pseudo is `absolute`, so it anchors to the nearest positioned ancestor:
 * apply it to a control that already positions itself, or add `relative`
 * alongside it.
 *
 * The size is a PIXEL LITERAL with a percentage floor, never a rem inset. The
 * root font size is a user setting (clamped 10-20px), so anything sized purely
 * in rem tracks it: a `size-7` button padded by a `0.625rem` inset measures
 * 45px at the 15px default but only 30px at the minimum — the smallest text
 * paired with the smallest targets, which is exactly backwards. `max(100%,
 * 44px)` holds the floor at every root size and still grows with a larger
 * control, matching what the three scope stylesheets do.
 *
 * Symmetric, so it suits a control with no flush neighbour — a corner close
 * button. A control in a flush stack needs the row-sizing treatment
 * (`pointer-coarse:min-h-[44px]`) instead, or its slop overlaps its
 * neighbours'.
 */
export const PORTAL_ICON_BUTTON_HIT_SLOP =
  "pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-[max(100%,44px)] pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2";
