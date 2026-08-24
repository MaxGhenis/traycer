import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Parses publish-cli-package-managers.yml as raw text rather than through a
// YAML parser: the property under test is the literal shell wiring (step
// order, `if:` conditions, concurrency groups) that GitHub Actions executes,
// not an abstract YAML structure.
const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".github",
  "workflows",
  "publish-cli-package-managers.yml",
);

const workflowText = fs.readFileSync(WORKFLOW_PATH, "utf8");
const jobsText = workflowText.slice(workflowText.indexOf("\njobs:\n"));

function jobBlock(name) {
  const header = new RegExp(`\\n {2}${name}:\\n`, "u");
  const match = header.exec(jobsText);
  if (match === null) {
    throw new Error(`job "${name}" not found in ${WORKFLOW_PATH}`);
  }
  const start = match.index + match[0].length;
  const rest = jobsText.slice(start);
  const nextJob = /\n {2}[A-Za-z0-9_-]+:\n/u.exec(rest);
  return nextJob === null ? rest : rest.slice(0, nextJob.index + 1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stepIndex(source, stepName) {
  const header = new RegExp(`- name: ${escapeRegExp(stepName)}\\n`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`step "${stepName}" not found`);
  }
  return match.index;
}

function stepBlock(source, stepName) {
  const start = stepIndex(source, stepName);
  const rest = source.slice(start);
  const nextStep = /\n {6}- name: /u.exec(rest.slice(1));
  const end = nextStep === null ? rest.length : nextStep.index + 1;
  return rest.slice(0, end);
}

const npmJob = jobBlock("publish-npm");
const homebrewJob = jobBlock("publish-homebrew-formula");

describe("publish-npm: concurrency serializes every writer around the guard", () => {
  it("carries a job-level concurrency group with cancel-in-progress: false", () => {
    const concurrencyIndex = npmJob.indexOf("concurrency:");
    const envIndex = npmJob.indexOf("\n    env:\n");
    expect(concurrencyIndex).toBeGreaterThan(-1);
    // The concurrency block must precede the steps (and env), not be some
    // unrelated later mention of the word.
    expect(concurrencyIndex).toBeLessThan(envIndex);
    const concurrencyBlock = npmJob.slice(concurrencyIndex, envIndex);
    expect(concurrencyBlock).toContain("group: traycer-cli-npm-latest-publish");
    expect(concurrencyBlock).toContain("cancel-in-progress: false");
  });
});

describe("publish-npm: the rolling-version guard sits immediately before the mutation", () => {
  it("orders Skip existing -> Refuse regression -> Publish -> dry run, guard directly before publish", () => {
    const existingIdx = stepIndex(npmJob, "Skip existing npm version");
    const refuseIdx = stepIndex(npmJob, "Refuse an npm latest regression");
    const publishIdx = stepIndex(npmJob, "Publish npm package (with provenance)");
    const dryRunIdx = stepIndex(npmJob, "npm dry run");
    expect(existingIdx).toBeLessThan(refuseIdx);
    expect(refuseIdx).toBeLessThan(publishIdx);
    expect(publishIdx).toBeLessThan(dryRunIdx);
  });

  it("gates the guard step with the publish step's condition PLUS env.DIST_TAG == 'latest', while publish keeps the broader condition", () => {
    // The rolling guard only makes sense against npm's `latest` dist-tag: a
    // prerelease/backfill publish under a non-"latest" dist-tag never moves
    // the rolling selector, so it must not be blocked by (or compared
    // against) it. The "Publish npm package" step still runs for those
    // dist-tags, so it deliberately keeps the broader, un-narrowed condition.
    const guardStep = stepBlock(npmJob, "Refuse an npm latest regression");
    const publishStep = stepBlock(
      npmJob,
      "Publish npm package (with provenance)",
    );
    const sharedIf =
      "steps.gate.outputs.mode == 'publish' && steps.existing.outputs.exists != 'true'";
    expect(guardStep).toContain(`if: ${sharedIf} && env.DIST_TAG == 'latest'`);
    expect(publishStep).toContain(`if: ${sharedIf}`);
    expect(publishStep).not.toContain("env.DIST_TAG == 'latest'");
  });

  it("re-reads the live npm dist-tags.latest and feeds it as the sole --existing observation", () => {
    const guardStep = stepBlock(npmJob, "Refuse an npm latest regression");
    expect(guardStep).toMatch(
      /current="\$\(npm view "@traycerai\/cli" dist-tags\.latest --registry "https:\/\/registry\.npmjs\.org"\)"/u,
    );
    expect(guardStep).toContain(
      "node scripts/native-packaging/assert-rolling-package-version.cjs",
    );
    expect(guardStep).toContain('--candidate="$VERSION"');
    expect(guardStep).toContain('--existing="npm latest=$current"');
    // Guarded by `set -euo pipefail`, so a non-zero exit from the guard
    // script stops the job before "Publish npm package" runs.
    expect(guardStep).toContain("set -euo pipefail");
  });
});

describe("publish-homebrew-formula: the rolling-version guard reads origin/main + open rolling PRs", () => {
  it("reads the pre-existing rolling version from the git ref, not the working tree the release PR is about to overwrite", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    // `cp` overwrites Formula/traycer.rb with the CANDIDATE content before
    // this line runs; reading the "current" (pre-mutation) version must
    // therefore come from git history (origin/main), not the working tree,
    // or the guard would compare the candidate against itself.
    expect(prStep).toMatch(
      /current="\$\(git show origin\/main:Formula\/traycer\.rb \| sed -nE 's\/\^\[\[:space:\]\]\*version "\(\[\^"\]\+\)"\.\*\/\\1\/p'\)"/u,
    );
  });

  it("refuses when the rolling formula's current version is unreadable", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    expect(prStep).toMatch(/if \[ -z "\$current" \]; then/u);
    expect(prStep).toContain("has no readable version");
    expect(prStep).toContain("exit 1");
  });

  it("collects every OPEN rolling-formula PR (excluding its own branch) as additional --existing observations, from a single gh pr list query", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    // Exactly one `gh pr list` call within the guarded block feeds both
    // EXISTING_ARGS and STALE_PRS - there must be no second query re-deriving
    // the close list separately. (A THIRD, unrelated `gh pr list` call later
    // in this step finds this run's OWN branch's PR number for the
    // create-vs-update decision - that one is out of scope here.)
    const guardedBlock = /\n {10}if \[ "\$HOMEBREW_VERSIONED_ONLY" != "true" \]; then\n([\s\S]*?)\n {10}fi\n/u.exec(
      prStep,
    )[1];
    const listCalls = guardedBlock.match(/gh pr list --repo "\$TAP_REPO"/gu) ?? [];
    expect(listCalls).toHaveLength(1);
    expect(prStep).toContain('gh pr list --repo "$TAP_REPO" --state open --limit 100');
    expect(prStep).toContain(
      'select(.body | contains("Updates the rolling Formula/traycer.rb"))',
    );
    expect(prStep).toContain('select(.headRefName | startswith("traycer-formula-"))');
    // The single query emits number+branch pairs as TSV; the read loop
    // parses both, skips its own branch, and records the validated PR
    // number for later closure alongside the --existing observation.
    expect(prStep).toContain('[.number, .headRefName] | @tsv');
    expect(prStep).toMatch(/while IFS=\$'\\t' read -r open_number open_branch; do/u);
    expect(prStep).toMatch(/\[ "\$open_branch" = "\$branch" \] && continue/u);
    expect(prStep).toContain(
      '--existing="open Homebrew PR ${open_branch}=$open_version"',
    );
    expect(prStep).toMatch(/STALE_PRS\+=\("\$open_number"\)/u);
  });

  it("invokes the shared guard with the candidate and every gathered --existing observation", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    expect(prStep).toContain(
      "node ../scripts/native-packaging/assert-rolling-package-version.cjs",
    );
    expect(prStep).toContain('--candidate="$VERSION"');
    expect(prStep).toContain('"${EXISTING_ARGS[@]}"');
  });

  it("closes stale rolling-formula PRs only AFTER the guard proves this candidate outranks them, before commit/push", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    const guardIdx = prStep.indexOf(
      "node ../scripts/native-packaging/assert-rolling-package-version.cjs",
    );
    const closeIdx = prStep.indexOf('for stale_pr in "${STALE_PRS[@]}"; do');
    const commitIdx = prStep.indexOf('git commit -m "traycer ${VERSION}"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(closeIdx);
    expect(closeIdx).toBeLessThan(commitIdx);
  });

  it("closes exactly the PR numbers recorded in STALE_PRS during the earlier loop, with no second gh pr list query", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    expect(prStep).toMatch(
      /for stale_pr in "\$\{STALE_PRS\[@\]\}"; do\n\s+gh pr close "\$stale_pr" --repo "\$TAP_REPO"/u,
    );
    // Confirms (again, scoped to the guarded block) there is no independent
    // second query deriving the close list - STALE_PRS from the single
    // earlier read loop is the only source `gh pr close` iterates.
    const guardedBlock = /\n {10}if \[ "\$HOMEBREW_VERSIONED_ONLY" != "true" \]; then\n([\s\S]*?)\n {10}fi\n/u.exec(
      prStep,
    )[1];
    const listCalls = guardedBlock.match(/gh pr list --repo "\$TAP_REPO"/gu) ?? [];
    expect(listCalls).toHaveLength(1);
  });
});

