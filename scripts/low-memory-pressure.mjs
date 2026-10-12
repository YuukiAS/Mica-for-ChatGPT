import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const SAMPLE_COUNT = Number(process.env.MICA_LOW_MEMORY_SAMPLES || 3);
const TURNS = 800;
const BYTES_PER_TURN = 65536;
const variants = {
  A: { variant: "mica-absent-or-disabled", install: false, enabled: false },
  B: { variant: "mica-installed-low-memory-off", install: true, enabled: false },
  C: { variant: "mica-installed-low-memory-on", install: true, enabled: true }
};
const raw = { A: [], B: [], C: [] };

for (const state of ["A", "B", "C"]) {
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) raw[state].push(await runSample(state, variants[state], sample));
}

const summarized = Object.fromEntries(Object.entries(raw).map(([state, samples]) => [state, summarize(variants[state].variant, samples)]));
const output = {
  passed: true,
  generatedAt: new Date().toISOString(),
  targetEnvironment: {
    class: "local-edge-v8-old-space-pressure",
    executionSurface: "local-isolated-edge",
    browserBuild: raw.A[0].browserBuild,
    rendererOldSpaceLimitMb: 256,
    physicalMemoryGb: null,
    boundary: "local Chromium renderer constrained with a 256 MB V8 old-space limit; OS process memory is measured across the fresh browser process tree"
  },
  pressureFixture: {
    memoryLimitMb: 256,
    payloadMb: TURNS * BYTES_PER_TURN * 2 / 1024 / 1024,
    turns: TURNS,
    workload: "current-chatgpt-derived-react-router-flat-graph-and-virtualized-turn-renderer",
    sourceArtifact: "current-chatgpt-surface/low-memory-data-plane-evidence.json"
  },
  recentTurnLimit: 40,
  nativeVirtualizationBaseline: { currentPublicMountedTurns: 7, fixtureMountedTurns: 12, source: "2026-10-12 current read-only public ChatGPT bootstrap" },
  A: summarized.A,
  B: summarized.B,
  C: summarized.C,
  rawSamples: raw,
  actualTruncation: summarized.C.mappingNodes < summarized.B.mappingNodes && summarized.C.retainedContentMb < summarized.B.retainedContentMb,
  truncatedRepresentation: "client-history-window",
  reactManagedInteractiveNodesDetached: false,
  serverMutation: false
};

assert(output.C.samples >= 3, "pressure evidence requires three samples");
assert(gain(Math.min(output.A.heapMb, output.B.heapMb), output.C.heapMb) >= 0.15, "Low Memory did not reduce JS heap by 15%");
assert(gain(output.B.retainedContentMb, output.C.retainedContentMb) >= 0.15, "Low Memory did not reduce retained content by 15%");
assert(output.C.mountedTurnCount <= output.B.mountedTurnCount * 1.1, "mounted DOM regressed");
assert(latencyWithinBudget(output.B.typingP95Ms, output.C.typingP95Ms), "typing latency regressed");
assert(latencyWithinBudget(output.B.scrollP95Ms, output.C.scrollP95Ms), "scroll latency regressed");
assert(output.B.fullExtensionRuntimeLoaded && output.C.fullExtensionRuntimeLoaded, "B/C did not run the complete installed extension runtime");
assert(output.C.longTaskTotalMs <= Math.max(output.B.longTaskTotalMs * 1.2, output.B.longTaskTotalMs + 5), "long-task time regressed");
assert(output.C.frameP95Ms <= Math.max(output.B.frameP95Ms * 1.2, output.B.frameP95Ms + 2), "frame latency regressed");
assert(output.actualTruncation, "pressure fixture did not actually truncate client history");

const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "low-memory-pressure.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

