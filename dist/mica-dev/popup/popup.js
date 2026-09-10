const DEFAULT_SETTINGS = {
  enabled: true,
  showStatus: true,
  longThreadOptimization: true,
  staleClearRecovery: true,
  connectorContinuity: true,
  sendResidualRecovery: true,
  micaMarkdownCopy: true,
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
  buildLabel: document.getElementById("buildLabel"),
  enabled: document.getElementById("enabled"),
  showStatus: document.getElementById("showStatus"),
  longThreadOptimization: document.getElementById("longThreadOptimization"),
  micaMarkdownCopy: document.getElementById("micaMarkdownCopy"),
  reliabilityEnabled: document.getElementById("reliabilityEnabled"),
  staleClearRecovery: document.getElementById("staleClearRecovery"),
  connectorContinuity: document.getElementById("connectorContinuity"),
  sendResidualRecovery: document.getElementById("sendResidualRecovery"),
  autoDismissKnownInterruptions: document.getElementById("autoDismissKnownInterruptions"),
  recentTurnKeepCount: document.getElementById("recentTurnKeepCount"),
  resetDiagnostics: document.getElementById("resetDiagnostics"),
  diagnosticsStatus: document.getElementById("diagnosticsStatus"),
  runComposerCheck: document.getElementById("runComposerCheck"),
  stopComposerCheck: document.getElementById("stopComposerCheck"),
  copyComposerReport: document.getElementById("copyComposerReport"),
  composerCheckStatus: document.getElementById("composerCheckStatus"),
  prepareFinalSendCheck: document.getElementById("prepareFinalSendCheck")
};

load();

elements.enabled.addEventListener("change", save);
elements.showStatus.addEventListener("change", save);
elements.longThreadOptimization.addEventListener("change", save);
elements.micaMarkdownCopy.addEventListener("change", save);
elements.reliabilityEnabled.addEventListener("change", saveReliabilityGroup);
elements.staleClearRecovery.addEventListener("change", save);
elements.connectorContinuity.addEventListener("change", save);
elements.sendResidualRecovery.addEventListener("change", save);
elements.autoDismissKnownInterruptions.addEventListener("change", save);
elements.recentTurnKeepCount.addEventListener("change", save);
elements.resetDiagnostics.addEventListener("click", () => diagnosticsAction("MICA_DIAGNOSTICS_RESET"));
elements.runComposerCheck.addEventListener("click", () => composerCheckAction("MICA_COMPOSER_GUIDED_START"));
elements.stopComposerCheck.addEventListener("click", () => composerCheckAction("MICA_COMPOSER_GUIDED_STOP"));
elements.copyComposerReport.addEventListener("click", copyComposerReport);
elements.prepareFinalSendCheck.addEventListener("click", prepareFinalSendCheck);

async function load() {
  const manifest = chrome.runtime.getManifest();
  elements.version.textContent = `v${manifest.version_name || manifest.version}`;
  elements.buildLabel.textContent = "v020-convergence.atlas.1";
  const settings = await getStorage(DEFAULT_SETTINGS);
  elements.enabled.checked = settings.enabled;
  elements.showStatus.checked = settings.showStatus;
  elements.longThreadOptimization.checked = settings.longThreadOptimization;
  elements.micaMarkdownCopy.checked = settings.micaMarkdownCopy;
  elements.staleClearRecovery.checked = settings.staleClearRecovery;
  elements.connectorContinuity.checked = settings.connectorContinuity;
  elements.sendResidualRecovery.checked = settings.sendResidualRecovery;
  elements.autoDismissKnownInterruptions.checked = settings.autoDismissKnownInterruptions;
  elements.reliabilityEnabled.checked = settings.staleClearRecovery && settings.connectorContinuity && settings.sendResidualRecovery && settings.autoDismissKnownInterruptions;
  elements.recentTurnKeepCount.value = String(settings.recentTurnKeepCount);

  const response = await requestStatus();
  if (response?.settings) {
    elements.enabled.checked = response.settings.enabled;
    elements.showStatus.checked = response.settings.showStatus;
    elements.longThreadOptimization.checked = response.settings.longThreadOptimization;
    elements.micaMarkdownCopy.checked = response.settings.micaMarkdownCopy;
    elements.staleClearRecovery.checked = response.settings.staleClearRecovery;
    elements.connectorContinuity.checked = response.settings.connectorContinuity;
    elements.sendResidualRecovery.checked = response.settings.sendResidualRecovery;
    elements.autoDismissKnownInterruptions.checked = response.settings.autoDismissKnownInterruptions;
    elements.reliabilityEnabled.checked = response.settings.staleClearRecovery && response.settings.connectorContinuity && response.settings.sendResidualRecovery && response.settings.autoDismissKnownInterruptions;
    elements.recentTurnKeepCount.value = String(response.settings.recentTurnKeepCount);
  }
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
}

