import { describe, expect, it } from "vitest";
import {
  browserSessionsClientFrameSchema,
  browserSessionsOpenRequestSchema,
  browserSessionsServerFrameSchema,
  browserSessionsV1,
  browserSessionInfoSchema,
  browserScreencastOpenRequestSchema,
} from "@traycer/protocol/host/browser/contracts";

const SAMPLE_SESSION = {
  sessionId: "session-1",
  epicId: "epic-1",
  hostId: "host-1",
  profile: "primary" as const,
  name: "Browser",
  createdBy: { chatId: "chat-1", agentRunId: null },
  createdAt: 10,
  lastActivityAt: 20,
  tabs: [
    {
      tabId: "session-1",
      url: "http://localhost:3000",
      originTier: "dev" as const,
      status: "ready" as const,
      title: "App",
      drivenBy: [],
    },
  ],
};

describe("browser.sessions@1.0 visible tile control frames", () => {
  it("parses visible tile control request frames on the baseline contract", () => {
    const frame = {
      kind: "visibleTileControlRequest",
      hasBinaryPayload: false,
      requestId: "request-1",
      grantId: "grant-1",
      chatId: "chat-1",
      agentRunId: "agent-1",
      agentLabel: "agent-1",
      tileInstanceId: "tile-1",
      origin: "http://localhost:3000",
      url: "http://localhost:3000/app",
      requestedAt: 10,
      expiresAt: 20,
    };

    expect(browserSessionsServerFrameSchema.safeParse(frame).success).toBe(
      true,
    );
    expect(browserSessionsV1.serverFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });

  it("accepts host-issued grant ids on the control grant decision frame", () => {
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

    expect(browserSessionsClientFrameSchema.safeParse(frame).success).toBe(
      true,
    );
    expect(browserSessionsV1.clientFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });

  it("accepts semantic visible tile actions on the baseline server frame", () => {
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

    expect(browserSessionsServerFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });

  it("accepts tile-addressed visible tile control failures on the baseline server frame", () => {
    const frame = {
      kind: "visibleTileControlResult",
      hasBinaryPayload: false,
      requestId: "request-1",
      tileInstanceId: "tile-1",
      ok: false,
      reason: "Visible tile control request expired.",
      grant: null,
    };

    expect(browserSessionsServerFrameSchema.safeParse(frame).success).toBe(
      true,
    );
  });
});

describe("browser.sessions@1.0 dual-key open + tab-shaped session info", () => {
  it("requires both epicId and chatId on the open request", () => {
    expect(
      browserSessionsOpenRequestSchema.safeParse({
        epicId: "epic-1",
        chatId: "chat-1",
      }).success,
    ).toBe(true);
    expect(
      browserSessionsOpenRequestSchema.safeParse({ chatId: "chat-1" }).success,
    ).toBe(false);
    expect(
      browserSessionsOpenRequestSchema.safeParse({ epicId: "epic-1" }).success,
    ).toBe(false);
  });

  it("parses the tab-shaped session info (url/status live on tabs, not the session root)", () => {
    expect(browserSessionInfoSchema.safeParse(SAMPLE_SESSION).success).toBe(
      true,
    );
    expect(
      browserSessionInfoSchema.safeParse({
        sessionId: "session-1",
        hostId: "host-1",
        chatId: "chat-1",
        url: "http://localhost:3000",
        originTier: "dev",
        status: "ready",
        title: "App",
        createdAt: 10,
        lastActivityAt: 20,
      }).success,
    ).toBe(false);
  });

  it("requires epicId and tabId on screencast open requests", () => {
    expect(
      browserScreencastOpenRequestSchema.safeParse({
        epicId: "epic-1",
        sessionId: "session-1",
        tabId: "session-1",
        maxWidth: 1280,
        maxHeight: 720,
        quality: 80,
        format: "jpeg",
      }).success,
    ).toBe(true);
    expect(
      browserScreencastOpenRequestSchema.safeParse({
        sessionId: "session-1",
        tabId: "session-1",
        maxWidth: 1280,
        maxHeight: 720,
        quality: 80,
        format: "jpeg",
      }).success,
    ).toBe(false);
    expect(
      browserScreencastOpenRequestSchema.safeParse({
        epicId: "epic-1",
        sessionId: "session-1",
        maxWidth: 1280,
        maxHeight: 720,
        quality: 80,
        format: "jpeg",
      }).success,
    ).toBe(false);
  });
});
