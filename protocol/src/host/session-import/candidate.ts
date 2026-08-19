/**
 * The shapes `sessionImport.scan` and `sessionImport.run` both speak: one
 * native session the user could bring into Traycer, and the repo folder it
 * was run in.
 *
 * Kept in its own module because the scan describes candidates and the run
 * consumes selections of them - two contracts, one vocabulary, and a drift
 * between them would show up as a wizard that cannot name what it submits.
 */
import { z } from "zod";
import { guiHarnessIdSchema } from "@traycer/protocol/persistence/epic/foundation";

/**
 * Identifies one native session end to end. `(harness, nativeSessionId)` is
 * the import's idempotency key: the chat a session materializes into has a
 * deterministic id derived from this pair, so re-running the wizard over the
 * same session finds the existing chat instead of making a second one.
 */
export const sessionImportSelectionSchema = z.object({
  harness: guiHarnessIdSchema,
  nativeSessionId: z.string().min(1),
});
export type SessionImportSelection = z.infer<
  typeof sessionImportSelectionSchema
>;

/**
 * Why a discovered session cannot be offered as-is.
 *
 * `already_in_traycer` names the chat it landed in so the wizard can link to
 * it rather than just greying the row out; the epic is what the left list
 * navigates to.
 */
export const sessionImportCandidateStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("importable") }),
  z.object({
    kind: z.literal("already_in_traycer"),
    epicId: z.string(),
    chatId: z.string(),
  }),
  z.object({ kind: z.literal("unreadable"), reason: z.string() }),
]);
export type SessionImportCandidateState = z.infer<
  typeof sessionImportCandidateStateSchema
>;

/**
 * One row in the wizard, described from the native session's own metadata.
 *
 * Everything here is cheap to read: the scan deliberately never parses a
 * transcript (that happens once, at import). `messageCount` is therefore
 * nullable - some providers publish it in an index, others would need the
 * full file - and the wizard renders the row without a count rather than
 * paying for one.
 */
export const sessionImportCandidateSchema = z.object({
  harness: guiHarnessIdSchema,
  nativeSessionId: z.string().min(1),
  title: z.string().nullable(),
  firstPrompt: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messageCount: z.number().int().nonnegative().nullable(),
  hasSubagents: z.boolean(),
  state: sessionImportCandidateStateSchema,
});
export type SessionImportCandidate = z.infer<
  typeof sessionImportCandidateSchema
>;

/**
 * Where a group of sessions was run.
 *
 * `missing_folder` is a first-class location rather than a flag, because the
 * wizard treats it as one: those sessions still import, just without a
 * workspace, and the group carries the warning marker. The path is kept
 * either way - it is the only human-readable name that group has.
 *
 * `workspaceId` is null for a folder Traycer does not know yet; the import
 * decides whether to adopt it as a workspace, so the wizard does not have to
 * expose that mapping.
 */
export const sessionImportGroupLocationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("folder"),
    path: z.string(),
    workspaceId: z.string().nullable(),
  }),
  z.object({ kind: z.literal("missing_folder"), path: z.string() }),
]);
export type SessionImportGroupLocation = z.infer<
  typeof sessionImportGroupLocationSchema
>;

export const sessionImportGroupSchema = z.object({
  location: sessionImportGroupLocationSchema,
  sessions: z.array(sessionImportCandidateSchema),
});
export type SessionImportGroup = z.infer<typeof sessionImportGroupSchema>;
