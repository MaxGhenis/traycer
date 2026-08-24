/**
 * Everything an agent row offers BESIDES its own layout: the ⋯ / right-click
 * menu entries, the per-row facts those entries are decided from (archive
 * support, sharing capability, the cloud fold), the archive/sharing/new-child
 * actions themselves, and the two trailing/leading scraps of chrome that travel
 * with them.
 *
 * It lives outside `epic-sidebar-chat-tree` because a chat row is rendered by
 * two surfaces with two different LAYOUTS - the desktop sidebar's 28px
 * hover-reveal tree row and the phone switcher's 44px touch row - and exactly
 * one BEHAVIOUR. Everything that decides what an action does, when it is
 * offered, and why it is refused belongs here so the two can only ever differ
 * in presentation.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import type { CloudChatSummary } from "@traycer/protocol/host/epic/cloud-chat";
import { useEpicArchiveChat } from "@/hooks/epic/use-epic-chat-mutations";
import { useChatArchiveSupported } from "@/hooks/epic/use-chat-archive-support";
import { useCloudChatVisibilitySupported } from "@/hooks/epic/use-chat-sharing-support";
import { useEpicSetCloudChatVisibility } from "@/hooks/epic/use-epic-chat-visibility-mutations";
import { useEpicSessionHostClient } from "@/hooks/epic/use-epic-session-host-client";
import { useEpicCollaboratorsQuery } from "@/hooks/epics/use-epic-collaborators-query";
import { useChatSharingInFlight } from "@/lib/chats/chat-sharing-inflight";
import { useCloudChatList } from "@/hooks/chats/use-cloud-chat-queries";
import {
  publicationTargetMap,
  useChatPublicationTargets,
} from "@/hooks/chats/use-chat-publication-targets";
import { indexOwnCloudChatsByLocalId } from "@/lib/chats/unified-chat-list";
import {
  decideChatSharingMenuEntry,
  shouldShowSharedWithTaskIndicator,
  taskHasCollaborators,
  type ChatSharingMenuDecision,
} from "@/lib/chats/chat-sharing-ux";
import {
  useEpicChatIds,
  useEpicNodeArchived,
  useEpicAgentActivityTiers,
} from "@/lib/epic-selectors";
import type { EpicNodeKind } from "@/lib/artifacts/node-display";
import type { SidebarRowMenuEntry } from "@/components/epic-canvas/sidebar/sidebar-row-menu-items";
import { useExistingChatSessionHandle } from "@/lib/registries/chat-session-registry";
import { chatActivityIndicator } from "@/components/epic-canvas/renderers/chat-tile-session-state";
import { type IndicatorRunningKind } from "@/components/notifications/notification-indicator-icon";
import { useNewConversationModalOpenStore } from "@/stores/epics/new-conversation-modal-open-store";
import { ACTIVE_TILE_PLACEMENT } from "@/lib/canvas/conversation-tile-placement";

/**
 * Whether the epic's host advertises `epic.setChatArchived`. Resolved ONCE per
 * list body and read by the rows: it is a per-host fact, identical for every
 * row, and re-subscribing each row to the manifest registry would buy nothing.
 * `false` is the fail-closed default - every archive affordance stays hidden
 * until a handshake proves the method present.
 */
export const SidebarArchiveSupportedContext = createContext<boolean>(false);

export interface SidebarChatSharingValue {
  readonly visibilitySupported: boolean;
  readonly ownCloudChatByLocalId: ReadonlyMap<string, CloudChatSummary>;
  readonly hasCollaborators: boolean;
}

const EMPTY_OWN_CLOUD_CHATS: ReadonlyMap<string, CloudChatSummary> = new Map();

/**
 * Per-chat sharing facts that are identical for every row (capability, the
 * fold of local ids onto cloud rows, whether this task has an audience).
 * Resolved once per list body and read by the rows, matching
 * {@link SidebarArchiveSupportedContext}.
 */
export const SidebarChatSharingContext = createContext<SidebarChatSharingValue>(
  {
    visibilitySupported: false,
    ownCloudChatByLocalId: EMPTY_OWN_CLOUD_CHATS,
    hasCollaborators: false,
  },
);

/** Frozen so an absent cloud list does not re-run the fold every render. */
const EMPTY_CLOUD_CHATS: readonly CloudChatSummary[] = [];

