import path from "node:path";
import { defaultRawSession, surfaceKeys, writeJson, writeText } from "./live-atlas-common.mjs";

const sessionId = "synthetic-smoke";
const coverage = Object.fromEntries(surfaceKeys.map((key) => [key, { status: "MISSING", count: 0 }]));
for (const key of ["composer", "userTurn", "assistantStreaming", "assistantSettled", "assistantActionBar", "nativeCopyArea", "richMarkdown", "mentionChooser", "connectorPill", "micaOverlay", "longThreadMountedWindow", "micaCopy"]) {
  coverage[key] = { status: "OBSERVED", count: 1 };
}

const timeline = [
  event("checkpoint", 0, { checkpointId: "synthetic-smoke:1", stateClass: "atlas_started" }),
  event("checkpoint", 40, { checkpointId: "synthetic-smoke:2", stateClass: "composer_focus", textLength: 0 }),
  event("composer_beforeinput", 80, { inputType: "insertText", dataLength: 1, textLengthBefore: 0, textLengthAfter: 1 }),
  event("composer_input", 96, { inputType: "insertText", dataLength: 1, textLengthBefore: 0, textLengthAfter: 1 }),
  event("checkpoint", 220, { checkpointId: "synthetic-smoke:3", stateClass: "manual_send_intent", source: "submit" }),
  event("checkpoint", 310, { checkpointId: "synthetic-smoke:4", stateClass: "mounted_turn_window_changed", mountedTurns: 2 }),
  event("checkpoint", 390, { checkpointId: "synthetic-smoke:5", stateClass: "composer_body_zero", textLength: 0 }),
  event("checkpoint", 520, { checkpointId: "synthetic-smoke:6", stateClass: "assistant_turn_mounted" }),
  event("checkpoint", 690, { checkpointId: "synthetic-smoke:7", stateClass: "assistant_first_content_mutation" }),
  event("assistant_stream_mutation_burst", 900, { addedNodes: 2, removedNodes: 0 }),
  event("assistant_stream_mutation_burst", 1180, { addedNodes: 3, removedNodes: 0 }),
  event("checkpoint", 3150, { checkpointId: "synthetic-smoke:8", stateClass: "assistant_action_bar_visible", copyAreaVisible: true }),
  event("checkpoint", 3220, { checkpointId: "synthetic-smoke:9", stateClass: "assistant_settled", idleGapMs: 1840 }),
  event("checkpoint", 3300, { checkpointId: "synthetic-smoke:10", stateClass: "mica_copy_invoked", markdownLength: 240 }),
  event("checkpoint", 3400, { checkpointId: "synthetic-smoke:11", stateClass: "mica_overlay_state", mode: "compact", recording: true })
];

const manifest = {
  schemaVersion: 1,
  kind: "mica.liveSurfaceAtlas.raw",
  sessionId,
  createdAt: new Date().toISOString(),
  source: "synthetic-atlas-smoke",
  dedicatedThreadUrl: "about:synthetic",
  privacy: privacyFlags(),
  safety: safetyFlags()
};

const performance = {
  schemaVersion: 1,
  eventTiming: [{ name: "input", startTime: 80, duration: 2.5, processingStart: 80.4, processingEnd: 81.8 }],
  longAnimationFrame: [],
  longTask: [],
  layoutShift: [],
  memory: { usedJSHeapSize: 1200000, totalJSHeapSize: 2400000, jsHeapSizeLimit: 4096000000 }
};

const surfaces = {
  composer: surface("composer", "OBSERVED", { tag: "form", role: null, rect: { x: 40, y: 730, width: 820, height: 72 } }),
  assistantActionBar: surface("assistantActionBar", "OBSERVED", { tag: "div", role: "toolbar", rect: { x: 620, y: 520, width: 220, height: 40 } }),
  mentionChooser: surface("mentionChooser", "OBSERVED", { tag: "div", role: "listbox", rect: { x: 56, y: 580, width: 360, height: 260 } }),
  connectorPill: surface("connectorPill", "OBSERVED", { tag: "span", role: null, rect: { x: 76, y: 744, width: 94, height: 24 } }),
  micaOverlay: surface("micaOverlay", "OBSERVED", { tag: "mica-overlay", role: null, rect: { x: 812, y: 760, width: 56, height: 44 } })
};

await writeJson(path.join(defaultRawSession, "manifest.json"), manifest);
await writeText(path.join(defaultRawSession, "timeline.ndjson"), `${timeline.map((item) => JSON.stringify(item)).join("\n")}\n`);
await writeJson(path.join(defaultRawSession, "performance.json"), performance);
await writeJson(path.join(defaultRawSession, "coverage.json"), coverage);
for (const [name, value] of Object.entries(surfaces)) {
  await writeJson(path.join(defaultRawSession, "surfaces", `${name}.json`), value);
}
console.log(JSON.stringify({ passed: true, rawSession: defaultRawSession, sessionId }, null, 2));

function event(type, relativeTimeMs, details) {
  return { schemaVersion: 1, type, monotonicTimeMs: relativeTimeMs, relativeTimeMs, epochTimeMs: 1788888888000 + relativeTimeMs, details };
}

function surface(name, status, contract) {
  return { schemaVersion: 1, name, status, source: "synthetic-atlas-smoke", privacy: privacyFlags(), contract };
}

function privacyFlags() {
  return { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false };
}

function safetyFlags() {
  return { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false, playwrightRealSiteTraceUsed: false, computerUseRequired: false };
}
