import { useState, type SyntheticEvent } from "react";
import type { BrowserScreencastUnsupportedFeature } from "@traycer/protocol/host/browser/contracts";
import type {
  TileChromeCapabilities,
  TileController,
} from "@/components/epic-canvas/renderers/tile-controller";
import { normalizeBrowserAddressInput } from "@/lib/browser-view/browser-link-routing-core";
import type { BrowserViewViewportPresetId } from "@/lib/browser-view/desktop-browser-view";
import { toast } from "sonner";

export interface ScreencastNavState {
  readonly url: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly loading: boolean;
}

export const EMPTY_SCREENCAST_NAV_STATE: ScreencastNavState = {
  url: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
};

export const SCREENCAST_TILE_CHROME_CAPABILITIES: TileChromeCapabilities = {
  navigate: true,
  back: true,
  forward: true,
  reload: true,
  zoom: false,
  viewportPreset: false,
  devtools: false,
  find: false,
  siteInfo: false,
  elementPicker: false,
};

export const SCREENCAST_UNSUPPORTED_INTERACTION_TOASTS = {
  fileUpload: "File upload not supported",
  download: "Download saved on the host",
} as const;

const UNUSED_VIEWPORT_PRESET: BrowserViewViewportPresetId = "responsive";

interface AddressDraft {
  readonly focused: boolean;
  readonly value: string;
}

interface UseScreencastTileChromeArgs {
  readonly navState: ScreencastNavState;
  readonly initialUrl: string;
  readonly disabled: boolean;
  readonly onNavigateUrl: (url: string) => void;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onReload: () => void;
}

export interface ScreencastTileChrome {
  readonly controller: TileController;
  readonly liveUrl: string;
  readonly addressFocused: boolean;
  readonly onAddressFocusChange: (focused: boolean) => void;
}

export function toastScreencastUnsupportedInteraction(
  feature: BrowserScreencastUnsupportedFeature,
): void {
  toast(SCREENCAST_UNSUPPORTED_INTERACTION_TOASTS[feature]);
}

export function screencastLiveUrl(
  navState: ScreencastNavState,
  initialUrl: string,
): string {
  return navState.url.length > 0 ? navState.url : initialUrl;
}

/**
 * Shared-toolbar controller for a headless screencast tile. Capabilities
 * are nav-only; the address draft stays owned by focus, so an in-flight
 * agent navigation cannot clobber a URL the user is still editing.
 */
export function useScreencastTileChrome(
  args: UseScreencastTileChromeArgs,
): ScreencastTileChrome {
  const {
    navState,
    initialUrl,
    disabled,
    onNavigateUrl,
    onBack,
    onForward,
    onReload,
  } = args;
  const [draft, setDraft] = useState<AddressDraft>({
    focused: false,
    value: "",
  });
  const liveUrl = screencastLiveUrl(navState, initialUrl);
  const addressValue = draft.focused ? draft.value : liveUrl;

  const onAddressFocusChange = (focused: boolean): void => {
    setDraft((current) => {
      if (focused) {
        if (current.focused) return current;
        return { focused: true, value: liveUrl };
      }
      return { focused: false, value: "" };
    });
  };

  const controller: TileController = {
    capabilities: SCREENCAST_TILE_CHROME_CAPABILITIES,
    url: liveUrl,
    addressValue,
    canGoBack: navState.canGoBack,
    canGoForward: navState.canGoForward,
    zoomPercent: 100,
    viewportPreset: UNUSED_VIEWPORT_PRESET,
    disabled,
    cookieCryptoState: null,
    elementPicker: null,
    onNavigate: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
      event.preventDefault();
      const url = normalizeBrowserAddressInput(addressValue);
      setDraft((current) =>
        current.focused ? { focused: true, value: url } : current,
      );
      onNavigateUrl(url);
    },
    onAddressChange: (value) => {
      setDraft({ focused: true, value });
    },
    onBack: () => {
      if (!navState.canGoBack) return;
      onBack();
    },
    onForward: () => {
      if (!navState.canGoForward) return;
      onForward();
    },
    onReload,
    onZoomOut: ignoreChromeAction,
    onZoomIn: ignoreChromeAction,
    onResetZoom: ignoreChromeAction,
    onViewportPresetChange: ignoreViewportPreset,
    onOpenDevTools: ignoreChromeAction,
  };

  return {
    controller,
    liveUrl,
    addressFocused: draft.focused,
    onAddressFocusChange,
  };
}

function ignoreChromeAction(): void {}

function ignoreViewportPreset(_preset: BrowserViewViewportPresetId): void {}
