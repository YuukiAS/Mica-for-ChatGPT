import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stress = process.argv.includes("--stress");
const caseFilter = process.argv.find((arg) => arg.startsWith("--case="))?.slice("--case=".length) || null;
const suite = process.argv.find((arg) => arg.startsWith("--suite="))?.slice("--suite=".length) || "full";
const loops = stress ? 72 : 24;
const widths = stress ? [1200, 900, 700, 500] : [1200, 700, 500];
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = loadPlaywright();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const filePath = path.resolve(root, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(body);
  } catch (error) {
    response.writeHead(404);
    response.end(String(error?.message || error));
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
let browser = null;

try {
  browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  const nativeByWidth = new Map();
  const results = [];

  if (caseFilter === "guided-composer-diagnostics") {
    const guidedResult = await runGuidedComposerDiagnosticsCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: guidedResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "body-vs-pill-diagnostics") {
    const bodyVsPillResult = await runBodyVsPillDiagnosticsCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: bodyVsPillResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "typing-hotpath") {
    const typingHotpathResult = await runTypingHotpathCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: typingHotpathResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "atlas-hotpath") {
    const atlasHotpathResult = await runTypingHotpathCase({ atlas: true });
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: atlasHotpathResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "atlas-replay") {
    const atlasReplayResult = await runAtlasReplayCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: atlasReplayResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "atlas-generation-identity") {
    const atlasGenerationResult = await runAtlasGenerationIdentityCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: atlasGenerationResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "markdown-copy") {
    const copyResult = await runMarkdownCopyCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: copyResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "final-send-check") {
    const finalSendCheckResult = await runFinalSendCheckCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: finalSendCheckResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "popup-atlas-status") {
    const popupAtlasResult = await runPopupAtlasStatusCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: popupAtlasResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "connector-mention-lifecycle") {
    const connectorResult = await runConnectorMentionLifecycleCase();
    connectorResult.pointerOverlayControls = await runOverlayControlsHitTestCase();
    connectorResult.screenshotRegression = await runConnectorContinuityScreenshotCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: connectorResult }, null, 2));
    process.exitCode = 0;
  } else if (caseFilter === "overlay-placement-matrix") {
    const overlayResult = await runOverlayPlacementMatrixCase();
    console.log(JSON.stringify({ passed: true, stress, case: caseFilter, result: overlayResult }, null, 2));
    process.exitCode = 0;
  } else if (suite === "integration") {
    const nativeResult = await runCase({ width: 700, mica: false, loops: Math.max(8, Math.floor(loops / 3)) });
    results.push(nativeResult);
    const micaResult = await runCase({ width: 700, mica: true, loops: Math.max(8, Math.floor(loops / 3)) });
    compareWithBaseline(nativeResult, micaResult);
    results.push(micaResult);

    const typingHotpathResult = await runTypingHotpathCase();
    results.push(typingHotpathResult);
    const copyResult = await runMarkdownCopyCase();
    results.push(copyResult);
    const finalSendCheckResult = await runFinalSendCheckCase();
    results.push(finalSendCheckResult);
    const popupAtlasResult = await runPopupAtlasStatusCase();
    results.push(popupAtlasResult);
    const connectorResult = await runConnectorMentionLifecycleCase();
    results.push(connectorResult);
    const overlayControlsHitTestResult = await runOverlayControlsHitTestCase();
    results.push({ ...overlayControlsHitTestResult, mode: "overlay-controls-hit-test", width: 900 });
    const failed = results.filter((result) => !result.passed);
    if (failed.length > 0) {
      console.error(JSON.stringify({ passed: false, suite, failed, results }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({
        passed: true,
        stress,
        suite,
        cases: results.map((result) => ({
          mode: result.metrics?.mode || result.mode,
          width: result.width,
          clock: result.clock || null,
          maxMissingDurationMs: result.metrics?.maxMissingDurationMs ?? null
        }))
      }, null, 2));
    }
  } else {

    for (const width of widths) {
      const nativeResult = await runCase({ width, mica: false });
      nativeByWidth.set(width, nativeResult);
      results.push(nativeResult);

      const micaResult = await runCase({ width, mica: true });
      compareWithBaseline(nativeResult, micaResult);
      results.push(micaResult);
    }

    const smallLoops = Math.max(8, Math.floor(loops / 3));
    const nativeSmallResult = await runCase({ width: 700, mica: false, small: true, loops: smallLoops });
    results.push(nativeSmallResult);
    const micaSmallResult = await runCase({ width: 700, mica: true, small: true, loops: smallLoops });
    compareWithBaseline(nativeSmallResult, micaSmallResult);
    assert(micaSmallResult.micaReport?.runtime?.nativeSafeMode === true, "Small mounted Mica case did not enter native-safe mode", micaSmallResult);
    assert(micaSmallResult.micaReport?.runtime?.documentMutationObserverActive === false, "Native-safe mode left document MutationObserver active", micaSmallResult);
    assert(micaSmallResult.micaReport?.runtime?.composerLifecycleListenersAttached === false, "Native-safe mode left composer lifecycle listeners attached", micaSmallResult);
    assert(micaSmallResult.metrics.composerGeometryReadsDuringDelete === 0, "Native-safe mode read composer geometry during delete", micaSmallResult);
    results.push(micaSmallResult);

    const disabledResult = await runCase({ width: 700, mica: true, disabled: true, loops: Math.max(8, Math.floor(loops / 3)) });
    assert(disabledResult.metrics.optimizedClassChanges === 0, "Mica disabled produced optimized class changes", disabledResult);
    results.push(disabledResult);

    const longThreadOffResult = await runCase({ width: 700, mica: true, longThreadOff: true, loops: Math.max(8, Math.floor(loops / 3)) });
    assert(longThreadOffResult.metrics.optimizedClassChanges === 0, "Long-thread optimization disabled produced optimized class changes", longThreadOffResult);
    assert(longThreadOffResult.micaReport?.runtime?.longThreadOptimizationEnabled === false, "Long-thread optimization disabled report missing runtime flag", longThreadOffResult);
    assert(longThreadOffResult.micaReport?.runtime?.nativeSafeMode === true, "Long-thread optimization disabled did not enter native-safe mode", longThreadOffResult);
    results.push(longThreadOffResult);

    const guidedResult = await runGuidedComposerDiagnosticsCase();
    results.push(guidedResult);
    const bodyVsPillResult = await runBodyVsPillDiagnosticsCase();
    results.push(bodyVsPillResult);
    const copyResult = await runMarkdownCopyCase();
    results.push(copyResult);
    const finalSendCheckResult = await runFinalSendCheckCase();
    results.push(finalSendCheckResult);
    const popupAtlasResult = await runPopupAtlasStatusCase();
    results.push(popupAtlasResult);
    const typingHotpathResult = await runTypingHotpathCase();
    results.push(typingHotpathResult);
    const connectorResult = await runConnectorMentionLifecycleCase();
    connectorResult.screenshotRegression = await runConnectorContinuityScreenshotCase();
    results.push(connectorResult);
    const overlayControlsHitTestResult = await runOverlayControlsHitTestCase();
    results.push({ ...overlayControlsHitTestResult, mode: "overlay-controls-hit-test", width: 900 });
    const overlayResult = await runOverlayPlacementMatrixCase();
    results.push(overlayResult);

    const failed = results.filter((result) => !result.passed);
    if (failed.length > 0) {
      console.error(JSON.stringify({ passed: false, failed, results }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({
        passed: true,
        stress,
        loops,
        widths,
        cases: results.map((result) => ({
          mode: result.metrics?.mode || result.mode,
          width: result.width,
          nativeSafeMode: result.micaReport?.runtime?.nativeSafeMode ?? null,
          maxMissingDurationMs: result.metrics?.maxMissingDurationMs ?? result.guidedReport?.summary?.maxMissingDurationMs ?? null,
          optimizedClassChanges: result.metrics?.optimizedClassChanges ?? null,
          optimizedClassChangesDuringSend: result.metrics?.optimizedClassChangesDuringSend ?? null,
          composerReport: result.micaReport?.composer || result.guidedReport?.summary || null
        }))
      }, null, 2));
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

async function runConnectorMentionLifecycleCase() {
  console.error("Running E2E case connector-mention-lifecycle@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/connector-mention-lifecycle.html?clock=virtual&t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("connector-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 90000 });
    payload = JSON.parse(await page.locator("#connector-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#connector-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Connector mention lifecycle fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();

  payload.width = 900;
  payload.mode = "connector-mention-lifecycle";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Connector mention lifecycle fixture failed", payload);
  assert(payload.clock === "virtual", "Connector fixture did not run with virtual clock", payload);
  assert(JSON.stringify(payload).includes("stable send commit latch survives mounted +1 then -1"), "Connector fixture did not cover commit latch regression", payload);
  assert(JSON.stringify(payload).includes("enter one selects connector without send generation"), "Connector fixture did not cover connector selection Enter", payload);
  assert(JSON.stringify(payload).includes("partial residual provenance recovered"), "Connector fixture did not cover partial residual provenance", payload);
  assert(JSON.stringify(payload).includes("repeated remount stale clear waits for quiet window"), "Connector fixture did not cover stale-clear quiet-window regression", payload);
  return payload;
}

async function runTypingHotpathCase(options = {}) {
  const atlas = options.atlas === true;
  console.error(`Running E2E case ${atlas ? "atlas-hotpath" : "typing-hotpath"}@900px`);
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/composer-typing-hotpath.html?atlas=${atlas ? "1" : "0"}&t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("typing-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 15000 });
    payload = JSON.parse(await page.locator("#typing-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#typing-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Typing hotpath fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();

  payload.width = 900;
  payload.mode = atlas ? "atlas-hotpath" : "typing-hotpath";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Typing hotpath fixture failed", payload);
  assert(payload.twenty?.delta?.cloneNode === 0, "20-char typing cloned DOM", payload);
  assert(payload.twoHundred?.delta?.cloneNode === 0, "200-char typing cloned DOM", payload);
  assert(payload.composition?.delta?.cloneNode === 0, "Composition typing cloned DOM", payload);
  assert(payload.twoHundred?.delta?.getComputedStyle === 0, "200-char typing read computed styles", payload);
  assert(payload.twoHundred?.delta?.documentQuerySelectorAll <= payload.twenty?.delta?.documentQuerySelectorAll + 2, "Document-wide querySelectorAll scaled with typed characters", payload);
  assert(payload.continuity?.pollingActive === false, "Connector continuity polling is active during ordinary typing", payload);
  assert(payload.recovery?.guardActive === false && payload.recovery?.sendCandidateActive === false, "Send residual recovery timer is active during ordinary typing", payload);
  if (atlas) {
    assert(payload.atlas?.started?.active === true, "Atlas did not start for hotpath case", payload);
    assert(payload.atlas?.stopped?.runtime?.listeners === 0, "Atlas listeners remained after stop", payload);
    assert(payload.atlas?.stopped?.runtime?.observers === 0, "Atlas observers remained after stop", payload);
    assert(payload.atlas?.stopped?.runtime?.timers === 0, "Atlas timers remained after stop", payload);
  }
  return payload;
}

async function runAtlasReplayCase() {
  console.error("Running E2E case atlas-replay@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/generated/live-atlas-replay.html?t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("atlas-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 10000 });
    payload = JSON.parse(await page.locator("#atlas-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#atlas-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Atlas replay fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();
  payload.width = 900;
  payload.mode = "atlas-replay";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Atlas replay fixture failed", payload);
  return payload;
}

async function runAtlasGenerationIdentityCase() {
  console.error("Running E2E case atlas-generation-identity@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/atlas-generation-identity.html?t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 10000 });
    payload = JSON.parse(await page.locator("#result").textContent());
  } catch (error) {
    const resultText = await page.locator("#result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Atlas generation identity fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();
  payload.width = 900;
  payload.mode = "atlas-generation-identity";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Atlas generation identity fixture failed", payload);
  assert(payload.manualCount === 1, "Click plus submit produced more than one Atlas generation", payload);
  assert(payload.userCount === 1, "Old user turn remount was misclassified as new", payload);
  assert(payload.unresolvedCount >= 1, "Unstable turn identity did not emit fail-open diagnostic", payload);
  assert(payload.reportBeforeTerminal === true, "Recorder report marker was not emitted before terminal marker", payload);
  assert(payload.richCount === 1, "Rich Markdown settled checkpoint missing", payload);
  return payload;
}

async function runMarkdownCopyCase() {
  console.error("Running E2E case markdown-copy@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/markdown-copy.html?t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("copy-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 10000 });
    payload = JSON.parse(await page.locator("#copy-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#copy-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Markdown copy fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();

  payload.width = 900;
  payload.mode = "markdown-copy";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Markdown copy fixture failed", payload);
  assert(payload.actual.includes("$$\n"), "Display math was not converted to dollar delimiters", payload);
  assert(!payload.actual.includes("\\["), "Display math leaked bracket delimiters", payload);
  assert(payload.actual.includes('const price = "$5";'), "Code block dollar content was changed", payload);
  return payload;
}

async function runFinalSendCheckCase() {
  console.error("Running E2E case final-send-check@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/final-send-check.html?t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("final-send-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 10000 });
    payload = JSON.parse(await page.locator("#final-send-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#final-send-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Final send check fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();

  payload.width = 900;
  payload.mode = "final-send-check";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Final send check fixture failed", payload);
  assert(payload.empty?.prepared === true, "Empty composer was not prepared", payload);
  assert(payload.empty?.diagnosticsRunning === true, "Empty composer did not start diagnostics", payload);
  assert(payload.nonEmpty?.reason === "COMPOSER_NOT_EMPTY", "Non-empty composer branch did not fail safe", payload);
  assert(payload.missing?.reason === "COMPOSER_NOT_FOUND", "Missing composer branch did not fail safe", payload);
  assert(payload.guard?.totalSubmitEvents === 0, "Final send check submitted a form", payload);
  assert(payload.guard?.totalSendClicks === 0, "Final send check clicked a send control", payload);
  assert(payload.guard?.totalEnterKeydowns === 0, "Final send check dispatched Enter", payload);
  assert(payload.guard?.totalCtrlEnterKeydowns === 0, "Final send check dispatched Ctrl+Enter", payload);
  assert(payload.guard?.totalRequestSubmitCalls === 0, "Final send check called requestSubmit", payload);
  assert(payload.guard?.totalFormSubmitCalls === 0, "Final send check called form.submit", payload);
  return payload;
}

async function runPopupAtlasStatusCase() {
  console.error("Running E2E case popup-atlas-status@900px");
  const available = await runPopupAtlasPage(true);
  const unavailable = await runPopupAtlasPage(false);
  const payload = {
    passed: available.offUi
      && available.startUi
      && available.stopUi
      && unavailable.trueUnavailableUi
      && available.errors.length === 0
      && unavailable.errors.length === 0,
    mode: "popup-atlas-status",
    width: 900,
    atlasStatusSource: available.offUi,
    atlasOffUi: available.offUi,
    atlasStartUi: available.startUi,
    atlasStopUi: available.stopUi,
    trueUnavailableUi: unavailable.trueUnavailableUi,
    available,
    unavailable
  };
  assert(payload.passed, "Popup Atlas status fixture failed", payload);
  return payload;
}

async function runPopupAtlasPage(recorderAvailable) {
  const page = await browser.newPage({ viewport: { width: 420, height: 760 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript((available) => {
    const messages = [];
    const settings = {
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
    const baseStatus = {
      name: "Active",
      reason: "Fixture",
      mountedTurns: 1,
      optimizedTurns: 0
    };
    let atlas = available
      ? { available: true, active: false, sessionId: null, events: 0 }
      : { available: false, active: false };
    window.__MICA_POPUP_ATLAS_MESSAGES__ = messages;
    window.chrome = {
      runtime: {
        lastError: null,
        getManifest() {
          return { version: "0.2.0", version_name: "0.2.0" };
        }
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ ...defaults, ...settings });
          },
          set(_value, callback) {
            callback?.();
          }
        }
      },
      tabs: {
        query(_query, callback) {
          callback([{ id: 1 }]);
        },
        sendMessage(_tabId, message, callback) {
          messages.push(message.type);
          if (message.type === "MICA_GET_STATUS") {
            callback({ status: baseStatus, settings, diagnostics: {}, composerGuided: {}, atlas });
            return;
          }
          if (message.type === "MICA_ATLAS_START") {
            atlas = { available: true, active: true, sessionId: "popup-atlas-test", events: 7 };
            callback({ status: baseStatus, atlas });
            return;
          }
          if (message.type === "MICA_ATLAS_STOP") {
            atlas = { available: true, active: false, sessionId: "popup-atlas-test", events: 9 };
            callback({ status: baseStatus, atlas });
            return;
          }
          if (message.type === "MICA_ATLAS_GET_REPORT") {
            callback({ status: baseStatus, atlas, reportText: "{\"kind\":\"test\"}" });
            return;
          }
          callback({ status: baseStatus, atlas });
        }
      }
    };
  }, recorderAvailable);

  try {
    await page.goto(`${baseUrl}/dist/mica-dev/popup/index.html?t=${Date.now()}`, { waitUntil: "load" });
    await page.locator("details").evaluate((node) => { node.open = true; });
    await page.waitForFunction(() => document.getElementById("atlasStatus")?.textContent?.trim()?.length > 0, null, { timeout: 5000 });
    if (!recorderAvailable) {
      const result = await popupState(page);
      result.trueUnavailableUi = result.text === "Unavailable" && result.startDisabled && result.stopDisabled && result.copyDisabled;
      result.errors = errors;
      result.messages = await page.evaluate(() => window.__MICA_POPUP_ATLAS_MESSAGES__ || []);
      return result;
    }

    const off = await popupState(page);
    await page.locator("#startAtlas").click();
    await page.waitForFunction(() => document.getElementById("atlasStatus")?.textContent?.includes("Recording"));
    const started = await popupState(page);
    await page.locator("#stopAtlas").click();
    await page.waitForFunction(() => document.getElementById("atlasStatus")?.textContent?.includes("Stopped"));
    const stopped = await popupState(page);
    const copyEnabledAfterStop = stopped.copyDisabled === false;
    const messages = await page.evaluate(() => window.__MICA_POPUP_ATLAS_MESSAGES__ || []);
    return {
      offUi: off.text === "Off" && off.startDisabled === false && off.stopDisabled === true && off.copyDisabled === true,
      startUi: started.text === "Recording · 7 events" && started.startDisabled === true && started.stopDisabled === false,
      stopUi: stopped.text === "Stopped · 9 events" && stopped.startDisabled === false && stopped.stopDisabled === true && copyEnabledAfterStop,
      off,
      started,
      stopped,
      messages,
      errors
    };
  } finally {
    await page.close();
  }
}

function popupState(page) {
  return page.evaluate(() => ({
    text: document.getElementById("atlasStatus")?.textContent?.trim() || "",
    startDisabled: document.getElementById("startAtlas")?.disabled === true,
    stopDisabled: document.getElementById("stopAtlas")?.disabled === true,
    copyDisabled: document.getElementById("copyAtlasReport")?.disabled === true
  }));
}

async function runOverlayPlacementMatrixCase() {
  console.error("Running E2E case overlay-placement-matrix");
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/overlay-placement-matrix.html?t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("matrix-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: stress ? 120000 : 90000 });
    payload = JSON.parse(await page.locator("#matrix-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#matrix-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Overlay placement matrix failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();

  payload.mode = "overlay-placement-matrix";
  payload.width = 1280;
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Overlay placement matrix fixture failed", payload);
  assert(JSON.stringify(payload).includes("expanded stays on bottom-right static placement"), "Overlay matrix did not cover expanded bottom-right placement", payload);
  assert(JSON.stringify(payload).includes("toast stays with bottom-right status anchor"), "Overlay matrix did not cover toast bottom-right placement", payload);
  return payload;
}

async function runConnectorContinuityScreenshotCase() {
  console.error("Running E2E case connector-continuity-screenshot@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(`${baseUrl}/tests/fixtures/connector-mention-lifecycle.html?manual=1&t=${Date.now()}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__MICA_TEST_CONTROLS__ && !!window.__MICA_LONG_THREAD_STATUS__, null, { timeout: 5000 });
    await page.evaluate(async () => {
      window.__MICA_TEST_CONTROLS__.setSettings({
        enabled: true,
        longThreadOptimization: true,
        staleClearRecovery: true,
        connectorContinuity: true,
        sendResidualRecovery: true
      });
      window.__MICA_TEST_CONTROLS__.resetConnectorLifecycleSignalForTests();
      window.__MICA_TEST_CONTROLS__.resetConnectorContinuityForTests();
      window.__MICA_TEST_CONTROLS__.resetSendResidualRecoveryForTests();
      mountConnectorComposer("ABCDEFGHIJ1234567890klmnopqrst");
      showConnectorChooser();
      window.MicaConnectorLifecycleSignal.latchConnectorLifecycle("resolved-connector-pill", composer, editor);
      await delay(80);
    });
    await page.waitForFunction(() => window.__MICA_TEST_CONTROLS__.getConnectorContinuityState()?.cachedSnapshotAvailable === true, null, { timeout: 1500 });
    const nativeMetrics = await page.evaluate(() => captureNativeComposerVisualMetrics());
    const nativeBuffer = await page.locator("[data-composer-surface='true']").screenshot();
    await page.evaluate(async () => {
      await dispatchEnterKey();
      unmountComposer();
    });
    await page.waitForSelector("[data-mica-connector-continuity-shell='true']", { timeout: 1200 });
    const snapshotMetrics = await page.evaluate(() => captureContinuityVisualMetrics());
    const visualComparison = compareContinuityMetrics(nativeMetrics, snapshotMetrics);
    const shellBuffer = await page.locator("[data-mica-connector-continuity-shell='true']").screenshot();
    const nativePng = pngSize(nativeBuffer);
    const shellPng = pngSize(shellBuffer);
    const result = {
      passed: errors.length === 0
        && visualComparison?.passed === true
        && Math.abs(nativePng.width - shellPng.width) <= 1
        && Math.abs(nativePng.height - shellPng.height) <= 1
        && Math.abs(nativePng.width - nativeMetrics?.rect?.width) <= 1
        && Math.abs(nativePng.height - nativeMetrics?.rect?.height) <= 1,
      nativePng,
      shellPng,
      nativeMetrics,
      snapshotMetrics,
      visualComparison,
      errors
    };
    assert(result.passed, "Connector continuity screenshot regression failed", result);
    return result;
  } finally {
    await page.close();
  }
}

function pngSize(buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function compareContinuityMetrics(nativeMetrics, snapshotMetrics) {
  const failures = [];
  if (!nativeMetrics || !snapshotMetrics) failures.push("missing_metrics");
  if (nativeMetrics && snapshotMetrics) {
    for (const field of ["x", "y", "width", "height"]) {
      const snapshotValue = snapshotMetrics.shell?.[field] ?? snapshotMetrics.rect?.[field];
      if (Math.abs(nativeMetrics.rect[field] - snapshotValue) > 3) failures.push(`rect_${field}`);
    }
    if (nativeMetrics.background !== snapshotMetrics.background) failures.push("background");
    if (nativeMetrics.borderRadius !== snapshotMetrics.borderRadius) failures.push("radius");
    if (nativeMetrics.boxShadow === "none" || snapshotMetrics.boxShadow === "none") failures.push("shadow");
    for (const key of ["plus", "pill", "model", "send"]) {
      if (!nativeMetrics.controls?.[key] || !snapshotMetrics.controls?.[key]) {
        failures.push(`${key}_missing`);
        continue;
      }
      for (const field of ["x", "y", "width", "height"]) {
        if (Math.abs(nativeMetrics.controls[key][field] - snapshotMetrics.controls[key][field]) > 8) failures.push(`${key}_${field}`);
      }
    }
  }
  return { passed: failures.length === 0, failures };
}

async function runOverlayControlsHitTestCase() {
  console.error("Running E2E case overlay-consolidation@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/overlay-controls-hit-test.html?t=${Date.now()}`;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__MICA_TEST_CONTROLS__, null, { timeout: 5000 });

    const result = await page.evaluate(async () => {
      window.__MICA_TEST_CONTROLS__.startComposerGuidedDiagnostics();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const panelCount = document.querySelectorAll("[data-mica-composer-diagnostics-root='true']").length;
      const host = document.querySelector("[data-mica-root='true']");
      const shadow = host?.shadowRoot;
      const status = shadow?.querySelector(".mica-status");
      const dot = shadow?.querySelector(".mica-dot");
      const debug = window.__MICA_OVERLAY_DEBUG__ || {};
      const report = window.__MICA_TEST_CONTROLS__.getComposerGuidedDiagnosticsReport();
      window.__MICA_TEST_CONTROLS__.stopComposerGuidedDiagnostics();
      return {
        panelCount,
        bottomOverlayPresent: !!host && !!status,
        recordingSignal: dot?.classList?.contains("recording") === true,
        placement: debug.placement || shadow?.getElementById("mica-overlay")?.dataset?.placement || null,
        reportPrivacySafe: report?.privacy?.promptTextIncluded === false && report?.privacy?.answerTextIncluded === false && report?.privacy?.rawDomIncluded === false,
        sessionRunning: report?.session?.diagnosticTimerActive === true
      };
    });

    result.passed = result.panelCount === 0
      && result.bottomOverlayPresent
      && result.recordingSignal
      && result.placement === "bottom-right-static"
      && result.reportPrivacySafe
      && result.sessionRunning
      && errors.length === 0;
    result.errors = errors;
    assert(result.passed, "Overlay consolidation fixture failed", result);
    return result;
  } finally {
    await page.close();
  }
}

async function getPanelButtonHitTarget(page, action) {
  return page.evaluate((actionName) => {
    const host = document.querySelector("[data-mica-composer-diagnostics-root='true']");
    const button = host?.querySelector?.(`[data-action='${actionName}']`);
    if (!host || !button) {
      return { action: actionName, hitTarget: false, reason: "missing_button" };
    }
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const hitTarget = hit === button || button.contains(hit);
    const hostStyle = getComputedStyle(host);
    const buttonStyle = getComputedStyle(button);
    return {
      action: actionName,
      x,
      y,
      hitTarget,
      hitTag: hit?.tagName?.toLowerCase() || null,
      hitAction: hit?.getAttribute?.("data-action") || null,
      pointerEvents: buttonStyle.pointerEvents,
      hostPointerEvents: hostStyle.pointerEvents,
      zIndex: hostStyle.zIndex,
      inert: button.inert === true || button.hasAttribute("inert")
    };
  }, action);
}

async function runGuidedComposerDiagnosticsCase() {
  console.error("Running E2E case guided-composer-diagnostics@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/composer-guided-diagnostics.html?t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("guided-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 90000 });
    payload = JSON.parse(await page.locator("#guided-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#guided-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Guided composer diagnostics fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();

  payload.width = 900;
  payload.mode = "guided-composer-diagnostics";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Guided composer diagnostics fixture failed", payload);
  assert(JSON.stringify(payload.guidedReport || {}).includes("fixture secret prompt") === false, "Guided diagnostics leaked fixture prompt text", payload);
  assert(JSON.stringify(payload.guidedReport || {}).includes("fixture answer should not leak") === false, "Guided diagnostics leaked fixture answer text", payload);
  assert(payload.delayedReport?.runtime?.nativeSafeMode === true, "Delayed-turn probe left native-safe mode", payload);
  assert(payload.delayedReport?.runtime?.documentMutationObserverActive === false, "Delayed-turn probe enabled document MutationObserver", payload);
  assert(payload.delayedReport?.runtime?.composerLifecycleListenersAttached === false, "Delayed-turn probe enabled composer lifecycle listeners", payload);
  return payload;
}

async function runBodyVsPillDiagnosticsCase() {
  console.error("Running E2E case body-vs-pill-diagnostics@900px");
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/composer-body-vs-pill-diagnostics.html?t=${Date.now()}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("body-pill-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: 12000 });
    payload = JSON.parse(await page.locator("#body-pill-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#body-pill-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`Body-vs-pill diagnostics fixture failed before producing a result: ${error?.message || error}`), {
      details: { resultText, errors }
    });
  }
  await page.close();

  payload.width = 900;
  payload.mode = "body-vs-pill-diagnostics";
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Body-vs-pill diagnostics fixture failed", payload);
  assert(payload.sendLifecycle?.classification === "SEND_BODY_CLEARED_CONNECTOR_CONTEXT_RETAINED", "Connector pill retention was misclassified", payload);
  assert(payload.sendLifecycle?.composerRawTextLength > 0, "Raw connector pill text was not counted", payload);
  assert(payload.sendLifecycle?.composerEditableBodyLength === 0, "Editable body did not clear", payload);
  assert(payload.sendLifecycle?.connectorPillTextLength > 0, "Connector pill text was not counted separately", payload);
  assert(JSON.stringify({
    sendLifecycle: payload.sendLifecycle,
    summary: payload.summary,
    recovery: payload.recovery
  }).includes("typed body") === false, "Body-vs-pill diagnostics leaked typed body text", payload);
  return payload;
}

async function runCase({ width, mica, disabled = false, longThreadOff = false, small = false, loops: caseLoops = loops }) {
  const label = `${mica ? (disabled ? "mica-disabled" : (longThreadOff ? "mica-long-thread-off" : "mica")) : "native"}${small ? "-small-mounted" : ""}@${width}px/${caseLoops}`;
  console.error(`Running E2E case ${label}`);
  const page = await browser.newPage({ viewport: { width, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/composer-lifecycle.html?mica=${mica ? "1" : "0"}&disabled=${disabled ? "1" : "0"}&longThreadOff=${longThreadOff ? "1" : "0"}&small=${small ? "1" : "0"}&loops=${caseLoops}&stress=${stress ? "1" : "0"}`;
  let payload;
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const text = document.getElementById("e2e-result")?.textContent || "";
      return text.trim().startsWith("{");
    }, null, { timeout: stress ? 90000 : 45000 });
    payload = JSON.parse(await page.locator("#e2e-result").textContent());
  } catch (error) {
    const resultText = await page.locator("#e2e-result").textContent().catch(() => "");
    await page.close();
    throw Object.assign(new Error(`E2E case ${label} failed before producing a result: ${error?.message || error}`), {
      details: { label, resultText, errors }
    });
  }
  await page.close();

  payload.width = width;
  payload.errors = errors;
  if (errors.length > 0) payload.passed = false;
  assert(payload.passed, "Composer lifecycle fixture failed", payload);
  assert(JSON.stringify(payload.micaReport || {}).includes("fixture message") === false, "Diagnostics report leaked fixture message text", payload);
  if (mica && !disabled) {
    assert(payload.micaReport?.privacy?.conversationTextIncluded === false, "Diagnostics privacy flag changed", payload);
    assert(payload.micaReport?.composer && typeof payload.micaReport.composer.textLength === "number", "Composer diagnostics missing", payload);
  }
  return payload;
}

function compareWithBaseline(nativeResult, micaResult) {
  const tolerance = stress ? 180 : 120;
  assert(
    micaResult.metrics.maxMissingDurationMs <= nativeResult.metrics.maxMissingDurationMs + tolerance,
    "Mica extended composer missing duration beyond tolerance",
    { nativeResult, micaResult, tolerance }
  );
  assert(micaResult.metrics.optimizedContainsComposer === 0, "Optimized node contained composer", micaResult);
  assert(micaResult.metrics.optimizedComposerAncestor === 0, "Optimized node intersected composer ancestry", micaResult);
  assert(micaResult.metrics.optimizedNearMissingComposer === 0, "Optimized node appeared near missing composer area", micaResult);
}

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch (_error) {
    return createRequire(path.join(bundledNodeModules, "package.json"))("playwright");
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
