import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const browser = await chromium.launch({ headless: true });
const fixtureUrl = "https://chatgpt.com/c/fixture-answer-context";

try {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await context.route("**/*", async (route) => {
    if (route.request().url() === fixtureUrl) await route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml() });
    else await route.fulfill({ status: 404, body: "not found" });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  await page.addInitScript(() => {
    const listeners = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { async writeText(value) { sessionStorage.setItem("mica-context-clipboard", String(value)); } }
    });
    globalThis.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener(listener) { listeners.push(listener); } },
        sendMessage(message, callback) {
          if (message?.type === "MICA_ANSWER_CONTEXT") sessionStorage.setItem("mica-answer-context-message", JSON.stringify(message));
          if (message?.type === "MICA_OPEN_PDF_EXPORT") sessionStorage.setItem("mica-answer-context-pdf", JSON.stringify(message));
          callback?.({ ok: true, tabId: message?.type === "MICA_OPEN_PDF_EXPORT" ? 42 : undefined });
        }
      },
      storage: {
        local: {
          get(_defaults, callback) { callback({ enabled: true, lowMemory: false, copyExport: true, highlighter: false }); },
          set(_value, callback) { callback?.(); }
        }
      }
    };
    globalThis.__MICA_SEND_CONTENT_MESSAGE__ = (message) => new Promise((resolve) => {
      let resolved = false;
      const sendResponse = (value) => { if (!resolved) { resolved = true; resolve(value); } };
      for (const listener of listeners) {
        const result = listener(message, {}, sendResponse);
        if (result === true) return;
        if (resolved) return;
      }
      resolve(undefined);
    });
  });

  await page.goto(fixtureUrl, { waitUntil: "load" });
  for (const file of ["settings-model.js", "chatgpt-adapter.js", "answer-document.js", "answer-serializer.js", "pdf-export-model.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(distDir, file) });
  }
  await page.waitForFunction(() => !!globalThis.__MICA_FOUNDATION_TEST__);

  await page.locator("#answer").click({ button: "right" });
  const exactContext = await readContext(page);
  assert(exactContext?.context?.evidenceClass === "EXACT" && exactContext.context.turnId === "conversation-turn-2", "trusted right-click did not resolve one settled assistant answer");
  assert(JSON.stringify(exactContext).includes("Before"), "context message unexpectedly included answer text", false);

  const copyResult = await runAction(page, exactContext.context, "markdown");
  const copied = await page.evaluate(() => sessionStorage.getItem("mica-context-clipboard"));
  assert(copyResult?.ok === true && copied?.includes("Before") && copied?.includes("x+1"), "context-menu Markdown copy did not reach the real serializer and clipboard path");
  const replayResult = await runAction(page, exactContext.context, "markdown");
  assert(replayResult?.ok === false, "one trusted answer context could be replayed");

  await page.locator("#answer").click({ button: "right" });
  const pdfContext = await readContext(page);
  const pdfResult = await runAction(page, pdfContext.context, "pdf");
  const pdfHandoff = await page.evaluate(() => JSON.parse(sessionStorage.getItem("mica-answer-context-pdf") || "null"));
  assert(pdfResult?.ok === true && pdfHandoff?.model?.localOnly === true && pdfHandoff?.model?.plainText?.includes("Before x+1 after"), "context-menu PDF action did not reach the trusted local handoff");

  await page.locator("#outside").click({ button: "right" });
  const outsideContext = await readContext(page);
  assert(outsideContext?.context === null, "right-click outside an assistant answer left actions enabled");

  await page.evaluate(() => { document.querySelector("section").dataset.micaGenerationState = "STREAMING"; });
  await page.locator("#answer").click({ button: "right" });
  const streamingContext = await readContext(page);
  assert(streamingContext?.context === null, "streaming answer exposed context actions");
  await page.evaluate(() => { document.querySelector("section").dataset.micaGenerationState = "SETTLED"; });

  await page.evaluate(() => {
    const duplicate = document.querySelector("section").cloneNode(true);
    duplicate.querySelector("#answer").id = "duplicate-answer";
    document.body.append(duplicate);
  });
  await page.locator("#duplicate-answer").click({ button: "right" });
  const ambiguousContext = await readContext(page);
  assert(ambiguousContext?.context === null, "duplicate turn identity did not fail open");

  const output = {
    passed: true,
    trustedRightClickExact: true,
    markdownCopied: true,
    pdfHandoff: true,
    replayRejected: true,
    outsideAnswerRejected: true,
    streamingRejected: true,
    ambiguousTurnRejected: true,
    conversationTextIncludedInContextMessage: false,
    pageErrors
  };
  assert(pageErrors.length === 0, `answer context fixture page errors: ${pageErrors.join(" | ")}`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}

async function readContext(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("mica-answer-context-message") || "null"));
}

async function runAction(page, context, action) {
  return page.evaluate(({ context, action }) => globalThis.__MICA_SEND_CONTENT_MESSAGE__({
    type: "MICA_RUN_ANSWER_CONTEXT_ACTION",
    action,
    turnId: context.turnId,
    observedAt: context.observedAt,
    evidenceClass: "EXACT"
  }), { context, action });
}

function fixtureHtml() {
  return `<!doctype html><html data-mica-fixture="true"><body>
    <section data-testid="conversation-turn-2" data-mica-generation-state="SETTLED">
      <div data-message-author-role="assistant"><div class="markdown"><p id="answer">Before <span class="katex" data-tex="x+1"><span class="katex-html">x + 1</span></span> after stable sentence.</p></div></div>
    </section>
    <div id="outside">Outside answer</div>
    <div id="prompt-textarea" role="textbox" contenteditable="true"></div>
  </body></html>`;
}

function assert(condition, message, expected = true) {
  if ((!!condition) !== expected) throw new Error(message);
}
