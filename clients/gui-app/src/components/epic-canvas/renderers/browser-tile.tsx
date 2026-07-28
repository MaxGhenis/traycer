import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type RefObject,
  type SyntheticEvent,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Bug,
  Monitor,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Square,
  Tablet,
  Unplug,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTabHostId } from "@/components/epic-canvas/hooks/use-tab-host-id";
import { useTileBodyVisible } from "@/components/epic-canvas/hooks/use-tile-body-visible";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  BROWSER_VIEW_SURFACE_ATTRIBUTE,
  getBrowserViewSnapshot,
  rectFromDomRect,
  registerBrowserOverlayTile,
  subscribeBrowserViewSnapshot,
  updateBrowserOverlayTileRect,
  type BrowserViewSnapshotState,
} from "@/lib/browser-view/browser-overlay-coordinator";
import { browserCookieDegradedMessage } from "@/lib/browser-view/browser-cookie-degraded-message";
import {
  type BrowserViewBounds,
  type BrowserViewCertificateErrorChange,
  type BrowserViewDownloadChange,
  type BrowserViewStatus,
  type BrowserViewTileKey,
  type BrowserViewViewportPresetId,
  type BrowserCookieCryptoState,
  type BrowserViewControlActionResult,
  type DesktopBrowserViewBridge,
  resolveDesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";
import {
  normalizeBrowserAddressInput,
  openFreshBrowserTileFromBrowserPage,
} from "@/lib/browser-view/browser-link-routing-core";
import { useBrowserCookieCryptoState } from "@/lib/browser-view/use-browser-cookie-crypto-state";
import {
  activateBrowserTileControl,
  clearBrowserTileActiveControl,
  clearBrowserTileControlRequest,
  registerBrowserTileControlActionHandler,
  useBrowserTileControlState,
  type BrowserTileControlRequest,
  type BrowserTileActiveControl,
  type BrowserTileControlActionRequest,
} from "@/lib/browser-view/browser-tile-control-store";
import {
  registerAgentBrowserCdpHandler,
  buildCdpResultFrame,
} from "@/lib/browser-view/agent-browser-cdp-store";
import {
  releaseBorrowedTileAttachment,
  useBorrowedTileAttachment,
  type BrowserBorrowedTileAttachment,
} from "@/lib/browser-view/browser-borrowed-tile-store";
import { PANEL_RESIZING_CLASS_NAME } from "@/lib/layout/panel-resizing-class";
import { cn } from "@/lib/utils";
import { useRunnerHost } from "@/providers/use-runner-host";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import type {
  BrowserTileRef,
  EpicCanvasState,
} from "@/stores/epics/canvas/types";
import {
  collectPanes,
  type TileLayoutNode,
  type TilePane,
} from "@/stores/epics/canvas/tile-tree";
import { BrowserDebugPanels } from "@/components/epic-canvas/renderers/browser-debug-panels";
import {
  BrowserElementPickerResultPanel,
  BrowserElementPickerToggle,
} from "@/components/epic-canvas/renderers/browser-element-picker";
import { useBrowserElementPicker } from "@/components/epic-canvas/renderers/use-browser-element-picker";
import { BrowserTileFindAdapterBridge } from "@/components/epic-canvas/renderers/browser-tile-find-adapter";
import {
  BrowserTileCertificateInterstitial,
  BrowserTileDownloadStrip,
} from "@/components/epic-canvas/renderers/browser-tile-status-panels";

export interface BrowserTileProps {
  readonly node: BrowserTileRef;
  readonly viewTabId: string;
  readonly paneId: string;
}

interface BrowserAddressDraft {
  readonly sourceUrl: string | null;
  readonly value: string;
}

type BrowserTileSensitiveActionPrompt = {
  readonly request: BrowserTileControlActionRequest;
  readonly approvalId: string;
  readonly reason: string;
  readonly expiresAt: number;
};

/**
 * Ceiling for how long the human sensitive-action prompt stays open, kept
 * comfortably under the host's `MAX_VISIBLE_TILE_ACTION_TIMEOUT_MS` (30s,
 * browser-session-manager.ts). That clock starts the moment the host
 * broadcasts the action, before this prompt even renders, so a window equal
 * to 30s would still let a stale approval land after the host gave up
 * waiting and re-issued the action to the agent as a timeout - which is how
 * a sensitive value used to get typed twice.
 */
/** Exported for tests that assert the local approval window stays under host wait. */
export const SENSITIVE_ACTION_APPROVAL_WINDOW_MS = 20_000;

const BROWSER_VIEWPORT_PRESETS: ReadonlyArray<{
  readonly id: BrowserViewViewportPresetId;
  readonly label: string;
  readonly description: string;
  readonly Icon: ComponentType<{ readonly className?: string }>;
}> = [
  {
    id: "responsive",
    label: "Responsive",
    description: "Fill tile",
    Icon: Monitor,
  },
  {
    id: "mobile",
    label: "Mobile",
    description: "390 x 844",
    Icon: Smartphone,
  },
  {
    id: "tablet",
    label: "Tablet",
    description: "820 x 1180",
    Icon: Tablet,
  },
  {
    id: "desktop",
    label: "Desktop",
    description: "1440 x 900",
    Icon: Monitor,
  },
];

export function BrowserTile(props: BrowserTileProps) {
  const hostId = useTabHostId();
  const runnerHost = useRunnerHost();
  const visible = useTileBodyVisible();
  const browserView = useMemo(
    () => resolveDesktopBrowserViewBridge(runnerHost),
    [runnerHost],
  );
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [browserStatus, setBrowserStatus] =
    useState<BrowserViewStatus>("loading");
  const [browserStatusReason, setBrowserStatusReason] = useState<string | null>(
    null,
  );
  const [addressDraft, setAddressDraft] = useState<BrowserAddressDraft>({
    sourceUrl: null,
    value: "",
  });
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [downloads, setDownloads] = useState<
    readonly BrowserViewDownloadChange[]
  >([]);
  const [certificateError, setCertificateError] =
    useState<BrowserViewCertificateErrorChange | null>(null);
  const [certificateProceeding, setCertificateProceeding] = useState(false);
  const [sensitiveActionPrompt, setSensitiveActionPrompt] =
    useState<BrowserTileSensitiveActionPrompt | null>(null);
  const updateBrowserTileUrl = useEpicCanvasStore(
    (state) => state.updateBrowserTileUrlInTab,
  );
  const updateBrowserTileViewportPreset = useEpicCanvasStore(
    (state) => state.updateBrowserTileViewportPresetInTab,
  );
  const browserAttachmentTargetChatId = useEpicCanvasStore((state) =>
    selectSiblingChatIdForBrowserTile(
      state.canvasByTabId[props.viewTabId] ?? null,
      props.node.instanceId,
    ),
  );

  const tileKey = useMemo<BrowserViewTileKey>(
    () => ({
      viewTabId: props.viewTabId,
      paneId: props.paneId,
      tileInstanceId: props.node.instanceId,
      pageSessionId: props.node.id,
    }),
    [props.viewTabId, props.paneId, props.node.instanceId, props.node.id],
  );
  const originLabel = browserOriginLabel(props.node.url);
  const addressValue =
    addressDraft.sourceUrl === props.node.url
      ? addressDraft.value
      : props.node.url;
  const status: BrowserViewStatus =
    browserView === null ? "dead" : browserStatus;
  const statusReason =
    browserView === null
      ? "Native browser views are unavailable."
      : browserStatusReason;

  useEffect(() => {
    if (browserView === null) return;
    return () => {
      void browserView.releaseTile(tileKey).catch(ignoreBrowserViewError);
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null) return;
    void browserView
      .upsertTile({
        ...tileKey,
        url: props.node.url,
        visible,
        viewportPreset: readBrowserViewportPreset(props.node.viewportPreset),
      })
      .catch(ignoreBrowserViewError);
  }, [
    browserView,
    tileKey,
    props.node.url,
    props.node.viewportPreset,
    visible,
  ]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onStatusChange((change) => {
      if (!isStatusForTile(change, tileKey)) return;
      setBrowserStatus(change.status);
      setBrowserStatusReason(change.reason);
      setCanGoBack(change.canGoBack);
      setCanGoForward(change.canGoForward);
      setZoomPercent(change.zoomPercent);
      if (change.url.length > 0 && change.url !== props.node.url) {
        updateBrowserTileUrl(
          props.viewTabId,
          props.node.instanceId,
          change.url,
        );
      }
    });
    return () => {
      subscription.dispose();
    };
  }, [
    browserView,
    props.node.instanceId,
    props.node.url,
    props.viewTabId,
    tileKey,
    updateBrowserTileUrl,
  ]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onDownloadChange((change) => {
      if (!isStatusForTile(change, tileKey)) return;
      setDownloads((current) => upsertDownload(current, change));
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onCertificateError((change) => {
      if (!isStatusForTile(change, tileKey)) return;
      setCertificateProceeding(false);
      setCertificateError(change);
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onOpenTileRequest((request) => {
      if (!isStatusForTile(request, tileKey)) return;
      openFreshBrowserTileFromBrowserPage({
        viewTabId: props.viewTabId,
        paneId: props.paneId,
        hostId: props.node.hostId,
        url: request.url,
      });
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, props.node.hostId, props.paneId, props.viewTabId, tileKey]);

  useBrowserViewBoundsBridge({
    browserView,
    surfaceRef,
    tileKey,
    visible,
  });
  const snapshot = useBrowserViewSnapshot(tileKey);
  const cookieCryptoState = useBrowserCookieCryptoState(browserView);
  const elementPicker = useBrowserElementPicker({
    browserView,
    tileKey,
    status,
    targetChatId: browserAttachmentTargetChatId,
  });
  const controlState = useBrowserTileControlState(props.node.instanceId);
  const borrowedAttachment = useBorrowedTileAttachment(props.node.instanceId);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onControlRevoked((change) => {
      if (!isStatusForTile(change, tileKey)) return;
      const active = controlState.active;
      if (active === null || active.requestId !== change.controlId) return;
      active.sendFrame({
        kind: "visibleTileControlRevoked",
        hasBinaryPayload: false,
        requestId: crypto.randomUUID(),
        grantId: active.grant.grantId,
        tileInstanceId: active.tileInstanceId,
        reason: change.reason,
      });
      if (sensitiveActionPrompt !== null) {
        sendBrowserTileControlActionFailure(
          sensitiveActionPrompt.request,
          change.reason,
        );
        setSensitiveActionPrompt(null);
      }
      clearBrowserTileActiveControl({
        tileInstanceId: active.tileInstanceId,
        controlId: active.requestId,
      });
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, controlState.active, sensitiveActionPrompt, tileKey]);

  /**
   * Ticket 09: while - and only while - this tile is borrowed, answer the
   * host's CDP dispatches for it.
   *
   * This registration IS the containment. The transport that can drive a
   * user-partition tile now exists in this renderer, so what keeps the agent
   * off a tile the user never named is that no handler is registered for it:
   * `publishAgentBrowserCdpRequest` falls through to a `tile_not_found`
   * reply, which is the same answer an unmounted tile gives, so an unattached
   * tile is not distinguishable from one that does not exist.
   *
   * The handler is deliberately a thin forwarder to the same
   * `AgentBrowserViewCdpCommand` surface the agent's own tile uses - v3's
   * capability-parity ruling means a borrowed tile is not a reduced surface,
   * and a filter here would be a policy boundary this design does not have.
   */
  useEffect(() => {
    if (browserView === null || borrowedAttachment === null) return;
    return registerAgentBrowserCdpHandler(props.node.instanceId, (request) => {
      void browserView
        .dispatchCdp({
          ...tileKey,
          sessionId: request.sessionId,
          command: request.command,
        })
        .then((result) => {
          request.sendFrame(
            buildCdpResultFrame(
              request.requestId,
              request.tileInstanceId,
              result,
            ),
          );
        })
        .catch((error: unknown) => {
          request.sendFrame(
            buildCdpResultFrame(request.requestId, request.tileInstanceId, {
              kind: request.command.kind,
              ok: false,
              error: {
                kind: "cdp_error",
                message: error instanceof Error ? error.message : String(error),
                code: null,
              },
            }),
          );
        });
    });
  }, [borrowedAttachment, browserView, props.node.instanceId, tileKey]);

  /**
   * Ticket 03's rule - a detached debugger ends agent access rather than
   * being logged - applied to a tile holding the user's real logins, where
   * it matters more than anywhere else. Electron detaches when the user
   * opens DevTools, among other causes; the attachment ends rather than
   * silently going stale, and the indicator goes with it.
   */
  useEffect(() => {
    if (browserView === null || borrowedAttachment === null) return;
    const subscription = browserView.onCdpSessionEnded((change) => {
      if (!isStatusForTile(change, tileKey)) return;
      releaseBorrowedTileAttachment({
        attachment: borrowedAttachment,
        reason: `Browser debugger detached: ${change.reason}`,
      });
    });
    return () => {
      subscription.dispose();
    };
  }, [borrowedAttachment, browserView, tileKey]);

  useEffect(() => {
    return registerBrowserTileControlActionHandler(
      props.node.instanceId,
      (request) => {
        const active = controlState.active;
        if (browserView === null || active === null) {
          request.sendFrame({
            kind: "visibleTileControlActionResult",
            hasBinaryPayload: false,
            requestId: request.requestId,
            grantId: request.grantId,
            ok: false,
            reason: "Visible browser tile control is not active.",
            value: null,
          });
          return;
        }
        if (active.grant.grantId !== request.grantId) {
          request.sendFrame({
            kind: "visibleTileControlActionResult",
            hasBinaryPayload: false,
            requestId: request.requestId,
            grantId: request.grantId,
            ok: false,
            reason: "Visible browser tile grant is not active.",
            value: null,
          });
          return;
        }
        void browserView
          .executeControlAction({
            ...tileKey,
            controlId: active.requestId,
            actionId: request.requestId,
            sensitiveApprovalId: null,
            action: request.action,
          })
          .then((result) => {
            if (result.status === "needs-approval") {
              setSensitiveActionPrompt({
                request,
                approvalId: result.approvalId,
                reason: result.reason,
                expiresAt: Date.now() + SENSITIVE_ACTION_APPROVAL_WINDOW_MS,
              });
              return;
            }
            sendBrowserTileControlActionResult(request, result);
          })
          .catch((error: unknown) => {
            sendBrowserTileControlActionFailure(
              request,
              error instanceof Error ? error.message : String(error),
            );
          });
      },
    );
  }, [browserView, controlState.active, props.node.instanceId, tileKey]);

  useEffect(() => {
    if (sensitiveActionPrompt === null) return;
    const timeoutMs = Math.max(0, sensitiveActionPrompt.expiresAt - Date.now());
    const timer = setTimeout(() => {
      sendBrowserTileControlActionFailure(
        sensitiveActionPrompt.request,
        "Timed out waiting for sensitive browser action approval.",
      );
      setSensitiveActionPrompt((current) =>
        current?.approvalId === sensitiveActionPrompt.approvalId
          ? null
          : current,
      );
    }, timeoutMs);
    return () => {
      clearTimeout(timer);
    };
  }, [sensitiveActionPrompt]);

  const navigateToAddress = (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void => {
    event.preventDefault();
    const nextUrl = normalizeBrowserAddressInput(addressValue);
    setAddressDraft({ sourceUrl: nextUrl, value: nextUrl });
    if (nextUrl === props.node.url) return;
    setBrowserStatus("loading");
    setBrowserStatusReason(null);
    setCertificateError(null);
    setCertificateProceeding(false);
    updateBrowserTileUrl(props.viewTabId, props.node.instanceId, nextUrl);
  };

  const reload = (): void => {
    if (browserView === null) return;
    setBrowserStatus("loading");
    setBrowserStatusReason(null);
    setCertificateError(null);
    setCertificateProceeding(false);
    void browserView.reloadTile(tileKey).catch(ignoreBrowserViewError);
  };

  const goBack = (): void => {
    if (browserView === null || !canGoBack) return;
    setBrowserStatus("loading");
    setBrowserStatusReason(null);
    setCertificateError(null);
    setCertificateProceeding(false);
    void browserView.goBack(tileKey).catch(ignoreBrowserViewError);
  };

  const goForward = (): void => {
    if (browserView === null || !canGoForward) return;
    setBrowserStatus("loading");
    setBrowserStatusReason(null);
    setCertificateError(null);
    setCertificateProceeding(false);
    void browserView.goForward(tileKey).catch(ignoreBrowserViewError);
  };

  const zoomOut = (): void => {
    if (browserView === null) return;
    void browserView.zoomOut(tileKey).catch(ignoreBrowserViewError);
  };

  const zoomIn = (): void => {
    if (browserView === null) return;
    void browserView.zoomIn(tileKey).catch(ignoreBrowserViewError);
  };

  const resetZoom = (): void => {
    if (browserView === null) return;
    void browserView.resetZoom(tileKey).catch(ignoreBrowserViewError);
  };

  const setViewportPreset = (preset: BrowserViewViewportPresetId): void => {
    updateBrowserTileViewportPreset(
      props.viewTabId,
      props.node.instanceId,
      preset,
    );
    if (browserView === null) return;
    void browserView
      .setViewportPreset({ ...tileKey, viewportPreset: preset })
      .catch(ignoreBrowserViewError);
  };

  const openDevTools = (): void => {
    if (browserView === null) return;
    void browserView.openDevTools(tileKey).catch(ignoreBrowserViewError);
  };

  const cancelDownload = (downloadId: string): void => {
    if (browserView === null) return;
    void browserView
      .cancelDownload({ downloadId })
      .catch(ignoreBrowserViewError);
  };

  const proceedCertificate = (): void => {
    if (browserView === null || certificateError === null) return;
    setCertificateProceeding(true);
    void browserView
      .trustCertificate({
        ...tileKey,
        certificateErrorId: certificateError.certificateErrorId,
      })
      .then(() => {
        setCertificateError(null);
        setCertificateProceeding(false);
      })
      .catch((error: unknown) => {
        setCertificateProceeding(false);
        ignoreBrowserViewError(error);
      });
  };

  const approveControlRequest = (request: BrowserTileControlRequest): void => {
    if (browserView === null || controlState.active !== null) return;
    const currentOrigin = originFromUrl(props.node.url);
    if (currentOrigin !== request.origin) {
      request.sendFrame({
        kind: "visibleTileControlDecision",
        hasBinaryPayload: false,
        requestId: request.requestId,
        approved: false,
        grant: null,
        reason: "The visible tile navigated to a different origin.",
      });
      clearBrowserTileControlRequest({
        tileInstanceId: request.tileInstanceId,
        requestId: request.requestId,
      });
      return;
    }
    const grant = {
      grantId: request.grantId,
      chatId: request.chatId,
      tileInstanceId: request.tileInstanceId,
      origin: request.origin,
      dataLevel: "control" as const,
      expiresAt: request.expiresAt,
    };
    void browserView
      .grantControl({
        ...tileKey,
        controlId: request.requestId,
        chatId: request.chatId,
        agentRunId: request.agentRunId,
        agentLabel: request.agentLabel,
        origin: request.origin,
        expiresAt: request.expiresAt,
      })
      .then((result) => {
        if (result.status === "queued") {
          return;
        }
        if (result.status !== "granted") {
          request.sendFrame({
            kind: "visibleTileControlDecision",
            hasBinaryPayload: false,
            requestId: request.requestId,
            approved: false,
            grant: null,
            reason: result.reason,
          });
          clearBrowserTileControlRequest({
            tileInstanceId: request.tileInstanceId,
            requestId: request.requestId,
          });
          return;
        }
        request.sendFrame({
          kind: "visibleTileControlDecision",
          hasBinaryPayload: false,
          requestId: request.requestId,
          approved: true,
          grant,
          reason: null,
        });
        activateBrowserTileControl({ request, grant });
      })
      .catch((error: unknown) => {
        request.sendFrame({
          kind: "visibleTileControlDecision",
          hasBinaryPayload: false,
          requestId: request.requestId,
          approved: false,
          grant: null,
          reason: error instanceof Error ? error.message : String(error),
        });
        clearBrowserTileControlRequest({
          tileInstanceId: request.tileInstanceId,
          requestId: request.requestId,
        });
      });
  };

  const stopControl = (active: BrowserTileActiveControl): void => {
    if (browserView !== null) {
      void browserView
        .revokeControl({
          ...tileKey,
          controlId: active.requestId,
          reason: "User stopped browser control.",
        })
        .catch(ignoreBrowserViewError);
      return;
    }
    active.sendFrame({
      kind: "visibleTileControlRevoked",
      hasBinaryPayload: false,
      requestId: crypto.randomUUID(),
      grantId: active.grant.grantId,
      tileInstanceId: active.tileInstanceId,
      reason: "User stopped browser control.",
    });
    clearBrowserTileActiveControl({
      tileInstanceId: active.tileInstanceId,
      controlId: active.requestId,
    });
  };

  const detachBorrowedTile = (
    attachment: BrowserBorrowedTileAttachment,
  ): void => {
    releaseBorrowedTileAttachment({
      attachment,
      reason: "User detached the agent from this browser tab.",
    });
  };

  const approveSensitiveAction = (
    prompt: BrowserTileSensitiveActionPrompt,
  ): void => {
    if (Date.now() >= prompt.expiresAt) {
      // The host's own wait for this action has almost certainly already
      // expired and been reported to the agent as a timeout by this point
      // (see `SENSITIVE_ACTION_APPROVAL_WINDOW_MS`). A click that lands here
      // is approving a request the host no longer has - execute it and the
      // agent's retry types the same value again. Treat it as expired
      // instead of live: this is the same failure the auto-expiry effect
      // reports, kept as an explicit check because a backgrounded/throttled
      // tab can delay that effect's timer past this point.
      sendBrowserTileControlActionFailure(
        prompt.request,
        "Sensitive browser action approval window expired.",
      );
      setSensitiveActionPrompt(null);
      return;
    }
    const active = controlState.active;
    if (browserView === null || active === null) {
      sendBrowserTileControlActionFailure(
        prompt.request,
        "Visible browser tile control is not active.",
      );
      setSensitiveActionPrompt(null);
      return;
    }
    if (active.grant.grantId !== prompt.request.grantId) {
      sendBrowserTileControlActionFailure(
        prompt.request,
        "Visible browser tile grant is not active.",
      );
      setSensitiveActionPrompt(null);
      return;
    }
    setSensitiveActionPrompt(null);
    void browserView
      .executeControlAction({
        ...tileKey,
        controlId: active.requestId,
        actionId: prompt.request.requestId,
        sensitiveApprovalId: prompt.approvalId,
        action: prompt.request.action,
      })
      .then((result) => {
        if (result.status === "needs-approval") {
          sendBrowserTileControlActionFailure(
            prompt.request,
            "Sensitive browser action approval was not accepted.",
          );
          return;
        }
        sendBrowserTileControlActionResult(prompt.request, result);
      })
      .catch((error: unknown) => {
        sendBrowserTileControlActionFailure(
          prompt.request,
          error instanceof Error ? error.message : String(error),
        );
      });
  };

  const denySensitiveAction = (
    prompt: BrowserTileSensitiveActionPrompt,
  ): void => {
    sendBrowserTileControlActionFailure(
      prompt.request,
      "User denied sensitive browser action.",
    );
    setSensitiveActionPrompt(null);
  };

  return (
    <div
      className="flex h-full w-full flex-col bg-canvas text-foreground"
      data-testid={`browser-tile-${props.node.instanceId}`}
    >
      <BrowserTileFindAdapterBridge
        browserView={browserView}
        tileKey={tileKey}
      />
      <div className="flex min-h-0 items-center gap-2 border-b border-border px-2 py-1.5 text-ui-sm">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            disabled={browserView === null || !canGoBack}
            onClick={goBack}
          >
            <ArrowLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Forward"
            disabled={browserView === null || !canGoForward}
            onClick={goForward}
          >
            <ArrowRight />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reload"
            disabled={browserView === null}
            onClick={reload}
          >
            <RotateCw />
          </Button>
        </div>
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={navigateToAddress}
        >
          <span className="shrink-0 rounded-sm border border-border bg-muted px-2 py-1 text-ui-xs font-medium text-muted-foreground">
            {originLabel}
          </span>
          <Input
            aria-label="Browser address"
            value={addressValue}
            onChange={(event) => {
              setAddressDraft({
                sourceUrl: props.node.url,
                value: event.target.value,
              });
            }}
            className="h-7 flex-1 font-mono text-ui-sm"
            spellCheck={false}
          />
        </form>
        <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={browserView === null}
            onClick={zoomOut}
          >
            <ZoomOut />
          </Button>
          <button
            type="button"
            aria-label="Reset zoom"
            className="w-12 rounded-sm px-1 py-1 text-center text-ui-xs tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={browserView === null}
            onClick={resetZoom}
          >
            {zoomPercent}%
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={browserView === null}
            onClick={zoomIn}
          >
            <ZoomIn />
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
          <BrowserViewportPresetMenu
            value={readBrowserViewportPreset(props.node.viewportPreset)}
            disabled={browserView === null}
            onChange={setViewportPreset}
          />
          <BrowserElementPickerToggle controller={elementPicker} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-ui-xs"
            aria-label="Open browser DevTools"
            disabled={browserView === null}
            onClick={openDevTools}
          >
            <Bug className="size-3.5" />
            DevTools
          </Button>
        </div>
      </div>
      {cookieCryptoState?.mode === "degraded" ? (
        <BrowserCookieDegradedBanner cryptoState={cookieCryptoState} />
      ) : null}
      <BrowserTileSensitiveActionBanner
        prompt={sensitiveActionPrompt}
        onApprove={approveSensitiveAction}
        onDeny={denySensitiveAction}
      />
      <BrowserTileBorrowedBanner
        attachment={borrowedAttachment}
        onDetach={detachBorrowedTile}
      />
      <BrowserTileControlBanner
        pending={controlState.pending}
        active={controlState.active}
        busy={browserView === null || controlState.active !== null}
        onApprove={approveControlRequest}
        onDeny={denyControlRequest}
        onStop={stopControl}
      />
      <div
        ref={surfaceRef}
        className="relative min-h-0 flex-1 bg-background"
        {...{ [BROWSER_VIEW_SURFACE_ATTRIBUTE]: "" }}
      >
        <div
          className={cn(
            "absolute inset-0 flex min-h-0 flex-col items-center justify-center gap-3 px-4 text-center",
            status === "ready" && "pointer-events-none opacity-0",
          )}
        >
          <div className="text-ui-base font-medium">
            {status === "dead" ? "Browser view unavailable" : "Loading page"}
          </div>
          <div className="max-w-[min(90vw,32rem)] text-ui-sm text-muted-foreground">
            {statusReason ?? `Host ${hostId}`}
          </div>
          {status === "dead" && browserView !== null ? (
            <button
              type="button"
              className="rounded border border-border bg-muted px-3 py-1 text-ui-sm text-foreground hover:bg-muted/80"
              onClick={reload}
            >
              Reload
            </button>
          ) : null}
        </div>
        <BrowserViewSnapshotLayer snapshot={snapshot} />
        <BrowserTileDownloadStrip
          downloads={downloads}
          onCancel={cancelDownload}
        />
        <BrowserTileCertificateInterstitial
          certificateError={certificateError}
          proceeding={certificateProceeding}
          onProceed={proceedCertificate}
        />
      </div>
      <BrowserElementPickerResultPanel controller={elementPicker} />
      <BrowserDebugPanels
        browserView={browserView}
        tileKey={tileKey}
        pageUrl={props.node.url}
        status={status}
        targetChatId={browserAttachmentTargetChatId}
      />
    </div>
  );
}

function denyControlRequest(request: BrowserTileControlRequest): void {
  request.sendFrame({
    kind: "visibleTileControlDecision",
    hasBinaryPayload: false,
    requestId: request.requestId,
    approved: false,
    grant: null,
    reason: "User denied visible tile control.",
  });
  clearBrowserTileControlRequest({
    tileInstanceId: request.tileInstanceId,
    requestId: request.requestId,
  });
}

function sendBrowserTileControlActionResult(
  request: BrowserTileControlActionRequest,
  result: BrowserViewControlActionResult,
): void {
  request.sendFrame({
    kind: "visibleTileControlActionResult",
    hasBinaryPayload: false,
    requestId: request.requestId,
    grantId: request.grantId,
    ok: result.status === "completed",
    reason: result.status === "completed" ? null : result.reason,
    value: result.status === "completed" ? result.value : null,
  });
}

function sendBrowserTileControlActionFailure(
  request: BrowserTileControlActionRequest,
  reason: string,
): void {
  request.sendFrame({
    kind: "visibleTileControlActionResult",
    hasBinaryPayload: false,
    requestId: request.requestId,
    grantId: request.grantId,
    ok: false,
    reason,
    value: null,
  });
}

function selectSiblingChatIdForBrowserTile(
  canvas: EpicCanvasState | null,
  browserInstanceId: string,
): string | null {
  if (canvas === null || canvas.root === null) return null;
  const panes = panesSharingGroupWithTile(canvas.root, browserInstanceId);
  const chatIds = panes.flatMap((pane) => activeChatIdInPane(canvas, pane));
  return chatIds[0] ?? null;
}

function panesSharingGroupWithTile(
  node: TileLayoutNode,
  tileInstanceId: string,
): readonly TilePane[] {
  if (node.kind === "pane") return [];
  const childWithTile = node.children.find((child) =>
    layoutContainsTile(child, tileInstanceId),
  );
  if (childWithTile === undefined) {
    return node.children.flatMap((child) =>
      panesSharingGroupWithTile(child, tileInstanceId),
    );
  }
  return node.children
    .flatMap((child) => collectPanes(child))
    .filter((pane) => !pane.tabInstanceIds.includes(tileInstanceId));
}

function layoutContainsTile(
  node: TileLayoutNode,
  tileInstanceId: string,
): boolean {
  if (node.kind === "pane") return node.tabInstanceIds.includes(tileInstanceId);
  return node.children.some((child) =>
    layoutContainsTile(child, tileInstanceId),
  );
}

function activeChatIdInPane(
  canvas: EpicCanvasState,
  pane: TilePane,
): readonly string[] {
  if (pane.activeTabId === null) return [];
  const tile = canvas.tilesByInstanceId[pane.activeTabId];
  if (tile === undefined || tile.type !== "chat") return [];
  return [tile.id];
}

function BrowserCookieDegradedBanner(props: {
  readonly cryptoState: BrowserCookieCryptoState;
}) {
  return (
    <div
      role="status"
      data-testid="browser-cookie-degraded-banner"
      className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-50 px-3 py-2 text-ui-sm text-amber-950 dark:bg-amber-950/35 dark:text-amber-100"
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        {browserCookieDegradedMessage(props.cryptoState)}
      </span>
    </div>
  );
}

function BrowserTileSensitiveActionBanner(props: {
  readonly prompt: BrowserTileSensitiveActionPrompt | null;
  readonly onApprove: (prompt: BrowserTileSensitiveActionPrompt) => void;
  readonly onDeny: (prompt: BrowserTileSensitiveActionPrompt) => void;
}) {
  const prompt = props.prompt;
  if (prompt === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-rose-500/35 bg-rose-500/10 px-3 py-1.5 text-ui-xs">
      <ShieldCheck className="size-3.5 shrink-0 text-rose-600" />
      <div className="min-w-0 flex-1 truncate text-rose-950 dark:text-rose-100">
        Sensitive browser typing requires approval
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-ui-xs"
        onClick={() => props.onDeny(prompt)}
      >
        Deny
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2 text-ui-xs"
        onClick={() => props.onApprove(prompt)}
      >
        Approve
      </Button>
    </div>
  );
}

/**
 * Ticket 09's passive indicator, and our one deliberate divergence from
 * Aside, which marks borrowed tabs not at all.
 *
 * It is an **indicator, not a prompt**: nothing is blocked behind it, it
 * asks no question, and ignoring it entirely is a valid thing for the user
 * to do - the consent was the request they already made in chat. What it
 * owes them is that the state is never a surprise: who is driving, until
 * when, and a way out that works immediately.
 *
 * Visually distinct from `BrowserTileControlBanner` below on purpose. That
 * one is T18's ask-then-grant flow and is green-for-approved; this is amber,
 * because a page the agent reads here can steer it and it is acting inside
 * the user's own logged-in session (v3's accepted blast radius). Same tile,
 * two different things, and they must not be mistaken for each other.
 *
 * Ticket 12 adds the one-click Stop beside Detach, with the honest "stopped"
 * versus "outcome unknown" distinction that needs host-side composition this
 * ticket does not own. Deliberately not stubbed here: a Stop that does
 * nothing, or that claims "stopped" when a dispatched command may already
 * have landed, is worse than the empty space.
 */
function BrowserTileBorrowedBanner(props: {
  readonly attachment: BrowserBorrowedTileAttachment | null;
  readonly onDetach: (attachment: BrowserBorrowedTileAttachment) => void;
}) {
  const attachment = props.attachment;
  if (attachment === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-ui-xs">
      <Bot className="size-3.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 truncate text-amber-950 dark:text-amber-100">
        {/* States the fact rather than warning about it: the load-bearing
            part is "your browser session", i.e. this is the user's own
            partition and whatever it is signed into, not the agent's
            credential-free one. Deliberately does not assert the user IS
            signed in on this site - that would be a guess, and a banner that
            is sometimes wrong is a banner people learn to ignore. The
            up-front risk copy belongs at the labs toggle (ticket 11). */}
        {attachment.agentLabel} is driving this tab in your browser session
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1.5 px-2 text-ui-xs"
        onClick={() => props.onDetach(attachment)}
      >
        <Unplug className="size-3" />
        Detach
      </Button>
    </div>
  );
}

function BrowserTileControlBanner(props: {
  readonly pending: BrowserTileControlRequest | null;
  readonly active: BrowserTileActiveControl | null;
  readonly busy: boolean;
  readonly onApprove: (request: BrowserTileControlRequest) => void;
  readonly onDeny: (request: BrowserTileControlRequest) => void;
  readonly onStop: (active: BrowserTileActiveControl) => void;
}) {
  const active = props.active;
  if (active !== null) {
    return (
      <div className="flex min-w-0 items-center gap-2 border-b border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-ui-xs">
        <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1 truncate text-emerald-900 dark:text-emerald-100">
          {active.agentLabel} is controlling this browser from chat{" "}
          {active.chatId}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-ui-xs"
          onClick={() => props.onStop(active)}
        >
          <Square className="size-3" />
          Stop
        </Button>
      </div>
    );
  }
  const pending = props.pending;
  if (pending === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-ui-xs">
      <ShieldCheck className="size-3.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 truncate text-amber-950 dark:text-amber-100">
        {pending.agentLabel} requests control of this browser for{" "}
        {pending.origin}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-ui-xs"
        onClick={() => props.onDeny(pending)}
      >
        Deny
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2 text-ui-xs"
        disabled={props.busy}
        onClick={() => props.onApprove(pending)}
      >
        Grant
      </Button>
    </div>
  );
}

function BrowserViewportPresetMenu(props: {
  readonly value: BrowserViewViewportPresetId;
  readonly disabled: boolean;
  readonly onChange: (preset: BrowserViewViewportPresetId) => void;
}) {
  const current =
    BROWSER_VIEWPORT_PRESETS.find((preset) => preset.id === props.value) ??
    BROWSER_VIEWPORT_PRESETS[0];
  const CurrentIcon = current.Icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-ui-xs"
          aria-label="Browser viewport preset"
          disabled={props.disabled}
        >
          <CurrentIcon className="size-3.5" />
          <span className="hidden sm:inline">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(80vw,13rem)]">
        {BROWSER_VIEWPORT_PRESETS.map((preset) => {
          const Icon = preset.Icon;
          return (
            <DropdownMenuItem
              key={preset.id}
              className="gap-2"
              onSelect={() => props.onChange(preset.id)}
            >
              <Icon className="size-4" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-sm">
                  {preset.label}
                </span>
                <span className="block truncate text-ui-xs text-muted-foreground">
                  {preset.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface UseBrowserViewBoundsBridgeArgs {
  readonly browserView: DesktopBrowserViewBridge | null;
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly tileKey: BrowserViewTileKey;
  readonly visible: boolean;
}

function useBrowserViewBoundsBridge(
  args: UseBrowserViewBoundsBridgeArgs,
): void {
  const { browserView, surfaceRef, tileKey, visible } = args;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (browserView === null || surface === null || !visible) return;
    const unregisterOverlayTile = registerBrowserOverlayTile({
      key: tileKey,
      rect: rectFromDomRect(surface.getBoundingClientRect()),
    });

    let frameId: number | null = null;
    let frozen = document.documentElement.classList.contains(
      PANEL_RESIZING_CLASS_NAME,
    );

    const sendBounds = (force: boolean): void => {
      const rect = surface.getBoundingClientRect();
      const bounds = readElementBounds(rect);
      if (bounds.width <= 0 || bounds.height <= 0) return;
      if (frozen && !force) return;
      updateBrowserOverlayTileRect(tileKey, rectFromDomRect(rect));
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        void browserView
          .updateBounds({ ...tileKey, bounds })
          .catch(ignoreBrowserViewError);
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
      unregisterOverlayTile();
    };
  }, [browserView, surfaceRef, tileKey, visible]);
}

function useBrowserViewSnapshot(
  tileKey: BrowserViewTileKey,
): BrowserViewSnapshotState | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeBrowserViewSnapshot(tileKey, listener),
    [tileKey],
  );
  const readSnapshot = useCallback(
    () => getBrowserViewSnapshot(tileKey),
    [tileKey],
  );
  return useSyncExternalStore(subscribe, readSnapshot, () => null);
}

function BrowserViewSnapshotLayer(props: {
  readonly snapshot: BrowserViewSnapshotState | null;
}) {
  const snapshot = props.snapshot;
  if (snapshot === null) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 bg-background"
      data-browser-view-snapshot=""
      data-stale={snapshot.stale ? "true" : "false"}
    >
      {snapshot.dataUrl === null || snapshot.stale ? null : (
        <img
          src={snapshot.dataUrl}
          alt=""
          aria-hidden
          className="h-full w-full object-fill"
          draggable={false}
        />
      )}
    </div>
  );
}

function browserOriginLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "local";
    }
    return "unclassified";
  } catch {
    return "local";
  }
}

function originFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    return "";
  }
  return "";
}

function readBrowserViewportPreset(value: string): BrowserViewViewportPresetId {
  if (
    value === "responsive" ||
    value === "mobile" ||
    value === "tablet" ||
    value === "desktop"
  ) {
    return value;
  }
  return "responsive";
}

function readElementBounds(rect: DOMRectReadOnly): BrowserViewBounds {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function upsertDownload(
  current: readonly BrowserViewDownloadChange[],
  change: BrowserViewDownloadChange,
): readonly BrowserViewDownloadChange[] {
  const existingIndex = current.findIndex(
    (download) => download.downloadId === change.downloadId,
  );
  if (existingIndex < 0) {
    return [...current, change].slice(-5);
  }
  return current
    .map((download, index) => (index === existingIndex ? change : download))
    .slice(-5);
}

function isStatusForTile(
  change: BrowserViewTileKey,
  key: BrowserViewTileKey,
): boolean {
  return (
    change.viewTabId === key.viewTabId &&
    change.paneId === key.paneId &&
    change.tileInstanceId === key.tileInstanceId &&
    change.pageSessionId === key.pageSessionId
  );
}

function ignoreBrowserViewError(_error: unknown): void {}
