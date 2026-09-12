import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const tier = process.argv.find((arg) => arg.startsWith("--tier="))?.slice("--tier=".length) || "fast";
const skipBuild = process.argv.includes("--skip-build");

const plans = {
  fast: [
    ["node", ["scripts/fixture-smoke.mjs"]],
    ["node", ["scripts/known-interruptions-fixture-smoke.mjs"]],
    ["node", ["scripts/overlay-fixture-smoke.mjs"]],
    ["node", ["scripts/validate-composer-contract.mjs"]],
    ["node", ["scripts/validate-build.mjs"]],
    ["node", ["scripts/run-e2e.mjs", "--case=markdown-copy"]],
    ["node", ["scripts/run-e2e.mjs", "--case=final-send-check"]],
    ["node", ["scripts/run-e2e.mjs", "--case=popup-atlas-status"]],
    ["node", ["scripts/run-e2e.mjs", "--case=typing-hotpath"]]
  ],
  integration: [
    ["node", ["scripts/run-e2e.mjs", "--suite=integration"]]
  ],
  full: [
    ["node", ["scripts/run-e2e.mjs"]]
  ],
  stress: [
    ["node", ["scripts/run-e2e.mjs", "--stress"]]
  ]
};

if (!plans[tier]) {
  throw new Error(`Unknown test candidate tier: ${tier}`);
}

const started = performance.now();
const results = [];

if (!skipBuild) {
  await runStep("build", "node", ["scripts/build.mjs"]);
}

for (const [command, args] of plans[tier]) {
  await runStep([command, ...args].join(" "), command, args);
}

const totalSeconds = secondsSince(started);
console.log(JSON.stringify({
  passed: true,
  tier,
  build: skipBuild ? "skipped" : "run_once",
  totalSeconds,
  results
}, null, 2));

async function runStep(label, command, args) {
  const stepStarted = performance.now();
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        results.push({ label, seconds: secondsSince(stepStarted) });
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

function secondsSince(startedAt) {
  return Number(((performance.now() - startedAt) / 1000).toFixed(2));
}
