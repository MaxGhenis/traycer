import { formatProfileSelection } from "@traycer/protocol/agent/agent-profile-format";
import { getAgentNativeSessionBindingResponseSchema } from "@traycer/protocol/host/agent/shared";
import {
  callHostRpc,
  parseCanonicalHostResponse,
  toAgentCliError,
} from "../internal/host-rpc";
import { resolveEpicId, resolveSenderAgentId } from "../internal/agent-context";
import type { CommandFn } from "../runner/runner";

/**
 * `traycer agent binding` - read the current provider-native session identity
 * for one local GUI or TUI agent. The structured response is intentionally
 * narrow enough for an external recorder to join on `agentId` plus
 * `harnessSessionId` without receiving provider-account or transcript data.
 *
 * A null session id is a successful pending observation, not an error. GUI
 * agents can later acquire a different current binding after changing harness
 * or profile, so consumers that need history should retain every non-null pair
 * they observe rather than overwrite their own join table.
 */
export function buildAgentBindingCommand(opts: {
  readonly epicId: string | null;
  readonly senderAgentId: string | null;
  readonly agentId: string;
}): CommandFn {
  return async () => {
    const result = await toAgentCliError(
      callHostRpc("agent.getNativeSessionBinding", {
        epicId: resolveEpicId(opts.epicId),
        senderAgentId: resolveSenderAgentId(opts.senderAgentId),
        agentId: opts.agentId,
      }),
    );
    const response = parseCanonicalHostResponse(
      "agent.getNativeSessionBinding",
      getAgentNativeSessionBindingResponseSchema,
      result,
    );
    const human = [
      `Agent: ${response.agentId}`,
      `Surface: ${response.surface}`,
      `Harness: ${response.harnessId}`,
      `Profile: ${formatProfileSelection(response.profileSelection)}`,
      `Native session: ${response.harnessSessionId ?? "not observed yet"}`,
    ].join("\n");
    return { data: response, human, exitCode: 0 };
  };
}
