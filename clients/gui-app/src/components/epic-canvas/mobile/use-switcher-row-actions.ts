import { useCallback, useState } from "react";
import { useSwitcherRename } from "@/components/epic-canvas/mobile/use-switcher-rename";
import type { SwitcherRowKind } from "@/components/epic-canvas/mobile/use-switcher-rename";
import { useEpicDeleteChat } from "@/hooks/epic/use-epic-chat-mutations";
import { useEpicDeleteTuiAgent } from "@/hooks/epic/use-epic-tui-agent-mutations";
import { useEpicDeleteArtifact } from "@/hooks/epic/use-epic-node-mutations";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { findOpenArtifactInTab } from "@/stores/epics/canvas/canvas-selectors";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";

export interface SwitcherRowActionState {
  readonly renameOpen: boolean;
  readonly openRename: () => void;
  readonly setRenameOpen: (open: boolean) => void;
  readonly submitRename: (title: string) => void;
  readonly confirmOpen: boolean;
  readonly requestDelete: () => void;
  readonly setConfirmOpen: (open: boolean) => void;
  readonly confirmDelete: () => void;
  readonly deletePending: boolean;
}

/**
 * Every mutation and dialog a switcher row's "…" menu drives, independent of
 * WHICH entries that menu offers. The agents list and the artifact tree present
 * different entry sets over exactly this state, so rename, delete (with its
 * confirm) and the open-tile cleanup are defined once here rather than once per
 * list. Raw PTY rows are not among them: their lifetime is gated by a host
 * authority the projection kinds have no analog for, so they drive
 * `useEpicTerminalRowActions` instead.
 *
 * The mutations are the desktop ones unchanged - the phone forks the surface,
 * never the write.
 */
export function useSwitcherRowActions(args: {
  readonly epicId: string;
  readonly tabId: string;
  readonly kind: Exclude<SwitcherRowKind, "terminal">;
  /** The row's node id. */
  readonly nodeId: string;
}): SwitcherRowActionState {
  const { epicId, tabId, kind, nodeId } = args;
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rename = useSwitcherRename(epicId);
  const deleteChat = useEpicDeleteChat();
  const deleteTuiAgent = useEpicDeleteTuiAgent();
  const deleteArtifact = useEpicDeleteArtifact();

  const navigateNested = useEpicNestedFocusNavigation();
  const prepareCloseCanvasTabFocusTarget = useEpicCanvasStore(
    (s) => s.prepareCloseCanvasTabFocusTarget,
  );

  // Deleting/closing an item that is open must also close its canvas tile, or
  // the single mobile tile view would keep rendering a now-dead tile.
  const closeOpenTile = useCallback(() => {
    const found = findOpenArtifactInTab(tabId, nodeId);
    if (found === null) return;
    navigateNested(epicId, tabId, () =>
      prepareCloseCanvasTabFocusTarget(tabId, found.paneId, found.instanceId),
    );
  }, [epicId, nodeId, navigateNested, prepareCloseCanvasTabFocusTarget, tabId]);

  const submitRename = useCallback(
    (title: string) => {
      rename(kind, nodeId, title);
      setRenameOpen(false);
    },
    [kind, nodeId, rename],
  );

  const confirmDelete = useCallback(() => {
    if (kind === "chat")
      deleteChat.mutate(
        { epicId, chatId: nodeId },
        { onSuccess: closeOpenTile },
      );
    else if (kind === "terminal-agent")
      deleteTuiAgent.mutate(
        { epicId, tuiAgentId: nodeId },
        { onSuccess: closeOpenTile },
      );
    // The only kind left once chats and terminal-agents are handled.
    else
      deleteArtifact.mutate(
        { epicId, artifactId: nodeId },
        { onSuccess: closeOpenTile },
      );
    setConfirmOpen(false);
  }, [
    closeOpenTile,
    deleteArtifact,
    deleteChat,
    deleteTuiAgent,
    epicId,
    kind,
    nodeId,
  ]);

  const openRename = useCallback(() => setRenameOpen(true), []);
  const requestDelete = useCallback(() => setConfirmOpen(true), []);

  return {
    renameOpen,
    openRename,
    setRenameOpen,
    submitRename,
    confirmOpen,
    requestDelete,
    setConfirmOpen,
    confirmDelete,
    deletePending:
      deleteChat.isPending ||
      deleteTuiAgent.isPending ||
      deleteArtifact.isPending,
  };
}
