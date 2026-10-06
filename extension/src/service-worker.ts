const DEFAULT_SETTINGS = {
  enabled: true,
  copyExport: true,
  reliability: true,
  pageIntegration: true,
  highlighter: true,
  lowMemory: true
};

function migrateState(state = {}) {
  const next = { schemaVersion: 3 };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    next[key] = typeof state[key] === "boolean" ? state[key] : fallback;
  }
  return next;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ schemaVersion: 0, ...DEFAULT_SETTINGS }, (state) => {
    if ((state.schemaVersion || 0) >= 3) return;
    chrome.storage.local.set(migrateState(state));
  });
});

globalThis.MicaServiceWorker = { migrateState };
