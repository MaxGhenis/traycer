/**
 * Schema + factory for browser tiles. Browser `id` is a page-session identity
 * minted independently from `url`; the URL is mutable tile state and must not
 * participate in dedup identity.
 */
import { v4 as uuidv4 } from "uuid";
import type { DesktopJsonValue } from "@/lib/windows/types";
import {
  TILE_KIND_BROWSER,
  TILE_KIND_BROWSER_PEEK,
  TILE_KIND_BROWSER_SESSION,
} from "../tile-kinds";
import type {
  BrowserPeekTileRef,
  BrowserSessionTileRef,
  BrowserTileRef,
} from "../types";
import type { TileSchema } from "./index";
import { readTileInstanceId } from "./instance-id";

export const DEFAULT_BROWSER_TILE_NAME = "New browser";
export const DEFAULT_BROWSER_TILE_URL = "about:blank";
export const DEFAULT_BROWSER_VIEWPORT_PRESET = "responsive";

function browserTilePageSessionId(): string {
  return `browser-${uuidv4()}`;
}

export function makeBrowserTileRef(args: {
  readonly name: string;
  readonly hostId: string;
  readonly url: string;
  readonly viewportPreset: string;
}): BrowserTileRef {
  return {
    id: browserTilePageSessionId(),
    instanceId: uuidv4(),
    type: TILE_KIND_BROWSER,
    name: args.name,
    hostId: args.hostId,
    url: args.url,
    viewportPreset: args.viewportPreset,
  };
}

export function cloneBrowserTileForNewPageSession(
  ref: BrowserTileRef,
  instanceId: string,
): BrowserTileRef {
  return {
    ...ref,
    id: browserTilePageSessionId(),
    instanceId,
  };
}

export function makeBrowserPeekTileRef(args: {
  readonly name: string;
  readonly hostId: string;
  readonly chatId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly initialUrl: string;
}): BrowserPeekTileRef {
  return {
    id: `browser-peek-${args.sessionId}`,
    instanceId: uuidv4(),
    type: TILE_KIND_BROWSER_PEEK,
    name: args.name,
    hostId: args.hostId,
    chatId: args.chatId,
    sessionId: args.sessionId,
    tabId: args.tabId,
    initialUrl: args.initialUrl,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBrowserTileRef(value: unknown): BrowserTileRef | null {
  if (!isRecord(value)) return null;
  if (
    value.type !== TILE_KIND_BROWSER ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.hostId !== "string" ||
    typeof value.url !== "string" ||
    typeof value.viewportPreset !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    instanceId: readTileInstanceId(value.instanceId),
    type: TILE_KIND_BROWSER,
    name: value.name,
    hostId: value.hostId,
    url: value.url,
    viewportPreset: value.viewportPreset,
  };
}

function serializeBrowserTileRef(ref: BrowserTileRef): DesktopJsonValue {
  return {
    id: ref.id,
    instanceId: ref.instanceId,
    type: ref.type,
    name: ref.name,
    hostId: ref.hostId,
    url: ref.url,
    viewportPreset: ref.viewportPreset,
  };
}

export const browserTileSchema: TileSchema<BrowserTileRef> = {
  parse: parseBrowserTileRef,
  serialize: serializeBrowserTileRef,
  isRecordBacked: false,
};

function parseBrowserPeekTileRef(value: unknown): BrowserPeekTileRef | null {
  if (!isRecord(value)) return null;
  if (
    value.type !== TILE_KIND_BROWSER_PEEK ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.hostId !== "string" ||
    typeof value.chatId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.initialUrl !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    instanceId: readTileInstanceId(value.instanceId),
    type: TILE_KIND_BROWSER_PEEK,
    name: value.name,
    hostId: value.hostId,
    chatId: value.chatId,
    sessionId: value.sessionId,
    tabId: typeof value.tabId === "string" ? value.tabId : value.sessionId,
    initialUrl: value.initialUrl,
  };
}

function serializeBrowserPeekTileRef(
  ref: BrowserPeekTileRef,
): DesktopJsonValue {
  return {
    id: ref.id,
    instanceId: ref.instanceId,
    type: ref.type,
    name: ref.name,
    hostId: ref.hostId,
    chatId: ref.chatId,
    sessionId: ref.sessionId,
    tabId: ref.tabId,
    initialUrl: ref.initialUrl,
  };
}

export const browserPeekTileSchema: TileSchema<BrowserPeekTileRef> = {
  parse: parseBrowserPeekTileRef,
  serialize: serializeBrowserPeekTileRef,
  isRecordBacked: false,
};

export function makeBrowserSessionTileRef(args: {
  readonly name: string;
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
}): BrowserSessionTileRef {
  return {
    id: `browser-session:${args.sessionId}:${args.tabId}`,
    instanceId: uuidv4(),
    type: TILE_KIND_BROWSER_SESSION,
    name: args.name,
    hostId: args.hostId,
    sessionId: args.sessionId,
    tabId: args.tabId,
  };
}

function parseBrowserSessionTileRef(
  value: unknown,
): BrowserSessionTileRef | null {
  if (!isRecord(value)) return null;
  if (
    value.type !== TILE_KIND_BROWSER_SESSION ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.hostId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.tabId !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    instanceId: readTileInstanceId(value.instanceId),
    type: TILE_KIND_BROWSER_SESSION,
    name: value.name,
    hostId: value.hostId,
    sessionId: value.sessionId,
    tabId: value.tabId,
  };
}

function serializeBrowserSessionTileRef(
  ref: BrowserSessionTileRef,
): DesktopJsonValue {
  return {
    id: ref.id,
    instanceId: ref.instanceId,
    type: ref.type,
    name: ref.name,
    hostId: ref.hostId,
    sessionId: ref.sessionId,
    tabId: ref.tabId,
  };
}

export const browserSessionTileSchema: TileSchema<BrowserSessionTileRef> = {
  parse: parseBrowserSessionTileRef,
  serialize: serializeBrowserSessionTileRef,
  isRecordBacked: false,
};
