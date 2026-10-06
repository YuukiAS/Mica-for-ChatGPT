import { createServer } from "node:http";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bundled = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
const { chromium } = require(bundled);
const stress = process.argv.includes("--stress");
const lowMemoryOnly = process.argv.includes("--low-memory-only");
const highlighterOnly = process.argv.includes("--highlighter-only");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mica-e2e-"));
const userDataDir = path.join(tempRoot, "profile");
const extensionDir = path.join(tempRoot, "extension");
const evidenceDir = path.join(root, "results", "mica--product-recovery-current-gpt-ui", "visual-evidence");
const pdfEvidenceDir = path.join(root, "results", "mica--product-recovery-current-gpt-ui", "pdf-evidence");
const pdfOutputDir = path.join(root, "output", "pdf");
const pdfPath = path.join(pdfOutputDir, "mica-research-export-0.4.1.pdf");
await cp(path.join(root, "dist", "mica-dev"), extensionDir, { recursive: true });
const manifestPath = path.join(extensionDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
for (const contentScript of manifest.content_scripts) contentScript.matches.push("http://127.0.0.1/*");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(evidenceDir, { recursive: true });
await mkdir(pdfEvidenceDir, { recursive: true });
await mkdir(pdfOutputDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const conversationMatch = requestUrl.pathname.match(/^\/backend-api\/conversation\/fixture-(\d+)$/);
    if (conversationMatch) {
      const body = JSON.stringify(buildConversationPayload(Number(conversationMatch[1])));
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
      response.end(body);
      return;
    }
    const target = path.resolve(root, decodeURIComponent(requestUrl.pathname).replace(/^\/+/, ""));
    if (!target.startsWith(root)) throw new Error("forbidden");
    const body = await readFile(target);
    response.writeHead(200, { "content-type": target.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    response.end(body);
  } catch (error) {
    response.writeHead(404); response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/tests/fixtures/extension-product-core.html`;
const highlighterCoverageUrl = `http://127.0.0.1:${server.address().port}/tests/fixtures/extension-highlighter-coverage.html`;
const lowMemoryFixtureUrl = `http://127.0.0.1:${server.address().port}/tests/fixtures/low-memory-thread.html`;
const unsupportedFixtureUrl = `http://127.0.0.1:${server.address().port}/tests/fixtures/unsupported-page.html`;
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    executablePath: process.env.MICA_TEST_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => chrome.storage.local.get({ schemaVersion: 0 }, (state) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (state.schemaVersion >= 3) return resolve(state);
      if (Date.now() >= deadline) return reject(new Error("extension install migration did not settle"));
      setTimeout(check, 25);
    });
    check();
  }));
  const migration = await worker.evaluate(() => ({
    existing: globalThis.MicaServiceWorker.migrateState({ schemaVersion: 1, enabled: false, copyExport: false, reliability: true, pageIntegration: false }),
    fresh: globalThis.MicaServiceWorker.migrateState({ schemaVersion: 0 })
  }));
  assert(migration.existing.enabled === false && migration.existing.copyExport === false && migration.existing.pageIntegration === false && migration.existing.highlighter === true && migration.existing.lowMemory === true, "update migration overwrote existing settings or missed new defaults");
  assert(Object.entries(migration.fresh).every(([key, value]) => key === "schemaVersion" ? value === 3 : value === true), "fresh install defaults drifted");
  if (highlighterOnly) {
    const highlighterCoverage = await runHighlighterCoverage(context, worker, highlighterCoverageUrl);
    console.log(JSON.stringify({ passed: true, highlighterCoverage }, null, 2));
    await context.close();
    context = null;
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
    process.exit(0);
  }
  const lowMemoryCoverage = await runLowMemoryCoverage(context, worker, lowMemoryFixtureUrl);
  if (lowMemoryOnly) {
    console.log(JSON.stringify({ passed: true, lowMemoryCoverage }, null, 2));
    await context.close();
    context = null;
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
    process.exit(0);
  }
  const fixture = context.pages()[0] || await context.newPage();
  await fixture.goto(fixtureUrl, { waitUntil: "load" });
  await fixture.waitForSelector("[data-mica-ui='copy-markdown']", { timeout: 10000 });
  await fixture.evaluate(() => {
    const target = document.getElementById("highlight-target");
    const start = target.querySelector("strong").firstChild;
    const end = target.querySelector("strong").nextSibling;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, Math.min(13, end.nodeValue.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await fixture.waitForSelector("[data-mica-ui='highlight-affordance']");
  await fixture.locator("[data-mica-ui='highlight-affordance']").click();
  await fixture.waitForFunction(() => !!document.documentElement.dataset.micaHighlightOutcome, null, { timeout: 3000 });
  const highlightOutcome = await fixture.evaluate(() => JSON.parse(document.documentElement.dataset.micaHighlightOutcome));
  assert(highlightOutcome.rendered, `highlighter failed open: ${JSON.stringify(highlightOutcome)}`);
  await fixture.waitForSelector("mark[data-mica-highlight-id]", { timeout: 3000 });
  const highlightCreated = await fixture.evaluate(() => ({
    segments: document.querySelectorAll("mark[data-mica-highlight-id]").length,
    ids: Array.from(new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)))
  }));
  assert(highlightCreated.segments >= 2 && highlightCreated.ids.length === 1, `cross-node highlight was not created as one logical anchor: ${JSON.stringify(highlightCreated)}`);
  await fixture.reload({ waitUntil: "load" });
  await fixture.waitForSelector("mark[data-mica-highlight-id]", { timeout: 5000 });
  const highlightPersistence = await fixture.evaluate(() => ({
    segments: document.querySelectorAll("mark[data-mica-highlight-id]").length,
    text: Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.textContent).join("")
  }));
  assert(highlightPersistence.segments >= 2 && highlightPersistence.text.includes("evidence with"), "highlight did not restore across reload/remount");

  const streamingSafety = await fixture.evaluate(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const turn = document.querySelector("[data-testid='conversation-turn-extension']");
    turn.dataset.isStreaming = "true";
    document.querySelectorAll("mark[data-mica-highlight-id]").forEach((mark) => mark.replaceWith(...mark.childNodes));
    turn.append(document.createTextNode(""));
    await delay(420);
    const whileStreaming = document.querySelectorAll("mark[data-mica-highlight-id]").length;
    delete turn.dataset.isStreaming;
    const signal = document.createElement("span");
    signal.hidden = true;
    turn.append(signal);
    await delay(420);
    const afterSettled = document.querySelectorAll("mark[data-mica-highlight-id]").length;
    signal.remove();
    return { whileStreaming, afterSettled };
  });
  assert(streamingSafety.whileStreaming === 0 && streamingSafety.afterSettled >= 2, `streaming guard failed: ${JSON.stringify(streamingSafety)}`);

  const anchorRelocation = await fixture.evaluate(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelectorAll("mark[data-mica-highlight-id]").forEach((mark) => mark.replaceWith(...mark.childNodes));
    const target = document.getElementById("highlight-target");
    const moved = document.createElement("p");
    moved.id = "offset-shifter";
    moved.textContent = "Inserted text changes every absolute offset while leaving the selected context intact.";
    target.parentElement.prepend(moved);
    await delay(420);
    const marks = Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"));
    return {
      count: marks.length,
      restoredInsideOriginal: marks.every((mark) => !!mark.closest("#highlight-target")),
      duplicateMarked: !!document.querySelector("#duplicate-quote mark[data-mica-highlight-id]")
    };
  });
  assert(anchorRelocation.count >= 2 && anchorRelocation.restoredInsideOriginal && !anchorRelocation.duplicateMarked, `duplicate-text relocation was not deterministic: ${JSON.stringify(anchorRelocation)}`);

  const deterministicDegradation = await fixture.evaluate(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelectorAll("mark[data-mica-highlight-id]").forEach((mark) => mark.replaceWith(...mark.childNodes));
    document.getElementById("highlight-target").firstChild.nodeValue = "Changed surrounding context ";
    await delay(420);
    return { rendered: document.querySelectorAll("mark[data-mica-highlight-id]").length };
  });
  assert(deterministicDegradation.rendered === 0, `invalid anchor guessed after source text changed: ${JSON.stringify(deterministicDegradation)}`);
  await fixture.reload({ waitUntil: "load" });
  await fixture.waitForSelector("mark[data-mica-highlight-id]", { timeout: 5000 });

  const bulkHighlightPerformance = await seedBulkHighlights(worker, fixture, fixtureUrl);
  assert(bulkHighlightPerformance.rendered === bulkHighlightPerformance.expected, `bulk highlights did not restore: ${JSON.stringify(bulkHighlightPerformance)}`);
  assert(bulkHighlightPerformance.restoreMs < 2500, `bulk highlight restore exceeded budget: ${JSON.stringify(bulkHighlightPerformance)}`);
  const highlighterCoverage = await runHighlighterCoverage(context, worker, highlighterCoverageUrl);
  assert(highlighterCoverage.logical === 5 && highlighterCoverage.segments >= 6, `highlighter semantic coverage failed: ${JSON.stringify(highlighterCoverage)}`);
  assert(highlighterCoverage.restoredLogical === 5 && highlighterCoverage.mathIntact && highlighterCoverage.marksInsideMath === 0 && highlighterCoverage.disabledRendered === 0 && highlighterCoverage.reenabledRendered >= 6 && highlighterCoverage.spaIsolation && highlighterCoverage.escapeDismissed && highlighterCoverage.keyboardRemoved, `highlighter remount/math/SPA/keyboard/toggle isolation failed: ${JSON.stringify(highlighterCoverage)}`);

  const popup = await context.newPage();
  await fixture.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`, { waitUntil: "load" });
  await popup.waitForFunction(() => document.getElementById("copyMarkdown")?.disabled === false);
  const popupLabels = await popup.locator("h1, h2, summary, footer").allTextContents();
  assert(!popupLabels.join(" ").match(/Atlas|Diagnostics|fixture|selector|mounted|optimized/i), "developer wording leaked into popup");
  assert(await popup.locator(".capabilities > .capability-row").count() === 3, "popup must keep exactly three top-level capability rows");
  assert(await popup.locator("#lowMemoryStatus").count() === 1 && await popup.locator("#integrationStatus").count() === 1, "performance row must combine low-memory and page integration state");
  await popup.locator("#exportMenu > summary").click();
  await popup.locator("#copyMarkdown").click();
  await popup.waitForFunction(() => document.getElementById("feedback")?.textContent === "Copied as Markdown.");
  const clipboard = await popup.evaluate(() => navigator.clipboard.readText());
  assert(clipboard.includes("## Extension answer") && clipboard.includes("$E=mc^2$"), "clipboard MIME text did not contain serialized Markdown/LaTeX");
  await popup.locator("#exportMenu > summary").click();
  await popup.locator("#copyNotion").click();
  await popup.waitForFunction(() => document.getElementById("feedback")?.textContent?.startsWith("Copied for Notion"));
  const notionClipboard = await popup.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const plain = await (await item.getType("text/plain")).text();
    const html = await (await item.getType("text/html")).text();
    return { types: item.types, plain, html };
  });
  assert(notionClipboard.types.includes("text/plain") && notionClipboard.types.includes("text/html"), "Notion clipboard MIME pair missing");
  assert(notionClipboard.plain.includes("$$E=mc^2$$"), "Notion plain fallback did not preserve inline equation source");
  const notionLike = await popup.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    return {
      headings: document.querySelectorAll("h1, h2, h3").length,
      tables: document.querySelectorAll("table").length,
      codeBlocks: document.querySelectorAll("pre").length,
      equations: document.querySelectorAll("[data-equation-expression]").length
    };
  }, notionClipboard.html);
  assert(notionLike.headings > 0 && notionLike.tables > 0 && notionLike.codeBlocks > 0 && notionLike.equations >= 2, "Notion-like import lost structure or math");
  await popup.locator("#exportMenu > summary").click();
  const exportPagePromise = context.waitForEvent("page");
  await popup.locator("#exportPdf").click();
  const exportPage = await exportPagePromise;
  await exportPage.waitForFunction(() => document.documentElement.dataset.micaExportReady === "true", null, { timeout: 10000 });
  const exportState = await exportPage.evaluate(() => ({
    fallbacks: Number(document.documentElement.dataset.micaMathFallbacks),
    highlights: document.querySelectorAll("mark[data-export-highlight], mark[data-mica-highlight-id]").length,
    math: document.querySelectorAll(".katex").length,
    textLength: document.getElementById("exportContent").innerText.length
  }));
  assert(exportState.fallbacks === 0 && exportState.math >= 2, "PDF preview did not render math with KaTeX");
  assert(exportState.highlights >= 2 && exportState.textLength > 4000, "PDF preview lost highlights or long-form content");
  await exportPage.screenshot({ path: path.join(pdfEvidenceDir, "0.4.1-export-preview.png"), fullPage: true });
  await exportPage.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });
  await exportPage.close();
  if (await popup.locator("#exportMenu").getAttribute("open") !== null) {
    await popup.locator("#exportMenu > summary").click();
  }

  const unsupportedPage = await context.newPage();
  const unsupportedPopup = await context.newPage();
  await unsupportedPage.goto(unsupportedFixtureUrl, { waitUntil: "load" });
  await unsupportedPage.bringToFront();
  await unsupportedPopup.goto(`chrome-extension://${extensionId}/popup/index.html`, { waitUntil: "load" });
  await unsupportedPopup.waitForFunction(() => document.getElementById("pageStatus")?.textContent === "Unavailable on this page");
  const unsupportedStates = await unsupportedPopup.locator("#copyStatus, #reliabilityStatus, #lowMemoryStatus, #integrationStatus").allTextContents();
  assert(unsupportedStates.length === 4 && unsupportedStates.every((state) => state === "Unavailable on this page"), `unsupported popup states diverged: ${JSON.stringify(unsupportedStates)}`);
  await unsupportedPopup.close();
  await unsupportedPage.close();
  await fixture.bringToFront();

  const matrix = [];
  const popupCdp = await context.newCDPSession(popup);
  for (const colorScheme of ["light", "dark"]) {
    await popup.emulateMedia({ colorScheme });
    for (const width of [320, 360, 400]) {
      await popup.setViewportSize({ width, height: 620 });
      for (const zoom of [1, 1.25, 1.5]) {
        await popupCdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: zoom });
        const geometry = await popup.evaluate(() => {
          const body = document.body.getBoundingClientRect();
          const controls = Array.from(document.querySelectorAll("button, input, summary"));
          return {
            bodyWidth: body.width,
            viewportWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            clipped: controls.some((node) => { const rect = node.getBoundingClientRect(); return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1; })
          };
        });
        assert(!geometry.clipped && geometry.scrollWidth <= geometry.viewportWidth + 1, `popup overflowed at ${width}px/${zoom}x/${colorScheme}`);
        matrix.push({ width, zoom, colorScheme, ...geometry });
      }
      await popupCdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      if (width === 360) {
        const bodyBox = await popup.locator("body").boundingBox();
        const mainBox = await popup.locator("main").boundingBox();
        await popup.screenshot({
          path: path.join(evidenceDir, `0.4.1-popup-${colorScheme}-360.png`),
          clip: { x: 0, y: 0, width: Math.ceil(bodyBox.width), height: Math.ceil(mainBox.height) }
        });
      }
    }
  }

  await popup.locator(".advanced > summary").click();
  await popup.locator("#copyExport").uncheck();
  await popup.waitForFunction(() => document.getElementById("copyMarkdown")?.disabled === true);
  const persisted = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(["copyExport"], resolve)));
  assert(persisted.copyExport === false, "popup setting did not persist");
  await popup.locator("#copyExport").check();

  const optionsPagePromise = context.waitForEvent("page");
  await popup.locator("#openTroubleshooting").click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForSelector("#start");
  await optionsPage.locator("#start").click();
  await optionsPage.waitForFunction(() => document.getElementById("stop")?.disabled === false);
  const privateSentinel = "PRIVATE_FIXTURE_TEXT_MUST_NOT_APPEAR";
  await fixture.evaluate(async (sentinel) => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let composer = document.getElementById("mobile-composer-prompt");
    composer.focus();
    composer.value = sentinel;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: sentinel }));
    const replacement = composer.cloneNode(true);
    replacement.value = "";
    composer.replaceWith(replacement);
    composer = replacement;
    composer.focus();
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: "" }));
    const connector = document.createElement("div");
    connector.setAttribute("aria-label", "GitHub connector");
    document.body.append(connector);
    await delay(320);
  }, privateSentinel);
  await optionsPage.bringToFront();
  await optionsPage.locator("#stop").click();
  await optionsPage.waitForFunction(() => document.getElementById("status")?.textContent?.startsWith("Report copied"));
  const currentUiReportText = await optionsPage.evaluate(() => navigator.clipboard.readText());
  const currentUiReport = JSON.parse(currentUiReportText);
  assert(!currentUiReportText.includes(privateSentinel), "current UI report leaked composer text");
  assert(currentUiReport.candidate.version === "0.4.1", "current UI report lost candidate identity");
  assert(currentUiReport.report.summary.composerRemounted, "current UI report missed composer remount");
  assert(currentUiReport.report.summary.actionClusterObserved && currentUiReport.report.summary.connectorSignalObserved, "current UI report missed structural signals");
  assert(currentUiReport.report.summary.lowMemoryObserved && typeof currentUiReport.report.summary.lowMemoryMaxRemovedTurns === "number", "current UI report missed privacy-safe low-memory evidence");
  assert(currentUiReport.report.privacy.promptText === false && currentUiReport.report.privacy.answerText === false && currentUiReport.report.privacy.contentUpload === false, "current UI report privacy boundary drifted");
  await optionsPage.screenshot({ path: path.join(evidenceDir, "0.4.1-troubleshooting.png"), fullPage: true });
  await optionsPage.close();
  await fixture.reload({ waitUntil: "load" });
  await fixture.waitForSelector("[data-mica-ui='copy-markdown']", { timeout: 5000 });

  await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ pageIntegration: false, reliability: false }, resolve)));
  await fixture.reload({ waitUntil: "load" });
  await fixture.waitForTimeout(300);
  const disabledModules = await fixture.evaluate(async () => {
    const composer = document.getElementById("mobile-composer-prompt");
    composer.value = "disabled module check";
    document.querySelector("form").dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      copyControls: document.querySelectorAll("[data-mica-ui='copy-markdown']").length,
      delivery: JSON.parse(document.documentElement.dataset.micaDeliveryState || "null")?.name
    };
  });
  assert(disabledModules.copyControls === 0 && disabledModules.delivery === "idle", `module disable isolation failed: ${JSON.stringify(disabledModules)}`);
  await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ pageIntegration: true, reliability: true }, resolve)));
  await fixture.reload({ waitUntil: "load" });
  await fixture.waitForSelector("[data-mica-ui='copy-markdown']", { timeout: 5000 });

  const placement = await fixture.evaluate(() => {
    const nativeCopy = document.querySelector("[role='group'] > [data-testid='copy-turn-action-button']");
    const micaCopy = document.querySelector("[data-mica-ui='copy-markdown']");
    const nativeRect = nativeCopy.getBoundingClientRect();
    const micaRect = micaCopy.getBoundingClientRect();
    return {
      adjacent: micaCopy?.previousElementSibling === nativeCopy,
      sameParent: micaCopy?.parentElement === nativeCopy?.parentElement,
      ariaLabel: micaCopy?.getAttribute("aria-label"),
      tooltip: micaCopy?.getAttribute("title"),
      keyboardReachable: micaCopy?.tabIndex >= 0,
      sameHitTarget: Math.round(nativeRect.width) === Math.round(micaRect.width) && Math.round(nativeRect.height) === Math.round(micaRect.height),
      count: document.querySelectorAll("[data-mica-ui='copy-markdown']").length,
      unknownClusterInjected: !!document.querySelector("#legacy-row [data-mica-ui='copy-markdown']")
    };
  });
  assert(placement.adjacent && placement.sameParent && placement.count === 1 && placement.sameHitTarget && !placement.unknownClusterInjected, "extension injection placement/fail-open failed");
  assert(placement.ariaLabel === "Copy as Markdown" && placement.tooltip === "Copy as Markdown" && placement.keyboardReachable, "extension action accessibility failed");
  const pageCopy = fixture.locator("[data-mica-ui='copy-markdown']");
  await pageCopy.click();
  await fixture.waitForFunction(() => document.querySelector("[data-mica-ui='feedback']")?.textContent === "Copied as Markdown");
  assert((await popup.evaluate(() => navigator.clipboard.readText())).includes("## Extension answer"), "page Copy click did not update the clipboard");
  await pageCopy.focus();
  await pageCopy.press("Enter");
  await fixture.waitForFunction(() => document.querySelector("[data-mica-ui='feedback']")?.textContent === "Copied as Markdown");
  assert((await popup.evaluate(() => navigator.clipboard.readText())).includes("$E=mc^2$"), "page Copy keyboard activation failed");
  const lifecycle = await fixture.evaluate(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const form = document.querySelector("form");
    let composer = document.getElementById("mobile-composer-prompt");
    const sent = "Connector result with a deliberately long confirmed payload 1234567890";
    composer.value = sent;
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await delay(10);
    const readState = () => JSON.parse(document.documentElement.dataset.micaDeliveryState || "null");
    const awaiting = readState();
    composer.value = "";
    const replacement = composer.cloneNode(true);
    replacement.value = sent;
    composer.replaceWith(replacement);
    composer = replacement;
    const oldBadResidual = composer.value === sent;
    const userTurn = document.createElement("article");
    userTurn.dataset.testid = "conversation-turn-user-1";
    userTurn.innerHTML = `<div data-message-author-role="user"></div>`;
    userTurn.querySelector("div").textContent = sent;
    document.body.insertBefore(userTurn, form);
    await delay(40);
    const committed = readState();
    const newGoodResidualCleared = composer.value === "";
    composer.value = "new draft that must survive";
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: composer.value }));
    const assistant = document.createElement("article");
    assistant.dataset.testid = "conversation-turn-assistant-2";
    assistant.innerHTML = '<div data-message-author-role="assistant">Fresh response</div>';
    document.body.insertBefore(assistant, form);
    await delay(20);
    const afterAssistant = readState().name;
    await delay(120);
    return {
      awaiting: awaiting.name,
      oldBadResidual,
      committed: committed.name,
      newGoodResidualCleared,
      autoRecoveryCount: committed.autoRecoveryCount,
      nextDraftPreserved: composer.value === "new draft that must survive",
      afterAssistant,
      afterSettled: readState().name
    };
  });
  assert(lifecycle.awaiting === "awaiting_user_commit", "send intent was not recorded");
  assert(lifecycle.oldBadResidual, "OLD_RC10_RC11_LONG_CONNECTOR_RESIDUAL did not reproduce expected failure");
  assert(lifecycle.committed === "user_committed" && lifecycle.newGoodResidualCleared, "confirmed matching residual was not cleared");
  assert(lifecycle.autoRecoveryCount === 1 && lifecycle.nextDraftPreserved, "recovery did not honor one-shot/new-draft guard");
  assert(lifecycle.afterAssistant === "assistant_generating", "assistant progress transition failed");
  assert(lifecycle.afterSettled === "settled", "assistant settled transition failed");
  const anomalies = {
    ghost: await runAnomalyScenario(context, fixtureUrl, "ghost"),
    fakeWaiting: await runAnomalyScenario(context, fixtureUrl, "fake_waiting"),
    generationError: await runAnomalyScenario(context, fixtureUrl, "generation_error"),
    staleResponse: await runAnomalyScenario(context, fixtureUrl, "stale_response")
  };
  const staleFalsePositiveShield = await runStaleFalsePositiveShield(context, fixtureUrl);
  assert(anomalies.ghost.state === "ghost_send_suspected" && anomalies.ghost.draftRestored, "ghost-send recovery failed");
  assert(anomalies.fakeWaiting.state === "fake_waiting_suspected", "fake-waiting detection failed");
  assert(anomalies.generationError.state === "generation_error_recovery_available", "generation-error detection failed");
  assert(anomalies.staleResponse.state === "stale_response_suspected", "stale-response detection failed");
  assert(staleFalsePositiveShield.sameTextNewIdentity === "settled" && staleFalsePositiveShield.earlySimilarThenChanged === "settled", `legitimate duplicate/streaming response was misclassified: ${JSON.stringify(staleFalsePositiveShield)}`);
  const stressEvidence = stress ? await runStressCycles(context, fixture, fixtureUrl) : { run: false, reason: "not_requested" };
  console.log(JSON.stringify({ passed: true, extensionId, migration, lowMemoryCoverage, clipboardLength: clipboard.length, notionClipboard: { types: notionClipboard.types, plainLength: notionClipboard.plain.length, htmlLength: notionClipboard.html.length, notionLike }, pdf: { path: pdfPath, ...exportState }, highlightCreated, highlightPersistence, streamingSafety, anchorRelocation, deterministicDegradation, bulkHighlightPerformance, highlighterCoverage, currentUiReport: currentUiReport.report.summary, placement, lifecycle, anomalies, staleFalsePositiveShield, stressEvidence, popupMatrix: matrix }, null, 2));
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildConversationPayload(turnCount) {
  const mapping = {
    root: { id: "root", parent: null, children: turnCount ? ["node-0"] : [], message: null }
  };
  for (let index = 0; index < turnCount; index += 1) {
    const id = `node-${index}`;
    mapping[id] = {
      id,
      parent: index === 0 ? "root" : `node-${index - 1}`,
      children: index + 1 < turnCount ? [`node-${index + 1}`] : [],
      message: {
        id: `message-${index}`,
        author: { role: index % 2 === 0 ? "user" : "assistant" },
        content: { content_type: "text", parts: [`Turn ${index}. ${"Memory pressure fixture text with deterministic structure. ".repeat(210)}`] },
        metadata: {},
        status: "finished_successfully",
        end_turn: true
      }
    };
  }
  return { id: `fixture-${turnCount}`, title: "Low-memory fixture", mapping, current_node: turnCount ? `node-${turnCount - 1}` : "root", root: "root" };
}