async function save() {
  const next = {
    enabled: elements.enabled.checked,
    showStatus: elements.showStatus.checked,
    longThreadOptimization: elements.longThreadOptimization.checked,
    micaMarkdownCopy: elements.micaMarkdownCopy.checked,
    staleClearRecovery: elements.staleClearRecovery.checked,
    connectorContinuity: elements.connectorContinuity.checked,
    sendResidualRecovery: elements.sendResidualRecovery.checked,
    autoDismissKnownInterruptions: elements.autoDismissKnownInterruptions.checked,
    recentTurnKeepCount: clamp(Number(elements.recentTurnKeepCount.value), 4, 20)
  };
  elements.recentTurnKeepCount.value = String(next.recentTurnKeepCount);
  await setStorage(next);
  const response = await sendToActiveTab({ type: "MICA_SET_SETTINGS", settings: next });
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
}

async function saveReliabilityGroup() {
  const checked = elements.reliabilityEnabled.checked;
  elements.staleClearRecovery.checked = checked;
  elements.connectorContinuity.checked = checked;
  elements.sendResidualRecovery.checked = checked;
  elements.autoDismissKnownInterruptions.checked = checked;
  await save();
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

async function prepareFinalSendCheck() {
  const response = await sendToActiveTab({ type: "MICA_PREPARE_FINAL_SEND_CHECK" });
  renderStatus(response?.status, response?.diagnostics, response?.composerGuided);
  const result = response?.oneShot;
  if (!result) {
    elements.composerCheckStatus.textContent = "Open a supported ChatGPT page.";
    return;
  }
  elements.composerCheckStatus.textContent = result.prepared
    ? result.reason
    : result.reason === "COMPOSER_NOT_EMPTY"
      ? "Composer not empty."
      : "Composer not found.";
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
  elements.diagnosticsStatus.textContent = running
    ? `Running · ${Math.round((diagnostics.durationMs || 0) / 1000)}s · ${diagnostics.longTaskCount || 0} long tasks`
    : `Idle · ${diagnostics?.longTaskCount || 0} long tasks · ${diagnostics?.frameStallCount || 0} stalls`;
}

function renderComposerCheck(composerGuided) {
  const running = !!composerGuided?.running;
  const available = composerGuided?.available !== false;
  elements.runComposerCheck.disabled = running || !available;
  elements.stopComposerCheck.disabled = !running;
  elements.prepareFinalSendCheck.disabled = running || !available;
  elements.copyComposerReport.disabled = !available || (!running && !composerGuided?.lastReport);
  if (!available) {
    elements.composerCheckStatus.textContent = "Open a supported ChatGPT page.";
    return;
  }
  if (running) {
    elements.composerCheckStatus.textContent = `Recording · ${composerGuided.sampleCount || 0} samples · ${composerGuided.eventCount || 0} events`;
    return;
  }
  const summary = composerGuided?.lastReport?.summary;
  const send = composerGuided?.lastReport?.sendLifecycle;
  elements.composerCheckStatus.textContent = summary
    ? `Captured · stale clear ${summary.staleTextRestoredAfterClear ? "yes" : "no"} · send ${send?.classification || "not observed"}`
    : "Idle";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.recentTurnKeepCount;
  return Math.min(max, Math.max(min, Math.round(value)));
}
