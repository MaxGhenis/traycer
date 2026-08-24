import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isRelayFuseRecoveryCandidate } from "@traycer-clients/shared/host-client/remote-fetcher";
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import { useHostDirectoryList } from "@/hooks/host/use-host-directory-list-query";
import { useRemoteSessionsPollReadiness } from "@/hooks/host/use-remote-sessions-poll-readiness";
import { dialableHostEndpointFor } from "@/lib/host/transport-key";
import {
  useLandingTerminalStore,
  type LandingTerminalPendingKill,
} from "@/stores/home/landing-terminal-store";
import { useLandingTerminalKill } from "@/components/home/terminal-panel/use-landing-terminal-kill-mutation";
import {
  LandingTerminalAuthorityFleet,
  type LandingTerminalAuthorityEntries,
  type LandingTerminalAuthorityEntry,
} from "@/components/home/terminal-panel/landing-terminal-authority-fleet";
import { terminalSessionKey } from "@/stores/home/landing-terminal-store";
import { getPlainTerminal } from "@/lib/terminals/plain-terminal-authority";

const CLOSE_RETRY_BASE_MS = 500;
const CLOSE_RETRY_MAX_MS = 8_000;

interface CloseRetry {
  attempt: number;
  timer: number | null;
  due: boolean;
}

interface TombstoneRetryRefs {
  readonly authorityEntries: {
    current: LandingTerminalAuthorityEntries;
  };
  readonly dialable: { current: ReadonlyMap<string, boolean> };
  readonly inFlight: { current: ReadonlySet<string> };
  readonly mounted: { current: boolean };
  readonly retries: { current: Map<string, CloseRetry> };
}

function hostCanDrainLandingTerminalTombstones(
  directoryEntry: HostDirectoryEntry,
  hasReadySession: boolean,
  authorityEntry: LandingTerminalAuthorityEntry | undefined,
): boolean {
  const routeReady =
    dialableHostEndpointFor(directoryEntry, hasReadySession) !== null &&
    (hasReadySession || !isRelayFuseRecoveryCandidate(directoryEntry));
  const authority = authorityEntry?.authority;
  const authorityReady =
    authority?.capability.status === "legacy" ||
    (authority?.capability.status === "capable" && authority.canMutate);
  return routeReady && authorityReady;
}

function clearCloseRetry(retries: Map<string, CloseRetry>, key: string): void {
  const retry = retries.get(key);
  if (retry !== undefined && retry.timer !== null) {
    clearTimeout(retry.timer);
  }
  retries.delete(key);
}

function cancelUndrainableCloseRetries(args: {
  readonly retries: Map<string, CloseRetry>;
  readonly pendingKeys: ReadonlySet<string>;
  readonly drainableByHostId: ReadonlyMap<string, boolean>;
}): void {
  for (const key of args.retries.keys()) {
    const hostId = key.slice(0, key.indexOf("\u0000"));
    if (
      args.pendingKeys.has(key) &&
      args.drainableByHostId.get(hostId) === true
    ) {
      continue;
    }
    clearCloseRetry(args.retries, key);
  }
}

function tombstoneDispatchIsDue(args: {
  readonly routeRecovered: boolean;
  readonly pendingAdded: boolean;
  readonly authorityChanged: boolean;
  readonly retryDue: boolean;
  readonly pendingCreate: boolean;
}): boolean {
  return (
    args.routeRecovered ||
    args.pendingAdded ||
    args.authorityChanged ||
    args.retryDue ||
    args.pendingCreate
  );
}

function scheduleCloseRetry(args: {
  readonly key: string;
  readonly pending: LandingTerminalPendingKill;
  readonly refs: TombstoneRetryRefs;
  readonly signalRetry: () => void;
  readonly canRetry: () => boolean;
}): void {
  if (!args.refs.mounted.current) return;
  const stillPending = useLandingTerminalStore
    .getState()
    .pendingKills.some(
      (candidate) =>
        candidate.hostId === args.pending.hostId &&
        candidate.sessionId === args.pending.sessionId,
    );
  if (
    !stillPending ||
    args.refs.dialable.current.get(args.pending.hostId) !== true ||
    !args.canRetry()
  ) {
    return;
  }
  const prior = args.refs.retries.current.get(args.key);
  if (prior !== undefined && prior.timer !== null) return;
  const attempt = (prior?.attempt ?? 0) + 1;
  const retryDelay = Math.min(
    CLOSE_RETRY_BASE_MS * 2 ** (attempt - 1),
    CLOSE_RETRY_MAX_MS,
  );
  const nextRetry: CloseRetry = {
    attempt,
    timer: null,
    due: false,
  };
  nextRetry.timer = window.setTimeout(() => {
    if (!args.refs.mounted.current) return;
    nextRetry.timer = null;
    nextRetry.due = true;
    args.signalRetry();
  }, retryDelay);
  args.refs.retries.current.set(args.key, nextRetry);
}

