import { describe, expect, it } from "vitest";
import type { AutonomousResumeTrigger } from "@traycer/protocol/persistence/epic/content-blocks";
import type {
  ChatMessage as ChatMessageModel,
  MessageSegment,
} from "@/stores/composer/chat-store";
import {
  computeWakeStreakLayout,
  deriveWakeStreakRenderId,
  EMPTY_WAKE_STREAK_LAYOUT,
  isWakeAcknowledgmentSegments,
} from "@/components/chat/chat-wake-streaks";

function trigger(
  overrides: Partial<AutonomousResumeTrigger> &
    Pick<AutonomousResumeTrigger, "title">,
): AutonomousResumeTrigger {
  return {
    kind: "monitor",
    status: "completed",
    live: false,
    summary: "",
    blockId: `${overrides.title}-block`,
    outputFile: null,
    mcp: null,
    managedCommand: null,
    ...overrides,
  };
}

function resumeSegment(
  id: string,
  triggers: ReadonlyArray<AutonomousResumeTrigger>,
): MessageSegment {
  return { id, kind: "autonomous_resume", triggers };
}

const TEXT_SEGMENT: MessageSegment = {
  id: "text-1",
  kind: "text",
  markdown: "Noted.",
  isStreaming: false,
};

const REASONING_SEGMENT: MessageSegment = {
  id: "reasoning-1",
  kind: "reasoning",
  markdown: "Thinking about the heartbeat.",
  isStreaming: false,
  durationMs: 400,
};

const COMMAND_SEGMENT: MessageSegment = {
  id: "cmd-1",
  kind: "command",
  command: "echo hi",
  cwd: null,
  exitCode: 0,
  isStreaming: false,
  endState: null,
  progress: null,
  startedAt: 0,
  backgroundTask: null,
  stopped: false,
  parentId: null,
};

/** A base row with every ChatMessage field a real store row carries, minus the
 *  ones each fixture below overrides. */
function baseRow(
  id: string,
  role: ChatMessageModel["role"],
  createdAt: number,
): ChatMessageModel {
  return {
    id,
    role,
    content: "",
    segments: [],
    structuredContent: null,
    attachments: [],
    settings: null,
    createdAt,
    completedAt: null,
    stopped: null,
    persistentMessageId: null,
    senderLabel: null,
    assistantMeta: null,
    statusLabel: null,
    agentSenderInfo: null,
    agentMessage: null,
    runState: null,
    sessionAnchor: null,
    steerBadge: null,
  };
}

/** A settled wake acknowledgment row - the foldable unit. */
function ackRow(
  id: string,
  createdAt: number,
  completedAt: number,
  triggers: ReadonlyArray<AutonomousResumeTrigger>,
): ChatMessageModel {
  return {
    ...baseRow(id, "assistant", createdAt),
    completedAt,
    segments: [resumeSegment(`${id}-resume`, triggers)],
  };
}

/** The still-streaming turn a wake just started - `runState` non-null, not yet
 *  settled, so it never joins a run as a member. */
function liveWakeRow(
  id: string,
  createdAt: number,
  triggers: ReadonlyArray<AutonomousResumeTrigger>,
): ChatMessageModel {
  return {
    ...baseRow(id, "assistant", createdAt),
    runState: "running",
    segments: [resumeSegment(`${id}-resume`, triggers)],
  };
}

/** A real work turn - breaks a run, never a member itself. */
function workRow(
  id: string,
  createdAt: number,
  completedAt: number,
): ChatMessageModel {
  return {
    ...baseRow(id, "assistant", createdAt),
    completedAt,
    segments: [COMMAND_SEGMENT],
  };
}

function userRow(id: string, createdAt: number): ChatMessageModel {
  return { ...baseRow(id, "user", createdAt), content: "hi" };
}

describe("isWakeAcknowledgmentSegments", () => {
  it("is false for an empty segment list (no resume divider present)", () => {
    expect(isWakeAcknowledgmentSegments([])).toBe(false);
  });

  it("is false when there is content but no autonomous_resume segment", () => {
    expect(isWakeAcknowledgmentSegments([TEXT_SEGMENT])).toBe(false);
  });

  it("is true for a lone autonomous_resume segment", () => {
    expect(
      isWakeAcknowledgmentSegments([
        resumeSegment("r", [trigger({ title: "build watch" })]),
      ]),
    ).toBe(true);
  });

  it("is true for a resume divider alongside text and reasoning", () => {
    expect(
      isWakeAcknowledgmentSegments([
        resumeSegment("r", [trigger({ title: "build watch" })]),
        TEXT_SEGMENT,
        REASONING_SEGMENT,
      ]),
    ).toBe(true);
  });

  it("is false once any other segment kind (real work) is present", () => {
    expect(
      isWakeAcknowledgmentSegments([
        resumeSegment("r", [trigger({ title: "build watch" })]),
        COMMAND_SEGMENT,
      ]),
    ).toBe(false);
  });
});

