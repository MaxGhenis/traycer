import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BrowserSessionInfo,
  BrowserSessionsServerFrame,
  BrowserTabInfo,
} from "@traycer/protocol/host/browser/contracts";
import {
  PipEpicSessionsManager,
  getPipEpicSessionItems,
  resetPipEpicSessionsForTests,
  type PipEpicSessionsOpener,
  type PipEpicSessionsSubscriptionRequest,
} from "../pip-epic-sessions";
import {
  getPipSnapshot,
  resetPipStoreForTests,
  setPipActiveHostId,
  setPipNowForTests,
} from "../pip-store";

const EPIC = "epic-1";
const CHAT = "chat-a";

interface FakeSubscription {
  readonly request: PipEpicSessionsSubscriptionRequest;
  closed: boolean;
}

function createFakeOpener(): {
  readonly opener: PipEpicSessionsOpener;
  readonly opened: FakeSubscription[];
} {
  const opened: FakeSubscription[] = [];
  return {
    opened,
    opener: (request) => {
      const entry: FakeSubscription = {
        request,
        closed: false,
      };
      opened.push(entry);
      return {
        close: () => {
          entry.closed = true;
        },
      };
    },
  };
}

function tab(
  overrides: Partial<BrowserTabInfo> & Pick<BrowserTabInfo, "tabId" | "url">,
): BrowserTabInfo {
  return {
    originTier: "dev",
    status: "ready",
    title: null,
    viewed: false,
    drivenBy: [],
    ...overrides,
  };
}

function session(
  overrides: Partial<BrowserSessionInfo> &
    Pick<BrowserSessionInfo, "sessionId" | "name" | "hostId">,
): BrowserSessionInfo {
  return {
    epicId: EPIC,
    profile: "primary",
    createdBy: { chatId: CHAT, agentRunId: "run-1" },
    createdAt: 1,
    lastActivityAt: 2,
    tabs: [
      tab({
        tabId: overrides.sessionId,
        url: "https://app.example/",
        title: overrides.name,
      }),
    ],
    ...overrides,
  };
}

function snapshotFrame(
  sessions: readonly BrowserSessionInfo[],
): BrowserSessionsServerFrame {
  return {
    kind: "snapshot",
    hasBinaryPayload: false,
    sessions: [...sessions],
  };
}

function burstStartedFrame(input: {
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
}): BrowserSessionsServerFrame {
  return {
    kind: "burstStarted",
    hasBinaryPayload: false,
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    chatId: CHAT,
  };
}

function burstEndedFrame(input: {
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
}): BrowserSessionsServerFrame {
  return {
    kind: "burstEnded",
    hasBinaryPayload: false,
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    outcome: "finished",
  };
}

function captionFrame(input: {
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string;
  readonly cellTitle: string;
}): BrowserSessionsServerFrame {
  return {
    kind: "caption",
    hasBinaryPayload: false,
    sessionId: input.sessionId,
    tabId: input.tabId,
    burstId: input.burstId,
    cellTitle: input.cellTitle,
  };
}

function attachWithHosts(
  opener: PipEpicSessionsOpener,
  hostIds: readonly string[],
  chatId: string | null,
): PipEpicSessionsManager {
  const manager = new PipEpicSessionsManager(EPIC, opener);
  manager.attach();
  manager.setChatId(chatId);
  manager.setHostIds(hostIds);
  return manager;
}

function openedFor(
  opened: readonly FakeSubscription[],
  hostId: string,
): FakeSubscription[] {
  return opened.filter((entry) => entry.request.hostId === hostId);
}

function latestOpened(
  opened: readonly FakeSubscription[],
  hostId: string,
): FakeSubscription {
  const last = openedFor(opened, hostId).at(-1);
  if (last === undefined) {
    throw new Error(`expected a subscription for ${hostId}`);
  }
  return last;
}

