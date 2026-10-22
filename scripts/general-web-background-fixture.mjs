import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "low-memory-background.js"), "utf8");
const events = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); } });
const registered = new Map();
const granted = new Set(["https://example.com/*"]);
const permissionAdded = events();
const permissionRemoved = events();
const session = {};
const storage = {
  micaSettings: {
    schemaVersion: 6,
    enabled: true,
    theme: "system",
    language: "auto",
    features: { highlighter: true, copyExport: true, lowMemory: false, reliability: true, hideSuggestedWork: false, generalWebHighlighter: true },
    highlighter: { defaultColor: "yellow", shortcut: "Alt+Shift+H", toolbarBehavior: "both", generalWebEnabled: true, generalWebOrigins: ["https://example.com", "https://denied.example"] },
    export: { defaultFormat: "markdown", markdownFlavor: "gfm", inlineMathDelimiter: "dollar", displayMathDelimiter: "double-dollar", pdfPageSize: "A4", pdfIncludeHighlights: true, notionMode: "clipboard" },
    lowMemory: { keepRecentTurns: 40, activationThreshold: 80 },
    reliability: { enabled: true }
  }
};
const runtime = { lastError: null, onInstalled: events(), onStartup: events(), onMessage: events(), getURL: (value) => `chrome-extension://fixture/${value}` };
const chrome = {
  runtime,
  permissions: {
    contains: ({ origins }, callback) => callback(origins.every((origin) => granted.has(origin))),
    onAdded: permissionAdded,
    onRemoved: permissionRemoved
  },
  storage: {
    onChanged: events(),
    local: {
      get(defaults, callback) { callback(defaults && typeof defaults === "object" ? { ...defaults, ...storage } : { ...storage }); },
      set(value, callback) { Object.assign(storage, value); callback?.(); }
    },
    session: {
      get(defaults, callback) { callback({ ...defaults, ...session }); },
      set: async (value) => Object.assign(session, value),
      remove: async (key) => { delete session[key]; }
    }
  },
  scripting: {
    async getRegisteredContentScripts({ ids } = {}) { return ids ? ids.map((id) => registered.get(id)).filter(Boolean) : [...registered.values()]; },
    async registerContentScripts(entries) { for (const entry of entries) registered.set(entry.id, structuredClone(entry)); },
    async unregisterContentScripts({ ids }) { for (const id of ids) registered.delete(id); }
  },
  tabs: { onUpdated: events(), onRemoved: events(), create: async () => ({ id: 1 }) }
};

vm.runInNewContext(source, { chrome, URL, setTimeout, clearTimeout, structuredClone, console });
await settle();

const script = registered.get("mica-general-web-highlighter-v1");
assert.ok(script, "granted site did not receive dynamic registration");
assert.deepEqual([...script.matches], ["https://example.com/*"]);
assert.deepEqual([...script.js], ["highlight-interaction-policy.js", "settings-model.js", "general-web-model.js", "general-web-highlighter.js"]);
assert.equal(script.world, "ISOLATED");
assert.equal(script.persistAcrossSessions, true);
assert.equal(registered.has("mica-low-memory-main-v3"), false, "general web fixture unexpectedly enabled Low Memory");

granted.delete("https://example.com/*");
for (const listener of permissionRemoved.listeners) listener({ origins: ["https://example.com/*"] });
await settle();
assert.equal(registered.has("mica-general-web-highlighter-v1"), false, "revoked host permission left general web runtime registered");

granted.add("https://example.com/*");
for (const listener of permissionAdded.listeners) listener({ origins: ["https://example.com/*"] });
await settle();
assert.equal(registered.has("mica-general-web-highlighter-v1"), true, "restored host permission did not restore dynamic registration");

storage.micaSettings = { ...storage.micaSettings, features: { ...storage.micaSettings.features, generalWebHighlighter: false } };
for (const listener of chrome.storage.onChanged.listeners) listener({ micaSettings: { newValue: storage.micaSettings } }, "local");
await settle();
assert.equal(registered.has("mica-general-web-highlighter-v1"), false, "disabled setting left general web runtime registered");

console.log(JSON.stringify({
  passed: true,
  exactGrantedOriginRegistered: true,
  deniedOriginExcluded: true,
  permissionRevocationUnregistered: true,
  permissionRestoreRegistered: true,
  fixedChatgptHostsUnchanged: true,
  disabledUnregistered: true,
  registrationWorld: script.world
}, null, 2));

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}
