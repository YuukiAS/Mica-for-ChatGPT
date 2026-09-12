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
for (const allowed of ["Runtime.enable", "Log.enable", "Page.getLayoutMetrics", "DOMSnapshot.captureSnapshot", "Page.captureScreenshot", "Performance.getMetrics"]) {
  assert((cdp + cdpCore).includes(allowed), `CDP companion missing allowlisted command ${allowed}`);
}
assert(cdpCore.includes("connectWebSocket") && cdpCore.includes("webSocketDebuggerUrl"), "CDP companion must implement WebSocket attach");
assert(cdpCore.includes("captureCheckpoint") && cdpCore.includes("Page.captureScreenshot") && cdpCore.includes("clip"), "CDP companion must capture clipped surfaces at checkpoints");
console.log(JSON.stringify({ passed: true, liveSurfaceAtlas: true, readOnlyCdpCompanion: true, protocolHarness: "scripts/live-atlas-cdp-protocol-test.mjs", playwrightRealSiteTraceUsed: false, automatedSend: false, automatedEnter: false, automatedUpload: false }, null, 2));