describe("PipEpicSessionsManager", () => {
  beforeEach(() => {
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
    setPipNowForTests(() => 1_000);
    setPipActiveHostId("host-a");
  });

  afterEach(() => {
    resetPipStoreForTests();
    resetPipEpicSessionsForTests();
  });

  it("opens one subscription per host with this epic and chat", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);

    expect(opened).toHaveLength(2);
    expect(opened.map((entry) => entry.request.hostId)).toEqual([
      "host-a",
      "host-b",
    ]);
    for (const entry of opened) {
      expect(entry.request.epicId).toBe(EPIC);
      expect(entry.request.chatId).toBe(CHAT);
    }
    expect(manager.getOpenHostIds()).toEqual(["host-a", "host-b"]);
    manager.dispose();
  });

  it("merges snapshot and session frames and tags every item with the slot hostId", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);
    const hostA = latestOpened(opened, "host-a");
    const hostB = latestOpened(opened, "host-b");

    hostA.request.onFrame(
      snapshotFrame([
        session({
          sessionId: "s-a",
          name: "Local",
          hostId: "wire-wrong",
        }),
      ]),
    );
    hostB.request.onFrame(
      snapshotFrame([
        session({
          sessionId: "s-b",
          name: "Remote",
          hostId: "host-b",
        }),
      ]),
    );
    hostA.request.onFrame({
      kind: "sessionCreated",
      hasBinaryPayload: false,
      session: session({
        sessionId: "s-a2",
        name: "Second local",
        hostId: "also-wrong",
      }),
    });
    hostA.request.onFrame({
      kind: "sessionUpdated",
      hasBinaryPayload: false,
      session: session({
        sessionId: "s-a",
        name: "Local renamed",
        hostId: "still-wrong",
      }),
    });

    const items = getPipEpicSessionItems(EPIC);
    expect(
      items.map((item) => [item.sessionId, item.hostId, item.name]),
    ).toEqual([
      ["s-a", "host-a", "Local renamed"],
      ["s-a2", "host-a", "Second local"],
      ["s-b", "host-b", "Remote"],
    ]);
    expect(items.every((item) => item.hostId !== "wire-wrong")).toBe(true);
    expect(items.every((item) => item.hostId !== "also-wrong")).toBe(true);
    expect(items.every((item) => item.hostId !== "still-wrong")).toBe(true);

    hostB.request.onFrame({
      kind: "sessionClosed",
      hasBinaryPayload: false,
      sessionId: "s-b",
      reason: "completed",
    });
    expect(getPipEpicSessionItems(EPIC).map((item) => item.sessionId)).toEqual([
      "s-a",
      "s-a2",
    ]);
    manager.dispose();
  });

  it("forwards bursts on both hosts and tie-breaks equal start times to the active host", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);
    const hostA = latestOpened(opened, "host-a");
    const hostB = latestOpened(opened, "host-b");

    hostB.request.onFrame(
      burstStartedFrame({
        sessionId: "s-b",
        tabId: "t-b",
        burstId: "burst-b",
      }),
    );
    hostA.request.onFrame(
      burstStartedFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
      }),
    );

    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-a");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("burst-a");
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(1);

    setPipActiveHostId("host-b");
    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-b");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("burst-b");

    setPipActiveHostId("host-a");
    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-a");

    hostB.request.onFrame(
      burstEndedFrame({
        sessionId: "s-b",
        tabId: "t-b",
        burstId: "burst-b",
      }),
    );
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("burst-a");
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(0);

    hostA.request.onFrame(
      burstEndedFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
      }),
    );
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).outcome).toBe("finished");
    manager.dispose();
  });

  it("closes an unreachable host, forgets its items and bursts, and joins it later", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);
    const hostA = latestOpened(opened, "host-a");
    const hostB = latestOpened(opened, "host-b");

    hostA.request.onFrame(
      snapshotFrame([
        session({ sessionId: "s-a", name: "Local", hostId: "host-a" }),
      ]),
    );
    hostB.request.onFrame(
      snapshotFrame([
        session({ sessionId: "s-b", name: "Remote", hostId: "host-b" }),
      ]),
    );
    hostA.request.onFrame(
      burstStartedFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
      }),
    );
    hostB.request.onFrame(
      burstStartedFrame({
        sessionId: "s-b",
        tabId: "t-b",
        burstId: "burst-b",
      }),
    );
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(1);

    manager.setHostIds(["host-a"]);

    expect(hostB.closed).toBe(true);
    expect(hostA.closed).toBe(false);
    expect(manager.getOpenHostIds()).toEqual(["host-a"]);
    expect(getPipEpicSessionItems(EPIC).map((item) => item.hostId)).toEqual([
      "host-a",
    ]);
    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-a");
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(0);

    hostB.request.onFrame(
      burstStartedFrame({
        sessionId: "s-b",
        tabId: "t-b",
        burstId: "burst-stale",
      }),
    );
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(0);
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("burst-a");

    manager.setHostIds(["host-a", "host-b"]);
    expect(opened).toHaveLength(3);
    const rejoined = latestOpened(opened, "host-b");
    expect(rejoined).not.toBe(hostB);
    expect(rejoined.closed).toBe(false);
    expect(manager.getOpenHostIds()).toEqual(["host-a", "host-b"]);

    rejoined.request.onFrame(
      snapshotFrame([
        session({ sessionId: "s-b2", name: "Rejoined", hostId: "host-b" }),
      ]),
    );
    rejoined.request.onFrame(
      burstStartedFrame({
        sessionId: "s-b2",
        tabId: "t-b2",
        burstId: "burst-rejoin",
      }),
    );
    expect(
      getPipEpicSessionItems(EPIC).map((item) => [item.sessionId, item.hostId]),
    ).toEqual([
      ["s-a", "host-a"],
      ["s-b2", "host-b"],
    ]);
    expect(getPipSnapshot(EPIC).moreLiveCount).toBe(1);
    manager.dispose();
  });

  it("closes every open subscription on dispose and is safe to dispose twice", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);

    manager.dispose();

    expect(opened).toHaveLength(2);
    expect(opened.every((entry) => entry.closed)).toBe(true);
    expect(manager.isDisposed()).toBe(true);
    expect(() => {
      manager.dispose();
    }).not.toThrow();
    expect(manager.isDisposed()).toBe(true);
  });

  it("opens no subscriptions without a chatId and opens them once chatId is set", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], null);

    expect(opened).toHaveLength(0);
    expect(manager.getOpenHostIds()).toEqual([]);

    manager.setChatId(CHAT);

    expect(opened).toHaveLength(2);
    expect(opened.map((entry) => entry.request.chatId)).toEqual([CHAT, CHAT]);
    expect(manager.getOpenHostIds()).toEqual(["host-a", "host-b"]);
    manager.dispose();
  });

  it("applies caption frames into the pip store", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);
    const hostA = latestOpened(opened, "host-a");

    hostA.request.onFrame(
      burstStartedFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
      }),
    );
    hostA.request.onFrame(
      captionFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
        cellTitle: "Filling checkout form",
      }),
    );

    expect(getPipSnapshot(EPIC).caption).toEqual({
      sessionId: "s-a",
      tabId: "t-a",
      burstId: "burst-a",
      cellTitle: "Filling checkout form",
      arrivedAt: 1_000,
    });
    manager.dispose();
  });

  it("qualifies caption frames with their subscription host", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);
    const hostA = latestOpened(opened, "host-a");
    const hostB = latestOpened(opened, "host-b");

    hostA.request.onFrame(
      burstStartedFrame({
        sessionId: "same-session",
        tabId: "same-tab",
        burstId: "burst-a",
      }),
    );
    hostB.request.onFrame(
      burstStartedFrame({
        sessionId: "same-session",
        tabId: "same-tab",
        burstId: "burst-b",
      }),
    );
    hostA.request.onFrame(
      captionFrame({
        sessionId: "same-session",
        tabId: "same-tab",
        burstId: "burst-a",
        cellTitle: "Local activity",
      }),
    );
    hostB.request.onFrame(
      captionFrame({
        sessionId: "same-session",
        tabId: "same-tab",
        burstId: "burst-b",
        cellTitle: "Remote activity",
      }),
    );

    expect(getPipSnapshot(EPIC).target?.hostId).toBe("host-a");
    expect(getPipSnapshot(EPIC).caption?.cellTitle).toBe("Local activity");
    expect(
      getPipSnapshot(EPIC).rows.find((row) => row.target.burstId === "burst-b")
        ?.caption?.cellTitle,
    ).toBe("Remote activity");
    manager.dispose();
  });

  it("treats a reconnect snapshot as a burst-generation boundary", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a"], CHAT);
    const first = latestOpened(opened, "host-a");

    first.request.onFrame(
      snapshotFrame([
        session({ sessionId: "s-a", name: "Local", hostId: "host-a" }),
      ]),
    );
    first.request.onFrame(
      burstStartedFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
      }),
    );
    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("burst-a");

    // Feed dropped while the host-side burst ended. Reconnect snapshot has
    // no burstStarted replay for the finished burst.
    manager.setChatId(null);
    manager.setChatId(CHAT);
    const reconnect = latestOpened(opened, "host-a");
    expect(reconnect).not.toBe(first);

    reconnect.request.onFrame(
      snapshotFrame([
        session({ sessionId: "s-a", name: "Local", hostId: "host-a" }),
      ]),
    );
    expect(getPipSnapshot(EPIC).phase).not.toBe("live");
    expect(getPipSnapshot(EPIC).phase).toBe("finished");
    expect(getPipSnapshot(EPIC).outcome).toBe("finished");

    manager.dispose();
  });

  it("restores a still-open burst replayed after the snapshot boundary", () => {
    const { opened, opener } = createFakeOpener();
    const manager = attachWithHosts(opener, ["host-a"], CHAT);
    const first = latestOpened(opened, "host-a");

    first.request.onFrame(
      burstStartedFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
      }),
    );
    expect(getPipSnapshot(EPIC).phase).toBe("live");

    manager.setChatId(null);
    manager.setChatId(CHAT);
    const reconnect = latestOpened(opened, "host-a");
    reconnect.request.onFrame(
      snapshotFrame([
        session({ sessionId: "s-a", name: "Local", hostId: "host-a" }),
      ]),
    );
    reconnect.request.onFrame(
      burstStartedFrame({
        sessionId: "s-a",
        tabId: "t-a",
        burstId: "burst-a",
      }),
    );

    expect(getPipSnapshot(EPIC).phase).toBe("live");
    expect(getPipSnapshot(EPIC).target?.burstId).toBe("burst-a");
    manager.dispose();
  });

  it("contains an opener throw so the other host still opens with no error state", () => {
    const opened: FakeSubscription[] = [];
    const opener: PipEpicSessionsOpener = (request) => {
      if (request.hostId === "host-a") {
        throw new Error("dial failed");
      }
      const entry: FakeSubscription = { request, closed: false };
      opened.push(entry);
      return {
        close: () => {
          entry.closed = true;
        },
      };
    };
    const manager = attachWithHosts(opener, ["host-a", "host-b"], CHAT);

    expect(opened).toHaveLength(1);
    expect(opened[0]?.request.hostId).toBe("host-b");
    expect(manager.getOpenHostIds()).toEqual(["host-b"]);
    expect(manager.isDisposed()).toBe(false);
    expect(getPipEpicSessionItems(EPIC)).toEqual([]);

    opened[0]?.request.onFrame(
      snapshotFrame([
        session({ sessionId: "s-b", name: "Remote", hostId: "host-b" }),
      ]),
    );
    expect(getPipEpicSessionItems(EPIC).map((item) => item.hostId)).toEqual([
      "host-b",
    ]);
    expect(getPipSnapshot(EPIC).phase).toBe("hidden");
    manager.dispose();
  });
});
