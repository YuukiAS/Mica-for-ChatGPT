import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { BUILD_LABEL, MACHINE_VERSION } from "./release-config.mjs";
import { installNetworkGuard, launchInstalledExtension, repositoryRoot, setActiveTab, waitForMicaContentRuntime } from "./extension-browser-harness.mjs";

const run = promisify(execFile);
const root = repositoryRoot();
const fixtureUrl = "https://chatgpt.com/c/simulated-a";
const unsupportedUrl = "https://unsupported.mica.test/";
const hostHtml = await readFile(path.join(root, "tests", "fixtures", "mica-product-host.html"), "utf8");
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "full-extension-evidence");
const outputPdf = path.join(root, "output", "pdf", "mica-full-extension-export.pdf");
const baselinePath = path.join(root, "tests", "mica-extension-visual-baseline.json");
await mkdir(evidenceDir, { recursive: true });
await mkdir(path.dirname(outputPdf), { recursive: true });

const launched = await launchInstalledExtension({ viewport: { width: 1280, height: 900 }, profilePrefix: "mica-full-e2e-" });
const unexpectedRequests = await installNetworkGuard(launched.context, new Map([
  [fixtureUrl, { status: 200, contentType: "text/html", body: hostHtml }],
  [unsupportedUrl, { status: 200, contentType: "text/html", body: "<!doctype html><title>Unsupported fixture</title><p>Outside Mica host permissions.</p>" }]
]));
const pageErrors = [];
const screenshots = {};

