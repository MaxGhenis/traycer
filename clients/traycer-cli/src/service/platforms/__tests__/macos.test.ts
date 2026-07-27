import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMacosController, type ProcessRunner } from "../macos";
import { ProcessRunError, type RunResult } from "../../process-runner";
import { serviceLabelFor } from "../../label";
import { CLI_ERROR_CODES } from "../../../runner/errors";

// Test isolation: `serviceManifestPath` normally resolves to the REAL
// `~/Library/LaunchAgents/<label>.plist` (via `os.homedir()`, which ignores
// `$HOME`), so running this suite would write - and `afterEach`-remove - the
// developer's actual host LaunchAgent, deregistering a running host.
// Redirect the manifest path to a temp dir so the suite never touches real
// macOS service registration.
const TEST_LAUNCH_AGENTS_DIR = join(tmpdir(), "traycer-macos-service-test");
vi.mock("../../label", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../label")>();
  return {
    ...actual,
    serviceManifestPath: (label: { readonly id: string }) =>
      join(TEST_LAUNCH_AGENTS_DIR, `${label.id}.plist`),
  };
});

// Ticket a849b064: macOS CLI service install must distinguish benign
// idempotent launchctl states (service already loaded) from real
// failures (permission denied, malformed plist, missing program, ...).
// Real failures should surface as `SERVICE_INSTALL_FAILED` /
// `SERVICE_CONTROL_FAILED` so Doctor + first-launch can rely on the
// signal. Tests below stub `launchctl` to exercise each path.

interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
}

function buildSuccessResult(): RunResult {
  return { stdout: "", stderr: "", exitCode: 0 };
}

function buildLaunchctlError(args: {
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number;
  readonly command: string;
  readonly cmdArgs: readonly string[];
}): ProcessRunError {
  return new ProcessRunError(
    `${args.command} ${args.cmdArgs.join(" ")} exited with code ${args.exitCode}: ${args.stderr.trim() || args.stdout.trim()}`,
    args.command,
    args.cmdArgs,
    args.exitCode,
    args.stdout,
    args.stderr,
  );
}

