import { useEffect, useReducer, useRef } from "react";
import { SessionImportScanClient } from "@traycer-clients/shared/host-transport/session-import-scan-client";
import {
  useStreamHostId,
  useWsStreamClient,
} from "@/lib/host/stream-runtime-context";
import {
  SESSION_IMPORT_INITIAL_STATE,
  sessionImportWizardReducer,
  type SessionImportWizardAction,
  type SessionImportWizardState,
} from "@/components/session-import/session-import-model";

export interface SessionImportScanHandle {
  readonly state: SessionImportWizardState;
  readonly dispatch: (action: SessionImportWizardAction) => void;
}

/**
 * Runs one scan for the lifetime of an open wizard and folds its frames into
 * the wizard reducer.
 *
 * Subscribing is what makes the host read `~/.claude` and `~/.codex` at all
 * (D13: no background scanning), so this is deliberately mounted by the wizard
 * and torn down with it. Unlike the run, a dropped scan costs nothing but a
 * re-read, so there is no attach-and-resume story here.
 */
export function useSessionImportScan(active: boolean): SessionImportScanHandle {
  const wsStreamClient = useWsStreamClient();
  // Taken off the same binding as the client above, never from the active-host
  // hook, so the machine named here is the machine this scan is reading (see
  // `StreamRuntimeBinding.hostId`).
  const streamHostId = useStreamHostId();
  const [state, dispatch] = useReducer(
    sessionImportWizardReducer,
    SESSION_IMPORT_INITIAL_STATE,
  );
  const clientRef = useRef<SessionImportScanClient | null>(null);
  // The machine the live subscription is reading, or `null` while there is no
  // subscription. It is what tells the two restarts apart, and the host is the
  // load-bearing half: a replacement client dialing the SAME machine is the
  // transport coming back under a user halfway through picking rows, so their
  // groups and ticks survive it, while one dialing a DIFFERENT machine is a
  // different set of sessions entirely. Keeping the old host's groups there
  // would leave path-keyed folders the new host may not have and submit native
  // session ids it has never seen. An unnameable host falls to the clearing
  // restart on purpose - unable to prove it is the same machine is not
  // evidence that it is.
  const scannedHostIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      scannedHostIdRef.current = null;
      return;
    }
    if (wsStreamClient === null) return;

    const sameHost =
      streamHostId !== null && streamHostId === scannedHostIdRef.current;
    dispatch({
      kind: "scanRestarted",
      reason: sameHost ? "reconnect" : "fresh",
    });
    scannedHostIdRef.current = streamHostId;
    const client = new SessionImportScanClient({
      wsStreamClient,
      providers: null,
      callbacks: {
        onStarted: () => {
          // `started` names the providers being scanned; the wizard's own
          // filter already lists both, and an empty result reads the same
          // whether a provider was skipped or simply had nothing.
        },
        onGroup: (group) => {
          dispatch({ kind: "scanGroupArrived", group });
        },
        onProviderFailed: (failure) => {
          dispatch({ kind: "scanProviderFailed", failure });
        },
        onComplete: (totals) => {
          dispatch({ kind: "scanCompleted", totals });
        },
        onConnectionStatus: (_status, reason) => {
          // A `caller` close is this effect's own teardown, not a failure.
          if (reason === null || reason.kind !== "fatalError") return;
          dispatch({ kind: "scanFailed", detail: reason.details.reason });
        },
      },
    });
    clientRef.current = client;

    return () => {
      clientRef.current = null;
      client.close();
    };
  }, [active, wsStreamClient, streamHostId]);

  return { state, dispatch };
}
