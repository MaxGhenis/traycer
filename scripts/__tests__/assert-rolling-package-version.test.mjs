import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRollingVersionAdvances,
  compareStableVersions,
  parseArgs,
} from "../native-packaging/assert-rolling-package-version.cjs";

// `assert-rolling-package-version.cjs` is the shared guard both
// publish-cli-package-managers.yml jobs (npm + Homebrew) shell out to
// immediately before mutating their respective rolling "latest" selector.
const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "native-packaging",
  "assert-rolling-package-version.cjs",
);

function runCli(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  });
}

// execFileSync throws on a non-zero exit; the thrown error carries
// .status/.stdout/.stderr, which is exactly the contract the workflow's
// `set -euo pipefail` steps rely on to stop the job.
function runCliExpectFailure(args) {
  try {
    const stdout = runCli(args);
    throw new Error(
      `expected the CLI to exit non-zero, got status 0 with stdout: ${stdout}`,
    );
  } catch (error) {
    if (error.status === undefined) throw error;
    return error;
  }
}

describe("compareStableVersions: strict stable SemVer only, numeric ordering", () => {
  it("orders numerically, not lexically (double digits, ties)", () => {
    expect(compareStableVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareStableVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareStableVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareStableVersions("1.2.10", "1.2.9")).toBe(1);
  });

  it("compares major/minor/patch in that precedence order", () => {
    expect(compareStableVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareStableVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareStableVersions("1.2.4", "1.2.3")).toBe(1);
  });

  it("rejects every non-strict-stable form on either side", () => {
    for (const bad of [
      "1.2.3-rc.1",
      "1.2.3+build.5",
      "1.2",
      "1.2.3.4",
      "v1.2.3",
      "1.2.x",
      "01.2.3",
      "1.02.3",
      "",
      "1.2.3 ",
      " 1.2.3",
    ]) {
      expect(
        () => compareStableVersions(bad, "1.0.0"),
        `expected ${JSON.stringify(bad)} to be rejected as candidate`,
      ).toThrow(/must be strict stable SemVer/u);
      expect(
        () => compareStableVersions("1.0.0", bad),
        `expected ${JSON.stringify(bad)} to be rejected as published`,
      ).toThrow(/must be strict stable SemVer/u);
    }
  });

  it("labels which side is malformed (candidate vs published) in the error", () => {
    expect(() => compareStableVersions("bad", "1.0.0")).toThrow(
      /candidate version must be strict stable SemVer/u,
    );
    expect(() => compareStableVersions("1.0.0", "bad")).toThrow(
      /published version must be strict stable SemVer/u,
    );
  });
});

describe("assertRollingVersionAdvances: refuses equal/older, accepts strictly-newer", () => {
  it("accepts a candidate strictly newer than every existing observation", () => {
    expect(() =>
      assertRollingVersionAdvances({
        candidate: "1.3.0",
        existing: [
          { label: "npm latest", version: "1.2.0" },
          { label: "Homebrew main", version: "1.1.0" },
        ],
      }),
    ).not.toThrow();
  });

  it("refuses when the candidate equals an existing observation", () => {
    expect(() =>
      assertRollingVersionAdvances({
        candidate: "1.2.0",
        existing: [{ label: "npm latest", version: "1.2.0" }],
      }),
    ).toThrow(/1\.2\.0 cannot replace npm latest at 1\.2\.0/u);
  });

  it("refuses when the candidate is older than an existing observation", () => {
    expect(() =>
      assertRollingVersionAdvances({
        candidate: "1.1.0",
        existing: [{ label: "npm latest", version: "1.2.0" }],
      }),
    ).toThrow(/1\.1\.0 cannot replace npm latest at 1\.2\.0/u);
  });

  it("refuses if ANY one of several observations is not strictly behind, even when the rest are", () => {
    expect(() =>
      assertRollingVersionAdvances({
        candidate: "1.3.0",
        existing: [
          { label: "npm latest", version: "1.2.0" },
          {
            label: "open Homebrew PR traycer-formula-1.3.0",
            version: "1.3.0",
          },
        ],
      }),
    ).toThrow(
      /1\.3\.0 cannot replace open Homebrew PR traycer-formula-1\.3\.0 at 1\.3\.0/u,
    );
  });

  it("explains why in the error: a delayed older publisher could regress users below an active compatibility floor", () => {
    expect(() =>
      assertRollingVersionAdvances({
        candidate: "1.0.0",
        existing: [{ label: "npm latest", version: "1.1.0" }],
      }),
    ).toThrow(/compatibility floor/u);
  });
});