async function runLowMemoryCoverage(context, worker, baseUrl) {
  const page = await context.newPage();
  const setLowMemory = async (value) => {
    await worker.evaluate((lowMemory) => new Promise((resolve) => chrome.storage.local.set({ enabled: true, lowMemory }, resolve)), value);
    await page.waitForTimeout(180);
  };
  const measure = async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("Performance.enable");
    const [dom, performanceMetrics, heap] = await Promise.all([cdp.send("Memory.getDOMCounters"), cdp.send("Performance.getMetrics"), cdp.send("Runtime.getHeapUsage")]);
    await cdp.detach();
    const metrics = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value]));
    return { ...dom, jsHeapUsedSize: Math.round(heap.usedSize || metrics.JSHeapUsedSize || 0), jsHeapTotalSize: Math.round(heap.totalSize || metrics.JSHeapTotalSize || 0) };
  };
  const waitReady = () => page.waitForFunction(() => !!document.documentElement.dataset.lowMemoryFixtureReady, null, { timeout: 15000 });
  try {
    await setLowMemory(false);
    await page.goto(`${baseUrl}?turns=240`, { waitUntil: "load" });
    await waitReady();
    const baseline = {
      memory: await measure(),
      fixture: await page.evaluate(() => JSON.parse(document.documentElement.dataset.lowMemoryFixtureReady)),
      turns: await page.locator("[data-testid^='conversation-turn-']").count()
    };
    await setLowMemory(true);
    await page.reload({ waitUntil: "load" });
    await waitReady();
    await page.waitForFunction(() => JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status") || "null")?.active === true, null, { timeout: 10000 });
    await page.waitForSelector("[data-mica-ui='history-window']", { timeout: 10000 });
    const active = {
      memory: await measure(),
      fixture: await page.evaluate(() => JSON.parse(document.documentElement.dataset.lowMemoryFixtureReady)),
      status: await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status"))),
      turns: await page.locator("[data-testid^='conversation-turn-']").count()
    };
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(evidenceDir, "0.4.1-low-memory-window.png") });
    assert(baseline.turns === 240 && active.turns === 40, `response window did not keep exactly 40 recent turns: ${JSON.stringify({ baseline: baseline.turns, active: active.turns })}`);
    assert(active.status.removedTurns === 200 && active.status.keptTurns === 40, `response window status drifted: ${JSON.stringify(active.status)}`);
    assert(active.memory.nodes < baseline.memory.nodes * 0.45, `DOM node memory did not materially fall: ${JSON.stringify({ baseline: baseline.memory, active: active.memory })}`);
    assert(active.memory.jsHeapUsedSize < baseline.memory.jsHeapUsedSize * 0.72, `JS heap did not materially fall: ${JSON.stringify({ baseline: baseline.memory, active: active.memory })}`);
    assert(active.status.bytesAfter < active.status.bytesBefore * 0.35, `mapping bytes did not materially fall: ${JSON.stringify(active.status)}`);
    const failOpenContracts = await page.evaluate(() => {
      const invalid = window.MicaLowMemoryPage.windowConversation({ messages: [] }, 40);
      const root = { id: "root", parent: null, children: ["n0"], message: null };
      const mapping = { root };
      for (let index = 0; index < 100; index += 1) {
        mapping[`n${index}`] = {
          id: `n${index}`,
          parent: index === 0 ? "root" : `n${index - 1}`,
          children: index === 99 ? [] : [`n${index + 1}`],
          message: { author: { role: index % 2 ? "assistant" : "user" }, content: { content_type: "text", parts: [String(index)] }, metadata: {} }
        };
      }
      const missingChildrenMapping = structuredClone(mapping);
      delete missingChildrenMapping.n55.children;
      const missingChildren = window.MicaLowMemoryPage.windowConversation({ mapping: missingChildrenMapping, current_node: "n99" }, 40);
      const unknownRoleMapping = structuredClone(mapping);
      unknownRoleMapping.n55.message.author.role = "future_agent";
      const unknownRole = window.MicaLowMemoryPage.windowConversation({ mapping: unknownRoleMapping, current_node: "n99" }, 40);
      const toolRoleMapping = structuredClone(mapping);
      toolRoleMapping.n55.message.author.role = "tool";
      const toolRole = window.MicaLowMemoryPage.windowConversation({ mapping: toolRoleMapping, current_node: "n99" }, 40);
      const fileContentMapping = structuredClone(mapping);
      fileContentMapping.n55.message.content = { content_type: "multimodal_text", parts: [{ asset_pointer: "file-service://fixture" }] };
      const fileContent = window.MicaLowMemoryPage.windowConversation({ mapping: fileContentMapping, current_node: "n99" }, 40);
      const streamingMapping = structuredClone(mapping);
      streamingMapping.n99.message.status = "in_progress";
      streamingMapping.n99.message.end_turn = false;
      const streaming = window.MicaLowMemoryPage.windowConversation({ mapping: streamingMapping, current_node: "n99" }, 40);
      const disconnectedMapping = structuredClone(mapping);
      disconnectedMapping.orphan = { id: "orphan", parent: null, children: [], message: null };
      const disconnected = window.MicaLowMemoryPage.windowConversation({ mapping: disconnectedMapping, current_node: "n99" }, 40);
      mapping.n70.children.push("alternate-recent-branch");
      mapping["alternate-recent-branch"] = { id: "alternate-recent-branch", parent: "n70", children: [], message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["alternate"] }, metadata: {} } };
      const recentBranch = window.MicaLowMemoryPage.windowConversation({ mapping, current_node: "n99" }, 40);
      const consecutiveMapping = { root: { id: "root", parent: null, children: ["c0"], message: null } };
      for (let index = 0; index < 100; index += 1) {
        consecutiveMapping[`c${index}`] = {
          id: `c${index}`,
          parent: index === 0 ? "root" : `c${index - 1}`,
          children: index === 99 ? [] : [`c${index + 1}`],
          message: { author: { role: "assistant" }, content: { content_type: "text", parts: [String(index)] }, metadata: {} }
        };
      }
      const consecutiveRoles = window.MicaLowMemoryPage.windowConversation({ mapping: consecutiveMapping, current_node: "c99" }, 40);
      return { invalid, missingChildren, unknownRole, toolRole, fileContent, streaming, disconnected, recentBranch, consecutiveRoles: { changed: consecutiveRoles.changed, visibleTotal: consecutiveRoles.visibleTotal, visibleKept: consecutiveRoles.visibleKept, keptNodes: consecutiveRoles.keptNodes } };
    });
    assert(failOpenContracts.invalid.reason === "shape_unrecognized" && failOpenContracts.missingChildren.reason === "shape_unrecognized" && failOpenContracts.unknownRole.reason === "role_unrecognized" && failOpenContracts.toolRole.reason === "sensitive_structure" && failOpenContracts.fileContent.reason === "sensitive_structure" && failOpenContracts.streaming.reason === "sensitive_structure" && failOpenContracts.disconnected.reason === "graph_invalid" && failOpenContracts.recentBranch.reason === "recent_branch_detected", `unknown/sensitive/recent-branch contracts did not fail open: ${JSON.stringify(failOpenContracts)}`);
    assert(failOpenContracts.consecutiveRoles.changed && failOpenContracts.consecutiveRoles.visibleTotal === 100 && failOpenContracts.consecutiveRoles.visibleKept === 40 && failOpenContracts.consecutiveRoles.keptNodes === 41, `recent-N policy did not count each visible node: ${JSON.stringify(failOpenContracts.consecutiveRoles)}`);

    const interaction = await page.evaluate(async () => {
      const composer = document.getElementById("mobile-composer-prompt");
      const started = performance.now();
      for (let index = 0; index < 120; index += 1) {
        composer.value = `typing-${index}`;
        composer.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: "中", inputType: "insertCompositionText" }));
        composer.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
      }
      const typingMs = performance.now() - started;
      const connector = document.getElementById("connector");
      connector.click();
      const connectorMounted = !!document.getElementById("connector-chip");
      connector.click();
      const connectorRemoved = !document.getElementById("connector-chip");
      composer.value = "low-memory send fixture";
      document.getElementById("composer-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const scrollStarted = performance.now();
      scrollTo(0, 0);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        typingMs,
        connectorMounted,
        connectorRemoved,
        sendCompleted: window.__LOW_MEMORY_FIXTURE__.metrics.sends === 1,
        streamedCharacters: window.__LOW_MEMORY_FIXTURE__.metrics.streamedCharacters,
        scrollFramesMs: performance.now() - scrollStarted,
        composerMutations: window.__LOW_MEMORY_FIXTURE__.metrics.composerMutations,
        inputEvents: window.__LOW_MEMORY_FIXTURE__.metrics.inputEvents
      };
    });
    assert(interaction.typingMs < 80 && interaction.inputEvents === 120, `typing hot path regressed: ${JSON.stringify(interaction)}`);
    assert(interaction.connectorMounted && interaction.connectorRemoved && interaction.sendCompleted && interaction.streamedCharacters > 0, `composer/connector/streaming regressed: ${JSON.stringify(interaction)}`);
    assert(interaction.scrollFramesMs < 250, `windowed scroll frame budget regressed: ${JSON.stringify(interaction)}`);

    await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.locator("[data-mica-ui='history-window'] button").click()]);
    await waitReady();
    const restored = {
      turns: await page.locator("[data-testid^='conversation-turn-']").count(),
      state: await page.evaluate(() => JSON.parse(document.documentElement.dataset.micaLowMemoryStatus || "null")?.state || null)
    };
    assert(restored.turns === 240 && restored.state === "full_history", `full-history reload did not restore all turns: ${JSON.stringify(restored)}`);

    await page.evaluate(() => sessionStorage.removeItem("mica.lowMemory.bypass.v1"));
    await page.goto(`${baseUrl}?turns=20`, { waitUntil: "load" });
    await waitReady();
    const short = { turns: await page.locator("[data-testid^='conversation-turn-']").count(), pageStatus: await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status"))) };
    assert(short.turns === 20 && short.pageStatus.active === false, `short thread should remain native: ${JSON.stringify(short)}`);
    await page.goto(`${baseUrl}?turns=90`, { waitUntil: "load" });
    await waitReady();
    const medium = { turns: await page.locator("[data-testid^='conversation-turn-']").count(), pageStatus: await page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status"))) };
    assert(medium.turns === 40 && medium.pageStatus.active === true, `medium thread was not safely windowed: ${JSON.stringify(medium)}`);

    await page.goto(`${baseUrl}?dom=160`, { waitUntil: "load" });
    await waitReady();
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.micaLowMemoryStatus || "null")?.mode === "dom_window", null, { timeout: 10000 });
    const domFallback = { turns: await page.locator("[data-testid^='conversation-turn-']").count(), status: await page.evaluate(() => JSON.parse(document.documentElement.dataset.micaLowMemoryStatus)) };
    assert(domFallback.turns === 40 && domFallback.status.removedTurns === 120, `DOM fallback windowing failed: ${JSON.stringify(domFallback)}`);
    await setLowMemory(false);
    await page.reload({ waitUntil: "load" });
    await waitReady();
    const disabled = { turns: await page.locator("[data-testid^='conversation-turn-']").count(), status: await page.evaluate(() => JSON.parse(document.documentElement.dataset.micaLowMemoryStatus || "null")) };
    assert(disabled.turns === 160 && disabled.status?.active === false, `disable/reload did not restore full DOM history: ${JSON.stringify(disabled)}`);
    await setLowMemory(true);
    return { baseline, active, failOpenContracts, interaction, restored, short, medium, domFallback, disabled };
  } finally {
    await page.close();
  }
}

