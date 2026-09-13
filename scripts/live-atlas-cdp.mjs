import path from "node:path";
import {
  DEFAULT_DRAIN_MS,
  DEFAULT_INACTIVITY_HARD_CAP_MS,
  DEFAULT_MAX_CHECKPOINTS,
  CAPTURE_MODE_EVENT_ONLY,
  CAPTURE_MODE_VISUAL,
  READ_ONLY_CDP_COMMANDS,
  STYLE_WHITELIST,
  runReadOnlyCaptureSession,
  validateAtlasThreadUrl,
  writeRawSessionBundle
} from "./live-atlas-cdp-core.mjs";
import { rawRoot } from "./live-atlas-common.mjs";

const port = Number(argValue("--port") || process.env.MICA_ATLAS_CDP_PORT || 9222);
const threadUrl = argValue("--thread-url") || process.env.MICA_ATLAS_THREAD_URL || "";
const userDataDir = argValue("--user-data-dir") || process.env.MICA_ATLAS_EDGE_USER_DATA_DIR || "";
const out = argValue("--out") || path.join(rawRoot, `capture-${Date.now()}`);
const idleMs = Number(argValue("--idle-ms") || process.env.MICA_ATLAS_IDLE_MS || DEFAULT_INACTIVITY_HARD_CAP_MS);
const drainMs = Number(argValue("--drain-ms") || process.env.MICA_ATLAS_DRAIN_MS || DEFAULT_DRAIN_MS);
const maxCheckpoints = Number(argValue("--max-checkpoints") || process.env.MICA_ATLAS_MAX_CHECKPOINTS || DEFAULT_MAX_CHECKPOINTS);
const captureMode = argValue("--capture-mode") || process.env.MICA_ATLAS_CAPTURE_MODE || CAPTURE_MODE_VISUAL;
if (![CAPTURE_MODE_VISUAL, CAPTURE_MODE_EVENT_ONLY].includes(captureMode)) {
  throw new Error(`Unsupported --capture-mode=${captureMode}`);
}

console.log("Mica Atlas CDP companion safety summary:");
console.log("- read-only CDP command allowlist only");
console.log("- no Input.*, Page.navigate, reload, generic Runtime.evaluate, Network mutation, Fetch mutation, Tracing");
console.log("- captures only named MICA_ATLAS_CHECKPOINT markers");
console.log("- normal termination requires atlas_stopped marker or local Ctrl+C/operator stop");
console.log("- supports Edge DevToolsActivePort browser WebSocket auto-connect via --user-data-dir");
console.log("- --idle-ms is an inactivity hard cap and is re-armed after each checkpoint");
console.log(`- captureMode: ${captureMode}`);
if (captureMode === CAPTURE_MODE_EVENT_ONLY) {
  console.log("- event-only mode sends zero DOMSnapshot.captureSnapshot and zero Page.captureScreenshot commands");
} else {
  console.log("- visual mode Page.captureScreenshot always uses a surface clip; no full-page screenshot policy");
}
console.log("- automatedSend/Enter/Upload/ConnectorAction: false");

validateAtlasThreadUrl(threadUrl);

const controller = new AbortController();
const onSigint = () => {
  console.log("Mica Atlas CDP companion received Ctrl+C; draining pending captures before close.");
  controller.abort();
};
process.once("SIGINT", onSigint);

const session = await runReadOnlyCaptureSession({
  port,
  threadUrl,
  userDataDir: userDataDir || null,
  out,
  idleMs,
  drainMs,
  maxCheckpoints,
  captureMode,
  abortSignal: controller.signal,
  onAttached: () => {
    console.log("REAL_EDGE_CDP_ATTACHED = YES");
    console.log("SAFE_TO_START_ATLAS = YES");
  }
});
process.off("SIGINT", onSigint);
await writeRawSessionBundle({ out, threadUrl, session });

console.log(JSON.stringify({
  passed: session.attached && !session.truncated && session.terminationReason !== "capture_error" && session.terminationReason !== "checkpoint_capacity_exceeded",
  attached: session.attached,
  targetResolved: true,
  checkpointCount: session.checkpointCount,
  capturedCheckpointCount: session.capturedCheckpointCount,
  maxConcurrentHeavyCapture: session.maxConcurrentHeavyCapture,
  queuedVisualCheckpointCount: session.queuedVisualCheckpointCount,
  executedHeavyCaptureCount: session.executedHeavyCaptureCount,
  coalescedVisualCheckpointCount: session.coalescedVisualCheckpointCount,
  captureMode: session.captureMode,
  terminationReason: session.terminationReason,
  explicitStop: session.explicitStop,
  inactivityHardCapMs: session.inactivityHardCapMs,
  drainMs: session.drainMs,
  maxCheckpoints: session.maxCheckpoints,
  truncated: session.truncated,
  truncation: session.truncation,
  commandsSent: session.commandsSent,
  readOnlyCommands: [...READ_ONLY_CDP_COMMANDS],
  styleWhitelist: STYLE_WHITELIST,
  out
}, null, 2));

if (session.truncated || session.terminationReason === "capture_error" || session.terminationReason === "checkpoint_capacity_exceeded") {
  process.exitCode = 1;
}

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}
