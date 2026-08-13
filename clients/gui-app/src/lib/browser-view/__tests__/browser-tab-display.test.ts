import { describe, expect, it } from "vitest";
import type { BrowserTabInfo } from "@traycer/protocol/host/browser/contracts";
import {
  browserTabFaviconUrl,
  browserTabHostname,
  resolveTabTitle,
} from "@/lib/browser-view/browser-tab-display";

function tab(
  overrides: Partial<BrowserTabInfo> & Pick<BrowserTabInfo, "tabId" | "url">,
): BrowserTabInfo {
  return {
    originTier: "dev",
    status: "ready",
    title: null,
    viewed: false,
    drivenBy: [],
    ...overrides,
  };
}

describe("browser-tab-display", () => {
  it("resolves a title, then hostname, then Browser", () => {
    expect(
      resolveTabTitle(
        tab({ tabId: "tab-title", url: "https://app.example", title: "Inbox" }),
      ),
    ).toBe("Inbox");
    expect(
      resolveTabTitle(
        tab({ tabId: "tab-host", url: "https://app.example/path", title: "  " }),
      ),
    ).toBe("app.example");
    expect(
      resolveTabTitle(tab({ tabId: "tab-unknown", url: "not a URL" })),
    ).toBe("Browser");
  });

  it("extracts hostnames only from parseable urls", () => {
    expect(browserTabHostname("https://app.example/path")).toBe("app.example");
    expect(browserTabHostname("")).toBeNull();
    expect(browserTabHostname("not a URL")).toBeNull();
  });

  it("builds origin favicons only for http and https urls", () => {
    expect(browserTabFaviconUrl("http://app.example:8080/path")).toBe(
      "http://app.example:8080/favicon.ico",
    );
    expect(browserTabFaviconUrl("https://app.example/path")).toBe(
      "https://app.example/favicon.ico",
    );
    expect(browserTabFaviconUrl("about:blank")).toBeNull();
    expect(browserTabFaviconUrl("not a URL")).toBeNull();
  });
});