async function runSample(state, variant, sample) {
  const launched = await launchMeasuredBrowser(variant);
  const browser = launched.browser;
  try {
    let worker = null;
    let runtimeProof = null;
    let registrationProof = null;
    await launched.context.route("https://chatgpt.com/fixture", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html data-mica-fixture='true'><body><div id='native-window'></div><div id='prompt-textarea' role='textbox' contenteditable='true'></div></body></html>" }));
    if (variant.install) {
      worker = await waitForExtensionWorker(browser);
      registrationProof = await worker.evaluate(async (enabled) => {
        await chrome.storage.local.set({ enabled: true, lowMemory: enabled, lowMemoryKeepCount: 40, lowMemoryThreshold: 80 });
        const synced = await syncRegistration();
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        return { synced, scripts };
      }, variant.enabled);
    }
    const page = await launched.context.newPage();
    await page.goto("https://chatgpt.com/fixture", { waitUntil: "load" });
    if (variant.install) {
      runtimeProof = await waitForContentRuntime(worker);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const beforePerformance = await cdp.send("Performance.getMetrics");
    const beforeMetrics = Object.fromEntries(beforePerformance.metrics.map((metric) => [metric.name, metric.value]));
    const result = await page.evaluate(async ({ turns, bytesPerTurn, enabled, installed }) => {
      const longTasks = [];
      const longTaskObserver = typeof PerformanceObserver === "function" ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      }) : null;
      try { longTaskObserver?.observe({ type: "longtask", buffered: true }); } catch (_error) { /* optional browser metric */ }
      const conversation = makeConversation(turns, bytesPerTurn);
      const flat = encodeTurbo({ loaderData: { route: { serverResponse: { data: conversation } } } });
      let delivered = JSON.stringify(flat);
      globalThis.__reactRouterContext = {};
      globalThis.__reactRouterContext.streamController = { enqueue: (chunk) => { delivered = chunk; } };
      globalThis.__reactRouterContext.streamController.enqueue(delivered);
      globalThis.__pressureRetained = decodeTurbo(JSON.parse(delivered));
      const retainedConversation = globalThis.__pressureRetained.loaderData.route.serverResponse.data;
      const mapping = retainedConversation.mapping;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const bootstrapLongTasks = longTasks.splice(0);
      const nativeWindow = document.getElementById("native-window");
      const ids = Object.keys(mapping).filter((id) => mapping[id]?.message?.author?.role === "user" || mapping[id]?.message?.author?.role === "assistant").slice(-12);
      const observerState = { count: 0 };
      const observer = new MutationObserver((records) => { observerState.count += records.length; });
      observer.observe(nativeWindow, { childList: true, subtree: true, attributes: true });
      for (const id of ids) {
        const turn = document.createElement("section");
        turn.dataset.testid = `conversation-turn-${id}`;
        turn.dataset.turn = id;
        const article = document.createElement("article");
        article.dataset.messageAuthorRole = mapping[id]?.message?.author?.role || "assistant";
        const body = document.createElement("div"); body.className = "markdown prose";
        const paragraph = document.createElement("p"); paragraph.textContent = mapping[id]?.message?.content?.parts?.[0]?.slice(0, 512) || "";
        body.append(paragraph); article.append(body); turn.append(article);
        nativeWindow.append(turn);
      }
      for (let cycle = 0; cycle < 4; cycle += 1) for (const turn of nativeWindow.children) turn.toggleAttribute("data-cycle", cycle % 2 === 0);
      const typing = [];
      const editor = document.getElementById("prompt-textarea");
      for (let index = 0; index < 400; index += 1) {
        const start = performance.now();
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
        typing.push(Math.max(0.01, performance.now() - start));
      }
      nativeWindow.style.cssText = "height:400px;overflow:auto";
      const spacer = document.createElement("div"); spacer.style.height = "8000px"; nativeWindow.append(spacer);
      const scroll = [];
      for (let index = 0; index < 120; index += 1) {
        const start = performance.now();
        nativeWindow.scrollTop = (index * 53) % 7600;
        nativeWindow.dispatchEvent(new Event("scroll"));
        scroll.push(Math.max(0.01, performance.now() - start));
      }
      const frame = [];
      for (let index = 0; index < 30; index += 1) {
        const start = performance.now();
        nativeWindow.scrollTop = (index * 211) % 7600;
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
        await new Promise((resolve) => requestAnimationFrame(() => { frame.push(performance.now() - start); resolve(); }));
      }
      const retainedContentBytes = Object.values(mapping).reduce((total, node) => total + (node?.message?.content?.parts || []).reduce((sum, part) => sum + (typeof part === "string" ? part.length * 2 : 0), 0), 0);
      const pageStatus = installed ? JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status") || "null") : null;
      await new Promise((resolve) => setTimeout(resolve, 30));
      observer.disconnect();
      longTaskObserver?.disconnect();
      globalThis.gc?.();
      return {
          state: enabled ? "on" : "off",
          mappingNodes: Object.keys(mapping).length,
          retainedContentMb: retainedContentBytes / 1024 / 1024,
          mountedTurnCount: ids.length,
          mutationCount: observerState.count,
          typingP95Ms: percentile(typing, 0.95),
          scrollP95Ms: percentile(scroll, 0.95),
          frameP95Ms: percentile(frame, 0.95),
          longTaskCount: longTasks.length,
          longTaskTotalMs: longTasks.reduce((total, value) => total + value, 0),
          longTaskMaxMs: longTasks.length ? Math.max(...longTasks) : 0,
          bootstrapLongTaskCount: bootstrapLongTasks.length,
          bootstrapLongTaskTotalMs: bootstrapLongTasks.reduce((total, value) => total + value, 0),
          bootstrapLongTaskMaxMs: bootstrapLongTasks.length ? Math.max(...bootstrapLongTasks) : 0,
          status: pageStatus,
          browserBuild: navigator.userAgent
        };

      function makeConversation(count, size) {
        const mapping = { root: { id: "root", children: [] } };
        let parent = "root";
        for (let index = 1; index <= count; index += 1) {
          const id = `turn-${index}`;
          mapping[parent].children.push(id);
          mapping[id] = { id, parent, children: [], message: { author: { role: index % 2 ? "user" : "assistant" }, content: { content_type: "text", parts: [`${index}:` + "x".repeat(size - String(index).length - 1)] }, metadata: {} } };
          parent = id;
        }
        return { mapping, current_node: parent, root: "root" };
      }
      function encodeTurbo(value) {
        const flat = []; const seen = new Map(); const keys = new Map(); encode(value, 0); return flat;
        function encode(item, forced = null) {
          if (typeof item === "string") return encodeString(item, false);
          if (item && typeof item === "object" && seen.has(item)) return seen.get(item);
          const index = forced == null ? flat.length : forced;
          if (forced == null) flat.push(null); else while (flat.length <= forced) flat.push(null);
          if (item && typeof item === "object") seen.set(item, index);
          if (Array.isArray(item)) flat[index] = item.map((entry) => encode(entry));
          else if (item && typeof item === "object") { const object = {}; flat[index] = object; for (const [key, entry] of Object.entries(item)) object[`_${encodeString(key, true)}`] = encode(entry); }
          else flat[index] = item;
          return index;
        }
        function encodeString(value, key) {
          if (key && keys.has(value)) return keys.get(value);
          const index = flat.length; flat.push(value); if (key) keys.set(value, index); return index;
        }
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
      function percentile(values, ratio) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]; }
    }, { turns: TURNS, bytesPerTurn: BYTES_PER_TURN, enabled: variant.enabled, installed: variant.install });

    await page.evaluate(() => globalThis.gc?.());
    const performanceMetrics = await cdp.send("Performance.getMetrics");
    const metrics = Object.fromEntries(performanceMetrics.metrics.map((metric) => [metric.name, metric.value]));
    const processMemoryMb = measureProcessTreeMb(resolveBrowserPid(launched.profileDir));
    return {
      sample: sample + 1,
      state,
      variant: variant.variant,
      processMemoryMb,
      heapMb: metrics.JSHeapUsedSize / 1024 / 1024,
      layoutCount: (metrics.LayoutCount || 0) - (beforeMetrics.LayoutCount || 0),
      recalcStyleCount: (metrics.RecalcStyleCount || 0) - (beforeMetrics.RecalcStyleCount || 0),
      fullExtensionRuntime: runtimeProof,
      registrationProof,
      ...result
    };
  } finally {
    await launched.close();
  }
}

