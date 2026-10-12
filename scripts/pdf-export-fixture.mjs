import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const outputDir = path.join(root, "output", "pdf");
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "pdf-evidence");
const outputPdf = path.join(outputDir, "mica-answer-export-sample.pdf");
await mkdir(outputDir, { recursive: true });
await mkdir(evidenceDir, { recursive: true });

const bundledModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const bundledPython = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
const pdfJsDir = path.join(bundledModules, "pdfjs-dist", "build");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledModules, "playwright"));
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sourcePage = await context.newPage();
  await sourcePage.setContent(sourceFixtureHtml());
  for (const file of ["chatgpt-adapter.js", "answer-document.js", "highlight-engine.js", "pdf-export-model.js"]) {
    await sourcePage.addScriptTag({ path: path.join(distDir, file) });
  }
  const modelResult = await sourcePage.evaluate(() => {
    const turn = globalThis.MicaChatGPTAdapter.listTurns(document).find((item) => item.role === "assistant");
    const answer = globalThis.MicaAnswerDocument.fromAssistantTurn(turn, { conversationId: "conversation-pdf-fixture", generationState: "SETTLED" });
    const select = (startNode, endNode) => {
      const range = document.createRange();
      range.setStart(startNode, 0);
      range.setEnd(endNode, endNode.nodeValue.length);
      return globalThis.MicaAnswerDocument.captureHighlightSelection(turn, answer, range);
    };
    const first = document.querySelector("#baseline");
    const baseline = select(first.firstChild, first.lastChild);
    const paragraphs = [...document.querySelectorAll("[data-long]")];
    const long = select(paragraphs[0].firstChild, paragraphs.at(-1).lastChild);
    const records = [
      globalThis.MicaHighlightEngine.createRecord(answer, baseline, "yellow"),
      globalThis.MicaHighlightEngine.createRecord(answer, long, "mint")
    ];
    return {
      answer: { documentId: answer.documentId, sourceVersion: answer.sourceVersion, blocks: answer.orderedBlocks.length },
      baseline: { textQuote: baseline.textQuote, mathTeX: baseline.mathTeX },
      long: { quoteLength: long.textQuote.length },
      built: globalThis.MicaPdfExport.buildModel(answer, records)
    };
  });
  assert(modelResult.built.ok, `PDF model failed: ${modelResult.built.reason}`);
  const model = modelResult.built.model;
  assert(model.highlights.length === 2 && model.plainText.includes("Before x+1 after"), "PDF model did not retain the cross-math highlight");

  const exportPage = await context.newPage();
  await exportPage.setContent(await readFile(path.join(distDir, "pdf", "pdf-export.html"), "utf8"), { waitUntil: "load" });
  await exportPage.addStyleTag({ path: path.join(distDir, "pdf", "pdf-export.css") });
  await exportPage.addScriptTag({ path: path.join(distDir, "pdf", "pdf-export-page.js") });
  const rendered = await exportPage.evaluate((value) => globalThis.MicaPdfExportPage.renderModel(value), model);
  assert(rendered.ok, "PDF export page did not render the model");
  await exportPage.screenshot({ path: path.join(evidenceDir, "pdf-export-preview.png"), fullPage: true });
  await exportPage.pdf({ path: outputPdf, format: "A4", printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });

  const pdfBuffer = await readFile(outputPdf);
  assert(pdfBuffer.subarray(0, 5).toString() === "%PDF-", "browser output is not a PDF");
  const { stdout: pdfInfoText } = await run("pdfinfo", [outputPdf], { maxBuffer: 1024 * 1024 });
  const pageCount = Number(pdfInfoText.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
  assert(pageCount >= 2, "cross-page highlight fixture did not produce multiple PDF pages");

  const renderPrefix = path.join(evidenceDir, "pdf-render");
  await run("pdftoppm", ["-png", "-r", "120", outputPdf, renderPrefix], { maxBuffer: 16 * 1024 * 1024 });
  const renderedPages = (await readdir(evidenceDir)).filter((name) => /^pdf-render-\d+\.png$/.test(name)).sort();
  assert(renderedPages.length === pageCount, "Poppler did not render every generated PDF page");

  const viewer = await context.newPage();
  const viewerUrl = "https://pdfjs.mica.test/viewer";
  await viewer.route("https://pdfjs.mica.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/viewer") return route.fulfill({ status: 200, contentType: "text/html", body: pdfJsViewerHtml() });
    if (url.pathname === "/sample.pdf") return route.fulfill({ status: 200, contentType: "application/pdf", body: pdfBuffer });
    if (url.pathname === "/pdf.mjs") return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(path.join(pdfJsDir, "pdf.mjs")) });
    if (url.pathname === "/pdf.worker.mjs") return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(path.join(pdfJsDir, "pdf.worker.mjs")) });
    return route.fulfill({ status: 404, body: "not found" });
  });
  await viewer.goto(viewerUrl, { waitUntil: "load" });
  await viewer.waitForFunction(() => document.documentElement.dataset.ready === "true", null, { timeout: 30_000 });
  const pdfJsInitial = await viewer.evaluate(() => globalThis.__PDF_VIEWER_EVIDENCE__);
  assert(pdfJsInitial.pageCount === pageCount, "PDF.js page count differs from pdfinfo");

  const drag = await viewer.evaluate(() => globalThis.__PDF_VIEWER_POINTS__);
  assert(drag?.start && drag?.end, "PDF.js could not locate pointer-selection endpoints");
  await viewer.mouse.move(drag.start.x, drag.start.y);
  await viewer.mouse.down();
  await viewer.mouse.move(drag.end.x, drag.end.y, { steps: 24 });
  await viewer.mouse.up();
  const pointer = await viewer.evaluate(() => ({
    text: getSelection()?.toString() || "",
    trustedPointerDown: globalThis.__PDF_POINTER__.down,
    trustedPointerUp: globalThis.__PDF_POINTER__.up
  }));
  const normalizedPointer = normalize(pointer.text);
  assert(pointer.trustedPointerDown === 1 && pointer.trustedPointerUp === 1, "PDF viewer selection was not driven by trusted pointer events");
  assert(normalizedPointer.includes("Before x+1 after"), `pointer selection skipped prose/math/prose content: ${normalizedPointer}`);
  await viewer.screenshot({ path: path.join(evidenceDir, "pdfjs-pointer-selection.png"), fullPage: true });

  const programmatic = await viewer.evaluate(() => globalThis.__PDF_PROGRAMMATIC_SELECTION__());
  assert(normalize(programmatic.crossMath).includes("Before x+1 after"), "PDF.js text-layer cross-node selection skipped inline math");
  assert(normalize(programmatic.displayMath).includes("E=mc^2"), "PDF.js display math was not selectable");
  await viewer.screenshot({ path: path.join(evidenceDir, "pdfjs-display-math-selection.png"), fullPage: true });

  const { stdout: independentTextRaw } = await run(bundledPython, ["-c", "import pdfplumber,sys; p=pdfplumber.open(sys.argv[1]); print('\\n'.join((page.extract_text() or '') for page in p.pages)); p.close()", outputPdf], { maxBuffer: 8 * 1024 * 1024 });
  const independentText = normalize(independentTextRaw);
  assert(independentText.includes("Before x+1 after") && independentText.includes("E=mc^2"), "pdfplumber text extraction skipped mathematical content");

  const extracted = normalize(pdfJsInitial.text);
  const output = {
    passed: true,
    model: {
      documentId: model.documentId,
      sourceVersion: model.sourceVersion,
      blockCount: model.blocks.length,
      resolvedHighlights: model.highlights.length,
      unresolvedHighlights: model.unresolvedHighlightCount,
      mathFallback: model.mathFallback,
      baselineMathTeX: modelResult.baseline.mathTeX,
      crossPageQuoteLength: modelResult.long.quoteLength
    },
    pdf: {
      path: path.relative(root, outputPdf).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(pdfBuffer).digest("hex"),
      bytes: pdfBuffer.length,
      pageCount,
      pdfInfo: parsePdfInfo(pdfInfoText),
      renderedPages: renderedPages.map((name) => `results/mica-product-system-rebuild/pdf-evidence/${name}`)
    },
    pdfJs: {
      version: pdfJsInitial.version,
      pageCount: pdfJsInitial.pageCount,
      textExtracted: extracted.includes("Before x+1 after") && extracted.includes("E=mc^2"),
      searchable: extracted.includes("x+1") && extracted.includes("E=mc^2"),
      pointerSelection: normalizedPointer.includes("Before x+1 after"),
      pointerSelectionText: normalizedPointer,
      trustedPointerEvents: pointer.trustedPointerDown === 1 && pointer.trustedPointerUp === 1,
      pointerSequence: ["prose", "inline_math", "prose"],
      programmaticCrossNodeSelection: normalize(programmatic.crossMath),
      displayMathSelection: normalize(programmatic.displayMath),
      mathCopyResult: normalizedPointer.includes("x+1"),
      textLayerSpanCount: pdfJsInitial.textLayerSpanCount
    },
    independentExtraction: {
      engine: "pdfplumber",
      textExtracted: true,
      searchable: independentText.includes("x+1") && independentText.includes("E=mc^2"),
      crossMathText: independentText.match(/Before\s+x\+1\s+after/)?.[0] || null,
      displayMathText: independentText.includes("E=mc^2") ? "E=mc^2" : null
    },
    highlights: {
      preservedInPrintModel: model.highlights.length === 2,
      crossMath: model.highlights.some((item) => model.plainText.slice(item.start, item.end).includes("Before x+1 after")),
      crossPage: modelResult.long.quoteLength > 1000 && pageCount >= 2,
      visualStates: ["yellow-cross-math", "mint-cross-page"]
    },
    artifacts: {
      preview: "results/mica-product-system-rebuild/pdf-evidence/pdf-export-preview.png",
      pointerSelection: "results/mica-product-system-rebuild/pdf-evidence/pdfjs-pointer-selection.png",
      displayMathSelection: "results/mica-product-system-rebuild/pdf-evidence/pdfjs-display-math-selection.png"
    }
  };
  assert(output.pdfJs.textExtracted && output.pdfJs.searchable && output.independentExtraction.textExtracted && output.independentExtraction.searchable && output.highlights.crossMath && output.highlights.crossPage, "PDF hard-gate evidence is incomplete");
  await writeFile(path.join(evidenceDir, "pdf-export-fixture.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}

function sourceFixtureHtml() {
  const long = Array.from({ length: 24 }, (_, index) => `<p data-long="${index}">Section ${index + 1}: Stable highlighted context remains selectable across wrapped lines and printed pages while preserving local semantic ownership.</p>`).join("");
  return `<!doctype html><html data-mica-fixture="true"><body><section data-testid="conversation-turn-2" data-mica-generation-state="SETTLED"><div data-message-author-role="assistant"><div class="markdown"><h2>Selectable mathematics</h2><p id="baseline">Before <span class="katex" data-tex="x+1"><span class="katex-html">x+1</span></span> after the formula remains continuous.</p><div class="katex-display" data-tex="E=mc^2"><span class="katex-html">E=mc^2</span></div>${long}<blockquote><p>Highlights remain part of the exported reading flow.</p></blockquote><pre><code>const localOnly = true;</code></pre></div></div></section></body></html>`;
}

function pdfJsViewerHtml() {
  return `<!doctype html><html><head><style>
    body{margin:0;background:#68706d}.page{position:relative;margin:18px auto;background:#fff;box-shadow:0 6px 24px #0005}.page canvas{display:block}.textLayer{position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;transform-origin:0 0;caret-color:#111}.textLayer span,.textLayer br{position:absolute;color:transparent;white-space:pre;cursor:text;transform-origin:0 0}.textLayer ::selection{background:rgba(0,102,255,.35)}
  </style></head><body><main id="viewer"></main><script type="module">
    import { getDocument, GlobalWorkerOptions, TextLayer, version } from "/pdf.mjs";
    GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    const documentProxy = await getDocument("/sample.pdf").promise;
    const allText = [];
    let spans = 0;
    for (let number = 1; number <= documentProxy.numPages; number += 1) {
      const page = await documentProxy.getPage(number);
      const viewport = page.getViewport({ scale: 1.35 });
      const shell = document.createElement("section"); shell.className = "page"; shell.style.width = viewport.width + "px"; shell.style.height = viewport.height + "px";
      const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); shell.append(canvas);
      const layer = document.createElement("div"); layer.className = "textLayer"; shell.append(layer); document.querySelector("#viewer").append(shell);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const textContent = await page.getTextContent(); allText.push(...textContent.items.map(item => item.str));
      await new TextLayer({ textContentSource: textContent, container: layer, viewport }).render(); spans += layer.querySelectorAll("span").length;
    }
    globalThis.__PDF_POINTER__ = { down: 0, up: 0 };
    document.addEventListener("pointerdown", event => { if (event.isTrusted && event.target.closest?.(".textLayer")) globalThis.__PDF_POINTER__.down += 1; }, true);
    document.addEventListener("pointerup", event => { if (event.isTrusted && event.target.closest?.(".textLayer")) globalThis.__PDF_POINTER__.up += 1; }, true);
    const locate = (needle, atEnd = false) => {
      for (const span of document.querySelectorAll(".textLayer span")) {
        const index = span.textContent.indexOf(needle); if (index < 0 || !span.firstChild) continue;
        const offset = atEnd ? index + needle.length - 1 : index;
        const range = document.createRange(); range.setStart(span.firstChild, offset); range.setEnd(span.firstChild, offset + 1);
        const rect = range.getBoundingClientRect(); return { x: atEnd ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
      }
      return null;
    };
    globalThis.__PDF_VIEWER_POINTS__ = { start: locate("Before"), end: locate("after", true) };
    const selectText = (startNeedle, endNeedle) => {
      let startNode, startOffset, endNode, endOffset;
      for (const span of document.querySelectorAll(".textLayer span")) {
        const text = span.textContent || "";
        if (!startNode && text.includes(startNeedle)) { startNode = span.firstChild; startOffset = text.indexOf(startNeedle); }
        if (text.includes(endNeedle)) { endNode = span.firstChild; endOffset = text.indexOf(endNeedle) + endNeedle.length; break; }
      }
      if (!startNode || !endNode) return "";
      const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString();
    };
    globalThis.__PDF_PROGRAMMATIC_SELECTION__ = () => ({ crossMath: selectText("Before", "after"), displayMath: selectText("E=mc^2", "E=mc^2") });
    globalThis.__PDF_VIEWER_EVIDENCE__ = { version, pageCount: documentProxy.numPages, text: allText.join(" "), textLayerSpanCount: spans };
    document.documentElement.dataset.ready = "true";
  </script></body></html>`;
}

function parsePdfInfo(value) {
  const wanted = new Set(["Pages", "Page size", "Tagged", "JavaScript", "PDF version"]);
  return Object.fromEntries(value.split(/\r?\n/).map((line) => line.match(/^([^:]+):\s*(.*)$/)).filter((match) => match && wanted.has(match[1])).map((match) => [match[1], match[2]]));
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
