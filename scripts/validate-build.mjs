import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME, ICON_SIZES, MACHINE_VERSION, REQUIRED_EXTENSION_FILES, VERSION_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);

for (const relative of REQUIRED_EXTENSION_FILES) await assertFile(path.join(distDir, relative));
const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === MACHINE_VERSION, "manifest version must match release config");
assert(manifest.version_name === VERSION_NAME, "manifest version_name must match release config");
assert(manifest.action?.default_popup === "popup/index.html", "action.default_popup missing");
assert(manifest.background?.service_worker === "service-worker.js", "background service worker missing");
assert(sameSet(manifest.permissions, ["storage", "activeTab", "clipboardWrite"]), "permissions must stay minimal and match visible local features");
assert(manifest.host_permissions?.every((host) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(host)), "unexpected host permission");
assert(JSON.stringify(manifest.content_scripts?.[0]?.js) === JSON.stringify(["current-ui-check.js", "markdown-copy.js", "research-export.js", "highlighter.js", "turn-delivery-guard.js", "content.js"]), "content script order drifted");
assert(manifest.options_ui?.page === "options/index.html" && manifest.options_ui?.open_in_tab === true, "bounded troubleshooting surface missing");

for (const size of ICON_SIZES) {
  const dimensions = await pngDimensions(path.join(distDir, "icons", `icon${size}.png`));
  assert(dimensions.width === size && dimensions.height === size, `icon${size}.png has wrong dimensions`);
}

const content = await readFile(path.join(distDir, "content.js"), "utf8");
for (const token of ["MICA_GET_PRODUCT_STATUS", "MICA_SERIALIZE_ACTIVE_ANSWER", "native_handling", "data-mica-current-action-cluster", "promptTextInDiagnostics: false", "clipboard-fallback", "document.execCommand(\"copy\")"]) {
  assert(content.includes(token), `content.js missing ${token}`);
}

const serviceWorker = await readFile(path.join(distDir, "service-worker.js"), "utf8");
for (const token of ["migrateState", "typeof state[key] === \"boolean\"", "schemaVersion: 2"]) {
  assert(serviceWorker.includes(token), `service-worker.js missing migration contract ${token}`);
}
for (const forbidden of ["MICA_DIAGNOSTICS_START", "Start Atlas", "showStatus", "longThreadOptimization", "location.reload", "fetch(", "XMLHttpRequest"]) {
  assert(!content.includes(forbidden), `content.js contains forbidden runtime token ${forbidden}`);
}

const guard = await readFile(path.join(distDir, "turn-delivery-guard.js"), "utf8");
for (const token of ["awaiting_user_commit", "user_committed", "assistant_generating", "ghost_send_suspected", "fake_waiting_suspected", "promptTextIncluded: false"]) {
  assert(guard.includes(token), `turn-delivery-guard.js missing ${token}`);
}
assert(!/addEventListener\(\"(?:beforeinput|input|keydown|compositionstart|compositionupdate|compositionend)\"/.test(guard), "guard must not attach ordinary typing listeners");
assert(!/setInterval\(|fetch\(|XMLHttpRequest/.test(guard), "guard must stay event-driven and local");

const serializer = await readFile(path.join(distDir, "markdown-copy.js"), "utf8");
for (const token of ["serializeAnswer", "application/x-tex", "$$\\n", "tableToMarkdown", "sanitizeHtml"]) {
  assert(serializer.includes(token), `markdown-copy.js missing ${token}`);
}

const researchExport = await readFile(path.join(distDir, "research-export.js"), "utf8");
for (const token of ["serializeNotion", "preparePdfExport", "mica-export-math", "official-katex-source-deterministic-fallback"]) {
  assert(researchExport.includes(token), `research-export.js missing ${token}`);
}
const highlighter = await readFile(path.join(distDir, "highlighter.js"), "utf8");
for (const token of ["data-mica-highlight-id", "resolveAnchorPosition", "storage?.local", "contentUpload: false"]) {
  assert(highlighter.includes(token), `highlighter.js missing ${token}`);
}
assert(!/fetch\(|XMLHttpRequest|setInterval\(/.test(highlighter), "highlighter must stay local and event-coalesced");

const currentUiCheck = await readFile(path.join(distDir, "current-ui-check.js"), "utf8");
for (const token of ["MICA_CURRENT_UI_CHECK_START", "MICA_CURRENT_UI_CHECK_STOP", "promptText: false", "answerText: false", "contentUpload: false", "MAX_EVENTS = 80"]) {
  assert(currentUiCheck.includes(token), `current-ui-check.js missing ${token}`);
}
assert(!/fetch\(|XMLHttpRequest|setInterval\(/.test(currentUiCheck), "current UI check must stay local and bounded");

const popupHtml = await readFile(path.join(distDir, "popup", "index.html"), "utf8");
for (const token of ["Copy &amp; Export", "Reliability", "Page integration", "Advanced", "Local by default"]) {
  assert(popupHtml.includes(token), `popup missing ${token}`);
}
for (const forbidden of ["Atlas", "Diagnostics", "fixture", "selector", "mounted", "optimized", "Start diagnostics", "Reset"]) {
  assert(!popupHtml.includes(forbidden), `normal popup contains developer wording ${forbidden}`);
}

console.log("Build validation passed");

async function assertFile(file) {
  const info = await stat(file);
  assert(info.isFile(), `${file} is not a file`);
}

async function pngDimensions(file) {
  const buffer = await readFile(file);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function sameSet(actual = [], expected = []) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
