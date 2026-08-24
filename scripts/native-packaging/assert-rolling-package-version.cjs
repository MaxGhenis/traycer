/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/**
 * Refuses a rolling package-manager mutation that would move a stable
 * "latest" pointer backwards.
 *
 * This deliberately handles stable x.y.z versions only. The workflow that
 * calls it runs on stable cli-v* releases; accepting prerelease syntax here
 * would broaden the selector beyond the npm `latest` tag and Homebrew's
 * rolling Formula/traycer.rb surface.
 */

const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

function parseStableVersion(value, label) {
  const match = STABLE_VERSION.exec(value);
  if (match === null) {
    throw new Error(
      `${label} must be strict stable SemVer (x.y.z), got ${JSON.stringify(value)}`,
    );
  }
  return match.slice(1).map((part) => BigInt(part));
}

function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left, "candidate version");
  const rightParts = parseStableVersion(right, "published version");
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function parseArgs(argv) {
  let candidate = null;
  const existing = [];
  for (const arg of argv) {
    if (arg.startsWith("--candidate=")) {
      candidate = arg.slice("--candidate=".length);
      continue;
    }
    if (arg.startsWith("--existing=")) {
      const pair = arg.slice("--existing=".length);
      const separator = pair.indexOf("=");
      if (separator <= 0 || separator === pair.length - 1) {
        throw new Error(
          `--existing must be --existing=<label>=<version>, got ${JSON.stringify(arg)}`,
        );
      }
      existing.push({
        label: pair.slice(0, separator),
        version: pair.slice(separator + 1),
      });
      continue;
    }
    throw new Error(`unrecognized argument ${JSON.stringify(arg)}`);
  }
  if (candidate === null || candidate.length === 0) {
    throw new Error("--candidate=<stable-version> is required");
  }
  parseStableVersion(candidate, "candidate version");
  if (existing.length === 0) {
    throw new Error(
      "at least one --existing=<label>=<version> is required; publishing without observing the current rolling selector would permit a regression",
    );
  }
  return { candidate, existing };
}

function assertRollingVersionAdvances(args) {
  const { candidate, existing } = args;
  for (const entry of existing) {
    if (compareStableVersions(candidate, entry.version) <= 0) {
      throw new Error(
        `${candidate} cannot replace ${entry.label} at ${entry.version}: a rolling package-manager selector must advance strictly, or a delayed older publisher could move users back to a client below an already-active compatibility floor`,
      );
    }
  }
}

module.exports = {
  assertRollingVersionAdvances,
  compareStableVersions,
  parseArgs,
};

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    assertRollingVersionAdvances(args);
    console.log(
      `Rolling package version guard: ${args.candidate} advances ${args.existing.map((entry) => `${entry.label} (${entry.version})`).join(", ")}.`,
    );
  } catch (error) {
    console.error(
      `Rolling package version guard FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
