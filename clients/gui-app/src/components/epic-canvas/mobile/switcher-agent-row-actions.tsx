import { useCallback } from "react";
import { SwitcherRowMenu } from "@/components/epic-canvas/mobile/switcher-row-menu";
import {
  useSwitcherRowActions,
  type SwitcherRowActionState,
} from "@/components/epic-canvas/mobile/use-switcher-row-actions";
import {
  chatRowArchiveEntry,
  chatRowMenuEntries,
  useChatRowArchiveInputs,
  useChatRowSessionActivity,
  useChatRowSharing,
  useNewChildAgentAction,
  type ChatRowArchiveEntry,
  type ChatRowArchiveInputs,
} from "@/components/epic-canvas/sidebar/chat-row-menu";
import { useEpicPermissionRole } from "@/lib/epic-selectors";
import { isEditableRole } from "@/lib/epic-permissions";

export type SwitcherAgentKind = "chat" | "terminal-agent";

interface SwitcherAgentRowActionsProps {
  readonly epicId: string;
  readonly tabId: string;
  readonly nodeId: string;
  readonly name: string;
  readonly artifactType: SwitcherAgentKind;
  /** The row's OWN owner host, for the session the archive gate reads. */
  readonly ownerHostId: string | null;
  /** "… and N nested" summary for a cascading delete; null when none. */
  readonly cascadeSummary: string | null;
  /** The sheet cannot stay up behind the New Conversation modal. */
  readonly onClose: () => void;
}

/**
 * An agent row's "…" menu on the phone: the SAME entry set the desktop chat
 * tree offers - New child agent, Rename, Archive/Unarchive, Make private/Share
 * with task, Delete - built by the desktop's own `chatRowMenuEntries` so the
 * two surfaces cannot drift in what they offer, in what each entry does, or in
 * when one is refused and why.
 *
 * What the phone drops is only the desktop's POINTER shortcuts: there is no
 * hover Archive button and no right-click menu, so every action lives in this
 * one touch target.
 */
export function SwitcherAgentRowActions(props: SwitcherAgentRowActionsProps) {
  const canMutate = isEditableRole(useEpicPermissionRole());
  const archive = useChatRowArchiveInputs({
    epicId: props.epicId,
    nodeId: props.nodeId,
    canMutate,
  });
  const state = useSwitcherRowActions({
    epicId: props.epicId,
    tabId: props.tabId,
    kind: props.artifactType,
    nodeId: props.nodeId,
  });

  // A viewer's writes are all server-rejected, so an ungated menu would only
  // lead to dead ends. Placed after the hooks, never between them.
  if (!canMutate) return null;
  if (archive.supported) {
    return (
      <ArchivableAgentRowMenu {...props} archive={archive} state={state} />
    );
  }
  return (
    <AgentRowMenu
      {...props}
      archive={archive}
      archiveEntry={null}
      state={state}
    />
  );
}

/**
 * The archive-capable arm. Split at a component boundary for the reason the
 * desktop tree splits its own: resolving the row's live activity costs an
 * awareness read, a session-handle lookup and two store subscriptions, and a
 * host that cannot archive would pay all of it to render an entry it never
 * shows.
 */
function ArchivableAgentRowMenu(
  props: SwitcherAgentRowActionsProps & {
    readonly archive: ChatRowArchiveInputs;
    readonly state: SwitcherRowActionState;
  },
) {
  const activity = useChatRowSessionActivity({
    epicId: props.epicId,
    nodeId: props.nodeId,
    ownerHostId: props.ownerHostId,
    artifactType: props.artifactType,
  });
  return (
    <AgentRowMenu
      {...props}
      archiveEntry={chatRowArchiveEntry({
        isArchived: props.archive.isArchived,
        archivePending: props.archive.pending,
        running: activity.running,
      })}
    />
  );
}

function AgentRowMenu(
  props: SwitcherAgentRowActionsProps & {
    readonly archive: ChatRowArchiveInputs;
    readonly archiveEntry: ChatRowArchiveEntry | null;
    readonly state: SwitcherRowActionState;
  },
) {
  const { epicId, tabId, nodeId, name, artifactType, archive, state, onClose } =
    props;
  // Re-read rather than threaded: this arm is only ever reached past its
  // parent's edit gate, and the selector is a per-epic boolean subscription.
  const canMutate = isEditableRole(useEpicPermissionRole());
  const sharing = useChatRowSharing(epicId, nodeId, artifactType, canMutate);
  const newChildAgent = useNewChildAgentAction({
    epicId,
    tabId,
    nodeId,
    canMutate,
  });
  // The modal REPLACES the sheet on a phone rather than opening over it, so the
  // sheet closes as the modal opens - the same handoff the category's own
  // "New agent" row performs.
  const onNewChildAgent = useCallback(() => {
    newChildAgent();
    onClose();
  }, [newChildAgent, onClose]);

  return (
    <SwitcherRowMenu
      nodeId={nodeId}
      name={name}
      renameTitle="Rename agent"
      entries={chatRowMenuEntries({
        nodeId,
        canMutate,
        archiveEntry: props.archiveEntry,
        sharingEntry: sharing.entry,
        onNewChildAgent,
        onStartRename: state.openRename,
        onToggleArchive: archive.onToggle,
        onToggleSharing: sharing.onToggle,
        onPerformDelete: state.requestDelete,
      })}
      state={state}
      confirmDescription="This permanently deletes the agent and its history."
      cascadeSummary={props.cascadeSummary}
    />
  );
}
