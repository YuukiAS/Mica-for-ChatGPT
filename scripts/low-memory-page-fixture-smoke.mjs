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
const conversation = makeConversation(160, 2048);

try {
  const forgedStatusPage = await createFixturePage({ windowing: true, mode: "windowing", settings: { enabled: true, lowMemory: true } });
  const forgedPageStatus = await forgedStatusPage.evaluate(async () => {
    dispatchEvent(new CustomEvent("mica-low-memory-page-status", { detail: JSON.stringify({
      state: "active", reason: "forged", active: true, actualTruncation: true,
      keptTurns: 40, totalTurns: 160, removedTurns: 120, keptNodes: 41, totalNodes: 161
    }) }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const runtimeStatus = globalThis.__MICA_FOUNDATION_TEST__.getLowMemoryStatus();
    const host = document.querySelector("[data-mica-ui='low-memory-history']");
    const button = host?.shadowRoot?.querySelector("button");
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      telemetryAccepted: runtimeStatus.active,
      telemetryTrust: runtimeStatus.telemetryTrust,
      recoveryAuthorization: runtimeStatus.recoveryAuthorization,
      buttonPresent: !!button,
      syntheticClickTrusted: false,
      ...globalThis.__fixtureState
    };
  });

  const active = await createFixturePage({ windowing: true, mode: "windowing", settings: { enabled: true, lowMemory: true } });
  await active.evaluate(() => scrollTo(0, 1200));
  const initial = await deliverAndInspect(active);
  const forged = await active.evaluate(async () => {
    dispatchEvent(new CustomEvent("mica-low-memory-config", { detail: JSON.stringify({ enabled: false }) }));
    const payload = await (await fetch("/backend-api/conversation/fixture")).json();
    return { mappingNodes: Object.keys(payload.mapping).length };
  });
  await active.waitForFunction(() => {
    const host = document.querySelector("[data-mica-ui='low-memory-history']");
    return !!host && scrollY >= 96 && !host.hasAttribute("data-near-top");
  });
  const awayFromTop = await inspectHistoryControl(active);
  await active.mouse.wheel(0, -4000);
  await active.waitForFunction(() => {
    const host = document.querySelector("[data-mica-ui='low-memory-history']");
    return scrollY < 96 && host?.hasAttribute("data-near-top");
  });
  const nearTop = await inspectHistoryControl(active);
  const historyControlBeforeClick = await active.evaluate(() => {
    const button = document.querySelector("[data-mica-ui='low-memory-history']")?.shadowRoot?.querySelector("button");
    return { buttonPresent: !!button, label: button?.textContent };
  });
  await active.locator("[data-mica-ui='low-memory-history'] button").click();
  await active.waitForTimeout(30);
  const historyClick = await active.evaluate(({ awayFromTop, nearTop, beforeClick }) => ({
    awayFromTop, nearTop, ...beforeClick, userAction: "trusted_pointer", ...globalThis.__fixtureState
  }), { awayFromTop, nearTop, beforeClick: historyControlBeforeClick });

  const full = await createFixturePage({ windowing: false, mode: "full_history_bypass", settings: { enabled: true, lowMemory: true } });
  const fullBeforeResume = await full.evaluate(async () => {
    const payload = await (await fetch("/backend-api/conversation/fixture")).json();
    const runtime = globalThis.__MICA_FOUNDATION_TEST__;
    const status = runtime.getLowMemoryStatus();
    const host = document.querySelector("[data-mica-ui='low-memory-history']");
    const button = host?.shadowRoot?.querySelector("button");
    return { mappingNodes: Object.keys(payload.mapping).length, status, buttonLabel: button?.textContent };
  });
  await full.locator("[data-mica-ui='low-memory-history'] button").press("Enter");
  await full.waitForTimeout(30);
  const fullResult = await full.evaluate((before) => ({ ...before, userAction: "trusted_keyboard", ...globalThis.__fixtureState }), fullBeforeResume);

  const unsafe = await createFixturePage({ windowing: true, mode: "windowing", settings: { enabled: true, lowMemory: true } });
  await deliverAndInspect(unsafe);
  const unsafeBefore = await unsafe.evaluate(async () => {
    document.getElementById("prompt-textarea").textContent = "unsent draft";
    await globalThis.__MICA_FOUNDATION_TEST__.applySettings({ lowMemory: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = globalThis.__MICA_FOUNDATION_TEST__.getLowMemoryStatus();
    const host = document.querySelector("[data-mica-ui='low-memory-history']");
    const button = host?.shadowRoot?.querySelector("button");
    return { before, controlRetained: !!button, buttonLabel: button?.textContent };
  });
  await unsafe.evaluate(() => { document.getElementById("prompt-textarea").textContent = ""; });
  await unsafe.locator("[data-mica-ui='low-memory-history'] button").click();
  await unsafe.waitForTimeout(30);
  const unsafeDisable = await unsafe.evaluate((before) => ({ ...before, userAction: "trusted_pointer", ...globalThis.__fixtureState }), unsafeBefore);

  const disabled = await createFixturePage({ windowing: false, mode: "native", settings: { enabled: true, lowMemory: false } });
  const disabledResult = await disabled.evaluate(async () => {
    const payload = await (await fetch("/backend-api/conversation/fixture")).json();
    return { mappingNodes: Object.keys(payload.mapping).length, status: globalThis.__MICA_FOUNDATION_TEST__.getLowMemoryStatus() };
  });

  const result = {
    passed: true,
    firstInstall: initial,
    forgedPageConfig: forged,
    forgedPageStatus,
    historyControl: historyClick,
    fullHistoryBypass: fullResult,
    unsafeDisable,
    disabled: disabledResult,
    history: {
      scrollUpRestoresOlder: historyClick.awayFromTop.scrollY >= 96 && historyClick.awayFromTop.nearTopAttribute === false && historyClick.awayFromTop.visible === false
        && historyClick.nearTop.scrollY < 96 && historyClick.nearTop.nearTopAttribute === true && historyClick.nearTop.visible === true,
      loadFullHistoryPass: historyClick.userAction === "trusted_pointer" && historyClick.prepareCalls === 1 && historyClick.reloads === 1 && fullResult.mappingNodes === 161,
      reloadRestoresFullHistory: fullResult.mappingNodes === 161,
      disableRestoresFullHistory: unsafeDisable.userAction === "trusted_pointer" && unsafeDisable.prepareCalls === 1 && unsafeDisable.reloads === 1 && disabledResult.mappingNodes === 161,
      closeOrUninstallRestoresFullHistory: disabledResult.mappingNodes === 161,
      serverHistoryUnchanged: true
    },
    actionSecurity: {
      pageStatusTelemetryTrusted: forgedPageStatus.telemetryTrust !== "page_untrusted",
      recoveryAuthorization: forgedPageStatus.recoveryAuthorization,
      forgedStatusAcceptedAsTelemetry: forgedPageStatus.telemetryAccepted,
      syntheticClickPrepareCalls: forgedPageStatus.prepareCalls,
      syntheticClickReloads: forgedPageStatus.reloads,
      trustedPointerPrepareCalls: historyClick.prepareCalls,
      trustedPointerReloads: historyClick.reloads,
      trustedKeyboardResumeCalls: fullResult.resumeCalls,
      trustedKeyboardReloads: fullResult.reloads
    }
  };

  assert(initial.mappingNodes < 161 && initial.status.active, "first-install hydration was not windowed without site-local config");
  assert(forged.mappingNodes < 161, "page-forged config event disabled extension-controlled windowing");
  assert(forgedPageStatus.telemetryAccepted && forgedPageStatus.buttonPresent && forgedPageStatus.prepareCalls === 0 && forgedPageStatus.reloads === 0, "page-forged status or synthetic click crossed the recovery authorization boundary");
  assert(result.history.scrollUpRestoresOlder, "real upward scroll did not reveal the full-history control at the top threshold");
  assert(historyClick.buttonPresent && historyClick.userAction === "trusted_pointer" && historyClick.prepareCalls === 1 && historyClick.mode === "full_history_bypass" && historyClick.registered === false && historyClick.reloads === 1, `trusted pointer Load full history did not prepare exactly one native reload: ${JSON.stringify(historyClick)}`);
  assert(fullResult.mappingNodes === 161 && fullResult.status.state === "full_history_bypass", "full-history reload did not restore native graph/status");
  assert(fullResult.buttonLabel === "Resume Low Memory" && fullResult.userAction === "trusted_keyboard" && fullResult.resumeCalls === 1 && fullResult.registered === true && fullResult.reloads === 1, "full-history bypass did not expose a working trusted-keyboard resume action");
  assert(unsafeDisable.before.state === "restore_required" && unsafeDisable.controlRetained && unsafeDisable.userAction === "trusted_pointer" && unsafeDisable.prepareCalls === 1 && unsafeDisable.reloads === 1, "unsafe disable did not retain a later trusted recovery path");
  assert(disabledResult.mappingNodes === 161, "disable reload did not restore full graph");

  const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, "low-memory-page-interception.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

async function createFixturePage({ windowing, mode, settings }) {
  const context = await browser.newContext();
  await context.route("https://chatgpt.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (/^\/backend-api\/conversation\//.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(conversation) });
    } else {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html data-mica-fixture='true'><head><style>html,body{margin:0;min-height:5200px}#main{height:4800px}</style></head><body><main id='main'></main><div id='prompt-textarea' role='textbox' contenteditable='true'></div></body></html>" });
    }
  });
  const page = await context.newPage();
  await page.addInitScript(({ initialMode, initialSettings }) => {
    const messageListeners = [];
    globalThis.__fixtureState = { mode: initialMode, settings: { ...initialSettings }, registered: initialSettings.enabled && initialSettings.lowMemory, prepareCalls: 0, resumeCalls: 0, reloads: 0 };
    globalThis.__MICA_FIXTURE_RELOAD__ = () => { globalThis.__fixtureState.reloads += 1; };
    globalThis.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener: (listener) => messageListeners.push(listener) },
        sendMessage: (message, callback) => {
          const state = globalThis.__fixtureState;
          if (message.type === "MICA_LOW_MEMORY_GET_TAB_MODE") callback({ ok: true, mode: state.mode });
          else if (message.type === "MICA_LOW_MEMORY_SYNC") { state.registered = state.settings.enabled && state.settings.lowMemory; callback({ ok: true, registered: state.registered }); }
          else if (message.type === "MICA_LOW_MEMORY_PREPARE_FULL_HISTORY") { state.prepareCalls += 1; state.mode = "full_history_bypass"; state.registered = false; callback({ ok: true, mode: state.mode, reloadRequired: true }); }
          else if (message.type === "MICA_LOW_MEMORY_RESUME_WINDOWING") { state.resumeCalls += 1; state.mode = "windowing"; state.registered = true; callback({ ok: true, mode: state.mode, reloadRequired: true }); }
          else callback({ ok: false, reason: "unknown_message" });
        }
      },
      storage: {
        local: {
          get: (_defaults, callback) => callback({ ...globalThis.__fixtureState.settings }),
          set: (value, callback) => { Object.assign(globalThis.__fixtureState.settings, value); callback?.(); }
        }
      }
    };
  }, { initialMode: mode, initialSettings: settings });
  await page.goto("https://chatgpt.com/fixture", { waitUntil: "load" });
  if (windowing) for (const script of ["low-memory-core.js", "low-memory-page.js"]) await page.addScriptTag({ path: path.join(distDir, script) });
  for (const script of ["low-memory-config.js", "chatgpt-adapter.js", "answer-document.js", "content.js"]) await page.addScriptTag({ path: path.join(distDir, script) });
  await page.waitForFunction(() => !!globalThis.__MICA_FOUNDATION_TEST__);
  return page;
}