export interface ChatRowMenuFacts {
  readonly canArchive: boolean;
  readonly sharing: SidebarChatSharingValue;
}

/**
 * The two per-list facts every agent row's menu is decided against, resolved
 * once for the whole list.
 *
 * Sharing fold, mutations, and cache keys all address the Epic SESSION host.
 * The redirect map is host-LOCAL (only the epic's host knows C1→C2), so
 * reading it from the active host would make "Make private" mutate the wrong
 * lineage after a fork.
 */
export function useChatRowMenuFacts(epicId: string): ChatRowMenuFacts {
  const canArchive = useChatArchiveSupported();
  const canSetVisibility = useCloudChatVisibilitySupported();
  const sessionHostClient = useEpicSessionHostClient();
  const localChatIds = useEpicChatIds();
  const collaboratorsQuery = useEpicCollaboratorsQuery(epicId, {
    client: sessionHostClient,
    poll: undefined,
    staleTime: undefined,
  });
  const hasCollaborators = taskHasCollaborators(collaboratorsQuery.data);
  const sharingCloudChats = useCloudChatList({
    client: sessionHostClient,
    taskId: epicId,
    enabled: epicId.length > 0,
  });
  const sharingPublicationTargets = useChatPublicationTargets({
    client: sessionHostClient,
    epicId,
    chatIds: localChatIds,
    enabled: epicId.length > 0,
  });
  const ownCloudChatByLocalId = useMemo(
    () =>
      indexOwnCloudChatsByLocalId({
        chats: sharingCloudChats.data?.chats ?? EMPTY_CLOUD_CHATS,
        localChatIds,
        publicationChatIdByChatId: publicationTargetMap(
          sharingPublicationTargets.data,
        ),
      }),
    [localChatIds, sharingCloudChats.data, sharingPublicationTargets.data],
  );
  const sharing = useMemo<SidebarChatSharingValue>(
    () => ({
      visibilitySupported: canSetVisibility,
      ownCloudChatByLocalId,
      hasCollaborators,
    }),
    [canSetVisibility, hasCollaborators, ownCloudChatByLocalId],
  );
  return { canArchive, sharing };
}

export interface ChatRowSessionActivity {
  /** The tier the row is busy at, or `false` for idle. */
  readonly running: IndicatorRunningKind;
  /** Whether this row's chat is currently open as a session. */
  readonly hasSession: boolean;
  /** The open session's own access role, `null` while unopened or unknown. */
  readonly sessionRole: string | null;
}

/**
 * The row's live activity, read from its OWN chat session when one is open and
 * backfilled by epic awareness otherwise.
 *
 * Authority order matters: an open chat's session tri-state wins, epic
 * awareness covers the subscription-gap window and every unopened row. The
 * snapshots are deliberately PRIMITIVES, so a subscriber re-renders only when
 * the tier actually flips rather than on every queue or background-item tick.
 *
 * Terminal-agent rows have no chat session (their PTY runs host-side), so they
 * resolve from awareness alone.
 */
export function useChatRowSessionActivity(args: {
  readonly epicId: string;
  readonly nodeId: string;
  /** The row's OWN owner host - agent ids are host-minted, so a same-id agent
   *  on another machine must not answer for this row. */
  readonly ownerHostId: string | null;
  readonly artifactType: EpicNodeKind;
}): ChatRowSessionActivity {
  const { epicId, nodeId, ownerHostId, artifactType } = args;
  const awarenessTier = useEpicAgentActivityTiers().get(nodeId);
  const isChat = artifactType === "chat";
  const sessionHandle = useExistingChatSessionHandle(
    epicId,
    nodeId,
    ownerHostId,
  );
  const subscribeSession = useMemo(
    () => (onChange: () => void) => {
      if (sessionHandle === null) return () => undefined;
      return sessionHandle.store.subscribe(onChange);
    },
    [sessionHandle],
  );
  const sessionActivity = useSyncExternalStore(subscribeSession, () =>
    sessionHandle === null
      ? null
      : chatActivityIndicator(sessionHandle.store.getState()),
  );
  const sessionRole = useSyncExternalStore(subscribeSession, () =>
    sessionHandle === null
      ? null
      : (sessionHandle.store.getState().access?.role ?? null),
  );
  if (sessionHandle === null || !isChat) {
    return {
      running: awarenessTier ?? false,
      hasSession: false,
      sessionRole: null,
    };
  }
  return {
    running: sessionActivity ?? awarenessTier ?? false,
    hasSession: true,
    sessionRole,
  };
}

