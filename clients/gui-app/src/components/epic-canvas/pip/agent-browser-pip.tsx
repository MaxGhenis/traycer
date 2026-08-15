import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type SetStateAction,
} from "react";
import { Maximize2, X } from "lucide-react";
import type { BrowserScreencastServerFrame } from "@traycer/protocol/host/browser/contracts";
import type { IHostStreamClient } from "@traycer-clients/shared/host-transport/host-stream-client";
import type { HostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { useHostDirectoryEntry } from "@/hooks/host/use-host-directory-entry";
import { useHostStreamClientFor } from "@/hooks/host/use-host-stream-client-for";
import { useReactiveActiveHostId } from "@/hooks/host/use-reactive-active-host-id";
import { useStreamAuthRevalidator } from "@/lib/host/stream-auth-revalidator";
import {
  browserTabFaviconUrl,
  browserTabHostname,
  resolveTabTitle,
} from "@/lib/browser-view/browser-tab-display";
import {
  findElectronBrowserTabBinding,
  useElectronBrowserTabBinding,
  type ElectronBrowserTabRegistration,
} from "@/lib/browser-view/electron-browser-tab-store";
import {
  clampPipGeometry,
  defaultPipGeometry,
  geometryForCorner,
  nextPipCorner,
  PIP_NUDGE_PX,
  PIP_RESIZE_STEP_PX,
  readViewportSize,
} from "@/lib/browser-view/pip-geometry";
import {
  findPipEpicSession,
  usePipEpicSessionItems,
} from "@/lib/browser-view/pip-epic-sessions";
import { pipGoneTabCopy, pipOutcomeLine } from "@/lib/browser-view/pip-copy";
import {
  applyPipStreamHealth,
  dismissPip,
  dismissPipChip,
  getPipSnapshot,
  PIP_CAPTION_FADE_MS,
  PIP_CAPTION_HOLD_MS,
  reexpandPip,
  setPipActiveHostId,
  usePipSnapshot,
  type PipCaption,
  type PipSnapshot,
  type PipTarget,
} from "@/lib/browser-view/pip-store";
import {
  resolveDesktopPipCaptureBridge,
  type DesktopPipCaptureBridge,
} from "@/lib/browser-view/desktop-pip-capture";
import {
  openPipHeadlessStream,
  PIP_HEADLESS_MAX_HEIGHT,
  PIP_HEADLESS_MAX_WIDTH,
  PIP_HEADLESS_QUALITY,
} from "@/lib/browser-view/pip-headless-stream";
import { cn } from "@/lib/utils";
import { useEpicChatRecords } from "@/lib/epic-selectors";
import { useRunnerHostOrNull } from "@/providers/use-runner-host";
import {
  findOpenArtifactInTab,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { makeBrowserSessionTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import type { EpicPipGeometry } from "@/stores/epics/canvas/types";

const PIP_DRAG_CLICK_SLOP_PX = 4;
const PIP_OVERLAY_KIND = "pip";

export function AgentBrowserPip(props: {
  readonly epicId: string;
  readonly viewTabId: string;
  readonly surfaceVisible: boolean;
}): ReactElement | null {
  const activeHostId = useReactiveActiveHostId();
  useEffect(() => {
    setPipActiveHostId(activeHostId);
  }, [activeHostId]);

  const snapshot = usePipSnapshot(props.epicId);
  if (!props.surfaceVisible) return null;
  if (snapshot.phase === "hidden" || snapshot.phase === "dismissed-burst") {
    return null;
  }
  return (
    <AgentBrowserPipSurface
      epicId={props.epicId}
      viewTabId={props.viewTabId}
      snapshot={snapshot}
    />
  );
}

function AgentBrowserPipSurface(props: {
  readonly epicId: string;
  readonly viewTabId: string;
  readonly snapshot: PipSnapshot;
}): ReactElement {
  const { epicId, snapshot } = props;
  const frameSrc = usePipOwnedFrame(epicId, snapshot);
  const persisted = useEpicCanvasStore(
    (state) => state.pipGeometryByEpicId[epicId],
  );
  const setPipGeometry = useEpicCanvasStore((state) => state.setPipGeometry);
  const [viewport, setViewport] = useState(readViewportSize);
  const geometry = useMemo(
    () => clampPipGeometry(persisted ?? defaultPipGeometry(viewport), viewport),
    [persisted, viewport],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<PipPointerSession | null>(null);

  useEffect(() => {
    const onResize = (): void => {
      const nextViewport = readViewportSize();
      setViewport(nextViewport);
      const current =
        useEpicCanvasStore.getState().pipGeometryByEpicId[epicId] ??
        defaultPipGeometry(nextViewport);
      setPipGeometry(epicId, clampPipGeometry(current, nextViewport));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [epicId, setPipGeometry]);

  const commitGeometry = useCallback(
    (next: EpicPipGeometry) => {
      setPipGeometry(epicId, clampPipGeometry(next, readViewportSize()));
    },
    [epicId, setPipGeometry],
  );

  const applyLiveGeometry = useCallback(
    (next: EpicPipGeometry) => {
      const node = rootRef.current;
      if (node === null) return;
      const clamped = clampPipGeometry(next, readViewportSize());
      node.style.left = `${String(clamped.x)}px`;
      node.style.top = `${String(clamped.y)}px`;
      node.style.width = `${String(clamped.width)}px`;
      node.style.height =
        snapshot.phase === "chip" ? "auto" : `${String(clamped.height)}px`;
    },
    [snapshot.phase],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: "move" | "resize") => {
      if (event.button !== 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest("button") !== null
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const origin = geometry;
      dragRef.current = {
        pointerId: event.pointerId,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        origin,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [geometry],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (
        Math.abs(dx) > PIP_DRAG_CLICK_SLOP_PX ||
        Math.abs(dy) > PIP_DRAG_CLICK_SLOP_PX
      ) {
        drag.moved = true;
      }
      if (drag.mode === "move") {
        applyLiveGeometry({
          ...drag.origin,
          x: drag.origin.x + dx,
          y: drag.origin.y + dy,
        });
        return;
      }
      applyLiveGeometry({
        ...drag.origin,
        width: drag.origin.width + dx,
        height: drag.origin.height + dy,
      });
    },
    [applyLiveGeometry],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const next =
        drag.mode === "move"
          ? {
              ...drag.origin,
              x: drag.origin.x + dx,
              y: drag.origin.y + dy,
            }
          : {
              ...drag.origin,
              width: drag.origin.width + dx,
              height: drag.origin.height + dy,
            };
      commitGeometry(next);
    },
    [commitGeometry],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        const corner = nextPipCorner(geometry, readViewportSize());
        commitGeometry(geometryForCorner(corner, geometry, readViewportSize()));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissPip(epicId);
        return;
      }
      const step = event.shiftKey ? PIP_RESIZE_STEP_PX : PIP_NUDGE_PX;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? { ...geometry, width: geometry.width - step }
            : { ...geometry, x: geometry.x - step },
        );
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? { ...geometry, width: geometry.width + step }
            : { ...geometry, x: geometry.x + step },
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? { ...geometry, height: geometry.height - step }
            : { ...geometry, y: geometry.y - step },
        );
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? { ...geometry, height: geometry.height + step }
            : { ...geometry, y: geometry.y + step },
        );
      }
    },
    [commitGeometry, epicId, geometry],
  );

  const overlayId = `agent-browser-pip-${epicId}`;
  const isChip = snapshot.phase === "chip";

  return (
    <div
      ref={rootRef}
      data-testid="agent-browser-pip"
      data-browser-overlay={PIP_OVERLAY_KIND}
      data-browser-overlay-id={overlayId}
      data-pip-phase={snapshot.phase}
      data-pip-burst-id={snapshot.target?.burstId ?? ""}
      data-pip-host-id={snapshot.target?.hostId ?? ""}
      data-pip-outcome={snapshot.outcome ?? ""}
      data-pip-health={snapshot.streamHealth}
      data-pip-open-enabled={snapshot.openTileEnabled ? "true" : "false"}
      className={cn(
        "fixed z-40",
        isChip
          ? "overflow-hidden rounded-full border border-border/80 bg-popover/95 shadow-lg backdrop-blur-sm"
          : "overflow-hidden rounded-lg border border-border/80 bg-popover/95 shadow-xl backdrop-blur-sm",
      )}
      style={{
        left: geometry.x,
        top: geometry.y,
        width: isChip ? "auto" : geometry.width,
        height: isChip ? "auto" : geometry.height,
        maxWidth: isChip ? "min(24rem, calc(100vw - 2rem))" : undefined,
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {isChip ? (
        <PipChip
          epicId={epicId}
          snapshot={snapshot}
          onPointerDown={(event) => handlePointerDown(event, "move")}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <PipExpanded
          epicId={epicId}
          viewTabId={props.viewTabId}
          snapshot={snapshot}
          frameSrc={frameSrc}
          dragMoved={() => dragRef.current?.moved === true}
          onHeaderPointerDown={(event) => handlePointerDown(event, "move")}
          onResizePointerDown={(event) => handlePointerDown(event, "resize")}
          onKeyDown={handleKeyDown}
        />
      )}
    </div>
  );
}

function PipChip(props: {
  readonly epicId: string;
  readonly snapshot: PipSnapshot;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}): ReactElement {
  const meta = usePipTargetMeta(props.epicId, props.snapshot.target);
  const line = pipOutcomeLine(props.snapshot.outcome, meta.site);
  return (
    <div className="flex items-center gap-1.5 py-1 pr-1 pl-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Re-expand PiP: ${line}`}
        data-testid="agent-browser-pip-chip"
        onPointerDown={props.onPointerDown}
        onKeyDown={props.onKeyDown}
        onClick={() => {
          reexpandPip(props.epicId);
        }}
      >
        <PipFavicon url={meta.faviconUrl} />
        <span className="truncate text-ui-xs text-muted-foreground">
          {line}
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss finished browser"
        className="flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          dismissPipChip(props.epicId);
        }}
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}

function PipExpanded(props: {
  readonly epicId: string;
  readonly viewTabId: string;
  readonly snapshot: PipSnapshot;
  readonly frameSrc: string | null;
  readonly dragMoved: () => boolean;
  readonly onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onResizePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}): ReactElement {
  const { snapshot, frameSrc } = props;
  const meta = usePipTargetMeta(props.epicId, snapshot.target);
  const openTile = useOpenPipTarget(props.epicId, props.viewTabId);
  const livePulse =
    snapshot.phase === "live" && snapshot.streamHealth === "live";
  const attribution = [meta.agentName, meta.hostLabel].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  const gone = !snapshot.openTileEnabled;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        tabIndex={0}
        aria-label="Agent browser picture in picture"
        className="flex min-h-8 shrink-0 items-center gap-2 px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={props.onHeaderPointerDown}
        onKeyDown={props.onKeyDown}
      >
        <PipFavicon url={meta.faviconUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui-xs font-medium text-foreground">
            {meta.title}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[0.625rem] leading-none text-muted-foreground">
            <span
              aria-hidden
              data-testid="agent-browser-pip-pulse"
              data-pip-pulse={livePulse ? "live" : "off"}
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                livePulse
                  ? "bg-emerald-400 shadow-[0_0_6px_color-mix(in_oklch,var(--color-emerald-400)_70%,transparent)]"
                  : "bg-muted-foreground/40",
              )}
            />
            <span className="truncate">{attribution.join(" · ")}</span>
          </div>
        </div>
        <button
          type="button"
          aria-label={gone ? pipGoneTabCopy() : "Open browser tile"}
          disabled={gone}
          data-testid="agent-browser-pip-open"
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            openTile();
          }}
        >
          <Maximize2 className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Close picture in picture"
          data-testid="agent-browser-pip-close"
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            dismissPip(props.epicId);
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <button
        type="button"
        aria-label={gone ? pipGoneTabCopy() : "Open browser tile"}
        disabled={gone}
        data-testid="agent-browser-pip-frame"
        className="relative min-h-0 flex-1 overflow-hidden bg-muted/40 outline-none disabled:cursor-not-allowed"
        onClick={() => {
          if (props.dragMoved()) return;
          openTile();
        }}
      >
        {frameSrc === null ? (
          <div className="flex h-full items-center justify-center text-ui-xs text-muted-foreground">
            {gone ? pipGoneTabCopy() : (meta.site ?? "Waiting for frames")}
          </div>
        ) : (
          <img
            src={frameSrc}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        )}
        <PipFrameOverlays
          snapshot={snapshot}
          gone={gone}
          site={meta.site}
        />
      </button>
      <button
        type="button"
        aria-label="Resize picture in picture"
        className="absolute right-0 bottom-0 size-3 cursor-se-resize"
        onPointerDown={props.onResizePointerDown}
      />
    </div>
  );
}

