import { useHostClient } from "@/lib/host";
import { useHostQuery } from "@/hooks/host/use-host-query";

const STATUS_PARAMS = {} as const;

/**
 * Whether an import is in flight on this host, and the summary of the last one.
 *
 * Asked on mount, not polled: the host method policy gives it no cadence
 * because a client that started the run is already watching
 * `sessionImport.run` live (`session-import-run-store`). The only thing this
 * answers that the store cannot is what happened BEFORE this app session -
 * a run left going by a quit, or the summary of one that finished last week.
 */
export function useSessionImportStatus(enabled: boolean) {
  const client = useHostClient();
  return useHostQuery({
    cacheKeyIdentity: undefined,
    client,
    method: "sessionImport.status",
    params: STATUS_PARAMS,
    options: { enabled, staleTime: 5_000 },
  });
}