async function seedBulkHighlights(worker, page, fixtureUrl) {
  const payload = await page.evaluate(() => {
    const answer = document.querySelector("[data-message-author-role='assistant']");
    const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.length || node.parentElement?.closest("[data-mica-ui], button, [role='button'], textarea, input, [contenteditable='true']")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const fullText = nodes.map((node) => node.nodeValue || "").join("");
    const records = [];
    for (let index = 1; index <= 34; index += 1) {
      const quote = `Long-form research paragraph ${index}.`;
      const start = fullText.indexOf(quote);
      if (start < 0) continue;
      records.push({
        id: `bulk-${index}`,
        turnId: "conversation-turn-extension",
        quote,
        prefix: fullText.slice(Math.max(0, start - 32), start),
        suffix: fullText.slice(start + quote.length, start + quote.length + 32),
        start,
        end: start + quote.length,
        createdAt: "2026-10-05T00:00:00.000Z"
      });
    }
    return {
      key: `mica.highlights.v1:${encodeURIComponent(`${location.origin}${location.pathname}`)}`,
      records
    };
  });
  assert(payload.records.length === 34, `bulk fixture did not produce 34 anchors: ${payload.records.length}`);
  const originalRecords = await worker.evaluate((key) => new Promise((resolve) => chrome.storage.local.get({ [key]: [] }, (items) => resolve(items[key]))), payload.key);
  await worker.evaluate(({ key, records }) => new Promise((resolve) => chrome.storage.local.set({ [key]: records }, resolve)), payload);
  const started = Date.now();
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await page.waitForFunction((expected) => document.querySelectorAll("mark[data-mica-highlight-id]").length === expected, payload.records.length, { timeout: 5000 });
  const restoreMs = Date.now() - started;
  const rendered = await page.locator("mark[data-mica-highlight-id]").count();
  await worker.evaluate(({ key, records }) => new Promise((resolve) => chrome.storage.local.set({ [key]: records }, resolve)), { key: payload.key, records: originalRecords });
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await page.waitForSelector("mark[data-mica-highlight-id]", { timeout: 5000 });
  return { expected: payload.records.length, rendered, restoreMs };
}

