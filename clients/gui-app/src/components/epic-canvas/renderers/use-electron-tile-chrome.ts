import { useEffect, useState, type SyntheticEvent } from "react";
import type { TileChromeCapabilities, TileController } from "@/components/epic-canvas/renderers/tile-controller";
import type { BrowserElementPickerController } from "@/components/epic-canvas/renderers/use-browser-element-picker";
import { normalizeBrowserAddressInput } from "@/lib/browser-view/browser-link-routing-core";
import type { DesktopAgentBrowserViewBridge } from "@/lib/browser-view/desktop-agent-browser-view";
import type {
  BrowserCookieCryptoState,
  BrowserViewCertificateErrorChange,
  BrowserViewDownloadChange,
  BrowserViewTileKey,
  BrowserViewViewportPresetId,
  DesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";

export type ElectronTileChromeView =
  | DesktopBrowserViewBridge
  | DesktopAgentBrowserViewBridge;

interface AddressDraft {
  readonly sourceUrl: string | null;
  readonly value: string;
}

interface UseElectronTileChromeArgs {
  readonly chromeView: ElectronTileChromeView | null;
  readonly tileKey: BrowserViewTileKey;
  readonly initialUrl: string;
  readonly visible: boolean;
  readonly capabilities: TileChromeCapabilities;
  readonly elementPicker: BrowserElementPickerController | null;
  readonly cookieCryptoState: BrowserCookieCryptoState | null;
  readonly statusUrl: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly zoomPercent: number;
  readonly persistViewportPreset: (
    preset: BrowserViewViewportPresetId,
  ) => void;
  readonly initialViewportPreset: BrowserViewViewportPresetId;
}

export interface ElectronTileChrome {
  readonly controller: TileController | null;
  readonly downloads: readonly BrowserViewDownloadChange[];
  readonly certificateError: BrowserViewCertificateErrorChange | null;
  readonly certificateProceeding: boolean;
  readonly cancelDownload: (downloadId: string) => void;
  readonly proceedCertificate: () => void;
}

/**
 * Builds a TileController from a chrome-capable Electron bridge (today:
 * the PRIMARY desktop bridge). Session/agent tiles navigate through the
 * view, never by writing a canvas URL.
 */
export function useElectronTileChrome(
  args: UseElectronTileChromeArgs,
): ElectronTileChrome {
  const {
    chromeView,
    tileKey,
    initialUrl,
    visible,
    capabilities,
    elementPicker,
    cookieCryptoState,
    statusUrl,
    canGoBack,
    canGoForward,
    zoomPercent,
    persistViewportPreset,
    initialViewportPreset,
  } = args;
  const [addressDraft, setAddressDraft] = useState<AddressDraft>({
    sourceUrl: null,
    value: "",
  });
  const [viewportPreset, setViewportPreset] =
    useState<BrowserViewViewportPresetId>(initialViewportPreset);
  const [downloads, setDownloads] = useState<
    readonly BrowserViewDownloadChange[]
  >([]);
  const [certificateError, setCertificateError] =
    useState<BrowserViewCertificateErrorChange | null>(null);
  const [certificateProceeding, setCertificateProceeding] = useState(false);

  const liveUrl = statusUrl.length > 0 ? statusUrl : initialUrl;
  const addressValue =
    addressDraft.sourceUrl === liveUrl ? addressDraft.value : liveUrl;

  useEffect(() => {
    if (chromeView === null) return;
    const subscription = chromeView.onDownloadChange((change) => {
      if (!isChangeForTile(change, tileKey)) return;
      setDownloads((current) => upsertDownload(current, change));
    });
    return () => {
      subscription.dispose();
    };
  }, [chromeView, tileKey]);

  useEffect(() => {
    if (chromeView === null) return;
    const subscription = chromeView.onCertificateError((change) => {
      if (!isChangeForTile(change, tileKey)) return;
      setCertificateProceeding(false);
      setCertificateError(change);
    });
    return () => {
      subscription.dispose();
    };
  }, [chromeView, tileKey]);

  if (chromeView === null) {
    return {
      controller: null,
      downloads: [],
      certificateError: null,
      certificateProceeding: false,
      cancelDownload: ignoreChromeAction,
      proceedCertificate: ignoreChromeAction,
    };
  }

  const navigateToAddress = (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void => {
    event.preventDefault();
    const nextUrl = normalizeBrowserAddressInput(addressValue);
    setAddressDraft({ sourceUrl: nextUrl, value: nextUrl });
    if (nextUrl === liveUrl) return;
    setCertificateError(null);
    setCertificateProceeding(false);
    void chromeView
      .upsertTile({
        ...tileKey,
        url: nextUrl,
        visible,
        viewportPreset,
      })
      .catch(ignoreChromeError);
  };

  const reload = (): void => {
    setCertificateError(null);
    setCertificateProceeding(false);
    void chromeView.reloadTile(tileKey).catch(ignoreChromeError);
  };

  const goBack = (): void => {
    if (!canGoBack) return;
    setCertificateError(null);
    setCertificateProceeding(false);
    void chromeView.goBack(tileKey).catch(ignoreChromeError);
  };

  const goForward = (): void => {
    if (!canGoForward) return;
    setCertificateError(null);
    setCertificateProceeding(false);
    void chromeView.goForward(tileKey).catch(ignoreChromeError);
  };

  const applyViewportPreset = (preset: BrowserViewViewportPresetId): void => {
    setViewportPreset(preset);
    persistViewportPreset(preset);
    void chromeView
      .setViewportPreset({ ...tileKey, viewportPreset: preset })
      .catch(ignoreChromeError);
  };

  const cancelDownload = (downloadId: string): void => {
    void chromeView.cancelDownload({ downloadId }).catch(ignoreChromeError);
  };

  const proceedCertificate = (): void => {
    if (certificateError === null) return;
    setCertificateProceeding(true);
    void chromeView
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
        ignoreChromeError(error);
      });
  };

  const controller: TileController = {
    capabilities,
    url: liveUrl,
    addressValue,
    canGoBack,
    canGoForward,
    zoomPercent,
    viewportPreset,
    disabled: false,
    cookieCryptoState,
    elementPicker,
    onNavigate: navigateToAddress,
    onAddressChange: (value) => {
      setAddressDraft({ sourceUrl: liveUrl, value });
    },
    onBack: goBack,
    onForward: goForward,
    onReload: reload,
    onZoomOut: () => {
      void chromeView.zoomOut(tileKey).catch(ignoreChromeError);
    },
    onZoomIn: () => {
      void chromeView.zoomIn(tileKey).catch(ignoreChromeError);
    },
    onResetZoom: () => {
      void chromeView.resetZoom(tileKey).catch(ignoreChromeError);
    },
    onViewportPresetChange: applyViewportPreset,
    onOpenDevTools: () => {
      void chromeView.openDevTools(tileKey).catch(ignoreChromeError);
    },
  };

  return {
    controller,
    downloads,
    certificateError,
    certificateProceeding,
    cancelDownload,
    proceedCertificate,
  };
}

function isChangeForTile(
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

function ignoreChromeError(_error: unknown): void {}

function ignoreChromeAction(): void {}
