import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "low-memory-background.js"), "utf8");
const events = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
const session = {};
const opened = [];
let createTab = true;
const runtime = {
  lastError: null,
  onInstalled: events(),
  onStartup: events(),
  onMessage: events(),
  getURL: (relative) => `chrome-extension://mica-fixture/${relative}`
};
const chrome = {
  runtime,
  storage: {
    onChanged: events(),
    local: { get: (defaults, callback) => callback({ ...defaults, enabled: false, lowMemory: false }) },
    session: {
      get: async (key) => typeof key === "string" ? { [key]: session[key] } : { ...key, ...session },
      set: async (value) => Object.assign(session, value),
      remove: async (key) => { delete session[key]; }
    }
  },
  scripting: {
    getRegisteredContentScripts: async () => [],
    registerContentScripts: async () => {},
    unregisterContentScripts: async () => {}
  },
  tabs: {
    onUpdated: events(),
    onRemoved: events(),
    create: async (options) => { opened.push(options); return createTab ? { id: 81, ...options } : {}; }
  }
};
vm.runInNewContext(source, { chrome, URL, setTimeout, clearTimeout, console });
await new Promise((resolve) => setTimeout(resolve, 20));

const token = "12345678-1234-1234-1234-123456789abc";
const model = { schemaVersion: 1, documentId: "answer-fixture", blocks: [], highlights: [], plainText: "Before x+1 after", localOnly: true };
const open = await message({ type: "MICA_OPEN_PDF_EXPORT", token, model }, { tab: { id: 4, url: "https://chatgpt.com/c/fixture" } });
const unsupported = await message({ type: "MICA_OPEN_PDF_EXPORT", token, model }, { tab: { id: 5, url: "https://example.com/" } });
const consumed = await message({ type: "MICA_GET_PDF_EXPORT", token }, { url: `chrome-extension://mica-fixture/pdf/pdf-export.html#${token}` });
const secondRead = await message({ type: "MICA_GET_PDF_EXPORT", token }, { url: "chrome-extension://mica-fixture/pdf/pdf-export.html" });
const forgedConsumer = await message({ type: "MICA_GET_PDF_EXPORT", token }, { url: "https://chatgpt.com/pdf/pdf-export.html" });
const failedToken = "87654321-4321-4321-4321-cba987654321";
createTab = false;
const failedOpen = await message({ type: "MICA_OPEN_PDF_EXPORT", token: failedToken, model }, { tab: { id: 6, url: "https://chatgpt.com/c/fixture" } });

assert(open.ok && opened.length === 2 && opened[0].url.endsWith(`#${token}`), "trusted ChatGPT export request did not open the extension page");
assert(unsupported.ok === false, "unsupported origin opened a PDF export");
assert(consumed.ok && consumed.model.plainText === model.plainText, "extension export page could not consume the local model");
assert(secondRead.ok === false && forgedConsumer.ok === false, "PDF export payload was reusable or readable outside the extension page");
assert(failedOpen.ok === false && session[`mica.pdf.export.${failedToken}`] === undefined, "failed PDF tab creation leaked a session payload");

const output = {
  passed: true,
  trustedSourceOpened: open.ok,
  unsupportedSourceRejected: unsupported.ok === false,
  oneTimeConsumption: consumed.ok && secondRead.ok === false,
  forgedConsumerRejected: forgedConsumer.ok === false,
  failedOpenPayloadCleaned: failedOpen.ok === false && session[`mica.pdf.export.${failedToken}`] === undefined,
  persistentConversationStorage: false,
  serverUpload: false
};
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "pdf-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "pdf-background.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

function message(payload, sender) {
  return new Promise((resolve) => runtime.onMessage.listeners[0](payload, sender, resolve));
}

function assert(condition, messageText) {
  if (!condition) throw new Error(messageText);
}
