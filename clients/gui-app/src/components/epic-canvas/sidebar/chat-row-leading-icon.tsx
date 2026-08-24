/**
 * The leading status/identity icon an agent row wears, and the collapsed-parent
 * rollup that feeds it - on BOTH form factors.
 *
 * It lives here rather than in `epic-sidebar-chat-tree`, where it grew, because
 * a module-private component is a component the phone cannot reach: the mobile
 * switcher's agent list had grown a parallel icon of its own, which resolved a
 * coarser status vocabulary and could not show a collapsed parent's rollup at
 * all. Two renderings of one row's single status surface is a difference a user
 * sees, so there is now one.
 *
 * Kept out of `chat-row-chrome`, which is deliberately the row's presentational
 * scraps: everything here subscribes - to the notification store, to epic
 * awareness, to a host's provider list - and a slot that repaints on every
 * status tick does not belong beside a static archived marker.
 */
import { memo, useContext, useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChatProgressIcon } from "@/components/chat/chat-progress-icon";
import { TerminalAgentProgressIcon } from "@/components/chat/terminal-agent-progress-icon";
import { BackgroundActivityGlyph } from "@/components/notifications/background-activity-glyph";
import {
  NotificationIndicatorsContext,
  useSurfaceNotificationIndicatorState,
} from "@/components/notifications/notification-indicator-context";
import {
  APPROVAL_TONE,
  DONE_TONE,
  FAILURE_TONE,
  FORK_TONE,
  INTERVIEW_TONE,
  type IndicatorTone,
} from "@/components/notifications/notification-indicator-tones";
import { ProfileBadgedHarnessIcon } from "@/components/providers/profile-badged-harness-icon";
import type { ProviderId } from "@/components/home/data/landing-options";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { resolveProfileAccentDot } from "@/components/worktree/worktree-owner-settings-model";
import { harnessProfiles } from "@/components/worktree/worktree-owner-settings-profiles";
import { useHostClientForHostId } from "@/hooks/host/use-host-client-for-host-id";
import { useProvidersListForClient } from "@/hooks/providers/use-providers-list-query";
import { useEpicStore } from "@/hooks/use-epic-store";
import {
  EPIC_NODE_ICONS,
  type EpicNodeKind,
} from "@/lib/artifacts/node-display";
import {
  useEpicAgentActivityTiers,
  useEpicNodeHostIds,
  useEpicTreeIndex,
  useMaybeEpicTuiAgentHarnessId,
} from "@/lib/epic-selectors";
import { cn } from "@/lib/utils";
import { useAppLocalNotificationsStore } from "@/stores/notifications/app-local-notifications-store";
import { selectNotificationIndicatorState } from "@/stores/notifications/notification-indicator-state";
import {
  CHAT_STATUS_ORDER,
  CHAT_STATUS_RANKS,
  chatDescendantKind,
  chatSelfStatusRank,
  collectDescendantChatIds,
  EMPTY_CHAT_DESCENDANT_IDS,
  nestedChatStatusSummary,
  type ChatDescendantStatusKind,
  type ChatDescendantStatusRollup,
} from "./chat-row-status-ladder";
import { useSidebarVisibleIds } from "./epic-sidebar-filter";
import { useNodeIconDisplay } from "./epic-sidebar-tree-shared";

/**
 * Rollup over a collapsed parent's hidden chat descendants, or `null` when
 * there are none or none has a notable status. Each descendant is classified
 * once, under its own highest tier - the per-chat attention precedence goes
 * through the shared `attentionTone`, so failure > interview > approval lives
 * in exactly one place. Terminal-agent descendants are classified the same
 * way: their `agent.stopped` notifications are chat-scoped to the agent id,
 * so they carry real indicator entries alongside their activity tier. Only
 * mounted inside `ChatRowLeadingIconWithNestedRollup` (rendered solely for
 * collapsed parents), so leaves and expanded rows carry none of these
 * subscriptions; the shallow-compared flat result lets Zustand bail re-renders
 * whose rollup did not change.
 */
