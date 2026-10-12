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
      runtime: {
        lastError: null,
        onMessage: { addListener: () => {} },
        sendMessage: (message, callback) => callback?.(message.type === "MICA_LOW_MEMORY_GET_TAB_MODE" ? { ok: true, mode: "windowing" } : { ok: true, registered: true })
      },
      storage: { local: { get: (_keys, callback) => callback({ enabled: true }), set: (_value, callback) => callback?.() } }
    };
  });
  await page.goto(pathToFileURL(fixturePath).href, { waitUntil: "load" });
  for (const script of ["low-memory-core.js", "low-memory-page.js"]) {
    await page.addScriptTag({ path: path.join(distDir, script) });
  }
  await page.evaluate(() => {
    const mapping = { root: { id: "root", children: [] } };
    let parent = "root";
    for (let index = 1; index <= 120; index += 1) {
      const id = `flow-turn-${index}`;
      mapping[parent].children.push(id);
      const role = index === 110 ? "tool" : index % 2 ? "user" : "assistant";
      const contentType = index === 110 ? "execution_output" : index === 112 ? "multimodal_text" : "text";
      mapping[id] = { id, parent, children: [], message: {
        author: { role },
        content: { content_type: contentType, parts: index === 112 ? [{ content_type: "image_asset_pointer", asset_pointer: "fixture" }, "flow"] : ["flow"] },
        metadata: index === 112 ? { connector_id: "fixture", plugin_ids: ["fixture"], attachments: [{ id: "file-fixture" }], auth: { required: true } } : {},
        ...(index === 120 ? { status: "in_progress", end_turn: false } : {})
      } };
      parent = id;
    }
    const flat = [];
    const strings = new Map();
    const seen = new Map();
    encode({ loaderData: { route: { serverResponse: { data: { mapping, current_node: parent, root: "root" } } } } }, 0);
    globalThis.__reactRouterContext = {};
    globalThis.__reactRouterContext.streamController = { enqueue: (chunk) => { globalThis.__flowWindowedChunk = chunk; } };
    globalThis.__reactRouterContext.streamController.enqueue(JSON.stringify(flat));

    function encode(value, forcedIndex = null) {
      if (typeof value === "string") return encodeString(value);
      if (value && typeof value === "object" && seen.has(value)) return seen.get(value);
      const index = forcedIndex == null ? flat.length : forcedIndex;
      if (forcedIndex == null) flat.push(null); else while (flat.length <= forcedIndex) flat.push(null);
      if (value && typeof value === "object") seen.set(value, index);
      if (Array.isArray(value)) flat[index] = value.map((item) => encode(item));
      else if (value && typeof value === "object") {
        const object = {}; flat[index] = object;
        for (const [key, item] of Object.entries(value)) object[`_${encodeString(key)}`] = encode(item);
      } else flat[index] = value;
      return index;
    }
    function encodeString(value) {
      if (strings.has(value)) return strings.get(value);
      const index = flat.length; flat.push(value); strings.set(value, index); return index;
    }
  });
  for (const script of ["low-memory-config.js", "chatgpt-adapter.js", "answer-document.js", "content.js"]) {
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
    const windowed = decodeTurbo(JSON.parse(globalThis.__flowWindowedChunk)).loaderData.route.serverResponse.data;
    const windowedNodes = Object.values(windowed.mapping);
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
      lowMemory: runtime.getLowMemoryStatus(),
      windowedGraphFlows: {
        tool: windowedNodes.some((node) => node.message?.author?.role === "tool" && node.message?.content?.content_type === "execution_output"),
        fileAuthConnectorPlugin: windowedNodes.some((node) => node.message?.metadata?.auth?.required === true && node.message?.metadata?.connector_id === "fixture" && node.message?.metadata?.plugin_ids?.[0] === "fixture"),
        multimodal: windowedNodes.some((node) => node.message?.content?.content_type === "multimodal_text"),
        streamingContinuation: windowed.mapping[windowed.current_node]?.message?.status === "in_progress" && windowed.mapping[windowed.current_node]?.message?.end_turn === false
      },
      report
    };

    function decodeTurbo(flat) {
      const cache = new Map(); return decode(0);
      function decode(index) {
        if (cache.has(index)) return cache.get(index);
        const value = flat[index];
        if (Array.isArray(value)) { const array = []; cache.set(index, array); for (const item of value) array.push(Number.isInteger(item) && item >= 0 ? decode(item) : item); return array; }
        if (value && typeof value === "object") { const object = {}; cache.set(index, object); for (const [key, item] of Object.entries(value)) object[flat[Number(key.slice(1))]] = Number.isInteger(item) && item >= 0 ? decode(item) : item; return object; }
        return value;
      }
    }
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
  assert(result.lowMemory.active === true && result.lowMemory.actualTruncation === true, "core-flow fixture did not run with active Low Memory windowing");
  assert(Object.values(result.windowedGraphFlows).every(Boolean), "windowed graph did not preserve tool/file/auth/connector/plugin/multimodal/streaming structures");
  assert(result.report.privacy.conversationTextIncluded === false && result.report.privacy.rawDomIncluded === false, "core-flow QA report privacy drifted");

  const output = {
    passed: true,
    ...result,
    coreFlows: {
      composer: result.composerPresent,
      send: result.counters.sends === 1,
      streaming: result.streamingDurable === false && result.settledDurable === true && result.windowedGraphFlows.streamingContinuation,
      editBranch: result.initialVersion !== result.editedVersion && result.finalTurnCount === 5,
      connector: result.counters.connectorSelections === 1 && result.connectorChooserVisible && result.windowedGraphFlows.fileAuthConnectorPlugin,
      toolFileAuth: result.counters.fileClicks === 1 && result.counters.toolClicks === 1 && result.counters.authClicks === 1 && result.windowedGraphFlows.tool && result.windowedGraphFlows.multimodal,
      typingImeHotPath: result.inputEvents.length === 6 && result.inputEvents.every((event) => !event.defaultPrevented)
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
