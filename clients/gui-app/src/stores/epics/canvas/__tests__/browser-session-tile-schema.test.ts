import { describe, expect, it } from "vitest";
import {
  parseTileRef,
  serializeTileRef,
} from "@/stores/epics/canvas/tile-schema";
import {
  browserSessionTileSchema,
  makeBrowserSessionTileRef,
} from "@/stores/epics/canvas/tile-schema/browser-tile";
import { TILE_KIND_BROWSER_SESSION } from "@/stores/epics/canvas/tile-kinds";
import {
  isBrowserSessionTileRef,
  type BrowserSessionTileRef,
  type EpicCanvasTileRef,
} from "@/stores/epics/canvas/types";

const HOST = "host-1";

describe("makeBrowserSessionTileRef", () => {
  it("mints a deterministic pointer id from {sessionId, tabId}", () => {
    const first = makeBrowserSessionTileRef({
      name: "Docs",
      hostId: HOST,
      sessionId: "sess-a",
      tabId: "tab-1",
    });
    const second = makeBrowserSessionTileRef({
      name: "Docs again",
      hostId: HOST,
      sessionId: "sess-a",
      tabId: "tab-1",
    });

    expect(first.type).toBe(TILE_KIND_BROWSER_SESSION);
    expect(first.id).toBe("browser-session:sess-a:tab-1");
    expect(second.id).toBe(first.id);
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.sessionId).toBe("sess-a");
    expect(first.tabId).toBe("tab-1");
    expect(first).not.toHaveProperty("url");
    expect(first).not.toHaveProperty("chatId");
  });
});

describe("browserSessionTileSchema / parseTileRef", () => {
  it("round-trips a browser-session pointer ref", () => {
    const ref: BrowserSessionTileRef = {
      id: "browser-session:sess-1:tab-9",
      instanceId: "inst-1",
      type: TILE_KIND_BROWSER_SESSION,
      name: "Tab",
      hostId: HOST,
      sessionId: "sess-1",
      tabId: "tab-9",
    };

    expect(
      browserSessionTileSchema.parse(browserSessionTileSchema.serialize(ref)),
    ).toEqual(ref);
    expect(parseTileRef(serializeTileRef(ref))).toEqual(ref);
  });

  it("rejects missing sessionId or tabId", () => {
    const base = {
      id: "browser-session:sess-1:tab-1",
      instanceId: "inst-1",
      type: TILE_KIND_BROWSER_SESSION,
      name: "Tab",
      hostId: HOST,
      sessionId: "sess-1",
      tabId: "tab-1",
    };
    expect(
      browserSessionTileSchema.parse({ ...base, sessionId: undefined }),
    ).toBeNull();
    expect(browserSessionTileSchema.parse({ ...base, tabId: 42 })).toBeNull();
    expect(
      browserSessionTileSchema.parse({ ...base, type: "browser-peek" }),
    ).toBeNull();
  });
});

describe("isBrowserSessionTileRef", () => {
  it("narrows only browser-session tiles", () => {
    const pointer: BrowserSessionTileRef = {
      id: "browser-session:s:t",
      instanceId: "i",
      type: TILE_KIND_BROWSER_SESSION,
      name: "P",
      hostId: HOST,
      sessionId: "s",
      tabId: "t",
    };
    const peek = {
      id: "browser-peek-s",
      instanceId: "i2",
      type: "browser-peek" as const,
      name: "Peek",
      hostId: HOST,
      chatId: "chat",
      sessionId: "s",
      tabId: "t",
      initialUrl: "https://example.com",
    };

    expect(isBrowserSessionTileRef(pointer)).toBe(true);
    expect(isBrowserSessionTileRef(peek as EpicCanvasTileRef)).toBe(false);
  });
});
