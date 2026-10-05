const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const status = document.getElementById("status");
let targetTabId = null;

startButton.addEventListener("click", startCheck);
stopButton.addEventListener("click", stopCheck);

async function startCheck() {
  setBusy(true, "Finding an open ChatGPT tab…");
  const target = await findTargetTab();
  if (!target?.id) return setIdle("Open ChatGPT in this window, then try again.");
  const response = await send(target.id, { type: "MICA_CURRENT_UI_CHECK_START" });
  if (!response?.ok) return setIdle("Mica could not start the check on that tab.");
  targetTabId = target.id;
  startButton.disabled = true;
  stopButton.disabled = false;
  status.textContent = "Check running. Return to ChatGPT for one short action, then stop here.";
}

async function stopCheck() {
  if (!targetTabId) return setIdle("No check is running.");
  stopButton.disabled = true;
  status.textContent = "Finishing the report…";
  const response = await send(targetTabId, { type: "MICA_CURRENT_UI_CHECK_STOP" });
  if (!response?.ok || !response.report) return setIdle("The checked tab is no longer available. Start one new check.");
  const envelope = {
    candidate: { version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version },
    report: response.report
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(envelope, null, 2));
    setIdle("Report copied. Paste it into the current Mica task.");
  } catch (_error) {
    setIdle("Clipboard access was blocked. Keep this page open and try again.");
  }
}

async function findTargetTab() {
  const tabs = await new Promise((resolve) => chrome.tabs.query({ currentWindow: true }, resolve));
  for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
    if (!tab.id || tab.url?.startsWith(chrome.runtime.getURL(""))) continue;
    const response = await send(tab.id, { type: "MICA_CURRENT_UI_CHECK_PING" });
    if (response?.supported) return tab;
  }
  return null;
}

function send(tabId, message) {
  return new Promise((resolve) => chrome.tabs.sendMessage(tabId, message, (response) => resolve(chrome.runtime.lastError ? null : response)));
}

function setBusy(disabled, message) {
  startButton.disabled = disabled;
  stopButton.disabled = true;
  status.textContent = message;
}

function setIdle(message) {
  targetTabId = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  status.textContent = message;
}
