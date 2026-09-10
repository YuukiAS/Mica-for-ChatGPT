import { readFile } from "node:fs/promises";
import path from "node:path";
import { assert, root } from "./live-atlas-common.mjs";

const recorder = await readFile(path.join(root, "extension", "src", "atlas", "atlas-recorder.ts"), "utf8");
const cdp = await readFile(path.join(root, "scripts", "live-atlas-cdp.mjs"), "utf8");
for (const token of ["MicaAtlasRecorder", "PerformanceObserver", "long-animation-frame", "MICA_ATLAS_CHECKPOINT", "automatedSend: false"]) {
  assert(recorder.includes(token), `atlas recorder missing ${token}`);
}
assert(!/requestSubmit|form\.submit|Input\.dispatch|Input\.insertText|Page\.navigate|Page\.reload|\.click\(/.test(recorder), "atlas recorder must not automate real-site actions");
for (const forbidden of ["Input.dispatchKeyEvent", "Input.insertText", "Input.dispatchMouseEvent", "Page.navigate", "Page.reload", "Runtime.evaluate", "Tracing.start"]) {
  const directUse = new RegExp(`sendCdpCommand\\([^)]*["']${forbidden.replace(".", "\\.")}["']`).test(cdp)
    || new RegExp(`\\.send\\([^)]*["']${forbidden.replace(".", "\\.")}["']`).test(cdp);
  assert(!directUse, `CDP companion exposes forbidden CDP call ${forbidden}`);
}
assert(cdp.includes("FORBIDDEN_CDP_COMMANDS") && cdp.includes("FORBIDDEN_CDP_PREFIXES"), "CDP companion must keep explicit deny lists");
for (const allowed of ["Target.getTargets", "Runtime.enable", "Log.enable", "Page.getLayoutMetrics", "DOMSnapshot.captureSnapshot", "Page.captureScreenshot", "Performance.getMetrics"]) {
  assert(cdp.includes(allowed), `CDP companion missing allowlisted command ${allowed}`);
}
console.log(JSON.stringify({ passed: true, liveSurfaceAtlas: true, readOnlyCdpCompanion: true, playwrightRealSiteTraceUsed: false, automatedSend: false, automatedEnter: false, automatedUpload: false }, null, 2));
