import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTabHostId } from "@/components/epic-canvas/hooks/use-tab-host-id";
import { useTileBodyVisible } from "@/components/epic-canvas/hooks/use-tile-body-visible";
import {
  resolveDesktopAgentBrowserViewBridge,
  type AgentBrowserViewTileKey,
  type DesktopAgentBrowserViewBridge,
} from "@/lib/browser-view/desktop-agent-browser-view";
import type { BrowserViewStatus } from "@/lib/browser-view/desktop-browser-view";
import { PANEL_RESIZING_CLASS_NAME } from "@/lib/layout/panel-resizing-class";
import { useRunnerHost } from "@/providers/use-runner-host";
import type { AgentBrowserTileRef } from "@/stores/epics/canvas/types";

export interface AgentBrowserTileProps {
  readonly node: AgentBrowserTileRef;
  readonly viewTabId: string;
  readonly paneId: string;
}

/**
 * The agent's own browser tile: a real `WebContentsView` in a
 * credential-free partition, watchable and clickable but not (yet) driven
 * from here - driving is ticket 04+'s REPL surface. Deliberately does not
 * reuse `BrowserTile`'s chrome (address bar, zoom, find, devtools,
 * download/certificate UI, overlay-occlusion snapshotting): those are
 * driving/UX concerns this ticket does not build, not things forgotten.
 */
export function AgentBrowserTile(props: AgentBrowserTileProps) {
  const hostId = useTabHostId();
  const runnerHost = useRunnerHost();
  const visible = useTileBodyVisible();
  const browserView = useMemo(
    () => resolveDesktopAgentBrowserViewBridge(runnerHost),
    [runnerHost],
  );
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<BrowserViewStatus>("loading");
  const [statusReason, setStatusReason] = useState<string | null>(null);

  const tileKey = useMemo<AgentBrowserViewTileKey>(
    () => ({
      viewTabId: props.viewTabId,
      paneId: props.paneId,
      tileInstanceId: props.node.instanceId,
      pageSessionId: props.node.id,
    }),
    [props.viewTabId, props.paneId, props.node.instanceId, props.node.id],
  );

  const effectiveStatus: BrowserViewStatus =
    browserView === null ? "dead" : status;
  const effectiveStatusReason =
    browserView === null
      ? "Native browser views are unavailable."
      : statusReason;

  useEffect(() => {
    if (browserView === null) return;
    return () => {
      void browserView.releaseTile(tileKey).catch(ignoreAgentBrowserViewError);
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null) return;
    void browserView
      .upsertTile({ ...tileKey, url: props.node.url, visible })
      .catch(ignoreAgentBrowserViewError);
  }, [browserView, tileKey, props.node.url, visible]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onStatusChange((change) => {
      if (!isChangeForTile(change, tileKey)) return;
      setStatus(change.status);
      setStatusReason(change.reason);
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, tileKey]);

  useAgentBrowserViewBoundsBridge({
    browserView,
    surfaceRef,
    tileKey,
    visible,
  });

  return (
    <div
      className="flex h-full w-full flex-col bg-canvas text-foreground"
      data-testid={`agent-browser-tile-${props.node.instanceId}`}
    >
      <div ref={surfaceRef} className="relative min-h-0 flex-1 bg-background">
        <div
          className={
            effectiveStatus === "ready"
              ? "pointer-events-none absolute inset-0 flex min-h-0 flex-col items-center justify-center gap-3 px-4 text-center opacity-0"
              : "absolute inset-0 flex min-h-0 flex-col items-center justify-center gap-3 px-4 text-center"
          }
        >
          <div className="text-ui-base font-medium">
            {effectiveStatus === "dead"
              ? "Agent browser unavailable"
              : "Loading page"}
          </div>
          <div className="max-w-[min(90vw,32rem)] text-ui-sm text-muted-foreground">
            {effectiveStatusReason ?? `Host ${hostId}`}
          </div>
        </div>
      </div>
    </div>
  );
}

function isChangeForTile(
  change: AgentBrowserViewTileKey,
  key: AgentBrowserViewTileKey,
): boolean {
  return (
    change.viewTabId === key.viewTabId &&
    change.paneId === key.paneId &&
    change.tileInstanceId === key.tileInstanceId &&
    change.pageSessionId === key.pageSessionId
  );
}

function ignoreAgentBrowserViewError(_error: unknown): void {}

interface UseAgentBrowserViewBoundsBridgeArgs {
  readonly browserView: DesktopAgentBrowserViewBridge | null;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly tileKey: AgentBrowserViewTileKey;
  readonly visible: boolean;
}

function useAgentBrowserViewBoundsBridge(
  args: UseAgentBrowserViewBoundsBridgeArgs,
): void {
  const { browserView, surfaceRef, tileKey, visible } = args;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (browserView === null || surface === null || !visible) return;

    let frameId: number | null = null;
    let frozen = document.documentElement.classList.contains(
      PANEL_RESIZING_CLASS_NAME,
    );

    const sendBounds = (force: boolean): void => {
      const rect = surface.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (frozen && !force) return;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        void browserView
          .updateBounds({
            ...tileKey,
            bounds: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
          })
          .catch(ignoreAgentBrowserViewError);
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      sendBounds(false);
    });
    const mutationObserver = new MutationObserver(() => {
      const nextFrozen = document.documentElement.classList.contains(
        PANEL_RESIZING_CLASS_NAME,
      );
      if (frozen && !nextFrozen) {
        frozen = false;
        sendBounds(true);
        return;
      }
      frozen = nextFrozen;
    });
    resizeObserver.observe(surface);
    mutationObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
    window.addEventListener("resize", handleWindowResize, { passive: true });
    sendBounds(false);

    function handleWindowResize(): void {
      sendBounds(false);
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [browserView, surfaceRef, tileKey, visible]);
}
