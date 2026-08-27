import { useMemo } from "react";
import { ChatTreePanelBody } from "@/components/epic-canvas/sidebar/epic-sidebar-chat-tree";
import {
  ChatTreeSurfaceContext,
  type ChatTreeSurface,
} from "@/components/epic-canvas/sidebar/chat-tree-surface";
import { SwitcherNewChatRow } from "@/components/epic-canvas/mobile/switcher-create-actions";
import { useSwitcherActivate } from "@/components/epic-canvas/mobile/use-switcher-activate";
import { useCoarsePointer } from "@/hooks/ui/use-coarse-pointer";
import { isEditableRole } from "@/lib/epic-permissions";
import { useEpicPermissionRole } from "@/lib/epic-selectors";

interface SwitcherListProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly onClose: () => void;
}

/**
 * Agents category: the DESKTOP sidebar's chat tree, mounted here.
 *
 * Not a row that matches it property by property - the tree component itself,
 * with its own indent rails, chevron column, leading icons, truncation, status
 * and menus. The switcher previously carried a parallel implementation, and
 * every round of "make it look like desktop" moved one property while the next
 * one drifted; the only construction that cannot drift is the same code.
 *
 * What this surface supplies is the two things a phone genuinely changes, both
 * through {@link ChatTreeSurface} rather than through a fork of the tree:
 *
 * - **Opening.** Desktop's single click opens a PREVIEW tile, meant to be
 *   promoted by the double click the row also handles. There is no second
 *   gesture here, so a tap opens permanently and closes the sheet - the tile
 *   the user picked becomes the full-screen mobile tile.
 * - **Row controls.** The "⋯" menu and the archive shortcut reveal on hover.
 *   A coarse pointer has no hover, so on one they are shown outright; a fine
 *   pointer in a narrow window keeps the quieter hover behaviour, because there
 *   the reveal still works.
 *
 * Everything else the sheet needs, the tree already had: the expansion store is
 * the one the desktop panel keys by, so a subtree opened on either surface is
 * open on the other, and the row's own menu carries rename, archive, delete and
 * "New child agent".
 *
 * The one thing the BODY does not carry is root create: on desktop that "+"
 * lives in the panel header, and a sheet has no panel header. So the switcher's
 * own create row stays, above the tree.
 */
export function SwitcherAgentsList(props: SwitcherListProps) {
  const { epicId, tabId, onClose } = props;
  const activate = useSwitcherActivate(epicId, tabId, onClose);
  const coarsePointer = useCoarsePointer();
  const canMutate = isEditableRole(useEpicPermissionRole());
  const surface = useMemo<ChatTreeSurface>(
    () => ({ activate, revealRowControls: coarsePointer }),
    [activate, coarsePointer],
  );
  return (
    <ChatTreeSurfaceContext.Provider value={surface}>
      {/* The tree's own `SidebarContent` owns the scroll; this wrapper exists
          for the bottom inset, which is the sheet's to reserve and not
          something the shared tree should know about. */}
      <div className="flex min-h-0 flex-1 flex-col pb-safe-bottom">
        {/* Editor-gated: a viewer's create is server-rejected, so an ungated
            row would only lead to a dead end. */}
        {canMutate ? (
          <SwitcherNewChatRow epicId={epicId} tabId={tabId} onClose={onClose} />
        ) : null}
        <ChatTreePanelBody epicId={epicId} tabId={tabId} />
      </div>
    </ChatTreeSurfaceContext.Provider>
  );
}
