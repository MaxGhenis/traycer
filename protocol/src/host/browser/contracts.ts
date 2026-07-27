/**
 * `browser.sessions@1.0` and `browser.screencast@1.0` - browser V1 stream
 * contracts between the GUI and host-owned headless browser sessions.
 *
 * These are intentionally stream-only additions. Once shipped, both methods
 * stay on major 1 forever; future changes must be additive minors because the
 * stream transport has no cross-major bridge.
 */
import { z } from "zod";
import { defineStreamRpcContract } from "@traycer/protocol/framework/versioned-stream-rpc";

const textFrameFields = {
  hasBinaryPayload: z.literal(false),
} as const;

const binaryFrameFields = {
  hasBinaryPayload: z.literal(true),
} as const;

const requestFrameFields = {
  ...textFrameFields,
  requestId: z.string(),
} as const;

const browserSessionReferenceFields = {
  sessionId: z.string(),
} as const;

export const browserOriginTierSchema = z.enum(["dev", "external"]);
export type BrowserOriginTier = z.infer<typeof browserOriginTierSchema>;

export const browserSessionStatusSchema = z.enum([
  "provisioning",
  "ready",
  "navigating",
  "closing",
  "crashed",
]);
export type BrowserSessionStatus = z.infer<typeof browserSessionStatusSchema>;

export const browserSessionClosedReasonSchema = z.enum([
  "completed",
  "idle-ttl",
  "evicted",
  "crashed",
]);
export type BrowserSessionClosedReason = z.infer<
  typeof browserSessionClosedReasonSchema
>;

export const browserSessionInfoSchema = z.object({
  sessionId: z.string(),
  chatId: z.string(),
  hostId: z.string(),
  url: z.string(),
  originTier: browserOriginTierSchema,
  status: browserSessionStatusSchema,
  createdAt: z.number(),
  lastActivityAt: z.number(),
  title: z.string().nullable(),
});
export type BrowserSessionInfo = z.infer<typeof browserSessionInfoSchema>;

export const browserVisibleTileDataLevelSchema = z.enum([
  "console-entry",
  "network-request",
  "screenshot",
  "element",
  "debug-errors",
  "debug-snapshot",
  "control",
]);
export type BrowserVisibleTileDataLevel = z.infer<
  typeof browserVisibleTileDataLevelSchema
>;

const browserVisibleTileGrantSchemaV11 = z.object({
  chatId: z.string(),
  tileInstanceId: z.string(),
  origin: z.string(),
  dataLevel: browserVisibleTileDataLevelSchema,
  expiresAt: z.number(),
});

export const browserVisibleTileGrantSchema = browserVisibleTileGrantSchemaV11
  .extend({
    grantId: z.string(),
  })
  .strict();
export type BrowserVisibleTileGrant = z.infer<
  typeof browserVisibleTileGrantSchema
>;

export const browserVisibleTileActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    selector: z.string().min(1),
  }),
  z.object({
    kind: z.literal("type"),
    selector: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("scroll"),
    deltaX: z.number(),
    deltaY: z.number(),
  }),
  z.object({
    kind: z.literal("navigate"),
    url: z.string().min(1),
  }),
]);
export type BrowserVisibleTileAction = z.infer<
  typeof browserVisibleTileActionSchema
>;

export const browserSessionsOpenRequestSchema = z.object({
  chatId: z.string(),
});
export type BrowserSessionsOpenRequest = z.infer<
  typeof browserSessionsOpenRequestSchema
>;

