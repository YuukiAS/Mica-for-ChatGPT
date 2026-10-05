const DEFAULT_SETTINGS = { enabled: true, copyExport: true, reliability: true, pageIntegration: true };
const elements = {
  enabled: document.getElementById("enabled"),
  copyExport: document.getElementById("copyExport"),
  reliability: document.getElementById("reliability"),
  pageIntegration: document.getElementById("pageIntegration"),
  pageStatus: document.getElementById("pageStatus"),
  copyStatus: document.getElementById("copyStatus"),
  reliabilityStatus: document.getElementById("reliabilityStatus"),
  integrationStatus: document.getElementById("integrationStatus"),
  copyMarkdown: document.getElementById("copyMarkdown"),
  feedback: document.getElementById("feedback"),
  version: document.getElementById("version")
};
let currentStatus = null;

initialize();

async function initialize() {
  const manifest = chrome.runtime.getManifest();
  elements.version.textContent = `v${manifest.version_name || manifest.version}`;
  const stored = await getStorage(DEFAULT_SETTINGS);
  applySettings(stored);
  currentStatus = await sendToActiveTab({ type: "MICA_GET_PRODUCT_STATUS" });
  if (currentStatus?.settings) applySettings(currentStatus.settings);
  render(currentStatus);
}

for (const key of ["enabled", "copyExport", "reliability", "pageIntegration"]) {
  elements[key].addEventListener("change", saveSettings);
}
elements.copyMarkdown.addEventListener("click", copyMarkdown);

async function saveSettings() {
  const next = {
    enabled: elements.enabled.checked,
    copyExport: elements.copyExport.checked,
    reliability: elements.reliability.checked,
    pageIntegration: elements.pageIntegration.checked
  };
  await setStorage(next);
  currentStatus = await sendToActiveTab({ type: "MICA_SET_SETTINGS", settings: next });
  render(currentStatus);
}

async function copyMarkdown() {
  setFeedback("Copying…", "pending");
  const result = await sendToActiveTab({ type: "MICA_SERIALIZE_ACTIVE_ANSWER" });
  if (!result?.ok || !result.markdown) {
    setFeedback("Copy unavailable on this answer.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(result.markdown);
    setFeedback("Copied as Markdown.", "success");
  } catch (_error) {
    setFeedback("Clipboard access was blocked. Try again.", "error");
  }
}

function render(status) {
  const active = elements.enabled.checked;
  elements.pageStatus.textContent = !status?.supported ? "Unavailable on this page" : active ? "Ready on this page" : "Paused";
  elements.copyMarkdown.disabled = !active || !elements.copyExport.checked || !status?.copy?.available;
  elements.copyStatus.textContent = !active || !elements.copyExport.checked
    ? "Paused"
    : status?.copy?.available ? "Ready for the latest answer" : "Open an answer to copy it.";
  const delivery = status?.reliability?.state;
  elements.reliabilityStatus.textContent = !active || !elements.reliability.checked
    ? "Paused"
    : reliabilityLabel(delivery, status?.reliability?.recoveryOffered);
  elements.integrationStatus.textContent = !active || !elements.pageIntegration.checked
    ? "Paused"
    : status?.pageIntegration === "integrated" ? "Integrated with this page" : "Native handling";
  document.documentElement.dataset.enabled = active ? "true" : "false";
}

function reliabilityLabel(state, recoveryOffered) {
  if (recoveryOffered && state === "ghost_send_suspected") return "Message delivery needs attention";
  if (recoveryOffered && state === "fake_waiting_suspected") return "Response progress needs attention";
  if (recoveryOffered && state === "generation_error_recovery_available") return "Response recovery available";
  if (["awaiting_user_commit", "user_committed", "assistant_generating"].includes(state)) return "Following the current response";
  return "No issues detected";
}

function applySettings(settings) {
  for (const key of ["enabled", "copyExport", "reliability", "pageIntegration"]) {
    elements[key].checked = settings[key] !== false;
  }
}

function setFeedback(message, kind) {
  elements.feedback.textContent = message;
  elements.feedback.dataset.kind = kind;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  return new Promise((resolve) => chrome.tabs.sendMessage(tab.id, message, (response) => resolve(chrome.runtime.lastError ? null : response)));
}

function getActiveTab() {
  return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null)));
}

function getStorage(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, (items) => resolve(items || defaults)));
}

function setStorage(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}