function dispatchCapableClose(args: {
  readonly entry: LandingTerminalAuthorityEntry;
  readonly key: string;
  readonly pending: LandingTerminalPendingKill;
  readonly retry: CloseRetry | undefined;
  readonly refs: TombstoneRetryRefs;
  readonly signalRetry: () => void;
}): void {
  if (
    getPlainTerminal(
      args.entry.authority.collection,
      args.pending.hostId,
      args.pending.sessionId,
    ) === undefined
  ) {
    if (args.pending.pendingCreate === true) return;
    useLandingTerminalStore
      .getState()
      .clearPendingKill(args.pending.hostId, args.pending.sessionId);
    clearCloseRetry(args.refs.retries.current, args.key);
    return;
  }
  if (args.retry !== undefined) args.retry.due = false;
  args.refs.inFlight.current = new Set([
    ...args.refs.inFlight.current,
    args.key,
  ]);
  void args.entry.mutations.close
    .mutateAsync({
      hostId: args.pending.hostId,
      terminalId: args.pending.sessionId,
    })
    .then(
      () => {
        useLandingTerminalStore
          .getState()
          .clearPendingKill(args.pending.hostId, args.pending.sessionId);
        clearCloseRetry(args.refs.retries.current, args.key);
      },
      () =>
        scheduleCloseRetry({
          ...args,
          canRetry: () => {
            const currentEntry =
              args.refs.authorityEntries.current[args.pending.hostId];
            return (
              currentEntry?.authority.capability.status === "capable" &&
              currentEntry.authority.canMutate &&
              getPlainTerminal(
                currentEntry.authority.collection,
                args.pending.hostId,
                args.pending.sessionId,
              ) !== undefined
            );
          },
        }),
    )
    .finally(() => {
      const next = new Set(args.refs.inFlight.current);
      next.delete(args.key);
      args.refs.inFlight.current = next;
      args.signalRetry();
    });
}

/**
 * Drains durable landing-terminal close tombstones when their bound host
 * returns. This lives above the router so leaving the landing page cannot
 * strand an offline-close shell until the user happens to return home.
 */
