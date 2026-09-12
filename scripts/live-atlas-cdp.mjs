import path from "node:path";
import {
  DEFAULT_DRAIN_MS,
  DEFAULT_INACTIVITY_HARD_CAP_MS,
  DEFAULT_MAX_CHECKPOINTS,
  READ_ONLY_CDP_COMMANDS,
  STYLE_WHITELIST,
  runReadOnlyCaptureSession,
  validateAtlasThreadUrl,
  writeRawSessionBundle
} from "./live-atlas-cdp-core.mjs";
import { rawRoot } from "./live-atlas-common.mjs";

const port = Number(argValue("--port") || process.env.MICA_ATLAS_CDP_PORT || 9222);
const threadUrl = argValue("--thread-url") || process.env.MICA_ATLAS_THREAD_URL || "";
const out = argValue("--out") || path.join(rawRoot, `capture-${Date.now()}`);
const idleMs = Number(argValue("--idle-ms") || process.env.MICA_ATLAS_IDLE_MS || DEFAULT_INACTIVITY_HARD_CAP_MS);
const drainMs = Number(argValue("--drain-ms") || process.env.MICA_ATLAS_DRAIN_MS || DEFAULT_DRAIN_MS);
const maxCheckpoints = Number(argValue("--max-checkpoints") || process.env.MICA_ATLAS_MAX_CHECKPOINTS || DEFAULT_MAX_CHECKPOINTS);

console.log("Mica Atlas CDP companion safety summary:");
console.log("- read-only CDP command allowlist only");
console.log("- no Input.*, Page.navigate, reload, generic Runtime.evaluate, Network mutation, Fetch mutation, Tracing");
console.log("- captures only named MICA_ATLAS_CHECKPOINT markers");
console.log("- normal termination requires atlas_stopped marker or local Ctrl+C/operator stop");
console.log("- --idle-ms is an inactivity hard cap and is re-armed after each checkpoint");
console.log("- Page.captureScreenshot always uses a surface clip; no full-page screenshot policy");
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
  out,
  idleMs,
  drainMs,
  maxCheckpoints,
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
