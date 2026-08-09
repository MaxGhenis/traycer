import { describe, expect, it } from "vitest";
import {
  browserSessionsClientFrameSchema,
  browserSessionsServerFrameSchema,
  browserSessionsV1,
} from "@traycer/protocol/host/browser/contracts";
import { hostStreamRpcRegistry } from "@traycer/protocol/host/index";

const ATTACHED_FRAME = {
  kind: "borrowedTileAttached",
  hasBinaryPayload: false,
  requestId: "notif-1",
  tileInstanceId: "tile-1",
  attachmentId: "attachment-1",
  chatId: "chat-1",
  agentRunId: "run-1",
  agentLabel: "Claude",
  attachedAt: 1_000,
  expiresAt: 61_000,
};

const DETACHED_FRAME = {
  kind: "borrowedTileDetached",
  hasBinaryPayload: false,
  requestId: "notif-2",
  tileInstanceId: "tile-1",
  attachmentId: "attachment-1",
  reason: "User detached the agent from this tab.",
};

describe("browser.sessions@1.0 borrowed-tile attachment frames", () => {
  it("parses the attach and detach push frames (real parsing, not type-checking)", () => {
    expect(
      browserSessionsServerFrameSchema.safeParse(ATTACHED_FRAME).success,
    ).toBe(true);
    expect(
      browserSessionsServerFrameSchema.safeParse(DETACHED_FRAME).success,
    ).toBe(true);
    expect(
      browserSessionsV1.serverFrameSchema.safeParse(ATTACHED_FRAME).success,
    ).toBe(true);
  });

  it("requires expiresAt on an attach frame - an attachment without a lifetime is not a valid attachment", () => {
    const { expiresAt, ...withoutExpiry } = ATTACHED_FRAME;
    expect(typeof expiresAt).toBe("number");
    expect(
      browserSessionsServerFrameSchema.safeParse(withoutExpiry).success,
    ).toBe(false);
  });

  it("advertises 1.0 as the negotiated latest minor of the collapsed baseline", () => {
    const line = hostStreamRpcRegistry["browser.sessions"][1];
    expect(line.latestMinor).toBe(0);
    expect(Object.keys(line.versions).sort()).toEqual(["0"]);
    expect(line.versions[0]?.contract).toBe(browserSessionsV1);
  });

  it("adds no tile enumeration frame - the agent reaches the tile the user named and nothing else", () => {
    const serverKinds = browserSessionsServerFrameSchema.def.options.map(
      (option): string => String(option.shape.kind.def.values[0]),
    );
    const clientKinds = browserSessionsClientFrameSchema.def.options.map(
      (option): string => String(option.shape.kind.def.values[0]),
    );
    const enumerationShaped = [...serverKinds, ...clientKinds].filter((kind) =>
      /^(tiles|listTiles|borrowedTiles|browserTiles)/i.test(kind),
    );
    expect(enumerationShaped).toEqual([]);
  });
});
