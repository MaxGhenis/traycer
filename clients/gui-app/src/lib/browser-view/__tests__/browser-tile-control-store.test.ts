import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activateBrowserTileControl,
  clearBrowserTileActiveControl,
  clearBrowserTileControlRequest,
  publishBrowserTileControlRequest,
  readBrowserTileControlSnapshotForTests,
  resetBrowserTileControlStoreForTests,
} from "../browser-tile-control-store";

describe("browser tile control store", () => {
  afterEach(() => {
    resetBrowserTileControlStoreForTests();
  });

  it("moves a visible control request from pending to active and clears it on stop", () => {
    const sendFrame = vi.fn();
    const request = {
      requestId: "request-1",
      grantId: "grant-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      tileInstanceId: "tile-1",
      origin: "http://localhost:3000",
      url: "http://localhost:3000/app",
      requestedAt: 10,
      expiresAt: 20,
      sendFrame,
    };
    const grant = {
      grantId: "grant-1",
      chatId: "chat-1",
      tileInstanceId: "tile-1",
      origin: "http://localhost:3000",
      dataLevel: "control" as const,
      expiresAt: 20,
    };

    publishBrowserTileControlRequest(request);
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toMatchObject({
      pending: request,
      active: null,
    });

    activateBrowserTileControl({ request, grant });
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toMatchObject({
      pending: null,
      active: { requestId: "request-1", grant },
    });

    clearBrowserTileActiveControl({
      tileInstanceId: "tile-1",
      controlId: "request-1",
    });
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toEqual({
      pending: null,
      pendingCount: 0,
      active: null,
    });
  });

  it("returns the same snapshot reference until tile control state changes", () => {
    const sendFrame = vi.fn();
    const request = {
      requestId: "request-1",
      grantId: "grant-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      tileInstanceId: "tile-1",
      origin: "http://localhost:3000",
      url: "http://localhost:3000/app",
      requestedAt: 10,
      expiresAt: 20,
      sendFrame,
    };

    const initial = readBrowserTileControlSnapshotForTests("tile-1");
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toBe(initial);

    publishBrowserTileControlRequest(request);
    const pending = readBrowserTileControlSnapshotForTests("tile-1");
    expect(pending).not.toBe(initial);
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toBe(pending);

    clearBrowserTileControlRequest({
      tileInstanceId: "tile-1",
      requestId: "request-1",
    });
    const cleared = readBrowserTileControlSnapshotForTests("tile-1");
    expect(cleared).not.toBe(pending);
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toBe(cleared);
  });

  it("queues pending requests and clears only the matching pending request", () => {
    const request = {
      requestId: "request-1",
      grantId: "grant-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "Agent One",
      tileInstanceId: "tile-1",
      origin: "http://localhost:3000",
      url: null,
      requestedAt: 10,
      expiresAt: 20,
      sendFrame: vi.fn(),
    };
    const nextRequest = {
      ...request,
      requestId: "request-2",
      grantId: "grant-2",
      agentLabel: "Agent Two",
    };

    publishBrowserTileControlRequest(request);
    publishBrowserTileControlRequest(nextRequest);
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toMatchObject({
      pending: request,
      pendingCount: 2,
    });
    clearBrowserTileControlRequest({
      tileInstanceId: "tile-1",
      requestId: "other",
    });
    expect(readBrowserTileControlSnapshotForTests("tile-1").pending).toBe(
      request,
    );
    clearBrowserTileControlRequest({
      tileInstanceId: "tile-1",
      requestId: "request-1",
    });
    expect(readBrowserTileControlSnapshotForTests("tile-1")).toMatchObject({
      pending: nextRequest,
      pendingCount: 1,
    });
  });
});
