import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostRpcError } from "../../../../shared/host-transport/host-messenger";
import { callHostRpc } from "../../internal/host-rpc";
import { noopLogger } from "../../logger";
import { CLI_ERROR_CODES, CliError } from "../../runner/errors";
import type { CommandContext } from "../../runner/runner";
import { buildAgentBindingCommand } from "../agent-binding";

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../logger", () => ({
  createCliLogger: () => loggerMock,
  errorFromUnknown: (value: unknown) =>
    value instanceof Error ? value : new Error(String(value)),
  noopLogger: loggerMock,
}));

vi.mock("../../internal/host-rpc", async () => {
  const actual = await vi.importActual<
    typeof import("../../internal/host-rpc")
  >("../../internal/host-rpc");
  return { ...actual, callHostRpc: vi.fn() };
});

const rpcMock = vi.mocked(callHostRpc);

const response = {
  agentId: "agent-target",
  surface: "gui" as const,
  harnessId: "claude",
  profileSelection: { kind: "ambient" as const },
  harnessSessionId: "session-123",
};

function makeCtx(): CommandContext {
  return {
    runtime: {
      json: false,
      quiet: false,
      noProgress: false,
      noBootstrap: false,
      nonInteractive: false,
      environment: "production",
      logger: noopLogger,
    },
    output: {
      progress: vi.fn(),
      human: vi.fn(),
      humanRequired: vi.fn(),
      emitResult: vi.fn(),
      emitError: vi.fn(),
    },
    progress: vi.fn(),
  };
}

function buildCommand() {
  return buildAgentBindingCommand({
    epicId: "epic-1",
    senderAgentId: "agent-caller",
    agentId: "agent-target",
  });
}

function hostError(
  code: "E_HOST_UNSUPPORTED" | "E_AGENT_NOT_FOUND" | "E_AGENT_NOT_LOCAL",
  message: string,
): HostRpcError {
  return new HostRpcError({
    code,
    message,
    requestId: "request-1",
    method: "agent.getNativeSessionBinding",
    fatalDetails:
      code === "E_HOST_UNSUPPORTED"
        ? {
            code,
            reason: message,
            incompatibleMethods: null,
            upgradeGuidance: {
              clientShouldUpgrade: false,
              hostShouldUpgrade: true,
            },
          }
        : null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agent binding", () => {
  it("sends the exact epic, sender, and target ids to the native-binding RPC", async () => {
    rpcMock.mockResolvedValue(response);

    await buildCommand()(makeCtx());

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("agent.getNativeSessionBinding", {
      epicId: "epic-1",
      senderAgentId: "agent-caller",
      agentId: "agent-target",
    });
  });

  it("returns the canonical DTO and formats an ambient binding", async () => {
    rpcMock.mockResolvedValue(response);

    const result = await buildCommand()(makeCtx());

    expect(result.data).toEqual(response);
    expect(result.human).toBe(
      "Agent: agent-target\nSurface: gui\nHarness: claude\nProfile: ambient\nNative session: session-123",
    );
  });

  it("formats a managed profile and a pending native-session observation", async () => {
    rpcMock.mockResolvedValue({
      ...response,
      surface: "tui",
      harnessId: "codex",
      profileSelection: { kind: "profile", profileId: "profile-work" },
      harnessSessionId: null,
    });

    const result = await buildCommand()(makeCtx());

    expect(result.human).toContain("Surface: tui");
    expect(result.human).toContain("Profile: profile-work");
    expect(result.human).toContain("Native session: not observed yet");
  });

  it("strips fields outside the canonical response projection", async () => {
    rpcMock.mockResolvedValue({
      ...response,
      email: "private@example.com",
      token: "secret",
      transcript: "private prompt",
    } as typeof response);

    const result = await buildCommand()(makeCtx());

    expect(result.data).toEqual(response);
    expect(result.data).not.toHaveProperty("email");
    expect(result.data).not.toHaveProperty("token");
    expect(result.data).not.toHaveProperty("transcript");
  });

  it("maps an old host to actionable per-call upgrade guidance", async () => {
    rpcMock.mockRejectedValue(
      hostError(
        "E_HOST_UNSUPPORTED",
        "This host does not support 'agent.getNativeSessionBinding'. Upgrade the host to use this feature.",
      ),
    );

    const error = await buildCommand()(makeCtx()).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({
      code: CLI_ERROR_CODES.HOST_UNSUPPORTED,
      details: {
        hostShouldUpgrade: true,
        method: "agent.getNativeSessionBinding",
      },
    });
  });

  it.each([
    ["E_AGENT_NOT_FOUND", CLI_ERROR_CODES.AGENT_NOT_FOUND],
    ["E_AGENT_NOT_LOCAL", CLI_ERROR_CODES.AGENT_NOT_LOCAL],
  ] as const)("preserves the host's %s refusal", async (wireCode, cliCode) => {
    rpcMock.mockRejectedValue(hostError(wireCode, "Agent is unavailable."));

    const error = await buildCommand()(makeCtx()).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: cliCode });
  });
});