/**
 * The row's archive menu state, or `null` on a host that lacks
 * `epic.setChatArchived` - in which case the entry is absent from both menus
 * rather than present-but-disabled.
 */
export interface ChatRowArchiveEntry {
  readonly isArchived: boolean;
  readonly disabled: boolean;
  /** Populated only for the busy arm; `null` whenever `disabled` is false. */
  readonly disabledTooltip: string | null;
}

/**
 * A row's archive INPUTS, grouped because they are one concept and always
 * travel together: whether the host can archive at all, whether this row
 * already is, whether a toggle is in flight, and how to toggle it.
 */
export interface ChatRowArchiveInputs {
  readonly supported: boolean;
  readonly isArchived: boolean;
  readonly pending: boolean;
  readonly onToggle: () => void;
}

/**
 * Copy for a refused archive, matched to the tier so the row explains the
 * ACTUAL reason - "working" and "has background items running" are different
 * things to wait on, and a single generic string would misdescribe one of them.
 *
 * This tooltip is the ONLY message these rows get. The entry is soft-disabled,
 * which prevents `onSelect`, so the host's own refusal - and the toast that
 * rewrites it into user-facing copy - never fire from here. Advice that is
 * wrong in this string is wrong with nothing behind it to correct it.
 *
 * So the background arm must not say "stop it". Every stop affordance routes
 * into `ChatSession.stopActiveTurn()`, which early-returns when no turn is
 * running, so an agent held only by a detached subagent, a workflow or a
 * scheduled wake cannot be stopped into an archivable state - the user would
 * press Stop, see nothing change, and be told the same thing again. It names
 * the per-item controls in the chat instead, which is the affordance that
 * actually clears them.
 */
function archiveBlockedReason(
  // Excludes the idle tier rather than trusting the caller's `running !== false`
  // guard. Without it a future caller could pass an idle row and silently get
  // the background-items copy, which describes a state that is not blocked at
  // all - a wrong explanation, not a missing one.
  running: Exclude<IndicatorRunningKind, false>,
): string {
  if (running === "turn") {
    // Hedged, because this tier is NOT "a turn is running". `chatActivityIndicator`
    // deliberately maps a detached subagent or workflow fleet outliving its turn
    // into `"turn"` - it is the agent working, so it earns the busy spinner
    // rather than the muted background glyph - while `resolvedTurnStatus`
    // reports no active turn for that same state, precisely so a Stop-turn
    // affordance does not surface. Promising a stop here would contradict that
    // and send the user after an action the host early-returns from.
    return "Can't archive while this agent is working. Stopping it ends a turn, but not a detached subagent or workflow. Wait for it to go idle, or stop it, then archive.";
  }
  return "Can't archive while this agent has background items running. Stopping the agent won't clear them — wait for them to finish, or stop them from its chat.";
}

/**
 * The archive MENU entry for a row whose host supports the method: present on
 * every such row, and merely SOFT-disabled while the row is busy (`aria-disabled`,
 * not Radix's `disabled`) so it stays in the arrow-key order and can still
 * announce its reason - see `softDisabledProps` in `sidebar-row-menu-items`.
 * The entry, not any hover shortcut, is what carries the explanation.
 *
 * Busy is read off the raw running tier, NOT off a folded status kind. Folding
 * loses exactly the case this gate exists for: gating on
 * `kind === "working" | "background"` left Archive ENABLED on any running chat
 * that also had a pending approval or interview, which is most of them at the
 * moment a human is looking. The host refuses such an archive anyway; matching
 * it here is what keeps the affordance honest instead of offering an action
 * that will only come back as a toast.
 *
 * "Busy" means everything the host counts, which includes a chat owning a
 * running shell - not just an in-flight turn - so it must stay whatever
 * `chatActivityIndicator` reports.
 *
 * UNARCHIVING is never gated on busy - the host allows it, and an archived row
 * can be working (an inbound message auto-unarchives and wakes it, so the flag
 * and the run legitimately overlap). Only `archivePending` disables that
 * direction, to stop a double-submit.
 */
