import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { HostRpcRegistry } from "@/lib/host";
import { useHostQuery } from "@/hooks/host/use-host-query";
import { isHostQueryAwaitingData } from "@/lib/query/host-query-awaiting-data";

describe("isHostQueryAwaitingData", () => {
  afterEach(() => {
    cleanup();
  });

  // The case the predicate exists for. A host query with no client bound is
  // disabled, and TanStack reports that as pending-and-idle - so `isLoading`
  // is false and a surface reading it treats never-asked as answered-nothing.
  // Driven through a real observer rather than a hand-built result object, so
  // it pins TanStack's actual disabled semantics and not an assumption.
  it("awaits data for a query disabled because no host client is bound", () => {
    const { result } = renderHook(
      () =>
        useHostQuery<HostRpcRegistry, "workspace.readFile">({
          cacheKeyIdentity: undefined,
          client: null,
          method: "workspace.readFile",
          params: {
            workspacePath: "/repo",
            filePath: "src/index.ts",
            maxBytes: 1_000,
          },
          options: null,
        }),
      { wrapper: createQueryWrapper() },
    );

    expect(result.current.status).toBe("pending");
    expect(result.current.fetchStatus).toBe("idle");
    // The misreport this guards: the spinner gate every affected surface used.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();

    expect(
      isHostQueryAwaitingData({ query: result.current, requested: true }),
    ).toBe(true);
  });

  // Same observable result, opposite answer: the caller never asked, so there
  // is nothing to wait for and the surface must fall through to its empty
  // state rather than spin forever.
  it("does not await data for a query the caller itself disabled", () => {
    const { result } = renderHook(
      () =>
        useHostQuery<HostRpcRegistry, "workspace.readFile">({
          cacheKeyIdentity: undefined,
          client: null,
          method: "workspace.readFile",
          params: { workspacePath: "", filePath: "", maxBytes: 1_000 },
          options: { enabled: false },
        }),
      { wrapper: createQueryWrapper() },
    );

    expect(result.current.isPending).toBe(true);
    expect(
      isHostQueryAwaitingData({ query: result.current, requested: false }),
    ).toBe(false);
  });

  it("awaits data while a requested query is fetching", () => {
    expect(
      isHostQueryAwaitingData({ query: { isPending: true }, requested: true }),
    ).toBe(true);
  });

  // Covers both a settled first read and a failed REFETCH: TanStack keeps the
  // last successful snapshot through a refetch failure, so the result stays
  // non-pending and the surface must keep rendering that content rather than
  // fall back to a spinner.
  it("stops awaiting once the query has produced a snapshot", () => {
    expect(
      isHostQueryAwaitingData({ query: { isPending: false }, requested: true }),
    ).toBe(false);
  });
});

function createQueryWrapper(): (props: {
  readonly children: ReactNode;
}) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper(props: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    );
  };
}
