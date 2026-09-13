import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runReadOnlyCaptureSession,
  writeRawSessionBundle
} from "./live-atlas-cdp-core.mjs";
import { assert, readJson } from "./live-atlas-common.mjs";

const threadUrl = "https://chatgpt.com/c/atlasVisualQueue_123";
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

await runStartupBurstScenario();
await runQueueCapacityScenario();

console.log(JSON.stringify({
  passed: true,
  visualCaptureQueue: true,
  startupCoalescing: true,
  stopDrainsQueue: true,
  automatedSend: false,
  automatedEnter: false,
  automatedUpload: false,
  automatedConnectorAction: false
}, null, 2));

async function runStartupBurstScenario() {
  const out = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-visual-queue-"));
  const probe = createFakeProbe({ scenario: "startup-burst" });
  try {
    const result = await runReadOnlyCaptureSession({
      port: 9322,
      threadUrl,
      out,
      fetchImpl: fakeFetch,
      connect: probe.connect,
      idleMs: 2000,
      drainMs: 5,
      visualCoalesceMs: 20,
      maxCheckpoints: 20,
      maxVisualQueue: 10
    });
    await writeRawSessionBundle({ out, threadUrl, session: result });
    const surfaceFiles = await readdir(path.join(out, "surfaces"));
    const screenshotFiles = await readdir(path.join(out, "screenshots"));
    const manifest = await readJson(path.join(out, "manifest.json"));
    const performanceJson = await readJson(path.join(out, "performance.json"));
    const observed = surfaceFiles.filter((file) => file.endsWith(".json"));
    const timelineObservedCount = result.timeline.filter((event) => event.type === "cdp_checkpoint_observed").length;

    assert(result.terminationReason === "atlas_stopped", "stop checkpoint did not terminate startup burst scenario");
    assert(result.checkpointCount === 10, `expected all lifecycle checkpoints retained, got ${result.checkpointCount}`);
    assert(timelineObservedCount === result.checkpointCount, "not every checkpoint was kept in the timeline");
    assert(result.maxConcurrentHeavyCapture === 1, `heavy capture concurrency was ${result.maxConcurrentHeavyCapture}`);
    assert(probe.maxConcurrentDomSnapshot === 1, `DOMSnapshot concurrency was ${probe.maxConcurrentDomSnapshot}`);
    assert(probe.maxConcurrentScreenshot === 1, `screenshot concurrency was ${probe.maxConcurrentScreenshot}`);
    assert(result.executedHeavyCaptureCount === 3, `expected composer/window/overlay captures only, got ${result.executedHeavyCaptureCount}`);
    assert(result.coalescedVisualCheckpointCount >= 5, "startup duplicate visual checkpoints were not coalesced");
    assert(result.queuedVisualCheckpointCount === 3, `expected three queued representative surfaces, got ${result.queuedVisualCheckpointCount}`);
    assert(result.capturedCheckpointCount === 3, `expected three observed captures, got ${result.capturedCheckpointCount}`);
    assert(screenshotFiles.length === 3, `expected three screenshots, got ${screenshotFiles.length}`);
    assert(observed.some((file) => file.startsWith("composer-")), "composer surface was dropped");
    assert(observed.some((file) => file.startsWith("micaOverlay-")), "Mica overlay surface was dropped");
    assert(observed.some((file) => file.startsWith("longThreadMountedWindow-")), "mounted window surface was dropped");
    assert(!observed.some((file) => file.startsWith("assistantActionBar-")), "baseline action bar should not be captured in no-send startup burst");
    assert(probe.captureAfterClose === 0, "capture command was sent after close");
    assert(manifest.visualCapture?.maxConcurrentHeavyCapture === 1, "manifest did not preserve non-disruption concurrency evidence");
    assert(performanceJson.visualCapture?.executedHeavyCaptureCount === 3, "performance.json did not preserve visual capture stats");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

async function runQueueCapacityScenario() {
  const out = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-visual-capacity-"));
  const probe = createFakeProbe({ scenario: "capacity" });
  try {
    const result = await runReadOnlyCaptureSession({
      port: 9322,
      threadUrl,
      out,
      fetchImpl: fakeFetch,
      connect: probe.connect,
      idleMs: 2000,
      drainMs: 1,
      visualCoalesceMs: 500,
      maxCheckpoints: 20,
      maxVisualQueue: 2
    });
    assert(result.truncated === true, "visual queue capacity did not mark session truncated");
    assert(result.truncation?.reason === "visual_queue_capacity_exceeded", "visual queue truncation reason was not explicit");
    assert(result.terminationReason === "visual_queue_capacity_exceeded", "capacity truncation did not terminate session with explicit reason");
    assert(probe.captureAfterClose === 0, "capacity scenario captured after close");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

function createFakeProbe({ scenario }) {
  const listeners = new Set();
  const probe = {
    activeDomSnapshot: 0,
    activeScreenshot: 0,
    maxConcurrentDomSnapshot: 0,
    maxConcurrentScreenshot: 0,
    captureAfterClose: 0,
    closed: false,
    async connect() {
      return {
        commandsSent: [],
        onMessage(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async send(method, params = {}) {
          if (probe.closed && /^(DOMSnapshot|Page|Performance)\./.test(method)) probe.captureAfterClose += 1;
          this.commandsSent.push(method);
          if (method === "Log.enable") setTimeout(() => emitScenario(scenario, listeners), 0);
          if (method === "Page.getLayoutMetrics") return layoutMetrics();
          if (method === "DOMSnapshot.captureSnapshot") {
            probe.activeDomSnapshot += 1;
            probe.maxConcurrentDomSnapshot = Math.max(probe.maxConcurrentDomSnapshot, probe.activeDomSnapshot);
            await delay(15);
            probe.activeDomSnapshot -= 1;
            return fakeSnapshot(params.computedStyles || []);
          }
          if (method === "Page.captureScreenshot") {
            probe.activeScreenshot += 1;
            probe.maxConcurrentScreenshot = Math.max(probe.maxConcurrentScreenshot, probe.activeScreenshot);
            await delay(15);
            probe.activeScreenshot -= 1;
            return { data: pngBytes.toString("base64") };
          }
          if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
          return {};
        },
        close() {
          probe.closed = true;
          return Promise.resolve();
        }
      };
    }
  };
  return probe;
}

function emitScenario(scenario, listeners) {
  if (scenario === "capacity") {
    for (const [stateClass, checkpointId, rect] of [
      ["composer_present", "cap:1", { x: 40, y: 700, width: 820, height: 88 }],
      ["mention_chooser_visible", "cap:2", { x: 40, y: 520, width: 360, height: 180 }],
      ["connector_pill_visible", "cap:3", { x: 70, y: 710, width: 120, height: 32 }],
      ["mica_overlay_state", "cap:4", { x: 810, y: 732, width: 72, height: 48 }]
    ]) {
      emitCheckpoint(listeners, stateClass, checkpointId, rect);
    }
    return;
  }
  const composerRect = { x: 40, y: 700, width: 820, height: 88 };
  const overlayRect = { x: 810, y: 732, width: 72, height: 48 };
  const windowRect = { x: 0, y: 0, width: 900, height: 820 };
  for (const [stateClass, checkpointId, rect] of [
    ["composer_present", "burst:1", composerRect],
    ["composer_identity_changed", "burst:2", composerRect],
    ["mounted_turn_window_changed", "burst:3", windowRect],
    ["assistant_action_bar_visible", "burst:4", { x: 260, y: 260, width: 32, height: 32 }],
    ["baseline_existing", "burst:5", null],
    ["mica_overlay_state", "burst:6", overlayRect],
    ["atlas_started", "burst:7", composerRect],
    ["composer_focus", "burst:8", composerRect],
    ["composer_blur", "burst:9", composerRect],
    ["atlas_stopped", "burst:stop", null, true]
  ]) {
    emitCheckpoint(listeners, stateClass, checkpointId, rect);
  }
}

function emitCheckpoint(listeners, stateClass, checkpointId, targetRect, terminal = false) {
  const checkpoint = { checkpointId, stateClass, monotonicTimestamp: 100, targetRect, terminal };
  for (const listener of listeners) {
    listener({
      method: "Runtime.consoleAPICalled",
      params: { args: [{ value: `MICA_ATLAS_CHECKPOINT ${JSON.stringify(checkpoint)}` }] }
    });
  }
}

function fakeFetch(url) {
  if (String(url).endsWith("/json/list")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ type: "page", url: threadUrl, title: "Atlas visual queue", webSocketDebuggerUrl: "ws://127.0.0.1:9322/devtools/page/visual" }])
    });
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

function layoutMetrics() {
  return {
    cssVisualViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 0, zoom: 1 },
    cssLayoutViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 0 },
    cssContentSize: { x: 0, y: 0, width: 900, height: 900 }
  };
}

