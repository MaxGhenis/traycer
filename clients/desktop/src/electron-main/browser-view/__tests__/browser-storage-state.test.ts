import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cookie } from "electron";
import type { BrowserCookieCryptoState } from "../../../ipc-contracts/browser-view-types";
import { BROWSER_VIEW_PARTITION } from "../browser-session";
import {
  applyBrowserViewStorageStateWithDependencies,
  captureBrowserPrimaryProfileWithDependencies,
  captureBrowserViewStorageStateWithDependencies,
  type BrowserPrimaryProfileCaptureDependencies,
  type BrowserStorageStateApplyDependencies,
  type BrowserStorageStateCaptureDependencies,
} from "../browser-storage-state";

vi.mock("electron", () => ({
  session: {
    fromPartition: () => {
      throw new Error("unexpected production electron session access");
    },
  },
  app: {
    commandLine: {
      hasSwitch: () => false,
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "unknown",
  },
}));

vi.mock("../../app/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

interface CookieSetDetails {
  readonly url: string;
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expirationDate: number | undefined;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "strict" | "lax" | "no_restriction";
}

const realState: BrowserCookieCryptoState = {
  mode: "real",
  persistence: "persistent",
  reason: "os-backed",
  storageBackend: null,
  encryptionAvailable: true,
  mockKeychainEnabled: false,
};

const degradedState: BrowserCookieCryptoState = {
  mode: "degraded",
  persistence: "ephemeral",
  reason: "mock-keychain",
  storageBackend: null,
  encryptionAvailable: false,
  mockKeychainEnabled: true,
};

describe("applyBrowserViewStorageStateWithDependencies", () => {
  let cookieSets: CookieSetDetails[];
  let fromPartitionCalls: Array<{
    readonly partition: string;
    readonly options: { readonly cache: boolean };
  }>;

  beforeEach(() => {
    cookieSets = [];
    fromPartitionCalls = [];
  });

  it("validates and applies cookies to the persistent browser partition", async () => {
    await expect(
      applyBrowserViewStorageStateWithDependencies(
        {
          storageState: {
            cookies: [
              {
                name: "sid",
                value: "abc",
                domain: ".example.test",
                path: "/",
                expires: 4102444800,
                httpOnly: true,
                secure: true,
                sameSite: "Lax",
              },
            ],
            origins: [
              {
                origin: "https://example.test",
                localStorage: [{ name: "theme", value: "dark" }],
              },
            ],
          },
        },
        dependencies(realState, cookieSets, fromPartitionCalls),
      ),
    ).resolves.toEqual({
      status: "applied",
      cookieCount: 1,
      localStorageApplied: false,
      reason: "cookies-only",
    });

    expect(fromPartitionCalls).toEqual([
      { partition: BROWSER_VIEW_PARTITION, options: { cache: true } },
    ]);
    expect(cookieSets).toEqual([
      {
        url: "https://example.test/",
        name: "sid",
        value: "abc",
        domain: ".example.test",
        path: "/",
        expirationDate: 4102444800,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      },
    ]);
  });

  it("skips persistent writes when browser cookie crypto is degraded", async () => {
    await expect(
      applyBrowserViewStorageStateWithDependencies(
        {
          storageState: {
            cookies: [
              {
                name: "sid",
                value: "abc",
                domain: "example.test",
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "None",
              },
            ],
            origins: [],
          },
        },
        dependencies(degradedState, cookieSets, fromPartitionCalls),
      ),
    ).resolves.toEqual({
      status: "skipped-degraded",
      cookieCount: 0,
      localStorageApplied: false,
      reason: "mock-keychain",
    });

    expect(fromPartitionCalls).toEqual([]);
    expect(cookieSets).toEqual([]);
  });

  it("fails malformed storageState before opening the browser partition", async () => {
    await expect(
      applyBrowserViewStorageStateWithDependencies(
        {
          storageState: {
            cookies: [
              {
                name: "sid",
                value: "abc",
                domain: "example.test",
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Invalid",
              },
            ],
            origins: [],
          },
        },
        dependencies(realState, cookieSets, fromPartitionCalls),
      ),
    ).rejects.toThrow("sameSite");

    expect(fromPartitionCalls).toEqual([]);
    expect(cookieSets).toEqual([]);
  });

  it.each([
    ["credentials syntax", "example.test@evil.test"],
    ["port syntax", "example.test:443"],
    ["path syntax", "example.test/path"],
    ["whitespace", "example. test"],
    ["control character", "example.test\n"],
    ["hostname normalization mismatch", "éxample.test"],
  ])(
    "rejects cookie domain with %s before opening the partition",
    async (_label, domain) => {
      await expect(
        applyBrowserViewStorageStateWithDependencies(
          {
            storageState: {
              cookies: [
                {
                  name: "sid",
                  value: "abc",
                  domain,
                  path: "/",
                  expires: -1,
                  httpOnly: false,
                  secure: false,
                  sameSite: "Lax",
                },
              ],
              origins: [],
            },
          },
          dependencies(realState, cookieSets, fromPartitionCalls),
        ),
      ).rejects.toThrow("domain");

      expect(fromPartitionCalls).toEqual([]);
      expect(cookieSets).toEqual([]);
    },
  );

  it("rejects cookie paths that URL parsing would reshape before opening the partition", async () => {
    await expect(
      applyBrowserViewStorageStateWithDependencies(
        {
          storageState: {
            cookies: [
              {
                name: "sid",
                value: "abc",
                domain: "example.test",
                path: "/account?admin=true",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Lax",
              },
            ],
            origins: [],
          },
        },
        dependencies(realState, cookieSets, fromPartitionCalls),
      ),
    ).rejects.toThrow("path");

    expect(fromPartitionCalls).toEqual([]);
    expect(cookieSets).toEqual([]);
  });

  it("writes cookies sequentially and stops on runtime set failure", async () => {
    await expect(
      applyBrowserViewStorageStateWithDependencies(
        {
          storageState: {
            cookies: [
              storageCookie("first"),
              storageCookie("second"),
              storageCookie("third"),
            ],
            origins: [],
          },
        },
        dependenciesThatRejectCookie(
          realState,
          cookieSets,
          fromPartitionCalls,
          "second",
        ),
      ),
    ).rejects.toThrow("set failed for second");

    expect(fromPartitionCalls).toEqual([
      { partition: BROWSER_VIEW_PARTITION, options: { cache: true } },
    ]);
    expect(cookieSets.map((details) => details.name)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("captureBrowserViewStorageStateWithDependencies", () => {
  it("flushes and captures only cookies and localStorage for the chosen origin", async () => {
    const calls: string[] = [];
    const webContents = {
      getURL: () => "http://localhost:3000/dashboard",
      executeJavaScript: (script: string, userGesture: boolean) => {
        calls.push(`${userGesture ? "gesture" : "no-gesture"}:${script}`);
        return Promise.resolve([{ name: "token", value: "abc" }]);
      },
    };

    await expect(
      captureBrowserViewStorageStateWithDependencies(
        {
          viewTabId: "tab-1",
          paneId: "pane-1",
          tileInstanceId: "browser-1",
          pageSessionId: "page-1",
          origin: "http://localhost:3000",
        },
        webContents,
        captureDependencies("http://localhost:3000", [
          {
            name: "sid",
            value: "cookie",
            domain: "localhost",
            hostOnly: true,
            path: "/",
            secure: false,
            httpOnly: true,
            session: true,
            sameSite: "lax",
          },
        ]),
      ),
    ).resolves.toEqual({
      storageState: {
        cookies: [
          {
            name: "sid",
            value: "cookie",
            domain: "localhost",
            canonicalDomain: "localhost",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [
          {
            origin: "http://localhost:3000",
            localStorage: [{ name: "token", value: "abc" }],
          },
        ],
      },
      cookieCount: 1,
      cookieDomains: ["localhost"],
      localStorageCount: 1,
      localStorageAvailable: true,
      localStorageReason: null,
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps capture read-only and returns cookies when the source tile is no longer at the origin", async () => {
    await expect(
      captureBrowserViewStorageStateWithDependencies(
        {
          viewTabId: "tab-1",
          paneId: "pane-1",
          tileInstanceId: "browser-1",
          pageSessionId: "page-1",
          origin: "https://example.test",
        },
        {
          getURL: () => "https://other.test",
          executeJavaScript: () => {
            throw new Error("localStorage script should not run");
          },
        },
        captureDependencies("https://example.test", []),
      ),
    ).resolves.toMatchObject({
      storageState: {
        cookies: [],
        origins: [],
      },
      cookieCount: 0,
      cookieDomains: [],
      localStorageCount: 0,
      localStorageAvailable: false,
    });
  });
});

function storageCookie(name: string): {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "Lax";
} {
  return {
    name,
    value: `${name}-value`,
    domain: "example.test",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };
}

function dependencies(
  cryptoState: BrowserCookieCryptoState,
  cookieSets: CookieSetDetails[],
  fromPartitionCalls: Array<{
    readonly partition: string;
    readonly options: { readonly cache: boolean };
  }>,
): BrowserStorageStateApplyDependencies {
  return {
    readCryptoState: () => cryptoState,
    fromPartition: (partition, options) => {
      fromPartitionCalls.push({ partition, options });
      return {
        cookies: {
          get: () => Promise.resolve([]),
          flushStore: () => Promise.resolve(),
          set: (details) => {
            cookieSets.push(details);
            return Promise.resolve();
          },
        },
      };
    },
  };
}

function dependenciesThatRejectCookie(
  cryptoState: BrowserCookieCryptoState,
  cookieSets: CookieSetDetails[],
  fromPartitionCalls: Array<{
    readonly partition: string;
    readonly options: { readonly cache: boolean };
  }>,
  rejectedCookieName: string,
): BrowserStorageStateApplyDependencies {
  return {
    readCryptoState: () => cryptoState,
    fromPartition: (partition, options) => {
      fromPartitionCalls.push({ partition, options });
      return {
        cookies: {
          get: () => Promise.resolve([]),
          flushStore: () => Promise.resolve(),
          set: (details) => {
            cookieSets.push(details);
            if (details.name === rejectedCookieName) {
              return Promise.reject(
                new Error(`set failed for ${rejectedCookieName}`),
              );
            }
            return Promise.resolve();
          },
        },
      };
    },
  };
}

function captureDependencies(
  expectedUrl: string,
  cookies: Cookie[],
): BrowserStorageStateCaptureDependencies {
  return {
    fromPartition: (partition, options) => {
      expect(partition).toBe(BROWSER_VIEW_PARTITION);
      expect(options).toEqual({ cache: true });
      return {
        cookies: {
          get: (filter) => {
            expect(filter).toEqual({ url: expectedUrl });
            return Promise.resolve(cookies);
          },
          flushStore: () => Promise.resolve(),
          set: () => Promise.resolve(),
        },
      };
    },
  };
}

describe("captureBrowserPrimaryProfileWithDependencies", () => {
  it("uses cookies.get({}) and attaches plain origin localStorage snapshots", async () => {
    const cookieGetFilters: Array<{ readonly url?: string }> = [];
    const origins = [
      {
        origin: "https://a.example",
        localStorage: [{ name: "a", value: "1" }],
      },
      {
        origin: "https://b.example",
        localStorage: [],
      },
    ];

    const result = await captureBrowserPrimaryProfileWithDependencies(
      origins,
      primaryCaptureDependencies(realState, cookieGetFilters, [
        {
          name: "sid",
          value: "cookie",
          domain: "example.com",
          hostOnly: true,
          path: "/",
          secure: true,
          httpOnly: true,
          session: true,
          sameSite: "lax",
        },
      ]),
    );

    expect(cookieGetFilters).toEqual([{}]);
    expect(result).toEqual({
      status: "captured",
      storageState: {
        cookies: [
          {
            name: "sid",
            value: "cookie",
            domain: "example.com",
            canonicalDomain: "example.com",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ],
        origins,
      },
      reason: null,
    });
  });

  it("short-circuits unavailable on degraded crypto without reading the partition", async () => {
    const fromPartition = vi.fn();
    const result = await captureBrowserPrimaryProfileWithDependencies(
      [
        {
          origin: "https://a.example",
          localStorage: [{ name: "a", value: "1" }],
        },
      ],
      {
        readCryptoState: () => degradedState,
        fromPartition,
      },
    );

    expect(result).toEqual({
      status: "unavailable",
      storageState: null,
      reason: "mock-keychain",
    });
    expect(fromPartition).not.toHaveBeenCalled();
  });
});

function primaryCaptureDependencies(
  cryptoState: BrowserCookieCryptoState,
  cookieGetFilters: Array<{ readonly url?: string }>,
  cookies: Cookie[],
): BrowserPrimaryProfileCaptureDependencies {
  return {
    readCryptoState: () => cryptoState,
    fromPartition: (partition, options) => {
      expect(partition).toBe(BROWSER_VIEW_PARTITION);
      expect(options).toEqual({ cache: true });
      return {
        cookies: {
          get: (filter) => {
            cookieGetFilters.push(filter);
            return Promise.resolve(cookies);
          },
          flushStore: () => Promise.resolve(),
          set: () => Promise.resolve(),
        },
      };
    },
  };
}
