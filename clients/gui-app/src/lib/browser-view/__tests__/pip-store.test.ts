import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerVisibleBrowserTile,
  resetVisibleBrowserTileRegistryForTests,
} from "../visible-tile-registry";
import {
  applyPipBurstEnded,
  applyPipBurstStarted,
  applyPipCaption,
  applyPipHostLifecycle,
  applyPipStreamHealth,
  dismissPip,
  dismissPipChip,
  getPipDismissalsForTests,
  getPipSnapshot,
  PIP_LINGER_MS,
  PIP_SWITCH_DWELL_MS,
  recallPip,
  reexpandPip,
  resetPipStoreForTests,
  setPipActiveHostId,
  setPipNowForTests,
} from "../pip-store";

const EPIC = "epic-1";

function startBurst(input: {
  readonly burstId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly startedAt: number;
  readonly hostId: string | undefined;
  readonly chatId: string | undefined;
}): void {
  applyPipBurstStarted({
    epicId: EPIC,
    hostId: input.hostId ?? "host-a",
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    chatId: input.chatId ?? "chat-1",
    startedAt: input.startedAt,
  });
}

function endBurst(
  burstId: string,
  outcome: "finished" | "closed" | "crashed" | "suspended",
  endedAt: number,
): void {
  applyPipBurstEnded({
    epicId: EPIC,
    burstId,
    outcome,
    endedAt,
  });
}

describe("pip-store lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPipStoreForTests();
    resetVisibleBrowserTileRegistryForTests();
    setPipNowForTests(() => Date.now());
    setPipActiveHostId("host-a");
  });

  afterEach(() => {
    resetPipStoreForTests();
    resetVisibleBrowserTileRegistryForTests();
    vi.useRealTimers();
  });

  it("hidden -> live when a burst starts and the tile is not on screen", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    const snap = getPipSnapshot(EPIC);
    expect(snap.phase).toBe("live");
    expect(snap.target?.burstId).toBe("b1");
    expect(snap.openTileEnabled).toBe(true);
  });

  it("live -> hidden when the target tile becomes visible, then live again when it hides", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    const release = registerVisibleBrowserTile({
      hostId: "host-a",
      sessionId: "s1",
      tabId: "t1",
    });
    expect(getPipSnapshot(EPIC).phase).toBe("hidden");
    release();
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
  });

  it("live -> finished -> chip after linger, and same-burst resume returns to live", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "finished", 10);
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).outcome).toBe("finished");
    expect(getPipSnapshot(EPIC).lingerActive).toBe(true);

    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 20,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).phase).toBe("live");

    endBurst("b1", "finished", 30);
    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("chip");
  });

  it("maps closed outcome to disabled open-tile and keeps distinct terminal outcomes", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "closed", 2);
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).outcome).toBe("closed");
    expect(getPipSnapshot(EPIC).openTileEnabled).toBe(false);
  });

  it("dismisses the displayed burst and only returns on the next newer burst or recall", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    dismissPip(EPIC);
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
    expect(getPipDismissalsForTests(EPIC).has("b1")).toBe(true);

    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 0,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");

    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: Date.now() + 1,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b3");
  });

  it("recall overrides dismissal and pins until that burst ends", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    dismissPip(EPIC);
    recallPip({ epicId: EPIC, sessionId: "s1", tabId: "t1" });
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).pinned).toBe(true);

    vi.advanceTimersByTime(PIP_SWITCH_DWELL_MS + 1);
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: Date.now() + 10,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");

    endBurst("b1", "finished", Date.now() + 20);
    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
    expect(getPipSnapshot(EPIC).pinned).toBe(false);
  });

  it("switches to the most recent live burst after the dwell floor", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    vi.advanceTimersByTime(PIP_SWITCH_DWELL_MS);
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
  });

  it("breaks start-time ties toward the active host", () => {
    startBurst({
      burstId: "b-remote",
      sessionId: "s-r",
      tabId: "t-r",
      startedAt: 5,
      hostId: "host-b",
      chatId: undefined,
    });
    startBurst({
      burstId: "b-local",
      sessionId: "s-l",
      tabId: "t-l",
      startedAt: 5,
      hostId: "host-a",
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b-local");
  });

  it("re-expands a chip to finished without a live pulse", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "finished", 2);
    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("chip");
    reexpandPip(EPIC);
    const snap = getPipSnapshot(EPIC);
    expect(snap.phase).toBe("finished");
    expect(snap.lingerActive).toBe(false);
    expect(snap.outcome).toBe("finished");
  });

  it("dismissing the chip hides it", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "finished", 2);
    vi.advanceTimersByTime(PIP_LINGER_MS);
    dismissPipChip(EPIC);
    expect(getPipSnapshot(EPIC).phase).toBe("hidden");
  });

  it("keeps last-frame health as disconnected/stale without leaving live", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    applyPipHostLifecycle(EPIC, "host-a", "reconnecting");
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).streamHealth).toBe("disconnected");
    applyPipHostLifecycle(EPIC, "host-a", "live");
    applyPipStreamHealth(EPIC, "stale");
    expect(getPipSnapshot(EPIC).streamHealth).toBe("stale");
  });

  it("after linger with another live burst, switches to that burst", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    vi.advanceTimersByTime(PIP_SWITCH_DWELL_MS);
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: Date.now(),
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
    endBurst("b2", "finished", Date.now());
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
  });

  it("after linger, leaves a finished target for a newer live burst", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "finished", 2);
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: Date.now(),
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(1);
    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
  });

  it("does not let a recalled finished target block a newer live burst", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "finished", 2);
    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("chip");
    reexpandPip(EPIC);
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).pinned).toBe(false);
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: Date.now(),
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
  });

  it("lets arriving frames override stale sessions lifecycle state", () => {
    applyPipHostLifecycle(EPIC, "host-a", "connecting");
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).streamHealth).toBe("live");
    applyPipStreamHealth(EPIC, "stale");
    expect(getPipSnapshot(EPIC).streamHealth).toBe("stale");
    applyPipStreamHealth(EPIC, "live");
    expect(getPipSnapshot(EPIC).streamHealth).toBe("live");
    applyPipHostLifecycle(EPIC, "host-a", "closed");
    expect(getPipSnapshot(EPIC).streamHealth).toBe("disconnected");
    applyPipStreamHealth(EPIC, "live");
    expect(getPipSnapshot(EPIC).streamHealth).toBe("live");
  });

  it("latches the displayed target during dwell so click-through stays on the old burst", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: undefined,
      chatId: undefined,
    });
    const latched = getPipSnapshot(EPIC).target;
    expect(latched?.burstId).toBe("b1");
    expect(latched?.tabId).toBe("t1");
    vi.advanceTimersByTime(PIP_SWITCH_DWELL_MS - 1);
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    expect(getPipSnapshot(EPIC).target?.sessionId).toBe("s1");
    vi.advanceTimersByTime(1);
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
  });

  it("does not reset dismissal when the same burst resumes during linger", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "finished", 10);
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).lingerActive).toBe(true);

    dismissPip(EPIC);
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
    expect(getPipDismissalsForTests(EPIC).has("b1")).toBe(true);

    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 20,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    expect(getPipDismissalsForTests(EPIC).has("b1")).toBe(true);
  });

  it("keeps open-tile enabled for crashed and suspended; only closed disables it", () => {
    startBurst({
      burstId: "b-crash",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b-crash", "crashed", 2);
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).outcome).toBe("crashed");
    expect(getPipSnapshot(EPIC).openTileEnabled).toBe(true);

    resetPipStoreForTests();
    setPipNowForTests(() => Date.now());
    setPipActiveHostId("host-a");
    startBurst({
      burstId: "b-suspend",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b-suspend", "suspended", 2);
    expect(getPipSnapshot(EPIC).outcome).toBe("suspended");
    expect(getPipSnapshot(EPIC).openTileEnabled).toBe(true);

    resetPipStoreForTests();
    setPipNowForTests(() => Date.now());
    setPipActiveHostId("host-a");
    startBurst({
      burstId: "b-closed",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b-closed", "closed", 2);
    expect(getPipSnapshot(EPIC).outcome).toBe("closed");
    expect(getPipSnapshot(EPIC).openTileEnabled).toBe(false);
  });

  it("counts other live bursts in moreLiveCount for the badge", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: undefined,
      chatId: undefined,
    });
    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 3,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(2);

    vi.advanceTimersByTime(PIP_SWITCH_DWELL_MS);
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b3");
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(2);

    endBurst("b3", "finished", Date.now());
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(2);
  });

  it("keeps dismissals across hide/show without a relaunch reset of in-memory state", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    dismissPip(EPIC);
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
    expect(getPipDismissalsForTests(EPIC).has("b1")).toBe(true);

    applyPipHostLifecycle(EPIC, "host-a", "live");
    vi.advanceTimersByTime(5_000);
    expect(getPipSnapshot(EPIC).phase).toBe("dismissed-burst");
    expect(getPipDismissalsForTests(EPIC).has("b1")).toBe(true);

    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: Date.now() + 1,
      hostId: undefined,
      chatId: undefined,
    });
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
    expect(getPipDismissalsForTests(EPIC).has("b1")).toBe(true);
  });
});

