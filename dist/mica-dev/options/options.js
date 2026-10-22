const model = globalThis.MicaSettingsModel;
const highlightEngine = globalThis.MicaHighlightEngine;
const form = document.getElementById("settings-form");
const statusNode = document.getElementById("status");
let settings = model.defaults();

initialize();

async function initialize() {
  const manifest = chrome.runtime.getManifest();
  document.getElementById("version").textContent = `v${manifest.version_name || manifest.version}`;
  settings = model.fromStorage(await getStorage(null));
  render(settings);
  form.addEventListener("submit", save);
  document.querySelectorAll("[data-reset]").forEach((button) => button.addEventListener("click", resetSection));
  document.getElementById("restore-defaults").addEventListener("click", restoreDefaults);
  document.getElementById("export-settings").addEventListener("click", exportSettings);
  document.getElementById("import-settings").addEventListener("change", importSettings);
  document.getElementById("clear-recovery-history").addEventListener("click", clearRecoveryHistory);
  document.getElementById("export-highlights").addEventListener("click", exportHighlights);
  document.getElementById("import-highlights").addEventListener("change", importHighlights);
  document.getElementById("clear-highlights").addEventListener("click", clearHighlights);
}

function render(value) {
  const set = (id, next) => { const node = document.getElementById(id); if (node.type === "checkbox") node.checked = !!next; else node.value = next; };
  set("enabled", value.enabled); set("theme", value.theme); set("language", value.language);
  set("feature-highlighter", value.features.highlighter); set("highlight-color", value.highlighter.defaultColor); set("highlight-shortcut", value.highlighter.shortcut); set("general-web", value.features.generalWebHighlighter);
  set("feature-copy-export", value.features.copyExport); set("export-default", value.export.defaultFormat); set("markdown-flavor", value.export.markdownFlavor); set("inline-math", value.export.inlineMathDelimiter); set("display-math", value.export.displayMathDelimiter); set("pdf-page-size", value.export.pdfPageSize); set("pdf-highlights", value.export.pdfIncludeHighlights); set("notion-mode", value.export.notionMode);
  set("feature-low-memory", value.features.lowMemory); set("keep-turns", value.lowMemory.keepRecentTurns); set("low-memory-threshold", value.lowMemory.activationThreshold);
  set("feature-reliability", value.features.reliability); set("stall-watchdog", value.reliability.stallWatchdogEnabled); set("no-progress", value.reliability.noProgressTimeoutSeconds); set("commit-window", value.reliability.commitConfirmationTimeoutSeconds); set("auto-recovery", value.reliability.autoRecoveryEnabled); set("auto-reload", value.reliability.autoReloadEnabled); set("auto-stop", value.reliability.autoStopEnabled); set("max-reloads", value.reliability.maxAutoReloadsPerTurn); set("max-recovery-cycles", value.reliability.maxRecoveryCyclesPerTurn); set("native-stop-settle", value.reliability.nativeStopSettleSeconds); set("reconcile-window", value.reliability.postReloadReconcileTimeoutSeconds); set("max-new-resends", value.reliability.maxAutoNewMessageResends); set("max-assistant-retries", value.reliability.maxAutoAssistantRetries); set("retry-backoff", value.reliability.retryBackoffSeconds); set("snapshot-ttl", value.reliability.recoverySnapshotTtlMinutes); set("safe-read-only", value.reliability.safeReadOnlyToolRecovery); set("resend-policy", value.reliability.resendPolicy); set("recovery-notifications", value.reliability.showRecoveryNotifications); set("recovery-history", value.reliability.recordPrivacySafeRecoveryHistory);
  set("hide-suggested-work", value.features.hideSuggestedWork);
}