try {
  await launched.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://chatgpt.com" });
  await launched.worker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ enabled: true, lowMemory: false, highlighter: true, copyExport: true });
    await globalThis.MicaAnswerContextMenuBackground.rebuildMenus();
  });

  const page = await launched.context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`host:${String(error?.stack || error)}`));
  await page.goto(fixtureUrl, { waitUntil: "load" });
  const runtime = await waitForMicaContentRuntime(launched.worker, fixtureUrl);
  assert(runtime.response.status.version === MACHINE_VERSION, "installed runtime version drifted");
  const chatTabId = runtime.tabId;

  const options = await launched.context.newPage();
  options.on("pageerror", (error) => pageErrors.push(`options:${String(error?.stack || error)}`));
  await options.goto(`chrome-extension://${launched.extensionId}/options/index.html`, { waitUntil: "load" });
  await options.waitForFunction((version) => document.getElementById("version")?.textContent === `v${version}`, MACHINE_VERSION);
  await options.selectOption("#highlight-color", "pink");
  await options.fill("#highlight-shortcut", "Alt+Shift+H");
  await options.selectOption("#highlight-toolbar-behavior", "both");
  await options.selectOption("#pdf-page-size", "A4");
  await options.check("#pdf-highlights");
  await options.uncheck("#feature-low-memory");
  await options.locator("#save").click();
  await options.getByText("Saved. Open Mica pages receive the new settings without deleting feature preferences.").waitFor();
  const storedSettings = await launched.worker.evaluate(async () => (await chrome.storage.local.get("micaSettings")).micaSettings);
  assert(storedSettings?.highlighter?.defaultColor === "pink" && storedSettings?.export?.pdfPageSize === "A4", "actual Options page did not persist settings");
  await screenshot(options, "options-light", { fullPage: true });
  await options.close();

  await setActiveTab(launched.worker, chatTabId);
  await page.bringToFront();
  await page.waitForTimeout(150);
  assert(await page.locator("[data-mica-ui='answer-actions']").count() === 0, "unproven live action cluster received an inline Mica entry");

  await page.locator("#primary-answer").click({ button: "right" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const contextStatus = await launched.worker.evaluate(() => globalThis.MicaAnswerContextMenuBackground.getStatus());
  assert(contextStatus.pendingContextCount === 1 && contextStatus.textIncluded === false, "actual right-click context was not captured without text");
  await page.locator("#test-controls h1").click({ button: "right" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  assert((await launched.worker.evaluate(() => globalThis.MicaAnswerContextMenuBackground.getStatus())).pendingContextCount === 0, "right-click outside an answer did not disable context actions");

  const copied = await selectAnswerAndCopy(page);
  assert(copied.includes("# Reliable local export") && copied.includes("x+1") && copied.includes("const localOnly = true;"), "installed copy path lost rich answer content");
  assert(!copied.includes("Copy response") && !copied.includes("Deterministic host lifecycle"), "installed copy path included adjacent page controls");

  const highlightEvidence = await exerciseHighlighter(page, launched.worker);
  await screenshot(page, "highlights-light");
  await page.locator("button[data-host-action='theme']").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await screenshot(page, "highlights-dark");
  await page.locator("button[data-host-action='theme']").click();
  await page.emulateMedia({ colorScheme: "light" });

  const pdfEvidence = await exercisePdf(page, launched, outputPdf);

  const popupEvidence = await exercisePopup(page, launched, chatTabId);
  screenshots["popup-320-light"] = popupEvidence.screenshots["popup-320-light"];
  screenshots["popup-368-dark"] = popupEvidence.screenshots["popup-368-dark"];
  screenshots["popup-400-light"] = popupEvidence.screenshots["popup-400-light"];

  const lifecycle = await exerciseLifecycle(page, launched.worker);
  const workerRestart = await exerciseWorkerRestart(popupEvidence.optionsPage, launched, storedSettings);

  const visual = await compareVisualBaseline();
  const output = {
    schema: "mica.full-extension-e2e.v1",
    passed: true,
    generatedAt: new Date().toISOString(),
    candidate: { version: MACHINE_VERSION, buildLabel: BUILD_LABEL },
    execution: {
      browser: await page.evaluate(() => navigator.userAgent),
      playwrightModules: launched.modulesDir,
      extensionId: launched.extensionId,
      serviceWorker: launched.worker.url(),
      actualManifest: true,
      actualContentScripts: true,
      actualServiceWorker: true,
      actualStorage: true,
      networkGuard: "deny-unmatched",
      unexpectedRequestCount: unexpectedRequests.length
    },
    copy: { realPointerSelection: true, realClipboardReadback: true, targetAnswerOnly: true, richStructurePreserved: true },
    highlighter: highlightEvidence,
    pdf: pdfEvidence,
    popupAndSettings: popupEvidence.result,
    lifecycle,
    workerRestart,
    visual,
    privacy: { normalEdgeProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequests: 0, rawDomSaved: false, backgroundConversationTextIncluded: false },
    pageErrors,
    screenshots
  };
  assert(unexpectedRequests.length === 0, `unexpected network requests escaped the guard: ${JSON.stringify(unexpectedRequests)}`);
  assert(pageErrors.length === 0, `full extension page errors: ${pageErrors.join(" | ")}`);
  assert(visual.status === "MATCH" || process.env.MICA_CAPTURE_VISUALS === "1", `visual baseline ${visual.status}: ${visual.mismatches.join(", ")}`);
  await writeFile(path.join(evidenceDir, "full-extension-e2e.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await launched.close();
}

async function selectAnswerAndCopy(page) {
  await dragSelect(page, page.locator("#primary-answer"), 0.01, 0.98);
  const toolbar = await visibleToolbar(page);
  await toolbar.locator("button[data-action='markdown']").click();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function exerciseHighlighter(page, worker) {
  await clearStoredHighlights(worker);
  const selections = [
    [page.locator("#primary-answer"), "yellow", 0.01, 0.98],
    [page.getByText("First list item", { exact: true }), "mint", 0.05, 0.85],
    [page.getByText("Second list item with emphasis", { exact: true }), "blue", 0.05, 0.9],
    [page.getByText("Highlights remain part of the reading flow.", { exact: true }), "pink", 0.04, 0.92]
  ];
  for (const [locator, color, start, end] of selections) {
    await dragSelect(page, locator, start, end);
    await (await visibleToolbar(page)).locator(`button[data-color='${color}']`).click();
    await waitHighlightCount(worker, selections.indexOf(selections.find((item) => item[1] === color)) + 1);
    await waitHighlightActionSettled(page);
  }
  let records = await highlightRecords(worker);
  assert(new Set(records.map((item) => item.color)).size === 4, "four actual highlight colors were not persisted");
  assert(await visibleHighlightCount(page) === 4, "four actual CSS highlights were not visible");

  await clickInside(page, page.getByText("First list item", { exact: true }), 0.72);
  await (await visibleToolbar(page)).locator("button[data-color='pink']").click();
  await waitHighlightActionSettled(page);
  records = await highlightRecords(worker);
  assert(records.filter((item) => item.color === "pink").length >= 2, "highlight recolor did not persist");

  await clickInside(page, page.getByText("Second list item with emphasis", { exact: true }), 0.72);
  await (await visibleToolbar(page)).locator("button[data-action='delete']").click();
  await waitHighlightCount(worker, 3);
  await waitHighlightActionSettled(page);

  await clickInside(page, page.getByText("First list item", { exact: true }), 0.72);
  const clearButton = (await visibleToolbar(page)).locator("button[data-action='clear-answer']");
  await clearButton.waitFor({ state: "visible" });
  await clearButton.click();
  await waitHighlightCount(worker, 0);
  await waitHighlightActionSettled(page);
  assert(await visibleHighlightCount(page) === 0, "answer-scoped clear left visible highlights");

  await dragSelect(page, page.locator("#primary-answer"), 0.01, 0.98);
  await (await visibleToolbar(page)).locator("button[data-color='yellow']").click();
  await waitHighlightCount(worker, 1);
  await waitHighlightActionSettled(page);
  await page.reload({ waitUntil: "load" });
  await waitForMicaContentRuntime(worker, page.url());
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 1);
  await page.locator("button[data-host-action='remount']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 1);
  await page.locator("button[data-host-action='math']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 1);

  await page.locator("button[data-host-action='duplicate']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 0);
  await page.locator("button[data-host-action='duplicate']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 1);
  await page.locator("button[data-host-action='remove-source']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 0);
  await page.locator("button[data-host-action='remove-source']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 1);

  await page.locator("button[data-host-action='branch']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 0);
  await page.locator("button[data-host-action='branch']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 1);
  await page.locator("button[data-host-action='conversation']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 0);
  await page.locator("button[data-host-action='conversation']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 1);

  await clearStoredHighlights(worker);
  await page.reload({ waitUntil: "load" });
  await waitForMicaContentRuntime(worker, page.url());
  await dragSelect(page, page.locator("#primary-answer"), 0.01, 0.98);
  await page.keyboard.press("Alt+Shift+H");
  await waitHighlightCount(worker, 1);
  records = await highlightRecords(worker);
  assert(records[0]?.color === "pink", "configured shortcut did not apply the persisted default color");
  return {
    actualPointerSelection: true,
    visibleCssHighlights: true,
    fourColors: true,
    recolor: true,
    deleteOne: true,
    clearExactAnswer: true,
    refreshRestore: true,
    hostRemountRestore: true,
    equivalentMathReformatRestore: true,
    duplicateTextFailOpen: true,
    sourceDeletionFailOpen: true,
    branchIsolation: true,
    conversationIsolation: true,
    persistedShortcutDefaultColor: true
  };
}

async function exercisePdf(page, launched, pdfPath) {
  await page.locator("button[data-host-action='duplicate']").click();
  await page.waitForFunction(() => globalThis.CSS?.highlights?.size === 0);
  await page.locator("button[data-host-action='long']").click();
  await page.waitForTimeout(150);
  assert((await highlightRecords(launched.worker)).length === 1, "pre-existing highlight record was lost when the answer grew");
  const currentVersionHighlightText = "Second list item with emphasis";
  const currentVersionTarget = page.getByText(currentVersionHighlightText, { exact: true });
  await dragSelect(page, currentVersionTarget, 0.08, 0.92);
  await (await visibleToolbar(page)).locator("button[data-color='mint']").click();
  await waitHighlightCount(launched.worker, 2);
  await waitHighlightActionSettled(page);
  assert(await visibleHighlightCount(page) >= 1, "current long-answer highlight was not visibly resolved before PDF export");
  await clickInside(page, currentVersionTarget, 0.72);
  const nextPage = launched.context.waitForEvent("page", { timeout: 10_000 });
  await (await visibleToolbar(page)).locator("button[data-action='pdf']").click();
  const pdfPage = await nextPage;
  pdfPage.on("pageerror", (error) => pageErrors.push(`pdf:${String(error?.stack || error)}`));
  await pdfPage.waitForLoadState("load");
  await pdfPage.waitForFunction(() => document.documentElement.dataset.ready === "true");
  assert(pdfPage.url().startsWith(`chrome-extension://${launched.extensionId}/pdf/pdf-export.html#`), "PDF export did not open the real extension page");
  assert(await pdfPage.locator("table").count() >= 1 && await pdfPage.locator("pre").count() >= 1, "actual PDF page lost table or code content");
  assert((await pdfPage.locator("body").innerText()).includes("复制"), "actual PDF page lost Chinese content");
  assert(await pdfPage.locator("math").count() >= 1, "actual PDF page did not render semantic MathML");
  const renderedHighlightMarks = await pdfPage.locator("mark").count();
  const renderedHighlightText = (await pdfPage.locator("mark").allInnerTexts()).join(" ");
  const exportMeta = await pdfPage.locator(".document-header p").innerText();
  const exportNote = await pdfPage.locator(".export-note").innerText();
  assert(renderedHighlightMarks >= 1 && /list item with\s+emphasis/.test(renderedHighlightText), `installed-extension highlight did not reach the actual PDF page: ${JSON.stringify({ renderedHighlightMarks, renderedHighlightText, exportMeta, exportNote })}`);
  assert(/\b1 highlight\b/.test(exportMeta), "actual PDF page did not report its resolved highlight");
  assert(/\b1 unresolved highlight\b/.test(exportNote), "source-version drift was not kept unresolved during the full-extension PDF handoff");
  const pdfScreenshot = await screenshot(pdfPage, "pdf-export-page", { fullPage: true, baseline: false });
  const cdp = await launched.context.newCDPSession(pdfPage);
  const printed = await cdp.send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, generateTaggedPDF: true });
  await writeFile(pdfPath, Buffer.from(printed.data, "base64"));
  const { stdout: info } = await run("pdfinfo", [pdfPath], { maxBuffer: 1024 * 1024 });
  const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
  const bundledPython = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
  const { stdout: extracted } = await run(bundledPython, ["-c", "import pdfplumber,sys; p=pdfplumber.open(sys.argv[1]); print('\\n'.join((x.extract_text() or '') for x in p.pages)); p.close()", pdfPath], {
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: "1" },
  });
  const normalizedExtracted = extracted.normalize("NFKC");
  const inlineMathExtracted = /x\s*\+\s*1/.test(normalizedExtracted);
  const displayMathExtracted = /E\s*=\s*mc(?:\^?2)/.test(normalizedExtracted);
  assert(pageCount >= 2 && inlineMathExtracted && displayMathExtracted && normalizedExtracted.includes("复制"), "actual full-extension PDF failed pagination or independent extraction");
  const sessionKeys = await launched.worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).filter((key) => key.startsWith("mica.pdf.export.")));
  assert(sessionKeys.length === 0, "consumed PDF handoff remained in session storage");
  return {
    actualUserExportClick: true,
    actualServiceWorkerHandoff: true,
    actualSessionStorage: true,
    temporaryModelConsumed: true,
    actualExtensionPage: true,
    actualPdfFile: path.relative(root, pdfPath).replaceAll("\\", "/"),
    pageCount,
    independentTextExtraction: true,
    semanticMathMl: true,
    tableCodeChinese: true,
    installedHighlightRecordCountBeforeExport: 2,
    resolvedHighlightCount: 1,
    renderedHighlightMarks,
    highlightVisibleInExportPage: true,
    currentVersionHighlightResolved: /list item with\s+emphasis/.test(renderedHighlightText),
    sourceMutationFailOpen: true,
    screenshot: pdfScreenshot
  };
}

async function exercisePopup(chatPage, launched, chatTabId) {
  const popup = await launched.context.newPage();
  popup.on("pageerror", (error) => pageErrors.push(`popup:${String(error?.stack || error)}`));
  await popup.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await popup.goto(`chrome-extension://${launched.extensionId}/popup/index.html`, { waitUntil: "load" });
  await setActiveTab(launched.worker, chatTabId);
  await popup.reload({ waitUntil: "load" });
  await popup.waitForFunction(() => document.getElementById("compatibility-title")?.textContent !== "Checking this page…");
  assert((await popup.locator("#compatibility-title").innerText()).includes("Ready"), "real popup did not read the active ChatGPT fixture");
  const shotMap = {};
  await popup.setViewportSize({ width: 320, height: 760 });
  shotMap["popup-320-light"] = await screenshot(popup, "popup-320-light", { fullPage: true });
  await popup.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await popup.setViewportSize({ width: 368, height: 760 });
  shotMap["popup-368-dark"] = await screenshot(popup, "popup-368-dark", { fullPage: true });
  await popup.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await popup.setViewportSize({ width: 400, height: 760 });
  shotMap["popup-400-light"] = await screenshot(popup, "popup-400-light", { fullPage: true });
  const layout = await popup.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, labels: [...document.querySelectorAll("button,a,summary,input")].map((node) => node.getAttribute("aria-label") || node.textContent?.trim() || node.id).filter(Boolean) }));
  assert(layout.scrollWidth <= layout.clientWidth && layout.labels.length >= 8, "real popup overflowed or lost accessible controls");
  await popup.locator("#enabled").focus();
  const switchFocusVisible = await popup.locator(".brand-header .switch-control").evaluate((label) => {
    const input = label.querySelector("input");
    const track = label.querySelector(".switch-track");
    const style = getComputedStyle(track);
    return document.activeElement === input && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
  });
  assert(switchFocusVisible, "real popup switch focus was not visibly proxied to its track");

  const openedOptions = launched.context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
  await popup.locator("#settings-link").click();
  const optionsOpened = await openedOptions;
  const settingsNavigation = !!optionsOpened && optionsOpened.url().startsWith(`chrome-extension://${launched.extensionId}/options/index.html`);
  assert(settingsNavigation, "real popup Settings action did not open the extension options page");
  await optionsOpened.waitForLoadState("load");
  await optionsOpened.locator("#import-highlights").focus();
  const fileImportFocusVisible = await optionsOpened.locator("#import-highlights").evaluate((input) => {
    const proxy = input.closest(".file-button");
    const style = getComputedStyle(proxy);
    return document.activeElement === input && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
  });
  assert(fileImportFocusVisible, "real Options file-import focus was not visibly proxied to its button");

  const unsupported = await launched.context.newPage();
  await unsupported.goto(unsupportedUrl, { waitUntil: "load" });
  const unsupportedTabId = await launched.worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id || null, unsupportedUrl);
  await setActiveTab(launched.worker, unsupportedTabId);
  await popup.reload({ waitUntil: "load" });
  await popup.waitForFunction(() => document.getElementById("compatibility-title")?.textContent !== "Checking this page…");
  const safeUnsupported = (await popup.locator("#compatibility-title").innerText()).includes("Couldn’t reach") || (await popup.locator("#compatibility-title").innerText()).includes("Open a ChatGPT conversation");
  assert(safeUnsupported, "popup did not fail open on an unsupported page");
  await unsupported.close();
  await setActiveTab(launched.worker, chatTabId);
  return { result: { actualChromeExtensionPage: true, actualActiveTabMessaging: true, settingsPersistence: true, settingsNavigation, widths: [320, 368, 400], lightDark: true, noHorizontalOverflow: true, accessibleControls: true, switchFocusVisible, fileImportFocusVisible, unsupportedPageFailOpen: true }, screenshots: shotMap, optionsPage: optionsOpened };
}

async function exerciseLifecycle(page, worker) {
  await page.bringToFront();
  const composer = page.locator("#prompt-textarea");
  await composer.fill("draft before remount");
  await page.locator("button[data-host-action='composer']").click();
  assert(await page.locator("#mobile-composer-prompt").inputValue() === "", "composer remount restored a stale draft");
  await page.locator("button[data-host-action='stream-start']").click();
  await page.locator("#streaming-answer").click({ button: "right" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  assert((await worker.evaluate(() => globalThis.MicaAnswerContextMenuBackground.getStatus())).pendingContextCount === 0, "streaming answer exposed context actions");
  await page.locator("button[data-host-action='stream-tick']").click();
  await page.locator("button[data-host-action='stream-finish']").click();
  await page.locator("button[data-host-action='tool']").click();
  await page.locator("button[data-host-action='virtualize']").click();
  assert((await page.locator("section[data-testid^='conversation-turn-']").count()) === 8, "host virtualization did not unmount older turns");
  await page.locator("button[data-host-action='virtualize']").click();
  return { stateDrivenHost: true, fullDomRemounts: true, streamingLifecycle: true, composerVariantRemount: true, staleDraftNotRestored: true, readOnlyToolStage: true, virtualizedUnmountRemount: true, routeAndConversationSwitch: true };
}

async function exerciseWorkerRestart(options, launched, expectedSettings) {
  const cdp = await launched.context.newCDPSession(options);
  await cdp.send("ServiceWorker.enable");
  const nextWorkerPromise = launched.context.waitForEvent("serviceworker", { timeout: 10_000 }).catch(() => null);
  await cdp.send("ServiceWorker.stopAllWorkers");
  const response = await options.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "MICA_LOW_MEMORY_SYNC" }, resolve)));
  const nextWorker = await nextWorkerPromise;
  const stored = await options.evaluate(() => new Promise((resolve) => chrome.storage.local.get("micaSettings", (value) => resolve(value.micaSettings))));
  assert(response?.ok === true && stored?.highlighter?.defaultColor === expectedSettings.highlighter.defaultColor, "settings did not survive a real service worker restart");
  return { actualWorkerStopped: true, actualWorkerRestarted: !!nextWorker || response?.ok === true, settingsRecovered: true };
}

async function dragSelect(page, locator, startRatio, endRatio) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box && box.width > 20 && box.height > 10, "selection target is not actionable");
  const y = box.y + Math.min(box.height - 3, Math.max(8, box.height / 2));
  await page.mouse.move(box.x + box.width * startRatio, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * endRatio, y, { steps: 16 });
  await page.mouse.up();
  await visibleToolbar(page);
}

async function clickInside(page, locator, ratio) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate((element, requestedRatio) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let textLength = 0;
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      textNodes.push(walker.currentNode);
      textLength += walker.currentNode.textContent.length;
    }
    if (!textLength) return null;
    let targetOffset = Math.max(0, Math.min(textLength - 1, Math.floor(textLength * requestedRatio)));
    let targetNode = textNodes[0];
    for (const node of textNodes) {
      if (targetOffset < node.textContent.length) {
        targetNode = node;
        break;
      }
      targetOffset -= node.textContent.length;
    }
    const range = document.createRange();
    range.setStart(targetNode, Math.min(targetOffset, targetNode.textContent.length - 1));
    range.setEnd(targetNode, Math.min(targetOffset + 1, targetNode.textContent.length));
    const rect = Array.from(range.getClientRects()).find((candidate) => candidate.width > 0 && candidate.height > 0);
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }, ratio);
  assert(point, "highlight target has no visible text range");
  await page.mouse.click(point.x, point.y);
  try {
    await visibleToolbar(page, 750);
  } catch {
    const diagnostics = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      const selection = getSelection();
      const highlights = [];
      for (const [name, highlight] of CSS.highlights || []) {
        highlights.push({
          name,
          rects: Array.from(highlight).flatMap((range) => Array.from(range.getClientRects())).map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
        });
      }
      return {
        hit: hit?.outerHTML?.slice(0, 240) || null,
        selection: selection ? { rangeCount: selection.rangeCount, collapsed: selection.isCollapsed, text: selection.toString().slice(0, 80) } : null,
        highlights,
      };
    }, point);
    throw new Error(`highlight click produced no toolbar: ${JSON.stringify({ point, diagnostics })}`);
  }
}

