/**
 * The unary managed-command controls. `UI.md` §2 fixes the human capability set
 * at watch plus lifecycle - start, stop, delete - and nothing more: authoring a
 * command is the agent's job (its tool descriptions carry flush-contract
 * guidance a human form would skip), and changing one is a sentence to the
 * agent. There is deliberately no create or update here.
 *
 * The output itself is carried by the stream in `./subscribe.ts`; the set of
 * commands a chat owns rides that chat's `chat.subscribe` stream.
 */
import { defineRpcContract } from "@traycer/protocol/framework/index";
import {
  managedCommandConfigureRequestSchema,
  managedCommandConfigureResponseSchema,
  managedCommandControlRequestSchema,
  managedCommandControlResponseSchema,
  managedCommandCreateRequestSchema,
  managedCommandCreateResponseSchema,
  managedCommandDeleteRequestSchema,
  managedCommandDeleteResponseSchema,
  managedCommandListRequestSchema,
  managedCommandListResponseSchema,
  managedCommandRestartRequestSchema,
  managedCommandRestartResponseSchema,
  managedCommandViewRequestSchema,
  managedCommandViewResponseSchema,
} from "@traycer/protocol/host/managed-command/unary-schemas";
import { managedCommandSubscribeOutputV10 } from "@traycer/protocol/host/managed-command/subscribe";

/** Idempotent: starting an already-running command is a no-op, not an error. */
export const managedCommandStartV10 = defineRpcContract({
  method: "managedCommand.start",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandControlRequestSchema,
  responseSchema: managedCommandControlResponseSchema,
});

/** The supervisor's graceful stop: TERM to the process group, grace, then KILL. */
export const managedCommandStopV10 = defineRpcContract({
  method: "managedCommand.stop",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandControlRequestSchema,
  responseSchema: managedCommandControlResponseSchema,
});

/**
 * Kills the process if running, drops the row, and removes the log directory.
 * The output history dies with it, which is why the UI puts this behind a
 * confirmation that names what is lost.
 */
export const managedCommandDeleteV10 = defineRpcContract({
  method: "managedCommand.delete",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandDeleteRequestSchema,
  responseSchema: managedCommandDeleteResponseSchema,
});

export const managedCommandCreateV10 = defineRpcContract({
  method: "managedCommand.create",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandCreateRequestSchema,
  responseSchema: managedCommandCreateResponseSchema,
});

export const managedCommandListV10 = defineRpcContract({
  method: "managedCommand.list",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandListRequestSchema,
  responseSchema: managedCommandListResponseSchema,
});

export const managedCommandViewV10 = defineRpcContract({
  method: "managedCommand.view",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandViewRequestSchema,
  responseSchema: managedCommandViewResponseSchema,
});

export const managedCommandConfigureV10 = defineRpcContract({
  method: "managedCommand.configure",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandConfigureRequestSchema,
  responseSchema: managedCommandConfigureResponseSchema,
});

export const managedCommandRestartV10 = defineRpcContract({
  method: "managedCommand.restart",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: managedCommandRestartRequestSchema,
  responseSchema: managedCommandRestartResponseSchema,
});

export { managedCommandSubscribeOutputV10 };
