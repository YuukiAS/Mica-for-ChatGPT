const DEFAULT_SETTINGS = {
  enabled: true,
  showStatus: true,
  recentTurnKeepCount: 8
};

const statusColors = {
  Active: "#16803c",
  "Native only": "#2563eb",
  Degraded: "#b45309",
  Disabled: "#737373"
};

const elements = {
  dot: document.getElementById("dot"),
  state: document.getElementById("state"),
  reason: document.getElementById("reason"),
  counts: document.getElementById("counts"),
  enabled: document.getElementById("enabled"),
  showStatus: document.getElementById("showStatus"),
  recentTurnKeepCount: document.getElementById("recentTurnKeepCount")
};

load();

elements.enabled.addEventListener("change", save);
elements.showStatus.addEventListener("change", save);
elements.recentTurnKeepCount.addEventListener("change", save);

async function load() {
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
  renderStatus(response?.status);
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
  renderStatus(response?.status);
}

async function requestStatus() {
  return sendToActiveTab({ type: "MICA_GET_STATUS" });
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

function renderStatus(status) {
  const name = status?.name || "Native only";
  elements.state.textContent = name;
  elements.reason.textContent = status?.reason || "Open a ChatGPT conversation.";
  elements.counts.textContent = `${status?.activeTurns || 0} active / ${status?.turns || 0} turns`;
  elements.dot.style.background = statusColors[name] || statusColors["Native only"];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.recentTurnKeepCount;
  return Math.min(max, Math.max(min, Math.round(value)));
}
