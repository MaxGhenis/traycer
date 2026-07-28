import { describe, expect, it } from "vitest";
import {
  browserSessionsClientFrameSchema,
  browserSessionsServerFrameSchema,
  browserSessionsV13,
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

describe("browser.sessions@1.4 borrowed-tile attachment frames", () => {
  it("parses the attach and detach push frames (real parsing, not type-checking)", () => {
    expect(
      browserSessionsServerFrameSchema.safeParse(ATTACHED_FRAME).success,
    ).toBe(true);
    expect(
      browserSessionsServerFrameSchema.safeParse(DETACHED_FRAME).success,
    ).toBe(true);
  });

  it("requires expiresAt on an attach frame - an attachment without a lifetime is not a valid attachment", () => {
    const { expiresAt, ...withoutExpiry } = ATTACHED_FRAME;
    expect(typeof expiresAt).toBe("number");
    expect(
      browserSessionsServerFrameSchema.safeParse(withoutExpiry).success,
    ).toBe(false);
  });

  it("keeps the borrowed-tile kinds out of the frozen 1.3 contract - additivity is real, not assumed", () => {
    const newServerKinds = ["borrowedTileAttached", "borrowedTileDetached"];
    const v13ServerKinds: ReadonlySet<string> = new Set(
      browserSessionsV13.serverFrameSchema.def.options.map(
        (option): string => String(option.shape.kind.def.values[0]),
      ),
    );
    for (const kind of newServerKinds) {
      expect(
        v13ServerKinds.has(kind),
        `${kind} must not be in the frozen 1.3 schema`,
      ).toBe(false);
    }
    // The reverse direction, which is what "additive" actually promises: a
    // frame the frozen 1.3 contract already shipped still parses under 1.4.
    const frozenCdpSample = {
      kind: "cdpGetFrameTree",
      hasBinaryPayload: false,
      requestId: "request-1",
      tileInstanceId: "tile-1",
      sessionId: null,
    };
    expect(
      browserSessionsV13.serverFrameSchema.safeParse(frozenCdpSample).success,
    ).toBe(true);
    expect(
      browserSessionsServerFrameSchema.safeParse(frozenCdpSample).success,
    ).toBe(true);
  });

  it("advertises 1.4 as the negotiated latest minor with 1.0-1.3 still installed", () => {
    const line = hostStreamRpcRegistry["browser.sessions"][1];
    expect(line.latestMinor).toBe(4);
    expect(Object.keys(line.versions).sort()).toEqual(["0", "1", "2", "3", "4"]);
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
