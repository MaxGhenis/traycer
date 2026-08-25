import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type {
  ListTasksCompleteness,
  ListTasksResponse,
  ListTaskLightPre15,
} from "@traycer/protocol/host/epic/unary-schemas";
import { HostRpcError } from "@traycer-clients/shared/host-transport/host-messenger";
import { useHostClient, type HostRpcRegistry } from "@/lib/host";
import {
  admitsLocalPlane,
  authorizesCloudCapability,
  useAuthStore,
  type AuthStatus,
} from "@/stores/auth/auth-store";
import { useReactiveHostReadiness } from "@/hooks/host/use-reactive-host-readiness";
import { toastFromHostError } from "@/lib/host-error-toast";
import {
  useCloudEpicTasksPagesStore,
  cloudEpicTasksPageIdentity,
  cloudEpicTasksPageGeneration,
  registerCloudEpicTasksPageIdentity,
} from "@/stores/epics/cloud-epic-tasks-pages-store";
import {
  LIST_CLOUD_TASKS_REQUEST,
  cloudEpicTasksFirstPageQueryOptions,
  cloudEpicTasksLastKnownQueryKey,
  cloudEpicTasksQueryKey,
  fetchCloudEpicTasksCursorPageByHostId,
  fetchCloudEpicTasksFirstPageByHostId,
  registerCloudEpicTasksClient,
  type ListCloudTasksRequest,
} from "@/lib/cloud-epic-tasks-query";
import { writeCloudEpicTasksLastKnown } from "@/lib/cloud-epic-tasks-query/cache";
import {
  claimLocalFirstRevalidation,
  isCurrentLocalFirstRevalidation,
  type LocalFirstRevalidationLease,
} from "@/lib/cloud-epic-tasks-query/local-first-revalidation-coordinator";
import { uiQueryKeys } from "@/lib/query-keys";

/**
 * Variables for the next-page mutation. `identity`/`generation` are captured
 * when the fetch starts so the store can drop the response if a refresh reset
 * the identity meanwhile; `request`/`cursor` build the `epic.listTasks` body.
 */
interface NextPageVariables {
  readonly identity: string;
  readonly generation: number;
  readonly request: ListCloudTasksRequest;
  readonly cursor: string;
  readonly scope: CloudEpicTasksRequestScope;
}

/** Captured History authority for a page request and its cache destination. */
interface CloudEpicTasksRequestScope {
  readonly hostId: string;
  readonly userId: string;
}

interface LocalFirstRevalidationVariables {
  readonly queryKey: readonly unknown[];
  readonly lease: LocalFirstRevalidationLease;
  readonly request: ListCloudTasksRequest;
  readonly scope: CloudEpicTasksRequestScope;
}

type PendingLocalFirstResponse = ListTasksResponse & {
  readonly completeness: NonNullable<ListTasksResponse["completeness"]> & {
    readonly cloudPage: "pending";
  };
};

const EMPTY_TASKS: readonly ListTaskLightPre15[] = [];
const EMPTY_PAGES: readonly ListTasksResponse[] = [];
const EMPTY_FIRST_PAGE: ListTasksResponse = { tasks: [], hasMore: false };

export interface CloudEpicTasksQueryResult {
  readonly hostId: string | null;
  readonly currentUserId: string | null;
  readonly tasks: readonly ListTaskLightPre15[];
  readonly query: CloudEpicTasksFirstPageQuery;
  readonly fetchNextPage: () => void;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly refetch: () => void;
  /**
   * The local-first revalidation leg is outstanding: the rendered first page is
   * a renderable LOCAL snapshot whose cloud half has not landed.
   *
   * It is not on `query` and cannot be derived from one - the follow-up runs
   * under its own ephemeral key (see `localFirstRevalidationQueryOptions`), so
   * `query.isFetching` is false throughout it. Without this signal a page of
   * `{tasks: [], completeness.cloudPage: "pending"}` - which the host returns
   * for a caller-owned tombstone with no positive local rows - reaches the
   * panel's empty branch and renders "No tasks yet" for an account that has
   * simply not been asked about yet.
   */
  readonly isCloudPagePending: boolean;
  /**
   * The host's statement about the WHOLE rendered union - the first page and
   * every retained "Show more" tail - worst-of per member, or `null` when no
   * page in it said anything (an older host, or a pre-`@1.5` negotiation).
   *
   * Read this rather than `query.data.completeness`: `tasks` above is the
   * union, so a first-page-only statement presents first-page-complete status
   * over a demonstrably incomplete list the moment one tail is loaded.
   */
  readonly completeness: ListTasksCompleteness | null;
}

