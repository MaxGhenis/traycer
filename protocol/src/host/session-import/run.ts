/**
 * `sessionImport.run@1.0` - versioned streaming-RPC contract for importing a
 * wizard submission's worth of native sessions.
 *
 * One subscription per wizard submission. The host materializes each selected
 * session into a real epic + chat and reports one `progress` frame per
 * selection, in submission order.
 *
 * ## The run outlives the socket, deliberately
 *
 * Closing the WS does NOT abort the run - the opposite of `migration.run`,
 * whose loop watches its connection-scoped `RequestContext`. Import is a
 * background bring-over the user is explicitly told to walk away from (it runs
 * while the onboarding tour continues), so a closed tab, a reload, or a
 * quit-and-restart must not leave half a submission behind. Re-subscribing
 * ATTACHES to the run already in flight: the host replays `started` and every
 * `progress` frame it has produced so far, then continues live. A subscribe
 * that arrives while a run is active therefore ignores its own `selections` -
 * there is at most one run at a time, and `runId` is how a client tells the
 * run it is watching from the one it asked for.
 *
 * Resumability across a host restart is free rather than engineered: import is
 * idempotent per `(harness, nativeSessionId)` (the chat id is derived from the
 * pair), so re-submitting a partially-completed selection set re-imports
 * nothing and reports the finished ones as `skipped_already_imported`.
 *
 * There is no cancel in v1.
 *
 * Server frames:
 *
 * - `started`  - emitted once per subscription, including on re-attach.
 * - `progress` - one per selection, terminal for that selection.
 * - `complete` - terminal frame; carries the summary the wizard renders.
 * - `pong`     - heartbeat response.
 *
 * Client frames:
 *
 * - `ping` - heartbeat. No application client frames.
 */
import { z } from "zod";
import { defineStreamRpcContract } from "@traycer/protocol/framework/versioned-stream-rpc";
import { guiHarnessIdSchema } from "@traycer/protocol/persistence/epic/foundation";
import { sessionImportSelectionSchema } from "@traycer/protocol/host/session-import/candidate";

export const sessionImportRunOpenRequestSchema = z.object({
  selections: z.array(sessionImportSelectionSchema),
});
export type SessionImportRunOpenRequest = z.infer<
  typeof sessionImportRunOpenRequestSchema
>;

/**
 * Closed set of import failure causes, one per seam the import can fail at.
 *
 * Closed rather than free text so the completion summary can group failures
 * and the wizard can say something specific about each ("2 sessions could not
 * be read"). The free-text half lives in `detail`, which is for the human
 * reading it and is additionally logged host-side under a fixed prefix so a
 * support report carries it even when the wizard was closed.
 *
 * - `source_unreadable`     - the vendor's session file / database could not
 *                             be read at all: gone, unreadable, or corrupt.
 * - `source_empty`          - it read, but yielded no message worth a chat.
 * - `workspace_bind_failed` - the session's `cwd` could not be resolved to a
 *                             workspace (and folderless import also failed).
 * - `creation_failed`       - epic or chat creation / seeding failed.
 * - `internal_error`        - anything else; `detail` carries the message.
 */
export const sessionImportFailureReasonSchema = z.enum([
  "source_unreadable",
  "source_empty",
  "workspace_bind_failed",
  "creation_failed",
  "internal_error",
]);
export type SessionImportFailureReason = z.infer<
  typeof sessionImportFailureReasonSchema
>;

export const sessionImportOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("imported"),
    epicId: z.string(),
    chatId: z.string(),
  }),
  z.object({
    kind: z.literal("skipped_already_imported"),
    epicId: z.string(),
    chatId: z.string(),
  }),
  z.object({
    kind: z.literal("failed"),
    reason: sessionImportFailureReasonSchema,
    detail: z.string(),
  }),
]);
export type SessionImportOutcome = z.infer<typeof sessionImportOutcomeSchema>;

export const sessionImportRunCountsSchema = z.object({
  imported: z.number().int().nonnegative(),
  skippedAlreadyImported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type SessionImportRunCounts = z.infer<
  typeof sessionImportRunCountsSchema
>;

export const sessionImportRunServerFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("started"),
    runId: z.string(),
    total: z.number().int().nonnegative(),
    hasBinaryPayload: z.literal(false),
  }),
  z.object({
    kind: z.literal("progress"),
    runId: z.string(),
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    harness: guiHarnessIdSchema,
    nativeSessionId: z.string(),
    outcome: sessionImportOutcomeSchema,
    hasBinaryPayload: z.literal(false),
  }),
  z.object({
    kind: z.literal("complete"),
    runId: z.string(),
    counts: sessionImportRunCountsSchema,
    hasBinaryPayload: z.literal(false),
  }),
  z.object({
    kind: z.literal("pong"),
    hasBinaryPayload: z.literal(false),
  }),
]);
export type SessionImportRunServerFrame = z.infer<
  typeof sessionImportRunServerFrameSchema
>;

export const sessionImportRunClientFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ping"),
    hasBinaryPayload: z.literal(false),
  }),
]);
export type SessionImportRunClientFrame = z.infer<
  typeof sessionImportRunClientFrameSchema
>;

export const sessionImportRunV10 = defineStreamRpcContract({
  method: "sessionImport.run",
  schemaVersion: { major: 1, minor: 0 } as const,
  openRequestSchema: sessionImportRunOpenRequestSchema,
  serverFrameSchema: sessionImportRunServerFrameSchema,
  clientFrameSchema: sessionImportRunClientFrameSchema,
});
