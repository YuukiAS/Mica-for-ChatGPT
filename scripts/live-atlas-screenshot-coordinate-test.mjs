import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  captureCheckpoint,
  resolveSurfaceMatch,
  screenshotClipForDocumentRect
} from "./live-atlas-cdp-core.mjs";
import { assert } from "./live-atlas-common.mjs";

const SCROLL_Y = 1000;
const ZOOM = 1.25;
const currentAssistantHint = safeTurnHint("assistant:conversation-turn-assistant-c");
const { snapshot, indexes } = fixtureSnapshot();
const layoutMetrics = {
  cssVisualViewport: { clientWidth: 720, clientHeight: 560, pageX: 0, pageY: SCROLL_Y, zoom: ZOOM },
  cssLayoutViewport: { clientWidth: 900, clientHeight: 700, pageX: 0, pageY: SCROLL_Y },
  cssContentSize: { x: 0, y: 0, width: 900, height: 2200 },
  visualViewport: { clientWidth: 720, clientHeight: 560, pageX: 0, pageY: 333, zoom: 9 },
  layoutViewport: { clientWidth: 900, clientHeight: 700, pageX: 0, pageY: 444 }
};
const temp = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-screenshot-coordinate-"));
const screenshotsDir = path.join(temp, "screenshots");
const surfacesDir = path.join(temp, "surfaces");
const screenshotRequests = [];
await mkdir(screenshotsDir, { recursive: true });
await mkdir(surfacesDir, { recursive: true });

