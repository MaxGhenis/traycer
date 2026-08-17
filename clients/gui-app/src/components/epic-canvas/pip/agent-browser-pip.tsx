import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Maximize2, X } from "lucide-react";
import { useEpicNestedFocusNavigation } from "@/hooks/epic/use-epic-nested-focus-navigation";
import { useHostDirectoryEntry } from "@/hooks/host/use-host-directory-entry";
import { useReactiveActiveHostId } from "@/hooks/host/use-reactive-active-host-id";
import {
  browserTabFaviconUrl,
  browserTabHostname,
  resolveTabTitle,
} from "@/lib/browser-view/browser-tab-display";
import { findElectronBrowserTabBinding } from "@/lib/browser-view/electron-browser-tab-store";
import {
  clampPipGeometry,
  defaultPipGeometry,
  geometryForCorner,
  layoutPipStack,
  nextPipCorner,
  persistedPipGeometry,
  PIP_MORE_HEIGHT_PX,
  PIP_NUDGE_PX,
  PIP_ROW_GAP_PX,
  PIP_ROW_HEIGHT_PX,
  PIP_RESIZE_STEP_PX,
  readViewportSize,
} from "@/lib/browser-view/pip-geometry";
import { usePipOwnedFrame } from "@/lib/browser-view/pip-frame-capture";
import {
  findPipEpicSession,
  usePipEpicSessionItems,
} from "@/lib/browser-view/pip-epic-sessions";
import { pipGoneTabCopy, pipOutcomeLine } from "@/lib/browser-view/pip-copy";
import {
  dismissPip,
  dismissPipChip,
  dismissPipRowSet,
  PIP_CAPTION_FADE_MS,
  PIP_CAPTION_HOLD_MS,
  reexpandPip,
  selectPipRow,
  setPipActiveHostId,
  usePipSnapshot,
  type PipCaption,
  type PipSnapshot,
  type PipTarget,
  type PipRow,
} from "@/lib/browser-view/pip-store";
import { cn } from "@/lib/utils";
import { useEpicChatRecords } from "@/lib/epic-selectors";
import { useMaybeOpenEpicHandle } from "@/providers/use-open-epic-handle";
import {
  findOpenTileInTab,
  useEpicCanvasStore,
} from "@/stores/epics/canvas/store";
import { makeBrowserSessionTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import type { EpicPipGeometry } from "@/stores/epics/canvas/types";

const PIP_DRAG_CLICK_SLOP_PX = 4;
const PIP_OVERLAY_KIND = "pip";
const PIP_ROWS_CLOCK_MS = 1_000;

export function AgentBrowserPip(props: {
  readonly epicId: string;
  readonly viewTabId: string;
  readonly surfaceVisible: boolean;
}): ReactElement | null {
  const activeHostId = useReactiveActiveHostId();
  const epicHandle = useMaybeOpenEpicHandle();
  useEffect(() => {
    setPipActiveHostId(activeHostId);
  }, [activeHostId]);

  const snapshot = usePipSnapshot(props.epicId);
  if (epicHandle === null || !props.surfaceVisible) return null;
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
  const rows = usePipRows(epicId, snapshot.rows);
  const persisted = useEpicCanvasStore(
    (state) => state.pipGeometryByEpicId[epicId],
  );
  const setPipGeometry = useEpicCanvasStore((state) => state.setPipGeometry);
  const [viewport, setViewport] = useState(readViewportSize);
  const rawGeometry = useMemo(
    () => persisted ?? defaultPipGeometry(viewport),
    [persisted, viewport],
  );
  const stack = useMemo(
    () => layoutPipStack(rawGeometry, rows.length, viewport),
    [rawGeometry, rows.length, viewport],
  );
  const { geometry, rowLayout } = stack;
  const chipGeometry = useMemo(
    () => clampPipGeometry(rawGeometry, viewport, rawGeometry.previewHeight),
    [rawGeometry, viewport],
  );
  const isChip = snapshot.phase === "chip";
  const interactionGeometry = useMemo(
    () => ({
      ...rawGeometry,
      anchorX: isChip ? chipGeometry.anchorX : geometry.anchorX,
      anchorY: isChip ? chipGeometry.anchorY : geometry.anchorY,
    }),
    [chipGeometry, geometry, isChip, rawGeometry],
  );
  const visibleRows = rows.slice(0, rowLayout.visibleCount);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<PipPointerSession | null>(null);
  const dragMovedRef = useRef(false);

  useEffect(() => {
    const onResize = (): void => {
      setViewport(readViewportSize());
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const commitGeometry = useCallback(
    (next: EpicPipGeometry, resize: boolean) => {
      const nextViewport = readViewportSize();
      setPipGeometry(
        epicId,
        persistedPipGeometry(
          next,
          isChip ? 0 : rows.length,
          nextViewport,
          resize,
        ),
      );
    },
    [epicId, isChip, rows.length, setPipGeometry],
  );

  const applyLiveGeometry = useCallback(
    (next: EpicPipGeometry) => {
      const node = rootRef.current;
      if (node === null) return;
      const nextViewport = readViewportSize();
      if (snapshot.phase === "chip") {
        const clamped = clampPipGeometry(
          next,
          nextViewport,
          next.previewHeight,
        );
        node.style.left = `${String(clamped.anchorX - clamped.previewWidth)}px`;
        node.style.top = `${String(clamped.anchorY - clamped.previewHeight)}px`;
        node.style.width = "auto";
        node.style.height = "auto";
        return;
      }
      const nextStack = layoutPipStack(next, rows.length, nextViewport);
      const clamped = nextStack.geometry;
      node.style.left = `${String(clamped.anchorX - clamped.previewWidth)}px`;
      node.style.top = `${String(clamped.anchorY - nextStack.rowLayout.outerHeight)}px`;
      node.style.width = `${String(clamped.previewWidth)}px`;
      node.style.height = `${String(nextStack.rowLayout.outerHeight)}px`;
      node.style.setProperty(
        "--pip-preview-height",
        `${String(clamped.previewHeight)}px`,
      );
    },
    [rows.length, snapshot.phase],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: "move" | "resize") => {
      if (event.button !== 0) return;
      if (
        mode === "move" &&
        !isChip &&
        event.target instanceof Element &&
        event.target.closest("button") !== null
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragMovedRef.current = false;
      const origin = interactionGeometry;
      dragRef.current = {
        pointerId: event.pointerId,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        origin,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [interactionGeometry, isChip],
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
        if (isChip) dragMovedRef.current = true;
      }
      if (drag.mode === "move") {
        applyLiveGeometry({
          ...drag.origin,
          anchorX: drag.origin.anchorX + dx,
          anchorY: drag.origin.anchorY + dy,
        });
        return;
      }
      applyLiveGeometry({
        ...drag.origin,
        anchorX: drag.origin.anchorX + dx,
        anchorY: drag.origin.anchorY + dy,
        previewWidth: drag.origin.previewWidth + dx,
        previewHeight: drag.origin.previewHeight + dy,
      });
    },
    [applyLiveGeometry, isChip],
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
              anchorX: drag.origin.anchorX + dx,
              anchorY: drag.origin.anchorY + dy,
            }
          : {
              ...drag.origin,
              anchorX: drag.origin.anchorX + dx,
              anchorY: drag.origin.anchorY + dy,
              previewWidth: drag.origin.previewWidth + dx,
              previewHeight: drag.origin.previewHeight + dy,
            };
      commitGeometry(next, drag.mode === "resize");
    },
    [commitGeometry],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        const corner = nextPipCorner(
          geometry,
          readViewportSize(),
          rowLayout.outerHeight,
        );
        const next = geometryForCorner(
          corner,
          rawGeometry,
          readViewportSize(),
          rowLayout.outerHeight,
        );
        commitGeometry(
          {
            ...rawGeometry,
            anchorX: next.anchorX,
            anchorY: next.anchorY,
          },
          false,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissRenderedPip(epicId, snapshot, rows);
        return;
      }
      const step = event.shiftKey ? PIP_RESIZE_STEP_PX : PIP_NUDGE_PX;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? {
                ...interactionGeometry,
                previewWidth: rawGeometry.previewWidth - step,
              }
            : {
                ...interactionGeometry,
                anchorX: interactionGeometry.anchorX - step,
              },
          event.shiftKey,
        );
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? {
                ...interactionGeometry,
                previewWidth: rawGeometry.previewWidth + step,
              }
            : {
                ...interactionGeometry,
                anchorX: interactionGeometry.anchorX + step,
              },
          event.shiftKey,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? {
                ...interactionGeometry,
                previewHeight: rawGeometry.previewHeight - step,
              }
            : {
                ...interactionGeometry,
                anchorY: interactionGeometry.anchorY - step,
              },
          event.shiftKey,
        );
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        commitGeometry(
          event.shiftKey
            ? {
                ...interactionGeometry,
                previewHeight: rawGeometry.previewHeight + step,
              }
            : {
                ...interactionGeometry,
                anchorY: interactionGeometry.anchorY + step,
              },
          event.shiftKey,
        );
      }
    },
    [
      commitGeometry,
      epicId,
      geometry,
      interactionGeometry,
      rawGeometry,
      rowLayout.outerHeight,
      rows,
      snapshot,
    ],
  );

  const consumeChipDragClick = useCallback((): boolean => {
    const moved = dragMovedRef.current;
    dragMovedRef.current = false;
    return moved;
  }, []);

  const overlayId = `agent-browser-pip-${epicId}`;
  const rootStyle: PipRootStyle = {
    "--pip-preview-height": `${String(geometry.previewHeight)}px`,
    "--pip-row-height": `${String(PIP_ROW_HEIGHT_PX)}px`,
    "--pip-row-gap": `${String(PIP_ROW_GAP_PX)}px`,
    "--pip-more-height": `${String(PIP_MORE_HEIGHT_PX)}px`,
    left: isChip
      ? chipGeometry.anchorX - chipGeometry.previewWidth
      : geometry.anchorX - geometry.previewWidth,
    top: isChip
      ? chipGeometry.anchorY - chipGeometry.previewHeight
      : geometry.anchorY - rowLayout.outerHeight,
    width: isChip ? "auto" : geometry.previewWidth,
    height: isChip ? "auto" : rowLayout.outerHeight,
    maxWidth: isChip ? "min(24rem, calc(100vw - 2rem))" : undefined,
  };

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
          : "flex flex-col gap-[var(--pip-row-gap)]",
      )}
      style={rootStyle}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {isChip ? (
        <PipChip
          epicId={epicId}
          snapshot={snapshot}
          dragMoved={consumeChipDragClick}
          onPointerDown={(event) => handlePointerDown(event, "move")}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <PipExpanded
          epicId={epicId}
          viewTabId={props.viewTabId}
          snapshot={snapshot}
          frameSrc={frameSrc}
          rows={visibleRows}
          allRows={rows}
          hiddenRowCount={rowLayout.hiddenCount}
          onHeaderPointerDown={(event) => handlePointerDown(event, "move")}
          onResizePointerDown={(event) => handlePointerDown(event, "resize")}
          onKeyDown={handleKeyDown}
        />
      )}
    </div>
  );
}

