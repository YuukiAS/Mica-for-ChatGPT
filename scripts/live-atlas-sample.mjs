import path from "node:path";
import { defaultRawSession, surfaceKeys, writeJson, writeText } from "./live-atlas-common.mjs";

const sessionId = "synthetic-smoke";
const syntheticCreatedAt = "2026-09-10T00:00:00.000Z";
const coverage = Object.fromEntries(surfaceKeys.map((key) => [key, { status: "MISSING", count: 0 }]));
for (const key of ["composer", "userTurn", "assistantStreaming", "assistantSettled", "assistantActionBar", "nativeCopyArea", "richMarkdown", "mentionChooser", "connectorPill", "micaOverlay", "longThreadMountedWindow", "micaCopy"]) {
  coverage[key] = { status: "OBSERVED", count: 1 };
}

const timeline = [
  event("checkpoint", 0, { checkpointId: "synthetic-smoke:1", stateClass: "atlas_started" }),
  event("checkpoint", 40, { checkpointId: "synthetic-smoke:2", stateClass: "composer_focus", textLength: 0 }),
  event("composer_beforeinput", 80, { inputType: "insertText", dataLength: 1, textLengthBefore: 0, textLengthAfter: 1 }),
  event("composer_input", 96, { inputType: "insertText", dataLength: 1, textLengthBefore: 0, textLengthAfter: 1 }),
  ...generation(1, 220),
  ...generation(2, 4220),
  ...generation(3, 8220),
  event("checkpoint", 12280, { checkpointId: "synthetic-smoke:30", stateClass: "mica_copy_invoked", markdownLength: 240, generationId: 2 }),
  event("checkpoint", 12340, { checkpointId: "synthetic-smoke:31", stateClass: "mica_overlay_state", mode: "compact", recording: true })
];

const manifest = {
  schemaVersion: 1,
  kind: "mica.liveSurfaceAtlas.raw",
  sessionId,
  createdAt: syntheticCreatedAt,
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
  composer: surface("composer", "OBSERVED", contract("form", null, { x: 40, y: 730, width: 820, height: 72 }, { "data-composer-surface": "true" }, { "border-radius": "28px", "background-color": "rgb(255, 255, 255)" })),
  assistantActionBar: surface("assistantActionBar", "OBSERVED", contract("div", "toolbar", { x: 620, y: 520, width: 220, height: 40 }, { role: "toolbar" }, { display: "flex" })),
  mentionChooser: surface("mentionChooser", "OBSERVED", contract("div", "listbox", { x: 56, y: 580, width: 360, height: 260 }, { role: "listbox" }, { "background-color": "rgb(255, 255, 255)" })),
  connectorPill: surface("connectorPill", "OBSERVED", contract("span", null, { x: 76, y: 744, width: 94, height: 24 }, { "data-id": "plugin:anonymous", "data-inline-selection-pill": "" }, { "border-radius": "999px" })),
  micaOverlay: surface("micaOverlay", "OBSERVED", contract("mica-overlay", null, { x: 812, y: 760, width: 56, height: 44 }, { "data-mica-root": "true" }, { position: "fixed" }))
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

function generation(id, base) {
  return [
    event("checkpoint", base, { checkpointId: `synthetic-smoke:g${id}:send`, stateClass: "manual_send_intent", source: "submit", generationId: id }),
    event("checkpoint", base + 80, { checkpointId: `synthetic-smoke:g${id}:user`, stateClass: "user_turn_mounted", mountedTurns: 2 + id, generationId: id }),
    event("checkpoint", base + 130, { checkpointId: `synthetic-smoke:g${id}:zero`, stateClass: "composer_body_zero", textLength: 0, generationId: id }),
    event("checkpoint", base + 310, { checkpointId: `synthetic-smoke:g${id}:assistant`, stateClass: "assistant_turn_mounted", turnId: `a${id}`, generationId: id }),
    event("checkpoint", base + 450, { checkpointId: `synthetic-smoke:g${id}:first`, stateClass: "assistant_first_content_mutation", turnId: `a${id}`, generationId: id }),
    event("assistant_stream_mutation_burst", base + 650, { turnId: `a${id}`, generationId: id, addedNodes: 2, removedNodes: 0, mutationCount: 6 }),
    event("assistant_stream_mutation_burst", base + 930, { turnId: `a${id}`, generationId: id, addedNodes: 3, removedNodes: 0, mutationCount: 8 }),
    event("checkpoint", base + 2860, { checkpointId: `synthetic-smoke:g${id}:actions`, stateClass: "assistant_action_bar_visible", turnId: `a${id}`, copyAreaVisible: true, generationId: id }),
    event("checkpoint", base + 2920, { checkpointId: `synthetic-smoke:g${id}:settled`, stateClass: "assistant_settled", turnId: `a${id}`, idleGapMs: 1840, generationId: id })
  ];
}

function surface(name, status, contract) {
  return { schemaVersion: 1, name, status, source: "synthetic-atlas-smoke", discardedRawTextContent: "MY_PRIVATE_RANDOM_SENTENCE_93817", privacy: privacyFlags(), contract };
}

function contract(tag, role, rect, attrs, styles) {
  return {
    tag,
    role,
    attrs,
    rect,
    state: { disabled: false, expanded: null, pressed: null, contenteditable: null },
    text: { category: "redacted", length: 32 },
    styles,
    children: [{ tag: "button", role: null, attrs: { "aria-label": "Copy" }, rect: null, state: { disabled: false, expanded: null, pressed: null, contenteditable: null }, text: { category: "short", length: 4 }, styles: {}, children: [] }]
  };
}

function privacyFlags() {
  return { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false };
}

function safetyFlags() {
  return { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false, playwrightRealSiteTraceUsed: false, computerUseRequired: false };
}