describe("computeWakeStreakLayout - run detection and fold length", () => {
  it("returns the empty layout for rows with no acknowledgment run", () => {
    const rows = [userRow("u0", 0), workRow("w0", 1, 2)];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(0);
    expect(layout.membershipByRowId.size).toBe(0);
  });

  it("does not fold a closed run of exactly one row (a plain row + reply pair)", () => {
    const rows = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      workRow("w0", 2, 3),
    ];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(0);
    expect(layout.membershipByRowId.size).toBe(0);
  });

  it("folds a closed run of two or more once a work turn ends it", () => {
    const rows = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" })]),
      ackRow("a2", 4, 5, [trigger({ title: "build watch" })]),
      workRow("w0", 6, 7),
    ];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(1);
    const streak = layout.streaks[0];
    expect(streak.liveTail).toBe(false);
    expect(streak.memberRowIds).toEqual(["a0", "a1", "a2"]);
    expect(streak.id).toBe(deriveWakeStreakRenderId("a0"));
    expect(streak.startedAt).toBe(0);
    expect(streak.endedAt).toBe(5);
  });

  it("does not fold an open (liveTail) run of one - nothing to save by folding a single row", () => {
    // The run is the very tail of the array: nothing follows it, so it is
    // liveTail by construction, and liveTail folding excludes the run's own
    // last row - leaving zero members for a run of one.
    const rows = [ackRow("a0", 0, 1, [trigger({ title: "build watch" })])];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(0);
    expect(layout.membershipByRowId.size).toBe(0);
  });

  it("marks a run at the very end of the transcript as liveTail and folds all but its last row", () => {
    const rows = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" })]),
      ackRow("a2", 4, 5, [trigger({ title: "build watch" })]),
    ];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(1);
    const streak = layout.streaks[0];
    expect(streak.liveTail).toBe(true);
    // The newest acknowledgment (a2) stays outside the fold as current status.
    expect(streak.memberRowIds).toEqual(["a0", "a1"]);
    expect(layout.membershipByRowId.has("a2")).toBe(false);
  });

  it("keeps a run open when it is followed by exactly the still-streaming wake turn", () => {
    const rows = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" })]),
      ackRow("a2", 4, 5, [trigger({ title: "build watch" })]),
      liveWakeRow("live0", 6, [trigger({ title: "build watch" })]),
    ];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(1);
    const streak = layout.streaks[0];
    expect(streak.liveTail).toBe(true);
    expect(streak.memberRowIds).toEqual(["a0", "a1"]);
    // Neither the run's own last row nor the live streaming row are members -
    // both stay visible outside the fold.
    expect(layout.membershipByRowId.has("a2")).toBe(false);
    expect(layout.membershipByRowId.has("live0")).toBe(false);
  });

  it("closes a run when a user message (not just a work turn) follows it", () => {
    const rows = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" })]),
      userRow("u0", 4),
    ];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(1);
    expect(layout.streaks[0].liveTail).toBe(false);
    expect(layout.streaks[0].memberRowIds).toEqual(["a0", "a1"]);
  });
});

describe("computeWakeStreakLayout - source aggregation", () => {
  it("aggregates per-title update counts across interleaved triggers, including mcp naming", () => {
    const mcpTrigger = trigger({
      title: "unused-title",
      kind: "command",
      mcp: { serverName: "probe", toolName: "slow_op" },
    });
    const rows = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" }), mcpTrigger]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" }), mcpTrigger]),
      workRow("w0", 4, 5),
    ];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    expect(layout.streaks).toHaveLength(1);
    // First-appearance order: "build watch" fires before the mcp trigger on a0.
    expect(layout.streaks[0].sources).toEqual([
      { title: "build watch", updateCount: 2 },
      { title: "probe · slow_op", updateCount: 2 },
    ]);
  });
});

describe("computeWakeStreakLayout - membership map", () => {
  it("renders the header on the first member only; other members and non-members are addressed correctly", () => {
    const rows = [
      userRow("u0", -1),
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" })]),
      workRow("w0", 4, 5),
    ];
    const layout = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    const streak = layout.streaks[0];

    expect(layout.membershipByRowId.get("a0")).toEqual({
      streak,
      rendersHeader: true,
    });
    expect(layout.membershipByRowId.get("a1")).toEqual({
      streak,
      rendersHeader: false,
    });
    expect(layout.membershipByRowId.has("u0")).toBe(false);
    expect(layout.membershipByRowId.has("w0")).toBe(false);
  });
});

describe("computeWakeStreakLayout - structural sharing", () => {
  it("returns the exact same layout object when nothing changed", () => {
    const rows = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" })]),
      workRow("w0", 4, 5),
    ];
    const first = computeWakeStreakLayout(rows, EMPTY_WAKE_STREAK_LAYOUT);
    const second = computeWakeStreakLayout(rows, first);
    expect(second).toBe(first);
  });

  it("reuses an untouched streak's object identity even when a later streak's shape changes and the top-level layout is rebuilt", () => {
    const rowsV1 = [
      ackRow("a0", 0, 1, [trigger({ title: "build watch" })]),
      ackRow("a1", 2, 3, [trigger({ title: "build watch" })]),
      workRow("w0", 4, 5),
      // A second, still-open run - liveTail, sitting at the tail of the array.
      ackRow("b0", 6, 7, [trigger({ title: "deploy watch" })]),
      ackRow("b1", 8, 9, [trigger({ title: "deploy watch" })]),
    ];
    const first = computeWakeStreakLayout(rowsV1, EMPTY_WAKE_STREAK_LAYOUT);
    expect(first.streaks).toHaveLength(2);
    const [closedStreak] = first.streaks;

    // Extend the open run with one more acknowledgment - its member rows and
    // endedAt change, so its streak object must be rebuilt; the closed run
    // earlier in the transcript is completely untouched.
    const rowsV2 = [
      ...rowsV1,
      ackRow("b2", 10, 11, [trigger({ title: "deploy watch" })]),
    ];
    const second = computeWakeStreakLayout(rowsV2, first);

    expect(second).not.toBe(first);
    expect(second.streaks[0]).toBe(closedStreak);
    expect(second.streaks[1]).not.toBe(first.streaks[1]);
    expect(second.streaks[1].memberRowIds).toEqual(["b0", "b1"]);
  });
});
