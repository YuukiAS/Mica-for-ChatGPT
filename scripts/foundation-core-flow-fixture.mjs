import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "foundation-core-flow.html");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  await page.addInitScript(() => {
    globalThis.chrome = {
      runtime: { lastError: null, onMessage: { addListener: () => {} } },
      storage: { local: { get: (_keys, callback) => callback({ enabled: true }), set: (_value, callback) => callback?.() } }
    };
  });
  await page.goto(pathToFileURL(fixturePath).href, { waitUntil: "load" });
  for (const script of ["chatgpt-adapter.js", "answer-document.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(distDir, script) });
  }
  await page.waitForFunction(() => !!globalThis.__MICA_FOUNDATION_TEST__);

  const result = await page.evaluate(async () => {
    const inputEvents = [];
    const composer = document.getElementById("prompt-textarea");
    for (const type of ["keydown", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"]) {
      composer.addEventListener(type, (event) => inputEvents.push({ type, defaultPrevented: event.defaultPrevented }));
      const event = type === "keydown"
        ? new KeyboardEvent(type, { key: "a", bubbles: true, cancelable: true })
        : type.startsWith("composition")
          ? new CompositionEvent(type, { data: "字", bubbles: true, cancelable: true })
          : new InputEvent(type, { data: "a", inputType: "insertText", bubbles: true, cancelable: true });
      composer.dispatchEvent(event);
    }
    composer.textContent = "Send fixture";
    document.getElementById("connector").click();
    document.getElementById("connector-option").click();
    document.getElementById("file").click();
    document.getElementById("tool").click();
    document.getElementById("auth").click();
    document.getElementById("send").click();
    await new Promise((resolve) => setTimeout(resolve, 180));

    const adapter = globalThis.MicaChatGPTAdapter;
    const runtime = globalThis.__MICA_FOUNDATION_TEST__;
    const afterSendTurns = adapter.listTurns(document);
    const streamingTurn = afterSendTurns.find((turn) => turn.element.dataset.streaming === "true");
    const streamingDocument = runtime.getAnswerDocument(streamingTurn.turnId);
    globalThis.foundationFlowFixture.completeStreaming();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const settledTurn = adapter.listTurns(document).find((turn) => turn.turnId === streamingTurn.turnId);
    const settledDocument = runtime.getAnswerDocument(settledTurn.turnId);
    const initialTurn = adapter.listTurns(document).find((turn) => turn.turnId === "conversation-turn-2");
    const initialVersion = runtime.getAnswerDocument(initialTurn.turnId).sourceVersion;
    globalThis.foundationFlowFixture.editAnswer();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const editedTurn = adapter.listTurns(document).find((turn) => turn.turnId === "conversation-turn-2");
    const editedVersion = runtime.getAnswerDocument(editedTurn.turnId).sourceVersion;
    globalThis.foundationFlowFixture.branchAnswer();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const finalTurns = adapter.listTurns(document);
    const report = runtime.buildSanitizedQaReport();
    return {
      inputEvents,
      counters: { ...globalThis.foundationFlowFixture.counters },
      composerPresent: !!adapter.findComposer(document),
      connectorChooserVisible: !document.getElementById("connector-chooser").hidden,
      afterSendTurnCount: afterSendTurns.length,
      finalTurnCount: finalTurns.length,
      streamingDurable: streamingDocument.durable,
      settledDurable: settledDocument.durable,
      initialVersion,
      editedVersion,
      status: adapter.inspect(document).status,
      report
    };
  });

  assert(errors.length === 0, `core-flow page errors: ${errors.join(" | ")}`);
  assert(result.inputEvents.length === 6 && result.inputEvents.every((event) => !event.defaultPrevented), "typing/IME event was intercepted");
  assert(result.counters.sends === 1, "send flow did not commit exactly once");
  assert(result.counters.connectorSelections === 1, "connector flow regressed");
  assert(result.counters.fileClicks === 1 && result.counters.toolClicks === 1 && result.counters.authClicks === 1, "tool/file/auth flow regressed");
  assert(result.composerPresent && result.connectorChooserVisible, "composer or connector UI was lost");
  assert(result.afterSendTurnCount === 4 && result.finalTurnCount === 5, "send/branch turn structure drifted");
  assert(result.streamingDurable === false && result.settledDurable === true, "streaming/settled lifecycle drifted");
  assert(result.initialVersion !== result.editedVersion, "edit did not reconcile AnswerDocument source version");
  assert(result.status === "EXACT", "core-flow fixture no longer matches the adapter contract");
  assert(result.report.privacy.conversationTextIncluded === false && result.report.privacy.rawDomIncluded === false, "core-flow QA report privacy drifted");

  const output = {
    passed: true,
    ...result,
    coreFlows: {
      composer: result.composerPresent,
      send: result.counters.sends === 1,
      streaming: result.streamingDurable === false && result.settledDurable === true,
      editBranch: result.initialVersion !== result.editedVersion && result.finalTurnCount === 5,
      connector: result.counters.connectorSelections === 1 && result.connectorChooserVisible,
      toolFileAuth: result.counters.fileClicks === 1 && result.counters.toolClicks === 1 && result.counters.authClicks === 1
    },
    sendLifecycle: {
      progressObserved: result.streamingDurable === false,
      autoResendObserved: result.counters.sends > 1,
      consequentialFlowActive: result.counters.connectorSelections === 1 || result.counters.fileClicks === 1 || result.counters.toolClicks === 1 || result.counters.authClicks === 1,
      userTurnCommitted: result.afterSendTurnCount >= 4,
      duplicateSendObserved: result.counters.sends > 1
    },
    report: { schema: result.report.schema, privacy: result.report.privacy }
  };
  const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "foundation-evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, "foundation-flows.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
