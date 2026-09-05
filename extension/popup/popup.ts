const DEFAULT_SETTINGS = {
  enabled: true,
  showStatus: true,
  autoDismissKnownInterruptions: true,
  recentTurnKeepCount: 8
};

const statusColors = {
  Active: "#16803c",
  "Native virtualization": "#0f766e",
  "Native only": "#2563eb",
  Degraded: "#b45309",
  Disabled: "#737373"
};

const elements = {
  dot: document.getElementById("dot"),
  state: document.getElementById("state"),
  reason: document.getElementById("reason"),
  counts: document.getElementById("counts"),
  version: document.getElementById("version"),
  enabled: document.getElementById("enabled"),
  showStatus: document.getElementById("showStatus"),
  autoDismissKnownInterruptions: document.getElementById("autoDismissKnownInterruptions"),
  recentTurnKeepCount: document.getElementById("recentTurnKeepCount"),
  startDiagnostics: document.getElementById("startDiagnostics"),
  stopDiagnostics: document.getElementById("stopDiagnostics"),
  copyReport: document.getElementById("copyReport"),
  resetDiagnostics: document.getElementById("resetDiagnostics"),
  diagnosticsStatus: document.getElementById("diagnosticsStatus"),
  runComposerCheck: document.getElementById("runComposerCheck"),
  nextComposerCheck: document.getElementById("nextComposerCheck"),
  stopComposerCheck: document.getElementById("stopComposerCheck"),
  copyComposerReport: document.getElementById("copyComposerReport"),
  composerCheckStatus: document.getElementById("composerCheckStatus")
};

load();

elements.enabled.addEventListener("change", save);
elements.showStatus.addEventListener("change", save);
elements.autoDismissKnownInterruptions.addEventListener("change", save);
elements.recentTurnKeepCount.addEventListener("change", save);
elements.startDiagnostics.addEventListener("click", () => diagnosticsAction("MICA_DIAGNOSTICS_START"));
elements.stopDiagnostics.addEventListener("click", () => diagnosticsAction("MICA_DIAGNOSTICS_STOP"));
elements.copyReport.addEventListener("click", copyReport);
elements.resetDiagnostics.addEventListener("click", () => diagnosticsAction("MICA_DIAGNOSTICS_RESET"));
elements.runComposerCheck.addEventListener("click", () => composerCheckAction("MICA_COMPOSER_GUIDED_START"));
elements.nextComposerCheck.addEventListener("click", () => composerCheckAction("MICA_COMPOSER_GUIDED_NEXT"));
elements.stopComposerCheck.addEventListener("click", () => composerCheckAction("MICA_COMPOSER_GUIDED_STOP"));
elements.copyComposerReport.addEventListener("click", copyComposerReport);

async function load() {
  const manifest = chrome.runtime.getManifest();
  elements.version.textContent = `v${manifest.version_name || manifest.version}`;
  const settings = await getStorage(DEFAULT_SETTINGS);
  elements.enabled.checked = settings.enabled;
  elements.showStatus.checked = settings.showStatus;
  elements.autoDismissKnownInterruptions.checked = settings.autoDismissKnownInterruptions;
  elements.recentTurnKeepCount.value = String(settings.recentTurnKeepCount);

  const response = await requestStatus();
  if (response?.settings) {
    elements.enabled.checked = response.settings.enabled;
    elements.showStatus.checked = response.settings.showStatus;
    elements.autoDismissKnownInterruptions.checked = response.settings.autoDismissKnownInterruptions;
    elements.recentTurnKeepCount.value = String(response.settings.recentTurnKeepCount);
  }
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
}

async function save() {
  const next = {
    enabled: elements.enabled.checked,
    showStatus: elements.showStatus.checked,
    autoDismissKnownInterruptions: elements.autoDismissKnownInterruptions.checked,
    recentTurnKeepCount: clamp(Number(elements.recentTurnKeepCount.value), 4, 20)
  };
  elements.recentTurnKeepCount.value = String(next.recentTurnKeepCount);
  await setStorage(next);
  const response = await sendToActiveTab({ type: "MICA_SET_SETTINGS", settings: next });
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
}

