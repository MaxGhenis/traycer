import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionsClientFrame } from "@traycer/protocol/host/browser/contracts";
import {
  clearBorrowedTileAttachment,
  publishBorrowedTileAttachment,
  readBorrowedTileAttachmentForTests,
  releaseBorrowedTileAttachment,
  resetBorrowedTileStoreForTests,
  type BrowserBorrowedTileAttachment,
} from "../browser-borrowed-tile-store";

function makeAttachment(input: {
  readonly attachmentId: string;
  readonly tileInstanceId: string;
  readonly agentLabel: string;
  readonly attachedAt: number;
  readonly expiresAt: number;
  readonly sendFrame: (frame: BrowserSessionsClientFrame) => void;
}): BrowserBorrowedTileAttachment {
  return {
    attachmentId: input.attachmentId,
    tileInstanceId: input.tileInstanceId,
    chatId: "chat-1",
    agentRunId: "run-1",
    agentLabel: input.agentLabel,
    attachedAt: input.attachedAt,
    expiresAt: input.expiresAt,
    sendFrame: input.sendFrame,
  };
}

describe("browser borrowed tile store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    resetBorrowedTileStoreForTests();
    vi.useRealTimers();
  });

  it("publishes an attachment and ignores a stale clear for a newer attachment", () => {
    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    const first = makeAttachment({
      attachmentId: "att-1",
      tileInstanceId: "tile-1",
      agentLabel: "Agent One",
      attachedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      sendFrame,
    });
    const second = makeAttachment({
      attachmentId: "att-2",
      tileInstanceId: "tile-1",
      agentLabel: "Agent Two",
      attachedAt: Date.now() + 1,
      expiresAt: Date.now() + 120_000,
      sendFrame,
    });

    publishBorrowedTileAttachment(first);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toEqual(first);

    publishBorrowedTileAttachment(second);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toEqual(second);

    clearBorrowedTileAttachment({
      tileInstanceId: "tile-1",
      attachmentId: "att-1",
    });
    expect(readBorrowedTileAttachmentForTests("tile-1")).toEqual(second);

    clearBorrowedTileAttachment({
      tileInstanceId: "tile-1",
      attachmentId: "att-2",
    });
    expect(readBorrowedTileAttachmentForTests("tile-1")).toBeNull();
  });

  it("drops an attachment whose expiresAt is already in the past on arrival", () => {
    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishBorrowedTileAttachment(
      makeAttachment({
        attachmentId: "att-expired",
        tileInstanceId: "tile-1",
        agentLabel: "Late Agent",
        attachedAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1,
        sendFrame,
      }),
    );

    expect(readBorrowedTileAttachmentForTests("tile-1")).toBeNull();
  });

  it("does not let an already-expired publish for a different attachment wipe a live one", () => {
    // Discriminating regression for the set-then-delete bug: an expired
    // attach frame naming B must not clear A's entry or kill A's timer.
    // "expired publish is not stored" alone passes both before and after.
    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    const live = makeAttachment({
      attachmentId: "att-live-a",
      tileInstanceId: "tile-1",
      agentLabel: "Live Agent",
      attachedAt: Date.now(),
      expiresAt: Date.now() + 10_000,
      sendFrame,
    });
    const staleExpired = makeAttachment({
      attachmentId: "att-stale-b",
      tileInstanceId: "tile-1",
      agentLabel: "Stale Expired Agent",
      attachedAt: Date.now() - 20_000,
      expiresAt: Date.now() - 1,
      sendFrame,
    });

    publishBorrowedTileAttachment(live);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toEqual(live);

    publishBorrowedTileAttachment(staleExpired);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toEqual(live);

    vi.advanceTimersByTime(9_999);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toEqual(live);

    vi.advanceTimersByTime(1);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toBeNull();
  });

  it("drops a live attachment when its expiry passes without a host frame", () => {
    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishBorrowedTileAttachment(
      makeAttachment({
        attachmentId: "att-live",
        tileInstanceId: "tile-1",
        agentLabel: "Expiring Agent",
        attachedAt: Date.now(),
        expiresAt: Date.now() + 5_000,
        sendFrame,
      }),
    );

    expect(readBorrowedTileAttachmentForTests("tile-1")).not.toBeNull();

    vi.advanceTimersByTime(4_999);
    expect(readBorrowedTileAttachmentForTests("tile-1")).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toBeNull();
    expect(sendFrame).not.toHaveBeenCalled();
  });

  it("releaseBorrowedTileAttachment removes the attachment and is a no-op on a second release", () => {
    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    const attachment = makeAttachment({
      attachmentId: "att-release",
      tileInstanceId: "tile-1",
      agentLabel: "Detachable Agent",
      attachedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      sendFrame,
    });

    publishBorrowedTileAttachment(attachment);
    expect(readBorrowedTileAttachmentForTests("tile-1")).toEqual(attachment);

    releaseBorrowedTileAttachment({
      attachment,
      reason: "User detached the agent from this browser tab.",
    });
    expect(readBorrowedTileAttachmentForTests("tile-1")).toBeNull();

    releaseBorrowedTileAttachment({
      attachment,
      reason: "User detached the agent from this browser tab.",
    });
    expect(readBorrowedTileAttachmentForTests("tile-1")).toBeNull();
  });
});