async function runHighlighterCoverage(context, worker, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(350);
    const cases = [
      { start: "#heading-case", startOffset: 0, end: "#heading-case", endOffset: 8 },
      { start: "#list-case", startOffset: 0, end: "#list-case", endOffset: 12 },
      { start: "#quote-case", startOffset: 0, end: "#quote-case", endOffset: 14 },
      { start: "#formula-case", startOffset: 0, end: "#formula-case", endOffset: 15 },
      { start: "#cross-start", startOffset: 16, end: "#cross-end", endOffset: 16 }
    ];
    for (const selectionCase of cases) {
      await page.evaluate(({ start, startOffset, end, endOffset }) => {
        delete document.documentElement.dataset.micaHighlightSelection;
        const startNode = document.querySelector(start).firstChild;
        const endNode = document.querySelector(end).firstChild;
        const range = document.createRange();
        range.setStart(startNode, Math.min(startOffset, startNode.nodeValue.length));
        range.setEnd(endNode, Math.min(endOffset, endNode.nodeValue.length));
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.querySelector(start).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }, selectionCase);
      await page.waitForFunction(() => document.documentElement.dataset.micaHighlightSelection === "ready", null, { timeout: 5000 }).catch(async () => {
        throw new Error(`selection coverage failed: ${await page.evaluate(() => document.documentElement.dataset.micaHighlightSelection || "missing")}`);
      });
      await page.waitForFunction(() => !!document.querySelector("[data-mica-ui='highlight-affordance']"), null, { timeout: 5000 });
      await page.locator("[data-mica-ui='highlight-affordance']").click({ force: true, timeout: 5000 });
    }
    const created = await page.evaluate(() => ({
      segments: document.querySelectorAll("mark[data-mica-highlight-id]").length,
      logical: new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)).size,
      marksInsideMath: document.querySelectorAll(".katex mark[data-mica-highlight-id]").length,
      mathIntact: !!document.querySelector(".katex math annotation[encoding='application/x-tex']")
    }));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)).size === 5, null, { timeout: 5000 });
    const restored = await page.evaluate((created) => ({
      ...created,
      restoredLogical: new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)).size,
      marksInsideMath: document.querySelectorAll(".katex mark[data-mica-highlight-id]").length,
      mathIntact: !!document.querySelector(".katex math annotation[encoding='application/x-tex']")
    }), created);
    const routeA = await page.evaluate(() => ({
      path: location.pathname,
      key: `mica.highlights.v1:${encodeURIComponent(`${location.origin}${location.pathname}`)}`
    }));
    await page.evaluate(() => {
      history.pushState({}, "", `${location.pathname.replace(/\.html$/, "-b.html")}`);
      const signal = document.createElement("span");
      signal.hidden = true;
      signal.dataset.routeSignal = "b";
      document.body.append(signal);
    });
    await page.waitForFunction(() => document.querySelectorAll("mark[data-mica-highlight-id]").length === 0, null, { timeout: 5000 });
    await page.evaluate(() => {
      delete document.documentElement.dataset.micaHighlightSelection;
      const node = document.querySelector("#formula-case").lastChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(8, node.nodeValue.length));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector("#formula-case").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForFunction(() => document.documentElement.dataset.micaHighlightSelection === "ready", null, { timeout: 5000 }).catch(async () => {
      throw new Error(`SPA B selection failed: ${await page.evaluate(() => document.documentElement.dataset.micaHighlightSelection || "missing")}`);
    });
    await page.waitForSelector("[data-mica-ui='highlight-affordance']");
    await page.locator("[data-mica-ui='highlight-affordance']").click();
    const routeB = await page.evaluate(() => ({
      path: location.pathname,
      key: `mica.highlights.v1:${encodeURIComponent(`${location.origin}${location.pathname}`)}`
    }));
    const routeRecords = await worker.evaluate(({ a, b }) => new Promise((resolve) => chrome.storage.local.get({ [a]: [], [b]: [] }, (items) => resolve({ a: items[a], b: items[b] }))), { a: routeA.key, b: routeB.key });
    await page.evaluate(() => history.back());
    await page.waitForFunction((expected) => location.pathname === expected, routeA.path, { timeout: 5000 });
    await page.waitForFunction(() => new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)).size === 5, null, { timeout: 5000 });
    const spaIsolation = routeA.path !== routeB.path && routeRecords.a.length === 5 && routeRecords.b.length === 1;
    await page.evaluate(() => {
      delete document.documentElement.dataset.micaHighlightSelection;
      const node = document.querySelector("#formula-case").lastChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(6, node.nodeValue.length));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector("#formula-case").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForFunction(() => document.documentElement.dataset.micaHighlightSelection === "ready", null, { timeout: 5000 });
    await page.waitForSelector("[data-mica-ui='highlight-affordance']");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-mica-ui='highlight-affordance']"));
    const escapeDismissed = true;
    await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ highlighter: false }, resolve)));
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(300);
    const disabledRendered = await page.locator("mark[data-mica-highlight-id]").count();
    await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ highlighter: true }, resolve)));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("mark[data-mica-highlight-id]").length >= 6, null, { timeout: 5000 });
    const reenabledRendered = await page.locator("mark[data-mica-highlight-id]").count();
    await page.locator("mark[data-mica-highlight-id]").first().focus();
    await page.keyboard.press("Delete");
    await page.waitForFunction(() => new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)).size === 4, null, { timeout: 5000 });
    const keyboardRemoved = true;
    return { ...restored, disabledRendered, reenabledRendered, spaIsolation, escapeDismissed, keyboardRemoved };
  } finally {
    await page.close();
  }
}

