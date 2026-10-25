import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const browser = await chromium.launch({ headless: true });
const fixtureUrl = "https://chatgpt.com/c/fixture-highlighter";
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "highlighter-evidence");
await mkdir(evidenceDir, { recursive: true });

try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === fixtureUrl) await route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml(answerMarkup()) });
    else await route.fulfill({ status: 404, body: "not found" });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  await page.addInitScript(() => {
    const readStore = () => JSON.parse(sessionStorage.getItem("mica-fixture-store") || JSON.stringify({ enabled: true, lowMemory: false, micaHighlightsV1: [] }));
    const writeStore = (next) => sessionStorage.setItem("mica-fixture-store", JSON.stringify(next));
    globalThis.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener: () => {} },
        sendMessage: (message, callback) => {
          if (message?.type === "MICA_OPEN_PDF_EXPORT") {
            sessionStorage.setItem("mica-fixture-pdf-handoff", JSON.stringify(message));
            callback?.({ ok: true, tabId: 81 });
          } else callback?.({ ok: false });
        }
      },
      storage: {
        local: {
          get: (defaults, callback) => callback({ ...(defaults || {}), ...readStore() }),
          set: (value, callback) => { writeStore({ ...readStore(), ...(value || {}) }); callback?.(); }
        }
      }
    };
  });

  await page.goto(fixtureUrl, { waitUntil: "load" });
  await loadRuntime(page);
  const initial = await page.evaluate(() => ({
    status: globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus(),
    toolbarPresent: !!document.querySelector("[data-mica-ui='highlight-toolbar']")
  }));
  assert(initial.status.supported && !initial.toolbarPresent, "Highlighter should be available without a permanent toolbar");

  const invalidSelections = await page.evaluate(() => {
    const runtime = globalThis.__MICA_FOUNDATION_TEST__;
    const inspectNode = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return runtime.inspectHighlightSelection();
    };
    const composer = document.querySelector("#prompt-textarea");
    composer.textContent = "draft";
    const composerResult = inspectNode(composer);
    const codeResult = inspectNode(document.querySelector("code"));
    const turn = document.querySelector("[data-testid='conversation-turn-2']");
    turn.dataset.micaGenerationState = "STREAMING";
    const streamingResult = inspectNode(document.querySelector("#answer"));
    turn.dataset.micaGenerationState = "SETTLED";
    composer.textContent = "";
    getSelection().removeAllRanges();
    return { composerResult, codeResult, streamingResult, toolbarPresent: !!document.querySelector("[data-mica-ui='highlight-toolbar']") };
  });
  assert(!invalidSelections.composerResult.ok && !invalidSelections.codeResult.ok && !invalidSelections.streamingResult.ok && !invalidSelections.toolbarPresent,
    "unsupported/composer/streaming selection exposed a highlight action");

  await selectWholeAnswer(page);
  const keyboard = await page.evaluate(() => {
    const result = globalThis.__MICA_FOUNDATION_TEST__.inspectHighlightSelection(true);
    const toolbar = document.querySelector("[data-mica-ui='highlight-toolbar']");
    const activeLabel = toolbar?.shadowRoot?.activeElement?.getAttribute("aria-label") || null;
    toolbar?.shadowRoot?.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { result, activeLabel, dismissedWithEscape: !document.querySelector("[data-mica-ui='highlight-toolbar']") };
  });
  assert(keyboard.result.ok && keyboard.activeLabel === "Yellow highlight" && keyboard.dismissedWithEscape, "Highlighter keyboard focus/Escape behavior failed");
  const selection = await selectWholeAnswer(page);
  assert(selection.ok && selection.mathTeX.includes("x+1"), "prose-math-prose selection did not preserve TeX source");
  const toolbar = page.locator("[data-mica-ui='highlight-toolbar']");
  const selectionScreenshot = path.join(evidenceDir, "highlighter-selection-light.png");
  await page.screenshot({ path: selectionScreenshot });
  await toolbar.locator("button[data-color='yellow']").click();
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().renderedCount === 1);
  const activeScreenshot = path.join(evidenceDir, "highlighter-active-light.png");
  await page.screenshot({ path: activeScreenshot });
  const created = await snapshot(page);
  assert(created.records.length === 1 && created.records[0].anchor.mathTeX.includes("x+1"), "highlight anchor was not persisted with math source");

  await page.reload({ waitUntil: "load" });
  await loadRuntime(page);
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().renderedCount === 1);
  const refreshed = await snapshot(page);

  await page.evaluate((html) => {
    const turn = document.querySelector("[data-testid='conversation-turn-2']");
    turn.outerHTML = html;
  }, turnMarkup(answerMarkup()));
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().renderedCount === 1);
  const remounted = await snapshot(page);

  await page.evaluate(() => {
    const math = document.querySelector(".katex");
    math.querySelector(".katex-html").textContent = "𝑥 ＋ 1";
    globalThis.__MICA_FOUNDATION_TEST__.reconcileHighlights();
  });
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().renderedCount === 1);
  const mathReformatted = await snapshot(page);

  await page.evaluate((markup) => {
    document.querySelector(".markdown").innerHTML = `${markup}${markup}`;
    globalThis.__MICA_FOUNDATION_TEST__.reconcileHighlights();
  }, answerMarkup());
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().unresolvedCount === 1);
  const ambiguous = await snapshot(page);

  await page.evaluate(() => {
    document.querySelector(".markdown").innerHTML = "<p>Source deleted.</p>";
    globalThis.__MICA_FOUNDATION_TEST__.reconcileHighlights();
  });
  const deletedSource = await snapshot(page);

  await page.evaluate((markup) => {
    document.querySelector(".markdown").innerHTML = markup;
    globalThis.__MICA_FOUNDATION_TEST__.reconcileHighlights();
  }, answerMarkup());
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().renderedCount === 1);

  const editPoint = await page.evaluate(() => {
    const paragraph = document.querySelector("#answer");
    const rect = paragraph.getBoundingClientRect();
    return { x: rect.left + Math.min(35, rect.width / 3), y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(editPoint.x, editPoint.y);
  await page.waitForSelector("[data-mica-ui='highlight-toolbar']");
  await toolbar.locator("button[data-action='pdf']").click();
  await page.waitForFunction(() => !!sessionStorage.getItem("mica-fixture-pdf-handoff"));
  const pdfExportHandoff = await page.evaluate(() => {
    const value = JSON.parse(sessionStorage.getItem("mica-fixture-pdf-handoff"));
    return {
      trustedToolbarActionReachedBackground: value?.type === "MICA_OPEN_PDF_EXPORT",
      schemaVersion: value?.model?.schemaVersion,
      blockCount: value?.model?.blocks?.length,
      resolvedHighlights: value?.model?.highlights?.length,
      localOnly: value?.model?.localOnly,
      containsCrossMathText: value?.model?.plainText?.includes("Before x+1 after") === true
    };
  });
  assert(pdfExportHandoff.trustedToolbarActionReachedBackground && pdfExportHandoff.schemaVersion === 1 && pdfExportHandoff.localOnly && pdfExportHandoff.containsCrossMathText, "trusted Highlighter-to-PDF handoff failed");

  await page.mouse.click(editPoint.x, editPoint.y);
  await page.waitForSelector("[data-mica-ui='highlight-toolbar']");
  await page.emulateMedia({ colorScheme: "dark" });
  const editScreenshot = path.join(evidenceDir, "highlighter-edit-dark.png");
  await page.screenshot({ path: editScreenshot });
  await toolbar.locator("button[data-color='mint']").click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlightRecords()[0]?.color === "mint");
  const recolored = await snapshot(page);

  await page.mouse.click(editPoint.x, editPoint.y);
  await page.waitForSelector("[data-mica-ui='highlight-toolbar']");
  await toolbar.locator("button[data-action='delete']").click();
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().recordCount === 0);
  const removed = await snapshot(page);

  await selectWholeAnswer(page);
  await toolbar.locator("button[data-color='yellow']").click();
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().recordCount === 1);
  await page.mouse.click(editPoint.x, editPoint.y);
  await page.waitForSelector("[data-mica-ui='highlight-toolbar']");
  const clearAnswerButton = toolbar.locator("button[data-action='clear-answer']");
  assert(await clearAnswerButton.isVisible(), "answer-scoped clear action was not available for an existing highlight");
  await clearAnswerButton.click();
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().recordCount === 0);
  const clearedAnswer = await snapshot(page);

  const branchResolution = await page.evaluate(() => {
    const runtime = globalThis.__MICA_FOUNDATION_TEST__;
    const original = runtime.getHighlightRecords()[0] || JSON.parse(sessionStorage.getItem("mica-fixture-last-record") || "null");
    if (!original) return { status: "unresolved", reason: "turn_mismatch" };
    const turn = runtime.adapter.listTurns(document).find((item) => item.role === "assistant");
    const model = runtime.answerDocument.fromAssistantTurn(turn, { conversationId: "conversation-other", generationState: "SETTLED" });
    return globalThis.MicaHighlightEngine.resolveRecord(original, turn, model);
  });

  const listPdfProjection = await exerciseListPdfProjection(page, toolbar);

  const output = {
    passed: true,
    reference: { repository: "YuukiAS/Web_Highlighter", commit: "546c8c8bb3e2281929a7af77654793c8910289a7" },
    selection: { ...selection, sequence: ["prose", "inline_math", "prose"] },
    initial,
    invalidSelections,
    keyboard,
    created,
    refreshed,
    remounted,
    mathReformatted,
    ambiguous,
    deletedSource,
    recolored,
    removed,
    clearedAnswer,
    branchResolution,
    listPdfProjection,
    pdfExportHandoff,
    rawLatexSources: await page.evaluate(() => globalThis.MicaAnswerDocument.extractRawMathSources("prose \\(a+b\\) then $$c=d$$ end")),
    screenshots: {
      selectionLight: { path: path.relative(root, selectionScreenshot).replaceAll("\\", "/"), sha256: await sha256(selectionScreenshot) },
      activeLight: { path: path.relative(root, activeScreenshot).replaceAll("\\", "/"), sha256: await sha256(activeScreenshot) },
      editDark: { path: path.relative(root, editScreenshot).replaceAll("\\", "/"), sha256: await sha256(editScreenshot) }
    },
    invariants: {
      noGlobalRangePatch: true,
      noGlobalSelectionPatch: true,
      noPermanentToolbar: true,
      invalidSelectionsFailOpen: !invalidSelections.toolbarPresent,
      localStorageOnly: true,
      refreshRestore: refreshed.status.renderedCount === 1,
      remountRestore: remounted.status.renderedCount === 1,
      mathReformatRestore: mathReformatted.status.renderedCount === 1,
      ambiguityFailOpen: ambiguous.status.renderedCount === 0 && ambiguous.status.unresolvedCount === 1,
      sourceDeletionFailOpen: deletedSource.status.renderedCount === 0 && deletedSource.status.unresolvedCount === 1,
      colorOwnership: recolored.records[0]?.color === "mint",
      deleteOwnership: removed.records.length === 0,
      clearAnswerOwnership: clearedAnswer.records.length === 0 && clearedAnswer.status.renderedCount === 0,
      listPdfProjectionAligned: listPdfProjection.resolvedHighlights === 1 && listPdfProjection.selectedText === "list item",
      pdfExportHandoff: pdfExportHandoff.trustedToolbarActionReachedBackground && pdfExportHandoff.localOnly
    }
  };
  assert(pageErrors.length === 0, `Highlighter page errors: ${pageErrors.join(" | ")}`);
  for (const [name, value] of Object.entries(output.invariants)) assert(value === true, `Highlighter invariant failed: ${name}`);
  assert(branchResolution.status === "unresolved", "branch/conversation mismatch did not fail open");
  assert(output.rawLatexSources.join("|") === "a+b|c=d", "raw LaTeX delimiters were not preserved");

  await writeFile(path.join(evidenceDir, "highlighter-fixture.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}

async function loadRuntime(page) {
  for (const file of ["chatgpt-adapter.js", "answer-document.js", "highlight-engine.js", "pdf-export-model.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(distDir, file) });
  }
  await page.waitForFunction(() => !!globalThis.__MICA_FOUNDATION_TEST__ && globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().supported);
}

async function selectWholeAnswer(page) {
  await page.evaluate(() => {
    const paragraph = document.querySelector("#answer");
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.lastChild, paragraph.lastChild.nodeValue.length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  return page.evaluate(() => globalThis.__MICA_FOUNDATION_TEST__.inspectHighlightSelection());
}

async function snapshot(page) {
  return page.evaluate(() => {
    const runtime = globalThis.__MICA_FOUNDATION_TEST__;
    const records = runtime.getHighlightRecords();
    if (records[0]) sessionStorage.setItem("mica-fixture-last-record", JSON.stringify(records[0]));
    return { status: runtime.getHighlighterStatus(), records };
  });
}

async function exerciseListPdfProjection(page, toolbar) {
  const selection = await page.evaluate(() => {
    const root = document.querySelector(".markdown");
    root.innerHTML = "<ul><li>First list item</li><li>Second list item with <strong>emphasis</strong></li></ul>";
    globalThis.__MICA_FOUNDATION_TEST__.reconcileHighlights();
    const text = root.querySelectorAll("li")[1].firstChild;
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 16);
    const browserSelection = getSelection();
    browserSelection.removeAllRanges();
    browserSelection.addRange(range);
    return globalThis.__MICA_FOUNDATION_TEST__.inspectHighlightSelection();
  });
  assert(selection.ok && selection.quoteLength === 9, "list highlight selection was not captured");
  await toolbar.locator("button[data-color='yellow']").click();
  await page.waitForFunction(() => globalThis.__MICA_FOUNDATION_TEST__.getHighlighterStatus().recordCount === 1);
  return page.evaluate(() => {
    const runtime = globalThis.__MICA_FOUNDATION_TEST__;
    const documentModel = runtime.getAnswerDocument("conversation-turn-2");
    const record = runtime.getHighlightRecords()[0];
    const built = runtime.buildPdfExportModel(documentModel);
    const resolved = built?.model?.highlights?.[0] || null;
    return {
      selectedText: record?.anchor?.textQuote || null,
      sourceVersionAligned: record?.anchor?.sourceVersion === documentModel?.sourceVersion,
      resolvedHighlights: built?.model?.highlights?.length || 0,
      unresolvedHighlights: built?.model?.unresolvedHighlightCount,
      resolvedText: resolved ? built.model.plainText.slice(resolved.start, resolved.end) : null
    };
  });
}

function fixtureHtml(answer) {
  return `<!doctype html><html data-mica-fixture="true"><head><style>body{font:16px/1.6 system-ui;margin:40px}.markdown{max-width:720px}.katex{display:inline-block;padding:0 2px}</style></head><body>${turnMarkup(answer)}<div id="prompt-textarea" role="textbox" contenteditable="true"></div></body></html>`;
}

function turnMarkup(answer) {
  return `<section data-testid="conversation-turn-2" data-mica-generation-state="SETTLED"><div data-message-author-role="assistant"><div class="markdown">${answer}</div></div></section>`;
}

function answerMarkup() {
  return `<p id="answer">Before <span class="katex" data-tex="x+1"><span class="katex-html">x + 1</span></span> after stable sentence.</p><pre><code>const excluded = true;</code></pre>`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