type PipRootStyle = CSSProperties & {
  readonly "--pip-preview-height": string;
  readonly "--pip-row-height": string;
  readonly "--pip-row-gap": string;
  readonly "--pip-more-height": string;
};

function PipChip(props: {
  readonly epicId: string;
  readonly snapshot: PipSnapshot;
  readonly dragMoved: () => boolean;
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
          if (props.dragMoved()) return;
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
        className="flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
  readonly rows: readonly PipRowView[];
  readonly allRows: readonly PipRowView[];
  readonly hiddenRowCount: number;
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
  const outcomeOnly =
    snapshot.phase === "finished" && !snapshot.targetEverStreamed;

  return (
    <>
      <div className="relative flex h-(--pip-preview-height) min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-popover/95 shadow-xl backdrop-blur-sm">
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
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (snapshot.target !== null) {
                openTile(snapshot.target, snapshot.openTileEnabled);
              }
            }}
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Close picture in picture"
            data-testid="agent-browser-pip-close"
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              dismissRenderedPip(props.epicId, snapshot, props.allRows);
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
            if (snapshot.target === null) return;
            openTile(snapshot.target, snapshot.openTileEnabled);
          }}
        >
          <PipFrameContent
            frameSrc={frameSrc}
            gone={gone}
            meta={meta}
            outcome={snapshot.outcome}
            outcomeOnly={outcomeOnly}
          />
          {outcomeOnly ? null : (
            <PipFrameOverlays
              snapshot={snapshot}
              gone={gone}
              site={meta.site}
            />
          )}
        </button>
        <button
          type="button"
          aria-label="Resize picture in picture"
          className="absolute right-0 bottom-0 size-3 cursor-se-resize"
          onPointerDown={props.onResizePointerDown}
        />
      </div>
      {props.rows.map((row) => (
        <PipSessionRow
          key={row.row.target.burstId}
          row={row}
          openTile={openTile}
        />
      ))}
      {props.hiddenRowCount > 0 ? (
        <div
          data-testid="agent-browser-pip-row-more"
          className="flex h-[var(--pip-more-height)] shrink-0 items-center justify-center text-[0.625rem] text-muted-foreground"
        >
          {props.hiddenRowCount} more
        </div>
      ) : null}
    </>
  );
}

