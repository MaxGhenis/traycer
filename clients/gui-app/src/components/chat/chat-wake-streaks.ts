import type {
  ChatMessage as ChatMessageModel,
  MessageSegment,
} from "@/stores/composer/chat-store";

/**
 * Cross-turn folding model for monitor/shell wake turns ("wake streaks").
 *
 * A monitoring loop produces many consecutive autonomous turns whose whole
 * content is the wake divider plus a sentence of acknowledgment. Rendering
 * each at full size drowns the conversation, so consecutive ACKNOWLEDGMENT
 * turns fold behind one collapsible header. Everything here is a pure
 * function of the rendered row array - the renderer (`ChatTimeline`) and the
 * find projection (`buildChatFindRows`) both derive the layout from the same
 * rows, so the two can never disagree about what is folded.
 *
 * Folding is VISUAL only: member rows stay in the row array (and therefore in
 * every id->index resolver, the announcement deriver, and the find
 * projection), they just render collapsed. Removing rows would silently break
 * navigation, scroll restoration, and a11y announcements - see the timeline's
 * maintainVisibleContentPosition notes.
 */

/**
 * The segment kinds an acknowledgment turn may contain. Anything else - a
 * tool call, command, edit, subagent, approval, question - is real work, and
 * a turn that did work renders fully and breaks the streak. Reasoning is
 * allowed: thinking about a heartbeat is not acting on it, and the reasoning
 * group renders normally when the fold is expanded.
 */
const WAKE_ACKNOWLEDGMENT_SEGMENT_KINDS: ReadonlySet<MessageSegment["kind"]> =
  new Set(["autonomous_resume", "text", "reasoning"]);

/**
 * True for a segment list that is a wake acknowledgment: at least one wake
 * divider, and nothing beyond dividers, text, and reasoning. Shared with the
 * assistant body, which uses it to drop the elapsed footer on these turns -
 * the footer's "worked for" framing describes work, and these turns did none.
 */
export function isWakeAcknowledgmentSegments(
  segments: ReadonlyArray<MessageSegment>,
): boolean {
  let hasResume = false;
  for (const segment of segments) {
    if (!WAKE_ACKNOWLEDGMENT_SEGMENT_KINDS.has(segment.kind)) return false;
    if (segment.kind === "autonomous_resume") hasResume = true;
  }
  return hasResume;
}

/**
 * One distinct wake source folded into a streak, in first-appearance order.
 * The title is the monitor/shell/schedule's own name - the header names the
 * first few and tucks the rest behind a tooltip.
 */
export interface WakeStreakSource {
  readonly title: string;
  readonly updateCount: number;
}

export interface WakeStreakModel {
  /** Collapse identity: `wake-streak:` + the first folded row's id. */
  readonly id: string;
  /** Rows folded behind the header, in timeline order. */
  readonly memberRowIds: ReadonlyArray<string>;
  /**
   * The streak is still the chat's live tail: its newest acknowledgment is
   * the current status and stays visible OUTSIDE the fold (it is not a
   * member). A closed streak - one a work turn or user message ended - folds
   * completely: the work supersedes the last acknowledgment as current
   * status, so nothing stays out.
   */
  readonly liveTail: boolean;
  readonly sources: ReadonlyArray<WakeStreakSource>;
  /** Wall-clock span of the folded members, for the header's time range. */
  readonly startedAt: number;
  readonly endedAt: number;
}

export interface WakeStreakMembership {
  readonly streak: WakeStreakModel;
  /**
   * The first folded member renders the streak header above its (folded)
   * content; every other member renders header-less. Rendering the header
   * inside the first member's row keeps the row array untouched - no
   * synthetic row, no key-sequence change when a streak forms or grows.
   */
  readonly rendersHeader: boolean;
}

export interface WakeStreakLayout {
  readonly membershipByRowId: ReadonlyMap<string, WakeStreakMembership>;
  readonly streaks: ReadonlyArray<WakeStreakModel>;
}

export const EMPTY_WAKE_STREAK_LAYOUT: WakeStreakLayout = {
  membershipByRowId: new Map(),
  streaks: [],
};

export function deriveWakeStreakRenderId(firstMemberRowId: string): string {
  return `wake-streak:${firstMemberRowId}`;
}

/**
 * A settled acknowledgment turn row - the foldable unit. `stopped` rows stay
 * out because a user Stop is a user action, and `completedAt` guards against
 * half-rendered turns that never reached completion stamping.
 */
function isSettledWakeAcknowledgmentRow(row: ChatMessageModel): boolean {
  return (
    row.role === "assistant" &&
    row.runState === null &&
    row.stopped === null &&
    row.completedAt !== null &&
    isWakeAcknowledgmentSegments(row.segments)
  );
}

