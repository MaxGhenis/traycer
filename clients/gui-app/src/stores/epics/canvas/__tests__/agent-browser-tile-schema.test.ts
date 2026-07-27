import { describe, expect, it } from "vitest";
import {
  parseTileRef,
  serializeTileRef,
} from "@/stores/epics/canvas/tile-schema";
import {
  DEFAULT_AGENT_BROWSER_TILE_NAME,
  DEFAULT_AGENT_BROWSER_TILE_URL,
  agentBrowserTileSchema,
  makeAgentBrowserTileRef,
} from "@/stores/epics/canvas/tile-schema/agent-browser-tile";
import { TILE_KIND_AGENT_BROWSER } from "@/stores/epics/canvas/tile-kinds";
import {
  isAgentBrowserTileRef,
  type AgentBrowserTileRef,
  type BrowserTileRef,
  type EpicCanvasTileRef,
} from "@/stores/epics/canvas/types";

const HOST = "host-1";

describe("makeAgentBrowserTileRef", () => {
  it("mints agent-browser page-session ids independently from URL", () => {
    const url = "https://example.com/app";
    const first = makeAgentBrowserTileRef({
      name: "Agent browser",
      hostId: HOST,
      url,
    });
    const second = makeAgentBrowserTileRef({
      name: "Agent browser",
      hostId: HOST,
      url,
    });

    expect(first.type).toBe(TILE_KIND_AGENT_BROWSER);
    expect(first.id).toMatch(/^agent-browser-/);
    expect(second.id).toMatch(/^agent-browser-/);
    expect(first.id).not.toBe(second.id);
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.url).toBe(url);
    expect(first).not.toHaveProperty("viewportPreset");
  });

  it("exposes the ticket defaults for name and blank URL", () => {
    expect(DEFAULT_AGENT_BROWSER_TILE_NAME).toBe("Agent browser");
    expect(DEFAULT_AGENT_BROWSER_TILE_URL).toBe("about:blank");
  });
});

describe("agentBrowserTileSchema / parseTileRef", () => {
  it("round-trips an agent browser ref", () => {
    const ref: AgentBrowserTileRef = {
      id: "agent-browser-session-1",
      instanceId: "inst-agent-browser-1",
      type: TILE_KIND_AGENT_BROWSER,
      name: "Agent browser",
      hostId: HOST,
      url: "https://example.com/docs",
    };

    expect(
      agentBrowserTileSchema.parse(agentBrowserTileSchema.serialize(ref)),
    ).toEqual(ref);
    expect(parseTileRef(serializeTileRef(ref))).toEqual(ref);
  });

  it("rejects a payload with the wrong type", () => {
    const browserShaped = {
      id: "browser-session-1",
      instanceId: "inst-browser-1",
      type: "browser",
      name: "Docs",
      hostId: HOST,
      url: "https://example.com/docs",
    };
    expect(agentBrowserTileSchema.parse(browserShaped)).toBeNull();

    // A full browser ref still parses via the registry as browser, not agent.
    const browserRef: BrowserTileRef = {
      ...browserShaped,
      type: "browser",
      viewportPreset: "responsive",
    };
    const parsed = parseTileRef(serializeTileRef(browserRef));
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("browser");
    expect(isAgentBrowserTileRef(parsed as EpicCanvasTileRef)).toBe(false);
  });

  it("rejects malformed agent browser refs", () => {
    const base = {
      id: "agent-browser-session-bad",
      instanceId: "inst-agent-browser-bad",
      type: TILE_KIND_AGENT_BROWSER,
      name: "Agent browser",
      hostId: HOST,
      url: "https://example.com",
    };
    expect(agentBrowserTileSchema.parse({ ...base, hostId: 42 })).toBeNull();
    expect(agentBrowserTileSchema.parse({ ...base, url: {} })).toBeNull();
    expect(agentBrowserTileSchema.parse({ ...base, name: null })).toBeNull();
    expect(
      agentBrowserTileSchema.parse({
        instanceId: "inst-agent-browser-missing-id",
        type: TILE_KIND_AGENT_BROWSER,
        name: "Agent browser",
        hostId: HOST,
        url: "https://example.com",
      }),
    ).toBeNull();
  });
});

describe("isAgentBrowserTileRef", () => {
  it("narrows only agent-browser tiles", () => {
    const agent: AgentBrowserTileRef = {
      id: "agent-browser-1",
      instanceId: "inst-1",
      type: TILE_KIND_AGENT_BROWSER,
      name: "Agent browser",
      hostId: HOST,
      url: "about:blank",
    };
    const browser: BrowserTileRef = {
      id: "browser-1",
      instanceId: "inst-2",
      type: "browser",
      name: "Browser",
      hostId: HOST,
      url: "about:blank",
      viewportPreset: "responsive",
    };
    const chat = {
      id: "chat-1",
      instanceId: "inst-3",
      type: "chat" as const,
      name: "Chat",
      hostId: HOST,
    };

    expect(isAgentBrowserTileRef(agent)).toBe(true);
    expect(isAgentBrowserTileRef(browser)).toBe(false);
    expect(isAgentBrowserTileRef(chat)).toBe(false);
  });
});