describe("macOS service install failure handling (ticket a849b064)", () => {
  const label = serviceLabelFor("production");
  const tempPlistDir = TEST_LAUNCH_AGENTS_DIR;
  let createdPlistPath: string | null = null;

  beforeEach(() => {
    createdPlistPath = null;
  });

  afterEach(async () => {
    // installService writes a plist to ~/Library/LaunchAgents/<label>.plist
    // - clean it up so a failed run doesn't leak between tests. We only
    // touch the specific test label to avoid clobbering a real install
    // on the developer's machine.
    if (createdPlistPath !== null) {
      await rm(createdPlistPath, { force: true });
    }
  });

  it("on an existing registration runs print → bootout → bootstrap → kickstart and returns cleanly", async () => {
    const calls: RecordedCall[] = [];
    const runner: ProcessRunner = async (command, args) => {
      calls.push({ command, args });
      return buildSuccessResult();
    };
    const controller = createMacosController(runner);
    createdPlistPath = join(tempPlistDir, `${label.id}.plist`);
    await controller.install({
      label,
      cli: { command: "/usr/local/bin/traycer", args: [] },
      enableLinger: false,
    });
    // `print` probes whether the service is already loaded; when it is
    // (mock returns exit=0), the install path tears down the existing
    // registration via bootout before bootstrapping the freshly-written
    // plist - that's what makes Re-register survive the "already
    // loaded" / EIO case launchctl bootstrap would otherwise hit.
    expect(calls.map((c) => c.args[0])).toEqual([
      "print",
      "bootout",
      "bootstrap",
      "kickstart",
    ]);
    // The register step must NOT force-kill a healthy host: `-k` would
    // make launchd block the respawn for the plist's ThrottleInterval.
    const kickstart = calls.find((c) => c.args[0] === "kickstart");
    expect(kickstart?.args).not.toContain("-k");
    const plistContents = await readFile(createdPlistPath, "utf8");
    expect(plistContents).toContain(label.id);
    // No --environment - the host resolves its slot from config.environment.
    expect(plistContents).not.toContain("--environment");
  });

  it("writes the plist and registers regardless of TRAYCER_HOST_SKIP_SERVICE_REGISTER (env hack removed)", async () => {
    const previous = process.env.TRAYCER_HOST_SKIP_SERVICE_REGISTER;
    process.env.TRAYCER_HOST_SKIP_SERVICE_REGISTER = "1";
    try {
      const calls: RecordedCall[] = [];
      const runner: ProcessRunner = async (command, args) => {
        calls.push({ command, args });
        return buildSuccessResult();
      };
      const controller = createMacosController(runner);
      createdPlistPath = join(tempPlistDir, `${label.id}.plist`);
      await controller.install({
        label,
        cli: { command: "/usr/local/bin/traycer", args: [] },
        enableLinger: false,
      });
      // The CLI is the sole owner now - the legacy host-delegation env
      // var must no longer short-circuit registration.
      expect(calls.map((c) => c.args[0])).toEqual([
        "print",
        "bootout",
        "bootstrap",
        "kickstart",
      ]);
      const plistContents = await readFile(createdPlistPath, "utf8");
      expect(plistContents).toContain(label.id);
    } finally {
      if (previous === undefined) {
        delete process.env.TRAYCER_HOST_SKIP_SERVICE_REGISTER;
      } else {
        process.env.TRAYCER_HOST_SKIP_SERVICE_REGISTER = previous;
      }
    }
  });

  it("on a fresh machine (print fails with exit≠0) skips bootout entirely so a failed bootstrap can't leave the user worse off than before", async () => {
    const calls: RecordedCall[] = [];
    const runner: ProcessRunner = async (command, args, options) => {
      calls.push({ command, args });
      if (args[0] === "print") {
        // `launchctl print` returns non-zero when the service isn't
        // loaded. isServiceLoaded honours `tolerateNonZeroExit:true` by
        // resolving with a non-zero `RunResult` rather than throwing,
        // so the install path observes "not loaded" and skips bootout.
        if (options.tolerateNonZeroExit) {
          return {
            stdout: "",
            stderr: "Could not find specified service\n",
            exitCode: 113,
          };
        }
        throw buildLaunchctlError({
          command,
          cmdArgs: args,
          stderr: "Could not find specified service\n",
          stdout: "",
          exitCode: 113,
        });
      }
      return buildSuccessResult();
    };
    const controller = createMacosController(runner);
    createdPlistPath = join(tempPlistDir, `${label.id}.plist`);
    await expect(
      controller.install({
        label,
        cli: { command: "/usr/local/bin/traycer", args: [] },
        enableLinger: false,
      }),
    ).resolves.toBeUndefined();
    expect(calls.map((c) => c.args[0])).toEqual([
      "print",
      "bootstrap",
      "kickstart",
    ]);
  });

  it("surfaces a real launchctl bootout failure (permission denied) as SERVICE_INSTALL_FAILED instead of silently swallowing it", async () => {
    const calls: RecordedCall[] = [];
    const runner: ProcessRunner = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "bootout") {
        throw buildLaunchctlError({
          command,
          cmdArgs: args,
          stderr: "Bootout failed: 5: Operation not permitted\n",
          stdout: "",
          exitCode: 5,
        });
      }
      return buildSuccessResult();
    };
    const controller = createMacosController(runner);
    createdPlistPath = join(tempPlistDir, `${label.id}.plist`);
    await expect(
      controller.install({
        label,
        cli: { command: "/usr/local/bin/traycer", args: [] },
        enableLinger: false,
      }),
    ).rejects.toMatchObject({
      code: CLI_ERROR_CODES.SERVICE_INSTALL_FAILED,
      message: expect.stringContaining("bootout"),
    });
    // Print probe + bootout attempted; bootstrap/kickstart never run.
    expect(calls.map((c) => c.args[0])).toEqual(["print", "bootout"]);
  });

  it("still tolerates 'service already loaded' on bootstrap (defence-in-depth for races against bootout)", async () => {
    const calls: RecordedCall[] = [];
    const runner: ProcessRunner = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "bootstrap") {
        // Another process re-bootstrapped between our bootout and our
        // bootstrap - fall through to kickstart against whatever's now
        // loaded.
        throw buildLaunchctlError({
          command,
          cmdArgs: args,
          stderr: "Bootstrap failed: 37: Service is already loaded\n",
          stdout: "",
          exitCode: 37,
        });
      }
      return buildSuccessResult();
    };
    const controller = createMacosController(runner);
    createdPlistPath = join(tempPlistDir, `${label.id}.plist`);
    await expect(
      controller.install({
        label,
        cli: { command: "/usr/local/bin/traycer", args: [] },
        enableLinger: false,
      }),
    ).resolves.toBeUndefined();
    expect(calls.map((c) => c.args[0])).toEqual([
      "print",
      "bootout",
      "bootstrap",
      "kickstart",
    ]);
  });

  it("surfaces a real launchctl bootstrap failure (permission denied) as SERVICE_INSTALL_FAILED", async () => {
    const calls: RecordedCall[] = [];
    const runner: ProcessRunner = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "bootstrap") {
        throw buildLaunchctlError({
          command,
          cmdArgs: args,
          stderr: "Bootstrap failed: 5: Operation not permitted\n",
          stdout: "",
          exitCode: 5,
        });
      }
      return buildSuccessResult();
    };
    const controller = createMacosController(runner);
    createdPlistPath = join(tempPlistDir, `${label.id}.plist`);
    await expect(
      controller.install({
        label,
        cli: { command: "/usr/local/bin/traycer", args: [] },
        enableLinger: false,
      }),
    ).rejects.toMatchObject({
      code: CLI_ERROR_CODES.SERVICE_INSTALL_FAILED,
    });
    // We never reach kickstart when bootstrap fails for real, but the
    // print probe + bootout reload step still ran.
    expect(calls.map((c) => c.args[0])).toEqual([
      "print",
      "bootout",
      "bootstrap",
    ]);
  });

  it("surfaces a launchctl kickstart failure as SERVICE_CONTROL_FAILED", async () => {
    const calls: RecordedCall[] = [];
    const runner: ProcessRunner = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "kickstart") {
        throw buildLaunchctlError({
          command,
          cmdArgs: args,
          stderr: "Could not kickstart service: 3\n",
          stdout: "",
          exitCode: 3,
        });
      }
      return buildSuccessResult();
    };
    const controller = createMacosController(runner);
    createdPlistPath = join(tempPlistDir, `${label.id}.plist`);
    await expect(
      controller.install({
        label,
        cli: { command: "/usr/local/bin/traycer", args: [] },
        enableLinger: false,
      }),
    ).rejects.toMatchObject({
      code: CLI_ERROR_CODES.SERVICE_CONTROL_FAILED,
    });
    expect(calls.map((c) => c.args[0])).toEqual([
      "print",
      "bootout",
      "bootstrap",
      "kickstart",
    ]);
  });
});

