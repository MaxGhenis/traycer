/**
 * The urgency ladder an agent row's status resolves on, and the descendant walk
 * a collapsed parent rolls up over. Pure functions and data only.
 *
 * Split from `chat-row-leading-icon`, which renders it: that module exports
 * components, and a module that exports both loses fast refresh for everything
 * in it. The panel body also classifies rows with `chatDescendantKind` - to
 * decide which archived rows stay visible - without rendering an icon at all.
 */
import {
  APPROVAL_TONE,
  attentionTone,
  FAILURE_TONE,
  FORK_TONE,
  INTERVIEW_TONE,
  terminalFailureTone,
} from "@/components/notifications/notification-indicator-tones";
import type { AgentActivityTier } from "@/lib/epic-selectors";
import type { NotificationIndicatorState } from "@/stores/notifications/notification-indicator-state";
import type { TreeSlice } from "@/stores/epics/open-epic/types";
import { CHATS_TREE_FILTER } from "./epic-sidebar-selection";

export type ChatDescendantStatusKind =
  | "failure"
  | "fork"
  | "interview"
  | "approval"
  | "running"
  | "background"
  | "done"
  | "terminal-failure";

/**
 * One shared urgency ladder for a collapsed parent's icon slot: the parent's
 * own status tier and the hidden descendants' highest tier are ranked on it,
 * and the higher one owns the slot (ties go to the parent, so solid always
 * beats muted). Mirrors the order `NotificationIndicatorIcon` resolves a
 * single chat's simultaneous states.
 *
 * `running` (an agent turn) outranks `background` (a `run_in_background` task
 * / subagent / Monitor / scheduled wakeup keeping a session non-idle while the
 * agent itself is idle), matching the turn-over-background precedence the
 * per-chat indicator already uses. Both still outrank `done`, so any live work
 * beats a finished-but-unread one. A terminal failure is deliberately the
 * lowest notable tier: Done remains the stronger task-level signal.
 */
export const CHAT_STATUS_RANKS: Record<ChatDescendantStatusKind, number> = {
  failure: 8,
  fork: 7,
  interview: 6,
  approval: 5,
  running: 4,
  background: 3,
  done: 2,
  "terminal-failure": 1,
};

/** {@link CHAT_STATUS_RANKS} most-urgent first, for picking a rollup's kind. */
export const CHAT_STATUS_ORDER: ReadonlyArray<ChatDescendantStatusKind> = [
  "failure",
  "fork",
  "interview",
  "approval",
  "running",
  "background",
  "done",
  "terminal-failure",
];

/** The ladder kind an activity tier occupies. */
function activityTierKind(tier: AgentActivityTier): ChatDescendantStatusKind {
  return tier === "turn" ? "running" : "background";
}

/**
 * The single tier a descendant chat is counted under - its own highest. The
 * attention precedence goes through the shared `attentionTone`, so
 * failure > interview > approval lives in exactly one place.
 */
export function chatDescendantKind(
  indicatorState: NotificationIndicatorState,
  tier: AgentActivityTier | undefined,
): ChatDescendantStatusKind | null {
  const tone = attentionTone(indicatorState);
  if (tone === FAILURE_TONE) return "failure";
  if (tone === FORK_TONE) return "fork";
  if (tone === INTERVIEW_TONE) return "interview";
  if (tone === APPROVAL_TONE) return "approval";
  // Terminal failure is demoted only for the exact chat's own glyph, where a
  // newer live turn/Done is a stronger statement of current state. Once this
  // chat is rolled into a collapsed parent it is a distinct failed child and
  // must remain attention-priority over a sibling's activity or completion.
  if (terminalFailureTone(indicatorState, "gui") !== null) return "failure";
  if (tier !== undefined) return activityTierKind(tier);
  if (indicatorState.unreadDone) return "done";
  return null;
}

/**
 * The parent's own tier on the shared ladder. `selfTier` is the host-published
 * activity tier from epic awareness - the same authority the per-row icon
 * falls back to for an unopened chat, now carrying the turn/background split
 * so a parent doing only background work cannot outrank a descendant that is
 * genuinely mid-turn.
 */