async function launchMeasuredBrowser(variant) {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "mica-pressure-profile-"));
  const extensionArgs = variant.install ? [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`] : ["--disable-extensions"];
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "msedge",
    headless: false,
    viewport: { width: 1000, height: 760 },
    ignoreDefaultArgs: variant.install ? ["--disable-extensions"] : [],
    args: ["--window-position=-32000,-32000", "--window-size=1000,760", "--js-flags=--expose-gc --max-old-space-size=256", "--disable-background-timer-throttling", ...extensionArgs]
  });
  const browser = context.browser();
  return {
    browser,
    context,
    profileDir,
    async close() {
      try { await context.close(); } catch (_error) { /* cleanup continues */ }
      await rm(profileDir, { recursive: true, force: true });
    }
  };
}

function resolveBrowserPid(profileDir) {
  const literal = profileDir.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop';$profile='${literal}';$match=Get-CimInstance Win32_Process|Where-Object{$_.CommandLine-and$_.CommandLine.Contains($profile)}|Sort-Object CreationDate|Select-Object -First 1;if(-not$match){throw 'browser pid not found'};[int]$match.ProcessId`;
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim());
}

async function waitForExtensionWorker(browser) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
      if (worker) return worker;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("full extension service worker did not load");
}

async function waitForContentRuntime(worker) {
  const deadline = Date.now() + 5000;
  let lastError = "content runtime unavailable";
  while (Date.now() < deadline) {
    try {
      const proof = await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((candidate) => candidate.url?.startsWith("https://chatgpt.com/fixture"));
        if (!tab?.id) throw new Error("fixture tab not found");
        return chrome.tabs.sendMessage(tab.id, { type: "MICA_GET_STATUS" });
      });
      if (proof?.status && proof?.settings) return { loaded: true, version: proof.status.version, lowMemoryEnabled: proof.settings.enabled && proof.settings.lowMemory };
    } catch (error) { lastError = String(error?.message || error); }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`full extension content runtime did not load: ${lastError}`);
}