const browserSessionsServerFrameSchemaV10 = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    ...textFrameFields,
    sessions: z.array(browserSessionInfoSchema),
  }),
  z.object({
    kind: z.literal("sessionCreated"),
    ...textFrameFields,
    session: browserSessionInfoSchema,
  }),
  z.object({
    kind: z.literal("sessionUpdated"),
    ...textFrameFields,
    session: browserSessionInfoSchema,
  }),
  z.object({
    kind: z.literal("sessionClosed"),
    ...textFrameFields,
    ...browserSessionReferenceFields,
    reason: browserSessionClosedReasonSchema,
  }),
  z.object({
    kind: z.literal("provisionProgress"),
    ...textFrameFields,
    phase: z.string(),
    bytesDownloaded: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("promoteState"),
    ...requestFrameFields,
    url: z.string(),
    // Opaque JSON blob (Playwright storageState). The protocol intentionally
    // does not structurally type this payload: tightening the field schema in a
    // later minor would be breaking, and streams cannot bump majors. The host
    // and GUI validate it at their own boundaries.
    storageState: z.json(),
  }),
  z.object({
    kind: z.literal("lendResult"),
    ...requestFrameFields,
    ok: z.boolean(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("actionAck"),
    ...requestFrameFields,
    ok: z.boolean(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("pong"),
    ...textFrameFields,
  }),
]);

const browserSessionsServerFrameSchemaV11 = z.discriminatedUnion("kind", [
  ...browserSessionsServerFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlRequest"),
    ...requestFrameFields,
    chatId: z.string(),
    agentRunId: z.string().nullable(),
    agentLabel: z.string(),
    tileInstanceId: z.string(),
    origin: z.string(),
    url: z.string().nullable(),
    requestedAt: z.number(),
    expiresAt: z.number(),
  }),
  z.object({
    kind: z.literal("visibleTileControlResult"),
    ...requestFrameFields,
    ok: z.boolean(),
    reason: z.string().nullable(),
    grant: browserVisibleTileGrantSchemaV11.nullable(),
  }),
]);

export const browserSessionsServerFrameSchema = z.discriminatedUnion("kind", [
  ...browserSessionsServerFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlRequest"),
    ...requestFrameFields,
    grantId: z.string(),
    chatId: z.string(),
    agentRunId: z.string().nullable(),
    agentLabel: z.string(),
    tileInstanceId: z.string(),
    origin: z.string(),
    url: z.string().nullable(),
    requestedAt: z.number(),
    expiresAt: z.number(),
  }),
  z.object({
    kind: z.literal("visibleTileControlResult"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    ok: z.boolean(),
    reason: z.string().nullable(),
    grant: browserVisibleTileGrantSchema.nullable(),
  }),
  z.object({
    kind: z.literal("visibleTileControlAction"),
    ...requestFrameFields,
    grantId: z.string(),
    tileInstanceId: z.string(),
    action: browserVisibleTileActionSchema,
    requestedAt: z.number(),
  }),
]);
export type BrowserSessionsServerFrame = z.infer<
  typeof browserSessionsServerFrameSchema
>;

const browserSessionsClientFrameSchemaV10 = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("getPromoteState"),
    ...requestFrameFields,
    ...browserSessionReferenceFields,
  }),
  z.object({
    kind: z.literal("lendStorage"),
    ...requestFrameFields,
    ...browserSessionReferenceFields,
    origin: z.string(),
    // Opaque JSON blob (Playwright storageState). The protocol intentionally
    // does not structurally type this payload: tightening the field schema in a
    // later minor would be breaking, and streams cannot bump majors. The host
    // and GUI validate it at their own boundaries.
    storage: z.json(),
  }),
  z.object({
    kind: z.literal("closeSession"),
    ...requestFrameFields,
    ...browserSessionReferenceFields,
  }),
  z.object({
    kind: z.literal("ping"),
    ...textFrameFields,
  }),
]);

const browserSessionsClientFrameSchemaV11 = z.discriminatedUnion("kind", [
  ...browserSessionsClientFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlDecision"),
    ...requestFrameFields,
    approved: z.boolean(),
    grant: browserVisibleTileGrantSchemaV11.nullable(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("visibleTileControlRevoked"),
    ...requestFrameFields,
    tileInstanceId: z.string(),
    reason: z.string(),
  }),
]);

