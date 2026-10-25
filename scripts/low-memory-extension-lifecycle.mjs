import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  installNetworkGuard,
  launchInstalledExtension,
  repositoryRoot,
  setActiveTab,
  waitForExtensionWorker,
  waitForMicaContentRuntime,
} from "./extension-browser-harness.mjs";
import { BUILD_LABEL, MACHINE_VERSION } from "./release-config.mjs";

const root = repositoryRoot();
const fixture = await readFile(path.join(root, "tests", "fixtures", "mica-low-memory-host.html"), "utf8");
const firstUrl = "https://chatgpt.com/c/low-memory-lifecycle-a";
const secondUrl = "https://chatgpt.com/c/low-memory-lifecycle-b";
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
await mkdir(evidenceDir, { recursive: true });

const launched = await launchInstalledExtension({ viewport: { width: 1100, height: 780 }, profilePrefix: "mica-low-memory-lifecycle-" });
const unexpectedRequests = await installNetworkGuard(launched.context, new Map([
  [firstUrl, { status: 200, contentType: "text/html", body: fixture }],
  [secondUrl, { status: 200, contentType: "text/html", body: fixture }],
]));
const pageErrors = [];

try {
  const disabledRegistration = await configureLowMemory(launched.worker, false);
  assert(disabledRegistration.synced.registered === false && disabledRegistration.scripts.length === 0, "Low Memory off did not unregister the MAIN-world script");

  const enabledRegistration = await configureLowMemory(launched.worker, true);
  assertMainWorldRegistration(enabledRegistration);

  const page = await launched.context.newPage();
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  await page.goto(firstUrl, { waitUntil: "load" });
  const firstRuntime = await waitForMicaContentRuntime(launched.worker, firstUrl);
  assert(firstRuntime.response.status.version === MACHINE_VERSION, "lifecycle host loaded a different runtime version");
  await waitForMappingNodes(page, 41);
  const windowedStatus = await waitForLowMemoryState(launched.worker, firstUrl, "active");
  assert(windowedStatus.lowMemory.actualTruncation === true && windowedStatus.lowMemory.totalTurns === 120 && windowedStatus.lowMemory.keptTurns === 40, "initial navigation did not apply measured client-history truncation");
  assert(windowedStatus.lowMemory.completenessProof?.expectedTurnCount === 120, "windowed page did not publish a completeness proof");

  await setActiveTab(launched.worker, firstRuntime.tabId);
  const popup = await launched.context.newPage();
  await popup.goto(`chrome-extension://${launched.extensionId}/popup/index.html`, { waitUntil: "load" });
  await setActiveTab(launched.worker, firstRuntime.tabId);
  await popup.reload({ waitUntil: "load" });
  await popup.locator("#history-action-row").waitFor({ state: "visible" });
  assert(await popup.locator("#load-full-history").innerText() === "Load full history", "popup did not expose the full-history action while windowed");
  const fullHistoryReload = page.waitForEvent("load", { timeout: 10_000 });
  await popup.locator("#load-full-history").click();
  await fullHistoryReload;
  await waitForMappingNodes(page, 121);
  const bypassRuntime = await waitForMicaContentRuntime(launched.worker, firstUrl);
  const bypassStatus = bypassRuntime.response.status;
  assert(bypassStatus.lowMemory.state === "full_history_bypass" && bypassStatus.lowMemory.active === false, "full-history reload did not enter the tab-scoped bypass state");
  assert(bypassStatus.lowMemory.completenessProof?.expectedTurnCount === 120, "full-history bypass lost its completeness proof");
  const postBypassRegistration = await registrationSnapshot(launched.worker);
  assertMainWorldRegistration({ synced: { registered: true }, scripts: postBypassRegistration });

  await setActiveTab(launched.worker, bypassRuntime.tabId);
  await popup.reload({ waitUntil: "load" });
  await popup.locator("#history-action-row").waitFor({ state: "visible" });
  assert(await popup.locator("#load-full-history").innerText() === "Resume Low Memory", "popup did not expose the resume action in bypass mode");
  const resumeReload = page.waitForEvent("load", { timeout: 10_000 });
  await popup.locator("#load-full-history").click();
  await resumeReload;
  await waitForMappingNodes(page, 41);
  const resumedStatus = await waitForLowMemoryState(launched.worker, firstUrl, "active");
  assert(resumedStatus.lowMemory.actualTruncation === true, "resuming Low Memory did not restore windowing");

  const cdp = await launched.context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  const restartedWorkerPromise = launched.context.waitForEvent("serviceworker", { timeout: 10_000 }).catch(() => null);
  await cdp.send("ServiceWorker.stopAllWorkers");
  await page.reload({ waitUntil: "load" });
  await waitForMappingNodes(page, 41);
  const restartedWorker = await restartedWorkerPromise || await waitForExtensionWorker(launched.context);
  const restartedRuntime = await waitForMicaContentRuntime(restartedWorker, firstUrl);
  assert(restartedRuntime.response.settings.lowMemory === true, "Low Memory setting did not survive service-worker restart");
  assertMainWorldRegistration({ synced: { registered: true }, scripts: await registrationSnapshot(restartedWorker) });

  await page.goto(secondUrl, { waitUntil: "load" });
  await waitForMappingNodes(page, 41);
  const navigatedRuntime = await waitForMicaContentRuntime(restartedWorker, secondUrl);
  assert(navigatedRuntime.response.status.lowMemory.active === true, "Low Memory did not remain active after conversation navigation");

  const disableRestoreReload = page.waitForEvent("load", { timeout: 10_000 });
  const finalDisabled = await configureLowMemory(restartedWorker, false);
  assert(finalDisabled.synced.registered === false && finalDisabled.scripts.length === 0, "dynamic Low Memory disable did not unregister the MAIN-world script");
  await disableRestoreReload;
  await waitForMappingNodes(page, 121);
  const disabledRuntime = await waitForMicaContentRuntime(restartedWorker, secondUrl);
  assert(disabledRuntime.response.settings.lowMemory === false, "disabled state did not reach the content runtime");

  const output = {
    schema: "mica.low-memory-extension-lifecycle.v1",
    passed: true,
    generatedAt: new Date().toISOString(),
    candidate: { version: MACHINE_VERSION, buildLabel: BUILD_LABEL },
    execution: {
      browser: await page.evaluate(() => navigator.userAgent),
      actualManifest: true,
      actualMainWorldRegistration: true,
      actualContentScript: true,
      actualServiceWorker: true,
      actualPopupAction: true,
      actualStorage: true,
      networkGuard: "deny-unmatched",
      unexpectedRequestCount: unexpectedRequests.length,
    },
    lifecycle: {
      dynamicDisableBeforeNavigation: true,
      dynamicEnableBeforeNavigation: true,
      registeredAtDocumentStart: true,
      reactRouterStreamWindowed: true,
      originalMappingNodes: 121,
      windowedMappingNodes: 41,
      fullHistoryMappingNodes: 121,
      actualClientHistoryTruncation: true,
      completenessProofPreserved: true,
      realPopupFullHistoryAction: true,
      realPopupResumeAction: true,
      conversationNavigation: true,
      serviceWorkerRestart: true,
      persistentRegistrationRecovered: true,
      dynamicDisableAfterNavigation: true,
      failOpenAfterDisable: true,
    },
    privacy: { normalEdgeProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequests: 0, conversationTextStoredByBackground: false },
    pageErrors,
  };
  assert(unexpectedRequests.length === 0, `unmatched network requests: ${JSON.stringify(unexpectedRequests)}`);
  assert(pageErrors.length === 0, `host page errors: ${pageErrors.join(" | ")}`);
  await writeFile(path.join(evidenceDir, "low-memory-extension-lifecycle.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await launched.close();
}

async function configureLowMemory(worker, enabled) {
  return worker.evaluate(async (nextEnabled) => {
    const settings = globalThis.MicaSettingsModel.defaults();
    settings.enabled = true;
    settings.features.lowMemory = nextEnabled;
    settings.lowMemory.keepRecentTurns = 40;
    settings.lowMemory.activationThreshold = 80;
    await chrome.storage.local.clear();
    await chrome.storage.local.set(globalThis.MicaSettingsModel.toStorageRecord(settings));
    const synced = await syncRegistration();
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: ["mica-low-memory-main-v3"] });
    return { synced, scripts };
  }, enabled);
}

function registrationSnapshot(worker) {
  return worker.evaluate(async () => chrome.scripting.getRegisteredContentScripts({ ids: ["mica-low-memory-main-v3"] }));
}

function assertMainWorldRegistration(result) {
  const script = result.scripts?.find((entry) => entry.id === "mica-low-memory-main-v3");
  assert(result.synced?.registered === true && script, "Low Memory MAIN-world script was not registered");
  assert(script.world === "MAIN" && script.runAt === "document_start" && script.persistAcrossSessions === true, "Low Memory registration lost its MAIN/document_start/persistent contract");
}

async function waitForMappingNodes(page, expected) {
  await page.waitForFunction((count) => globalThis.__MICA_LOW_MEMORY_HOST__?.mappingNodes === count, expected, { timeout: 10_000 });
}

async function waitForLowMemoryState(worker, url, expected) {
  const deadline = Date.now() + 10_000;
  let last = null;
  while (Date.now() < deadline) {
    const runtime = await waitForMicaContentRuntime(worker, url);
    last = runtime.response.status;
    if (last?.lowMemory?.state === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Low Memory state did not reach ${expected}: ${JSON.stringify(last?.lowMemory || null)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
