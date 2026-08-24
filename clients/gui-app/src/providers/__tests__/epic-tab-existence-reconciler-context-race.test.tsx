import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ListTasksResponse } from "@traycer/protocol/host/epic/unary-schemas";
import { EpicTabExistenceReconciler } from "@/providers/epic-tab-existence-reconciler";
import { useAuthStore } from "@/stores/auth/auth-store";
import {
  collectOpenEpicIds,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { useTabsStore } from "@/stores/tabs/store";
import { tabCommandCoordinator } from "@/stores/tabs/tab-command-coordinator";
import { useInitialChatHandoffStore } from "@/stores/epics/initial-chat-handoff-store";
import { clearSessionCreatedEpics } from "@/lib/epics/session-created-epics";

const HOST_ID = "host-reconciler-context-race";
const USER_A = "user-a";
const USER_B = "user-b";
const OPEN_EPIC_ID = "epic-persisted-for-user-a";

const fixture = vi.hoisted(() => ({
  requestContextUserId: "user-b",
  dispatchedAs: new Array<string>(),
  requestWithSignal: vi.fn(
    (
      _method: string,
      _params: object,
      _signal: AbortSignal | undefined,
    ): Promise<ListTasksResponse> => {
      fixture.dispatchedAs.push(fixture.requestContextUserId);
      return Promise.resolve({ tasks: [], hasMore: false });
    },
  ),
}));

vi.mock("@/lib/host", () => ({
  useHostClient: () => ({
    getActiveHostId: () => HOST_ID,
    getRequestContextUserId: () => fixture.requestContextUserId,
    onChange: () => () => undefined,
    requestWithSignal: fixture.requestWithSignal,
  }),
  useHostCompatibility: () => ({ status: "compatible" }),
}));

vi.mock("@/hooks/host/use-reactive-host-readiness", () => ({
  // The render that created this reconciliation run still names A. Before
  // the local-home query dispatches, the live HostClient has already moved to
  // B. A generic query would deliver B's empty page into A's destructive run.
  useReactiveHostReadiness: () => ({
    hostId: HOST_ID,
    requestContextUserId: USER_A,
    isReady: true,
  }),
}));

vi.mock("@/hooks/host/use-host-supports-method", () => ({
  useHostMethodSupport: () => true,
}));

vi.mock("@/hooks/host/use-host-queries", () => ({
  useHostQueries: () => new Set([OPEN_EPIC_ID]),
}));

vi.mock("@/providers/windows-bridge-context", () => ({
  useWindowsBridgeHydrated: () => true,
}));

describe("EpicTabExistenceReconciler request-context race", () => {
  beforeEach(() => {
    fixture.requestContextUserId = USER_B;
    fixture.dispatchedAs.length = 0;
    fixture.requestWithSignal.mockClear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    tabCommandCoordinator.installSourceReconciliation();
    useAuthStore
      .getState()
      .setSignedIn(
        { userId: USER_A, userName: "User A", email: "a@example.com" },
        { userId: USER_A, username: "user-a" },
        [],
      );
    useEpicCanvasStore.getState().openEpicTab(OPEN_EPIC_ID, "Persisted A");
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().setSignedOut();
    useEpicCanvasStore.getState().closeTabsForEpics([OPEN_EPIC_ID]);
    useInitialChatHandoffStore.getState().resetForTests();
    clearSessionCreatedEpics();
    vi.restoreAllMocks();
  });

  it("does not let B's local-home page decide A's destructive reconciliation run", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <EpicTabExistenceReconciler />
      </QueryClientProvider>,
    );

    const readLocalHomeQuery = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .find((query) => query.queryKey.includes("epic.listTasks"));

    await waitFor(() => {
      const localHomeQuery = readLocalHomeQuery();
      if (localHomeQuery === undefined) {
        throw new Error("Expected the local-home query to be created.");
      }
      expect(["error", "success"]).toContain(localHomeQuery.state.status);
    });

    // The frozen run is A, but B is a genuinely reachable live requester. The
    // scoped primitive must reject before transport dispatch; otherwise B's
    // empty page becomes A's local-home exemption set and closes this tab.
    expect(fixture.dispatchedAs).toEqual([]);
    expect(collectOpenEpicIds()).toContain(OPEN_EPIC_ID);
    const localHomeQuery = readLocalHomeQuery();
    if (localHomeQuery === undefined) {
      throw new Error("Expected the local-home query to remain cached.");
    }
    expect(localHomeQuery.state.status).toBe("error");
    queryClient.clear();
  });
});