function PipFrameContent(props: {
  readonly frameSrc: string | null;
  readonly gone: boolean;
  readonly meta: {
    readonly faviconUrl: string | null;
    readonly site: string | null;
  };
  readonly outcome: PipSnapshot["outcome"];
  readonly outcomeOnly: boolean;
}): ReactElement {
  if (props.outcomeOnly) {
    return (
      <div
        data-testid="agent-browser-pip-outcome-only"
        className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-ui-xs text-muted-foreground"
      >
        <PipFavicon url={props.meta.faviconUrl} />
        <span>{pipOutcomeLine(props.outcome, props.meta.site)}</span>
      </div>
    );
  }
  if (props.frameSrc === null) {
    return (
      <div className="flex h-full items-center justify-center text-ui-xs text-muted-foreground">
        {props.gone
          ? pipGoneTabCopy()
          : (props.meta.site ?? "Waiting for frames")}
      </div>
    );
  }
  return (
    <img
      src={props.frameSrc}
      alt=""
      className="size-full object-cover"
      draggable={false}
    />
  );
}

function PipSessionRow(props: {
  readonly row: PipRowView;
  readonly openTile: (target: PipTarget, enabled: boolean) => void;
}): ReactElement {
  const { row } = props;
  const live = row.row.kind === "live";
  const openEnabled = row.row.outcome !== "closed";
  const outcome = pipOutcomeLine(row.row.outcome, row.site);
  const activate = (): void => {
    if (live) selectPipRow(row.row.target);
  };
  return (
    <div
      tabIndex={live ? undefined : 0}
      data-testid={`agent-browser-pip-row-${row.row.target.burstId}`}
      data-pip-row-kind={row.row.kind}
      className={cn(
        "group relative flex h-[var(--pip-row-height)] shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-popover/95 px-2.5 shadow-lg outline-none backdrop-blur-sm focus-visible:ring-2 focus-visible:ring-ring",
        live ? undefined : "text-muted-foreground",
      )}
    >
      {live ? (
        <button
          type="button"
          aria-label={`Show ${row.title} in picture in picture`}
          className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={activate}
        />
      ) : null}
      <span className="pointer-events-none relative flex">
        <PipFavicon url={row.faviconUrl} />
      </span>
      <div className="pointer-events-none relative min-w-0 flex-1">
        <div className="truncate text-ui-xs font-medium">{row.title}</div>
        <div className="truncate text-[0.625rem] text-muted-foreground">
          {live ? row.activity : outcome}
        </div>
      </div>
      <div className="invisible relative flex shrink-0 gap-0.5 group-hover:visible group-focus-within:visible">
        <button
          type="button"
          aria-label={openEnabled ? `Open ${row.title}` : outcome}
          disabled={!openEnabled}
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          onClick={(event) => {
            event.stopPropagation();
            props.openTile(row.row.target, openEnabled);
          }}
        >
          <Maximize2 className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Hide ${row.title} from picture in picture`}
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation();
            dismissPipRowSet([row.row.target.burstId]);
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {live ? (
        <span
          aria-hidden
          className="pointer-events-none relative size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_color-mix(in_oklch,var(--color-emerald-400)_70%,transparent)]"
        />
      ) : null}
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
    caption === null ? subscribeNoop : subscribeCaptionClock,
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

function subscribeNoop(): () => void {
  return () => undefined;
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

interface PipRowView {
  readonly row: PipRow;
  readonly title: string;
  readonly site: string | null;
  readonly faviconUrl: string | null;
  readonly activity: string;
}

function usePipRows(epicId: string, rows: readonly PipRow[]): PipRowView[] {
  const items = usePipEpicSessionItems(epicId);
  const chats = useEpicChatRecords();
  const [now, setNow] = useState(Date.now);
  const captionLifetime = PIP_CAPTION_HOLD_MS + PIP_CAPTION_FADE_MS;
  const hasActiveDeadline = rows.some(
    (row) =>
      (row.expiresAt !== null && row.expiresAt > now) ||
      (row.caption !== null && row.caption.arrivedAt + captionLifetime > now),
  );

  useEffect(() => {
    if (!hasActiveDeadline) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, PIP_ROWS_CLOCK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [hasActiveDeadline]);

  return rows.flatMap((row) => {
    if (row.expiresAt !== null && row.expiresAt <= now) return [];
    const session = findPipEpicSession(
      items,
      row.target.hostId,
      row.target.sessionId,
    );
    const tab = session?.tabs.find((item) => item.tabId === row.target.tabId);
    const chatTitle =
      chats.find((chat) => chat.id === row.chatId)?.title.trim() ?? "";
    const caption =
      row.caption !== null && row.caption.arrivedAt + captionLifetime > now
        ? row.caption.cellTitle.trim()
        : "";
    return [
      {
        row,
        title: tab === undefined ? "Browser" : resolveTabTitle(tab),
        site: tab === undefined ? null : browserTabHostname(tab.url),
        faviconUrl: tab === undefined ? null : browserTabFaviconUrl(tab.url),
        activity: pipRowActivity(caption, chatTitle),
      },
    ];
  });
}

function pipRowActivity(caption: string, chatTitle: string): string {
  if (caption.length > 0) return caption;
  if (chatTitle.length > 0) return chatTitle;
  return "Agent browsing";
}

function dismissRenderedPip(
  epicId: string,
  snapshot: PipSnapshot,
  rows: readonly PipRowView[],
): void {
  if (rows.length === 0) {
    dismissPip(epicId);
    return;
  }
  dismissPipRowSet([
    ...(snapshot.target === null ? [] : [snapshot.target.burstId]),
    ...rows.map((row) => row.row.target.burstId),
  ]);
}

function useOpenPipTarget(
  epicId: string,
  viewTabId: string,
): (target: PipTarget, enabled: boolean) => void {
  const navigateNested = useEpicNestedFocusNavigation();
  const prepareOpen = useEpicCanvasStore(
    (state) => state.prepareOpenTileInTabFocusTarget,
  );
  const prepareFocus = useEpicCanvasStore(
    (state) => state.prepareSetActiveTileTabFocusTarget,
  );
  const items = usePipEpicSessionItems(epicId);
  return useCallback(
    (latch: PipTarget, enabled: boolean) => {
      if (!enabled) return;
      const session = findPipEpicSession(items, latch.hostId, latch.sessionId);
      const tab = session?.tabs.find((item) => item.tabId === latch.tabId);
      const binding = findElectronBrowserTabBinding(
        latch.sessionId,
        latch.tabId,
      );
      const existingNative =
        binding === null || binding.hostId !== latch.hostId
          ? null
          : findOpenTileInTab(viewTabId, {
              id: binding.registrationId,
              hostId: latch.hostId,
            });
      const tile = makeBrowserSessionTileRef({
        name: tab?.title ?? session?.name ?? "Browser",
        hostId: latch.hostId,
        sessionId: latch.sessionId,
        tabId: latch.tabId,
      });
      const existingPointer = findOpenTileInTab(viewTabId, {
        id: tile.id,
        hostId: latch.hostId,
      });
      const existing = existingNative ?? existingPointer;
      navigateNested(epicId, viewTabId, () =>
        existing === null
          ? prepareOpen(viewTabId, tile)
          : prepareFocus(viewTabId, existing.paneId, existing.instanceId),
      );
    },
    [epicId, items, navigateNested, prepareFocus, prepareOpen, viewTabId],
  );
}

interface PipPointerSession {
  readonly pointerId: number;
  readonly mode: "move" | "resize";
  readonly startX: number;
  readonly startY: number;
  readonly origin: EpicPipGeometry;
}