async function runAnomalyScenario(context, fixtureUrl, kind) {
  const page = await context.newPage();
  try {
    await page.goto(fixtureUrl, { waitUntil: "load" });
    await page.waitForFunction(() => !!document.documentElement.dataset.micaDeliveryState);
    const prompt = `fixture prompt ${kind}`;
    await page.evaluate(({ kind, prompt }) => {
      const form = document.querySelector("form");
      const composer = document.getElementById("mobile-composer-prompt");
      composer.value = prompt;
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      composer.value = "";
      if (kind === "ghost") return;
      const user = document.createElement("article");
      user.dataset.testid = `conversation-turn-user-${kind}`;
      user.innerHTML = '<div data-message-author-role="user"></div>';
      user.firstElementChild.textContent = prompt;
      document.body.insertBefore(user, form);
      if (kind === "generation_error") {
        const alert = document.createElement("div");
        alert.setAttribute("role", "alert");
        alert.textContent = "Network error: response failed";
        document.body.append(alert);
      }
      if (kind === "stale_response") {
        const baseline = document.querySelector("[data-testid='conversation-turn-extension']");
        const duplicate = baseline.cloneNode(true);
        duplicate.dataset.testid = "conversation-turn-assistant-duplicate";
        document.body.insertBefore(duplicate, form);
      }
    }, { kind, prompt });

    if (kind === "ghost") {
      await waitForDeliveryState(page, "ghost_send_suspected");
      await page.locator(".mica-delivery-notice button").click();
      const draftRestored = await page.locator("#mobile-composer-prompt").inputValue();
      return { state: "ghost_send_suspected", actionCount: 1, draftRestored: draftRestored === prompt };
    }

    if (kind === "fake_waiting") {
      await waitForDeliveryState(page, "fake_waiting_suspected");
      return { state: "fake_waiting_suspected", actionCount: await page.locator(".mica-delivery-notice button").count() };
    }
    if (kind === "generation_error") {
      await waitForDeliveryState(page, "generation_error_recovery_available");
      return { state: "generation_error_recovery_available", actionCount: await page.locator(".mica-delivery-notice button").count() };
    }
    await waitForDeliveryState(page, "stale_response_suspected");
    return { state: "stale_response_suspected", actionCount: await page.locator(".mica-delivery-notice button").count() };
  } finally {
    await page.close();
  }
}