async function requestStatus() {
  return sendToActiveTab({ type: "MICA_GET_STATUS" });
}

async function diagnosticsAction(type) {
  const response = await sendToActiveTab({ type });
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
}

async function copyReport() {
  const response = await sendToActiveTab({ type: "MICA_DIAGNOSTICS_COPY_REPORT" });
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
  if (!response?.reportText) {
    elements.diagnosticsStatus.textContent = "No diagnostics report available.";
    return;
  }
  try {
    await navigator.clipboard.writeText(response.reportText);
    elements.diagnosticsStatus.textContent = "Report copied to clipboard.";
  } catch (_error) {
    elements.diagnosticsStatus.textContent = "Clipboard copy failed.";
  }
}

async function composerCheckAction(type) {
  const response = await sendToActiveTab({ type });
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
}

async function copyComposerReport() {
  const response = await sendToActiveTab({ type: "MICA_COMPOSER_GUIDED_COPY_REPORT" });
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
  if (!response?.reportText) {
    elements.composerCheckStatus.textContent = "No composer report available.";
    return;
  }
  try {
    await navigator.clipboard.writeText(response.reportText);
    elements.composerCheckStatus.textContent = "Composer report copied.";
  } catch (_error) {
    elements.composerCheckStatus.textContent = "Clipboard copy failed.";
  }
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      resolve(chrome.runtime.lastError ? null : response);
    });
  });
}

async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

async function getStorage(defaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, (items) => resolve(items || defaults));
  });
}

async function setStorage(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });
}

function renderStatus(status, diagnostics, composerGuided = null) {
  const name = status?.name || "Native only";
  elements.state.textContent = name;
  elements.reason.textContent = status?.reason || "Open a ChatGPT conversation.";
  elements.counts.textContent = formatCounts(status);
  elements.dot.style.background = statusColors[name] || statusColors["Native only"];
  renderDiagnostics(diagnostics);
  renderComposerCheck(composerGuided);
}

function formatCounts(status) {
  const mounted = status?.mountedTurns || 0;
  const optimized = status?.optimizedTurns || 0;
  if (status?.name === "Active") {
    return `${mounted} mounted · ${optimized} optimized`;
  }
  return `${mounted} mounted`;
}

function renderDiagnostics(diagnostics) {
  const running = !!diagnostics?.running;
  elements.startDiagnostics.disabled = running;
  elements.stopDiagnostics.disabled = !running;
  elements.diagnosticsStatus.textContent = running
    ? `Running · ${Math.round((diagnostics.durationMs || 0) / 1000)}s · ${diagnostics.longTaskCount || 0} long tasks`
    : `Idle · ${diagnostics?.longTaskCount || 0} long tasks · ${diagnostics?.frameStallCount || 0} stalls`;
}

function renderComposerCheck(composerGuided) {
  const running = !!composerGuided?.running;
  const available = composerGuided?.available !== false;
  elements.runComposerCheck.disabled = running || !available;
  elements.nextComposerCheck.disabled = !running;
  elements.stopComposerCheck.disabled = !running;
  elements.copyComposerReport.disabled = !available || (!running && !composerGuided?.lastReport);
  if (!available) {
    elements.composerCheckStatus.textContent = "Open a supported ChatGPT page.";
    return;
  }
  if (running) {
    elements.composerCheckStatus.textContent = `Running · step ${(composerGuided.stepIndex || 0) + 1}/${composerGuided.stepCount || 4} · ${composerGuided.sampleCount || 0} samples`;
    return;
  }
  const summary = composerGuided?.lastReport?.summary;
  elements.composerCheckStatus.textContent = summary
    ? `Ready · max missing ${Math.round(summary.maxMissingDurationMs || 0)} ms · stale after send ${summary.staleTextAfterSend ? "yes" : "no"}`
    : "Idle";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.recentTurnKeepCount;
  return Math.min(max, Math.max(min, Math.round(value)));
}
