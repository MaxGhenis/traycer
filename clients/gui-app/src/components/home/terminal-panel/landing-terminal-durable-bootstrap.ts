import { useEffect, useRef, useState } from "react";
import type { PlainTerminalProjection } from "@traycer/protocol/host/terminal/plain-schemas";

export type LandingTerminalDurableBootstrapAction =
  "create" | "ensure-running" | "none";

export function resolveLandingTerminalDurableBootstrapAction(input: {
  readonly projectionStatus: "running" | "dormant" | "missing";
  readonly pendingCreate: boolean;
  readonly active: boolean;
}): LandingTerminalDurableBootstrapAction {
  if (input.projectionStatus === "missing") {
    return input.pendingCreate ? "create" : "none";
  }
  if (input.projectionStatus === "dormant" && input.active) {
    return "ensure-running";
  }
  return "none";
}

export interface LandingTerminalDurableLifecycleResult {
  readonly requestSettled: boolean;
  readonly requestError: Error | null;
  readonly retry: () => void;
}

/**
 * Dispatches at most once per authoritative missing/dormant episode. Seeing a
 * running projection arms the next dormant episode, so one mounted tile can
 * survive any number of host restart/crash cycles without hot-looping on a
 * stable dormant failure.
 */
export function useLandingTerminalDurableLifecycle(args: {
  readonly projectionStatus: "running" | "dormant" | "missing";
  readonly pendingCreate: boolean;
  readonly active: boolean;
  readonly canMutate: boolean;
  readonly gridReady: boolean;
  readonly dispatch: (
    action: Exclude<LandingTerminalDurableBootstrapAction, "none">,
  ) => Promise<PlainTerminalProjection>;
  readonly adopt: (terminal: PlainTerminalProjection) => void;
}): LandingTerminalDurableLifecycleResult {
  const {
    active,
    adopt,
    canMutate,
    dispatch,
    gridReady,
    pendingCreate,
    projectionStatus,
  } = args;
  const observedStatusRef = useRef(projectionStatus);
  const dormantEpisodeRef = useRef(0);
  const dispatchedEpisodeRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [requestSettled, setRequestSettled] = useState(false);
  const [requestError, setRequestError] = useState<Error | null>(null);

  useEffect(() => {
    if (canMutate) return;
    requestGenerationRef.current += 1;
  }, [canMutate]);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (observedStatusRef.current !== projectionStatus) {
      observedStatusRef.current = projectionStatus;
      requestGenerationRef.current += 1;
      setRequestSettled(false);
      setRequestError(null);
      if (projectionStatus === "dormant") {
        dormantEpisodeRef.current += 1;
      }
    }

    const action = resolveLandingTerminalDurableBootstrapAction({
      projectionStatus,
      pendingCreate,
      active,
    });
    if (action === "none" || !canMutate || !gridReady) return;
    const episode =
      action === "create"
        ? "create"
        : `ensure-running:${dormantEpisodeRef.current}`;
    if (dispatchedEpisodeRef.current === episode) return;
    dispatchedEpisodeRef.current = episode;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setRequestError(null);
    void dispatch(action).then(
      (terminal) => {
        if (requestGenerationRef.current !== requestGeneration) return;
        adopt(terminal);
        setRequestSettled(true);
      },
      (error: unknown) => {
        if (requestGenerationRef.current !== requestGeneration) return;
        setRequestError(
          error instanceof Error
            ? error
            : new Error("Could not start terminal."),
        );
      },
    );
  }, [
    active,
    adopt,
    canMutate,
    dispatch,
    gridReady,
    pendingCreate,
    projectionStatus,
    retryGeneration,
  ]);

  const retry = (): void => {
    requestGenerationRef.current += 1;
    dispatchedEpisodeRef.current = null;
    setRequestSettled(false);
    setRequestError(null);
    setRetryGeneration((current) => current + 1);
  };

  return { requestSettled, requestError, retry };
}
