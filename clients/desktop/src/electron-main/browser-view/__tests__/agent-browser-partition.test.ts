/**
 * Load-bearing isolation tests for the agent browser partition (ticket 02).
 *
 * Cookie isolation is exercised under a real Electron process via
 * `session.fromPartition` + `cookies.set/get` - not a mocked electron module.
 * Partition constants / webPreferences wiring use the project's usual
 * mocked-electron unit style so they stay fast and runnable under vitest/node.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserPermissionCheckHandler,
  BrowserPermissionRequestHandler,
  BrowserViewPolicySession,
  BrowserDownloadListener,
  BrowserDisplayMediaRequestHandler,
} from "../browser-session";

const electronState = vi.hoisted(() => {
  const state = {
    sessionsByPartition: new Map<string, FakePolicySession>(),
    fromPartitionCalls: [] as Array<{
      readonly partition: string;
      readonly options: { readonly cache: boolean };
    }>,
  };
  return state;
});

vi.mock("electron", () => ({
  app: {
    commandLine: {
      hasSwitch: () => false,
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "unknown",
  },
  dialog: {
    showSaveDialogSync: () => undefined,
    showMessageBoxSync: () => 0,
  },
  session: {
    fromPartition: (
      partition: string,
      options: { readonly cache: boolean },
    ): FakePolicySession => {
      electronState.fromPartitionCalls.push({ partition, options });
      const existing = electronState.sessionsByPartition.get(partition);
      if (existing !== undefined) return existing;
      const created = new FakePolicySession();
      electronState.sessionsByPartition.set(partition, created);
      return created;
    },
  },
}));

vi.mock("../../app/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  describeLogError: (err: unknown) => String(err),
}));

class FakePolicySession implements BrowserViewPolicySession {
  permissionRequestHandler: BrowserPermissionRequestHandler | null = null;
  permissionCheckHandler: BrowserPermissionCheckHandler | null = null;
  devicePermissionHandler: ((details: unknown) => boolean) | null = null;
  usbProtectedClassesHandler: ((details: unknown) => unknown[]) | null = null;
  bluetoothPairingHandler:
    | ((
        details: unknown,
        callback: (response: { readonly confirmed: boolean }) => void,
      ) => void)
    | null = null;
  displayMediaRequestHandler: BrowserDisplayMediaRequestHandler | null = null;
  readonly downloadListeners: BrowserDownloadListener[] = [];

  setPermissionRequestHandler(
    handler: BrowserPermissionRequestHandler | null,
  ): void {
    this.permissionRequestHandler = handler;
  }

  setPermissionCheckHandler(
    handler: BrowserPermissionCheckHandler | null,
  ): void {
    this.permissionCheckHandler = handler;
  }

  setDevicePermissionHandler(
    handler: ((details: unknown) => boolean) | null,
  ): void {
    this.devicePermissionHandler = handler;
  }

  setUSBProtectedClassesHandler(
    handler: ((details: unknown) => unknown[]) | null,
  ): void {
    this.usbProtectedClassesHandler = handler;
  }

  setBluetoothPairingHandler(
    handler:
      | ((
          details: unknown,
          callback: (response: { readonly confirmed: boolean }) => void,
        ) => void)
      | null,
  ): void {
    this.bluetoothPairingHandler = handler;
  }

  setDisplayMediaRequestHandler(
    handler: BrowserDisplayMediaRequestHandler | null,
  ): void {
    this.displayMediaRequestHandler = handler;
  }

  on(event: "will-download", listener: BrowserDownloadListener): void {
    expect(event).toBe("will-download");
    this.downloadListeners.push(listener);
  }
}

function realCookieCryptoState() {
  return {
    mode: "real" as const,
    persistence: "persistent" as const,
    reason: "os-backed" as const,
    storageBackend: null,
    encryptionAvailable: true,
    mockKeychainEnabled: false,
  };
}

function degradedCookieCryptoState() {
  return {
    mode: "degraded" as const,
    persistence: "ephemeral" as const,
    reason: "mock-keychain" as const,
    storageBackend: null,
    encryptionAvailable: false,
    mockKeychainEnabled: true,
  };
}

function resolveElectronBinary(): string {
  const require = createRequire(import.meta.url);
  const electronPath = require("electron") as string;
  if (typeof electronPath !== "string" || electronPath.length === 0) {
    throw new Error(
      "Could not resolve Electron binary path via require('electron')",
    );
  }
  return electronPath;
}

describe("agent browser partition identity", () => {
  beforeEach(() => {
    electronState.sessionsByPartition = new Map();
    electronState.fromPartitionCalls = [];
    vi.clearAllMocks();
  });

  it("is not the user partition and is never persist-prefixed", async () => {
    const mod = await import("../browser-session");

    expect(mod.AGENT_BROWSER_VIEW_PARTITION).toBe("traycer-agent-browser");
    expect(mod.AGENT_BROWSER_VIEW_PARTITION).not.toBe(
      mod.BROWSER_VIEW_PARTITION,
    );
    expect(mod.AGENT_BROWSER_VIEW_PARTITION.startsWith("persist:")).toBe(false);
    expect(mod.BROWSER_VIEW_PARTITION).toBe("persist:traycer-browser");
  });

  it("creates agent webPreferences on the agent partition only", async () => {
    const crypto = await import("../browser-cookie-crypto");
    crypto.setBrowserCookieCryptoStateForTests(realCookieCryptoState());
    const mod = await import("../browser-session");

    const preferences = mod.createAgentBrowserViewWebPreferences();

    expect(preferences).toEqual({
      partition: mod.AGENT_BROWSER_VIEW_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(preferences.partition).not.toBe(mod.BROWSER_VIEW_PARTITION);
    expect(preferences.partition).not.toBe(
      mod.BROWSER_VIEW_EPHEMERAL_PARTITION,
    );
    expect(preferences).not.toHaveProperty("preload");
    expect(preferences).not.toHaveProperty("webSecurity", false);
  });

  it("always uses the agent partition even when user cookie-crypto is degraded", async () => {
    const crypto = await import("../browser-cookie-crypto");
    crypto.setBrowserCookieCryptoStateForTests(degradedCookieCryptoState());
    const mod = await import("../browser-session");

    const preferences = mod.createAgentBrowserViewWebPreferences();
    mod.ensureAgentBrowserViewSession();

    expect(preferences.partition).toBe(mod.AGENT_BROWSER_VIEW_PARTITION);
    expect(electronState.fromPartitionCalls).toEqual([
      {
        partition: mod.AGENT_BROWSER_VIEW_PARTITION,
        options: { cache: true },
      },
    ]);
  });

  it("installs session policy on the agent partition session", async () => {
    const mod = await import("../browser-session");
    mod.ensureAgentBrowserViewSession();

    const agentSession = electronState.sessionsByPartition.get(
      mod.AGENT_BROWSER_VIEW_PARTITION,
    );
    if (agentSession === undefined) {
      throw new Error("agent partition session was not created");
    }
    expect(agentSession.permissionRequestHandler).not.toBeNull();
    expect(agentSession.permissionCheckHandler).not.toBeNull();
    expect(agentSession.downloadListeners).toHaveLength(1);
  });
});

describe("agent vs user partition cookie isolation (real Electron session)", () => {
  it("does not share cookies between agent and user partitions", () => {
    const modPromise = import("../browser-session");
    // Synchronous import path for constants only - module already evaluated by
    // the suite above in normal runs; re-import is fine under vitest.
    void modPromise;

    const electronBinary = resolveElectronBinary();
    const workDir = mkdtempSync(
      path.join(tmpdir(), "traycer-agent-partition-"),
    );
    const scriptPath = path.join(workDir, "cookie-isolation-probe.cjs");

    // Keep the probe self-contained so it does not depend on compiled main.
    writeFileSync(
      scriptPath,
      String.raw`const { app, session } = require("electron");

const AGENT = "traycer-agent-browser";
const USER = "persist:traycer-browser";

app.whenReady().then(async () => {
  try {
    const agent = session.fromPartition(AGENT);
    const user = session.fromPartition(USER);

    await agent.cookies.set({
      url: "https://example.com",
      name: "agent_cookie",
      value: "agent-secret",
      path: "/",
    });
    await user.cookies.set({
      url: "https://example.com",
      name: "user_cookie",
      value: "user-secret",
      path: "/",
    });

    const agentSeesUser = await agent.cookies.get({
      url: "https://example.com",
      name: "user_cookie",
    });
    const userSeesAgent = await user.cookies.get({
      url: "https://example.com",
      name: "agent_cookie",
    });
    const agentSeesOwn = await agent.cookies.get({
      url: "https://example.com",
      name: "agent_cookie",
    });
    const userSeesOwn = await user.cookies.get({
      url: "https://example.com",
      name: "user_cookie",
    });

    const result = {
      ok:
        agentSeesOwn.length === 1 &&
        userSeesOwn.length === 1 &&
        agentSeesUser.length === 0 &&
        userSeesAgent.length === 0,
      agentSeesOwn: agentSeesOwn.map((c) => c.name + "=" + c.value),
      userSeesOwn: userSeesOwn.map((c) => c.name + "=" + c.value),
      agentSeesUser: agentSeesUser.map((c) => c.name),
      userSeesAgent: userSeesAgent.map((c) => c.name),
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    app.exit(result.ok ? 0 : 1);
  } catch (err) {
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    app.exit(2);
  }
});
`,
      "utf8",
    );

    try {
      const result = spawnSync(electronBinary, [scriptPath], {
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          // Ensure we run as Electron, not as plain Node.
          ELECTRON_RUN_AS_NODE: "",
        },
      });

      if (result.error !== undefined) {
        throw result.error;
      }

      const stdout = (result.stdout ?? "").trim();
      const stderr = (result.stderr ?? "").trim();
      if (result.status !== 0) {
        throw new Error(
          `Electron cookie isolation probe failed (status=${String(result.status)}).\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
      }

      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"));
      const lastLine = lines.at(-1);
      if (lastLine === undefined) {
        throw new Error(
          `Electron cookie isolation probe produced no JSON.\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
      }

      const payload = JSON.parse(lastLine) as {
        readonly ok: boolean;
        readonly agentSeesOwn: string[];
        readonly userSeesOwn: string[];
        readonly agentSeesUser: string[];
        readonly userSeesAgent: string[];
      };

      expect(payload.ok).toBe(true);
      expect(payload.agentSeesOwn).toEqual(["agent_cookie=agent-secret"]);
      expect(payload.userSeesOwn).toEqual(["user_cookie=user-secret"]);
      expect(payload.agentSeesUser).toEqual([]);
      expect(payload.userSeesAgent).toEqual([]);

      // Cross-check against the constants the production code exports so a
      // rename of either partition fails this suite loudly.
      return import("../browser-session").then((mod) => {
        expect(mod.AGENT_BROWSER_VIEW_PARTITION).toBe("traycer-agent-browser");
        expect(mod.BROWSER_VIEW_PARTITION).toBe("persist:traycer-browser");
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
