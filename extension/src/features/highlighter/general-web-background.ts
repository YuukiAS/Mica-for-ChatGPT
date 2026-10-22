(() => {
  const SCRIPT_ID = "mica-general-web-highlighter-v1";
  const SETTINGS_KEY = globalThis.MicaSettingsModel?.storageKey || "micaSettings";
  const SCRIPT_FILES = Object.freeze(["settings-model.js", "general-web-model.js", "general-web-highlighter.js"]);
  let syncQueue = Promise.resolve();

  chrome.runtime.onInstalled.addListener(() => { void syncRegistration(); });
  chrome.runtime.onStartup.addListener(() => { void syncRegistration(); });
  chrome.permissions?.onAdded?.addListener(() => { void syncRegistration(); });
  chrome.permissions?.onRemoved?.addListener(() => { void syncRegistration(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && SETTINGS_KEY in changes) void syncRegistration();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "MICA_GENERAL_WEB_SYNC") return false;
    void syncRegistration().then(sendResponse);
    return true;
  });

  function syncRegistration() {
    syncQueue = syncQueue.then(syncRegistrationNow, syncRegistrationNow);
    return syncQueue;
  }

  async function syncRegistrationNow() {
    const settings = await readSettings();
    const desired = settings.ok ? await grantedPatterns(settings.value) : [];
    try {
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
      const currentMatches = existing[0]?.matches || [];
      if (sameStrings(currentMatches, desired)) {
        return { ok: true, registered: desired.length > 0, matches: desired, failOpen: !settings.ok };
      }
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      if (desired.length) {
        await chrome.scripting.registerContentScripts([{
          id: SCRIPT_ID,
          matches: desired,
          js: [...SCRIPT_FILES],
          runAt: "document_idle",
          world: "ISOLATED",
          persistAcrossSessions: true,
          allFrames: false
        }]);
      }
      return { ok: true, registered: desired.length > 0, matches: desired, failOpen: !settings.ok };
    } catch (error) {
      try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch (_ignored) { /* fail open */ }
      return { ok: false, registered: false, matches: [], failOpen: true, reason: `general_web_registration_failed:${String(error?.message || error || "unknown")}` };
    }
  }

  function readSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [SETTINGS_KEY]: null }, (items) => {
        if (chrome.runtime.lastError || !globalThis.MicaSettingsModel) return resolve({ ok: false, value: null });
        resolve({ ok: true, value: globalThis.MicaSettingsModel.fromStorage(items || {}) });
      });
    });
  }

  async function grantedPatterns(settings) {
    if (!settings.enabled || !settings.features.generalWebHighlighter || !settings.highlighter.generalWebEnabled) return [];
    if (!chrome.permissions?.contains) return [];
    const output = [];
    for (const origin of settings.highlighter.generalWebOrigins) {
      const pattern = globalThis.MicaSettingsModel.toMatchPattern(origin);
      if (!pattern) continue;
      const granted = await new Promise((resolve) => chrome.permissions.contains({ origins: [pattern] }, resolve));
      if (granted) output.push(pattern);
    }
    return [...new Set(output)].sort();
  }

  function sameStrings(left, right) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  }

  globalThis.MicaGeneralWebBackground = Object.freeze({ scriptId: SCRIPT_ID, scriptFiles: SCRIPT_FILES, syncRegistration });
  void syncRegistration();
})();
