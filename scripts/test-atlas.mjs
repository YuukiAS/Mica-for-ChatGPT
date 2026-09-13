import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const steps = [
  ["build", "node", ["scripts/build.mjs"]],
  ["atlas:check", "node", ["scripts/live-atlas-check.mjs"]],
  ["atlas:url", "node", ["scripts/live-atlas-url-test.mjs"]],
  ["atlas:targeting", "node", ["scripts/live-atlas-targeting-test.mjs"]],
  ["atlas:screenshot-coordinate", "node", ["scripts/live-atlas-screenshot-coordinate-test.mjs"]],
  ["atlas:handshake", "node", ["scripts/live-atlas-handshake-test.mjs"]],
  ["atlas:cdp-protocol", "node", ["scripts/live-atlas-cdp-protocol-test.mjs"]],
  ["atlas:visual-capture-queue", "node", ["scripts/live-atlas-visual-capture-queue-test.mjs"]],
  ["atlas:devtools-active-port", "node", ["scripts/live-atlas-devtools-active-port-test.mjs"]],
  ["atlas:cdp-long-session", "node", ["scripts/live-atlas-cdp-long-session-test.mjs"]],
  ["atlas:preflight", "node", ["scripts/live-atlas-preflight-test.mjs"]],
  ["atlas:sample", "node", ["scripts/live-atlas-sample.mjs"]],
  ["atlas:sanitize", "node", ["scripts/live-atlas-sanitize.mjs"]],
  ["atlas:timeline-clock", "node", ["scripts/live-atlas-timeline-clock-test.mjs"]],
  ["atlas:privacy", "node", ["scripts/live-atlas-privacy.mjs"]],
  ["atlas:variants", "node", ["scripts/live-atlas-sanitizer-variants-test.mjs"]],
  ["atlas:build-fixtures", "node", ["scripts/live-atlas-build-fixtures.mjs"]],
  ["atlas:fixture-contract", "node", ["scripts/live-atlas-fixture-contract-test.mjs"]],
  ["atlas:analyze-timings", "node", ["scripts/live-atlas-analyze-timings.mjs"]],
  ["e2e:atlas-replay", "node", ["scripts/run-e2e.mjs", "--case=atlas-replay"]],
  ["e2e:atlas-generation-identity", "node", ["scripts/run-e2e.mjs", "--case=atlas-generation-identity"]],
  ["e2e:typing-hotpath", "node", ["scripts/run-e2e.mjs", "--case=typing-hotpath"]],
  ["e2e:atlas-hotpath", "node", ["scripts/run-e2e.mjs", "--case=atlas-hotpath"]]
];
const started = performance.now();
const results = [];
for (const [label, command, args] of steps) {
  const stepStarted = performance.now();
  await run(command, args);
  results.push({ label, seconds: secondsSince(stepStarted) });
}
console.log(JSON.stringify({ passed: true, totalSeconds: secondsSince(started), results }, null, 2));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed with ${code}`)));
  });
}

function secondsSince(startedAt) {
  return Number(((performance.now() - startedAt) / 1000).toFixed(2));
}