function useChatDescendantStatus(args: {
  readonly epicId: string;
  readonly nodeId: string;
}): ChatDescendantStatusRollup | null {
  const { epicId, nodeId } = args;
  const tree = useEpicTreeIndex();
  const visibleIds = useSidebarVisibleIds();
  const descendants = useMemo(
    () => collectDescendantChatIds(nodeId, tree, visibleIds),
    [nodeId, tree, visibleIds],
  );
  const descendantHostIds = useEpicNodeHostIds(descendants);
  const activityTiers = useEpicAgentActivityTiers();
  const indicators = useContext(NotificationIndicatorsContext);
  return useAppLocalNotificationsStore(
    useShallow((state): ChatDescendantStatusRollup | null => {
      if (descendants === EMPTY_CHAT_DESCENDANT_IDS) return null;
      const counts: Record<ChatDescendantStatusKind, number> = {
        failure: 0,
        fork: 0,
        interview: 0,
        approval: 0,
        running: 0,
        background: 0,
        done: 0,
        "terminal-failure": 0,
      };
      for (const [index, chatId] of descendants.entries()) {
        const indicatorState = selectNotificationIndicatorState(
          state,
          { epicId, chatId },
          descendantHostIds[index] ?? null,
          indicators,
        );
        const kind = chatDescendantKind(
          indicatorState,
          activityTiers.get(chatId),
        );
        if (kind !== null) counts[kind] += 1;
      }
      const kind =
        CHAT_STATUS_ORDER.find((candidate) => counts[candidate] > 0) ?? null;
      if (kind === null) return null;
      return {
        kind,
        failureCount: counts.failure,
        forkCount: counts.fork,
        interviewCount: counts.interview,
        approvalCount: counts.approval,
        runningCount: counts.running,
        backgroundCount: counts.background,
        doneCount: counts.done,
        terminalFailureCount: counts["terminal-failure"],
      };
    }),
  );
}

/**
 * Fixed-size slot the leading icon renders into, so every row's text column
 * starts at the same x regardless of which variant (chat glyph, harness brand
 * + terminal subscript, spinner, bot) fills it. Sized to the widest variant -
 * `SidebarAgentHarnessIcon`, whose subscript overhangs the 14px brand mark.
 *
 * The slot is only a WIDTH reservation: it carries no vertical alignment of
 * its own. Centering across the two-line card is the outer row's job
 * (`items-center`), which is why the slot must not grow to the card's height.
 */
export function ChatRowLeadingIconSlot(props: {
  readonly children: ReactNode;
}) {
  return (
    // NOT `aria-hidden`. This slot was hidden while a trailing status chip
    // existed, because the two announced the same state and a read-only row
    // said "Read-only agent" twice. The row now carries no trailing chip, so
    // this icon is the row's ONLY status surface (`ChatProgressIcon` for chats,
    // the spinner / rollup for agents) - hiding it would drop running,
    // approval, failure, and read-only from the a11y tree entirely rather than
    // de-duplicating them. The status elements inside own their own
    // `role="status"` and accessible names; nothing here is focusable.
    <span className="inline-flex h-3.5 w-[1.125rem] shrink-0 items-center">
      {props.children}
    </span>
  );
}

/**
 * Leading icon for a sidebar row - the row's single status surface now that no
 * trailing chip exists. A COLLAPSED PARENT resolves its hidden descendants'
 * rollup here too: that rollup used to live in the trailing slot, and dropping
 * the slot without rehoming it would leave a failure inside a collapsed subtree
 * with nowhere to surface.
 */
export function ChatRowLeadingIcon(props: {
  readonly epicId: string;
  readonly nodeId: string;
  /** The row's OWN owner host, off its projection row - see
   *  {@link ChatRowOwnLeadingIcon}. */
  readonly ownerHostId: string | null;
  readonly artifactType: EpicNodeKind;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}) {
  if (props.hasChildren && !props.expanded) {
    return (
      <ChatRowLeadingIconWithNestedRollup
        epicId={props.epicId}
        nodeId={props.nodeId}
        ownerHostId={props.ownerHostId}
        artifactType={props.artifactType}
      />
    );
  }
  return (
    <ChatRowOwnLeadingIcon
      epicId={props.epicId}
      nodeId={props.nodeId}
      ownerHostId={props.ownerHostId}
      artifactType={props.artifactType}
    />
  );
}

/**
 * Leading slot for a collapsed parent. Merges the parent's own status with the
 * hidden descendants' rollup on the shared ladder: the more urgent one owns the
 * slot, ties go to the parent - so a hidden failure can never sit invisible
 * behind a parent that is merely running. When the parent's own status wins it
 * renders the same icon a leaf row shows. Mounted only for collapsed parents,
 * so rows without a rollup carry none of these subscriptions.
 */
const ChatRowLeadingIconWithNestedRollup = memo(
  function ChatRowLeadingIconWithNestedRollup(props: {
    readonly epicId: string;
    readonly nodeId: string;
    readonly ownerHostId: string | null;
    readonly artifactType: EpicNodeKind;
  }) {
    const rollup = useChatDescendantStatus({
      epicId: props.epicId,
      nodeId: props.nodeId,
    });
    const activityTiers = useEpicAgentActivityTiers();
    const selfIndicator = useSurfaceNotificationIndicatorState(
      { epicId: props.epicId, chatId: props.nodeId },
      props.ownerHostId,
    );
    if (rollup !== null) {
      const selfTier = activityTiers.get(props.nodeId);
      // Chat and terminal-agent parents rank alike: a TUI agent's
      // `agent.stopped` notifications are chat-scoped to its id, so its
      // indicator entry is as real as a chat's.
      const selfRank = chatSelfStatusRank(selfIndicator, selfTier);
      if (CHAT_STATUS_RANKS[rollup.kind] > selfRank) {
        return <NestedChatStatusIcon nodeId={props.nodeId} rollup={rollup} />;
      }
    }
    return (
      <ChatRowOwnLeadingIcon
        epicId={props.epicId}
        nodeId={props.nodeId}
        ownerHostId={props.ownerHostId}
        artifactType={props.artifactType}
      />
    );
  },
);