export const browserSessionsClientFrameSchema = z.discriminatedUnion("kind", [
  ...browserSessionsClientFrameSchemaV10.def.options,
  z.object({
    kind: z.literal("visibleTileControlDecision"),
    ...requestFrameFields,
    approved: z.boolean(),
    grant: browserVisibleTileGrantSchema.nullable(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("visibleTileControlRevoked"),
    ...requestFrameFields,
    grantId: z.string(),
    tileInstanceId: z.string(),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal("visibleTileControlActionResult"),
    ...requestFrameFields,
    grantId: z.string(),
    ok: z.boolean(),
    reason: z.string().nullable(),
    value: z.unknown().nullable(),
  }),
]);
export type BrowserSessionsClientFrame = z.infer<
  typeof browserSessionsClientFrameSchema
>;

export const browserSessionsV12 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 2 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchema,
  clientFrameSchema: browserSessionsClientFrameSchema,
});

export const browserSessionsV11 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 1 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchemaV11,
  clientFrameSchema: browserSessionsClientFrameSchemaV11,
});

export const browserSessionsV10 = defineStreamRpcContract({
  method: "browser.sessions",
  schemaVersion: { major: 1, minor: 0 } as const,
  openRequestSchema: browserSessionsOpenRequestSchema,
  serverFrameSchema: browserSessionsServerFrameSchemaV10,
  clientFrameSchema: browserSessionsClientFrameSchemaV10,
});

export const browserScreencastFormatSchema = z.enum(["jpeg"]);
export type BrowserScreencastFormat = z.infer<
  typeof browserScreencastFormatSchema
>;

export const browserScreencastOpenRequestSchema = z.object({
  sessionId: z.string(),
  maxWidth: z.number().int().positive(),
  maxHeight: z.number().int().positive(),
  quality: z.number().int().min(0).max(100),
  format: browserScreencastFormatSchema,
});
export type BrowserScreencastOpenRequest = z.infer<
  typeof browserScreencastOpenRequestSchema
>;

export const browserScreencastMetadataSchema = z.object({
  offsetTop: z.number(),
  pageScaleFactor: z.number(),
  deviceWidth: z.number(),
  deviceHeight: z.number(),
  scrollOffsetX: z.number(),
  scrollOffsetY: z.number(),
  timestamp: z.number(),
});
export type BrowserScreencastMetadata = z.infer<
  typeof browserScreencastMetadataSchema
>;

export const browserScreencastServerFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("started"),
    ...textFrameFields,
    frameWidth: z.number().int().positive(),
    frameHeight: z.number().int().positive(),
    deviceScaleFactor: z.number().positive(),
  }),
  z.object({
    kind: z.literal("frame"),
    ...binaryFrameFields,
    sequence: z.number().int().nonnegative(),
    metadata: browserScreencastMetadataSchema,
  }),
  z.object({
    kind: z.literal("stalled"),
    ...textFrameFields,
  }),
  z.object({
    kind: z.literal("resized"),
    ...textFrameFields,
    frameWidth: z.number().int().positive(),
    frameHeight: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("failed"),
    ...textFrameFields,
    reason: z.string(),
  }),
  z.object({
    kind: z.literal("complete"),
    ...textFrameFields,
  }),
  z.object({
    kind: z.literal("pong"),
    ...textFrameFields,
  }),
]);
export type BrowserScreencastServerFrame = z.infer<
  typeof browserScreencastServerFrameSchema
>;

export const browserScreencastClientFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ack"),
    ...textFrameFields,
    sequence: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("setPaused"),
    ...textFrameFields,
    paused: z.boolean(),
  }),
  z.object({
    kind: z.literal("setParams"),
    ...textFrameFields,
    maxWidth: z.number().int().positive(),
    maxHeight: z.number().int().positive(),
    quality: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal("ping"),
    ...textFrameFields,
  }),
]);
export type BrowserScreencastClientFrame = z.infer<
  typeof browserScreencastClientFrameSchema
>;

export const browserScreencastV10 = defineStreamRpcContract({
  method: "browser.screencast",
  schemaVersion: { major: 1, minor: 0 } as const,
  openRequestSchema: browserScreencastOpenRequestSchema,
  serverFrameSchema: browserScreencastServerFrameSchema,
  clientFrameSchema: browserScreencastClientFrameSchema,
});
