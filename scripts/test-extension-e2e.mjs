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
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mica-e2e-"));
const userDataDir = path.join(tempRoot, "profile");
const extensionDir = path.join(tempRoot, "extension");
const evidenceDir = path.join(root, "results", "mica--product-recovery-current-gpt-ui", "visual-evidence");
const pdfEvidenceDir = path.join(root, "results", "mica--product-recovery-current-gpt-ui", "pdf-evidence");
const pdfOutputDir = path.join(root, "output", "pdf");
const pdfPath = path.join(pdfOutputDir, "mica-research-export-0.4.0.pdf");
await cp(path.join(root, "dist", "mica-dev"), extensionDir, { recursive: true });
const manifestPath = path.join(extensionDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
manifest.content_scripts[0].matches.push("http://127.0.0.1/*");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(evidenceDir, { recursive: true });
await mkdir(pdfEvidenceDir, { recursive: true });
await mkdir(pdfOutputDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const target = path.resolve(root, decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, ""));
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
  const migration = await worker.evaluate(() => ({
    existing: globalThis.MicaServiceWorker.migrateState({ schemaVersion: 1, enabled: false, copyExport: false, reliability: true, pageIntegration: false }),
    fresh: globalThis.MicaServiceWorker.migrateState({ schemaVersion: 0 })
  }));
  assert(migration.existing.enabled === false && migration.existing.copyExport === false && migration.existing.pageIntegration === false && migration.existing.highlighter === true, "update migration overwrote existing settings or missed new defaults");
  assert(Object.entries(migration.fresh).every(([key, value]) => key === "schemaVersion" ? value === 2 : value === true), "fresh install defaults drifted");
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
  assert(highlighterCoverage.restoredLogical === 5 && highlighterCoverage.mathIntact && highlighterCoverage.marksInsideMath === 0 && highlighterCoverage.disabledRendered === 0 && highlighterCoverage.reenabledRendered >= 6, `highlighter remount/math/toggle isolation failed: ${JSON.stringify(highlighterCoverage)}`);

  const popup = await context.newPage();
  await fixture.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`, { waitUntil: "load" });
  await popup.waitForFunction(() => document.getElementById("copyMarkdown")?.disabled === false);
  const popupLabels = await popup.locator("h1, h2, summary, footer").allTextContents();
  assert(!popupLabels.join(" ").match(/Atlas|Diagnostics|fixture|selector|mounted|optimized/i), "developer wording leaked into popup");
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
  await exportPage.screenshot({ path: path.join(pdfEvidenceDir, "0.4.0-export-preview.png"), fullPage: true });
  await exportPage.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });
  await exportPage.close();

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
          path: path.join(evidenceDir, `0.4.0-popup-${colorScheme}-360.png`),
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
  assert(currentUiReport.candidate.version === "0.4.0", "current UI report lost candidate identity");
  assert(currentUiReport.report.summary.composerRemounted, "current UI report missed composer remount");
  assert(currentUiReport.report.summary.actionClusterObserved && currentUiReport.report.summary.connectorSignalObserved, "current UI report missed structural signals");
  assert(currentUiReport.report.privacy.promptText === false && currentUiReport.report.privacy.answerText === false && currentUiReport.report.privacy.contentUpload === false, "current UI report privacy boundary drifted");
  await optionsPage.screenshot({ path: path.join(evidenceDir, "0.4.0-troubleshooting.png"), fullPage: true });
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
    const nativeCopy = document.querySelector("[data-mica-current-action-cluster] > [aria-label='Copy']");
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
  assert(anomalies.ghost.state === "ghost_send_suspected" && anomalies.ghost.draftRestored, "ghost-send recovery failed");
  assert(anomalies.fakeWaiting.state === "fake_waiting_suspected", "fake-waiting detection failed");
  assert(anomalies.generationError.state === "generation_error_recovery_available", "generation-error detection failed");
  assert(anomalies.staleResponse.state === "stale_response_suspected", "stale-response detection failed");
  const stressEvidence = stress ? await runStressCycles(context, fixture, fixtureUrl) : { run: false, reason: "not_requested" };
  console.log(JSON.stringify({ passed: true, extensionId, migration, clipboardLength: clipboard.length, notionClipboard: { types: notionClipboard.types, plainLength: notionClipboard.plain.length, htmlLength: notionClipboard.html.length, notionLike }, pdf: { path: pdfPath, ...exportState }, highlightCreated, highlightPersistence, streamingSafety, anchorRelocation, deterministicDegradation, bulkHighlightPerformance, highlighterCoverage, currentUiReport: currentUiReport.report.summary, placement, lifecycle, anomalies, stressEvidence, popupMatrix: matrix }, null, 2));
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    const cases = [
      { start: "#heading-case", startOffset: 0, end: "#heading-case", endOffset: 8 },
      { start: "#list-case", startOffset: 0, end: "#list-case", endOffset: 12 },
      { start: "#quote-case", startOffset: 0, end: "#quote-case", endOffset: 14 },
      { start: "#formula-case", startOffset: 0, end: "#formula-case", endOffset: 15 },
      { start: "#cross-start", startOffset: 16, end: "#cross-end", endOffset: 16 }
    ];
    for (const selectionCase of cases) {
      await page.evaluate(({ start, startOffset, end, endOffset }) => {
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
      await page.waitForSelector("[data-mica-ui='highlight-affordance']");
      await page.locator("[data-mica-ui='highlight-affordance']").click();
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
    await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ highlighter: false }, resolve)));
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(300);
    const disabledRendered = await page.locator("mark[data-mica-highlight-id]").count();
    await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ highlighter: true }, resolve)));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("mark[data-mica-highlight-id]").length >= 6, null, { timeout: 5000 });
    return { ...restored, disabledRendered, reenabledRendered: await page.locator("mark[data-mica-highlight-id]").count() };
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
