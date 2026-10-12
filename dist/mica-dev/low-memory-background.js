const SCRIPT_ID = "mica-low-memory-main-v3";
const MATCHES = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const MODE_KEY = "mica.lowMemory.tabModes.v3";
const DEFAULTS = Object.freeze({ enabled: true, lowMemory: true });
const pendingFullHistory = new Set();
let registrationQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => { void syncRegistration(); });
chrome.runtime.onStartup.addListener(() => { void syncRegistration(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("enabled" in changes || "lowMemory" in changes)) void syncRegistration();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && !pendingFullHistory.has(tabId)) void clearCompletedTabMode(tabId);
  if (changeInfo.status === "complete") void finishFullHistoryReload(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => { pendingFullHistory.delete(tabId); void clearTabMode(tabId); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MICA_LOW_MEMORY_SYNC") {
    void syncRegistration().then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_LOW_MEMORY_GET_TAB_MODE") {
    void getTabMode(sender.tab?.id).then((mode) => sendResponse({ ok: true, mode }));
    return true;
  }
  if (message?.type === "MICA_LOW_MEMORY_PREPARE_FULL_HISTORY") {
    void prepareFullHistory(sender.tab).then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_LOW_MEMORY_RESUME_WINDOWING") {
    void resumeWindowing(sender.tab).then(sendResponse);
    return true;
  }
  return false;
});

function syncRegistration() {
  registrationQueue = registrationQueue.then(syncRegistrationNow, syncRegistrationNow);
  return registrationQueue;
}

async function syncRegistrationNow() {
  const settings = await readSettings();
  const modes = await readModes();
  const fullHistoryReloadPending = Object.values(modes).includes("preparing_full_history");
  const shouldRegister = settings.ok && settings.value.enabled && settings.value.lowMemory && !fullHistoryReloadPending;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (shouldRegister && existing.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID, matches: MATCHES, js: ["low-memory-core.js", "low-memory-page.js"],
        runAt: "document_start", world: "MAIN", persistAcrossSessions: true
      }]);
    } else if (!shouldRegister && existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
    return { ok: true, registered: shouldRegister, failOpen: !settings.ok };
  } catch (error) {
    try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch (_ignored) { /* fail open */ }
    return { ok: false, registered: false, reason: `registration_failed:${String(error?.message || error || "unknown")}`, failOpen: true };
  }
}

async function prepareFullHistory(tab) {
  if (!isSupportedTab(tab)) return { ok: false, reason: "unsupported_tab" };
  try {
    await setTabMode(tab.id, "preparing_full_history");
    pendingFullHistory.add(tab.id);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return { ok: true, mode: "full_history_bypass", reloadRequired: true };
  } catch (error) {
    pendingFullHistory.delete(tab.id);
    await clearTabMode(tab.id);
    return { ok: false, reason: `registration_failed:${String(error?.message || error || "unknown")}` };
  }
}

async function resumeWindowing(tab) {
  if (!isSupportedTab(tab)) return { ok: false, reason: "unsupported_tab" };
  await clearTabMode(tab.id);
  const synced = await syncRegistration();
  return synced.ok && synced.registered
    ? { ok: true, mode: "windowing", reloadRequired: true }
    : { ok: false, reason: synced.reason || "windowing_disabled" };
}

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULTS, (items) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, value: { enabled: false, lowMemory: false } });
      resolve({ ok: true, value: { enabled: items?.enabled !== false, lowMemory: items?.lowMemory !== false } });
    });
  });
}

async function getTabMode(tabId) {
  if (!Number.isInteger(tabId)) return "native";
  const modes = await readModes();
  const mode = modes[String(tabId)] || "windowing";
  return mode === "preparing_full_history" ? "full_history_bypass" : mode;
}

async function finishFullHistoryReload(tabId) {
  const modes = await readModes();
  if (modes[String(tabId)] !== "preparing_full_history" && !pendingFullHistory.has(tabId)) return;
  pendingFullHistory.delete(tabId);
  modes[String(tabId)] = "full_history_bypass";
  await chrome.storage.session.set({ [MODE_KEY]: modes });
  await syncRegistration();
}

async function clearCompletedTabMode(tabId) {
  const modes = await readModes();
  if (modes[String(tabId)] === "preparing_full_history") return;
  await clearTabMode(tabId);
}

async function setTabMode(tabId, mode) {
  const modes = await readModes();
  modes[String(tabId)] = mode;
  await chrome.storage.session.set({ [MODE_KEY]: modes });
}

async function clearTabMode(tabId) {
  if (!Number.isInteger(tabId)) return;
  const modes = await readModes();
  delete modes[String(tabId)];
  await chrome.storage.session.set({ [MODE_KEY]: modes });
}

function readModes() {
  return new Promise((resolve) => {
    chrome.storage.session.get({ [MODE_KEY]: {} }, (items) => {
      if (chrome.runtime.lastError) return resolve({});
      const value = items?.[MODE_KEY];
      resolve(value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});
    });
  });
}

function isSupportedTab(tab) {
  if (!Number.isInteger(tab?.id) || typeof tab?.url !== "string") return false;
  try { return ["chatgpt.com", "chat.openai.com"].includes(new URL(tab.url).hostname); }
  catch (_error) { return false; }
}

void syncRegistration();