export function LandingTerminalTombstoneRecoveryBridge(): ReactNode {
  const directory = useHostDirectoryList();
  const pendingKills = useLandingTerminalStore((state) => state.pendingKills);
  const kill = useLandingTerminalKill();
  const killRef = useRef(kill);
  const inFlightRef = useRef<ReadonlySet<string>>(new Set());
  const pendingKeysRef = useRef<ReadonlySet<string>>(new Set());
  const authorityStatusRef = useRef<ReadonlyMap<string, string>>(new Map());
  const retriesRef = useRef<Map<string, CloseRetry>>(new Map());
  const mountedRef = useRef(true);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [authorityEntries, setAuthorityEntries] =
    useState<LandingTerminalAuthorityEntries>({});
  const handleAuthorityEntry = useCallback(
    (hostId: string, entry: LandingTerminalAuthorityEntry | null): void => {
      setAuthorityEntries((current) => {
        if (entry !== null) {
          if (current[hostId] === entry) return current;
          return { ...current, [hostId]: entry };
        }
        if (current[hostId] === undefined) return current;
        const next = { ...current };
        delete next[hostId];
        return next;
      });
    },
    [],
  );
  // Coarse, through the canonical rule. The edge this watches is "a route to
  // that host exists again", because what it does on that edge is send an RPC —
  // there is no copy here and nobody sees this. Asking `dialableHostEndpoint`
  // rather than the bit keeps it agreeing with the layer that will carry the
  // kill: an `indeterminate` host is dialable, so the tombstone drains and the
  // mutation either lands or fails on its own evidence, instead of waiting
  // forever on a liveness read that may never come back.
  //
  // It is also why the edge is "became DIALABLE" rather than "became
  // available": a host recovering from a stall goes unavailable -> busy and may
  // sit there, and busy is dialable, so an `=== "available"` edge would simply
  // never fire and would strand the tombstone with the host terminal alive.
  //
  // One dial-permission state is deliberately EXCLUDED from the recorded bit:
  // a registry-`offline` host inside the relay-fuse window
  // (`isRelayFuseRecoveryCandidate`). There the endpoint is non-null because a
  // recovery dial is PERMITTED, not because the host is there - recording that
  // speculative permission as `true` made a close-during-grace followed by a
  // genuine offline -> connectable recovery a `true -> true` non-edge, so the
  // kill never re-fired and the tombstoned PTY outlived its tab until
  // relaunch. `indeterminate` keeps recording `true` (the paragraph above),
  // because unlike a fuse-window `offline` it may never resolve.
  //
  // A READY remote session overrides that exclusion: it is proof the host is
  // actually attached, not speculation - the recovery dial the fuse window
  // kept open has SUCCEEDED. If the registry stays `offline` for the rest of
  // the credential-plane incident, that session is the only evidence of the
  // recovery there will be, and it is also the very route the kill travels.
  // The session cache is pull-only, so the subscription below - not the
  // directory - is what re-runs this effect when a session becomes ready.
  const dialableRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  const directoryHostIds = useMemo(
    () => (directory.data ?? []).map((entry) => entry.hostId),
    [directory.data],
  );
  const authorityHostIds = useMemo(
    () => [...new Set(pendingKills.map((pending) => pending.hostId))],
    [pendingKills],
  );
  const hasReadySessionFor = useRemoteSessionsPollReadiness(directoryHostIds);
  const authorityEntriesRef = useRef(authorityEntries);

  useEffect(() => {
    killRef.current = kill;
  }, [kill]);

  useEffect(() => {
    authorityEntriesRef.current = authorityEntries;
  }, [authorityEntries]);

  useEffect(() => {
    mountedRef.current = true;
    const retries = retriesRef.current;
    return () => {
      mountedRef.current = false;
      for (const retry of retries.values()) {
        if (retry.timer !== null) clearTimeout(retry.timer);
      }
      retries.clear();
    };
  }, []);

  useEffect(() => {
    const entries = directory.data ?? [];
    const currentDrainable = new Map(
      entries.map((entry) => [
        entry.hostId,
        hostCanDrainLandingTerminalTombstones(
          entry,
          hasReadySessionFor(entry.hostId),
          authorityEntries[entry.hostId],
        ),
      ]),
    );
    const previousDialable = dialableRef.current;
    dialableRef.current = currentDrainable;
    const retryRefs: TombstoneRetryRefs = {
      authorityEntries: authorityEntriesRef,
      dialable: dialableRef,
      inFlight: inFlightRef,
      mounted: mountedRef,
      retries: retriesRef,
    };

    const pendingKeys = new Set(
      pendingKills.map((pending) =>
        terminalSessionKey(pending.hostId, pending.sessionId),
      ),
    );
    const previousPendingKeys = pendingKeysRef.current;
    pendingKeysRef.current = pendingKeys;
    const currentAuthorityStatus = new Map(
      Object.entries(authorityEntries).map(([hostId, entry]) => [
        hostId,
        entry?.authority.capability.status ?? "missing",
      ]),
    );
    const previousAuthorityStatus = authorityStatusRef.current;
    authorityStatusRef.current = currentAuthorityStatus;
    cancelUndrainableCloseRetries({
      retries: retriesRef.current,
      pendingKeys,
      drainableByHostId: currentDrainable,
    });

    if (pendingKills.length === 0) return;

    for (const pending of pendingKills) {
      if (currentDrainable.get(pending.hostId) !== true) continue;
      const key = terminalSessionKey(pending.hostId, pending.sessionId);
      const retry = retriesRef.current.get(key);
      const routeRecovered = previousDialable.get(pending.hostId) !== true;
      const pendingAdded = !previousPendingKeys.has(key);
      const authorityChanged =
        previousAuthorityStatus.get(pending.hostId) !==
        currentAuthorityStatus.get(pending.hostId);
      if (
        !tombstoneDispatchIsDue({
          routeRecovered,
          pendingAdded,
          authorityChanged,
          retryDue: retry?.due === true,
          pendingCreate: pending.pendingCreate === true,
        })
      )
        continue;
      if (inFlightRef.current.has(key)) continue;
      const entry = authorityEntries[pending.hostId];
      if (entry !== undefined && pending.legacyEvidence === true) {
        if (retry !== undefined) retry.due = false;
        inFlightRef.current = new Set([...inFlightRef.current, key]);
        void killRef.current
          .mutateAsync({
            hostId: pending.hostId,
            sessionId: pending.sessionId,
          })
          .then(
            () => clearCloseRetry(retriesRef.current, key),
            () =>
              scheduleCloseRetry({
                key,
                pending,
                refs: retryRefs,
                canRetry: () => true,
                signalRetry: () => setRetryGeneration((current) => current + 1),
              }),
          )
          .finally(() => {
            const next = new Set(inFlightRef.current);
            next.delete(key);
            inFlightRef.current = next;
            setRetryGeneration((current) => current + 1);
          });
        continue;
      }
      if (entry?.authority.capability.status === "capable") {
        dispatchCapableClose({
          entry,
          key,
          pending,
          retry,
          refs: retryRefs,
          signalRetry: () => setRetryGeneration((current) => current + 1),
        });
      }
    }
  }, [
    authorityEntries,
    directory.data,
    pendingKills,
    hasReadySessionFor,
    retryGeneration,
  ]);

  return (
    <LandingTerminalAuthorityFleet
      hostIds={authorityHostIds}
      onEntry={handleAuthorityEntry}
    />
  );
}
