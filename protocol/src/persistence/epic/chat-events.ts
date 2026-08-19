import { z } from "zod";
import { guiHarnessIdSchema } from "@traycer/protocol/persistence/epic/foundation";
import {
  userMessageSenderSchema,
  userMessageSenderSchemaPreInReplyTo,
} from "@traycer/protocol/persistence/epic/senders";

/**
 * Durable chat event log - append-only record of state transitions a
 * chat went through, captured outside the streaming text envelope so
 * cloud-replicated history can render past activity without replaying
 * the runtime stream.
 */

export const chatEventTypeSchema = z.enum([
  "send.accepted",
  "send.failed",
  "queue.added",
  "queue.edited",
  "queue.reordered",
  "queue.cancelled",
  "queue.steerRequested",
  "queue.steerAborted",
  "queue.paused",
  "queue.resumed",
  "queue.started",
  "queue.steered",
  "queue.fallback",
  "turn.started",
  "turn.completed",
  "turn.stopped",
  "turn.interrupted",
  "approval.requested",
  "approval.resolved",
  "approval.denied",
  "approval.abandoned",
  "interview.requested",
  "interview.resolved",
  "interview.errored",
  "checkpoint.captured",
  "checkpoint.restoreStarted",
  "checkpoint.restored",
  "permission.blocked",
  "harness.error",
  "history.deleted",
  "chat.forked",
  "chat.imported",
  "setup.creating",
  "setup.running",
  "setup.succeeded",
  "setup.failed",
  "setup.cancelled",
  "worktree.missing",
]);
export type ChatEventType = z.infer<typeof chatEventTypeSchema>;

export const chatEventSeveritySchema = z.enum(["info", "warning", "error"]);
export type ChatEventSeverity = z.infer<typeof chatEventSeveritySchema>;

export const chatEventSchema = z.object({
  eventId: z.string(),
  type: chatEventTypeSchema,
  timestamp: z.number(),
  clientActionId: z.string().nullable(),
  actor: userMessageSenderSchema.nullable(),
  message: z.string().nullable(),
  turnId: z.string().nullable(),
  messageId: z.string().nullable(),
  queueItemId: z.string().nullable(),
  approvalId: z.string().nullable(),
  blockId: z.string().nullable(),
  severity: chatEventSeveritySchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type ChatEvent = z.infer<typeof chatEventSchema>;

/**
 * Wire-freeze copy of the event-type enum WITHOUT `chat.imported`, bound to
 * every released `chat.subscribe` line (`1.0`–`1.5`).
 *
 * A `z.enum` is strict on both sides, so an added value is not additive on a
 * released host→client slot the way a nullable field is: a shipped client
 * parsing a chat that carries `chat.imported` would fail the WHOLE snapshot,
 * losing the transcript rather than one row. Session import ships on `1.6`, so
 * the released lines keep the enum they were released with and simply never
 * observe the event - which is correct, not merely safe: a client that cannot
 * render an import provenance row has nothing to do with the value anyway.
 *
 * Hand-frozen and NOT derived from `chatEventTypeSchema`, for the reason
 * `chatSchemaV14` gives: a released line that follows a live schema by
 * reference silently inherits every later addition.
 */
export const chatEventTypeSchemaPreImported = z.enum([
  "send.accepted",
  "send.failed",
  "queue.added",
  "queue.edited",
  "queue.reordered",
  "queue.cancelled",
  "queue.steerRequested",
  "queue.steerAborted",
  "queue.paused",
  "queue.resumed",
  "queue.started",
  "queue.steered",
  "queue.fallback",
  "turn.started",
  "turn.completed",
  "turn.stopped",
  "turn.interrupted",
  "approval.requested",
  "approval.resolved",
  "approval.denied",
  "approval.abandoned",
  "interview.requested",
  "interview.resolved",
  "interview.errored",
  "checkpoint.captured",
  "checkpoint.restoreStarted",
  "checkpoint.restored",
  "permission.blocked",
  "harness.error",
  "history.deleted",
  "chat.forked",
  "setup.creating",
  "setup.running",
  "setup.succeeded",
  "setup.failed",
  "setup.cancelled",
  "worktree.missing",
]);

// Wire-freeze copy with `actor` swapped for the pre-`inReplyTo` sender freeze,
// bound to `chat.subscribe@1.0–1.3` serverFrames (`eventAppended` + snapshot
// `chat.events`). Hand-frozen, not derived from the live shape. See
// `agentSenderSchemaPreInReplyTo`.
export const chatEventSchemaPreInReplyTo = z.object({
  eventId: z.string(),
  type: chatEventTypeSchemaPreImported,
  timestamp: z.number(),
  clientActionId: z.string().nullable(),
  actor: userMessageSenderSchemaPreInReplyTo.nullable(),
  message: z.string().nullable(),
  turnId: z.string().nullable(),
  messageId: z.string().nullable(),
  queueItemId: z.string().nullable(),
  approvalId: z.string().nullable(),
  blockId: z.string().nullable(),
  severity: chatEventSeveritySchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * Wire-freeze copy bound to `chat.subscribe@1.4–1.5`: the live sender tree
 * (`inReplyTo` shipped in `1.4`) with the pre-`chat.imported` type enum. See
 * {@link chatEventTypeSchemaPreImported} for why the enum is the half that has
 * to stay frozen.
 */
export const chatEventSchemaPreImported = z.object({
  eventId: z.string(),
  type: chatEventTypeSchemaPreImported,
  timestamp: z.number(),
  clientActionId: z.string().nullable(),
  actor: userMessageSenderSchema.nullable(),
  message: z.string().nullable(),
  turnId: z.string().nullable(),
  messageId: z.string().nullable(),
  queueItemId: z.string().nullable(),
  approvalId: z.string().nullable(),
  blockId: z.string().nullable(),
  severity: chatEventSeveritySchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * Typed reading of a `chat.imported` event's `metadata` bag.
 *
 * The event marks a chat that was materialized from a session the user ran in
 * a vendor CLI before Traycer ever saw it (session import). It is the chat's
 * only provenance record: the wizard writes it once as the chat's first event,
 * the transcript renders a system row from it, and the host's first-turn
 * context guard keys off it rather than off any resume-vs-fresh branch.
 *
 * `metadata` on `chatEventSchema` is an untyped bag on the wire (like every
 * other event's), so this schema is the parse contract both writer and readers
 * agree on rather than a wire shape. `sourceCwd` is the native session's own
 * working directory, kept even when that folder no longer exists - it is what
 * the row shows a user asking "where did this come from".
 */
export const chatImportedMetadataSchema = z.object({
  sourceProvider: guiHarnessIdSchema,
  nativeSessionId: z.string().min(1),
  importedAt: z.number(),
  sourceCwd: z.string(),
});
export type ChatImportedMetadata = z.infer<typeof chatImportedMetadataSchema>;