// An orphaned manifest - a plist on disk with no matching launchd job - is
// easy to reach: a `bootstrap` that failed after the plist was written, an
// external `bootout`, or a login session that never loaded the agent.
//
// It used to be a PERMANENT wedge. `kickstart` only starts a job launchd
// already knows about; it never registers one, and fails with
// `Could not find service "<label>" in domain for user gui: <uid>`. Because
// `status` inferred installed-ness from the plist's mere existence, it
// reported the orphan as `stopped` ("registered, just not running"), so
// every caller - install-lifecycle's start/restart branch, auto-bootstrap
// and provision (`serviceRegistered = state !== "not-installed"`), Doctor -
// reached for `kickstart` and hit the same error forever. Nothing short of
// deleting the plist by hand recovered it.
//
// launchd is now the source of truth for registration, and start/restart
// reconcile the registration before kickstarting.
describe("macOS orphaned LaunchAgent manifest (plist on disk, no launchd registration)", () => {
  const label = serviceLabelFor("production");
  const manifestPath = join(TEST_LAUNCH_AGENTS_DIR, `${label.id}.plist`);

  afterEach(async () => {
    await rm(manifestPath, { force: true });
  });

  async function writeOrphanedManifest(): Promise<void> {
    await mkdir(TEST_LAUNCH_AGENTS_DIR, { recursive: true });
    await writeFile(manifestPath, "<plist/>", "utf8");
  }

  // `launchctl print` exiting non-zero is how launchd says "I have no such
  // job" - the exact 113 the wedged host reported in the field.
  function buildUnregisteredRunner(calls: RecordedCall[]): ProcessRunner {
    return async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "print") {
        return {
          stdout: "",
          stderr: `Could not find service "${label.id}" in domain for user gui: 501`,
          exitCode: 113,
        };
      }
      return buildSuccessResult();
    };
  }

  it("reports not-installed, so callers re-register instead of kickstarting a job launchd has never heard of", async () => {
    await writeOrphanedManifest();
    const calls: RecordedCall[] = [];
    const controller = createMacosController(buildUnregisteredRunner(calls));
    const status = await controller.status(label);
    // The plist exists; the registration does not. Only a re-`bootstrap`
    // recovers that, and `not-installed` is what routes install-lifecycle /
    // auto-bootstrap / provision / Doctor there. Reporting `stopped` here is
    // what made the host permanently unstartable.
    expect(status.state).toBe("not-installed");
    expect(calls.map((c) => c.args[0])).toContain("print");
  });

  it("start bootstraps the orphaned manifest before kickstart rather than failing with 'Could not find service'", async () => {
    await writeOrphanedManifest();
    const calls: RecordedCall[] = [];
    const controller = createMacosController(buildUnregisteredRunner(calls));
    await controller.start(label);
    expect(calls.map((c) => c.args[0])).toEqual([
      "print",
      "bootstrap",
      "kickstart",
    ]);
  });

  it("restart bootstraps the orphaned manifest before kickstart -k, so the desktop's Restart Host self-heals", async () => {
    await writeOrphanedManifest();
    const calls: RecordedCall[] = [];
    const controller = createMacosController(buildUnregisteredRunner(calls));
    await controller.restart(label);
    expect(calls.map((c) => c.args[0])).toEqual([
      "print",
      "bootstrap",
      "kickstart",
    ]);
    expect(calls.find((c) => c.args[0] === "kickstart")?.args).toContain("-k");
  });

  it("does not re-bootstrap when launchd already holds the registration", async () => {
    await writeOrphanedManifest();
    const calls: RecordedCall[] = [];
    // print exits 0 => the job is loaded; the reconcile must be a no-op.
    const controller = createMacosController(async (command, args) => {
      calls.push({ command, args });
      return buildSuccessResult();
    });
    await controller.start(label);
    expect(calls.map((c) => c.args[0])).toEqual(["print", "kickstart"]);
  });

  it("start with neither a registration nor a manifest fails with an actionable error instead of a raw launchctl exit", async () => {
    const calls: RecordedCall[] = [];
    const controller = createMacosController(buildUnregisteredRunner(calls));
    await expect(controller.start(label)).rejects.toMatchObject({
      code: CLI_ERROR_CODES.SERVICE_CONTROL_FAILED,
    });
    // There is nothing to kickstart, so we must not have tried.
    expect(calls.map((c) => c.args[0])).not.toContain("kickstart");
  });
});
