import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarDropdownMenuItems,
  type SidebarRowMenuEntry,
} from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { SwitcherRenameDialog } from "@/components/epic-canvas/mobile/switcher-rename-dialog";
import type { SwitcherRowActionState } from "@/components/epic-canvas/mobile/use-switcher-row-actions";

/**
 * The "…" trigger and the two dialogs behind it, shared by every switcher row
 * whatever entries its menu carries. The entries themselves are the caller's:
 * an agent row builds them from the desktop tree's own
 * `chatRowMenuEntries`, an artifact or terminal row from its shorter pair.
 *
 * Rename opens as a dialog rather than the desktop's inline edit - a 44px row
 * inside a bottom sheet is no place to grow a text field - and it drives the
 * same rename mutation.
 */
export function SwitcherRowMenu(props: {
  readonly nodeId: string;
  readonly name: string;
  readonly renameTitle: string;
  readonly entries: ReadonlyArray<SidebarRowMenuEntry>;
  readonly state: SwitcherRowActionState;
  /**
   * What a delete permanently removes, or `null` for a row whose destructive
   * action needs no confirm (a PTY close, which is immediate on desktop too).
   */
  readonly confirmDescription: string | null;
  /** "… and N nested" summary for a cascading delete; null when none / N/A. */
  readonly cascadeSummary: string | null;
}) {
  const {
    nodeId,
    name,
    renameTitle,
    entries,
    state,
    confirmDescription,
    cascadeSummary,
  } = props;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${name}`}
            data-testid={`switcher-more-${nodeId}`}
            className="shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <SidebarDropdownMenuItems entries={entries} />
        </DropdownMenuContent>
      </DropdownMenu>
      <SwitcherRenameDialog
        open={state.renameOpen}
        onOpenChange={state.setRenameOpen}
        title={renameTitle}
        initialValue={name}
        nodeId={nodeId}
        onSubmit={state.submitRename}
      />
      {confirmDescription === null ? null : (
        <ConfirmDestructiveDialog
          open={state.confirmOpen}
          onOpenChange={state.setConfirmOpen}
          title={`Delete "${name}"?`}
          description={confirmDescription}
          cascadeSummary={cascadeSummary}
          actionLabel="Delete"
          isPending={state.deletePending}
          onConfirm={state.confirmDelete}
        />
      )}
    </>
  );
}
