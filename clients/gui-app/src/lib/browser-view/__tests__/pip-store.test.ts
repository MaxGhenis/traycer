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
  dismissPipRowSet,
  dismissPip,
  dismissPipChip,
  getPipDismissalsForTests,
  getPipSnapshot,
  PIP_CAPTION_FADE_MS,
  PIP_CAPTION_HOLD_MS,
  PIP_LINGER_MS,
  PIP_SWITCH_DWELL_MS,
  recallPip,
  reexpandPip,
  resetPipStoreForTests,
  selectPipRow,
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
    recallPip({
      epicId: EPIC,
      hostId: "host-a",
      sessionId: "s1",
      tabId: "t1",
    });
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

  it("promotes a new burst immediately during terminal linger", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: undefined,
      chatId: undefined,
    });
    endBurst("b1", "finished", Date.now());
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
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
    expect(getPipSnapshot(EPIC).rows.map((row) => row.target.burstId)).toEqual([
      "b1",
    ]);
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

describe("pip-store multi-session stack", () => {
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

  it("orders live rows by GUI arrival and keeps their full identity stable", () => {
    vi.setSystemTime(1_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 300,
      hostId: "host-a",
      chatId: "chat-a",
    });
    vi.setSystemTime(1_001);
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 100,
      hostId: "host-b",
      chatId: "chat-b",
    });
    vi.setSystemTime(1_002);
    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 200,
      hostId: "host-a",
      chatId: "chat-c",
    });

    const first = getPipSnapshot(EPIC);
    expect(first.target?.burstId).toBe("b1");
    expect(first.rows.map((row) => row.target.burstId)).toEqual(["b2", "b3"]);
    expect(
      first.rows.map((row) => [
        row.target.hostId,
        row.target.sessionId,
        row.target.tabId,
        row.target.burstId,
        row.kind,
        row.chatId,
      ]),
    ).toEqual([
      ["host-b", "s2", "t2", "b2", "live", "chat-b"],
      ["host-a", "s3", "t3", "b3", "live", "chat-c"],
    ]);

    expect(getPipSnapshot(EPIC).rows).toEqual(first.rows);

    vi.setSystemTime(1_003);
    startBurst({
      burstId: "b4",
      sessionId: "s4",
      tabId: "t4",
      startedAt: 50,
      hostId: "host-b",
      chatId: "chat-d",
    });
    expect(getPipSnapshot(EPIC).rows.map((row) => row.target.burstId)).toEqual([
      "b2",
      "b3",
      "b4",
    ]);
  });

  it("preserves arrival order and streamed history when a burst is replayed", () => {
    vi.setSystemTime(2_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    vi.setSystemTime(2_001);
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    vi.setSystemTime(2_002);
    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 3,
      hostId: "host-a",
      chatId: "chat-c",
    });
    const originalArrival = getPipSnapshot(EPIC).rows[0]?.arrivedAt;

    endBurst("b2", "finished", 2_003);
    vi.setSystemTime(2_004);
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 4,
      hostId: "host-b",
      chatId: "chat-b",
    });
    expect(getPipSnapshot(EPIC).rows.map((row) => row.target.burstId)).toEqual([
      "b2",
      "b3",
    ]);
    expect(getPipSnapshot(EPIC).rows[0]?.arrivedAt).toBe(originalArrival);

    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 5,
      hostId: "host-a",
      chatId: "chat-a",
    });
    endBurst("b2", "finished", 2_005);
    endBurst("b3", "finished", 2_005);
    endBurst("b1", "finished", 2_005);
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    expect(getPipSnapshot(EPIC).targetEverStreamed).toBe(true);
  });

  it("keeps a finished background row until its own linger deadline", () => {
    vi.setSystemTime(10_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    vi.setSystemTime(10_100);
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    endBurst("b2", "crashed", 10_100);

    const row = getPipSnapshot(EPIC).rows.find(
      (candidate) => candidate.target.burstId === "b2",
    );
    if (row === undefined) throw new Error("expected b2 lingering row");
    expect(row.kind).toBe("lingering");
    expect(row.outcome).toBe("crashed");
    expect(row.expiresAt).toBe(15_100);
    expect(row.chatId).toBe("chat-b");

    vi.setSystemTime(15_099);
    expect(
      getPipSnapshot(EPIC).rows.some(
        (candidate) => candidate.target.burstId === "b2",
      ),
    ).toBe(true);
    vi.setSystemTime(15_100);
    expect(
      getPipSnapshot(EPIC).rows.some(
        (candidate) => candidate.target.burstId === "b2",
      ),
    ).toBe(false);
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
  });

  it("selects a live row immediately and pins it until it ends", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    const row = getPipSnapshot(EPIC).rows.find(
      (candidate) => candidate.target.burstId === "b2",
    );
    if (row === undefined) throw new Error("expected b2 live row");

    selectPipRow(row.target);

    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-b");
    expect(getPipSnapshot(EPIC).pinned).toBe(true);
  });

  it("promotes the next eligible burst when the displayed tile opens", () => {
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");

    const release = registerVisibleBrowserTile({
      hostId: "host-a",
      sessionId: "s1",
      tabId: "t1",
    });

    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
    expect(getPipSnapshot(EPIC).rows).toEqual([]);

    release();

    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b2");
    expect(getPipSnapshot(EPIC).rows.map((row) => row.target.burstId)).toEqual([
      "b1",
    ]);
  });

  it("dismisses the current row set atomically while a late burst re-presents", () => {
    vi.setSystemTime(20_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });

    dismissPipRowSet(["b1", "b2"]);

    expect(getPipSnapshot(EPIC).phase).toBe("hidden");
    expect(getPipDismissalsForTests(EPIC)).toEqual(new Set(["b1", "b2"]));

    vi.setSystemTime(20_001);
    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-c",
    });
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b3");
  });

  it("uses the displayed burst as terminal owner when it is the last live burst", () => {
    vi.setSystemTime(30_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    vi.setSystemTime(30_100);
    endBurst("b2", "finished", 30_100);
    vi.setSystemTime(30_200);
    endBurst("b1", "finished", 30_200);

    const snapshot = getPipSnapshot(EPIC);
    expect(snapshot.phase).toBe("finished");
    expect(snapshot.target?.burstId).toBe("b1");
    expect(snapshot.outcome).toBe("finished");
    expect(snapshot.targetEverStreamed).toBe(true);
    expect(snapshot.lingerActive).toBe(true);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]?.target.burstId).toBe("b2");

    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("chip");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    expect(getPipSnapshot(EPIC).targetEverStreamed).toBe(true);
  });

  it("uses the last live row as terminal owner after the displayed burst ends first", () => {
    vi.setSystemTime(31_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 3,
      hostId: "host-a",
      chatId: "chat-c",
    });
    vi.setSystemTime(31_100);
    endBurst("b1", "finished", 31_100);
    vi.setSystemTime(31_200);
    endBurst("b2", "finished", 31_200);
    vi.setSystemTime(31_300);
    endBurst("b3", "crashed", 31_300);

    const snapshot = getPipSnapshot(EPIC);
    expect(snapshot.phase).toBe("finished");
    expect(snapshot.target?.burstId).toBe("b3");
    expect(snapshot.outcome).toBe("crashed");
    expect(snapshot.targetEverStreamed).toBe(false);
    expect(snapshot.lingerActive).toBe(true);
    expect(snapshot.rows.map((row) => row.target.burstId)).toEqual([
      "b1",
      "b2",
    ]);
    expect(snapshot.rows.every((row) => row.kind === "lingering")).toBe(true);

    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("chip");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b3");
    expect(getPipSnapshot(EPIC).targetEverStreamed).toBe(false);
    expect(getPipSnapshot(EPIC).rows).toEqual([]);
  });

  it("chooses the last applied end when all live bursts end together", () => {
    vi.setSystemTime(32_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    startBurst({
      burstId: "b3",
      sessionId: "s3",
      tabId: "t3",
      startedAt: 3,
      hostId: "host-a",
      chatId: "chat-c",
    });
    vi.setSystemTime(32_100);
    endBurst("b1", "finished", 32_100);
    endBurst("b2", "closed", 32_100);
    endBurst("b3", "suspended", 32_100);

    const snapshot = getPipSnapshot(EPIC);
    expect(snapshot.phase).toBe("finished");
    expect(snapshot.target?.burstId).toBe("b3");
    expect(snapshot.outcome).toBe("suspended");
    expect(snapshot.targetEverStreamed).toBe(false);
    expect(snapshot.rows.map((row) => row.target.burstId)).toEqual([
      "b1",
      "b2",
    ]);

    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("chip");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b3");
  });

  it("keeps six bursts ordered and gives the final live burst the chip", () => {
    vi.setSystemTime(33_000);
    for (let index = 1; index <= 6; index += 1) {
      startBurst({
        burstId: `b${index}`,
        sessionId: `s${index}`,
        tabId: `t${index}`,
        startedAt: index,
        hostId: index % 2 === 0 ? "host-b" : "host-a",
        chatId: `chat-${index}`,
      });
    }
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b1");
    expect(getPipSnapshot(EPIC).rows.map((row) => row.target.burstId)).toEqual([
      "b2",
      "b3",
      "b4",
      "b5",
      "b6",
    ]);

    endBurst("b1", "finished", 33_000);
    endBurst("b2", "finished", 33_000);
    endBurst("b3", "finished", 33_000);
    endBurst("b4", "finished", 33_000);
    endBurst("b5", "finished", 33_000);
    endBurst("b6", "finished", 33_000);

    const snapshot = getPipSnapshot(EPIC);
    expect(snapshot.target?.burstId).toBe("b6");
    expect(snapshot.targetEverStreamed).toBe(false);
    expect(snapshot.rows.map((row) => row.target.burstId)).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
    ]);
    expect(snapshot.rows.every((row) => row.kind === "lingering")).toBe(true);

    vi.advanceTimersByTime(PIP_LINGER_MS);
    expect(getPipSnapshot(EPIC).phase).toBe("chip");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("b6");
  });

  it("recalls the requested host when session and tab ids collide", () => {
    startBurst({
      burstId: "burst-a",
      sessionId: "same-session",
      tabId: "same-tab",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "burst-b",
      sessionId: "same-session",
      tabId: "same-tab",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });

    recallPip({
      epicId: EPIC,
      hostId: "host-b",
      sessionId: "same-session",
      tabId: "same-tab",
    });

    expect(getPipSnapshot(EPIC).target?.burstId).toBe("burst-b");
    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-b");
    expect(getPipSnapshot(EPIC).pinned).toBe(true);
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
      hostId: "host-a",
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
      hostId: "host-a",
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-a",
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
      hostId: "host-a",
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
      hostId: "host-a",
      sessionId: "s1",
      tabId: "t1",
      burstId: "b1",
      cellTitle: "Filling checkout form",
    });
    expect(getPipSnapshot(EPIC).caption?.arrivedAt).toBe(1_000);

    setPipNowForTests(() => 2_000);
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-a",
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

  it("keeps captions separate for equal session and tab ids on different hosts", () => {
    setPipNowForTests(() => 34_000);
    startBurst({
      burstId: "burst-a",
      sessionId: "same-session",
      tabId: "same-tab",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "burst-b",
      sessionId: "same-session",
      tabId: "same-tab",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-a",
      sessionId: "same-session",
      tabId: "same-tab",
      burstId: "burst-a",
      cellTitle: "Local activity",
    });
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-b",
      sessionId: "same-session",
      tabId: "same-tab",
      burstId: "burst-b",
      cellTitle: "Remote activity",
    });

    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-a");
    expect(getPipSnapshot(EPIC).caption?.cellTitle).toBe("Local activity");
    const remoteRow = getPipSnapshot(EPIC).rows.find(
      (row) => row.target.burstId === "burst-b",
    );
    if (remoteRow === undefined) throw new Error("expected remote row");
    expect(remoteRow.caption?.cellTitle).toBe("Remote activity");

    selectPipRow(remoteRow.target);
    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-b");
    expect(getPipSnapshot(EPIC).caption?.cellTitle).toBe("Remote activity");
  });

  it("exposes a row caption only inside its freshness window", () => {
    vi.setSystemTime(35_000);
    startBurst({
      burstId: "b1",
      sessionId: "s1",
      tabId: "t1",
      startedAt: 1,
      hostId: "host-a",
      chatId: "chat-a",
    });
    startBurst({
      burstId: "b2",
      sessionId: "s2",
      tabId: "t2",
      startedAt: 2,
      hostId: "host-b",
      chatId: "chat-b",
    });
    applyPipCaption({
      epicId: EPIC,
      hostId: "host-b",
      sessionId: "s2",
      tabId: "t2",
      burstId: "b2",
      cellTitle: "Fresh row activity",
    });

    const rowBeforeExpiry = getPipSnapshot(EPIC).rows.find(
      (row) => row.target.burstId === "b2",
    );
    if (rowBeforeExpiry === undefined) {
      throw new Error("expected b2 row before caption expiry");
    }
    expect(rowBeforeExpiry.caption?.cellTitle).toBe("Fresh row activity");

    vi.setSystemTime(35_000 + PIP_CAPTION_HOLD_MS + PIP_CAPTION_FADE_MS);
    const rowAfterExpiry = getPipSnapshot(EPIC).rows.find(
      (row) => row.target.burstId === "b2",
    );
    if (rowAfterExpiry === undefined) {
      throw new Error("expected b2 row after caption expiry");
    }
    expect(rowAfterExpiry.caption).toBeNull();
  });
});
