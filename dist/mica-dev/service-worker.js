chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ schemaVersion: 0 }, (state) => {
    if ((state.schemaVersion || 0) >= 1) return;
    chrome.storage.local.set({
      schemaVersion: 1,
      enabled: true,
      copyExport: true,
      reliability: true,
      pageIntegration: true
    });
  });
});
