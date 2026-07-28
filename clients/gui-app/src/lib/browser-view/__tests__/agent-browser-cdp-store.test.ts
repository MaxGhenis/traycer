import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionsClientFrame } from "@traycer/protocol/host/browser/contracts";
import {
  buildCdpResultFrame,
  notifyAgentBrowserCdpSessionEnded,
  notifyAgentBrowserCdpTargetAttached,
  publishAgentBrowserCdpRequest,
  registerAgentBrowserCdpHandler,
  resetAgentBrowserCdpStoreForTests,
} from "../agent-browser-cdp-store";
import type { AgentBrowserCdpRequest } from "../agent-browser-cdp-store";

describe("agent browser CDP store", () => {
  afterEach(() => {
    resetAgentBrowserCdpStoreForTests();
  });

  it("delivers a published request to the handler registered for the same tile", () => {
    const sendFrame = vi.fn();
    const handler = vi.fn();
    const dispose = registerAgentBrowserCdpHandler("tile-1", handler);

    const request: AgentBrowserCdpRequest = {
      requestId: "req-1",
      tileInstanceId: "tile-1",
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
      sendFrame,
    };
    publishAgentBrowserCdpRequest(request);

    expect(handler).toHaveBeenCalledWith(request);
    expect(sendFrame).not.toHaveBeenCalled();
    dispose();
  });

  it("does not deliver a request to a handler registered for a different tile", () => {
    const handler = vi.fn();
    registerAgentBrowserCdpHandler("tile-1", handler);

    publishAgentBrowserCdpRequest({
      requestId: "req-1",
      tileInstanceId: "tile-2",
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
      sendFrame: vi.fn(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("replies with a tile_not_found result frame when no handler is registered", () => {
    const sendFrame = vi.fn<(frame: BrowserSessionsClientFrame) => void>();
    publishAgentBrowserCdpRequest({
      requestId: "req-1",
      tileInstanceId: "tile-unmounted",
      sessionId: null,
      command: { kind: "cdpNavigate", url: "https://example.com" },
      sendFrame,
    });

    expect(sendFrame).toHaveBeenCalledTimes(1);
    const sentFrame = sendFrame.mock.calls[0]?.[0];
    expect(sentFrame).toMatchObject({
      kind: "cdpNavigateResult",
      requestId: "req-1",
      tileInstanceId: "tile-unmounted",
      ok: false,
    });
    expect(sentFrame).toHaveProperty("error.kind", "tile_not_found");
  });

  it("stops delivering to a handler once it has been unregistered", () => {
    const handler = vi.fn();
    const dispose = registerAgentBrowserCdpHandler("tile-1", handler);
    dispose();

    const sendFrame = vi.fn();
    publishAgentBrowserCdpRequest({
      requestId: "req-1",
      tileInstanceId: "tile-1",
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
      sendFrame,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(sendFrame).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    );
  });

  it("pushes a cdpSessionEnded notification through the sendFrame captured by the last published request", () => {
    const sendFrame = vi.fn();
    registerAgentBrowserCdpHandler("tile-1", () => {});
    publishAgentBrowserCdpRequest({
      requestId: "req-1",
      tileInstanceId: "tile-1",
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
      sendFrame,
    });

    notifyAgentBrowserCdpSessionEnded("tile-1", "target closed");

    expect(sendFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cdpSessionEnded",
        tileInstanceId: "tile-1",
        reason: "target closed",
      }),
    );
  });

  it("is a no-op notifying a tile that has never had a request published", () => {
    expect(() =>
      notifyAgentBrowserCdpSessionEnded("tile-never-dispatched", "reason"),
    ).not.toThrow();
  });

  it("pushes a cdpTargetAttached notification through the captured sendFrame", () => {
    const sendFrame = vi.fn();
    registerAgentBrowserCdpHandler("tile-1", () => {});
    publishAgentBrowserCdpRequest({
      requestId: "req-1",
      tileInstanceId: "tile-1",
      sessionId: null,
      command: { kind: "cdpGetFrameTree" },
      sendFrame,
    });

    notifyAgentBrowserCdpTargetAttached("tile-1", {
      sessionId: "child-session-1",
      targetId: "target-1",
      targetType: "iframe",
      url: "https://example.com/child",
      waitingForDebugger: false,
    });

    expect(sendFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cdpTargetAttached",
        tileInstanceId: "tile-1",
        sessionId: "child-session-1",
        targetId: "target-1",
        targetType: "iframe",
        url: "https://example.com/child",
        waitingForDebugger: false,
      }),
    );
  });

  describe("buildCdpResultFrame", () => {
    it("builds the success frame for cdpNavigate", () => {
      const frame = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpNavigate",
        ok: true,
        frameId: "frame-1",
        loaderId: "loader-1",
        errorText: null,
      });
      expect(frame).toEqual({
        kind: "cdpNavigateResult",
        hasBinaryPayload: false,
        requestId: "req-1",
        tileInstanceId: "tile-1",
        ok: true,
        error: null,
        frameId: "frame-1",
        loaderId: "loader-1",
        errorText: null,
      });
    });

    it("builds the failure frame for cdpNavigate with null success fields", () => {
      const frame = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpNavigate",
        ok: false,
        error: { kind: "not_attached", message: "not attached", code: null },
      });
      expect(frame).toEqual({
        kind: "cdpNavigateResult",
        hasBinaryPayload: false,
        requestId: "req-1",
        tileInstanceId: "tile-1",
        ok: false,
        error: { kind: "not_attached", message: "not attached", code: null },
        frameId: null,
        loaderId: null,
        errorText: null,
      });
    });

    it("builds the success frame for cdpCreateIsolatedWorld", () => {
      const frame = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpCreateIsolatedWorld",
        ok: true,
        executionContextId: 7,
      });
      expect(frame).toMatchObject({
        kind: "cdpCreateIsolatedWorldResult",
        executionContextId: 7,
      });
    });

    it("builds both success and failure frames for cdpSetAutoAttach", () => {
      const success = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpSetAutoAttach",
        ok: true,
      });
      expect(success).toMatchObject({
        kind: "cdpSetAutoAttachResult",
        ok: true,
      });

      const failure = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpSetAutoAttach",
        ok: false,
        error: { kind: "cdp_error", message: "boom", code: null },
      });
      expect(failure).toMatchObject({
        kind: "cdpSetAutoAttachResult",
        ok: false,
        error: { kind: "cdp_error", message: "boom", code: null },
      });
    });

    it("builds the success frame for cdpDescribeNode", () => {
      const frame = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpDescribeNode",
        ok: true,
        nodeId: 1,
        backendNodeId: 2,
        nodeName: "IFRAME",
        frameId: "child-frame-1",
      });
      expect(frame).toEqual({
        kind: "cdpDescribeNodeResult",
        hasBinaryPayload: false,
        requestId: "req-1",
        tileInstanceId: "tile-1",
        ok: true,
        error: null,
        nodeId: 1,
        backendNodeId: 2,
        nodeName: "IFRAME",
        frameId: "child-frame-1",
      });
    });

    it("builds the success frame for cdpGetFullAXTree", () => {
      const frame = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpGetFullAXTree",
        ok: true,
        nodesJson: [{ role: "WebArea" }],
      });
      expect(frame).toMatchObject({
        kind: "cdpGetFullAXTreeResult",
        nodesJson: [{ role: "WebArea" }],
      });
    });

    it("builds the success frame for cdpEvaluate carrying an opaque resultJson", () => {
      const frame = buildCdpResultFrame("req-1", "tile-1", {
        kind: "cdpEvaluate",
        ok: true,
        resultJson: 42,
        objectId: null,
        exceptionDescription: null,
      });
      expect(frame).toMatchObject({
        kind: "cdpEvaluateResult",
        resultJson: 42,
      });
    });
  });
});
