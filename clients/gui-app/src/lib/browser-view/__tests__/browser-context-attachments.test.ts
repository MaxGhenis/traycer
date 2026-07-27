import { describe, expect, it } from "vitest";

import {
  createBrowserConsoleAttachment,
  createBrowserElementAttachment,
  createBrowserNetworkAttachment,
  createBrowserScreenshotAttachment,
  mintBrowserObserveGrant,
  registerBrowserContextAttachmentHandler,
  requestBrowserContextAttachment,
} from "../browser-context-attachments";
import type {
  BrowserViewCapturePageResult,
  BrowserViewConsoleEntry,
  BrowserViewElementCapture,
  BrowserViewNetworkEntry,
  BrowserViewTileKey,
} from "../desktop-browser-view";

const TILE: BrowserViewTileKey = {
  viewTabId: "view-tab",
  paneId: "pane",
  tileInstanceId: "tile",
  pageSessionId: "page",
};

const CONSOLE_ENTRY: BrowserViewConsoleEntry = {
  id: "console-1",
  timestamp: 1000,
  source: "console-api",
  level: "error",
  text: "boom",
  url: "http://localhost:3000/app.js",
  lineNumber: 4,
  columnNumber: 2,
  stackTrace: [],
};

const NETWORK_ENTRY: BrowserViewNetworkEntry = {
  id: "root:request-1",
  requestId: "request-1",
  url: "http://localhost:3000/api",
  method: "POST",
  resourceType: "Fetch",
  status: "failed",
  statusCode: null,
  statusText: null,
  mimeType: null,
  fromCache: false,
  startedAt: 1000,
  completedAt: 1200,
  durationMs: 200,
  encodedDataLength: null,
  failureText: "net::ERR_FAILED",
};

const CAPTURE: BrowserViewCapturePageResult = {
  ...TILE,
  mediaType: "image/png",
  base64: "aGVsbG8=",
  byteLength: 5,
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  capturedAt: 2000,
};

describe("browser context attachment payloads", () => {
  it("packages console rows with an explicit observe grant request", () => {
    const payload = createBrowserConsoleAttachment({
      tile: TILE,
      pageUrl: "http://localhost:3000/page",
      entry: CONSOLE_ENTRY,
    });

    expect(payload).toMatchObject({
      schemaVersion: 1,
      kind: "browser-console-entry",
      observeGrantRequest: {
        kind: "visible-browser-observe-grant-request",
        chatId: null,
        tileInstanceId: "tile",
        origin: "http://localhost:3000",
        dataLevel: "console-entry",
        sourceAction: "browser-console-row-send",
      },
      consoleEntry: CONSOLE_ENTRY,
    });
    expect(payload.composerText).toContain("Browser console entry");
    expect(payload.composerText).toContain("boom");
  });

  it("packages network rows as request summaries", () => {
    const payload = createBrowserNetworkAttachment({
      tile: TILE,
      pageUrl: "http://localhost:3000/page",
      entry: NETWORK_ENTRY,
    });

    expect(payload.kind).toBe("browser-network-request");
    expect(payload.observeGrantRequest.dataLevel).toBe("network-request");
    expect(payload.composerText).toContain("POST http://localhost:3000/api");
    expect(payload.composerText).toContain("net::ERR_FAILED");
  });

  it("uses the screenshot hash as the attachment map key", () => {
    const payload = createBrowserScreenshotAttachment({
      tile: TILE,
      pageUrl: "http://localhost:3000/page",
      capture: CAPTURE,
    });

    expect(payload.kind).toBe("browser-screenshot");
    expect(payload.screenshot).toMatchObject({
      hash: CAPTURE.sha256,
      attachmentsMapKey: CAPTURE.sha256,
      base64: CAPTURE.base64,
      byteLength: CAPTURE.byteLength,
      name: `browser-screenshot-${CAPTURE.sha256.slice(0, 12)}.png`,
    });
  });

  it("mints a chat-scoped visible-tile observe grant from trusted payload state", () => {
    const payload = createBrowserScreenshotAttachment({
      tile: TILE,
      pageUrl: "http://localhost:3000/page",
      capture: CAPTURE,
    });

    const granted = mintBrowserObserveGrant(payload, {
      chatId: "chat-1",
      expiresAt: 3000,
    });

    expect(granted.observeGrant).toEqual({
      kind: "visible-browser-observe-grant",
      chatId: "chat-1",
      tileInstanceId: "tile",
      origin: "http://localhost:3000",
      dataLevel: "screenshot",
      expiresAt: 3000,
    });
    expect(granted.observeGrantRequest).toMatchObject({
      chatId: "chat-1",
      expiresAt: 3000,
    });
  });

  it("returns unhandled until ticket 12 registers the composer handler", async () => {
    const payload = createBrowserConsoleAttachment({
      tile: TILE,
      pageUrl: "http://localhost:3000/page",
      entry: CONSOLE_ENTRY,
    });

    await expect(
      requestBrowserContextAttachment(payload, { targetChatId: "chat-1" }),
    ).resolves.toMatchObject({
      status: "unhandled",
      reason: "ticket-12-handler-not-registered",
    });

    const registration = registerBrowserContextAttachmentHandler((next) => ({
      status: "attached",
      payload: next.payload,
    }));
    await expect(
      requestBrowserContextAttachment(payload, { targetChatId: "chat-1" }),
    ).resolves.toMatchObject({
      status: "attached",
      payload,
    });
    registration.dispose();
  });
});

const ELEMENT: BrowserViewElementCapture = {
  selector: "main > button#submit",
  tagName: "button",
  elementId: "submit",
  classNames: ["btn", "btn-primary"],
  attributes: [
    { name: "id", value: "submit" },
    { name: "type", value: "submit" },
  ],
  outerHtml: '<button id="submit" type="submit">Save</button>',
  outerHtmlTruncated: false,
  textPreview: "Save",
  ariaRole: "button",
  accessibleName: "Save",
  boundingBox: {
    x: 12,
    y: 40,
    width: 80,
    height: 32,
    top: 40,
    right: 92,
    bottom: 72,
    left: 12,
  },
  computedStyles: [
    { property: "display", value: "inline-flex" },
    { property: "color", value: "rgb(255, 255, 255)" },
  ],
};

describe("browser element attachment", () => {
  it("packages a picked element with an explicit observe grant request", () => {
    const payload = createBrowserElementAttachment({
      tile: TILE,
      pageUrl: "http://localhost:3000/page",
      element: ELEMENT,
    });

    expect(payload).toMatchObject({
      schemaVersion: 1,
      kind: "browser-element",
      observeGrantRequest: {
        kind: "visible-browser-observe-grant-request",
        chatId: null,
        tileInstanceId: "tile",
        origin: "http://localhost:3000",
        dataLevel: "element",
        sourceAction: "browser-element-send",
      },
      element: ELEMENT,
    });
    expect(payload.composerText).toContain("Selector: main > button#submit");
    expect(payload.composerText).toContain("Role: button");
    expect(payload.composerText).toContain("display: inline-flex");
    expect(payload.composerText).toContain("Save");
  });

  it("marks truncated outer HTML in the composer text", () => {
    const payload = createBrowserElementAttachment({
      tile: TILE,
      pageUrl: "http://localhost:3000/page",
      element: { ...ELEMENT, outerHtmlTruncated: true },
    });
    expect(payload.composerText).toContain("… (truncated)");
  });
});
