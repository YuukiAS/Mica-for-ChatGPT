import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "chatgpt-rate-limit-dialog.zh-CN.html");
const harnessPath = path.join(root, "tests", "fixtures", "known-interruptions-dom-test.html");
const sourcePath = path.join(root, "extension", "src", "reliability", "known-interruptions.ts");
const builtPath = path.join(root, "dist", DIST_DIR_NAME, "known-interruptions.js");
const popupPath = path.join(root, "dist", DIST_DIR_NAME, "popup", "index.html");
const contentPath = path.join(root, "dist", DIST_DIR_NAME, "content.js");

const fixture = await readFile(fixturePath, "utf8");
const harness = await readFile(harnessPath, "utf8");
const source = await readFile(sourcePath, "utf8");
const built = await readFile(builtPath, "utf8");
const popup = await readFile(popupPath, "utf8");
const content = await readFile(contentPath, "utf8");

for (const snippet of [
  "请求过于频繁",
  "你的请求过于频繁。为保障数据安全，我们已暂时限制你访问对话记录。",
  "请稍等几分钟后再重试。",
  "明白了"
]) {
  assert(fixture.includes(snippet), `rate-limit fixture missing ${snippet}`);
}

for (const snippet of [
  "chatgpt.rate_limit_history_ack.zh-CN.v1",
  "WeakSet",
  "RULE_COOLDOWN_MS",
  "访问对话记录",
  "MicaKnownInterruptions",
  "button.click()"
]) {
  assert(source.includes(snippet), `known interruptions source missing ${snippet}`);
  assert(built.includes(snippet), `built known interruptions script missing ${snippet}`);
}

for (const forbidden of [
  "radix-_",
  "btn-primary",
  "[role=\"dialog\"] button",
  "querySelector('[role=dialog] button')",
  "location.reload",
  "window.location",
  "fetch(",
  "XMLHttpRequest"
]) {
  assert(!source.includes(forbidden), `known interruptions source must not depend on or perform ${forbidden}`);
}

for (const snippet of [
  "Auto-dismiss known interruptions",
  "Dismiss safe, known ChatGPT notices automatically."
]) {
  assert(popup.includes(snippet), `popup missing ${snippet}`);
}

for (const snippet of [
  "autoDismissKnownInterruptions",
  "knownInterruptions",
  "conversationTextIncluded: false",
  "attachmentContentIncluded: false"
]) {
  assert(content.includes(snippet), `content diagnostics/settings missing ${snippet}`);
}

for (const snippet of [
  "chatgpt-rate-limit-dialog.zh-CN.html",
  "same DOM node MutationObserver-style repeat",
  "settings off",
  "Google Drive"
]) {
  assert(harness.includes(snippet), `DOM harness missing ${snippet}`);
}

new Function(built);

console.log("Known interruption fixture smoke checks passed");
console.log(`Open DOM harness manually: ${pathToFileURL(harnessPath).href}`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
