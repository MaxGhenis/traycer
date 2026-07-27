import { useEffect, useState } from "react";
import {
  fallbackCookieCryptoState,
  type BrowserCookieCryptoState,
  type DesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";

interface BrowserCookieCryptoStateLoad {
  readonly state: BrowserCookieCryptoState;
}

export function useBrowserCookieCryptoState(
  browserView: DesktopBrowserViewBridge | null,
): BrowserCookieCryptoState | null {
  const [load, setLoad] = useState<BrowserCookieCryptoStateLoad | null>(null);

  useEffect(() => {
    if (browserView === null) return;
    let active = true;
    browserView
      .getCookieCryptoState()
      .then((nextState) => {
        if (active) setLoad({ state: nextState });
      })
      .catch(() => {
        if (active) setLoad({ state: fallbackCookieCryptoState() });
      });
    return () => {
      active = false;
    };
  }, [browserView]);

  if (browserView === null) return null;
  return load?.state ?? null;
}
