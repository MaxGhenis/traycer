import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HostClient } from "@traycer-clients/shared/host-client/host-client";
import { MockHostMessenger } from "@traycer-clients/shared/host-client/mock/mock-host-messenger";
import { mockLocalHostEntry } from "@traycer-clients/shared/host-client/mock/mock-host-directory";
import { createRequestContextFixture } from "@traycer-clients/shared/test-fixtures/request-context";
import {
  hostRpcRegistry,
  type HostRpcRegistry,
} from "@traycer/protocol/host/index";
import type { ManagedCommand } from "@traycer/protocol/host/managed-command/unary-schemas";
import { createHostQueryInvalidator } from "@/lib/host/query-invalidator";

/**
 * "Stop all" over a chat's host-supervised commands, driven against a real
 * `HostClient` and a mock host that refuses some of the stops.
 *
 * The point of the aggregate is what it does NOT do: one dead or unhappy host
 * used to produce one toast per row, because each stop was its own mutation
 * judging its own failure.
 */

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
const directoryState = vi.hoisted(() => ({ available: true }));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/host", () => ({
  useHostClient: () => hostClient,
  useHostDirectory: () => ({
    findById: () => (directoryState.available ? mockLocalHostEntry : null),
  }),
}));

import { useManagedCommandStopAll } from "@/hooks/managed-command/use-managed-command-lifecycle-mutations";

const EPIC_ID = "epic-1";

/** Command ids the mock host refuses to stop. */
const refusedCommandIds = new Set<string>();
const stoppedCommandIds: string[] = [];

let hostClient: HostClient<HostRpcRegistry>;
let queryClient: QueryClient;

function stoppedCommand(commandId: string): ManagedCommand {
  return {
    id: commandId,
    kind: "monitor",
    description: "deploy watcher",
    status: { state: "stopped", stoppedAtMs: 5 },
    chatId: "chat-1",
    createdAtMs: 1,
    updatedAtMs: 5,
  };
}

function wrapper(props: { readonly children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  toastError.mockClear();
  directoryState.available = true;
  refusedCommandIds.clear();
  stoppedCommandIds.length = 0;
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const messenger = new MockHostMessenger<HostRpcRegistry>({
    registry: hostRpcRegistry,
    requestId: () => "stop-all-request",
    handlers: {
      "managedCommand.stop": (request) => {
        if (refusedCommandIds.has(request.commandId)) {
          throw new Error(`no such process: ${request.commandId}`);
        }
        stoppedCommandIds.push(request.commandId);
        return { command: stoppedCommand(request.commandId) };
      },
    },
  });
  hostClient = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    invalidator: createHostQueryInvalidator(queryClient),
    messenger,
  });
  hostClient.bind(mockLocalHostEntry);
  hostClient.setRequestContext(
    createRequestContextFixture({
      origin: "renderer",
      bearerToken: "stop-all-token",
    }),
  );
});

afterEach(() => {
  cleanup();
  hostClient.dispose();
});

describe("useManagedCommandStopAll", () => {
  it("fails once with the real reason when no host client can be built", async () => {
    directoryState.available = false;
    const { result } = renderHook(() => useManagedCommandStopAll(), {
      wrapper,
    });

    act(() => {
      result.current.mutate({
        hostId: mockLocalHostEntry.hostId,
        epicId: EPIC_ID,
        commandIds: ["cmd-1", "cmd-2"],
      });
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Nothing was sent and nothing was manufactured: one failure, carrying
    // the actual reason rather than an uninformative "2 of 2" count.
    expect(stoppedCommandIds).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("unavailable"),
    );
  });

  it("says a partial failure once, naming how many of how many", async () => {
    refusedCommandIds.add("cmd-2");
    const { result } = renderHook(() => useManagedCommandStopAll(), {
      wrapper,
    });

    act(() => {
      result.current.mutate({
        hostId: mockLocalHostEntry.hostId,
        epicId: EPIC_ID,
        commandIds: ["cmd-1", "cmd-2", "cmd-3"],
      });
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // A refusal does not abandon the rest: every stop is sent before the
    // outcome is judged.
    expect(stoppedCommandIds).toEqual(["cmd-1", "cmd-3"]);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't stop 1 of 3 monitors and shells.",
    );
  });

  it("still says it once when the host refuses every one of them", async () => {
    refusedCommandIds.add("cmd-1");
    refusedCommandIds.add("cmd-2");
    const { result } = renderHook(() => useManagedCommandStopAll(), {
      wrapper,
    });

    act(() => {
      result.current.mutate({
        hostId: mockLocalHostEntry.hostId,
        epicId: EPIC_ID,
        commandIds: ["cmd-1", "cmd-2"],
      });
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // The whole point: a host that fails everything is ONE piece of news, not
    // one per row.
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't stop 2 of 2 monitors and shells.",
    );
  });

  it("stays quiet when every stop lands", async () => {
    const { result } = renderHook(() => useManagedCommandStopAll(), {
      wrapper,
    });

    act(() => {
      result.current.mutate({
        hostId: mockLocalHostEntry.hostId,
        epicId: EPIC_ID,
        commandIds: ["cmd-1", "cmd-2"],
      });
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(stoppedCommandIds).toEqual(["cmd-1", "cmd-2"]);
    expect(toastError).not.toHaveBeenCalled();
  });
});
