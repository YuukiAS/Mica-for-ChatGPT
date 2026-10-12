import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext();
  await context.route("https://chatgpt.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (/^\/backend-api\/conversation\//.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeConversation(160, 2048)) });
    } else {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html data-mica-fixture='true'><body><main id='main'></main><div id='prompt-textarea' role='textbox' contenteditable='true'></div></body></html>" });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  await page.goto("https://chatgpt.com/fixture", { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.setItem("mica.lowMemory.config.v2", JSON.stringify({ enabled: true, keepCount: 40, threshold: 80, updatedAt: Date.now() }));
    for (let index = 0; index < 120; index += 1) {
      const turn = document.createElement("section");
      turn.dataset.testid = `conversation-turn-${index}`;
      document.getElementById("main").append(turn);
    }
  });
  await page.addScriptTag({ path: path.join(distDir, "low-memory-core.js") });
  await page.addScriptTag({ path: path.join(distDir, "low-memory-page.js") });
  const result = await page.evaluate(async () => {
    const conversation = makeConversation(160, 2048);
    const flat = encodeTurbo({ loaderData: { route: { serverResponse: { data: conversation } } } });
    const delivered = [];
    globalThis.__reactRouterContext = {};
    globalThis.__reactRouterContext.streamController = { enqueue: (chunk) => delivered.push(chunk) };
    globalThis.__reactRouterContext.streamController.enqueue(JSON.stringify(flat));
    const streamGraph = JSON.parse(delivered[0]);
    const streamConversation = decodeTurbo(streamGraph).loaderData.route.serverResponse.data;
    const streamStatus = JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status"));
    const domTurnsAfterStream = document.querySelectorAll("[data-testid^='conversation-turn-']").length;

    const response = await fetch("/backend-api/conversation/fixture");
    const jsonConversation = await response.json();
    const jsonStatus = JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status"));

    sessionStorage.setItem("mica.lowMemory.bypass.v2", `${location.origin}${location.pathname}`);
    const bypassResponse = await fetch("/backend-api/conversation/fixture");
    const bypassConversation = await bypassResponse.json();
    sessionStorage.removeItem("mica.lowMemory.bypass.v2");
    dispatchEvent(new CustomEvent("mica-low-memory-config", { detail: JSON.stringify({ enabled: false, keepCount: 40, threshold: 80, updatedAt: Date.now() }) }));
    const disabledResponse = await fetch("/backend-api/conversation/fixture");
    const disabledConversation = await disabledResponse.json();
    sessionStorage.setItem("mica.lowMemory.bypass.v2", `${location.origin}${location.pathname}`);

    let documentQueries = 0;
    const originalQuerySelectorAll = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (...args) { documentQueries += 1; return originalQuerySelectorAll.apply(this, args); };
    const editor = document.getElementById("prompt-textarea");
    for (const type of ["keydown", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"]) {
      editor.dispatchEvent(type === "keydown" ? new KeyboardEvent(type, { key: "a", bubbles: true }) : type.startsWith("composition") ? new CompositionEvent(type, { data: "字", bubbles: true }) : new InputEvent(type, { data: "a", bubbles: true }));
    }
    Document.prototype.querySelectorAll = originalQuerySelectorAll;

    return {
      stream: {
        deliveredChunks: delivered.length,
        inputEntries: flat.length,
        outputEntries: streamGraph.length,
        mappingNodes: Object.keys(streamConversation.mapping).length,
        currentPreserved: !!streamConversation.mapping[streamConversation.current_node],
        status: streamStatus
      },
      json: {
        mappingNodes: Object.keys(jsonConversation.mapping).length,
        currentPreserved: !!jsonConversation.mapping[jsonConversation.current_node],
        status: jsonStatus
      },
      bypass: { mappingNodes: Object.keys(bypassConversation.mapping).length },
      disabled: { mappingNodes: Object.keys(disabledConversation.mapping).length },
      domTurnsAfterStream,
      documentQueriesDuringTyping: documentQueries
    };

    function makeConversation(visibleTurns, heavyBytes) {
      const mapping = { root: { id: "root", children: [] } };
      let parent = "root";
      for (let index = 1; index <= visibleTurns; index += 1) {
        const id = `turn-${index}`;
        mapping[parent].children.push(id);
        mapping[id] = {
          id,
          parent,
          children: [],
          message: { author: { role: index % 2 ? "user" : "assistant" }, content: { content_type: "text", parts: ["x".repeat(heavyBytes)] }, metadata: {} }
        };
        parent = id;
      }
      return { mapping, current_node: parent, root: "root" };
    }

    function encodeTurbo(value) {
      const flat = [];
      const seen = new Map();
      const strings = new Map();
      encode(value, 0);
      return flat;
      function encode(item, forcedIndex = null) {
        if (typeof item === "string") return encodeString(item);
        if (item && typeof item === "object" && seen.has(item)) return seen.get(item);
        const index = forcedIndex == null ? flat.length : forcedIndex;
        if (forcedIndex == null) flat.push(null); else while (flat.length <= forcedIndex) flat.push(null);
        if (item && typeof item === "object") seen.set(item, index);
        if (Array.isArray(item)) flat[index] = item.map(encode);
        else if (item && typeof item === "object") {
          const object = {}; flat[index] = object;
          for (const [key, entry] of Object.entries(item)) object[`_${encodeString(key)}`] = encode(entry);
        } else flat[index] = item;
        return index;
      }
      function encodeString(value) {
        if (strings.has(value)) return strings.get(value);
        const index = flat.length; flat.push(value); strings.set(value, index); return index;
      }
    }

    function decodeTurbo(flat) {
      const cache = new Map();
      return decode(0);
      function decode(index) {
        if (cache.has(index)) return cache.get(index);
        const value = flat[index];
        if (Array.isArray(value)) {
          const array = []; cache.set(index, array);
          for (const item of value) array.push(Number.isInteger(item) && item >= 0 ? decode(item) : item);
          return array;
        }
        if (value && typeof value === "object") {
          const object = {}; cache.set(index, object);
          for (const [key, item] of Object.entries(value)) object[flat[Number(key.slice(1))]] = Number.isInteger(item) && item >= 0 ? decode(item) : item;
          return object;
        }
        return value;
      }
    }
  });

  await page.evaluate(() => {
    globalThis.chrome = {
      runtime: { lastError: null, onMessage: { addListener: () => {} } },
      storage: {
        local: {
          get: (_defaults, callback) => callback({ enabled: true, lowMemory: true, lowMemoryKeepCount: 40, lowMemoryThreshold: 80 }),
          set: (_value, callback) => callback?.()
        },
        onChanged: { addListener: () => {} }
      }
    };
  });
  for (const script of ["chatgpt-adapter.js", "answer-document.js", "low-memory-config.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(distDir, script) });
  }
  await page.waitForFunction(() => !!globalThis.__MICA_FOUNDATION_TEST__);
  result.historyControl = await page.evaluate(async () => {
    dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const host = document.querySelector("[data-mica-ui='low-memory-history']");
    return {
      connectedAtTop: !!host?.isConnected,
      visibleAtTop: !!host?.getClientRects().length,
      buttonPresent: !!host?.shadowRoot?.querySelector("button"),
      bypassSet: globalThis.MicaLowMemoryConfig?.isFullHistoryBypassed?.() === true
    };
  });

  await page.reload({ waitUntil: "load" });
  result.reload = await page.evaluate(() => ({ bypassPersisted: sessionStorage.getItem("mica.lowMemory.bypass.v2") === `${location.origin}${location.pathname}` }));

  assert(errors.length === 0, `page interception errors: ${errors.join(" | ")}`);
  assert(result.stream.deliveredChunks === 1 && result.stream.outputEntries < result.stream.inputEntries, "document-start stream interceptor did not compact the graph");
  assert(result.stream.currentPreserved && result.stream.status.active && result.stream.status.source === "react-router-stream", "stream status/current node invariant failed");
  assert(result.json.mappingNodes < 161 && result.json.currentPreserved && result.json.status.source === "conversation-json", "JSON fetch fallback did not window the graph");
  assert(result.bypass.mappingNodes === 161, "full-history bypass did not restore the native payload");
  assert(result.disabled.mappingNodes === 161, "disabling Low Memory did not restore the native payload");
  assert(result.reload.bypassPersisted, "full-history bypass did not survive reload");
  assert(result.historyControl.connectedAtTop && result.historyControl.visibleAtTop && result.historyControl.buttonPresent && result.historyControl.bypassSet, "scroll-up history recovery control was not available");
  assert(result.domTurnsAfterStream === 120, "Low Memory detached React-managed DOM turns");
  assert(result.documentQueriesDuringTyping === 0, "Low Memory added document queries to the typing/IME path");

  const output = { passed: true, ...result };
  const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, "low-memory-page-interception.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
  await context.close();
} finally {
  await browser.close();
}

function makeConversation(visibleTurns, heavyBytes) {
  const mapping = { root: { id: "root", children: [] } };
  let parent = "root";
  for (let index = 1; index <= visibleTurns; index += 1) {
    const id = `turn-${index}`;
    mapping[parent].children.push(id);
    mapping[id] = { id, parent, children: [], message: { author: { role: index % 2 ? "user" : "assistant" }, content: { content_type: "text", parts: ["x".repeat(heavyBytes)] }, metadata: {} } };
    parent = id;
  }
  return { mapping, current_node: parent, root: "root" };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