export function chatRowArchiveEntry(args: {
  readonly isArchived: boolean;
  readonly archivePending: boolean;
  readonly running: IndicatorRunningKind;
}): ChatRowArchiveEntry {
  // The tier that BLOCKS, or `false` for none. Carrying the narrowed value
  // rather than a separate boolean is what lets `archiveBlockedReason` refuse
  // the idle tier by type: a bare `blocksArchive` flag proves nothing to the
  // compiler about the tier at the call below.
  const blockingRun: IndicatorRunningKind = args.isArchived
    ? false
    : args.running;
  return {
    isArchived: args.isArchived,
    disabled: blockingRun !== false || args.archivePending,
    disabledTooltip:
      blockingRun === false ? null : archiveBlockedReason(blockingRun),
  };
}

/**
 * A row's archive inputs, bound to the shared mutation and the per-list
 * capability context. The toggle is inert without edit rights or host support,
 * so a caller cannot route around the gate by rendering the entry itself.
 */
export function useChatRowArchiveInputs(args: {
  readonly epicId: string;
  readonly nodeId: string;
  readonly canMutate: boolean;
}): ChatRowArchiveInputs {
  const { epicId, nodeId, canMutate } = args;
  const archiveSupported = useContext(SidebarArchiveSupportedContext);
  const isArchived = useEpicNodeArchived(nodeId);
  const archiveChat = useEpicArchiveChat();
  const onToggle = useCallback(() => {
    if (!canMutate || !archiveSupported) return;
    archiveChat.mutate({ epicId, chatId: nodeId, archived: !isArchived });
  }, [archiveChat, archiveSupported, canMutate, epicId, isArchived, nodeId]);
  return useMemo(
    () => ({
      supported: archiveSupported,
      isArchived,
      pending: archiveChat.isPending,
      onToggle,
    }),
    [archiveSupported, isArchived, archiveChat.isPending, onToggle],
  );
}

export function useChatRowSharing(
  epicId: string,
  nodeId: string,
  artifactType: EpicNodeKind,
  canMutate: boolean,
): {
  readonly entry: ChatSharingMenuDecision;
  readonly onToggle: () => void;
  readonly showIndicator: boolean;
} {
  const sharing = useContext(SidebarChatSharingContext);
  const setVisibility = useEpicSetCloudChatVisibility();
  const sharingInFlight = useChatSharingInFlight(epicId);
  const cloudChat = sharing.ownCloudChatByLocalId.get(nodeId);
  const visibility = cloudChat?.visibility ?? null;
  return {
    entry: decideChatSharingMenuEntry({
      supported: sharing.visibilitySupported,
      isChat: artifactType === "chat",
      canMutate,
      visibility,
      pending: sharingInFlight,
    }),
    onToggle: () => {
      if (
        !canMutate ||
        !sharing.visibilitySupported ||
        sharingInFlight ||
        cloudChat === undefined
      ) {
        return;
      }
      setVisibility.mutate({
        taskId: cloudChat.identity.taskId,
        chatId: cloudChat.identity.chatId,
        visibility: cloudChat.visibility === "task" ? "private" : "task",
      });
    },
    showIndicator: shouldShowSharedWithTaskIndicator({
      visibility,
      hasCollaborators: sharing.hasCollaborators,
    }),
  };
}

/**
 * "New child agent" opens the shared New Conversation modal seeded with this
 * row as the parent - the same action the top-level new-agent trigger fires,
 * so it preserves the modal's remembered interface.
 */
export function useNewChildAgentAction(args: {
  readonly epicId: string;
  readonly tabId: string;
  readonly nodeId: string;
  readonly canMutate: boolean;
}): () => void {
  const { epicId, tabId, nodeId, canMutate } = args;
  const openNewConversationModal = useNewConversationModalOpenStore(
    (state) => state.open,
  );
  return useCallback(() => {
    if (!canMutate) return;
    openNewConversationModal({
      epicId,
      tabId,
      placement: ACTIVE_TILE_PLACEMENT,
      parentId: nodeId,
      // Names no host, exactly like the panel's own `+`: the modal resolves
      // this Epic's placement memory (last created chat's host, else the
      // session's host) with the picker live. The PARENT row's owner host is
      // deliberately not passed - naming it would freeze the picker and a child
      // is not required to live on its parent's machine.
      hostId: null,
    });
  }, [canMutate, epicId, nodeId, openNewConversationModal, tabId]);
}

