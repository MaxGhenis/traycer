import { describe, expect, it, vi } from "vitest";
import type { HostCommunicationGraphCloudFeedEvent } from "@traycer/protocol/host/epic/communication-graph";
import {
  CommGraphCloudSubscriptionManager,
  selectCommGraphAuthoritativeSnapshot,
  type CommGraphCloudSubscriptionOpener,
  type CommGraphCloudSubscriptionRequest,
} from "@/lib/comm-graph/comm-graph-cloud-subscription";
import type { CommGraphSnapshot } from "@/lib/comm-graph/comm-graph-events";
import { commGraphEventKey } from "@/lib/comm-graph/comm-graph-timeline";
import {
  dropCommGraphRowOpenKeys,
  useCommGraphRowOpenStore,
} from "@/stores/epics/comm-graph-row-open-store";

function cloudEvent(
  overrides: Partial<HostCommunicationGraphCloudFeedEvent>,
): HostCommunicationGraphCloudFeedEvent {
  return {
    eventId: "event-1",
    originHostId: "origin-a",
    originSequence: 7,
    ingestVersion: 10,
    kind: "a2a_message",
    capturedAt: 1_000,
    senderAgentId: "agent-a",
    receiverAgentId: "agent-b",
    responseId: "response-1",
    inReplyTo: null,
    expectReply: true,
    messageText: "hello",
    noticeReason: null,
    originKind: null,
    originChatId: null,
    originRefId: null,
    historicalUpload: false,
    ...overrides,
  };
}

function recordedOpener(): {
  readonly opener: CommGraphCloudSubscriptionOpener;
  readonly requests: CommGraphCloudSubscriptionRequest[];
} {
  const requests: CommGraphCloudSubscriptionRequest[] = [];
  return {
    requests,
    opener: (request) => {
      requests.push(request);
      return { close: () => undefined };
    },
  };
}

