import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { useTabHostId } from "@/components/epic-canvas/hooks/use-tab-host-id";
import { useTileBodyVisible } from "@/components/epic-canvas/hooks/use-tile-body-visible";
import {
  BrowserElementPickerResultPanel,
} from "@/components/epic-canvas/renderers/browser-element-picker";
import { BrowserTileFindAdapterBridge } from "@/components/epic-canvas/renderers/browser-tile-find-adapter";
import {
  BrowserTileCertificateInterstitial,
  BrowserTileDownloadStrip,
} from "@/components/epic-canvas/renderers/browser-tile-status-panels";
import { BrowserTileToolbar } from "@/components/epic-canvas/renderers/browser-tile-toolbar";
import { BrowserViewSnapshotLayer } from "@/components/epic-canvas/renderers/browser-view-snapshot-layer";
import { PRIMARY_TILE_CHROME_CAPABILITIES } from "@/components/epic-canvas/renderers/tile-controller";
import { useBrowserElementPicker } from "@/components/epic-canvas/renderers/use-browser-element-picker";
import { useBrowserViewSnapshot } from "@/components/epic-canvas/renderers/use-browser-view-snapshot";
import { useCloseCanvasTileWithNestedFocus } from "@/components/epic-canvas/renderers/use-close-canvas-tile-with-nested-focus";
import { useBrowserViewBoundsBridge } from "@/components/epic-canvas/renderers/use-browser-view-bounds-bridge";
import { useElectronTileChrome } from "@/components/epic-canvas/renderers/use-electron-tile-chrome";
import { usePaneFocused } from "@/components/epic-tabs/pane-visibility-context";
import { BROWSER_VIEW_SURFACE_ATTRIBUTE } from "@/lib/browser-view/browser-overlay-coordinator";
import { selectSiblingChatIdForBrowserTile } from "@/lib/browser-view/browser-tile-chat-routing";
import {
  resolveDesktopAgentBrowserViewBridge,
  type AgentBrowserViewTileKey,
} from "@/lib/browser-view/desktop-agent-browser-view";
import {
  resolveDesktopBrowserViewBridge,
  type BrowserViewStatus,
} from "@/lib/browser-view/desktop-browser-view";
import {
  registerElectronBrowserTab,
  updateElectronBrowserTabView,
} from "@/lib/browser-view/electron-browser-tab-store";
import { openFreshAgentBrowserTileFromBrowserPage } from "@/lib/browser-view/browser-link-routing-core";
import { useBrowserCookieCryptoState } from "@/lib/browser-view/use-browser-cookie-crypto-state";
import { appLogger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { useRunnerHost } from "@/providers/use-runner-host";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import type { AgentBrowserTileRef } from "@/stores/epics/canvas/types";

/**
 * How long a tile can sit in `"loading"` before the placeholder stops
 * reading as "still connecting" and switches to "gave up, offer a way out."
 * The host has no typed timeout/failure status for this today (only
 * loading/ready/dead), so this is a client-side ceiling, not a host signal.
 */
const AGENT_BROWSER_UNREACHABLE_TIMEOUT_MS = 12_000;

export interface AgentBrowserTileProps {
  readonly node: AgentBrowserTileRef;
  readonly viewTabId: string;
  readonly paneId: string;
  readonly requestedTabId?: string | null;
  readonly onActivatedHeadless?: ((tabId: string) => void) | null;
  readonly activateBeforeNativeView?: boolean;
  readonly usePrimaryProfileRuntime?: boolean;
}

/**
 * Electron tile used for agent-created pages and native session tabs.
 * Primary-profile session tiles keep the full PRIMARY bridge so chrome
 * is capability-gated, not creator-gated. Isolated-partition tiles stay
 * on the agent bridge until that surface grows the same chrome invokes.
 */
export function AgentBrowserTile(props: AgentBrowserTileProps) {
  const hostId = useTabHostId();
  const runnerHost = useRunnerHost();
  const visible = useTileBodyVisible();
  const paneFocused = usePaneFocused();
  const usePrimaryProfileRuntime = props.usePrimaryProfileRuntime === true;
  const primaryBridge = useMemo(
    () =>
      usePrimaryProfileRuntime
        ? resolveDesktopBrowserViewBridge(runnerHost)
        : null,
    [runnerHost, usePrimaryProfileRuntime],
  );
  const agentBridge = useMemo(
    () =>
      usePrimaryProfileRuntime
        ? null
        : resolveDesktopAgentBrowserViewBridge(runnerHost),
    [runnerHost, usePrimaryProfileRuntime],
  );
  const browserView = primaryBridge ?? agentBridge;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<BrowserViewStatus>("loading");
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const [statusUrl, setStatusUrl] = useState(props.node.url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [durableTabId, setDurableTabId] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const registrationChatId = useEpicCanvasStore((state) =>
    selectSiblingChatIdForBrowserTile(
      state.canvasByTabId[props.viewTabId] ?? null,
      props.node.instanceId,
    ),
  );
  const epicId = useEpicCanvasStore(
    (state) => state.tabsById[props.viewTabId]?.epicId ?? null,
  );

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

  // The host reports only loading/ready/dead - no typed timeout, so a session
  // that never activates sits in "loading" forever with nothing to tell the
  // user apart "still connecting" from "never coming back." This ceiling
  // makes that call locally: past it, the placeholder offers a way out.
  // `unreachable` only reads as true while still loading (see
  // `effectiveUnreachable` below), so leaving "loading" doesn't need its own
  // reset here - only the timer firing needs to set state.
  // ponytail: doesn't re-arm if the host bounces loading -> ready -> loading
  // again without a Retry click in between (stale `unreachable` would read
  // true immediately on the new attempt); add an explicit reset keyed off a
  // fresh loading transition if that ever proves to happen in practice.
  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => {
      setUnreachable(true);
    }, AGENT_BROWSER_UNREACHABLE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [status, retryNonce]);
  const effectiveUnreachable = status === "loading" && unreachable;

  const closeCanvasTile = useCloseCanvasTileWithNestedFocus(
    props.viewTabId,
    props.paneId,
    props.node.instanceId,
  );
  const retry = useCallback(() => {
    setUnreachable(false);
    setRetryNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (browserView === null) return;
    return () => {
      void browserView.releaseTile(tileKey).catch(ignoreAgentBrowserViewError);
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (
      browserView === null ||
      (props.activateBeforeNativeView === true && durableTabId === null)
    ) {
      return;
    }
    if (primaryBridge !== null) {
      void primaryBridge
        .upsertTile({
          ...tileKey,
          url: props.node.url,
          visible,
          viewportPreset: "responsive",
        })
        .catch(ignoreAgentBrowserViewError);
    } else {
      void browserView
        .upsertTile({ ...tileKey, url: props.node.url, visible })
        .catch(ignoreAgentBrowserViewError);
    }
    // `retryNonce` is otherwise unused inside the effect - its only job is to
    // force this upsert to re-fire when the user clicks Retry on an
    // unreachable session, since there is no dedicated reload RPC.
  }, [
    browserView,
    durableTabId,
    props.activateBeforeNativeView,
    tileKey,
    props.node.url,
    primaryBridge,
    visible,
    retryNonce,
  ]);

  useEffect(() => {
    if (browserView === null || epicId === null) return;
    registerElectronBrowserTab({
      epicId,
      hostId,
      chatId: registrationChatId,
      registrationId: props.node.id,
      sessionId: props.node.sessionId,
      requestedTabId: props.requestedTabId ?? null,
      initialUrl: props.node.url,
      title: props.node.name,
      tileKey,
      bridge: browserView,
      onRegistered: setDurableTabId,
      onActivatedHeadless: props.onActivatedHeadless,
      background: usePrimaryProfileRuntime,
    });
  }, [
    browserView,
    epicId,
    hostId,
    props.node.id,
    props.node.name,
    props.node.sessionId,
    props.node.url,
    props.requestedTabId,
    props.onActivatedHeadless,
    usePrimaryProfileRuntime,
    registrationChatId,
    tileKey,
  ]);

  useEffect(() => {
    if (browserView === null || epicId === null) return;
    updateElectronBrowserTabView({
      sessionId: props.node.sessionId,
      registrationId: props.node.id,
      visible,
      focused: paneFocused,
    });
  }, [
    browserView,
    epicId,
    paneFocused,
    props.node.id,
    props.node.sessionId,
    visible,
  ]);

  useEffect(() => {
    if (browserView === null || epicId === null) return;
    return () => {
      updateElectronBrowserTabView({
        sessionId: props.node.sessionId,
        registrationId: props.node.id,
        visible: false,
        focused: false,
      });
    };
  }, [browserView, epicId, props.node.id, props.node.sessionId]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onStatusChange((change) => {
      if (!isChangeForTile(change, tileKey)) return;
      setStatus(change.status);
      setStatusReason(change.reason);
      setStatusUrl(change.url);
      setCanGoBack(change.canGoBack);
      setCanGoForward(change.canGoForward);
      setZoomPercent(change.zoomPercent);
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onOpenTileRequest((change) => {
      if (!isChangeForTile(change, tileKey)) return;
      if (durableTabId === null) {
        appLogger.warn(
          "[agent-browser] popup dropped before durable tab registration",
          { url: change.url },
        );
        return;
      }
      openFreshAgentBrowserTileFromBrowserPage({
        viewTabId: props.viewTabId,
        paneId: props.paneId,
        hostId: props.node.hostId,
        sessionId: props.node.sessionId,
        url: change.url,
      });
    });
    return () => {
      subscription.dispose();
    };
  }, [
    browserView,
    durableTabId,
    props.node.hostId,
    props.node.sessionId,
    props.paneId,
    props.viewTabId,
    tileKey,
  ]);

  useBrowserViewBoundsBridge({
    browserView,
    surfaceRef,
    tileKey,
    visible,
  });
  const snapshot = useBrowserViewSnapshot(tileKey);
  const cookieCryptoState = useBrowserCookieCryptoState(primaryBridge);
  const elementPicker = useBrowserElementPicker({
    browserView: primaryBridge,
    tileKey,
    status: effectiveStatus,
    targetChatId: registrationChatId,
  });
  const chrome = useElectronTileChrome({
    chromeView: primaryBridge,
    tileKey,
    initialUrl: props.node.url,
    visible,
    capabilities: PRIMARY_TILE_CHROME_CAPABILITIES,
    elementPicker,
    cookieCryptoState,
    statusUrl,
    canGoBack,
    canGoForward,
    zoomPercent,
  });

  return (
    <div
      className="flex h-full w-full flex-col bg-canvas text-foreground"
      data-testid={`agent-browser-tile-${props.node.instanceId}`}
    >
      {chrome.controller !== null ? (
        <BrowserTileFindAdapterBridge
          browserView={primaryBridge}
          tileKey={tileKey}
        />
      ) : null}
      {chrome.controller !== null ? (
        <BrowserTileToolbar controller={chrome.controller} />
      ) : null}
      <div
        ref={surfaceRef}
        className="relative min-h-0 flex-1 bg-background"
        {...{ [BROWSER_VIEW_SURFACE_ATTRIBUTE]: "" }}
      >
        <div
          className={cn(
            "absolute inset-0 flex min-h-0 flex-col items-center justify-center gap-3 px-4 text-center",
            effectiveStatus === "ready" && "pointer-events-none opacity-0",
          )}
          role={
            effectiveStatus === "dead" || effectiveUnreachable
              ? "alert"
              : "status"
          }
          aria-live={
            effectiveStatus === "dead" || effectiveUnreachable
              ? "assertive"
              : "polite"
          }
          aria-busy={effectiveStatus === "loading" && !effectiveUnreachable}
        >
          <AgentBrowserTileStatus
            status={effectiveStatus}
            reason={effectiveStatusReason}
            unreachable={effectiveUnreachable}
            hostId={hostId}
            onRetry={retry}
            onClose={closeCanvasTile}
          />
        </div>
        <BrowserViewSnapshotLayer snapshot={snapshot} />
        <BrowserTileDownloadStrip
          downloads={chrome.downloads}
          onCancel={chrome.cancelDownload}
        />
        <BrowserTileCertificateInterstitial
          certificateError={chrome.certificateError}
          proceeding={chrome.certificateProceeding}
          onProceed={chrome.proceedCertificate}
        />
      </div>
      {chrome.controller !== null ? (
        <BrowserElementPickerResultPanel controller={elementPicker} />
      ) : null}
    </div>
  );
}

interface AgentBrowserTileStatusProps {
  readonly status: BrowserViewStatus;
  readonly reason: string | null;
  readonly unreachable: boolean;
  readonly hostId: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

/**
 * Splits the old single indefinite "Loading page" placeholder into states a
 * user can actually tell apart: still connecting (spinner), gave up waiting
 * (Retry/Close), or the native view is unavailable in this environment.
 */
function AgentBrowserTileStatus(props: AgentBrowserTileStatusProps) {
  if (props.status === "dead") {
    return (
      <>
        <div className="text-ui-base font-medium">
          Agent browser unavailable
        </div>
        <AgentBrowserTileReason reason={props.reason} hostId={props.hostId} />
      </>
    );
  }
  if (props.status === "loading" && props.unreachable) {
    return (
      <>
        <div className="text-ui-base font-medium">
          This session&apos;s host isn&apos;t responding
        </div>
        <AgentBrowserTileReason reason={props.reason} hostId={props.hostId} />
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onRetry}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onClose}
          >
            Close tab
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <AgentSpinningDots className="shrink-0" testId={undefined} variant={undefined} />
      <div className="text-ui-base font-medium">Reconnecting to this session</div>
      <AgentBrowserTileReason reason={props.reason} hostId={props.hostId} />
    </>
  );
}

function AgentBrowserTileReason(props: {
  readonly reason: string | null;
  readonly hostId: string;
}) {
  return (
    <div className="flex max-w-[min(90vw,32rem)] flex-col items-center gap-1 text-ui-sm text-muted-foreground">
      {props.reason === null ? null : <span>{props.reason}</span>}
      <TooltipWrapper
        label={`Host ${props.hostId}`}
        side="top"
        sideOffset={undefined}
        align={undefined}
      >
        <button
          type="button"
          className="text-ui-xs text-muted-foreground/70 underline decoration-dotted underline-offset-2 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Host details
        </button>
      </TooltipWrapper>
    </div>
  );
}

function ignoreAgentBrowserViewError(_error: unknown): void {}

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