/**
 * A row's OWN identity/status glyph, ignoring any descendants. Chat rows get
 * the status-aware chat glyph, TUI rows the harness brand, and any other node
 * kind its static registry glyph.
 */
export function ChatRowOwnLeadingIcon(props: {
  readonly epicId: string;
  readonly nodeId: string;
  /**
   * The row's OWN owner host, read off its projection row rather than from a
   * tab binding: a sidebar row is not inside any `TabHostProvider`, and the
   * tree deliberately lists chats owned by connected PEER hosts alongside
   * this machine's. `chatId` is host-minted, so without the row's own host the
   * status read could land on a same-id chat living on a different machine.
   */
  readonly ownerHostId: string | null;
  readonly artifactType: EpicNodeKind;
}) {
  if (props.artifactType === "chat") {
    // No idle-slot override: `ChatProgressIcon` falls back to the plain chat
    // glyph (per-type icon color included) and stays authoritative for
    // read-only, activity, approval, failure, and completion states. Chat rows
    // deliberately do NOT wear the harness brand - a column of multi-colored
    // provider marks reads as noise; the harness is surfaced in the row's
    // tooltip, header, and composer instead.
    return (
      <ChatProgressIcon
        epicId={props.epicId}
        chatId={props.nodeId}
        hostId={props.ownerHostId}
        className={undefined}
        mutedClassName="text-muted-foreground/70"
        testId="chat-sidebar-spinner"
        defaultIcon={undefined}
      />
    );
  }
  if (props.artifactType === "terminal-agent") {
    return (
      <SidebarTerminalAgentProgressIcon
        epicId={props.epicId}
        nodeId={props.nodeId}
        ownerHostId={props.ownerHostId}
      />
    );
  }
  return <StaticSidebarNodeIcon artifactType={props.artifactType} />;
}

/**
 * Terminal-agent (TUI) sidebar icon: the sidebar's idle glyph (harness brand
 * mark, generic bot as fallback) over the shared
 * {@link TerminalAgentProgressIcon} status mapping, which is what makes
 * notification status outrank live activity and splits the running arm into
 * turn vs background. Only the idle glyph and the icon-color display are the
 * sidebar's own; every other surface listing agents renders a different idle
 * glyph over that same mapping rather than re-deriving one.
 */
function SidebarTerminalAgentProgressIcon(props: {
  readonly epicId: string;
  readonly nodeId: string;
  readonly ownerHostId: string | null;
}) {
  const harnessId = useMaybeEpicTuiAgentHarnessId(props.nodeId);
  const icon = useNodeIconDisplay("terminal-agent");
  // The underlying harness's brand mark (Claude, Codex, …) so the row reads
  // as the tool driving the agent. Brand marks keep their own colors and
  // intentionally don't follow the per-type icon-color customization; the
  // generic bot glyph is the fallback for unresolved/legacy records.
  const idleIcon =
    harnessId !== null ? (
      <SidebarAgentHarnessIcon nodeId={props.nodeId} harnessId={harnessId} />
    ) : (
      <StaticSidebarNodeIcon artifactType="terminal-agent" />
    );
  return (
    <TerminalAgentProgressIcon
      epicId={props.epicId}
      nodeId={props.nodeId}
      originHostId={props.ownerHostId}
      className={icon.className}
      style={icon.style}
      testIdPrefix="terminal-agent-sidebar"
      idleIcon={idleIcon}
    />
  );
}

/**
 * TUI-agent harness identity with a terminal surface mark. The brand mark is a
 * TUI-only affordance - GUI chat rows keep the plain chat glyph - so the bare
 * terminal glyph rides along without a background, keeping the harness mark
 * visible beneath it.
 */