function PipFrameOverlays(props: {
  readonly snapshot: PipSnapshot;
  readonly gone: boolean;
  readonly site: string | null;
}): ReactElement {
  const { snapshot, gone, site } = props;
  return (
    <>
      {snapshot.moreLiveCount > 0 ? (
        <span
          data-testid="agent-browser-pip-more"
          className="absolute top-2 right-2 rounded-full bg-background/80 px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
        >
          {snapshot.moreLiveCount} more active
        </span>
      ) : null}
      {snapshot.streamHealth === "stale" ? (
        <span
          data-testid="agent-browser-pip-stale"
          className="absolute top-2 left-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
        >
          Stale
        </span>
      ) : null}
      {snapshot.streamHealth === "disconnected" ? (
        <span
          data-testid="agent-browser-pip-disconnected"
          className="absolute top-2 left-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[0.625rem] text-muted-foreground"
        >
          Disconnected
        </span>
      ) : null}
      <PipCaptionBadge
        key={
          snapshot.caption === null
            ? "none"
            : String(snapshot.caption.arrivedAt)
        }
        caption={snapshot.caption}
      />
      {gone ? (
        <span
          data-testid="agent-browser-pip-gone"
          className="absolute inset-x-2 bottom-2 rounded-md bg-background/85 px-2 py-1 text-center text-ui-xs text-muted-foreground"
        >
          {pipGoneTabCopy()}
        </span>
      ) : null}
      {snapshot.phase === "finished" && snapshot.outcome !== null && !gone ? (
        <span
          data-testid="agent-browser-pip-finished"
          className="absolute inset-x-2 bottom-2 rounded-md bg-background/85 px-2 py-1 text-center text-ui-xs text-muted-foreground"
        >
          {pipOutcomeLine(snapshot.outcome, site)}
        </span>
      ) : null}
    </>
  );
}