async function runStaleFalsePositiveShield(context, fixtureUrl) {
  const run = async (mode) => {
    const page = await context.newPage();
    try {
      await page.goto(fixtureUrl, { waitUntil: "load" });
      await page.waitForFunction(() => !!document.documentElement.dataset.micaDeliveryState);
      await page.evaluate(async (scenario) => {
        const prompt = `fixture prompt ${scenario}`;
        const form = document.querySelector("form");
        const composer = document.getElementById("mobile-composer-prompt");
        composer.value = prompt;
        form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
        composer.value = "";
        const user = document.createElement("article");
        user.dataset.testid = `conversation-turn-user-${scenario}`;
        user.innerHTML = '<div data-message-author-role="user"></div>';
        user.firstElementChild.textContent = prompt;
        document.body.insertBefore(user, form);
        const baseline = document.querySelector("[data-testid='conversation-turn-extension']");
        const duplicate = baseline.cloneNode(true);
        duplicate.dataset.testid = `conversation-turn-assistant-${scenario}`;
        const message = duplicate.querySelector("[data-message-author-role='assistant']");
        if (scenario === "same_text_new_identity") message.dataset.messageId = `new-${scenario}`;
        document.body.insertBefore(duplicate, form);
        if (scenario === "early_similar_then_changed") {
          await new Promise((resolve) => setTimeout(resolve, 25));
          message.querySelector("[data-message-content]").append(document.createTextNode(" Final response diverged after the early matching stream."));
        }
      }, mode);
      await waitForDeliveryState(page, "settled");
      return "settled";
    } finally {
      await page.close();
    }
  };
  return {
    sameTextNewIdentity: await run("same_text_new_identity"),
    earlySimilarThenChanged: await run("early_similar_then_changed")
  };
}

