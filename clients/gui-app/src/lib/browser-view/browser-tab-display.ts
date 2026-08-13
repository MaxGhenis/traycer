import type { BrowserTabInfo } from "@traycer/protocol/host/browser/contracts";

/**
 * Every browser-tab reference surface (sidebar rows, chat chips) resolves the
 * same title-fallback chain, so it lives here once instead of drifting.
 */
export function resolveTabTitle(tab: BrowserTabInfo): string {
  if (tab.title !== null && tab.title.trim().length > 0) return tab.title;
  const host = browserTabHostname(tab.url);
  return host ?? "Browser";
}

export function browserTabHostname(url: string): string | null {
  if (url.length === 0) return null;
  try {
    const hostname = new URL(url).hostname;
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

export function browserTabFaviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return new URL("/favicon.ico", parsed.origin).toString();
  } catch {
    return null;
  }
}