export function chatSelfStatusRank(
  state: NotificationIndicatorState,
  selfTier: AgentActivityTier | undefined,
): number {
  const tone = attentionTone(state);
  if (tone === FAILURE_TONE) return CHAT_STATUS_RANKS.failure;
  if (tone === FORK_TONE) return CHAT_STATUS_RANKS.fork;
  if (tone === INTERVIEW_TONE) return CHAT_STATUS_RANKS.interview;
  if (tone === APPROVAL_TONE) return CHAT_STATUS_RANKS.approval;
  if (selfTier === "turn") return CHAT_STATUS_RANKS.running;
  if (selfTier === "background") return CHAT_STATUS_RANKS.background;
  if (state.unreadDone) return CHAT_STATUS_RANKS.done;
  if (terminalFailureTone(state, "gui") !== null) {
    return CHAT_STATUS_RANKS["terminal-failure"];
  }
  return 0;
}

/**
 * Rollup over a collapsed parent's hidden chat descendants: the
 * highest-priority kind plus per-tier counts (each descendant is counted once,
 * under its own highest tier) so the icon's tooltip can break the aggregate
 * down instead of hiding it behind one glyph.
 */
export interface ChatDescendantStatusRollup {
  readonly kind: ChatDescendantStatusKind;
  readonly failureCount: number;
  readonly forkCount: number;
  readonly interviewCount: number;
  readonly approvalCount: number;
  readonly runningCount: number;
  readonly backgroundCount: number;
  readonly doneCount: number;
  readonly terminalFailureCount: number;
}

export const EMPTY_CHAT_DESCENDANT_IDS: ReadonlyArray<string> = [];

/**
 * Collects the chat / terminal-agent descendants of `nodeId` so a collapsed
 * parent can roll their statuses up without mounting the child rows. Mirrors
 * the artifact tree's `collectDescendantArtifactEntries`: filter-hidden
 * subtrees are skipped along with their children (the rollup must never point
 * at a row the user cannot reach by expanding) and the walk is cycle-guarded
 * via `visited`. Chats and terminal-agents are collected alike - both are
 * chat-scoped notification entities carrying an activity tier.
 */
export function collectDescendantChatIds(
  nodeId: string,
  tree: TreeSlice,
  visibleIds: ReadonlySet<string> | null,
): ReadonlyArray<string> {
  const rootChildren = Object.hasOwn(tree.childrenByParent, nodeId)
    ? tree.childrenByParent[nodeId]
    : null;
  if (rootChildren === null || rootChildren.length === 0) {
    return EMPTY_CHAT_DESCENDANT_IDS;
  }
  const descendantIds: string[] = [];
  const visited = new Set<string>([nodeId]);
  const stack = [...rootChildren];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    if (visibleIds !== null && !visibleIds.has(id)) continue;
    if (!Object.hasOwn(tree.nodeById, id)) continue;
    const node = tree.nodeById[id];
    if (CHATS_TREE_FILTER(node.type)) descendantIds.push(id);
    if (Object.hasOwn(tree.childrenByParent, id)) {
      for (const childId of tree.childrenByParent[id]) stack.push(childId);
    }
  }
  if (descendantIds.length === 0) {
    return EMPTY_CHAT_DESCENDANT_IDS;
  }
  return descendantIds;
}

/** "Nested: 1 needs attention · 2 running" - non-zero tiers, priority order. */
export function nestedChatStatusSummary(
  rollup: ChatDescendantStatusRollup,
): string {
  const parts: string[] = [];
  if (rollup.failureCount > 0) {
    parts.push(
      `${rollup.failureCount} ${rollup.failureCount === 1 ? "needs" : "need"} attention`,
    );
  }
  if (rollup.forkCount > 0) {
    parts.push(`${rollup.forkCount} waiting for fork resolution`);
  }
  if (rollup.interviewCount > 0) {
    parts.push(`${rollup.interviewCount} waiting for interview`);
  }
  if (rollup.approvalCount > 0) {
    parts.push(`${rollup.approvalCount} waiting for approval`);
  }
  if (rollup.runningCount > 0) parts.push(`${rollup.runningCount} running`);
  if (rollup.backgroundCount > 0) {
    parts.push(`${rollup.backgroundCount} in background`);
  }
  if (rollup.doneCount > 0) parts.push(`${rollup.doneCount} completed`);
  if (rollup.terminalFailureCount > 0) {
    parts.push(
      `${rollup.terminalFailureCount} terminal ${rollup.terminalFailureCount === 1 ? "failure" : "failures"}`,
    );
  }
  return `Nested: ${parts.join(" · ")}`;
}
