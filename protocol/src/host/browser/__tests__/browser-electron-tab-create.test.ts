import { describe, expect, it } from "vitest";
import {
  browserSessionsClientFrameSchema,
  browserSessionsServerFrameSchema,
} from "@traycer/protocol/host/browser/contracts";

const CREATE_REQUEST = {
  kind: "createElectronTab",
  hasBinaryPayload: false,
  requestId: "req-create-1",
  sessionId: "session-1",
  sourceTabId: "tab-source-1",
  url: "https://example.com/agent",
} as const;

const CREATE_BACKGROUND_WITH_STORAGE = {
  ...CREATE_REQUEST,
  background: true,
  seedStorageState: { cookies: [], origins: [] },
} as const;

const RELEASE_REQUEST = {
  kind: "releaseElectronTab",
  hasBinaryPayload: false,
  requestId: "req-release-1",
  sessionId: "session-1",
  tabId: "tab-minted-9",
} as const;

const CREATED_OK = {
  kind: "electronTabCreated",
  hasBinaryPayload: false,
  requestId: "req-create-1",
  sessionId: "session-1",
  tabId: "tab-minted-9",
  reason: null,
} as const;

const CREATED_FAILED = {
  kind: "electronTabCreated",
  hasBinaryPayload: false,
  requestId: "req-create-1",
  sessionId: "session-1",
  tabId: null,
  reason: "The source browser tile is no longer available.",
} as const;

describe("browser.sessions createElectronTab / electronTabCreated (ticket 14)", () => {
  it("parses createElectronTab request frames", () => {
    const parsed = browserSessionsServerFrameSchema.safeParse(CREATE_REQUEST);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(CREATE_REQUEST);
    }
  });

  it("parses background create frames with the primary-store seed", () => {
    const parsed = browserSessionsServerFrameSchema.safeParse(
      CREATE_BACKGROUND_WITH_STORAGE,
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(CREATE_BACKGROUND_WITH_STORAGE);
    }
  });

  it("parses releaseElectronTab request frames", () => {
    const parsed = browserSessionsServerFrameSchema.safeParse(RELEASE_REQUEST);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(RELEASE_REQUEST);
  });

  it("rejects createElectronTab missing sourceTabId or url", () => {
    const { sourceTabId: _sourceTabId, ...withoutSource } = CREATE_REQUEST;
    const { url: _url, ...withoutUrl } = CREATE_REQUEST;
    expect(
      browserSessionsServerFrameSchema.safeParse(withoutSource).success,
    ).toBe(false);
    expect(browserSessionsServerFrameSchema.safeParse(withoutUrl).success).toBe(
      false,
    );
  });

  it("parses electronTabCreated success and null/reason failure acks", () => {
    expect(browserSessionsClientFrameSchema.safeParse(CREATED_OK).success).toBe(
      true,
    );
    expect(
      browserSessionsClientFrameSchema.safeParse(CREATED_FAILED).success,
    ).toBe(true);
  });

  it("rejects electronTabCreated without tabId/reason fields", () => {
    const { tabId: _tabId, ...withoutTabId } = CREATED_OK;
    const { reason: _reason, ...withoutReason } = CREATED_OK;
    expect(
      browserSessionsClientFrameSchema.safeParse(withoutTabId).success,
    ).toBe(false);
    expect(
      browserSessionsClientFrameSchema.safeParse(withoutReason).success,
    ).toBe(false);
  });
});
