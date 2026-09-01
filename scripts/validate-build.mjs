import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIST_DIR_NAME, ICON_SIZES, MACHINE_VERSION, REQUIRED_EXTENSION_FILES, VERSION_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DIST_DIR_NAME);

for (const relative of REQUIRED_EXTENSION_FILES) {
  await assertFile(path.join(distDir, relative));
}

const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === MACHINE_VERSION, "manifest version must match release config");
assert(manifest.version_name === VERSION_NAME, "manifest version_name must match release config");
assert(manifest.action?.default_popup === "popup/index.html", "action.default_popup missing");
assert(manifest.action?.default_title === "Mica", "action.default_title missing");
assert(manifest.permissions?.includes("storage"), "storage permission missing");
assert(manifest.permissions?.includes("activeTab"), "activeTab permission missing");
assert(!manifest.host_permissions?.some((host) => !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(host)), "unexpected host permission");
assert(manifest.content_scripts?.[0]?.js?.[0] === "known-interruptions.js", "known interruptions script must run before content.js");
assert(manifest.content_scripts?.[0]?.js?.[1] === "content.js", "content.js must remain a content script");

for (const size of [16, 32, 48, 128]) {
  assert(manifest.icons?.[size] === `icons/icon${size}.png`, `manifest icon${size} missing`);
  assert(manifest.action?.default_icon?.[size] === `icons/icon${size}.png`, `action.default_icon icon${size} missing`);
}
for (const size of ICON_SIZES) {
  const dimensions = await pngDimensions(path.join(distDir, "icons", `icon${size}.png`));
  assert(dimensions.width === size && dimensions.height === size, `icon${size}.png has wrong dimensions`);
}

const content = await readFile(path.join(distDir, "content.js"), "utf8");
for (const token of [
  "MICA_DIAGNOSTICS_START",
  "MICA_DIAGNOSTICS_STOP",
  "MICA_DIAGNOSTICS_COPY_REPORT",
  "MICA_DIAGNOSTICS_RESET",
  "Native virtualization",
  "mountedTurns",
  "conversationTextIncluded: false",
  "attachmentContentIncluded: false",
  "autoDismissKnownInterruptions",
  "knownInterruptions"
]) {
  assert(content.includes(token), `content.js missing ${token}`);
}
const reportBody = extractFunctionBody(content, "buildDiagnosticsReport");
assert(!/innerText|textContent|innerHTML|outerHTML/.test(reportBody), "diagnostics report builder must not read conversation text/html");

const interruptions = await readFile(path.join(distDir, "known-interruptions.js"), "utf8");
for (const token of [
  "chatgpt.rate_limit_history_ack.zh-CN.v1",
  "MicaKnownInterruptions",
  "WeakSet",
  "访问对话记录",
  "明白了"
]) {
  assert(interruptions.includes(token), `known-interruptions.js missing ${token}`);
}
for (const forbidden of ["radix-_", "btn-primary", "[role=\"dialog\"] button", "location.reload", "fetch(", "XMLHttpRequest"]) {
  assert(!interruptions.includes(forbidden), `known-interruptions.js contains forbidden dependency or behavior: ${forbidden}`);
}

const popupHtml = await readFile(path.join(distDir, "popup", "index.html"), "utf8");
for (const token of ["Start diagnostics", "Stop diagnostics", "Copy report", "Reset", "Auto-dismiss known interruptions"]) {
  assert(popupHtml.includes(token), `popup missing ${token}`);
}

console.log("Build validation passed");

async function assertFile(file) {
  const info = await stat(file);
  assert(info.isFile(), `${file} is not a file`);
}

async function pngDimensions(file) {
  const buffer = await readFile(file);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function extractFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