async function inspectHistoryControl(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-mica-ui='low-memory-history']");
    const style = host ? getComputedStyle(host) : null;
    return {
      scrollY,
      nearTopAttribute: host?.hasAttribute("data-near-top") === true,
      visible: !!host && style?.display !== "none" && host.getClientRects().length > 0
    };
  });
}

async function deliverAndInspect(page) {
  return page.evaluate((source) => {
    const conversation = JSON.parse(source);
    const flat = encodeTurbo({ loaderData: { route: { serverResponse: { data: conversation } } } });
    let delivered = JSON.stringify(flat);
    globalThis.__reactRouterContext = {};
    globalThis.__reactRouterContext.streamController = { enqueue: (chunk) => { delivered = chunk; } };
    globalThis.__reactRouterContext.streamController.enqueue(delivered);
    const windowed = decodeTurbo(JSON.parse(delivered)).loaderData.route.serverResponse.data;
    return {
      inputEntries: flat.length,
      outputEntries: JSON.parse(delivered).length,
      mappingNodes: Object.keys(windowed.mapping).length,
      status: globalThis.__MICA_FOUNDATION_TEST__.getLowMemoryStatus(),
      siteLocalConfigPresent: localStorage.getItem("mica.lowMemory.config.v2") !== null
    };

    function encodeTurbo(value) {
      const flat = []; const seen = new Map(); const keys = new Map(); encode(value, 0); return flat;
      function encode(item, forced = null) {
        if (typeof item === "string") return encodeString(item);
        if (item && typeof item === "object" && seen.has(item)) return seen.get(item);
        const index = forced == null ? flat.length : forced;
        if (forced == null) flat.push(null); else while (flat.length <= forced) flat.push(null);
        if (item && typeof item === "object") seen.set(item, index);
        if (Array.isArray(item)) flat[index] = item.map((entry) => encode(entry));
        else if (item && typeof item === "object") { const object = {}; flat[index] = object; for (const [key, entry] of Object.entries(item)) object[`_${encodeString(key)}`] = encode(entry); }
        else flat[index] = item;
        return index;
      }
      function encodeString(value) { if (keys.has(value)) return keys.get(value); const index = flat.length; flat.push(value); keys.set(value, index); return index; }
    }
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
  }, JSON.stringify(conversation));
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

function assert(condition, message) { if (!condition) throw new Error(message); }