describe("pip-store captions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPipStoreForTests();
    resetVisibleBrowserTileRegistryForTests();
    setPipNowForTests(() => Date.now());
    setPipActiveHostId("host-a");
  });

  afterEach(() => {
    resetPipStoreForTests();
    resetVisibleBrowserTileRegistryForTests();
    vi.useRealTimers();
  });

  it("exposes the displayed live tab caption in the snapshot", () => {
    setPipNowForTests(() => 1_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });

    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).caption).toEqual({
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
      arrivedAt: 1_000,
    });
  });

  it("does not replace the displayed caption with another tab's caption", () => {
    setPipNowForTests(() => 1_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s2",
      tabId: "t2",
      burstId: "b2",
      cellTitle: "Other tab cell",
    });

    expect(getPipSnapshot(EPIC).target?.tabId).toBe("t1");
    expect(getPipSnapshot(EPIC).caption).toEqual({
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
      arrivedAt: 1_000,
    });
  });

  it("clears the snapshot caption when the burst ends", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    expect(getPipSnapshot(EPIC).caption?.cellTitle).toBe(
      "Filling checkout form",
    );

    endBurst("b1", "finished", 10);
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).caption).toBeNull();
  });

  it("replaces the displayed caption when a new one arrives on the same tab", () => {
    setPipNowForTests(() => 1_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    expect(getPipSnapshot(EPIC).caption?.arrivedAt).toBe(1_000);

    setPipNowForTests(() => 2_000);
    applyPipCaption({
      epicId: EPIC,
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Submitting payment",
    });

    expect(getPipSnapshot(EPIC).caption).toEqual({
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Submitting payment",
      arrivedAt: 2_000,
    });
  });
});
