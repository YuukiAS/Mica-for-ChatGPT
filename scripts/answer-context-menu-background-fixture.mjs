import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "answer-context-menu-background.js"), "utf8");
const events = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); } });
const runtime = { lastError: null, onInstalled: events(), onStartup: events(), onMessage: events() };
const menus = new Map();
const sent = [];
let refreshCount = 0;
const chrome = {
  runtime,
  contextMenus: {
    onShown: events(),
    onClicked: events(),
    create(properties, callback) { menus.set(properties.id, structuredClone(properties)); callback?.(); },
    remove(id, callback) {
      menus.delete(id);
      for (const [menuId, entry] of [...menus]) if (entry.parentId === id) menus.delete(menuId);
      callback?.();
    },
    update(id, patch, callback) { if (menus.has(id)) menus.set(id, { ...menus.get(id), ...structuredClone(patch) }); callback?.(); },
    refresh() { refreshCount += 1; }
  },
  tabs: {
    onRemoved: events(),
    onUpdated: events(),
    sendMessage(tabId, message, callback) { sent.push({ tabId, message: structuredClone(message) }); callback?.({ ok: true }); }
  }
};

const context = vm.createContext({ chrome, URL, Date, Map, Object, Promise, structuredClone, console });
context.globalThis = context;
vm.runInContext(source, context, { filename: "answer-context-menu-background.js" });
await settle();

assert.equal(menus.size, 4, "answer context menu tree was not created");
assert.equal(menus.get("mica-answer-actions")?.title, "Mica answer actions");
for (const id of ["mica-answer-copy-markdown", "mica-answer-copy-notion", "mica-answer-export-pdf"]) {
  assert.equal(menus.get(id)?.enabled, false, `${id} should start disabled`);
}

const tab = { id: 17, url: "https://chatgpt.com/c/fixture" };
const observedAt = Date.now();
const accepted = await sendRuntimeMessage({
  type: "MICA_ANSWER_CONTEXT",
  context: { turnId: "conversation-turn-2", observedAt, evidenceClass: "EXACT", textIncluded: false }
}, { tab });
assert.equal(JSON.stringify(accepted), JSON.stringify({ ok: true, available: true }));
await chrome.contextMenus.onShown.listeners[0]({ pageUrl: tab.url }, tab);
await settle();
assert.equal(refreshCount, 1, "context menu was not refreshed for the trusted answer target");
assert.equal(menus.get("mica-answer-copy-markdown")?.enabled, true, "trusted answer actions were not enabled");

await chrome.contextMenus.onClicked.listeners[0]({ menuItemId: "mica-answer-copy-markdown", pageUrl: tab.url }, tab);
await settle();
assert.equal(sent.length, 1, "context menu action did not reach the content script");
assert.deepEqual(sent[0], {
  tabId: 17,
  message: {
    type: "MICA_RUN_ANSWER_CONTEXT_ACTION",
    action: "markdown",
    turnId: "conversation-turn-2",
    observedAt,
    evidenceClass: "EXACT"
  }
});
assert.equal(JSON.stringify(sent[0]).includes("Fixture answer"), false, "answer text crossed the context-menu message boundary");

await chrome.contextMenus.onShown.listeners[0]({ pageUrl: tab.url }, tab);
await settle();
assert.equal(menus.get("mica-answer-copy-markdown")?.enabled, false, "consumed answer context remained reusable");

const stale = await sendRuntimeMessage({
  type: "MICA_ANSWER_CONTEXT",
  context: { turnId: "conversation-turn-2", observedAt: Date.now() - 16_000, evidenceClass: "EXACT" }
}, { tab });
assert.equal(JSON.stringify(stale), JSON.stringify({ ok: true, available: false }));
const invalidSource = await sendRuntimeMessage({
  type: "MICA_ANSWER_CONTEXT",
  context: { turnId: "conversation-turn-2", observedAt: Date.now(), evidenceClass: "EXACT" }
}, { tab: { id: 18, url: "https://example.com/" } });
assert.equal(JSON.stringify(invalidSource), JSON.stringify({ ok: false, reason: "invalid_answer_context_source" }));

console.log(JSON.stringify({
  passed: true,
  menuTreeCreated: true,
  trustedContextEnabled: true,
  consumedContextDisabled: true,
  exactActionDispatched: true,
  staleContextRejected: true,
  unsupportedSourceRejected: true,
  conversationTextIncluded: false
}, null, 2));

function sendRuntimeMessage(message, sender) {
  return new Promise((resolve) => {
    const handled = runtime.onMessage.listeners[0](message, sender, resolve);
    if (handled !== true && handled !== false) resolve(undefined);
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
