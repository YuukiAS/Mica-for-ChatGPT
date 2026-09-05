import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stress = process.argv.includes("--stress");
const loops = stress ? 72 : 24;
const widths = stress ? [1200, 900, 700, 500] : [1200, 700, 500];
const bundledNodeModules = "C:\\Users\\yuukias\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
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

  const guidedResult = await runGuidedComposerDiagnosticsCase();
  results.push(guidedResult);
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
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
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
    }, null, { timeout: stress ? 45000 : 30000 });
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

async function runCase({ width, mica, disabled = false, small = false, loops: caseLoops = loops }) {
  const label = `${mica ? (disabled ? "mica-disabled" : "mica") : "native"}${small ? "-small-mounted" : ""}@${width}px/${caseLoops}`;
  console.error(`Running E2E case ${label}`);
  const page = await browser.newPage({ viewport: { width, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = `${baseUrl}/tests/fixtures/composer-lifecycle.html?mica=${mica ? "1" : "0"}&disabled=${disabled ? "1" : "0"}&small=${small ? "1" : "0"}&loops=${caseLoops}&stress=${stress ? "1" : "0"}`;
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
