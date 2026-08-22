import { describe, expect, it } from "vitest";
import { browserSessionsClientFrameSchema } from "@traycer/protocol/host/browser/contracts";

const CLOSE_TAB = {
  kind: "closeTab",
  hasBinaryPayload: false,
  requestId: "req-close-tab-1",
  sessionId: "session-1",
  tabId: "tab-1",
} as const;

const CLOSE_SESSION = {
  kind: "closeSession",
  hasBinaryPayload: false,
  requestId: "req-close-session-1",
  sessionId: "session-1",
} as const;

describe("browser.sessions closeTab / closeSession client frames", () => {
  it("parses closeTab frames", () => {
    const parsed = browserSessionsClientFrameSchema.safeParse(CLOSE_TAB);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(CLOSE_TAB);
    }
  });

  it("requires sessionId and tabId on closeTab", () => {
    const { sessionId: _sessionId, ...withoutSessionId } = CLOSE_TAB;
    const { tabId: _tabId, ...withoutTabId } = CLOSE_TAB;
    expect(
      browserSessionsClientFrameSchema.safeParse(withoutSessionId).success,
    ).toBe(false);
    expect(
      browserSessionsClientFrameSchema.safeParse(withoutTabId).success,
    ).toBe(false);
  });

  it("still parses closeSession frames", () => {
    const parsed = browserSessionsClientFrameSchema.safeParse(CLOSE_SESSION);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(CLOSE_SESSION);
    }
  });
});
