import { z } from "zod";
import { defineRpcContract } from "@traycer/protocol/framework/index";

/**
 * Ticket 12 - the one-click Stop on the passive borrowed-tile indicator.
 *
 * A unary RPC rather than a `browser.sessions` client frame on purpose: the
 * stream's subscriber only carries `{chatId, accessScope}`, which is not
 * always enough to reconstruct the `BrowserSessionOwnerRef`
 * (`{userId, epicId, chatId, agentRunId}`) `stopAgentActivity`'s composition
 * is keyed by, whereas every other owner-scoped host RPC (`agent.stop`
 * included) already resolves `userId` from the authenticated request context
 * and takes `epicId`/`agentRunId` as explicit params. Reusing that pattern
 * avoids inventing new owner-resolution logic on the stream.
 *
 * Stop is inherently owner-scoped, not tile-scoped: `stopAgentActivity`
 * terminates the owner's one cell-runner JS execution
 * (`Runtime.terminateExecution`), which by construction ends whatever every
 * target that cell was driving was doing - there is no way to interrupt the
 * JS for just one target while leaving it running for another.
 */
export const browserStopAgentActivityRequestSchema = z.object({
  epicId: z.string(),
  chatId: z.string(),
  agentRunId: z.string().nullable(),
});
export type BrowserStopAgentActivityRequest = z.infer<
  typeof browserStopAgentActivityRequestSchema
>;

/**
 * Honest per-call outcome, not per-target: the caller (a passive-indicator
 * Stop button) never learns individual `TabHandle`s, only whether stopping
 * this owner's activity left anything genuinely uncertain.
 *
 * `stoppedTargetCount` covers targets that had nothing in flight when Stop
 * ran - correctness holds regardless of whatever was still queued behind
 * them, since nothing queued had reached the browser yet.
 * `outcomeUnknownTargetCount` covers targets that had a command already
 * in flight - it may have already landed on the browser, and claiming
 * "stopped" for those would be the exact lie the ticket exists to prevent.
 */
export const browserStopAgentActivityResponseSchema = z.object({
  stoppedTargetCount: z.number().int().nonnegative(),
  outcomeUnknownTargetCount: z.number().int().nonnegative(),
});
export type BrowserStopAgentActivityResponse = z.infer<
  typeof browserStopAgentActivityResponseSchema
>;

export const browserStopAgentActivityV10 = defineRpcContract({
  method: "browser.stopAgentActivity",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: browserStopAgentActivityRequestSchema,
  responseSchema: browserStopAgentActivityResponseSchema,
});
