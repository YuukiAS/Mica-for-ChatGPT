const DEFAULT_SETTINGS = {
  enabled: true,
  showStatus: true,
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
  recentTurnKeepCount: document.getElementById("recentTurnKeepCount"),
  startDiagnostics: document.getElementById("startDiagnostics"),
  stopDiagnostics: document.getElementById("stopDiagnostics"),
  copyReport: document.getElementById("copyReport"),
  resetDiagnostics: document.getElementById("resetDiagnostics"),
  diagnosticsStatus: document.getElementById("diagnosticsStatus")
};

load();

elements.enabled.addEventListener("change", save);
elements.showStatus.addEventListener("change", save);
elements.recentTurnKeepCount.addEventListener("change", save);
elements.startDiagnostics.addEventListener("click", () => diagnosticsAction("MICA_DIAGNOSTICS_START"));
elements.stopDiagnostics.addEventListener("click", () => diagnosticsAction("MICA_DIAGNOSTICS_STOP"));
elements.copyReport.addEventListener("click", copyReport);
elements.resetDiagnostics.addEventListener("click", () => diagnosticsAction("MICA_DIAGNOSTICS_RESET"));

async function load() {
  const manifest = chrome.runtime.getManifest();
  elements.version.textContent = `v${manifest.version_name || manifest.version}`;
  const settings = await getStorage(DEFAULT_SETTINGS);
  elements.enabled.checked = settings.enabled;
  elements.showStatus.checked = settings.showStatus;
  elements.recentTurnKeepCount.value = String(settings.recentTurnKeepCount);

  const response = await requestStatus();
  if (response?.settings) {
    elements.enabled.checked = response.settings.enabled;
    elements.showStatus.checked = response.settings.showStatus;
    elements.recentTurnKeepCount.value = String(response.settings.recentTurnKeepCount);
  }
  renderStatus(response?.status, response?.diagnostics);
}

async function save() {
  const next = {
    enabled: elements.enabled.checked,
    showStatus: elements.showStatus.checked,
    recentTurnKeepCount: clamp(Number(elements.recentTurnKeepCount.value), 4, 20)
  };
  elements.recentTurnKeepCount.value = String(next.recentTurnKeepCount);
  await setStorage(next);
  const response = await sendToActiveTab({ type: "MICA_SET_SETTINGS", settings: next });
  renderStatus(response?.status, response?.diagnostics);
}

async function requestStatus() {
  return sendToActiveTab({ type: "MICA_GET_STATUS" });
}

async function diagnosticsAction(type) {
  const response = await sendToActiveTab({ type });
  renderStatus(response?.status, response?.diagnostics);
}

async function copyReport() {
  const response = await sendToActiveTab({ type: "MICA_DIAGNOSTICS_COPY_REPORT" });
  renderStatus(response?.status, response?.diagnostics);
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

function renderStatus(status, diagnostics) {
  const name = status?.name || "Native only";
  elements.state.textContent = name;
  elements.reason.textContent = status?.reason || "Open a ChatGPT conversation.";
  elements.counts.textContent = formatCounts(status);
  elements.dot.style.background = statusColors[name] || statusColors["Native only"];
  renderDiagnostics(diagnostics);
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

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.recentTurnKeepCount;
  return Math.min(max, Math.max(min, Math.round(value)));
}
