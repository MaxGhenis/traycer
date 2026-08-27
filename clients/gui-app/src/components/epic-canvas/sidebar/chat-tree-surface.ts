/**
 * The two things a non-desktop surface changes about the chat tree, named so
 * the tree itself stays one component instead of being re-implemented per form
 * factor.
 *
 * `null` - the default, and what the desktop sidebar provides by not providing
 * anything - means the tree behaves exactly as it always has: single click
 * opens a preview tile, double click promotes it, and the row's controls reveal
 * on hover.
 *
 * A phone can do neither. There is no second click to promote with and no
 * hover to reveal by, so a surface that mounts this tree on touch supplies both
 * answers here rather than growing a parallel row. Everything else about the
 * tree - geometry, indent rails, icons, truncation, status - is the same code
 * on both, which is the point.
 */
import { createContext, use } from "react";
import type { EpicCanvasTileRef } from "@/stores/epics/canvas/types";

export interface ChatTreeSurface {
  /**
   * Opens a row, in place of the desktop preview/promote pair. Takes the same
   * `(contentId, buildRef)` shape the row would have opened with, so a surface
   * can reuse the ref the row built - including its host binding, which a tab
   * holds for life. The ref is the full tile union, not just the node one: a
   * row reading someone else's published chat opens a published-chat tile.
   */
  readonly activate: (
    contentId: string,
    buildRef: () => EpicCanvasTileRef,
  ) => void;
  /**
   * Show the row controls that otherwise wait for hover. A tree on touch has no
   * hover state to reveal them with, so they would be permanently unreachable.
   */
  readonly revealRowControls: boolean;
}

export const ChatTreeSurfaceContext = createContext<ChatTreeSurface | null>(
  null,
);

/** The mounting surface's overrides, or `null` on the desktop sidebar. */
export function useChatTreeSurface(): ChatTreeSurface | null {
  return use(ChatTreeSurfaceContext);
}

/**
 * Whether this tree's rows must show the controls that otherwise wait for
 * hover. Its own hook so the row components read one boolean rather than
 * repeating the null-surface fallback - which on the row button is enough
 * branching to push it past the complexity ceiling.
 */
export function useRevealRowControls(): boolean {
  const surface = useChatTreeSurface();
  if (surface === null) return false;
  return surface.revealRowControls;
}