describe("CommGraphCloudSubscriptionManager", () => {
  it("normalizes cloud identity and uses one cursor-aware path for snapshots and events", () => {
    const recorded = recordedOpener();
    const manager = new CommGraphCloudSubscriptionManager(
      "epic-1",
      recorded.opener,
      () => undefined,
      () => undefined,
    );
    manager.setRelayHostIds(["relay-b"]);
    manager.attach();
    const handlers = recorded.requests[0].handlers;

    handlers.onAvailability("available");
    handlers.onSnapshot([cloudEvent({})], 10, null);
    // A changed head/snapshot may replay the retained cursor; it is never a
    // bootstrap replacement and cannot duplicate or clear the first row.
    handlers.onSnapshot(
      [
        cloudEvent({}),
        cloudEvent({
          eventId: "event-2",
          originSequence: 8,
          ingestVersion: 11,
          capturedAt: 2_000,
        }),
      ],
      11,
      null,
    );

    const snapshot = manager.getSnapshot();
    expect(snapshot.events.map((event) => event.eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(snapshot.events[0]).toMatchObject({
      id: 7,
      hostId: "origin-a",
      timestamp: 1_000,
    });
    expect(commGraphEventKey(snapshot.events[0])).toBe("event-1");
    expect(recorded.requests[0].readSinceCursor()).toEqual({
      ingestVersion: 11,
      eventId: "event-2",
    });

    manager.detach();
    manager.attach();
    expect(recorded.requests[1].readSinceCursor()).toEqual({
      ingestVersion: 11,
      eventId: "event-2",
    });
    recorded.requests[1].handlers.onSnapshot(
      [
        cloudEvent({
          eventId: "event-3",
          originSequence: 9,
          ingestVersion: 12,
          capturedAt: 3_000,
        }),
      ],
      12,
      null,
    );
    expect(manager.getSnapshot().lastArrival).toBeNull();
  });

  it("suppresses initial and historical-upload pulses but reports a later live row", () => {
    const recorded = recordedOpener();
    const manager = new CommGraphCloudSubscriptionManager(
      "epic-1",
      recorded.opener,
      () => undefined,
      () => undefined,
    );
    manager.setRelayHostIds(["relay-b"]);
    manager.attach();
    const handlers = recorded.requests[0].handlers;

    handlers.onAvailability("available");
    handlers.onSnapshot([cloudEvent({})], 10, null);
    expect(manager.getSnapshot().lastArrival).toBeNull();

    handlers.onEvent(
      cloudEvent({
        eventId: "history-late",
        ingestVersion: 11,
        historicalUpload: true,
      }),
    );
    expect(manager.getSnapshot().lastArrival).toBeNull();

    handlers.onEvent(
      cloudEvent({
        eventId: "live",
        originSequence: 9,
        ingestVersion: 12,
        capturedAt: 3_000,
      }),
    );
    expect(manager.getSnapshot().lastArrival?.eventId).toBe("live");
  });

  it("keeps cloud authority and rows through transient relay failure", () => {
    const localRow = cloudEvent({ eventId: "local-only" });
    const cloudRow = cloudEvent({ eventId: "cloud-only" });
    const local = {
      events: [{ ...localRow, id: 1, timestamp: 1, hostId: "local" }],
      hosts: [],
      lastArrival: null,
    } satisfies CommGraphSnapshot;
    const cloud = {
      events: [{ ...cloudRow, id: 2, timestamp: 2, hostId: "origin" }],
      hosts: [
        {
          hostId: "relay",
          status: "reconnecting",
          cursor: 2,
          snapshotBoundary: null,
        },
      ],
      lastArrival: null,
    } satisfies CommGraphSnapshot;

    const selected = selectCommGraphAuthoritativeSnapshot(
      "available",
      cloud,
      local,
    );
    expect(selected.events.map((event) => event.eventId)).toEqual([
      "cloud-only",
    ]);
    expect(selected.events).not.toContainEqual(
      expect.objectContaining({ eventId: "local-only" }),
    );
  });

  it("treats host revocation as a plane transition without clearing the cloud cursor", () => {
    const recorded = recordedOpener();
    const onAuthorityRevoked = vi.fn();
    const manager = new CommGraphCloudSubscriptionManager(
      "epic-1",
      recorded.opener,
      onAuthorityRevoked,
      () => undefined,
    );
    manager.setRelayHostIds(["relay-b"]);
    manager.attach();
    const handlers = recorded.requests[0].handlers;
    handlers.onAvailability("available");
    handlers.onSnapshot([cloudEvent({})], 10, null);

    handlers.onAvailability("unavailable");
    expect(manager.getAvailability()).toBe("unavailable");
    expect(onAuthorityRevoked).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().events).toHaveLength(1);

    handlers.onAvailability("available");
    handlers.onSnapshot(
      [
        cloudEvent({
          eventId: "event-2",
          originSequence: 8,
          ingestVersion: 11,
        }),
      ],
      11,
      null,
    );
    expect(manager.getSnapshot().events).toHaveLength(2);
    expect(manager.getSnapshot().lastArrival).toBeNull();
  });

  it("applies an advancing frontier without reconnecting, moving, or stalling the cursor", () => {
    useCommGraphRowOpenStore.setState({ openRowKeysByEpicId: {} });
    const recorded = recordedOpener();
    const manager = new CommGraphCloudSubscriptionManager(
      "epic-1",
      recorded.opener,
      () => undefined,
      (rowKeys) => dropCommGraphRowOpenKeys("epic-1", rowKeys),
    );
    manager.setRelayHostIds(["relay-b"]);
    manager.attach();
    const handlers = recorded.requests[0].handlers;
    handlers.onAvailability("available");
    handlers.onSnapshot(
      [
        cloudEvent({ eventId: "below", ingestVersion: 4 }),
        cloudEvent({ eventId: "at", ingestVersion: 5 }),
        cloudEvent({ eventId: "above", ingestVersion: 7 }),
      ],
      7,
      4,
    );
    useCommGraphRowOpenStore.getState().setRowOpen("epic-1", "below", true);
    useCommGraphRowOpenStore.getState().setRowOpen("epic-1", "at", true);
    handlers.onEvent(
      cloudEvent({ eventId: "live-8", ingestVersion: 8, capturedAt: 8_000 }),
    );
    const cursorBefore = recorded.requests[0].readSinceCursor();

    handlers.onSnapshot([], 8, 5);

    expect(manager.getSnapshot().events.map((event) => event.eventId)).toEqual([
      "at",
      "above",
      "live-8",
    ]);
    expect(recorded.requests).toHaveLength(1);
    expect(recorded.requests[0].readSinceCursor()).toEqual(cursorBefore);
    const openRows =
      useCommGraphRowOpenStore.getState().openRowKeysByEpicId["epic-1"];
    expect(openRows?.has("below")).toBe(false);
    expect(openRows?.has("at")).toBe(true);

    handlers.onEvent(
      cloudEvent({ eventId: "live-9", ingestVersion: 9, capturedAt: 9_000 }),
    );
    expect(recorded.requests[0].readSinceCursor()).toEqual({
      ingestVersion: 9,
      eventId: "live-9",
    });
  });
});
