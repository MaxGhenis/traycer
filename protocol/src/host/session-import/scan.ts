/**
 * `sessionImport.scan@1.0` - versioned streaming-RPC contract for discovering
 * the native CLI sessions a user could bring into Traycer.
 *
 * Subscribing makes the host read the vendors' own session directories
 * (`~/.claude/projects`, `~/.codex/sessions`, …) - the ONLY moment it ever
 * does; there is no background scanning. Reads are metadata-only and strictly
 * read-only: a scan never writes, moves, or deletes anything the vendor owns.
 *
 * Groups stream as they are resolved rather than arriving as one list, because
 * the first repo's sessions are useful to render while a large `~/.claude`
 * tree is still being walked, and because a provider that is slow or absent
 * must not hold up the ones that answered.
 *
 * Server frames:
 *
 * - `started`  - emitted once, before any directory is opened.
 * - `group`    - one repo folder's worth of candidates.
 * - `complete` - terminal frame; carries the totals the wizard's header shows.
 * - `pong`     - heartbeat response.
 *
 * Client frames:
 *
 * - `ping` - heartbeat. No application client frames.
 */
import { z } from "zod";
import { defineStreamRpcContract } from "@traycer/protocol/framework/versioned-stream-rpc";
import { guiHarnessIdSchema } from "@traycer/protocol/persistence/epic/foundation";
import { sessionImportGroupSchema } from "@traycer/protocol/host/session-import/candidate";

/**
 * `providers: null` scans every provider the host has a reader for - the
 * wizard's default. A non-empty list narrows it, which is what the per-
 * provider filter inside the wizard submits.
 */
export const sessionImportScanOpenRequestSchema = z.object({
  providers: z.array(guiHarnessIdSchema).nullable(),
});
export type SessionImportScanOpenRequest = z.infer<
  typeof sessionImportScanOpenRequestSchema
>;

const sessionImportScanTotalsSchema = z.object({
  groups: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  importable: z.number().int().nonnegative(),
  alreadyInTraycer: z.number().int().nonnegative(),
  unreadable: z.number().int().nonnegative(),
});
export type SessionImportScanTotals = z.infer<
  typeof sessionImportScanTotalsSchema
>;

export const sessionImportScanServerFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("started"),
    providers: z.array(guiHarnessIdSchema),
    hasBinaryPayload: z.literal(false),
  }),
  z.object({
    kind: z.literal("group"),
    group: sessionImportGroupSchema,
    hasBinaryPayload: z.literal(false),
  }),
  z.object({
    kind: z.literal("complete"),
    totals: sessionImportScanTotalsSchema,
    hasBinaryPayload: z.literal(false),
  }),
  z.object({
    kind: z.literal("pong"),
    hasBinaryPayload: z.literal(false),
  }),
]);
export type SessionImportScanServerFrame = z.infer<
  typeof sessionImportScanServerFrameSchema
>;

export const sessionImportScanClientFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ping"),
    hasBinaryPayload: z.literal(false),
  }),
]);
export type SessionImportScanClientFrame = z.infer<
  typeof sessionImportScanClientFrameSchema
>;

export const sessionImportScanV10 = defineStreamRpcContract({
  method: "sessionImport.scan",
  schemaVersion: { major: 1, minor: 0 } as const,
  openRequestSchema: sessionImportScanOpenRequestSchema,
  serverFrameSchema: sessionImportScanServerFrameSchema,
  clientFrameSchema: sessionImportScanClientFrameSchema,
});
