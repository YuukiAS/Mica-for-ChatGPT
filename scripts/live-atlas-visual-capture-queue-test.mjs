import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
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
await runLateVariantScenario();
await runQueueCapacityScenario();

console.log(JSON.stringify({
  passed: true,
  visualCaptureQueue: true,
  startupCoalescing: true,
  composerFocusBlurEventOnly: true,
  lateComposerRemountCapture: true,
  lateMountedWindowCapture: true,
  connectorVariantsPreserved: true,
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

async function runLateVariantScenario() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-late-variants-"));
  const out = path.join(temp, "raw");
  const sanitized = path.join(temp, "sanitized");
  const fixture = path.join(temp, "fixture.html");
  const probe = createFakeProbe({ scenario: "late-variants" });
  try {
    const result = await runReadOnlyCaptureSession({
      port: 9322,
      threadUrl,
      out,
      fetchImpl: fakeFetch,
      connect: probe.connect,
      idleMs: 2000,
      drainMs: 5,
      visualCoalesceMs: 5,
      visualRecaptureCooldownMs: 40,
      maxCheckpoints: 20,
      maxVisualQueue: 20
    });
    await writeRawSessionBundle({ out, threadUrl, session: result });
    await run("node", ["scripts/live-atlas-sanitize.mjs", `--input=${out}`, `--output=${sanitized}`]);
    await run("node", ["scripts/live-atlas-build-fixtures.mjs", `--input=${sanitized}`, `--output=${fixture}`]);

    const surfaceFiles = await readdir(path.join(out, "surfaces"));
    const screenshotFiles = await readdir(path.join(out, "screenshots"));
    const surfaces = await readJson(path.join(sanitized, "surfaces.json"));
    const fixtureHtml = await readFile(fixture, "utf8");
    const captureEvents = result.timeline.filter((event) => event.type === "cdp_checkpoint_capture");
    const capturedStateClasses = new Set(captureEvents.map((event) => event.details?.stateClass));
    const observedTimelineCount = result.timeline.filter((event) => event.type === "cdp_checkpoint_observed").length;

    assert(result.terminationReason === "atlas_stopped", "late variant scenario did not stop cleanly");
    assert(result.checkpointCount === 12, `late variant lifecycle events were not retained: ${result.checkpointCount}`);
    assert(observedTimelineCount === result.checkpointCount, "late variant timeline lost checkpoint events");
    assert(result.maxConcurrentHeavyCapture === 1, `late variant heavy capture concurrency was ${result.maxConcurrentHeavyCapture}`);
    assert(probe.maxConcurrentDomSnapshot === 1, `late variant DOMSnapshot concurrency was ${probe.maxConcurrentDomSnapshot}`);
    assert(probe.maxConcurrentScreenshot === 1, `late variant screenshot concurrency was ${probe.maxConcurrentScreenshot}`);
    assert(result.executedHeavyCaptureCount === 7, `expected 7 semantic late-variant captures, got ${result.executedHeavyCaptureCount}: ${JSON.stringify(captureEvents.map((event) => event.details?.stateClass))}`);
    assert(result.coalescedVisualCheckpointCount >= 2, "startup composer burst did not coalesce in late variant scenario");
    assert(!capturedStateClasses.has("composer_focus"), "late composer focus should be event-only");
    assert(!capturedStateClasses.has("composer_blur"), "late composer blur should be event-only");
    assert(result.timeline.some((event) => event.type === "cdp_checkpoint_observed" && event.details?.stateClass === "composer_focus"), "late composer focus lifecycle event was not retained");
    assert(result.timeline.some((event) => event.type === "cdp_checkpoint_observed" && event.details?.stateClass === "composer_blur"), "late composer blur lifecycle event was not retained");
    assert(capturedStateClasses.has("composer_identity_changed"), "late composer identity/remount was not captured");
    assert(countCaptured(captureEvents, "mounted_turn_window_changed") === 2, "late mounted window was not recaptured after cooldown");
    assert(capturedStateClasses.has("mention_chooser_visible"), "late mention chooser was not captured");
    assert(capturedStateClasses.has("connector_pill_visible"), "late connector pill was not captured");
    assert(surfaceFiles.filter((file) => file.startsWith("composer-")).length === 2, "raw composer baseline/remount variants were not preserved");
    assert(surfaceFiles.filter((file) => file.startsWith("longThreadMountedWindow-")).length === 2, "raw mounted-window variants were not preserved");
    assert(screenshotFiles.length === 7, `expected 7 screenshots for late variants, got ${screenshotFiles.length}`);
    assert(surfaces.composer?.variants?.length >= 2, "sanitizer merged away later composer variants");
    assert(surfaces.longThreadMountedWindow?.variants?.length >= 2, "sanitizer merged away later mounted-window variants");
    assert(surfaces.mentionChooser?.status === "OBSERVED", "sanitizer lost mention chooser variant");
    assert(surfaces.connectorPill?.status === "OBSERVED", "sanitizer lost connector pill variant");
    assert(fixtureHtml.includes('data-atlas-variant="global:composer_identity_changed"'), "fixture builder did not render composer remount variant");
    assert(fixtureHtml.includes('data-atlas-surface-slot="connectorPill"'), "fixture builder did not render connector pill");
    assert(probe.captureAfterClose === 0, "late variant scenario captured after close");
  } finally {
    await rm(temp, { recursive: true, force: true });
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
    for (const [stateClass, checkpointId, rect, terminal, extra] of [
      ["composer_present", "cap:1", { x: 40, y: 700, width: 820, height: 88 }],
      ["mention_chooser_visible", "cap:2", { x: 40, y: 520, width: 360, height: 180 }],
      ["connector_pill_visible", "cap:3", { x: 70, y: 710, width: 120, height: 32 }],
      ["mica_overlay_state", "cap:4", { x: 810, y: 732, width: 72, height: 48 }]
    ]) {
      emitCheckpoint(listeners, stateClass, checkpointId, rect, terminal, extra);
    }
    return;
  }
  if (scenario === "late-variants") {
    emitLateVariantScenario(listeners);
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

function emitLateVariantScenario(listeners) {
  const composerRect = { x: 40, y: 700, width: 820, height: 88 };
  const overlayRect = { x: 810, y: 732, width: 72, height: 48 };
  const windowRect = { x: 0, y: 0, width: 900, height: 820 };
  for (const [stateClass, checkpointId, rect] of [
    ["composer_present", "late:start:1", composerRect],
    ["composer_identity_changed", "late:start:2", composerRect],
    ["atlas_started", "late:start:3", composerRect],
    ["mounted_turn_window_changed", "late:start:4", windowRect],
    ["mica_overlay_state", "late:start:5", overlayRect]
  ]) {
    emitCheckpoint(listeners, stateClass, checkpointId, rect);
  }
  setTimeout(() => {
    for (const [stateClass, checkpointId, rect, terminal, extra] of [
      ["composer_focus", "late:focus", composerRect],
      ["composer_blur", "late:blur", composerRect],
      ["composer_identity_changed", "late:remount", { x: 40, y: 690, width: 820, height: 96 }],
      ["mounted_turn_window_changed", "late:window", { x: 0, y: 0, width: 900, height: 780 }, false, { generationId: 1 }],
      ["mention_chooser_visible", "late:mention", { x: 40, y: 500, width: 360, height: 180 }],
      ["connector_pill_visible", "late:connector", { x: 70, y: 705, width: 120, height: 32 }],
      ["atlas_stopped", "late:stop", null, true]
    ]) {
      emitCheckpoint(listeners, stateClass, checkpointId, rect, terminal, extra);
    }
  }, 140);
}

function emitCheckpoint(listeners, stateClass, checkpointId, targetRect, terminal = false, extra = {}) {
  const checkpoint = { checkpointId, stateClass, monotonicTimestamp: 100, targetRect, terminal, ...extra };
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
  addNode("FORM", body, { "data-composer-surface": "true", "data-testid": "composer-remounted" }, { x: 40, y: 690, width: 820, height: 96 });
  addNode("DIV", body, { role: "listbox", "data-testid": "mention-menu" }, { x: 40, y: 500, width: 360, height: 180 });
  addNode("DIV", body, { "data-inline-selection-pill": "true", "data-id": "plugin:safe-test" }, { x: 70, y: 705, width: 120, height: 32 });
  addNode("MICA-OVERLAY", body, { "data-mica-root": "true" }, { x: 810, y: 732, width: 72, height: 48 });
  return { strings, documents: [{ nodes: { nodeName, nodeValue, parentIndex, attributes }, layout: { nodeIndex: layoutNodeIndex, bounds, styles: layoutStyles } }] };
}

function countCaptured(captureEvents, stateClass) {
  return captureEvents.filter((event) => event.details?.stateClass === stateClass && event.details?.status === "OBSERVED").length;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "pipe", shell: false });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}: ${stderr}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
