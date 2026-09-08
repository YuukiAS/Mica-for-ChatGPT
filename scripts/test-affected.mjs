import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const baseArg = process.argv.find((arg) => arg.startsWith("--base="))?.slice("--base=".length);
const base = baseArg || "origin/main";

const changedFiles = getChangedFiles(base);
const plan = buildPlan(changedFiles);
const started = performance.now();
const results = [];

if (plan.skip) {
  console.log(JSON.stringify({
    passed: true,
    base,
    changedFiles,
    reason: plan.reason,
    commands: []
  }, null, 2));
  process.exit(0);
}

run("node", ["scripts/build.mjs"], "build");
for (const step of plan.steps) run(step.command, step.args, step.label);

console.log(JSON.stringify({
  passed: true,
  base,
  changedFiles,
  selectedReasons: plan.reasons,
  totalSeconds: secondsSince(started),
  commands: results
}, null, 2));

function getChangedFiles(preferredBase) {
  const fromPreferred = git(["diff", "--name-only", "--diff-filter=ACMRTUXB", `${preferredBase}...HEAD`]);
  const stagedAndWorktree = git(["diff", "--name-only", "--diff-filter=ACMRTUXB"]);
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  const merged = new Set([
    ...(fromPreferred.ok ? lines(fromPreferred.stdout) : []),
    ...lines(stagedAndWorktree.stdout),
    ...lines(staged.stdout),
    ...lines(untracked.stdout)
  ]);
  if (merged.size > 0) return [...merged].sort();

  const lastCommit = git(["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD~1...HEAD"]);
  return lastCommit.ok ? lines(lastCommit.stdout) : [];
}

function buildPlan(files) {
  if (files.length === 0) {
    return { skip: true, reason: "no_changed_files" };
  }

  const reasons = new Set();
  const steps = new Map();
  const add = (label, command, args, reason) => {
    steps.set(label, { label, command, args });
    reasons.add(reason);
  };
  const addStatic = (reason) => {
    add("fixture-smoke", "node", ["scripts/fixture-smoke.mjs"], reason);
    add("known-interruptions-smoke", "node", ["scripts/known-interruptions-fixture-smoke.mjs"], reason);
    add("overlay-smoke", "node", ["scripts/overlay-fixture-smoke.mjs"], reason);
    add("composer-contract", "node", ["scripts/validate-composer-contract.mjs"], reason);
    add("validate-build", "node", ["scripts/validate-build.mjs"], reason);
  };
  const addContract = (reason) => {
    add("composer-contract", "node", ["scripts/validate-composer-contract.mjs"], reason);
  };
  const addCase = (caseName, reason) => add(`e2e:${caseName}`, "node", ["scripts/run-e2e.mjs", `--case=${caseName}`], reason);

  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (/^(AGENTS\.md|README\.md|docs\/|\.github\/)/.test(normalized)) {
      reasons.add("docs_or_ci_only");
      continue;
    }
    if (/^extension\/popup\//.test(normalized)) {
      addStatic("popup_change");
      continue;
    }
    if (/^extension\/src\/copy\//.test(normalized)) {
      addStatic("copy_change");
      addCase("markdown-copy", "copy_change");
      addCase("typing-hotpath", "copy_change");
      continue;
    }
    if (/^extension\/src\/content\.ts$/.test(normalized)) {
      addStatic("content_cross_cutting");
      addCase("markdown-copy", "content_cross_cutting");
      addCase("final-send-check", "content_cross_cutting");
      addCase("typing-hotpath", "content_cross_cutting");
      addCase("guided-composer-diagnostics", "content_cross_cutting");
      addCase("overlay-placement-matrix", "content_cross_cutting");
      continue;
    }
    if (/^extension\/src\/reliability\/(connector-continuity|connector-lifecycle-signal)\.ts$/.test(normalized)) {
      addStatic("connector_lifecycle_change");
      addCase("typing-hotpath", "connector_lifecycle_change");
      addCase("connector-mention-lifecycle", "connector_lifecycle_change");
      continue;
    }
    if (/^extension\/src\/reliability\/(send-residual-recovery|stale-composer-recovery|composer-diagnostics)\.ts$/.test(normalized)) {
      addStatic("composer_recovery_change");
      addCase("typing-hotpath", "composer_recovery_change");
      addCase("connector-mention-lifecycle", "composer_recovery_change");
      addCase("guided-composer-diagnostics", "composer_recovery_change");
      continue;
    }
    if (/^extension\/src\/reliability\/known-interruptions\.ts$/.test(normalized)) {
      addStatic("known_interruption_change");
      continue;
    }
    if (/^tests\/fixtures\/(connector-mention-lifecycle|virtual-clock)\.js$/.test(normalized) || /^tests\/fixtures\/connector-mention-lifecycle\.html$/.test(normalized)) {
      addStatic("connector_fixture_change");
      addCase("connector-mention-lifecycle", "connector_fixture_change");
      continue;
    }
    if (/^tests\/fixtures\/overlay/.test(normalized)) {
      addStatic("overlay_fixture_change");
      addCase("overlay-placement-matrix", "overlay_fixture_change");
      continue;
    }
    if (/^tests\/fixtures\/composer-typing-hotpath\.html$/.test(normalized)) {
      addStatic("typing_fixture_change");
      addCase("typing-hotpath", "typing_fixture_change");
      continue;
    }
    if (/^tests\/fixtures\/markdown-copy\.html$/.test(normalized)) {
      addStatic("copy_fixture_change");
      addCase("markdown-copy", "copy_fixture_change");
      continue;
    }
    if (/^tests\/fixtures\/final-send-check\.html$/.test(normalized)) {
      addStatic("final_send_fixture_change");
      addCase("final-send-check", "final_send_fixture_change");
      continue;
    }
    if (/^tests\/contracts\/chatgpt-composer\/.+\.json$/.test(normalized) || /^tests\/fixtures\/generated\/chatgpt-composer-contract\.html$/.test(normalized) || /^scripts\/(build-composer-fixture-from-contract|validate-composer-contract)\.mjs$/.test(normalized)) {
      addContract("composer_contract_change");
      continue;
    }
    if (/^scripts\/(build|release-config|validate-build)\.mjs$|^package\.json$/.test(normalized)) {
      addStatic("build_or_script_change");
      addCase("markdown-copy", "build_or_script_change");
      addCase("typing-hotpath", "build_or_script_change");
      continue;
    }
    if (/^scripts\/run-e2e\.mjs$/.test(normalized)) {
      addStatic("e2e_runner_change");
      add("integration", "node", ["scripts/run-e2e.mjs", "--suite=integration"], "e2e_runner_change");
      continue;
    }

    addStatic("fallback_unknown_runtime_surface");
    add("integration", "node", ["scripts/run-e2e.mjs", "--suite=integration"], "fallback_unknown_runtime_surface");
  }

  if (steps.size === 0) {
    return { skip: true, reason: [...reasons].join(",") || "docs_only" };
  }
  return { skip: false, steps: [...steps.values()], reasons: [...reasons] };
}

function run(command, args, label) {
  const stepStarted = performance.now();
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
  results.push({ label, seconds: secondsSince(stepStarted), exitCode: result.status });
  if (result.status !== 0) process.exit(result.status || 1);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8", shell: false });
  return { ok: result.status === 0, stdout: result.stdout || "" };
}

function lines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function secondsSince(startedAt) {
  return Number(((performance.now() - startedAt) / 1000).toFixed(2));
}
