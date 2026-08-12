import { describe, expect, it } from "vitest";
import {
  browserSessionsClientFrameSchema,
  browserSessionsOpenRequestSchema,
  browserSessionsServerFrameSchema,
  browserSessionsV1,
  browserSessionInfoSchema,
  browserScreencastClientFrameSchema,
  browserScreencastOpenRequestSchema,
  browserScreencastServerFrameSchema,
  browserScreencastV10,
  browserTabInfoSchema,
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
      viewed: false,
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

describe("browser.screencast@1.0 control frames", () => {
  it("carries arming and subscription-bound input on the unreleased baseline", () => {
    const clientFrames = [
      { kind: "arm", hasBinaryPayload: false, armEpoch: 3 },
      { kind: "disarm", hasBinaryPayload: false, armEpoch: 3 },
      {
        kind: "pointer",
        hasBinaryPayload: false,
        armEpoch: 3,
        seq: 0,
        type: "down",
        castSequence: 7,
        normalizedX: 0.25,
        normalizedY: 0.75,
        button: "left",
        buttons: 1,
        modifiers: 2,
        deltaX: 0,
        deltaY: 0,
      },
      {
        kind: "keyboard",
        hasBinaryPayload: false,
        armEpoch: 3,
        seq: 1,
        type: "rawKeyDown",
        code: "KeyA",
        key: "a",
        modifiers: 0,
      },
      {
        kind: "insertText",
        hasBinaryPayload: false,
        armEpoch: 3,
        seq: 2,
        text: "hello",
      },
    ];
    for (const frame of clientFrames) {
      expect(browserScreencastClientFrameSchema.safeParse(frame).success).toBe(
        true,
      );
      expect(
        browserScreencastV10.clientFrameSchema.safeParse(frame).success,
      ).toBe(true);
    }

    for (const frame of [
      { kind: "armed", hasBinaryPayload: false, armEpoch: 3 },
      {
        kind: "revoked",
        hasBinaryPayload: false,
        armEpoch: 3,
        cause: "stolen",
      },
    ]) {
      expect(browserScreencastServerFrameSchema.safeParse(frame).success).toBe(
        true,
      );
      expect(
        browserScreencastV10.serverFrameSchema.safeParse(frame).success,
      ).toBe(true);
    }
  });

  it("parses pending reverse-migration status on the screencast contract", () => {
    const pending = {
      kind: "migrationPending",
      hasBinaryPayload: false,
      pending: true,
    };
    expect(browserScreencastServerFrameSchema.safeParse(pending).success).toBe(
      true,
    );
    expect(
      browserScreencastV10.serverFrameSchema.safeParse(pending).success,
    ).toBe(true);
  });

  it("parses generation-bound dialog open and response frames", () => {
    const opened = {
      kind: "dialogOpened",
      hasBinaryPayload: false,
      generation: 12,
      type: "prompt",
      message: "prompt text stays on the wire only",
      defaultValue: "default text",
    };
    const response = {
      kind: "dialogResponse",
      hasBinaryPayload: false,
      armEpoch: 4,
      generation: 12,
      accept: true,
      promptText: "typed text",
    };

    expect(browserScreencastServerFrameSchema.safeParse(opened).success).toBe(
      true,
    );
    expect(browserScreencastV10.serverFrameSchema.safeParse(opened).success).toBe(
      true,
    );
    expect(browserScreencastClientFrameSchema.safeParse(response).success).toBe(
      true,
    );
    expect(browserScreencastV10.clientFrameSchema.safeParse(response).success).toBe(
      true,
    );

    expect(
      browserScreencastServerFrameSchema.safeParse({
        ...opened,
        generation: -1,
      }).success,
    ).toBe(false);
    expect(
      browserScreencastClientFrameSchema.safeParse({
        ...response,
        promptText: 42,
      }).success,
    ).toBe(false);
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

  it("requires viewed boolean on BrowserTabInfo and electronTabState frames (ticket 13)", () => {
    expect(
      browserTabInfoSchema.safeParse({
        tabId: "tab-1",
        url: "https://example.com",
        originTier: "external",
        status: "ready",
        title: "Example",
        viewed: true,
        drivenBy: [],
      }).success,
    ).toBe(true);
    expect(
      browserTabInfoSchema.safeParse({
        tabId: "tab-1",
        url: "https://example.com",
        originTier: "external",
        status: "ready",
        title: "Example",
        drivenBy: [],
      }).success,
    ).toBe(false);

    expect(
      browserSessionsClientFrameSchema.safeParse({
        kind: "electronTabState",
        hasBinaryPayload: false,
        requestId: "req-1",
        registrationId: "reg-1",
        sessionId: "session-1",
        tabId: "tab-1",
        url: "https://example.com",
        title: "Example",
        status: "ready",
        viewed: true,
      }).success,
    ).toBe(true);
    expect(
      browserSessionsClientFrameSchema.safeParse({
        kind: "electronTabState",
        hasBinaryPayload: false,
        requestId: "req-1",
        registrationId: "reg-1",
        sessionId: "session-1",
        tabId: "tab-1",
        url: "https://example.com",
        title: "Example",
        status: "ready",
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
