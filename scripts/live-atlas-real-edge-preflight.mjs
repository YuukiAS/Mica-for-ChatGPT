import { spawn } from "node:child_process";
import path from "node:path";
import { readJson, rawRoot } from "./live-atlas-common.mjs";

const threadUrl = argValue("--thread-url") || process.env.MICA_ATLAS_THREAD_URL || "";
const port = argValue("--port") || process.env.MICA_ATLAS_CDP_PORT || "9222";
const sessionId = argValue("--session-id") || `real-edge-preflight-${Date.now()}`;
const raw = argValue("--out") || path.join(rawRoot, sessionId);
const sanitized = argValue("--sanitized") || path.join("tests", "contracts", "chatgpt-live", sessionId);

if (!/^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9_-]+$/.test(threadUrl)) {
  throw new Error("atlas:preflight requires --thread-url=https://chatgpt.com/c/<dedicated-empty-thread-id>");
}

console.log("REAL_EDGE_PREFLIGHT safety:");
console.log("- no Send, Enter, upload, connector action, retry/regenerate, auth, navigation, or account mutation");
console.log("- user manually starts and stops Atlas; CDP companion only records read-only checkpoints");

await run("node", ["scripts/live-atlas-cdp.mjs", `--port=${port}`, `--thread-url=${threadUrl}`, `--out=${raw}`]);
await run("node", ["scripts/live-atlas-sanitize.mjs", `--input=${raw}`, `--output=${sanitized}`]);
await run("node", ["scripts/live-atlas-privacy.mjs", `--input=${sanitized}`]);
await run("node", ["scripts/live-atlas-build-fixtures.mjs", `--input=${sanitized}`, `--output=${path.join(sanitized, "fixture.html")}`]);

const surfaces = await readJson(path.join(sanitized, "surfaces.json"));
const composer = surfaces.composer;
if (composer?.status !== "OBSERVED" || !composer.contract?.rect || composer.source !== "real-cdp-companion") {
  throw new Error("REAL_EDGE_PREFLIGHT failed: composer real CDP contract was not observed");
}
if (!composer.variants?.length) {
  throw new Error("REAL_EDGE_PREFLIGHT failed: composer variant was not preserved");
}

console.log(JSON.stringify({
  REAL_EDGE_PREFLIGHT: "PASS",
  raw,
  sanitized,
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
