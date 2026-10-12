const DEV_BUILD = __MICA_DEV_BUILD__;
const enabled = document.getElementById("enabled");
const compatibility = document.querySelector(".compatibility-line");
const compatibilityTitle = document.getElementById("compatibility-title");
const compatibilityDetail = document.getElementById("compatibility-detail");
const pageHealth = document.getElementById("page-health");
const version = document.getElementById("version");
const developerQaLink = document.getElementById("developer-qa-link");

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
  const stored = await getStorage({ enabled: true });
  enabled.checked = stored.enabled;
  enabled.addEventListener("change", onEnabledChange);
  const response = await sendToActiveTab({ type: "MICA_GET_STATUS" });
  if (response?.settings) enabled.checked = response.settings.enabled;
  render(response?.status || unavailableStatus());
}

async function onEnabledChange() {
  enabled.disabled = true;
  const next = { enabled: enabled.checked };
  await setStorage(next);
  const response = await sendToActiveTab({ type: "MICA_SET_SETTINGS", settings: next });
  render(response?.status || (next.enabled ? unavailableStatus() : { state: "disabled" }));
  enabled.disabled = false;
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
