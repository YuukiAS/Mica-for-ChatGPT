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

const surfaces = [
  surface("composer", contract("form", null, { x: 40, y: 730, width: 820, height: 72 }, { "data-composer-surface": "true" }, { "border-radius": "28px", "background-color": "rgb(255, 255, 255)" }), { checkpointId: "synthetic-smoke:composer-idle", stateClass: "composer_present", variant: "global:composer_present" }),
  surface("composer", contract("form", null, { x: 40, y: 724, width: 820, height: 84 }, { "data-composer-surface": "true" }, { "border-radius": "28px", "box-shadow": "0 8px 24px rgba(0,0,0,.12)" }), { checkpointId: "synthetic-smoke:composer-focused", stateClass: "composer_focus", variant: "global:composer_focus" }),
  surface("userTurn", contract("article", null, { x: 76, y: 320, width: 760, height: 54 }, { "data-message-author-role": "user", "data-testid": "conversation-turn-user" }, { display: "block" }), { checkpointId: "synthetic-smoke:g2:user", stateClass: "user_turn_mounted", generationId: 2, variant: "g2:user_turn_mounted" }),
  surface("assistantStreaming", contract("article", null, { x: 76, y: 380, width: 760, height: 180 }, { "data-message-author-role": "assistant", "data-testid": "conversation-turn-assistant" }, { display: "block" }), { checkpointId: "synthetic-smoke:g2:assistant", stateClass: "assistant_turn_mounted", generationId: 2, variant: "g2:assistant_turn_mounted" }),
  surface("assistantSettled", richContract({ x: 76, y: 380, width: 760, height: 360 }), { checkpointId: "synthetic-smoke:g2:settled", stateClass: "assistant_settled", generationId: 2, variant: "g2:assistant_settled" }),
  surface("richMarkdown", richContract({ x: 76, y: 380, width: 760, height: 360 }), { checkpointId: "synthetic-smoke:g2:rich", stateClass: "rich_markdown_settled", generationId: 2, variant: "g2:rich_markdown_settled" }),
  surface("assistantActionBar", contract("div", "toolbar", { x: 620, y: 520, width: 220, height: 40 }, { role: "toolbar" }, { display: "flex" }), { checkpointId: "synthetic-smoke:g2:actions", stateClass: "assistant_action_bar_visible", generationId: 2, variant: "g2:assistant_action_bar_visible" }),
  surface("nativeCopyArea", contract("div", "toolbar", { x: 620, y: 520, width: 220, height: 40 }, { role: "toolbar", "aria-label": "Copy" }, { display: "flex" }), { checkpointId: "synthetic-smoke:g2:native-copy", stateClass: "assistant_copy_action_visible_or_invoked", generationId: 2, variant: "g2:native_copy_area" }),
  surface("mentionChooser", contract("div", "listbox", { x: 56, y: 580, width: 360, height: 260 }, { role: "listbox" }, { "background-color": "rgb(255, 255, 255)" }), { checkpointId: "synthetic-smoke:mention", stateClass: "mention_chooser_visible", variant: "global:mention_chooser_visible" }),
  surface("connectorPill", contract("span", null, { x: 76, y: 744, width: 94, height: 24 }, { "data-id": "plugin:anonymous", "data-inline-selection-pill": "" }, { "border-radius": "999px" }), { checkpointId: "synthetic-smoke:connector", stateClass: "connector_pill_visible", variant: "global:connector_pill_visible" }),
  surface("micaOverlay", contract("mica-overlay", null, { x: 812, y: 760, width: 56, height: 44 }, { "data-mica-root": "true" }, { position: "fixed" }), { checkpointId: "synthetic-smoke:overlay-compact", stateClass: "mica_overlay_state", variant: "global:mica_overlay_compact" }),
  surface("micaOverlay", contract("mica-overlay", null, { x: 768, y: 732, width: 100, height: 72 }, { "data-mica-root": "true" }, { position: "fixed" }), { checkpointId: "synthetic-smoke:overlay-recording", stateClass: "mica_overlay_state", variant: "global:mica_overlay_recording" }),
  surface("longThreadMountedWindow", contract("main", null, { x: 0, y: 0, width: 900, height: 720 }, { "data-testid": "conversation-window" }, { display: "block" }), { checkpointId: "synthetic-smoke:window", stateClass: "mounted_turn_window_changed", variant: "global:mounted_window" }),
  surface("micaCopy", contract("div", null, { x: 620, y: 474, width: 240, height: 44 }, { "data-testid": "mica-copy" }, { display: "block" }), { checkpointId: "synthetic-smoke:mica-copy", stateClass: "mica_copy_invoked", generationId: 2, variant: "g2:mica_copy_invoked" })
];

await writeJson(path.join(defaultRawSession, "manifest.json"), manifest);
await writeText(path.join(defaultRawSession, "timeline.ndjson"), `${timeline.map((item) => JSON.stringify(item)).join("\n")}\n`);
await writeJson(path.join(defaultRawSession, "performance.json"), performance);
await writeJson(path.join(defaultRawSession, "coverage.json"), coverage);
for (const value of surfaces) {
  await writeJson(path.join(defaultRawSession, "surfaces", `${value.name}-${value.checkpointId.replace(/[^a-zA-Z0-9_-]+/g, "_")}.json`), value);
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

function surface(name, contract, options = {}) {
  return { schemaVersion: 1, name, status: "OBSERVED", source: "synthetic-atlas-smoke", discardedRawTextContent: "MY_PRIVATE_RANDOM_SENTENCE_93817", privacy: privacyFlags(), ...options, contract };
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

function richContract(rect) {
  const root = contract("article", null, rect, { "data-message-author-role": "assistant", "data-testid": "conversation-turn-assistant-rich" }, { display: "block" });
  root.children = [
    { tag: "h2", role: null, attrs: {}, rect: null, state: {}, text: { category: "short", length: 12 }, styles: {}, children: [] },
    { tag: "ul", role: null, attrs: {}, rect: null, state: {}, text: { category: "medium", length: 60 }, styles: {}, children: [] },
    { tag: "blockquote", role: null, attrs: {}, rect: null, state: {}, text: { category: "short", length: 24 }, styles: {}, children: [] },
    { tag: "pre", role: null, attrs: {}, rect: null, state: {}, text: { category: "medium", length: 80 }, styles: {}, children: [{ tag: "code", role: null, attrs: {}, rect: null, state: {}, text: { category: "medium", length: 80 }, styles: {}, children: [] }] },
    { tag: "table", role: null, attrs: {}, rect: null, state: {}, text: { category: "medium", length: 48 }, styles: {}, children: [] }
  ];
  return root;
}

function privacyFlags() {
  return { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false };
}

function safetyFlags() {
  return { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false, playwrightRealSiteTraceUsed: false, computerUseRequired: false };
}