function SidebarAgentHarnessIcon(props: {
  readonly nodeId: string;
  readonly harnessId: ProviderId;
}) {
  const TerminalIcon = EPIC_NODE_ICONS.terminal;
  const tuiAgent = useEpicStore((state) =>
    Object.hasOwn(state.tuiAgents.byId, props.nodeId)
      ? state.tuiAgents.byId[props.nodeId]
      : null,
  );
  const managedProfileId = tuiAgent?.profileId ?? null;
  return (
    <TooltipWrapper
      label="TUI terminal agent"
      side="top"
      sideOffset={undefined}
      align={undefined}
    >
      <span
        data-testid={`sidebar-agent-harness-${props.nodeId}`}
        data-agent-surface="tui"
        className="relative inline-flex h-3.5 w-[1.125rem] shrink-0 items-center"
      >
        {managedProfileId === null ? (
          <ProfileBadgedHarnessIcon
            harnessId={props.harnessId}
            harnessName={props.harnessId}
            profileAccentDot={null}
            iconClassName="size-3.5"
            className={undefined}
            testId={`sidebar-agent-profile-mark-${props.nodeId}`}
          />
        ) : (
          <ManagedProfileSidebarHarnessIcon
            nodeId={props.nodeId}
            harnessId={props.harnessId}
            hostId={tuiAgent?.hostId ?? null}
            profileId={managedProfileId}
          />
        )}
        <TerminalIcon
          aria-hidden="true"
          data-testid={`sidebar-agent-surface-${props.nodeId}`}
          data-agent-surface="tui"
          className="pointer-events-none absolute -top-1.5 -right-1 size-2 text-muted-foreground"
          strokeWidth={3}
        />
      </span>
    </TooltipWrapper>
  );
}

function ManagedProfileSidebarHarnessIcon(props: {
  readonly nodeId: string;
  readonly harnessId: ProviderId;
  readonly hostId: string | null;
  readonly profileId: string;
}) {
  const hostClient = useHostClientForHostId(props.hostId);
  const providersList = useProvidersListForClient(hostClient, {
    enabled: true,
    subscribed: true,
  });
  const profiles = harnessProfiles(
    providersList.data?.providers ?? null,
    props.harnessId,
  );
  return (
    <ProfileBadgedHarnessIcon
      harnessId={props.harnessId}
      harnessName={props.harnessId}
      profileAccentDot={resolveProfileAccentDot(props.profileId, profiles)}
      iconClassName="size-3.5"
      className={undefined}
      testId={`sidebar-agent-profile-mark-${props.nodeId}`}
    />
  );
}

function StaticSidebarNodeIcon(props: { readonly artifactType: EpicNodeKind }) {
  const icon = useNodeIconDisplay(props.artifactType);
  const Icon = EPIC_NODE_ICONS[props.artifactType];
  return <Icon aria-hidden className={icon.className} style={icon.style} />;
}

// Glyph and color come from the shared notification tones so the nested
// variant cannot drift from the per-row icon; "running" stays local because
// it is an activity tier, not a notification state.
const CHAT_DESCENDANT_STATUS_TONES: Record<
  Exclude<ChatDescendantStatusKind, "running" | "background">,
  IndicatorTone
> = {
  failure: FAILURE_TONE,
  fork: FORK_TONE,
  interview: INTERVIEW_TONE,
  approval: APPROVAL_TONE,
  done: DONE_TONE,
  // A collapsed aggregate can contain GUI and TUI descendants, so it uses the
  // surface-neutral chat failure glyph. Leaf TUI rows keep TerminalSquare.
  "terminal-failure": FAILURE_TONE,
};

/**
 * The muted variant of the status icon: same glyph, same slot, reduced
 * opacity - the artifact tree's solid-vs-translucent "self vs descendant"
 * convention applied to chat status. The tooltip carries the full nested
 * breakdown, since one glyph can stand for several children.
 */
function NestedChatStatusIcon(props: {
  readonly nodeId: string;
  readonly rollup: ChatDescendantStatusRollup;
}): ReactNode {
  const title = nestedChatStatusSummary(props.rollup);
  return (
    <TooltipWrapper
      label={title}
      side="top"
      sideOffset={undefined}
      align={undefined}
    >
      <span
        role="status"
        aria-label={title}
        data-testid={`chat-descendant-status-${props.rollup.kind}-${props.nodeId}`}
        className="inline-flex size-3.5 shrink-0 items-center justify-center opacity-60"
      >
        <NestedChatStatusGlyph kind={props.rollup.kind} />
      </span>
    </TooltipWrapper>
  );
}

function NestedChatStatusGlyph(props: {
  readonly kind: ChatDescendantStatusKind;
}): ReactNode {
  if (props.kind === "background") {
    return <BackgroundActivityGlyph testId={undefined} />;
  }
  if (props.kind === "running") {
    return (
      <AgentSpinningDots
        className="text-current"
        testId={undefined}
        variant={undefined}
      />
    );
  }
  const tone = CHAT_DESCENDANT_STATUS_TONES[props.kind];
  const Icon = tone.Icon;
  return <Icon aria-hidden className={cn("size-3.5", tone.className)} />;
}