async function waitForDeliveryState(page, name) {
  await page.waitForFunction((expected) => {
    const value = JSON.parse(document.documentElement.dataset.micaDeliveryState || "null");
    return value?.name === expected;
  }, name, { timeout: 3000 });
}

async function runStressCycles(context, fixture, fixtureUrl) {
  const reloads = [];
  for (let index = 0; index < 10; index += 1) {
    const started = Date.now();
    await fixture.goto(fixtureUrl, { waitUntil: "load" });
    await fixture.waitForSelector("[data-mica-ui='copy-markdown']", { timeout: 5000 });
    await fixture.waitForSelector("mark[data-mica-highlight-id]", { timeout: 5000 });
    const state = await fixture.evaluate(() => ({
      copies: document.querySelectorAll("[data-mica-ui='copy-markdown']").length,
      logicalHighlights: new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)).size
    }));
    assert(state.copies === 1 && state.logicalHighlights === 1, `stress reload ${index + 1} drifted: ${JSON.stringify(state)}`);
    reloads.push(Date.now() - started);
  }
  const anomalyCycles = [];
  for (let index = 0; index < 3; index += 1) {
    const ghost = await runAnomalyScenario(context, fixtureUrl, "ghost");
    const generationError = await runAnomalyScenario(context, fixtureUrl, "generation_error");
    assert(ghost.draftRestored && generationError.state === "generation_error_recovery_available", `stress anomaly cycle ${index + 1} failed`);
    anomalyCycles.push({ ghost: ghost.state, generationError: generationError.state });
  }
  return { run: true, reloadCycles: reloads.length, maxReloadMs: Math.max(...reloads), anomalyCycles };
}
