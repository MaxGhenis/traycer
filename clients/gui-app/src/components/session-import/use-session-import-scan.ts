import { useEffect, useReducer, useRef } from "react";
import { SessionImportScanClient } from "@traycer-clients/shared/host-transport/session-import-scan-client";
import { useWsStreamClient } from "@/lib/host/stream-runtime-context";
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
  const [state, dispatch] = useReducer(
    sessionImportWizardReducer,
    SESSION_IMPORT_INITIAL_STATE,
  );
  const clientRef = useRef<SessionImportScanClient | null>(null);

  useEffect(() => {
    if (!active) return;
    if (wsStreamClient === null) return;

    dispatch({ kind: "scanRestarted" });
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
  }, [active, wsStreamClient]);

  return { state, dispatch };
}
