import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  READ_ONLY_CDP_COMMANDS,
  STYLE_WHITELIST,
  createManifest,
  privacyFlags,
  runReadOnlyCaptureSession,
  safetyFlags
} from "./live-atlas-cdp-core.mjs";
import { rawRoot, surfaceKeys, writeJson } from "./live-atlas-common.mjs";

const port = Number(argValue("--port") || process.env.MICA_ATLAS_CDP_PORT || 9222);
const threadUrl = argValue("--thread-url") || process.env.MICA_ATLAS_THREAD_URL || "";
const out = argValue("--out") || path.join(rawRoot, `capture-${Date.now()}`);
const idleMs = Number(argValue("--idle-ms") || process.env.MICA_ATLAS_IDLE_MS || 5000);
const maxCheckpoints = Number(argValue("--max-checkpoints") || process.env.MICA_ATLAS_MAX_CHECKPOINTS || 24);

console.log("Mica Atlas CDP companion safety summary:");
console.log("- read-only CDP command allowlist only");
console.log("- no Input.*, Page.navigate, reload, generic Runtime.evaluate, Network mutation, Fetch mutation, Tracing");
console.log("- captures only named MICA_ATLAS_CHECKPOINT markers");
console.log("- Page.captureScreenshot always uses a surface clip; no full-page screenshot policy");
console.log("- automatedSend/Enter/Upload/ConnectorAction: false");

if (!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9_-]+$/.test(threadUrl)) {
  throw new Error("atlas:capture requires --thread-url=https://chatgpt.com/c/<dedicated-capture-thread-id>");
}

const session = await runReadOnlyCaptureSession({ port, threadUrl, out, idleMs, maxCheckpoints });
const coverage = Object.fromEntries(surfaceKeys.map((key) => [
  key,
  { status: session.surfaces.includes(key) ? "OBSERVED" : "MISSING", count: session.surfaces.filter((item) => item === key).length }
]));
await mkdir(out, { recursive: true });
await writeJson(path.join(out, "manifest.json"), createManifest({ threadUrl, target: session.target, commandsSent: session.commandsSent }));
await writeFile(path.join(out, "timeline.ndjson"), `${session.timeline.map((event) => JSON.stringify(event)).join("\n")}\n`);
await writeJson(path.join(out, "coverage.json"), coverage);
await writeJson(path.join(out, "performance.json"), {
  schemaVersion: 1,
  source: "real-cdp-companion",
  privacy: privacyFlags(),
  safety: safetyFlags(),
  cdpMetricsCaptured: session.commandsSent.includes("Performance.getMetrics")
});

console.log(JSON.stringify({
  passed: true,
  attached: session.attached,
  targetResolved: true,
  checkpointCount: session.checkpointCount,
  commandsSent: session.commandsSent,
  readOnlyCommands: [...READ_ONLY_CDP_COMMANDS],
  styleWhitelist: STYLE_WHITELIST,
  out
}, null, 2));

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}