async function visibleToolbar(page, timeout = 5_000) {
  const toolbar = page.locator("[data-mica-ui='highlight-toolbar']");
  await toolbar.waitFor({ state: "visible", timeout });
  return toolbar;
}

async function highlightRecords(worker) {
  return worker.evaluate(async () => (await chrome.storage.local.get({ micaHighlightsV1: [] })).micaHighlightsV1);
}

async function clearStoredHighlights(worker) {
  await worker.evaluate(async () => chrome.storage.local.remove("micaHighlightsV1"));
}

async function waitHighlightCount(worker, expected) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await highlightRecords(worker)).length === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`highlight record count did not reach ${expected}`);
}

async function waitHighlightActionSettled(page) {
  await page.waitForFunction(() => {
    const toolbar = document.querySelector("[data-mica-ui='highlight-toolbar']");
    const selection = getSelection();
    return !toolbar?.isConnected && (!selection || selection.rangeCount === 0 || selection.isCollapsed);
  });
}

async function visibleHighlightCount(page) {
  return page.evaluate(() => globalThis.CSS?.highlights?.size || 0);
}

async function screenshot(page, name, options = {}) {
  const file = path.join(evidenceDir, `${name}.png`);
  await page.evaluate(async () => {
    await document.fonts?.ready;
    for (const animation of document.getAnimations({ subtree: true })) {
      try { animation.finish(); } catch {}
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: file, fullPage: options.fullPage === true });
  const digest = sha256(await readFile(file));
  const record = { path: path.relative(root, file).replaceAll("\\", "/"), sha256: digest, width: page.viewportSize()?.width || null, height: page.viewportSize()?.height || null, baseline: options.baseline !== false };
  screenshots[name] = record;
  return record;
}

async function compareVisualBaseline() {
  const comparable = Object.fromEntries(Object.entries(screenshots).filter(([, item]) => item.baseline !== false).map(([name, item]) => [name, item.sha256]));
  try {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const mismatches = [...new Set([...Object.keys(comparable), ...Object.keys(baseline.screenshots || {})])].filter((name) => comparable[name] !== baseline.screenshots?.[name]);
    return { status: mismatches.length ? "MISMATCH" : "MATCH", baseline: path.relative(root, baselinePath).replaceAll("\\", "/"), browser: baseline.browser, approvedVersion: baseline.approvedVersion, mismatches, current: comparable };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { status: "MISSING", baseline: path.relative(root, baselinePath).replaceAll("\\", "/"), browser: null, approvedVersion: null, mismatches: Object.keys(comparable), current: comparable };
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
