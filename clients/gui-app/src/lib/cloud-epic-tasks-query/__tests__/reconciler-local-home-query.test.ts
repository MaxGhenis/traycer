import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { HostClient } from "@traycer-clients/shared/host-client/host-client";
import { mockLocalHostEntry } from "@traycer-clients/shared/host-client/mock/mock-host-directory";
import { MockHostMessenger } from "@traycer-clients/shared/host-client/mock/mock-host-messenger";
import { createRequestContextFixture } from "@traycer-clients/shared/test-fixtures/request-context";
import { hostRpcRegistry, type HostRpcRegistry } from "@traycer/protocol/host";
import type {
  ListTasksRequest,
  ListTasksResponse,
} from "@traycer/protocol/host/epic/unary-schemas";
import { registerCloudEpicTasksClient } from "@/lib/cloud-epic-tasks-query";
import { createHostQueryInvalidator } from "@/lib/host/query-invalidator";
import { epicTabLocalHomeListQueryOptions } from "@/lib/cloud-epic-tasks-query/reconciler-local-home-query";

const USER_A = "user-a";
const USER_B = "user-b";

const LOCAL_HOME_PARAMS: ListTasksRequest = {
  limit: 100,
  filters: { taskType: "epic" },
  extensionPhaseVersion: "1",
  extensionEpicVersion: "1",
};

function requestContextFor(userId: string) {
  return createRequestContextFixture({
    identity: { userId, username: userId, providerHandle: null },
    origin: "renderer",
  });
}

function createFixture() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let dispatchCount = 0;
  const spine = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    invalidator: createHostQueryInvalidator(queryClient),
    findHostById: (hostId) =>
      hostId === mockLocalHostEntry.hostId ? mockLocalHostEntry : null,
    messenger: new MockHostMessenger<HostRpcRegistry>({
      registry: hostRpcRegistry,
      requestId: () => "reconciler-local-home",
      handlers: {
        "epic.listTasks": (): ListTasksResponse => {
          dispatchCount += 1;
          return { tasks: [], hasMore: false };
        },
      },
    }),
  });
  spine.setRequestContext(requestContextFor(USER_A));
  const client = spine.createRequester(mockLocalHostEntry);
  registerCloudEpicTasksClient(mockLocalHostEntry.hostId, client);
  const options = epicTabLocalHomeListQueryOptions({
    hostId: mockLocalHostEntry.hostId,
    userId: USER_A,
    params: LOCAL_HOME_PARAMS,
    cacheKeyIdentity: `${mockLocalHostEntry.hostId}:${USER_A}:1`,
  });
  return {
    client: spine,
    dispatchCount: () => dispatchCount,
    options,
    queryClient,
  };
}

describe("epicTabLocalHomeListQueryOptions", () => {
  it("dispatches a current reconciliation run through the shared scoped primitive", async () => {
    const fixture = createFixture();

    await expect(
      fixture.queryClient.fetchQuery(fixture.options),
    ).resolves.toEqual({ tasks: [], hasMore: false });

    expect(fixture.dispatchCount()).toBe(1);
  });

  it("cannot dispatch or cache B's local-home page under an A reconciliation key", async () => {
    const fixture = createFixture();
    // The reconciliation run already captured A's cache identity. The live
    // requester rotates before TanStack invokes its query function: generic
    // useHostQuery used to send B's result into that A-keyed cache slot.
    fixture.client.setRequestContext(requestContextFor(USER_B));

    await expect(
      fixture.queryClient.fetchQuery(fixture.options),
    ).rejects.toThrow("request context no longer matches its cache user");

    expect(fixture.dispatchCount()).toBe(0);
    expect(
      fixture.queryClient.getQueryData<ListTasksResponse>(
        fixture.options.queryKey,
      ),
    ).toBeUndefined();
    expect(
      fixture.queryClient.getQueryState(fixture.options.queryKey)?.status,
    ).toBe("error");
  });
});
