import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "foundation-adapter-answer-document.html");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  await page.addInitScript(() => {
    globalThis.chrome = {
      runtime: { lastError: null, onMessage: { addListener: () => {} } },
      storage: { local: { get: (_keys, callback) => callback({ enabled: true }), set: (_value, callback) => callback?.() } }
    };
  });
  await page.goto(pathToFileURL(fixturePath).href, { waitUntil: "load" });
  await page.addScriptTag({ path: path.join(distDir, "chatgpt-adapter.js") });
  await page.addScriptTag({ path: path.join(distDir, "answer-document.js") });
  await page.addScriptTag({ path: path.join(distDir, "content.js") });
  await page.waitForFunction(() => !!globalThis.__MICA_FOUNDATION_TEST__);

  const result = await page.evaluate(async () => {
    const adapter = globalThis.MicaChatGPTAdapter;
    const model = globalThis.MicaAnswerDocument;
    const inspection = adapter.inspect(document);
    const turns = adapter.listTurns(document);
    const assistant = turns.find((turn) => turn.role === "assistant");
    const settled = model.fromAssistantTurn(assistant, { conversationId: "fixture-conversation", generationState: "SETTLED" });
    const streaming = model.fromAssistantTurn(assistant, { conversationId: "fixture-conversation", generationState: "STREAMING" });
    const cluster = adapter.findAssistantActionCluster(assistant);
    const composer = adapter.findComposer(document);
    const originalHtml = assistant.answerRoot.innerHTML;
    assistant.answerRoot.querySelector("h2").textContent = "Edited answer";
    const edited = model.fromAssistantTurn(assistant, { conversationId: "fixture-conversation", generationState: "SETTLED" });
    assistant.answerRoot.innerHTML = originalHtml;
    const remountedTurn = adapter.listTurns(document).find((turn) => turn.role === "assistant");
    const remounted = model.fromAssistantTurn(remountedTurn, { conversationId: "fixture-conversation", generationState: "SETTLED" });
    const branched = model.fromAssistantTurn(remountedTurn, { conversationId: "fixture-branch", generationState: "SETTLED" });
    const runtime = globalThis.__MICA_FOUNDATION_TEST__;
    const qaReport = runtime.buildSanitizedQaReport();
    const answerViaRuntime = runtime.getAnswerDocument("conversation-turn-2", "SETTLED");
    let synchronousDocumentQueries = 0;
    const originalQuerySelectorAll = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (...args) {
      synchronousDocumentQueries += 1;
      return originalQuerySelectorAll.apply(this, args);
    };
    document.getElementById("prompt-textarea").dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    Document.prototype.querySelectorAll = originalQuerySelectorAll;
    await runtime.applySettings({ enabled: false });
    const disabledReport = runtime.buildSanitizedQaReport();
    await runtime.applySettings({ enabled: true });
    return {
      contractHash: adapter.contractHash,
      status: inspection.status,
      turnRoles: turns.map((turn) => turn.role),
      composerVariant: composer?.variantId,
      clusterVariant: cluster?.variantId,
      settled,
      streaming,
      editedSourceVersion: edited.sourceVersion,
      remounted,
      branchedDocumentId: branched.documentId,
      qaReport,
      answerViaRuntime,
      synchronousDocumentQueries,
      disabledReport
    };
  });

  assert(pageErrors.length === 0, `foundation core page errors: ${pageErrors.join(" | ")}`);
  assert(/^[0-9a-f]{64}$/.test(result.contractHash), "built adapter contract hash is not a SHA-256");
  assert(result.status === "EXACT", `expected EXACT fixture inspection, got ${result.status}`);
  assert(JSON.stringify(result.turnRoles) === JSON.stringify(["user", "assistant"]), "turn ordering/role ownership failed");
  assert(result.composerVariant === "prompt-textarea-contenteditable-v1", "composer contract did not use the property-backed variant");
  assert(result.clusterVariant === "native-copy-button-parent-v1", "assistant action cluster was not proven");
  assert(result.settled?.producedBy === "MicaChatGPTAdapter", "AnswerDocument producer identity drifted");
  assert(result.settled?.durable === true && result.streaming?.durable === false, "streaming/settled durability contract failed");
  assert(result.settled?.documentId === result.remounted?.documentId, "remount changed AnswerDocument identity");
  assert(result.settled?.sourceVersion === result.remounted?.sourceVersion, "remount changed stable source version");
  assert(result.editedSourceVersion !== result.settled?.sourceVersion, "edit did not change source version");
  assert(result.branchedDocumentId !== result.settled?.documentId, "branch did not change document identity");
  assert(result.answerViaRuntime?.producedBy === "MicaChatGPTAdapter", "content runtime bypassed the single AnswerDocument producer");
  assert(result.synchronousDocumentQueries === 0, "ordinary input synchronously queried the document");
  assert(result.disabledReport.runtime.enabled === false && result.disabledReport.runtime.observerActive === false, "disabling Mica left the observer active");
  const reportText = JSON.stringify(result.qaReport);
  assert(!reportText.includes("Fixture question") && !reportText.includes("Structured answer") && !reportText.includes("const value"), "sanitized QA report leaked conversation content");
  assert(result.qaReport.privacy.conversationTextIncluded === false && result.qaReport.privacy.rawDomIncluded === false, "sanitized QA privacy flags drifted");
  assert(result.settled?.orderedBlocks.every((block, index) => block.order === index && block.sourceSpan.start <= block.sourceSpan.end), "block ordering/source spans failed");

  const kinds = new Set(result.settled?.orderedBlocks.map((block) => block.kind));
  for (const kind of ["heading", "paragraph", "display_math", "list", "quote", "table", "code", "opaque_interactive", "unknown_block"]) {
    assert(kinds.has(kind), `AnswerDocument missing ${kind}`);
  }
  const paragraphRuns = result.settled.orderedBlocks.filter((block) => block.kind === "paragraph").flatMap((block) => block.inlines || []);
  for (const kind of ["inline_math", "link", "citation", "image"]) {
    assert(paragraphRuns.some((run) => run.kind === kind), `AnswerDocument missing inline ${kind}`);
  }
  const inlineMath = paragraphRuns.find((run) => run.kind === "inline_math");
  assert(inlineMath.rawTeX === "x+1" && inlineMath.renderedText.includes("x"), "inline math did not preserve raw/rendered forms");
  const displayMath = result.settled.orderedBlocks.find((block) => block.kind === "display_math");
  assert(displayMath.rawTeX === "E=mc^2" && displayMath.renderedText.includes("E"), "display math did not preserve raw/rendered forms");

  await page.setContent("<!doctype html><html data-mica-fixture='true'><body><section data-testid='conversation-turn-bad'><div data-message-author-role='user'></div><div data-message-author-role='assistant'></div></section></body></html>");
  const invalidResult = await page.evaluate(() => globalThis.MicaChatGPTAdapter.inspect(document));
  assert(invalidResult.status === "UNKNOWN", "ambiguous role ownership did not fail open");
  assert(invalidResult.turns.length === 0, "ambiguous turn was not rejected");

  const output = {
    passed: true,
    contractHash: result.contractHash,
    status: result.status,
    blockKinds: [...kinds],
    inlineKinds: [...new Set(paragraphRuns.map((run) => run.kind))],
    invalidStructureStatus: invalidResult.status,
    privacy: result.qaReport.privacy,
    typingHotPath: { synchronousDocumentQueries: result.synchronousDocumentQueries },
    disabledRuntime: { enabled: result.disabledReport.runtime.enabled, observerActive: result.disabledReport.runtime.observerActive }
  };
  const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "foundation-evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, "foundation-core.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
