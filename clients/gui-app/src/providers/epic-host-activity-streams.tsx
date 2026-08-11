import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useHostDirectoryEntry } from "@/hooks/host/use-host-directory-entry";
import { useHostStreamClientFor } from "@/hooks/host/use-host-stream-client-for";
import { useStreamAuthRevalidator } from "@/lib/host/stream-auth-revalidator";
import {
  openEpicHostIds,
  registry,
} from "@/lib/registries/epic-session-registry";
import { openAgentActivityStream } from "@/stores/agent-activity-store";

/**
 * Agent activity from the hosts the user's open epics actually live on
 * (`s5-parity-gaps` gap 1).
 *
 * ## What was wrong
 *
 * Production opened exactly ONE activity stream, pinned to the local host, so
 * an agent running on a REMOTE host against a cloud-homed epic rendered as
 * nothing happening. The prior panel approved a single-client cut for
 * PRESENCE; this was wider than that, and it is a truthfulness defect rather
 * than a cleared one - the UI states "idle" where it has no idea.
 *
 * ## Why per-open-epic and not per-directory-entry
 *
 * A stream for every host in the directory would open a relay connection per
 * machine the account has ever registered, most of which the user is not
 * looking at. The hosts whose activity is observable are the hosts their open
 * epic sessions are bound to - a set that is small, already dialed for the
 * epic itself, and shrinks the moment the tab closes.
 *
 * The LOCAL host is deliberately NOT handled here.
 * `NotificationsSessionProvider` owns that stream, on the G8 local-host pin,
 * and this component skips it so the two cannot both write the same slice.
 */
export function EpicHostActivityStreams(props: {
  readonly localHostId: string | null;
  readonly onAuthError: () => void;
}): ReactNode {
  const hostIds = useOpenEpicHostIds();
  const localHostId = props.localHostId;
  const remoteHostIds = useMemo(
    () => hostIds.filter((hostId) => hostId !== localHostId),
    [hostIds, localHostId],
  );
  return (
    <>
      {remoteHostIds.map((hostId) => (
        <EpicHostActivityStream
          key={hostId}
          hostId={hostId}
          onAuthError={props.onAuthError}
        />
      ))}
    </>
  );
}

/**
 * One host's stream. A component rather than a loop inside the parent because
 * the host client is resolved by a hook, and hooks cannot be called per item.
 */
function EpicHostActivityStream(props: {
  readonly hostId: string;
  readonly onAuthError: () => void;
}): ReactNode {
  const entry = useHostDirectoryEntry(props.hostId);
  const streamAuth = useStreamAuthRevalidator();
  const streamClient = useHostStreamClientFor(entry, streamAuth);
  const hostId = props.hostId;
  const onAuthError = props.onAuthError;
  useEffect(() => {
    if (streamClient === null) return;
    return openAgentActivityStream(hostId, streamClient, onAuthError);
  }, [hostId, onAuthError, streamClient]);
  return null;
}

/**
 * The open-epic host set, as a `useSyncExternalStore` snapshot.
 *
 * `openEpicHostIds()` allocates a fresh array each call, so a naive snapshot
 * would tear down and reopen every stream on any registry event. The identity
 * guard keys on the joined ids, which is what actually decides the streams.
 */
function useOpenEpicHostIds(): readonly string[] {
  const cache = useMemo(
    () => ({ key: "", value: [] as readonly string[] }),
    [],
  );
  const subscribe = useCallback(
    (callback: () => void) => registry.subscribe(callback),
    [],
  );
  const getSnapshot = useCallback(() => {
    const next = openEpicHostIds();
    const key = next.join(" ");
    if (key === cache.key) return cache.value;
    cache.key = key;
    cache.value = next;
    return next;
  }, [cache]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