/**
 * The still-streaming turn a wake just started. While it runs, the streak it
 * follows stays live-tail (the previous acknowledgment remains the current
 * status until this turn settles and either joins the streak or breaks it).
 */
function isLiveWakeRow(row: ChatMessageModel): boolean {
  return (
    row.role === "assistant" &&
    row.runState !== null &&
    row.segments.some((segment) => segment.kind === "autonomous_resume")
  );
}

/**
 * Computes the fold layout for a row array. `previous` enables structural
 * sharing: unchanged streaks and memberships keep their object identities, so
 * per-row subscribers (which compare snapshots by identity) re-render only
 * when THEIR streak actually changed. The row array is rebuilt on every
 * streaming token; without sharing, every mounted member row would re-render
 * on each one.
 */
export function computeWakeStreakLayout(
  rows: ReadonlyArray<ChatMessageModel>,
  previous: WakeStreakLayout,
): WakeStreakLayout {
  const streaks: WakeStreakModel[] = [];

  let runStart = -1;
  const flushRun = (end: number): void => {
    if (runStart === -1) return;
    const start = runStart;
    runStart = -1;
    // Live-tail iff nothing follows the run except the turn a wake is still
    // streaming (in practice zero or one row - defensive over any shape).
    const liveTail = rows.slice(end).every(isLiveWakeRow);
    const memberRows = liveTail
      ? rows.slice(start, end - 1)
      : rows.slice(start, end);
    if (memberRows.length === 0) return;
    // A closed run of one keeps its plain row + reply pair: a header
    // replacing a single entry saves nothing and hides content.
    if (!liveTail && memberRows.length < 2) return;
    const streak = buildStreak(memberRows, liveTail);
    streaks.push(reuseStreakIfEqual(streak, previous) ?? streak);
  };

  for (let i = 0; i < rows.length; i += 1) {
    if (isSettledWakeAcknowledgmentRow(rows[i])) {
      if (runStart === -1) runStart = i;
      continue;
    }
    flushRun(i);
  }
  flushRun(rows.length);

  if (
    streaks.length === previous.streaks.length &&
    streaks.every((streak, index) => streak === previous.streaks[index])
  ) {
    return previous;
  }

  const membershipByRowId = new Map<string, WakeStreakMembership>();
  for (const streak of streaks) {
    streak.memberRowIds.forEach((rowId, index) => {
      membershipByRowId.set(rowId, {
        streak,
        rendersHeader: index === 0,
      });
    });
  }
  return { membershipByRowId, streaks };
}

function buildStreak(
  memberRows: ReadonlyArray<ChatMessageModel>,
  liveTail: boolean,
): WakeStreakModel {
  const last = memberRows[memberRows.length - 1];
  return {
    id: deriveWakeStreakRenderId(memberRows[0].id),
    memberRowIds: memberRows.map((row) => row.id),
    liveTail,
    sources: collectSources(memberRows),
    startedAt: memberRows[0].createdAt,
    endedAt: last.completedAt ?? last.createdAt,
  };
}

function collectSources(
  memberRows: ReadonlyArray<ChatMessageModel>,
): ReadonlyArray<WakeStreakSource> {
  const countsByTitle = new Map<string, number>();
  for (const row of memberRows) {
    for (const segment of row.segments) {
      if (segment.kind !== "autonomous_resume") continue;
      for (const trigger of segment.triggers) {
        const title =
          trigger.mcp === null
            ? trigger.title
            : `${trigger.mcp.serverName} · ${trigger.mcp.toolName}`;
        countsByTitle.set(title, (countsByTitle.get(title) ?? 0) + 1);
      }
    }
  }
  return Array.from(countsByTitle, ([title, updateCount]) => ({
    title,
    updateCount,
  }));
}

/** The previous streak object when it is content-identical, else null. */
function reuseStreakIfEqual(
  streak: WakeStreakModel,
  previous: WakeStreakLayout,
): WakeStreakModel | null {
  const prior = previous.streaks.find(
    (candidate) => candidate.id === streak.id,
  );
  if (prior === undefined) return null;
  if (
    prior.liveTail !== streak.liveTail ||
    prior.startedAt !== streak.startedAt ||
    prior.endedAt !== streak.endedAt ||
    !arraysEqual(prior.memberRowIds, streak.memberRowIds) ||
    !sourcesEqual(prior.sources, streak.sources)
  ) {
    return null;
  }
  return prior;
}

function arraysEqual(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sourcesEqual(
  a: ReadonlyArray<WakeStreakSource>,
  b: ReadonlyArray<WakeStreakSource>,
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (source, index) =>
        source.title === b[index].title &&
        source.updateCount === b[index].updateCount,
    )
  );
}