function PipCaptionBadge(props: {
  readonly caption: PipCaption | null;
}): ReactElement | null {
  const { caption } = props;
  const now = useSyncExternalStore(
    subscribeCaptionClock,
    readCaptionClock,
    readCaptionClock,
  );
  if (caption === null) return null;
  const elapsed = now - caption.arrivedAt;
  const totalMs = PIP_CAPTION_HOLD_MS + PIP_CAPTION_FADE_MS;
  if (elapsed >= totalMs) return null;
  const fading = elapsed >= PIP_CAPTION_HOLD_MS;
  return (
    <span
      data-testid="agent-browser-pip-caption"
      data-pip-caption-visible={fading ? "false" : "true"}
      className={cn(
        "pointer-events-none absolute bottom-2 left-2 max-w-[min(85%,20rem)] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-opacity duration-300",
        fading ? "opacity-0" : "opacity-90",
      )}
    >
      {caption.cellTitle}
    </span>
  );
}

function subscribeCaptionClock(onStoreChange: () => void): () => void {
  const id = window.setInterval(onStoreChange, 50);
  return () => {
    window.clearInterval(id);
  };
}

function readCaptionClock(): number {
  return Date.now();
}

function PipFavicon(props: { readonly url: string | null }): ReactElement {
  if (props.url === null) {
    return (
      <span
        aria-hidden
        className="size-3.5 shrink-0 rounded-sm bg-muted-foreground/30"
      />
    );
  }
  return (
    <img
      src={props.url}
      alt=""
      className="size-3.5 shrink-0 rounded-sm"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function usePipTargetMeta(
  epicId: string,
  target: PipTarget | null,
): {
  readonly title: string;
  readonly site: string | null;
  readonly faviconUrl: string | null;
  readonly agentName: string;
  readonly hostLabel: string | null;
} {
  const items = usePipEpicSessionItems(epicId);
  const chats = useEpicChatRecords();
  const activeHostId = useReactiveActiveHostId();
  const hostEntry = useHostDirectoryEntry(target?.hostId ?? "");
  const tab =
    target === null
      ? undefined
      : findPipEpicSession(items, target.hostId, target.sessionId)?.tabs.find(
          (item) => item.tabId === target.tabId,
        );
  const title = tab === undefined ? "Browser" : resolveTabTitle(tab);
  const site = tab === undefined ? null : browserTabHostname(tab.url);
  const faviconUrl = tab === undefined ? null : browserTabFaviconUrl(tab.url);
  const chatTitle =
    target === null
      ? ""
      : (chats.find((chat) => chat.id === target.chatId)?.title ??
        target.chatId);
  const hostLabel =
    target !== null && activeHostId !== null && target.hostId !== activeHostId
      ? (hostEntry?.label ?? target.hostId)
      : null;
  return {
    title,
    site,
    faviconUrl,
    agentName: chatTitle,
    hostLabel,
  };
}

function useOpenPipTarget(epicId: string, viewTabId: string): () => void {
  const navigateNested = useEpicNestedFocusNavigation();
  const prepareOpen = useEpicCanvasStore(
    (state) => state.prepareOpenTileInTabFocusTarget,
  );
  const prepareFocus = useEpicCanvasStore(
    (state) => state.prepareSetActiveTileTabFocusTarget,
  );
  const items = usePipEpicSessionItems(epicId);
  return useCallback(() => {
    const latch = getPipSnapshot(epicId).target;
    if (latch === null) return;
    if (!getPipSnapshot(epicId).openTileEnabled) return;
    const session = findPipEpicSession(items, latch.hostId, latch.sessionId);
    const tab = session?.tabs.find((item) => item.tabId === latch.tabId);
    const binding = findElectronBrowserTabBinding(latch.sessionId, latch.tabId);
    const existingNative =
      binding === null
        ? null
        : findOpenArtifactInTab(viewTabId, binding.registrationId);
    const tile = makeBrowserSessionTileRef({
      name: tab?.title ?? session?.name ?? "Browser",
      hostId: latch.hostId,
      sessionId: latch.sessionId,
      tabId: latch.tabId,
    });
    const existingPointer = findOpenArtifactInTab(viewTabId, tile.id);
    const existing = existingNative ?? existingPointer;
    navigateNested(epicId, viewTabId, () =>
      existing === null
        ? prepareOpen(viewTabId, tile)
        : prepareFocus(viewTabId, existing.paneId, existing.instanceId),
    );
  }, [epicId, items, navigateNested, prepareFocus, prepareOpen, viewTabId]);
}

interface OwnedPipFrame {
  readonly burstId: string;
  readonly src: string;
}

function usePipOwnedFrame(
  epicId: string,
  snapshot: PipSnapshot,
): string | null {
  const runnerHost = useRunnerHostOrNull();
  const target = snapshot.target;
  const sessionId = target?.sessionId ?? "";
  const tabId = target?.tabId ?? "";
  const burstId = target?.burstId ?? null;
  const binding = useElectronBrowserTabBinding(sessionId, tabId);
  const hostEntry = useHostDirectoryEntry(target?.hostId ?? "");
  const auth = useStreamAuthRevalidator();
  const client = useHostStreamClientFor(
    target === null ? null : hostEntry,
    auth,
  );
  const bridge = useMemo(
    () =>
      runnerHost === null ? null : resolveDesktopPipCaptureBridge(runnerHost),
    [runnerHost],
  );
  const useNative = binding !== null && bridge !== null;
  const useHeadless = !useNative && client !== null;
  const retain = shouldRetainPipFrame(snapshot.phase, burstId);
  const { owned, setOwned } = usePipFrameOwner(burstId, retain);

  useEffect(() => {
    if (snapshot.phase !== "live" || burstId === null) return;
    if (sessionId.length === 0 || tabId.length === 0) return;
    return startPipCapture({
      binding,
      bridge,
      burstId,
      client,
      epicId,
      onUrl: (src) => {
        setOwned((prev) => {
          if (prev !== null && prev.src !== src) URL.revokeObjectURL(prev.src);
          return { burstId, src };
        });
      },
      sessionId,
      tabId,
      useHeadless,
      useNative,
    });
  }, [
    binding,
    bridge,
    burstId,
    client,
    epicId,
    sessionId,
    snapshot.phase,
    tabId,
    setOwned,
    useHeadless,
    useNative,
  ]);

  return frameSrcFor(owned, burstId, retain);
}

function shouldRetainPipFrame(
  phase: PipSnapshot["phase"],
  burstId: string | null,
): boolean {
  if (burstId === null) return false;
  return phase === "live" || phase === "finished" || phase === "chip";
}

function frameSrcFor(
  owned: OwnedPipFrame | null,
  burstId: string | null,
  retain: boolean,
): string | null {
  if (!retain || owned === null || burstId === null) return null;
  if (owned.burstId !== burstId) return null;
  return owned.src;
}

function usePipFrameOwner(
  burstId: string | null,
  retain: boolean,
): {
  readonly owned: OwnedPipFrame | null;
  readonly setOwned: Dispatch<SetStateAction<OwnedPipFrame | null>>;
} {
  const [owned, setOwned] = useState<OwnedPipFrame | null>(null);
  const ownedRef = useRef<OwnedPipFrame | null>(null);

  useEffect(() => {
    ownedRef.current = owned;
  }, [owned]);

  useEffect(() => {
    const current = ownedRef.current;
    if (current === null) return;
    if (retain && current.burstId === burstId) return;
    URL.revokeObjectURL(current.src);
    ownedRef.current = null;
    setOwned(null);
  }, [burstId, retain, setOwned]);

  useEffect(() => {
    return () => {
      const current = ownedRef.current;
      if (current !== null) URL.revokeObjectURL(current.src);
    };
  }, []);

  return { owned, setOwned };
}

function startPipCapture(input: {
  readonly binding: ElectronBrowserTabRegistration | null;
  readonly bridge: DesktopPipCaptureBridge | null;
  readonly burstId: string;
  readonly client: IHostStreamClient<HostStreamRpcRegistry> | null;
  readonly epicId: string;
  readonly onUrl: (src: string) => void;
  readonly sessionId: string;
  readonly tabId: string;
  readonly useHeadless: boolean;
  readonly useNative: boolean;
}): (() => void) | undefined {
  let disposed = false;
  const applyFrame = (
    frame: BrowserScreencastServerFrame,
    jpegBytes: Uint8Array | null,
  ): void => {
    if (disposed) return;
    applyCaptureFrame(input.epicId, frame, jpegBytes, input.onUrl);
  };
  if (input.useNative) {
    const binding = input.binding;
    const bridge = input.bridge;
    if (binding === null || bridge === null) return;
    const subscription = bridge.onFrame(applyFrame);
    void bridge.start(
      binding.tileKey,
      PIP_HEADLESS_MAX_WIDTH,
      PIP_HEADLESS_MAX_HEIGHT,
      PIP_HEADLESS_QUALITY,
    );
    return () => {
      disposed = true;
      subscription.dispose();
      void bridge.stop();
    };
  }
  if (!input.useHeadless || input.client === null) return;
  const stream = openPipHeadlessStream({
    client: input.client,
    epicId: input.epicId,
    sessionId: input.sessionId,
    tabId: input.tabId,
    maxWidth: PIP_HEADLESS_MAX_WIDTH,
    maxHeight: PIP_HEADLESS_MAX_HEIGHT,
    quality: PIP_HEADLESS_QUALITY,
    onFrame: applyFrame,
  });
  return () => {
    disposed = true;
    stream.close();
  };
}

function applyCaptureFrame(
  epicId: string,
  frame: BrowserScreencastServerFrame,
  jpegBytes: Uint8Array | null,
  onUrl: (url: string) => void,
): void {
  if (frame.kind === "stalled") {
    applyPipStreamHealth(epicId, "stale");
    return;
  }
  if (frame.kind !== "frame" || jpegBytes === null) return;
  applyPipStreamHealth(epicId, "live");
  const bytes = new Uint8Array(jpegBytes);
  const blob = new Blob([bytes], { type: "image/jpeg" });
  onUrl(URL.createObjectURL(blob));
}

interface PipPointerSession {
  readonly pointerId: number;
  readonly mode: "move" | "resize";
  readonly startX: number;
  readonly startY: number;
  readonly origin: EpicPipGeometry;
  moved: boolean;
}
