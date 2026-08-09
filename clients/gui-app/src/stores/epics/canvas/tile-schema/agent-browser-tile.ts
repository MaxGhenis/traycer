/**
 * Schema + factory for the agent's own browser tile. Mirrors `browser-tile.ts`
 * minus `viewportPreset` - device-emulation chrome is a driving concern out
 * of scope until the agent's REPL surface (ticket 04+) exists.
 */
import { v4 as uuidv4 } from "uuid";
import type { DesktopJsonValue } from "@/lib/windows/types";
import { TILE_KIND_AGENT_BROWSER } from "../tile-kinds";
import type { AgentBrowserTileRef } from "../types";
import type { TileSchema } from "./index";
import { readTileInstanceId } from "./instance-id";

export const DEFAULT_AGENT_BROWSER_TILE_NAME = "Agent browser";
export const DEFAULT_AGENT_BROWSER_TILE_URL = "about:blank";

function agentBrowserTilePageSessionId(): string {
  return `agent-browser-${uuidv4()}`;
}

export function makeAgentBrowserTileRef(args: {
  readonly name: string;
  readonly hostId: string;
  readonly url: string;
  readonly sessionId: string | null;
}): AgentBrowserTileRef {
  const id = agentBrowserTilePageSessionId();
  return {
    id,
    sessionId: args.sessionId ?? id,
    instanceId: uuidv4(),
    type: TILE_KIND_AGENT_BROWSER,
    name: args.name,
    hostId: args.hostId,
    url: args.url,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAgentBrowserTileRef(value: unknown): AgentBrowserTileRef | null {
  if (!isRecord(value)) return null;
  if (
    value.type !== TILE_KIND_AGENT_BROWSER ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.hostId !== "string" ||
    typeof value.url !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : value.id,
    instanceId: readTileInstanceId(value.instanceId),
    type: TILE_KIND_AGENT_BROWSER,
    name: value.name,
    hostId: value.hostId,
    url: value.url,
  };
}

function serializeAgentBrowserTileRef(
  ref: AgentBrowserTileRef,
): DesktopJsonValue {
  return {
    id: ref.id,
    sessionId: ref.sessionId,
    instanceId: ref.instanceId,
    type: ref.type,
    name: ref.name,
    hostId: ref.hostId,
    url: ref.url,
  };
}

export const agentBrowserTileSchema: TileSchema<AgentBrowserTileRef> = {
  parse: parseAgentBrowserTileRef,
  serialize: serializeAgentBrowserTileRef,
  isRecordBacked: false,
};