function collect() {
  const value = (id) => document.getElementById(id).value;
  const checked = (id) => document.getElementById(id).checked;
  return model.sanitize({
    ...settings,
    enabled: checked("enabled"), theme: value("theme"), language: value("language"),
    features: { ...settings.features, highlighter: checked("feature-highlighter"), copyExport: checked("feature-copy-export"), lowMemory: checked("feature-low-memory"), reliability: checked("feature-reliability"), hideSuggestedWork: checked("hide-suggested-work"), generalWebHighlighter: checked("general-web") },
    highlighter: { ...settings.highlighter, defaultColor: value("highlight-color"), shortcut: value("highlight-shortcut"), generalWebEnabled: checked("general-web") },
    export: { ...settings.export, defaultFormat: value("export-default"), markdownFlavor: value("markdown-flavor"), inlineMathDelimiter: value("inline-math"), displayMathDelimiter: value("display-math"), pdfPageSize: value("pdf-page-size"), pdfIncludeHighlights: checked("pdf-highlights"), notionMode: value("notion-mode") },
    lowMemory: { keepRecentTurns: Number(value("keep-turns")), activationThreshold: Number(value("low-memory-threshold")) },
    reliability: { ...settings.reliability, enabled: checked("feature-reliability"), stallWatchdogEnabled: checked("stall-watchdog"), noProgressTimeoutSeconds: Number(value("no-progress")), commitConfirmationTimeoutSeconds: Number(value("commit-window")), autoRecoveryEnabled: checked("auto-recovery"), autoReloadEnabled: checked("auto-reload"), autoStopEnabled: checked("auto-stop"), maxAutoReloadsPerTurn: Number(value("max-reloads")), maxRecoveryCyclesPerTurn: Number(value("max-recovery-cycles")), nativeStopSettleSeconds: Number(value("native-stop-settle")), postReloadReconcileTimeoutSeconds: Number(value("reconcile-window")), maxAutoNewMessageResends: Number(value("max-new-resends")), maxAutoAssistantRetries: Number(value("max-assistant-retries")), retryBackoffSeconds: Number(value("retry-backoff")), recoverySnapshotTtlMinutes: Number(value("snapshot-ttl")), safeReadOnlyToolRecovery: checked("safe-read-only"), resendPolicy: value("resend-policy"), showRecoveryNotifications: checked("recovery-notifications"), recordPrivacySafeRecoveryHistory: checked("recovery-history"), consequentialActionAutoReplay: false }
  });
}

async function save(event) {
  event.preventDefault();
  settings = collect();
  await setStorage(model.toStorageRecord(settings));
  render(settings);
  showStatus("Saved. Open Mica pages receive the new settings without deleting feature preferences.");
}

function resetSection(event) {
  const section = event.currentTarget.dataset.reset;
  const defaults = model.defaults();
  if (section === "general") settings = { ...settings, enabled: defaults.enabled, theme: defaults.theme, language: defaults.language };
  else if (section === "interface") settings = { ...settings, features: { ...settings.features, hideSuggestedWork: defaults.features.hideSuggestedWork } };
  else if (section === "lowMemory") settings = { ...settings, features: { ...settings.features, lowMemory: defaults.features.lowMemory }, lowMemory: defaults.lowMemory };
  else if (section === "export") settings = { ...settings, features: { ...settings.features, copyExport: defaults.features.copyExport }, export: defaults.export };
  else if (section === "highlighter") settings = { ...settings, features: { ...settings.features, highlighter: defaults.features.highlighter, generalWebHighlighter: defaults.features.generalWebHighlighter }, highlighter: defaults.highlighter };
  else if (section === "reliability") settings = { ...settings, features: { ...settings.features, reliability: defaults.features.reliability }, reliability: defaults.reliability };
  settings = model.sanitize(settings);
  render(settings);
  showStatus("Section reset. Select Save settings to apply.");
}

function restoreDefaults() {
  settings = model.defaults();
  render(settings);
  showStatus("All defaults restored in this form. Select Save settings to apply.");
}

function exportSettings() {
  settings = collect();
  const blob = new Blob([model.exportJson(settings)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "mica-settings.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  showStatus("Settings exported. No conversation data was included.");
}

async function importSettings(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const imported = model.importJson(await file.text());
  event.target.value = "";
  if (!imported.ok) return showStatus("Import failed: invalid Mica settings JSON.");
  settings = imported.settings;
  render(settings);
  showStatus("Settings imported into this form. Select Save settings to apply.");
}

async function clearRecoveryHistory() {
  await new Promise((resolve) => chrome.storage.local.remove("micaRecoveryHistoryV1", resolve));
  showStatus("Privacy-safe recovery history cleared.");
}

async function exportHighlights() {
  const stored = await getStorage({ [highlightEngine.storeKey]: [] });
  const blob = new Blob([highlightEngine.exportJson(stored[highlightEngine.storeKey])], { type: "application/json" });
  downloadBlob(blob, "mica-highlights.json");
  showStatus("Highlights exported. The file stays on this device unless you share it.");
}

async function importHighlights(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const imported = highlightEngine.importJson(await file.text());
  event.target.value = "";
  if (!imported.ok) return showStatus("Import failed. Choose a valid Mica highlights file.");
  const stored = await getStorage({ [highlightEngine.storeKey]: [] });
  const records = highlightEngine.mergeRecords(stored[highlightEngine.storeKey], imported.records);
  await setStorage({ [highlightEngine.storeKey]: records });
  showStatus(`Imported ${imported.records.length} highlight records${imported.rejectedCount ? `; skipped ${imported.rejectedCount} invalid records` : ""}.`);
}

async function clearHighlights() {
  if (!globalThis.confirm("Clear all local highlights? This cannot be undone.")) return;
  await new Promise((resolve) => chrome.storage.local.remove(highlightEngine.storeKey, resolve));
  showStatus("All local highlight records cleared.");
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function getStorage(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, (items) => resolve(items || {})));
}

function setStorage(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function showStatus(message) {
  statusNode.textContent = message;
}
