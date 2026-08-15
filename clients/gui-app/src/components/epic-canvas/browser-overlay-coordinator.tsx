import { use, useEffect, useMemo } from "react";
import {
  clearBrowserViewSnapshot,
  collectBrowserOverlaySurfaces,
  listBrowserOverlayTiles,
  markBrowserViewSnapshotStale,
  resolveBrowserOverlayOcclusionTargets,
  setBrowserViewSnapshot,
  subscribeBrowserOverlayLayout,
} from "@/lib/browser-view/browser-overlay-coordinator";
import {
  type BrowserViewOverlayOcclusion,
  type BrowserViewOverlayOcclusionResult,
  type BrowserViewOverlayRelease,
  type BrowserViewOverlayReleaseResult,
  type BrowserViewTileKey,
  type DesktopBrowserViewBridge,
  resolveDesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";
import {
  type DesktopAgentBrowserViewBridge,
  resolveDesktopAgentBrowserViewBridge,
} from "@/lib/browser-view/desktop-agent-browser-view";
import { RunnerHostContext } from "@/providers/runner-host-context";

export function BrowserOverlayCoordinatorBridge() {
  const runnerHost = use(RunnerHostContext);
  const browserView = useMemo(
    () =>
      runnerHost === null ? null : resolveDesktopBrowserViewBridge(runnerHost),
    [runnerHost],
  );
  const agentBrowserView = useMemo(
    () =>
      runnerHost === null
        ? null
        : resolveDesktopAgentBrowserViewBridge(runnerHost),
    [runnerHost],
  );
  return (
    <BrowserOverlayCoordinator
      browserView={browserView}
      agentBrowserView={agentBrowserView}
    />
  );
}

function BrowserOverlayCoordinator(props: {
  readonly browserView: DesktopBrowserViewBridge | null;
  readonly agentBrowserView: DesktopAgentBrowserViewBridge | null;
}): null {
  useEffect(() => {
    const browserView = props.browserView;
    const agentBrowserView = props.agentBrowserView;
    if (browserView === null) return;

    // A tile's entries live in whichever manager created it (primary vs.
    // agent) - the renderer-side registry above does not track which one.
    // Broadcast the same occlude/release call to both; each manager
    // silently no-ops the tile keys it does not own (see
    // `occludeEntryForOverlay`), so this stays correct without tagging
    // every registered tile by origin.
    const broadcastOcclude = (
      input: BrowserViewOverlayOcclusion,
    ): Promise<BrowserViewOverlayOcclusionResult> => {
      const bridges =
        agentBrowserView === null
          ? [browserView]
          : [browserView, agentBrowserView];
      return Promise.allSettled(
        bridges.map((bridge) => bridge.occludeForOverlay(input)),
      ).then((settlements) => {
        const fulfilled = settlements.filter(
          (
            settlement,
          ): settlement is PromiseFulfilledResult<BrowserViewOverlayOcclusionResult> =>
            settlement.status === "fulfilled",
        );
        return {
          snapshots: fulfilled.flatMap(
            (settlement) => settlement.value.snapshots,
          ),
          restoredTiles: fulfilled.flatMap(
            (settlement) => settlement.value.restoredTiles,
          ),
        };
      });
    };

    const broadcastRelease = (
      input: BrowserViewOverlayRelease,
    ): Promise<BrowserViewOverlayReleaseResult> => {
      const bridges =
        agentBrowserView === null
          ? [browserView]
          : [browserView, agentBrowserView];
      return Promise.allSettled(
        bridges.map((bridge) => bridge.releaseOverlay(input)),
      ).then((settlements) => ({
        restoredTiles: settlements
          .filter(
            (
              settlement,
            ): settlement is PromiseFulfilledResult<BrowserViewOverlayReleaseResult> =>
              settlement.status === "fulfilled",
          )
          .flatMap((settlement) => settlement.value.restoredTiles),
      }));
    };

    const activeSignaturesByOverlayId = new Map<string, string>();
    let frameId: number | null = null;
    let disposed = false;

    const applyRestoredTiles = (tiles: readonly BrowserViewTileKey[]): void => {
      tiles.forEach((tile) => {
        clearBrowserViewSnapshot(tile);
      });
    };

    const scheduleScan = (): void => {
      if (disposed) return;
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        runScan();
      });
    };

    const releaseOverlay = (overlayId: string): void => {
      activeSignaturesByOverlayId.delete(overlayId);
      void broadcastRelease({ overlayId })
        .then((result) => {
          if (disposed) return;
          applyRestoredTiles(result.restoredTiles);
        })
        .catch(ignoreBrowserOverlayError);
    };

    const runScan = (): void => {
      const targets = resolveBrowserOverlayOcclusionTargets(
        collectBrowserOverlaySurfaces(document.body),
        listBrowserOverlayTiles(),
      );
      const nextTargetsByOverlayId = new Map(
        targets.map((target) => [target.overlayId, target]),
      );

      activeSignaturesByOverlayId.forEach((_signature, overlayId) => {
        if (!nextTargetsByOverlayId.has(overlayId)) releaseOverlay(overlayId);
      });

      targets.forEach((target) => {
        if (
          activeSignaturesByOverlayId.get(target.overlayId) === target.signature
        ) {
          return;
        }
        activeSignaturesByOverlayId.set(target.overlayId, target.signature);
        void broadcastOcclude({
          overlayId: target.overlayId,
          tiles: target.tiles,
        })
          .then((result) => {
            if (disposed) return;
            result.snapshots.forEach((snapshot) => {
              setBrowserViewSnapshot(snapshot);
            });
            applyRestoredTiles(result.restoredTiles);
          })
          .catch(ignoreBrowserOverlayError);
      });
    };

    const unsubscribeLayout = subscribeBrowserOverlayLayout(scheduleScan);
    const invalidationSubscription = browserView.onSnapshotInvalidated(
      markBrowserViewSnapshotStale,
    );
    const agentInvalidationSubscription =
      agentBrowserView === null
        ? { dispose: () => undefined }
        : agentBrowserView.onSnapshotInvalidated(
            markBrowserViewSnapshotStale,
          );
    const mutationObserver = new MutationObserver(scheduleScan);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-hidden",
        "class",
        "data-browser-overlay",
        "data-browser-overlay-ignore",
        "data-state",
        "hidden",
        "style",
      ],
    });
    window.addEventListener("resize", scheduleScan, { passive: true });
    window.addEventListener("scroll", scheduleScan, true);
    scheduleScan();

    return () => {
      disposed = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      unsubscribeLayout();
      invalidationSubscription.dispose();
      agentInvalidationSubscription.dispose();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleScan);
      window.removeEventListener("scroll", scheduleScan, true);
      activeSignaturesByOverlayId.forEach((_signature, overlayId) => {
        void broadcastRelease({ overlayId })
          .then((result) => {
            applyRestoredTiles(result.restoredTiles);
          })
          .catch(ignoreBrowserOverlayError);
      });
      activeSignaturesByOverlayId.clear();
    };
  }, [props.browserView, props.agentBrowserView]);

  return null;
}

function ignoreBrowserOverlayError(_error: unknown): void {}
