const DEV_BUILD = __MICA_DEV_BUILD__;
let renderedLowMemoryState = "standby";
const enabled = document.getElementById("enabled");
const lowMemory = document.getElementById("low-memory");
const lowMemoryState = document.getElementById("low-memory-state");
const lowMemoryDetail = document.getElementById("low-memory-detail");
const historyActionRow = document.getElementById("history-action-row");
const loadFullHistory = document.getElementById("load-full-history");
const conversationExportDetail = document.getElementById("conversation-export-detail");
const conversationExportState = document.getElementById("conversation-export-state");
const copyConversation = document.getElementById("copy-conversation");
const exportConversationPdf = document.getElementById("export-conversation-pdf");
const compatibility = document.querySelector(".compatibility-line");
const compatibilityTitle = document.getElementById("compatibility-title");
const compatibilityDetail = document.getElementById("compatibility-detail");
const pageHealth = document.getElementById("page-health");
const version = document.getElementById("version");
const developerQaLink = document.getElementById("developer-qa-link");
const settingsLink = document.getElementById("settings-link");

const COPY = {
  loading: ["Checking this page…", ""],
  exact: ["Ready on this page", ""],
  compatible: ["Ready with limited support", "Some actions stay off until compatibility is confirmed."],
  unknown: ["Using ChatGPT normally", "Mica couldn’t safely recognize this page."],
  unsupported: ["Open a ChatGPT conversation", ""],
  disabled: ["Mica is off", "ChatGPT is unchanged."],
  contentUnavailable: ["Couldn’t reach this page", "Reload the page, then try again."]
};

initialize();

async function initialize() {
  const manifest = chrome.runtime.getManifest();
  version.textContent = `v${manifest.version_name || manifest.version}`;
  developerQaLink.hidden = !DEV_BUILD;
  const stored = await getStorage({ enabled: true, lowMemory: true, lowMemoryKeepCount: 40 });
  enabled.checked = stored.enabled;
  lowMemory.checked = stored.lowMemory;
  enabled.addEventListener("change", onEnabledChange);
  lowMemory.addEventListener("change", onLowMemoryChange);
  loadFullHistory.addEventListener("click", onLoadFullHistory);
  copyConversation.addEventListener("click", onCopyConversation);
  exportConversationPdf.addEventListener("click", onExportConversationPdf);
  settingsLink.addEventListener("click", openSettings);
  const response = await sendToActiveTab({ type: "MICA_GET_STATUS" });
  if (response?.settings) enabled.checked = response.settings.enabled;
  if (response?.settings) lowMemory.checked = response.settings.lowMemory;
  render(response?.status || unavailableStatus());
  restoreOriginFocus();
}

function openSettings(event) {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
}

function restoreOriginFocus() {
  const focusId = new URLSearchParams(location.search).get("focus");
  if (focusId === "developer-qa-link") document.getElementById("advanced")?.setAttribute("open", "");
  const target = focusId ? document.getElementById(focusId) : null;
  if (target instanceof HTMLElement && !target.hidden) target.focus();
}

async function onEnabledChange() {
  enabled.disabled = true;
  const next = { enabled: enabled.checked, lowMemory: lowMemory.checked };
  await setStorage(next);
  const response = await sendToActiveTab({ type: "MICA_SET_SETTINGS", settings: next });
  render(response?.status || (next.enabled ? unavailableStatus() : { state: "disabled" }));
  enabled.disabled = false;
}

async function onLowMemoryChange() {
  lowMemory.disabled = true;
  const next = { enabled: enabled.checked, lowMemory: lowMemory.checked };
  await setStorage(next);
  const response = await sendToActiveTab({ type: "MICA_SET_SETTINGS", settings: next });
  render(response?.status || unavailableStatus());
  lowMemory.disabled = false;
}

async function onLoadFullHistory() {
  loadFullHistory.disabled = true;
  const type = renderedLowMemoryState === "full_history_bypass" || renderedLowMemoryState === "reload_required"
    ? "MICA_RESUME_LOW_MEMORY"
    : "MICA_LOAD_FULL_HISTORY";
  const response = await sendToActiveTab({ type });
  if (!response?.ok) {
    lowMemoryState.textContent = response?.reason === "active_draft_or_stream" ? "Finish current work first" : "Reload unavailable";
    loadFullHistory.disabled = false;
  }
}

function render(status) {
  const rawState = status?.state || "contentUnavailable";
  const state = rawState === "content_unavailable" ? "contentUnavailable" : rawState;
  const [title, detail] = COPY[state] || COPY.unknown;
  compatibility.dataset.state = state;
  compatibilityTitle.textContent = title;
  compatibilityDetail.textContent = detail;
  compatibilityDetail.hidden = !detail;
  pageHealth.textContent = state === "exact" ? "No issues" : pageHealthForState(state);
  renderLowMemory(status?.lowMemory);
  renderConversationExport(status?.conversationExport);
}

