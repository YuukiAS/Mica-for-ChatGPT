import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readJson, rawRoot } from "./live-atlas-common.mjs";
import { validateAtlasThreadUrl } from "./live-atlas-cdp-core.mjs";

const threadUrl = argValue("--thread-url") || process.env.MICA_ATLAS_THREAD_URL || "";
const port = argValue("--port") || process.env.MICA_ATLAS_CDP_PORT || "9222";
const userDataDir = argValue("--user-data-dir") || process.env.MICA_ATLAS_EDGE_USER_DATA_DIR || "";
const sessionId = argValue("--session-id") || `real-edge-preflight-${Date.now()}`;
const raw = argValue("--out") || path.join(rawRoot, sessionId);
const sanitized = argValue("--sanitized") || path.join("tests", "contracts", "chatgpt-live", sessionId);

validateAtlasThreadUrl(threadUrl);

console.log("REAL_EDGE_PREFLIGHT safety:");
console.log("- no Send, Enter, upload, connector action, retry/regenerate, auth, navigation, or account mutation");
console.log("- user manually starts and stops Atlas; CDP companion only records read-only checkpoints");

await run("node", [
  "scripts/live-atlas-cdp.mjs",
  `--port=${port}`,
  `--thread-url=${threadUrl}`,
  `--out=${raw}`,
  ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : [])
]);
await run("node", ["scripts/live-atlas-sanitize.mjs", `--input=${raw}`, `--output=${sanitized}`]);
await run("node", ["scripts/live-atlas-privacy.mjs", `--input=${sanitized}`]);
await run("node", ["scripts/live-atlas-build-fixtures.mjs", `--input=${sanitized}`, `--output=${path.join(sanitized, "fixture.html")}`]);

const manifest = await readJson(path.join(raw, "manifest.json"));
const performanceJson = await readJson(path.join(raw, "performance.json"));
const timeline = (await readFile(path.join(raw, "timeline.ndjson"), "utf8"))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const screenshotFiles = (await readdir(path.join(raw, "screenshots")).catch(() => [])).filter((file) => file.endsWith(".png"));
const screenshotEvidence = await Promise.all(screenshotFiles.map(async (file) => {
  const buffer = await readFile(path.join(raw, "screenshots", file));
  return { file, bytes: buffer.length, png: hasPngSignature(buffer) };
}));
const rawSurfaceFiles = (await readdir(path.join(raw, "surfaces")).catch(() => [])).filter((file) => file.endsWith(".json"));
const rawSurfaces = await Promise.all(rawSurfaceFiles.map((file) => readJson(path.join(raw, "surfaces", file))));
const surfaces = await readJson(path.join(sanitized, "surfaces.json"));
const composer = surfaces.composer;
const overlay = surfaces.micaOverlay;
const observedSurfaces = Object.values(surfaces).filter((surface) => surface.status === "OBSERVED");
const recorderEvents = timeline.filter((event) => event.timeBase === "atlas-session-relative" && !String(event.type || "").startsWith("cdp_"));
if (manifest.attached !== true || manifest.targetUrlExactMatch !== true) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: exact target was not attached");
}
if (!["atlas_stopped", "operator_stop"].includes(manifest.terminationReason) || manifest.truncated || performanceJson.truncated) {
  throw new Error(`REAL_EDGE_PREFLIGHT failed: capture did not terminate cleanly (${manifest.terminationReason || "unknown"})`);
}
if (timeline.some((event) => event.type === "cdp_capture_error" || event.details?.status === "capture_error")) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: capture_error was recorded");
}
if (composer?.status !== "OBSERVED" || !contractHasStructure(composer.contract) || composer.source !== "real-cdp-companion") {
  throw new Error("REAL_EDGE_PREFLIGHT failed: composer real CDP contract was not observed");
}
if (!composer.variants?.length) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: composer variant was not preserved");
}
if (!screenshotEvidence.some((item) => item.bytes > 8 && item.png)) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: no non-empty cropped PNG screenshot was produced");
}
const observedRawSurfaces = rawSurfaces.filter((surface) => surface.status === "OBSERVED");
if (!observedRawSurfaces.length || !observedRawSurfaces.every(hasScreenshotCoordinateEvidence)) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: observed surface lacks documentRect-derived screenshot evidence");
}
for (const surface of observedRawSurfaces) {
  const screenshot = screenshotEvidence.find((item) => item.file.includes(`${surface.name}-`));
  if (!screenshot?.png || screenshot.bytes <= 8) {
    throw new Error(`REAL_EDGE_PREFLIGHT failed: ${surface.name} screenshot is missing or not a PNG`);
  }
  if (!rectsCorrespond(surface.contract?.rect, surface.coordinateEvidence?.viewportRect)) {
    throw new Error(`REAL_EDGE_PREFLIGHT failed: ${surface.name} contract does not match resolved viewport rect`);
  }
}
if (performanceJson.recorderReportsIngested < 1) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: recorder report was not ingested");
}
if (performanceJson.recorderPerformanceIngested !== true || !performanceJson.recorderPerformance) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: recorder performance object was not ingested");
}
if (recorderEvents.length === 0) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: combined raw timeline contains no in-page recorder events");
}
if (overlay?.status !== "OBSERVED" || overlay.source !== "real-cdp-companion" || !contractHasStructure(overlay.contract)) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: Mica overlay real surface was not observed");
}
if (manifest.safety?.automatedSend || manifest.safety?.automatedEnter || manifest.safety?.automatedUpload || manifest.safety?.automatedConnectorAction) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: safety flags indicate automated mutation");
}

console.log(JSON.stringify({
  REAL_EDGE_PREFLIGHT: "PASS",
  raw,
  sanitized,
  checkpointCount: manifest.checkpointCount,
  capturedVisualCount: manifest.capturedCheckpointCount,
  recorderEventCount: recorderEvents.length,
  screenshotCount: screenshotEvidence.length,
  screenshotCoordinateEvidenceCount: observedRawSurfaces.length,
  observedSurfaces: observedSurfaces.map((surface) => surface.name).sort(),
  terminationReason: manifest.terminationReason,
  automatedSend: false,
  automatedEnter: false,
  automatedUpload: false,
  automatedConnectorAction: false
}, null, 2));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed with ${code}`)));
  });
}

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}

function hasPngSignature(buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function contractHasStructure(contract) {
  if (!contract || !contract.rect || !contract.tag) return false;
  const attrs = contract.attrs && Object.keys(contract.attrs).length > 0;
  const children = Array.isArray(contract.children) && contract.children.length > 0;
  const text = Number(contract.text?.length || 0) > 0 && typeof contract.text?.category === "string";
  return attrs || children || text;
}

function hasScreenshotCoordinateEvidence(surface) {
  const evidence = surface.coordinateEvidence || {};
  return evidence.screenshotClipSource === "documentRect"
    && isRect(evidence.documentRect)
    && isRect(evidence.viewportRect)
    && isRect(evidence.screenshotClip)
    && Number.isFinite(Number(evidence.cssZoom));
}

function isRect(rect) {
  return rect && ["x", "y", "width", "height"].every((key) => Number.isFinite(Number(rect[key]))) && rect.width > 0 && rect.height > 0;
}

function rectsCorrespond(left, right) {
  if (!isRect(left) || !isRect(right)) return false;
  return ["x", "y", "width", "height"].every((key) => Math.abs(Number(left[key]) - Number(right[key])) <= 0.2);
}
