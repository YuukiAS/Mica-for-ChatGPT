import { readFile } from "node:fs/promises";
import path from "node:path";
import { assert, root } from "./live-atlas-common.mjs";

const recorder = await readFile(path.join(root, "extension", "src", "atlas", "atlas-recorder.ts"), "utf8");
const cdp = await readFile(path.join(root, "scripts", "live-atlas-cdp.mjs"), "utf8");
const cdpCore = await readFile(path.join(root, "scripts", "live-atlas-cdp-core.mjs"), "utf8");
for (const token of ["MicaAtlasRecorder", "PerformanceObserver", "long-animation-frame", "MICA_ATLAS_CHECKPOINT", "automatedSend: false"]) {
  assert(recorder.includes(token), `atlas recorder missing ${token}`);
}
assert(!/requestSubmit|form\.submit|Input\.dispatch|Input\.insertText|Page\.navigate|Page\.reload|\.click\(/.test(recorder), "atlas recorder must not automate real-site actions");
for (const forbidden of ["Input.dispatchKeyEvent", "Input.insertText", "Input.dispatchMouseEvent", "Page.navigate", "Page.reload", "Runtime.evaluate", "Tracing.start"]) {
  const directUse = new RegExp(`sendCdpCommand\\([^)]*["']${forbidden.replace(".", "\\.")}["']`).test(cdp + cdpCore)
    || new RegExp(`\\.send\\([^)]*["']${forbidden.replace(".", "\\.")}["']`).test(cdp + cdpCore);
  assert(!directUse, `CDP companion exposes forbidden CDP call ${forbidden}`);
}
assert(cdpCore.includes("FORBIDDEN_CDP_COMMANDS") && cdpCore.includes("FORBIDDEN_CDP_PREFIXES"), "CDP companion must keep explicit deny lists");
assert(cdpCore.includes("DEFAULT_INACTIVITY_HARD_CAP_MS") && cdpCore.includes("DEFAULT_MAX_CHECKPOINTS = 500"), "CDP companion must use long-session retention and hard-cap defaults");
assert(cdpCore.includes("isTerminalCheckpoint") && cdpCore.includes("atlas_stopped") && cdpCore.includes("operator_stop"), "CDP companion must support explicit stop semantics");
assert(cdpCore.includes("snapshot.strings") && !/doc\.strings/.test(cdpCore), "CDP parser must use official top-level DOMSnapshot strings");
assert(cdpCore.includes("readBigUInt64BE") && cdpCore.includes("fragmentedOpcode") && cdpCore.includes("opcode === 9"), "CDP WebSocket must handle large frames, fragments, and ping");
assert(cdpCore.includes("REPORT_PREFIX") && cdpCore.includes("assembleRecorderReportChunk"), "CDP companion must ingest recorder report chunks");
assert(cdpCore.includes("isVisualCheckpoint") && cdpCore.includes("cdp_checkpoint_observed"), "CDP companion must separate timing-only and visual checkpoints");
assert(cdpCore.includes("return null;") && !/return "composer";\s*\n}/.test(cdpCore), "unknown checkpoints must not default to composer capture");
assert(cdpCore.includes("validateAtlasThreadUrl") && cdp.includes("validateAtlasThreadUrl"), "atlas capture must use the shared thread URL validator");
assert(recorder.indexOf("emitRecorderReportMarker(finalReport)") >= 0 && recorder.indexOf("emitRecorderReportMarker(finalReport)") < recorder.indexOf("emitCheckpointMarker(\"atlas_stopped\""), "recorder report must be emitted before terminal marker");
assert(cdpCore.includes("timeBase: \"cdp-page-monotonic\"") && cdpCore.includes("timeBase: \"atlas-session-relative\""), "raw timeline must preserve explicit time bases");
assert(cdpCore.includes("documentRect") && cdpCore.includes("viewportRect") && cdpCore.includes("screenshotClipForDocumentRect"), "CDP capture must separate matching viewport rects from screenshot document clips");
assert(cdpCore.includes("cssVisualViewport") && cdpCore.includes("cssLayoutViewport") && cdpCore.includes("cssContentSize"), "CDP capture must prefer modern CSS viewport metrics");
assert(cdp.includes("REAL_EDGE_CDP_ATTACHED = YES") && cdp.includes("SAFE_TO_START_ATLAS = YES"), "CDP capture CLI must expose the explicit ready handshake");
for (const allowed of ["Runtime.enable", "Log.enable", "Page.getLayoutMetrics", "DOMSnapshot.captureSnapshot", "Page.captureScreenshot", "Performance.getMetrics"]) {
  assert((cdp + cdpCore).includes(allowed), `CDP companion missing allowlisted command ${allowed}`);
}
assert(cdpCore.includes("connectWebSocket") && cdpCore.includes("webSocketDebuggerUrl"), "CDP companion must implement WebSocket attach");
assert(cdpCore.includes("captureCheckpoint") && cdpCore.includes("Page.captureScreenshot") && cdpCore.includes("clip"), "CDP companion must capture clipped surfaces at checkpoints");
console.log(JSON.stringify({ passed: true, liveSurfaceAtlas: true, readOnlyCdpCompanion: true, protocolHarness: "scripts/live-atlas-cdp-protocol-test.mjs", longSessionHarness: "scripts/live-atlas-cdp-long-session-test.mjs", realEdgeNoSendPreflightReady: true, playwrightRealSiteTraceUsed: false, automatedSend: false, automatedEnter: false, automatedUpload: false }, null, 2));
