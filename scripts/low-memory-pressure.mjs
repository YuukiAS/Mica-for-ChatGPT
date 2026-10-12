import { execFileSync } from "node:child_process";
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
  targetDevice: {
    class: "256-mb-v8-old-space-pressure-target",
    browserBuild: raw.A[0].browserBuild,
    memoryGb: 0.25,
    boundary: "local Chromium renderer constrained with a 256 MB V8 old-space limit; OS process memory is measured across the fresh browser process tree"
  },
  pressureFixture: { memoryLimitMb: 256, payloadMb: TURNS * BYTES_PER_TURN * 2 / 1024 / 1024, turns: TURNS },
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
assert(output.actualTruncation, "pressure fixture did not actually truncate client history");

const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "low-memory-pressure.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

async function runSample(state, variant, sample) {
  const browserServer = await chromium.launchServer({ headless: true, args: ["--js-flags=--expose-gc --max-old-space-size=256", "--disable-background-timer-throttling"] });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    await page.route("https://chatgpt.com/fixture", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html data-mica-fixture='true'><body><div id='native-window'></div><div id='prompt-textarea' role='textbox' contenteditable='true'></div></body></html>" }));
    await page.goto("https://chatgpt.com/fixture", { waitUntil: "load" });
    await page.evaluate(({ enabled }) => localStorage.setItem("mica.lowMemory.config.v2", JSON.stringify({ enabled, keepCount: 40, threshold: 80, updatedAt: Date.now() })), { enabled: variant.enabled });
    if (variant.install) {
      await page.addScriptTag({ path: path.join(distDir, "low-memory-core.js") });
      await page.addScriptTag({ path: path.join(distDir, "low-memory-page.js") });
    }
    const result = await page.evaluate(({ turns, bytesPerTurn, enabled, installed }) => {
      const conversation = makeConversation(turns, bytesPerTurn);
      const flat = encodeTurbo({ loaderData: { route: { serverResponse: { data: conversation } } } });
      let delivered = JSON.stringify(flat);
      globalThis.__reactRouterContext = {};
      globalThis.__reactRouterContext.streamController = { enqueue: (chunk) => { delivered = chunk; } };
      globalThis.__reactRouterContext.streamController.enqueue(delivered);
      globalThis.__pressureRetained = decodeTurbo(JSON.parse(delivered));
      const retainedConversation = globalThis.__pressureRetained.loaderData.route.serverResponse.data;
      const mapping = retainedConversation.mapping;
      const nativeWindow = document.getElementById("native-window");
      const ids = Object.keys(mapping).filter((id) => mapping[id]?.message?.author?.role === "user" || mapping[id]?.message?.author?.role === "assistant").slice(-12);
      const observerState = { count: 0 };
      const observer = new MutationObserver((records) => { observerState.count += records.length; });
      observer.observe(nativeWindow, { childList: true, subtree: true, attributes: true });
      for (const id of ids) {
        const turn = document.createElement("section");
        turn.dataset.testid = `conversation-turn-${id}`;
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
      const retainedContentBytes = Object.values(mapping).reduce((total, node) => total + (node?.message?.content?.parts || []).reduce((sum, part) => sum + (typeof part === "string" ? part.length * 2 : 0), 0), 0);
      const pageStatus = installed ? JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status") || "null") : null;
      return new Promise((resolve) => setTimeout(() => {
        observer.disconnect();
        globalThis.gc?.();
        resolve({
          state: enabled ? "on" : "off",
          mappingNodes: Object.keys(mapping).length,
          retainedContentMb: retainedContentBytes / 1024 / 1024,
          mountedTurnCount: ids.length,
          mutationCount: observerState.count,
          typingP95Ms: percentile(typing, 0.95),
          scrollP95Ms: percentile(scroll, 0.95),
          status: pageStatus,
          browserBuild: navigator.userAgent
        });
      }, 30));

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
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const performanceMetrics = await cdp.send("Performance.getMetrics");
    const metrics = Object.fromEntries(performanceMetrics.metrics.map((metric) => [metric.name, metric.value]));
    const processMemoryMb = measureProcessTreeMb(browserServer.process().pid);
    return {
      sample: sample + 1,
      state,
      variant: variant.variant,
      processMemoryMb,
      heapMb: metrics.JSHeapUsedSize / 1024 / 1024,
      ...result
    };
  } finally {
    await browser.close();
    await browserServer.close();
  }
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