describe("parseArgs: the workflow-facing CLI surface", () => {
  it("parses a candidate plus one or more --existing=<label>=<version> observations", () => {
    expect(
      parseArgs([
        "--candidate=1.3.0",
        "--existing=npm latest=1.2.0",
        "--existing=Homebrew main=1.1.0",
      ]),
    ).toEqual({
      candidate: "1.3.0",
      existing: [
        { label: "npm latest", version: "1.2.0" },
        { label: "Homebrew main", version: "1.1.0" },
      ],
    });
  });

  it("--existing splits on the FIRST '=' only, so a label may itself contain '='-free branch names", () => {
    expect(
      parseArgs([
        "--candidate=1.3.0",
        "--existing=open Homebrew PR traycer-formula-1.2.0=1.2.0",
      ]),
    ).toEqual({
      candidate: "1.3.0",
      existing: [
        {
          label: "open Homebrew PR traycer-formula-1.2.0",
          version: "1.2.0",
        },
      ],
    });
  });

  it("requires --candidate", () => {
    expect(() => parseArgs(["--existing=npm latest=1.2.0"])).toThrow(
      /--candidate=<stable-version> is required/u,
    );
  });

  it("requires at least one --existing observation (publishing blind would permit a regression)", () => {
    expect(() => parseArgs(["--candidate=1.3.0"])).toThrow(
      /at least one --existing=<label>=<version> is required/u,
    );
  });

  it("rejects a malformed candidate at parse time, before any --existing is consulted", () => {
    expect(() =>
      parseArgs(["--candidate=not-a-version", "--existing=npm latest=1.2.0"]),
    ).toThrow(/candidate version must be strict stable SemVer/u);
  });

  it("rejects a malformed --existing pair with no '=' between label and version", () => {
    expect(() =>
      parseArgs(["--candidate=1.3.0", "--existing=npm-latest-1.2.0"]),
    ).toThrow(/--existing must be --existing=<label>=<version>/u);
  });

  it("rejects a malformed --existing pair with an empty label or an empty version", () => {
    expect(() =>
      parseArgs(["--candidate=1.3.0", "--existing==1.2.0"]),
    ).toThrow(/--existing must be --existing=<label>=<version>/u);
    expect(() =>
      parseArgs(["--candidate=1.3.0", "--existing=npm latest="]),
    ).toThrow(/--existing must be --existing=<label>=<version>/u);
  });

  it("rejects any unrecognized argument", () => {
    expect(() => parseArgs(["--bogus=1"])).toThrow(
      /unrecognized argument "--bogus=1"/u,
    );
  });
});

describe("CLI entrypoint: exit-code contract the `set -euo pipefail` workflow steps rely on", () => {
  it("exits 0 and prints a confirming line naming every observation advanced", () => {
    const stdout = runCli([
      "--candidate=1.3.0",
      "--existing=npm latest=1.2.0",
      "--existing=Homebrew main=1.1.0",
    ]);
    expect(stdout).toContain(
      "Rolling package version guard: 1.3.0 advances npm latest (1.2.0), Homebrew main (1.1.0).",
    );
  });

  it("exits non-zero with a FAILED message on stderr when the candidate does not advance", () => {
    const error = runCliExpectFailure([
      "--candidate=1.2.0",
      "--existing=npm latest=1.2.0",
    ]);
    expect(error.status).not.toBe(0);
    expect(error.stderr.toString()).toContain(
      "Rolling package version guard FAILED",
    );
    expect(error.stderr.toString()).toContain("cannot replace npm latest");
  });

  it("exits non-zero when --existing is missing entirely", () => {
    const error = runCliExpectFailure(["--candidate=1.3.0"]);
    expect(error.status).not.toBe(0);
    expect(error.stderr.toString()).toContain(
      "at least one --existing=<label>=<version> is required",
    );
  });

  it("exits non-zero on a malformed observation, e.g. an unreadable Homebrew formula version reaching --existing", () => {
    const error = runCliExpectFailure([
      "--candidate=1.3.0",
      "--existing=Homebrew main=not-a-version",
    ]);
    expect(error.status).not.toBe(0);
    expect(error.stderr.toString()).toContain(
      "must be strict stable SemVer",
    );
  });
});