describe("publish-homebrew-formula: homebrew_versioned_only bypasses both the rolling guard and stale-PR closure", () => {
  it("wraps the entire guard + stale-PR-closure block in `if [ \"$HOMEBREW_VERSIONED_ONLY\" != \"true\" ]`", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    // Outer if/fi at 10-space indent; the nested `if [ -z "$current" ]`
    // guard inside it sits at 12-space indent, so this anchor does not
    // false-match the inner block's `fi`.
    const outer =
      /\n {10}if \[ "\$HOMEBREW_VERSIONED_ONLY" != "true" \]; then\n([\s\S]*?)\n {10}fi\n/u.exec(
        prStep,
      );
    expect(outer).not.toBeNull();
    const body = outer[1];
    expect(body).toContain(
      "node ../scripts/native-packaging/assert-rolling-package-version.cjs",
    );
    expect(body).toContain('gh pr close "$stale_pr"');
  });

  it("commits and pushes unconditionally, outside the versioned-only-gated block", () => {
    const prStep = stepBlock(homebrewJob, "Open Homebrew formula PR");
    const outer =
      /\n {10}if \[ "\$HOMEBREW_VERSIONED_ONLY" != "true" \]; then\n[\s\S]*?\n {10}fi\n/u.exec(
        prStep,
      );
    expect(outer).not.toBeNull();
    const afterGuardBlock = prStep.slice(outer.index + outer[0].length);
    expect(afterGuardBlock).toMatch(/^\s*git commit -m "traycer \$\{VERSION\}"/u);
  });

  it("the render step also skips the rolling Formula/traycer.rb output when homebrew_versioned_only is set (backfill leaves it untouched)", () => {
    const renderStep = stepBlock(homebrewJob, "Render Homebrew formula");
    expect(renderStep).toContain("HOMEBREW_VERSIONED_ONLY");
    expect(renderStep).toMatch(/if \[ "\$HOMEBREW_VERSIONED_ONLY" = "true" \]; then/u);
    expect(renderStep).toContain("--homebrew-versioned-only");
  });
});