try {
  const assistantMatch = resolveSurfaceMatch(snapshot, "assistantSettled", checkpoint("assistant_settled", "coord:assistant", currentAssistantHint, { x: 40, y: 320, width: 820, height: 180 }), { layoutMetrics });
  assert(assistantMatch?.nodeIndex === indexes.currentAssistant, "current assistant was not selected");
  assertRect(assistantMatch.documentRect, { x: 40, y: 1320, width: 820, height: 180 }, "assistant documentRect");
  assertRect(assistantMatch.viewportRect, { x: 40, y: 320, width: 820, height: 180 }, "assistant viewportRect");
  const helperClip = screenshotClipForDocumentRect(assistantMatch.documentRect, layoutMetrics);
  assertRect(helperClip, { x: 50, y: 1650, width: 1025, height: 225 }, "helper screenshot clip");

  const assistantCapture = await captureCheckpoint(fakeClient(), checkpoint("assistant_settled", "coord:assistant", currentAssistantHint, { x: 40, y: 320, width: 820, height: 180 }), { screenshotsDir, surfacesDir });
  const assistantSurface = JSON.parse(await readFile(assistantCapture.surfaceFile, "utf8"));
  const assistantClip = screenshotRequests.at(-1).clip;
  assert(assistantCapture.status === "OBSERVED", "assistant capture was not observed", assistantCapture);
  assert(assistantCapture.documentRect.y === 1320 && assistantCapture.viewportRect.y === 320, "capture did not retain separated rects", assistantCapture);
  assertRect(assistantClip, { x: 50, y: 1650, width: 1025, height: 225 }, "assistant screenshot clip");
  assert(assistantClip.y !== assistantSurface.contract.rect.y, "screenshot clip reused viewport contract rect");
  assert(assistantSurface.coordinateEvidence.screenshotClipSource === "documentRect", "assistant screenshot clip source was not documentRect");
  assert(assistantSurface.coordinateEvidence.cssViewportMetricsPreferred === true, "assistant capture did not prefer CSS viewport metrics");
  assert(assistantSurface.coordinateEvidence.cssZoom === ZOOM, "assistant capture did not record CSS zoom");
  assertRect(assistantSurface.coordinateEvidence.documentRect, { x: 40, y: 1320, width: 820, height: 180 }, "assistant surface document evidence");
  assertRect(assistantSurface.coordinateEvidence.viewportRect, { x: 40, y: 320, width: 820, height: 180 }, "assistant surface viewport evidence");
  assertRect(assistantSurface.contract.rect, { x: 40, y: 320, width: 820, height: 180 }, "assistant contract viewport rect");

  const actionCapture = await captureCheckpoint(fakeClient(), checkpoint("assistant_action_bar_visible", "coord:actions", currentAssistantHint, { x: 640, y: 475, width: 180, height: 36 }), { screenshotsDir, surfacesDir });
  const actionSurface = JSON.parse(await readFile(actionCapture.surfaceFile, "utf8"));
  const actionClip = screenshotRequests.at(-1).clip;
  assert(actionCapture.status === "OBSERVED", "action bar capture was not observed", actionCapture);
  assert(actionCapture.documentRect.y === 1475 && actionCapture.viewportRect.y === 475, "action bar did not retain separated rects", actionCapture);
  assertRect(actionClip, { x: 800, y: 1843.8, width: 225, height: 45 }, "action bar screenshot clip");
  assert(actionClip.y !== actionSurface.contract.rect.y, "action bar screenshot clip reused viewport contract rect");
  assert(actionSurface.coordinateEvidence.screenshotClipSource === "documentRect", "action bar screenshot clip source was not documentRect");
  assert(actionSurface.coordinateEvidence.cssViewportMetricsPreferred === true, "action bar capture did not prefer CSS viewport metrics");

  console.log(JSON.stringify({
    passed: true,
    documentVsViewportRectSeparation: true,
    cssViewportMetricsPreferred: true,
    nonzeroScrollScreenshotClip: true,
    zoomScreenshotClip: true,
    currentTurnScreenshotRegion: true,
    selectedAssistant: "currentAssistantC",
    assistantScreenshotClip: assistantClip,
    actionBarScreenshotClip: actionClip,
    automatedSend: false,
    automatedUpload: false,
    automatedConnectorAction: false
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}

function fakeClient() {
  return {
    commandsSent: [],
    async send(method, params = {}) {
      if (method === "Page.getLayoutMetrics") return layoutMetrics;
      if (method === "DOMSnapshot.captureSnapshot") return snapshot;
      if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
      if (method === "Page.captureScreenshot") {
        screenshotRequests.push(params);
        return { data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64") };
      }
      return {};
    }
  };
}

function checkpoint(stateClass, checkpointId, turnId, targetRect) {
  return { stateClass, checkpointId, generationId: 3, role: "assistant", surfaceRole: "assistant", turnId, targetRect };
}

function fixtureSnapshot() {
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
  const addNode = (name, parent, attrs = {}, rect = null) => {
    const index = nodeName.length;
    nodeName.push(intern(name));
    nodeValue.push("");
    parentIndex.push(parent);
    attributes.push(Object.entries(attrs).flatMap(([key, value]) => [intern(key), intern(value)]));
    if (rect) {
      layoutNodeIndex.push(index);
      bounds.push([rect.x, rect.y, rect.width, rect.height]);
    }
    return index;
  };
  const html = addNode("HTML", -1);
  const body = addNode("BODY", html);
  addNode("ARTICLE", body, { "data-testid": "conversation-turn-old-user", "data-message-author-role": "user" }, { x: 40, y: 100, width: 820, height: 70 });
  const oldAssistantA = addNode("ARTICLE", body, { "data-testid": "conversation-turn-assistant-a", "data-message-author-role": "assistant" }, { x: 40, y: 210, width: 820, height: 150 });
  const oldActionBarA = addNode("DIV", oldAssistantA, { role: "toolbar", "data-testid": "assistant-action-bar-a" }, { x: 640, y: 325, width: 180, height: 36 });
  addNode("BUTTON", oldActionBarA, { "aria-label": "Copy", "data-testid": "copy-a" }, { x: 646, y: 330, width: 30, height: 28 });
  const oldAssistantB = addNode("ARTICLE", body, { "data-testid": "conversation-turn-assistant-b", "data-message-author-role": "assistant" }, { x: 40, y: 320, width: 820, height: 180 });
  const oldActionBarB = addNode("DIV", oldAssistantB, { role: "toolbar", "data-testid": "assistant-action-bar-b" }, { x: 640, y: 475, width: 180, height: 36 });
  addNode("BUTTON", oldActionBarB, { "aria-label": "Copy", "data-testid": "copy-b" }, { x: 646, y: 480, width: 30, height: 28 });
  const currentAssistant = addNode("ARTICLE", body, { "data-testid": "conversation-turn-assistant-c", "data-message-author-role": "assistant" }, { x: 40, y: 1320, width: 820, height: 180 });
  const currentActionBar = addNode("DIV", currentAssistant, { role: "toolbar", "data-testid": "assistant-action-bar-c" }, { x: 640, y: 1475, width: 180, height: 36 });
  addNode("BUTTON", currentActionBar, { "aria-label": "Copy", "data-testid": "copy-c" }, { x: 646, y: 1480, width: 30, height: 28 });
  return {
    snapshot: {
      strings,
      documents: [{
        scrollOffsetX: 0,
        scrollOffsetY: SCROLL_Y,
        nodes: { nodeName, nodeValue, parentIndex, attributes },
        layout: { nodeIndex: layoutNodeIndex, bounds, styles: layoutNodeIndex.map(() => []) }
      }]
    },
    indexes: { currentAssistant, currentActionBar }
  };
}

function assertRect(actual, expected, label) {
  for (const key of ["x", "y", "width", "height"]) {
    assert(Math.abs(Number(actual?.[key]) - expected[key]) <= 0.11, `${label}.${key} mismatch`, { actual, expected });
  }
}

function safeTurnHint(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `turn:${(hash >>> 0).toString(36)}`;
}
