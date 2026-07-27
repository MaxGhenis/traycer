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
  type BrowserViewTileKey,
  type DesktopBrowserViewBridge,
  resolveDesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";
import { RunnerHostContext } from "@/providers/runner-host-context";

export function BrowserOverlayCoordinatorBridge() {
  const runnerHost = use(RunnerHostContext);
  const browserView = useMemo(
    () =>
      runnerHost === null ? null : resolveDesktopBrowserViewBridge(runnerHost),
    [runnerHost],
  );
  return <BrowserOverlayCoordinator browserView={browserView} />;
}

function BrowserOverlayCoordinator(props: {
  readonly browserView: DesktopBrowserViewBridge | null;
}): null {
  useEffect(() => {
    const browserView = props.browserView;
    if (browserView === null) return;

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
      void browserView
        .releaseOverlay({ overlayId })
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
        void browserView
          .occludeForOverlay({
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
      (change) => {
        markBrowserViewSnapshotStale(change);
      },
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
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleScan);
      window.removeEventListener("scroll", scheduleScan, true);
      activeSignaturesByOverlayId.forEach((_signature, overlayId) => {
        void browserView
          .releaseOverlay({ overlayId })
          .then((result) => {
            applyRestoredTiles(result.restoredTiles);
          })
          .catch(ignoreBrowserOverlayError);
      });
      activeSignaturesByOverlayId.clear();
    };
  }, [props.browserView]);

  return null;
}

function ignoreBrowserOverlayError(_error: unknown): void {}