export type CloudEpicTasksFirstPageQuery = UseQueryResult<ListTasksResponse>;

function localFirstRevalidationQueryOptions(
  variables: LocalFirstRevalidationVariables,
) {
  return queryOptions<ListTasksResponse>({
    queryKey: [
      "cloud-epic-tasks-local-first-revalidation",
      variables.scope.hostId,
      variables.scope.userId,
      variables.request,
      variables.lease.generation,
    ],
    queryFn: () =>
      fetchCloudEpicTasksFirstPageByHostId(
        variables.scope.hostId,
        variables.scope.userId,
        {
          request: variables.request,
          abortSignal: undefined,
          localFirstPhase: "revalidate",
          requestContextPolicy: "require-current",
        },
      ),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}

function registerCloudEpicTasksClientIfAvailable(
  hostId: string | null,
  client: HostClient<HostRpcRegistry>,
): void {
  if (hostId === null) return;
  registerCloudEpicTasksClient(hostId, client);
}

export function useCloudEpicTasksQuery(
  request: ListCloudTasksRequest | undefined,
  options: { readonly enabled: boolean },
): CloudEpicTasksQueryResult {
  const effectiveRequest = request ?? LIST_CLOUD_TASKS_REQUEST;
  const queryClient = useQueryClient();
  const client = useHostClient();
  const readiness = useReactiveHostReadiness(client);
  const hostId = readiness.hostId;
  const authIdentity = useAuthIdentity();
  const userId = resolveCloudTasksUserId(
    authIdentity,
    readiness.requestContextUserId,
  );
  registerCloudEpicTasksClientIfAvailable(hostId, client);

  const query = useQuery<ListTasksResponse>(
    !options.enabled || hostId === null || userId === null
      ? {
          queryKey: uiQueryKeys.cloudEpicTasksDisabled(),
          queryFn: (): Promise<ListTasksResponse> =>
            Promise.resolve(EMPTY_FIRST_PAGE),
          enabled: false,
        }
      : {
          ...cloudEpicTasksFirstPageQueryOptions(
            hostId,
            userId,
            effectiveRequest,
          ),
          enabled: true,
          placeholderData: (previousData, previousQuery) => {
            if (
              previousData !== undefined &&
              hasSameCloudTasksPlaceholderIdentity(
                previousQuery?.queryKey,
                cloudEpicTasksQueryKey(hostId, userId, effectiveRequest),
              )
            ) {
              return previousData;
            }
            // No usable state on *this* observer (e.g. it just mounted fresh,
            // as a promoted History tab does in place of the modal's
            // observer). Fall back to the last page that settled anywhere
            // for this host/user, so rows already known to be current don't
            // disappear across that remount.
            return queryClient.getQueryData<ListTasksResponse>(
              cloudEpicTasksLastKnownQueryKey(hostId, userId),
            );
          },
        },
  );
  const queryData = query.data;
  const queryRefetch = query.refetch;
  const isPlaceholderData = query.isPlaceholderData;

  // Record settled (non-placeholder, non-pending) first pages as the shared
  // last-known fallback read above. A local-first page is renderable but has
  // an active owner-bound revalidation; persisting it as last-known could
  // strand a remounted observer on `pending` after that owner unmounts.
  useEffect(() => {
    if (hostId === null || userId === null) return;
    if (
      queryData === undefined ||
      isPlaceholderData ||
      isPendingLocalFirstResponse(queryData)
    ) {
      return;
    }
    writeCloudEpicTasksLastKnown(queryClient, { hostId, userId }, queryData);
  }, [hostId, userId, queryClient, queryData, isPlaceholderData]);

  // Identity (host | user | request scope) keys the accumulated "Show more"
  // pages in the ambient store. Holding them there (instead of this hook's own
  // state) lets loaded pages survive the host surface unmounting/remounting -
  // e.g. closing and reopening the History overlay - and a scope change simply
  // selects that scope's own pages rather than discarding them.
  const identity =
    hostId === null || userId === null
      ? `${hostId ?? ""}|${userId ?? ""}|${JSON.stringify(effectiveRequest)}`
      : cloudEpicTasksPageIdentity(hostId, userId, effectiveRequest);
  const extraPages = useCloudEpicTasksPagesStore(
    (state) => state.pagesByIdentity[identity] ?? EMPTY_PAGES,
  );
  const appendPage = useCloudEpicTasksPagesStore((state) => state.appendPage);
  // Next-page fetching flows through TanStack Query (host RPC must, per
  // gui-app/AGENTS.md) so retries/errors are handled by Query rather than a
  // hand-rolled promise + Zustand loading flag. `onSuccess` tags the page with
  // the generation captured at mutate time; the store rejects it if a refresh
  // bumped the generation in between.
  const nextPageMutation = useMutation<
    ListTasksResponse,
    unknown,
    NextPageVariables
  >({
    mutationFn: (variables) =>
      fetchCloudEpicTasksCursorPageByHostId(
        variables.scope.hostId,
        variables.scope.userId,
        {
          request: variables.request,
          cursor: variables.cursor,
        },
      ),
    onSuccess: (page, variables) => {
      appendPage(variables.identity, variables.generation, page);
    },
    onError: (error) => {
      // A stale RequestContext is expected during an identity transition. It
      // failed before any host dispatch, so it must not surface as a user
      // gesture failure; actual host errors retain the established toast.
      if (error instanceof HostRpcError) {
        toastFromHostError(error, "Couldn't load more tasks.");
      }
    },
  });
  // Scope the in-flight flag to THIS identity: the mutation is hook-wide, so a
  // "Show more" still resolving for a previous host/user/request scope must not
  // block pagination once the scope changes (the late response still appends to
  // its own identity's bucket via onSuccess).
  const isFetchingNextPage =
    nextPageMutation.isPending &&
    nextPageMutation.variables.identity === identity;
  const mutateNextPage = nextPageMutation.mutate;

  const startLocalFirstRevalidation = useCallback(
    (variables: LocalFirstRevalidationVariables): void => {
      // The follow-up is still a TanStack Query operation, but deliberately
      // gets its own ephemeral key: it must not replace the renderable initial
      // page until its scoped request has settled and its episode is current.
      // `gcTime: 0` retains no second page after this bounded attempt finishes.
      void queryClient
        .fetchQuery(localFirstRevalidationQueryOptions(variables))
        .then(
          (page) => {
            if (
              !isCurrentLocalFirstRevalidation(queryClient, variables.lease)
            ) {
              return;
            }
            queryClient.setQueryData<ListTasksResponse>(
              variables.queryKey,
              (current) => {
                if (!isPendingLocalFirstResponse(current)) return current;
                return page;
              },
            );
          },
          () => {
            if (
              !isCurrentLocalFirstRevalidation(queryClient, variables.lease)
            ) {
              return;
            }
            queryClient.setQueryData<ListTasksResponse>(
              variables.queryKey,
              (current) => markLocalFirstCloudUnavailable(current),
            );
          },
        );
    },
    [queryClient],
  );

  // THE CLOUD HALF of the local-first split, and the only half that keeps the
  // `signed-in` verdict. `resolveCloudTasksUserId` admits the local plane; this
  // decides whether a revalidation may be SPENT on top of it.
  const authorizesCloudLeg = authorizesCloudCapability(authIdentity.status);

  useEffect(() => {
    if (
      hostId === null ||
      userId === null ||
      isPlaceholderData ||
      query.isFetching ||
      !isPendingLocalFirstResponse(queryData)
    ) {
      return;
    }
    const queryKey = cloudEpicTasksQueryKey(hostId, userId, effectiveRequest);
    if (!authorizesCloudLeg) {
      // No `/api/v3/user` verdict is held, so this session may not ask the
      // account's servers for anything. SETTLE the page rather than leaving it
      // `pending` forever: `pending` is an in-flight claim, and with no leg in
      // flight it would strand `cloudPagePending` true and make the status line
      // promise a cloud page that is never coming.
      //
      // `unavailable` is not a downgrade of the outcome - it is the outcome.
      // An unverified session reaches this state because authn was unreachable
      // or refused the credential, so the very same request would have failed
      // at the host's cloud leg and landed on this exact mark through
      // `startLocalFirstRevalidation`'s rejection arm. Gating it here only
      // avoids re-spending a refresh the server has already refused (see the
      // `refresh-rejected-account` ruling in `auth-store.ts`).
      queryClient.setQueryData<ListTasksResponse>(queryKey, (current) =>
        markLocalFirstCloudUnavailable(current),
      );
      return;
    }
    const lease = claimLocalFirstRevalidation(queryClient, queryKey);
    if (lease === null) return;
    const scope = { hostId, userId };
    startLocalFirstRevalidation({
      queryKey,
      lease,
      request: effectiveRequest,
      scope,
    });
  }, [
    authorizesCloudLeg,
    effectiveRequest,
    hostId,
    queryClient,
    queryData,
    query.isFetching,
    isPlaceholderData,
    startLocalFirstRevalidation,
    userId,
  ]);

  // Recovery promoting THIS session from `unverified` to `signed-in` is the one
  // event that makes a settled `unavailable` page worth asking about again.
  //
  // It has to be the EDGE, not the state. `unavailable` is also where the
  // revalidation's own rejection arm lands, so a guard that merely admitted
  // `unavailable` while authorized would re-dispatch on every cloud failure and
  // spin. And it has to happen at all: with `staleTime: Infinity` and
  // mount/focus/reconnect refetches disabled, nothing else ever asks, so
  // without this the account's cloud tasks stay absent for the rest of the
  // session even though the session can now reach its servers.
  const wasCloudLegAuthorized = useRef(authorizesCloudLeg);
  useEffect(() => {
    const wasAuthorized = wasCloudLegAuthorized.current;
    wasCloudLegAuthorized.current = authorizesCloudLeg;
    if (wasAuthorized || !authorizesCloudLeg) return;
    if (hostId === null || userId === null) return;
    // Reopening to `pending` is the whole action: the revalidation effect above
    // takes `queryData` as a dependency, so it re-runs, and this time both its
    // pending check and its authorization check pass.
    queryClient.setQueryData<ListTasksResponse>(
      cloudEpicTasksQueryKey(hostId, userId, effectiveRequest),
      (current) => reopenLocalFirstCloudPage(current),
    );
  }, [authorizesCloudLeg, effectiveRequest, hostId, queryClient, userId]);

  const tasks = useMemo<readonly ListTaskLightPre15[]>(() => {
    if (queryData === undefined) return EMPTY_TASKS;
    // Dedupe by task id, first occurrence wins (the first page outranks the
    // tails): a personal pin moves a row across server page boundaries, so
    // after a pin lands, a refetched first page or a still-in-flight tail
    // can both carry a row the other already has. A task with no id (neither
    // epic nor phase) is always retained.
    const seenTaskIds = new Set<string>();
    return [queryData, ...extraPages]
      .flatMap((page) => page.tasks)
      .filter((task) => {
        const taskId = task.epic?.light?.id ?? task.phase?.light?.id;
        if (taskId === undefined) return true;
        if (seenTaskIds.has(taskId)) return false;
        seenTaskIds.add(taskId);
        return true;
      });
  }, [queryData, extraPages]);

  // The union's own statement, over exactly the pages `tasks` was assembled
  // from. A placeholder page describes a DIFFERENT request than the one being
  // rendered, so it states nothing - the same suppression the server facets
  // already apply one layer up.
  const completeness = useMemo<ListTasksCompleteness | null>(() => {
    if (isPlaceholderData || queryData === undefined) return null;
    return unionCompleteness([queryData, ...extraPages]);
  }, [extraPages, isPlaceholderData, queryData]);

  const lastPage: ListTasksResponse | undefined =
    extraPages.length > 0 ? extraPages[extraPages.length - 1] : queryData;
  const lastNextCursor = resolveNextCursor(lastPage);
  const hasNextPage = lastNextCursor !== null && !isPlaceholderData;

  const fetchNextPage = useCallback(() => {
    if (
      lastNextCursor === null ||
      isFetchingNextPage ||
      hostId === null ||
      userId === null
    ) {
      return;
    }
    // Register the identity before capturing its generation: a scope reset
    // landing while this very first tail request for the identity is still
    // in flight must have an entry to advance, or the stale response's
    // captured generation would still match on arrival.
    registerCloudEpicTasksPageIdentity(identity);
    mutateNextPage({
      identity,
      generation: cloudEpicTasksPageGeneration(identity),
      request: effectiveRequest,
      cursor: lastNextCursor,
      scope: { hostId, userId },
    });
  }, [
    effectiveRequest,
    hostId,
    identity,
    lastNextCursor,
    isFetchingNextPage,
    mutateNextPage,
    userId,
  ]);

  const refetch = useCallback(() => {
    void queryRefetch();
  }, [queryRefetch]);

  return {
    hostId,
    currentUserId: userId,
    tasks,
    query,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isCloudPagePending:
      !isPlaceholderData && isPendingLocalFirstResponse(queryData),
    completeness,
  };
}

/**
 * The cursor to ask for next, or `null` when the tail is exhausted.
 *
 * `hasMore` and a usable `nextCursor` are separate facts on the wire and both
 * are required: a host that says there is more but hands back no cursor (or an
 * empty one) has nothing this client can ask with, so the tail ends there
 * rather than dispatching a request that cannot be positioned.
 */
function resolveNextCursor(
  lastPage: ListTasksResponse | undefined,
): string | null {
  if (lastPage === undefined || !lastPage.hasMore) return null;
  const cursor = lastPage.nextCursor;
  if (typeof cursor !== "string" || cursor.length === 0) return null;
  return cursor;
}

/**
 * Worst-of union of every page's own completeness statement.
 *
 * Each member is ranked by how much of the answer is MISSING, and the union
 * takes the worst rank present. A hole in any page is a hole in the union, so
 * the union can never be more complete than its least complete page.
 *
 * A SILENT page is skipped rather than collapsing the union to `null`. Absence
 * genuinely means "this host cannot say", but every page of one identity comes
 * from one host at one negotiated minor - the resolver stamps `completeness` on
 * cursor pages exactly as it does on the first - so a mixed union is
 * structurally unreachable, while deleting a real `unavailable` warning because
 * a sibling page was silent is a failure with a live path to it. A union whose
 * pages are ALL silent still answers `null`, which is today's rendering.
 */
function unionCompleteness(
  pages: ReadonlyArray<ListTasksResponse>,
): ListTasksCompleteness | null {
  let union: ListTasksCompleteness | null = null;
  for (const page of pages) {
    const statement = page.completeness;
    if (statement === undefined) continue;
    union = union === null ? statement : mergeCompleteness(union, statement);
  }
  return union;
}

// `pending` outranks `settled` (a page is still owed) and `unavailable`
// outranks both: a settled failure is a hole nothing is going to fill, so a
// union carrying one is not "still loading".
const CLOUD_PAGE_RANK: Record<ListTasksCompleteness["cloudPage"], number> = {
  settled: 0,
  pending: 1,
  unavailable: 2,
};
const FACETS_RANK: Record<ListTasksCompleteness["facets"], number> = {
  server: 0,
  partial: 1,
};
// `none` and `present` are both COMPLETE statements about local rows, ordered
// only so the union reports the fact that some page carried them. The two above
// them are the incomplete ones: `truncated` means rows were dropped,
// `suppressed-unprovable-filter` means the filter could not be answered
// locally at all - strictly less knowledge, so it ranks worst.
const LOCAL_ROWS_RANK: Record<ListTasksCompleteness["localRows"], number> = {
  none: 0,
  present: 1,
  truncated: 2,
  "suppressed-unprovable-filter": 3,
};
const SORT_RANK: Record<ListTasksCompleteness["sort"], number> = {
  server: 0,
  "loaded-union": 1,
};

function mergeCompleteness(
  left: ListTasksCompleteness,
  right: ListTasksCompleteness,
): ListTasksCompleteness {
  return {
    cloudPage: worseOf(left.cloudPage, right.cloudPage, CLOUD_PAGE_RANK),
    facets: worseOf(left.facets, right.facets, FACETS_RANK),
    localRows: worseOf(left.localRows, right.localRows, LOCAL_ROWS_RANK),
    sort: worseOf(left.sort, right.sort, SORT_RANK),
  };
}

function worseOf<Member extends string>(
  left: Member,
  right: Member,
  rank: Record<Member, number>,
): Member {
  return rank[right] > rank[left] ? right : left;
}

function isPendingLocalFirstResponse(
  response: ListTasksResponse | undefined,
): response is PendingLocalFirstResponse {
  return response?.completeness?.cloudPage === "pending";
}

/**
 * Flip a settled `unavailable` cloud page back to `pending` so the revalidation
 * effect will pick it up again.
 *
 * `facets` is deliberately left at `partial`: it is already honest while the
 * cloud leg is back in flight, and the success arm replaces the whole page
 * (facets included) rather than patching this one field.
 */
function reopenLocalFirstCloudPage(
  response: ListTasksResponse | undefined,
): ListTasksResponse | undefined {
  const completeness = response?.completeness;
  if (response === undefined || completeness === undefined) return response;
  if (completeness.cloudPage !== "unavailable") return response;
  return {
    ...response,
    completeness: { ...completeness, cloudPage: "pending" },
  };
}

function markLocalFirstCloudUnavailable(
  response: ListTasksResponse | undefined,
): ListTasksResponse | undefined {
  if (!isPendingLocalFirstResponse(response)) return response;
  return {
    ...response,
    completeness: {
      ...response.completeness,
      cloudPage: "unavailable",
      facets: "partial",
    },
  };
}

function hasSameCloudTasksPlaceholderIdentity(
  previousQueryKey: readonly unknown[] | undefined,
  currentQueryKey: readonly unknown[],
): boolean {
  if (previousQueryKey === undefined) return false;
  return (
    previousQueryKey[0] === currentQueryKey[0] &&
    previousQueryKey[1] === currentQueryKey[1] &&
    previousQueryKey[2] === currentQueryKey[2] &&
    previousQueryKey[4] === currentQueryKey[4] &&
    previousQueryKey[5] === currentQueryKey[5]
  );
}

/**
 * The cache authority for this list, or `null` when this session must issue no
 * request at all.
 *
 * A SURFACE TEST, NOT A CAPABILITY TEST, and the distinction is the whole
 * reason this is not `status === "signed-in"`. The first `epic.listTasks` leg
 * is a local-first read of the epics the host already serves off this machine's
 * disk - it draws no cloud credential (see the resolver's `localFirstInitial`
 * arm, which projects before `buildCloudHeadersFromContext` is ever called) -
 * so every identity {@link admitsLocalPlane} admits belongs here. `unverified`
 * is exactly that cohort: `root-landing-page.tsx` renders `/epics` for it, and
 * gating this call site on the verdict admitted those users to History and then
 * showed them "No tasks yet" over their own rows.
 *
 * The CLOUD leg keeps the verdict. It is gated separately on
 * {@link authorizesCloudCapability} in the revalidation effect above, so
 * widening this predicate spends no capability an `unverified` session does not
 * hold.
 *
 * `signed-out` still resolves `null` and issues nothing: there is no stored
 * identity to scope a cache to, so there is no local plane to read either.
 */
function resolveCloudTasksUserId(
  authIdentity: {
    readonly status: AuthStatus;
    readonly userId: string | null;
  },
  requestContextUserId: string | null,
): string | null {
  if (!admitsLocalPlane(authIdentity.status)) return null;
  if (authIdentity.userId === null) return null;
  if (authIdentity.userId !== requestContextUserId) return null;
  return requestContextUserId;
}

/**
 * Cache discriminator keyed by the authenticated identity from the live
 * `RequestContext` metadata, NOT the raw bearer string. The bearer is a
 * persistence-boundary concern and must not leak into TanStack query
 * keys; the `userId` from `contextMetadata` is the canonical authority
 * for "who this cache belongs to".
 */
function useAuthIdentity(): {
  readonly status: AuthStatus;
  readonly userId: string | null;
} {
  const status = useAuthStore((state) => state.status);
  const userId = useAuthStore((state) => state.contextMetadata?.userId ?? null);
  return {
    status,
    userId,
  };
}