function renderConversationExport(status) {
  const ready = status?.ready === true;
  copyConversation.disabled = !ready;
  exportConversationPdf.disabled = !ready;
  if (ready) {
    conversationExportState.textContent = `${status.turnCount} turns ready`;
    conversationExportDetail.textContent = "Every turn is present and settled. Export stays on this device.";
    return;
  }
  const reason = status?.reason || "conversation_export_unavailable";
  const copy = {
    copy_export_disabled: ["Off", "Enable Mica and Copy & Export in Settings."],
    load_full_history_required: ["Load full history", "Use Load full history first so Mica can prove the complete range."],
    turn_count_mismatch: ["History incomplete", "Not every proven turn is currently mounted."],
    turn_role_sequence_mismatch: ["History changed", "The mounted turn order no longer matches the completeness proof."],
    conversation_identity_mismatch: ["Conversation changed", "Reload this conversation before exporting."],
    assistant_not_settled: ["Answer in progress", "Wait for the current answer to finish."],
    turn_content_unavailable: ["Content unavailable", "At least one turn cannot be read safely."],
    conversation_completeness_unproven: ["Completeness unproven", "Mica will not guess whether the visible turns are complete."],
    turn_contract_not_exact: ["Structure unsupported", "Mica cannot safely identify every turn on this page."]
  }[reason] || ["Unavailable", "Complete conversation export is not available on this page."];
  conversationExportState.textContent = copy[0];
  conversationExportDetail.textContent = copy[1];
}

async function onCopyConversation() {
  copyConversation.disabled = true;
  conversationExportState.textContent = "Preparing…";
  const response = await sendToActiveTab({ type: "MICA_SERIALIZE_CONVERSATION" });
  if (!response?.ok || typeof response.markdown !== "string") {
    conversationExportState.textContent = exportFailureLabel(response?.reason);
    copyConversation.disabled = false;
    return;
  }
  try {
    await navigator.clipboard.writeText(response.markdown);
    conversationExportState.textContent = `${response.turnCount} turns copied`;
    copyConversation.disabled = false;
  } catch (_error) {
    conversationExportState.textContent = "Clipboard unavailable";
    copyConversation.disabled = false;
  }
}

async function onExportConversationPdf() {
  exportConversationPdf.disabled = true;
  conversationExportState.textContent = "Preparing PDF…";
  const response = await sendToActiveTab({ type: "MICA_EXPORT_CONVERSATION_PDF" });
  if (!response?.ok) {
    conversationExportState.textContent = exportFailureLabel(response?.reason);
    exportConversationPdf.disabled = false;
  }
}

function exportFailureLabel(reason) {
  if (reason === "assistant_not_settled") return "Answer in progress";
  if (reason === "turn_count_mismatch") return "History incomplete";
  if (reason === "unsupported_answer_structure" || String(reason || "").includes("unsupported_answer_structure")) return "Unsupported content";
  if (reason === "conversation_too_large") return "Conversation too large";
  return "Export unavailable";
}

function renderLowMemory(status) {
  renderedLowMemoryState = status?.state || "standby";
  const active = status?.active === true && status?.actualTruncation === true;
  const recoverable = ["restore_required", "reload_required", "full_history_bypass"].includes(status?.state);
  historyActionRow.hidden = !active && !recoverable;
  loadFullHistory.textContent = status?.state === "full_history_bypass" || status?.state === "reload_required" ? "Resume Low Memory" : status?.state === "restore_required" ? "Restore full history" : "Load full history";
  if (status?.state === "restore_required") {
    lowMemoryState.textContent = "Reload to restore";
    lowMemoryDetail.textContent = "Finish the current draft, stream, or dialog, then restore the native full history.";
  } else if (status?.state === "full_history_bypass") {
    lowMemoryState.textContent = "Full history loaded";
    lowMemoryDetail.textContent = "This tab is using ChatGPT’s native full history. Low Memory returns on the next reload or when resumed.";
  } else if (status?.state === "reload_required") {
    lowMemoryState.textContent = "Reload to start";
    lowMemoryDetail.textContent = "Finish the current draft, stream, or dialog, then reload into Low Memory.";
  } else if (!enabled.checked || !lowMemory.checked) {
    lowMemoryState.textContent = "Off";
    lowMemoryDetail.textContent = "ChatGPT keeps its native full history.";
  } else if (active) {
    lowMemoryState.textContent = `${status.keptTurns} kept`;
    lowMemoryDetail.textContent = `${status.removedTurns} older turns are paused locally. Full history is unchanged on ChatGPT.`;
  } else if (status?.state === "degraded") {
    lowMemoryState.textContent = "Native fallback";
    lowMemoryDetail.textContent = "This conversation shape was not safe to window.";
  } else {
    lowMemoryState.textContent = "Ready";
    lowMemoryDetail.textContent = "Keeps 40 recent turns active. Full history stays on ChatGPT.";
  }
}

function pageHealthForState(state) {
  if (state === "disabled") return "Mica is off";
  if (state === "loading") return "Checking…";
  if (state === "compatible") return "Limited support";
  if (state === "unsupported") return "Open ChatGPT";
  if (state === "contentUnavailable") return "Page unavailable";
  return "Compatibility unknown";
}

function unavailableStatus() {
  return { state: "contentUnavailable" };
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  return new Promise((resolve) => chrome.tabs.sendMessage(tab.id, message, (response) => resolve(chrome.runtime.lastError ? null : response)));
}

function getActiveTab() {
  return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
}

function getStorage(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, (items) => resolve(items || defaults)));
}

function setStorage(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}