function fakeSnapshot(styles) {
  const strings = [];
  const intern = (value) => {
    let index = strings.indexOf(value);
    if (index < 0) {
      index = strings.length;
      strings.push(value);
    }
    return index;
  };
  const nodeName = [];
  const nodeValue = [];
  const parentIndex = [];
  const attributes = [];
  const layoutNodeIndex = [];
  const bounds = [];
  const layoutStyles = [];
  const addNode = (name, parent, attrs = {}, rect = null) => {
    const index = nodeName.length;
    nodeName.push(intern(name));
    nodeValue.push("");
    parentIndex.push(parent);
    attributes.push(Object.entries(attrs).flatMap(([key, value]) => [intern(key), intern(value)]));
    if (rect) {
      layoutNodeIndex.push(index);
      bounds.push([rect.x, rect.y, rect.width, rect.height]);
      layoutStyles.push(styles.map((style) => intern(style === "position" ? "fixed" : style === "display" ? "grid" : "")));
    }
    return index;
  };
  const html = addNode("HTML", -1);
  const body = addNode("BODY", html);
  const assistant = addNode("ARTICLE", body, { "data-testid": "conversation-turn-old", "data-message-author-role": "assistant" }, { x: 240, y: 220, width: 600, height: 220 });
  addNode("DIV", assistant, { role: "toolbar", "aria-label": "Copy" }, { x: 260, y: 260, width: 32, height: 32 });
  addNode("MAIN", body, { "data-testid": "conversation-window" }, { x: 0, y: 0, width: 900, height: 820 });
  addNode("FORM", body, { "data-composer-surface": "true", "data-testid": "composer" }, { x: 40, y: 700, width: 820, height: 88 });
  addNode("MICA-OVERLAY", body, { "data-mica-root": "true" }, { x: 810, y: 732, width: 72, height: 48 });
  return { strings, documents: [{ nodes: { nodeName, nodeValue, parentIndex, attributes }, layout: { nodeIndex: layoutNodeIndex, bounds, styles: layoutStyles } }] };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