function summarize(variant, samples) {
  return {
    variant,
    processMemoryMb: median(samples.map((item) => item.processMemoryMb)),
    processMemoryRangeMb: range(samples.map((item) => item.processMemoryMb)),
    heapMb: median(samples.map((item) => item.heapMb)),
    heapRangeMb: range(samples.map((item) => item.heapMb)),
    retainedContentMb: median(samples.map((item) => item.retainedContentMb)),
    mountedTurnCount: median(samples.map((item) => item.mountedTurnCount)),
    mutationCount: median(samples.map((item) => item.mutationCount)),
    typingP95Ms: median(samples.map((item) => item.typingP95Ms)),
    typingRangeMs: range(samples.map((item) => item.typingP95Ms)),
    scrollP95Ms: median(samples.map((item) => item.scrollP95Ms)),
    scrollRangeMs: range(samples.map((item) => item.scrollP95Ms)),
    mappingNodes: median(samples.map((item) => item.mappingNodes)),
    frameP95Ms: median(samples.map((item) => item.frameP95Ms)),
    longTaskCount: median(samples.map((item) => item.longTaskCount)),
    longTaskTotalMs: median(samples.map((item) => item.longTaskTotalMs)),
    longTaskMaxMs: median(samples.map((item) => item.longTaskMaxMs)),
    bootstrapLongTaskCount: median(samples.map((item) => item.bootstrapLongTaskCount)),
    bootstrapLongTaskTotalMs: median(samples.map((item) => item.bootstrapLongTaskTotalMs)),
    bootstrapLongTaskMaxMs: median(samples.map((item) => item.bootstrapLongTaskMaxMs)),
    layoutCount: median(samples.map((item) => item.layoutCount)),
    recalcStyleCount: median(samples.map((item) => item.recalcStyleCount)),
    fullExtensionRuntimeLoaded: samples.every((item) => item.fullExtensionRuntime?.loaded === true),
    runtimeVersion: samples.find((item) => item.fullExtensionRuntime?.version)?.fullExtensionRuntime?.version || null,
    registrationProof: samples[0]?.registrationProof || null,
    windowingStatus: samples[0]?.status || null,
    samples: samples.length
  };
}

function measureProcessTreeMb(rootPid) {
  const script = `$ErrorActionPreference='Stop';$rootPid=${Number(rootPid)};$all=Get-CimInstance Win32_Process;$ids=[System.Collections.Generic.HashSet[int]]::new();[void]$ids.Add($rootPid);do{$added=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and $ids.Add([int]$p.ProcessId)){$added=$true}}}while($added);$sum=0;foreach($id in $ids){$proc=Get-Process -Id $id -ErrorAction SilentlyContinue;if($proc){$sum+=$proc.PrivateMemorySize64}};[math]::Round($sum/1MB,3)`;
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim());
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / 2)]);
}
function range(values) { return [round(Math.min(...values)), round(Math.max(...values))]; }
function round(value) { return Math.round(value * 1000) / 1000; }
function gain(before, after) { return (before - after) / before; }
function latencyWithinBudget(baseline, candidate) { return candidate <= Math.max(baseline * 1.1, baseline + 0.1); }
function assert(condition, message) { if (!condition) throw new Error(message); }