export interface ChatRowMenuEntriesProps {
  readonly nodeId: string;
  readonly canMutate: boolean;
  readonly archiveEntry: ChatRowArchiveEntry | null;
  readonly sharingEntry: ChatSharingMenuDecision;
  readonly onNewChildAgent: () => void;
  readonly onStartRename: () => void;
  readonly onToggleArchive: () => void;
  readonly onToggleSharing: () => void;
  readonly onPerformDelete: () => void;
}

/**
 * The Archive / Unarchive entry, or nothing at all. Kept as a spreadable list
 * so `chatRowMenuEntries` stays one flat literal - the ⋯ and right-click menus
 * both render from it, so a single definition covers both surfaces.
 *
 * The label is the ACTION, not the state: an archived row offers "Unarchive".
 */
function archiveMenuEntries(
  props: ChatRowMenuEntriesProps,
): ReadonlyArray<SidebarRowMenuEntry> {
  const { archiveEntry } = props;
  if (archiveEntry === null) return [];
  return [
    {
      kind: "item",
      id: "archive",
      label: archiveEntry.isArchived ? "Unarchive" : "Archive",
      icon: archiveEntry.isArchived ? (
        <ArchiveRestore className="size-3.5" />
      ) : (
        <Archive className="size-3.5" />
      ),
      disabled: !props.canMutate || archiveEntry.disabled,
      // Only the busy arm explains itself. `!canMutate` greys out every entry
      // in the menu at once, so a per-entry tooltip there would be noise.
      disabledTooltip: props.canMutate ? archiveEntry.disabledTooltip : null,
      variant: "default",
      testIds: {
        dropdown: `epic-sidebar-archive-item-${props.nodeId}`,
        context: `epic-sidebar-context-archive-${props.nodeId}`,
      },
      onSelect: props.onToggleArchive,
    },
  ];
}

/**
 * The Share with task / Make private entry, or nothing at all. Same spread
 * shape as {@link archiveMenuEntries} so both the ⋯ and right-click menus
 * pick it up from one definition.
 *
 * The label is the ACTION, not the state: a task-visible row offers
 * "Make private".
 */
function sharingMenuEntries(
  props: ChatRowMenuEntriesProps,
): ReadonlyArray<SidebarRowMenuEntry> {
  const { sharingEntry } = props;
  if (sharingEntry.kind === "hidden") return [];
  const makePrivate = sharingEntry.action === "make-private";
  return [
    {
      kind: "item",
      id: "share",
      label: makePrivate ? "Make private" : "Share with task",
      icon: makePrivate ? (
        <Lock className="size-3.5" />
      ) : (
        <Users className="size-3.5" />
      ),
      disabled: !props.canMutate || sharingEntry.disabled,
      disabledTooltip: props.canMutate ? sharingEntry.disabledTooltip : null,
      variant: "default",
      testIds: {
        dropdown: `epic-sidebar-share-item-${props.nodeId}`,
        context: `epic-sidebar-context-share-${props.nodeId}`,
      },
      onSelect: props.onToggleSharing,
    },
  ];
}

export function chatRowMenuEntries(
  props: ChatRowMenuEntriesProps,
): ReadonlyArray<SidebarRowMenuEntry> {
  return [
    {
      kind: "item",
      id: "new-child-agent",
      label: "New child agent",
      icon: <Plus className="size-3.5" />,
      disabled: !props.canMutate,
      disabledTooltip: null,
      variant: "default",
      testIds: {
        dropdown: `epic-sidebar-new-child-${props.nodeId}`,
        context: `epic-sidebar-context-new-child-${props.nodeId}`,
      },
      onSelect: props.onNewChildAgent,
    },
    {
      kind: "item",
      id: "rename",
      label: "Rename",
      icon: <Pencil className="size-3.5" />,
      disabled: !props.canMutate,
      disabledTooltip: null,
      variant: "default",
      testIds: {
        dropdown: `epic-sidebar-rename-${props.nodeId}`,
        context: `epic-sidebar-context-rename-${props.nodeId}`,
      },
      onSelect: props.onStartRename,
    },
    ...archiveMenuEntries(props),
    ...sharingMenuEntries(props),
    { kind: "separator", id: "before-delete" },
    {
      kind: "item",
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="size-3.5" />,
      disabled: !props.canMutate,
      disabledTooltip: null,
      variant: "destructive",
      testIds: {
        dropdown: `epic-sidebar-delete-${props.nodeId}`,
        context: `epic-sidebar-context-delete-${props.nodeId}`,
      },
      onSelect: props.onPerformDelete,
    },
  ];
}
