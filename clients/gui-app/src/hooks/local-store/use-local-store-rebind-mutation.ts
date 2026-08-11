import { useMemo } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type {
  RequestOfMethod,
  ResponseOfMethod,
  HostRpcError,
} from "@traycer-clients/shared/host-transport/host-messenger";
import { useHostClientFor } from "@/hooks/host/use-host-client-for";
import { useHostDirectoryList } from "@/hooks/host/use-host-directory-list-query";
import { useEpicSessionHostId } from "@/hooks/epic/use-epic-session-host-id";
import { useHostMutation } from "@/hooks/host/use-host-query";
import { toastFromHostError } from "@/lib/host-error-toast";
import type { HostRpcRegistry } from "@/lib/host";
import { localStoreMutationKeys } from "@/lib/query-keys/local-store-mutation-keys";

/**
 * The GUI repair route for a fail-closed local store refusal.
 *
 * Scoped to the Epic SESSION's host, not a tile binding. `LOCAL_STORE_UNAVAILABLE`
 * is a snapshot-load failure, so `SnapshotErrorBanner` renders in place of the
 * whole `TileCanvas` body - no tile renderer, and therefore no
 * `<TabHostProvider>`, ever mounts underneath it. Reading `useTabHostClient()`
 * here reached the throwing `useTabHostId()` and crashed the one screen whose
 * entire job is to offer the recovery.
 */
export function useLocalStoreRebindMutation(): UseMutationResult<
  ResponseOfMethod<HostRpcRegistry, "host.rebindLocalStore">,
  HostRpcError,
  RequestOfMethod<HostRpcRegistry, "host.rebindLocalStore">
> {
  const sessionHostId = useEpicSessionHostId();
  const directory = useHostDirectoryList();
  const entry = useMemo(
    () =>
      sessionHostId === null
        ? null
        : ((directory.data ?? []).find((e) => e.hostId === sessionHostId) ??
          null),
    [directory.data, sessionHostId],
  );
  const client = useHostClientFor(entry);
  return useHostMutation<HostRpcRegistry, "host.rebindLocalStore">({
    client,
    method: "host.rebindLocalStore",
    mapVariables: (variables) => variables,
    options: {
      mutationKey: localStoreMutationKeys.rebind(),
      // A refusal is a successful response arm with its own inline surface. A
      // rejected RPC - host gone, method unavailable - has none, and without
      // this the confirmation just stops looking busy and says nothing.
      onError: (error) => {
        toastFromHostError(error, "Could not rebind the local store.");
      },
    },
  });
}
