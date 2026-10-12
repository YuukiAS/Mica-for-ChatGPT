const title = document.getElementById("view-title");
const build = document.getElementById("qa-build");
const adapter = document.getElementById("qa-adapter");
const contract = document.getElementById("qa-contract");
const rows = document.getElementById("capability-rows");
const refreshButton = document.getElementById("refresh-compatibility");
const focusedButton = document.getElementById("run-focused-checks");
const exportButton = document.getElementById("export-evidence");
const operationStatus = document.getElementById("qa-operation-status");
let latestReport = null;

title.focus();
refreshButton.addEventListener("click", refresh);
focusedButton.addEventListener("click", runFocusedChecks);
exportButton.addEventListener("click", exportEvidence);
void refresh();

async function refresh() {
  setBusy(true);
  operationStatus.textContent = "Refreshing compatibility…";
  const response = await sendToActiveTab({ type: "MICA_QA_EXPORT" });
  latestReport = response?.report || null;
  render(latestReport);
  operationStatus.textContent = latestReport ? "Compatibility refreshed" : "Couldn’t reach this page";
  setBusy(false);
}

function render(report) {
  const manifest = chrome.runtime.getManifest();
  build.textContent = `${manifest.version_name || manifest.version} · ${report?.candidate?.buildLabel || "unavailable"}`;
  adapter.textContent = report?.runtime?.adapterProducer || "unavailable";
  contract.textContent = report?.candidate?.contractHash || "unavailable";
  rows.replaceChildren();
  for (const capability of report?.page?.compatibility?.capabilities || []) {
    const row = document.createElement("div");
    row.className = "qa-capability";
    const name = document.createElement("span");
    name.textContent = capability.capabilityId;
    const badge = document.createElement("span");
    badge.className = `status-badge ${capability.status === "UNKNOWN" ? "unknown" : ""}`;
    badge.textContent = capability.status;
    row.append(name, badge);
    if (capability.status === "UNKNOWN") {
      const help = document.createElement("small");
      help.textContent = "This capability stays off because its structure is not confirmed.";
      row.append(help);
    }
    rows.append(row);
  }
  if (!rows.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "qa-help";
    empty.textContent = "No capability report is available for this page.";
    rows.append(empty);
  }
}

function runFocusedChecks() {
  const checks = [
    /^[0-9a-f]{64}$/.test(latestReport?.candidate?.contractHash || ""),
    latestReport?.runtime?.adapterProducer === "MicaChatGPTAdapter",
    (latestReport?.page?.compatibility?.capabilities || []).every((item) => ["EXACT", "COMPATIBLE", "UNKNOWN"].includes(item.status)),
    latestReport?.privacy?.conversationTextIncluded === false,
    latestReport?.privacy?.rawDomIncluded === false
  ];
  operationStatus.textContent = checks.every(Boolean) ? "Focused checks passed" : "Some checks need attention";
}

function exportEvidence() {
  if (!latestReport) {
    operationStatus.textContent = "Refresh compatibility first";
    return;
  }
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(latestReport, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `mica-evidence-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  operationStatus.textContent = "Sanitized evidence exported";
}

function setBusy(value) {
  refreshButton.disabled = value;
  focusedButton.disabled = value;
  exportButton.disabled = value;
}

async function sendToActiveTab(message) {
  const tab = await new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
  if (!tab?.id) return null;
  return new Promise((resolve) => chrome.tabs.sendMessage(tab.id, message, (response) => resolve(chrome.runtime.lastError ? null : response)));
}
