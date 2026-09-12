import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { assert, surfaceKeys, writeJson } from "./live-atlas-common.mjs";
import { privacyFlags, safetyFlags } from "./live-atlas-cdp-core.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-clock-"));
const raw = path.join(temp, "raw");
const out = path.join(temp, "sanitized");

try {
  await mkdir(path.join(raw, "surfaces"), { recursive: true });
  await writeJson(path.join(raw, "manifest.json"), {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.raw",
    source: "clock-test",
    privacy: privacyFlags(),
    safety: safetyFlags(),
    attached: true,
    terminationReason: "atlas_stopped",
    explicitStop: true,
    truncated: false
  });
  await writeJson(path.join(raw, "coverage.json"), Object.fromEntries(surfaceKeys.map((key) => [key, { status: "MISSING", count: 0 }])));
  await writeJson(path.join(raw, "performance.json"), {
    schemaVersion: 1,
    source: "clock-test",
    privacy: privacyFlags(),
    safety: safetyFlags(),
    recorderReportsIngested: 1,
    recorderPerformanceIngested: true,
    recorderPerformance: { eventTiming: [], longAnimationFrame: [], longTask: [], layoutShift: [], memory: null }
  });
  const rawTimeline = [
    recorderEvent("checkpoint", 100, { checkpointId: "r:send", stateClass: "manual_send_intent", generationId: 1 }),
    recorderEvent("checkpoint", 150, { checkpointId: "r:user", stateClass: "user_turn_mounted", generationId: 1 }),
    cdpEvent("cdp_checkpoint_observed", 9000, { checkpointId: "c:send", stateClass: "manual_send_intent", generationId: 99 }),
    cdpEvent("cdp_checkpoint_observed", 9500, { checkpointId: "c:user", stateClass: "user_turn_mounted", generationId: 99 }),
    recorderEvent("checkpoint", 200, { checkpointId: "r:assistant", stateClass: "assistant_turn_mounted", generationId: 1 })
  ];
  await writeFile(path.join(raw, "timeline.ndjson"), `${rawTimeline.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const result = await run("node", ["scripts/live-atlas-sanitize.mjs", `--input=${raw}`, `--output=${out}`]);
  assert(result.code === 0, "sanitize failed", result);
  const lifecycle = JSON.parse(await readFile(path.join(out, "lifecycle.json"), "utf8"));
  const timings = JSON.parse(await readFile(path.join(out, "timings.json"), "utf8"));
  assert(lifecycle.timeline.some((event) => event.type === "cdp_checkpoint_observed" && event.timeBase === "cdp-page-monotonic" && event.relativeTimeMs === null), "CDP event time base was not preserved");
  assert(lifecycle.generations.length === 1 && lifecycle.generations[0].generationId === 1, "CDP mirror generated duplicate lifecycle generation");
  assert(timings.metrics.manualSendIntentToUserTurnMountedMs.length === 1, "duplicate timing sample was generated");
  assert(timings.metrics.manualSendIntentToUserTurnMountedMs[0] === 50, "timing derivation did not use recorder clock");
  console.log(JSON.stringify({
    passed: true,
    authoritativeTimeline: "atlas-session-relative",
    cdpMirror: "visual-linkage-only",
    timingSamples: timings.metrics.manualSendIntentToUserTurnMountedMs,
    automatedSend: false,
    automatedUpload: false,
    automatedConnectorAction: false
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}

function recorderEvent(type, relativeTimeMs, details) {
  return { schemaVersion: 1, type, timeBase: "atlas-session-relative", monotonicTimeMs: relativeTimeMs, relativeTimeMs, epochTimeMs: 100000 + relativeTimeMs, details };
}

function cdpEvent(type, cdpMonotonicTimestamp, details) {
  return { schemaVersion: 1, type, timeBase: "cdp-page-monotonic", relativeTimeMs: null, details: { ...details, cdpMonotonicTimestamp } };
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.stack || error}` }));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
