const DEV_BUILD = true;
const title = document.getElementById("view-title");
const summary = document.getElementById("compatibility-summary");
const selfCheck = document.getElementById("self-check");
const exportBundle = document.getElementById("export-bundle");
const operationStatus = document.getElementById("operation-status");
const qaLink = document.getElementById("troubleshooting-qa-link");

title.focus();
qaLink.hidden = !DEV_BUILD;
selfCheck.addEventListener("click", runSelfCheck);
exportBundle.addEventListener("click", exportDiagnosticBundle);
void refreshSummary();

async function refreshSummary() {
  const response = await sendToActiveTab({ type: "MICA_GET_STATUS" });
  summary.textContent = summaryFor(response?.status?.state);
  return response;
}

async function runSelfCheck() {
  selfCheck.disabled = true;
  operationStatus.textContent = "Checking Mica and this page…";
  const response = await refreshSummary();
  if (!response?.status) operationStatus.textContent = "Couldn’t complete the self-check. Try again.";
  else if (["unknown", "compatible"].includes(response.status.state)) operationStatus.textContent = "Some checks need attention";
  else operationStatus.textContent = "Self-check complete";
  selfCheck.disabled = false;
}

async function exportDiagnosticBundle() {
  exportBundle.disabled = true;
  operationStatus.textContent = "Preparing diagnostic bundle…";
  const response = await sendToActiveTab({ type: "MICA_QA_EXPORT" });
  if (!response?.report) {
    operationStatus.textContent = "Couldn’t complete the self-check. Try again.";
  } else {
    downloadJson(response.report, `mica-diagnostic-${Date.now()}.json`);
    operationStatus.textContent = "Diagnostic bundle exported";
  }
  exportBundle.disabled = false;
}

function summaryFor(state) {
  if (state === "exact") return "Ready on this page";
  if (state === "compatible") return "Ready with limited support";
  if (state === "disabled") return "Mica is off";
  if (state === "unknown") return "Compatibility unknown";
  return "Page unavailable";
}

function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function sendToActiveTab(message) {
  const tab = await new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
  if (!tab?.id) return null;
  return new Promise((resolve) => chrome.tabs.sendMessage(tab.id, message, (response) => resolve(chrome.runtime.lastError ? null : response)));
}
