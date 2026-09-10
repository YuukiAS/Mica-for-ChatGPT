import { writeFile } from "node:fs/promises";
import path from "node:path";
import { rawRoot, writeJson } from "./live-atlas-common.mjs";

const READ_ONLY_CDP_COMMANDS = new Set([
  "Target.getTargets",
  "Runtime.enable",
  "Log.enable",
  "Page.getLayoutMetrics",
  "DOMSnapshot.captureSnapshot",
  "Page.captureScreenshot",
  "Performance.getMetrics"
]);
const FORBIDDEN_CDP_PREFIXES = ["Input.", "Network.", "Tracing.", "Fetch."];
const FORBIDDEN_CDP_COMMANDS = new Set(["Page.navigate", "Page.reload", "Runtime.evaluate"]);
const STYLE_WHITELIST = ["display", "position", "border-radius", "box-shadow", "background-color", "color", "font-size", "line-height"];

const port = Number(argValue("--port") || process.env.MICA_ATLAS_CDP_PORT || 9222);
const threadUrl = argValue("--thread-url") || process.env.MICA_ATLAS_THREAD_URL || "";
const out = argValue("--out") || path.join(rawRoot, `capture-${Date.now()}`);

console.log("Mica Atlas CDP companion safety summary:");
console.log("- read-only CDP command allowlist only");
console.log("- no Input.*, Page.navigate, reload, generic Runtime.evaluate, Network mutation, Trace");
console.log("- screenshots must be cropped surfaces; no full-page screenshot policy");
console.log("- automatedSend/Enter/Upload/ConnectorAction: false");

if (!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9_-]+/.test(threadUrl)) {
  throw new Error("atlas:capture requires --thread-url=https://chatgpt.com/c/<dedicated-capture-thread-id>");
}

const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
const matches = targets.filter((target) => target.type === "page" && target.url === threadUrl);
if (matches.length !== 1) {
  throw new Error(`Expected exactly one dedicated ChatGPT capture tab for ${threadUrl}; found ${matches.length}`);
}

await writeJson(path.join(out, "manifest.json"), {
  schemaVersion: 1,
  kind: "mica.liveSurfaceAtlas.raw",
  source: "real-cdp-companion",
  threadUrlAllowed: true,
  targetTitleLength: String(matches[0].title || "").length,
  styleWhitelist: STYLE_WHITELIST,
  readOnlyCommands: [...READ_ONLY_CDP_COMMANDS],
  privacy: privacyFlags(),
  safety: safetyFlags()
});
await writeFile(path.join(out, "timeline.ndjson"), "");
await writeJson(path.join(out, "coverage.json"), {});
await writeJson(path.join(out, "performance.json"), {});
console.log(JSON.stringify({ passed: true, attached: false, targetResolved: true, out }, null, 2));

export function assertReadOnlyCommand(command) {
  if (FORBIDDEN_CDP_COMMANDS.has(command) || FORBIDDEN_CDP_PREFIXES.some((prefix) => command.startsWith(prefix))) {
    throw new Error(`Forbidden CDP command: ${command}`);
  }
  if (!READ_ONLY_CDP_COMMANDS.has(command)) throw new Error(`CDP command is not allowlisted: ${command}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to query Edge CDP endpoint ${url}: ${response.status}`);
  return response.json();
}

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}

function privacyFlags() {
  return { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false };
}

function safetyFlags() {
  return { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false, playwrightRealSiteTraceUsed: false, computerUseRequired: false };
}
