import { describe, expect, it } from "vitest";
import {
  browserSessionsV10,
  browserSessionsV11,
  browserSessionsV12,
} from "@traycer/protocol/host/browser/contracts";

describe("browser.sessions visible tile control frames", () => {
  it("keeps visible tile control frames out of the frozen 1.0 contract", () => {
    const frame = {
      kind: "visibleTileControlRequest",
      hasBinaryPayload: false,
      requestId: "request-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "agent-1",
      tileInstanceId: "tile-1",
      origin: "http://localhost:3000",
      url: "http://localhost:3000/app",
      requestedAt: 10,
      expiresAt: 20,
    };

    expect(browserSessionsV10.serverFrameSchema.safeParse(frame).success).toBe(
      false,
    );
    expect(browserSessionsV11.serverFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });

  it("accepts host-issued grant ids on the additive 1.2 control grant", () => {
    const frame = {
      kind: "visibleTileControlDecision",
      hasBinaryPayload: false,
      requestId: "request-1",
      approved: true,
      grant: {
        grantId: "grant-1",
        chatId: "chat-1",
        tileInstanceId: "tile-1",
        origin: "http://localhost:3000",
        dataLevel: "control",
        expiresAt: 20,
      },
      reason: null,
    };

    expect(browserSessionsV10.clientFrameSchema.safeParse(frame).success).toBe(
      false,
    );
    expect(browserSessionsV12.clientFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });

  it("accepts semantic visible tile actions only on the additive 1.2 server frame", () => {
    const frame = {
      kind: "visibleTileControlAction",
      hasBinaryPayload: false,
      requestId: "action-1",
      grantId: "grant-1",
      tileInstanceId: "tile-1",
      action: {
        kind: "click",
        selector: "button",
      },
      requestedAt: 30,
    };

    expect(browserSessionsV10.serverFrameSchema.safeParse(frame).success).toBe(
      false,
    );
    expect(browserSessionsV11.serverFrameSchema.safeParse(frame).success).toBe(
      false,
    );
    expect(browserSessionsV12.serverFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });

  it("accepts tile-addressed visible tile control failures on the additive 1.2 server frame", () => {
    const frame = {
      kind: "visibleTileControlResult",
      hasBinaryPayload: false,
      requestId: "request-1",
      tileInstanceId: "tile-1",
      ok: false,
      reason: "Visible tile control request expired.",
      grant: null,
    };

    expect(browserSessionsV10.serverFrameSchema.safeParse(frame).success).toBe(
      false,
    );
    expect(browserSessionsV12.serverFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });
});
