import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultContractDir,
  defaultRawSession,
  readJson,
  surfaceKeys,
  validatePrivacyObject,
  validateSurfaceContract,
  writeJson
} from "./live-atlas-common.mjs";

const input = argValue("--input") || defaultRawSession;
const output = argValue("--output") || defaultContractDir;

const manifest = await readJson(path.join(input, "manifest.json"));
const coverage = await readJson(path.join(input, "coverage.json"));
const performance = await readJson(path.join(input, "performance.json"));
const timelineText = await readFile(path.join(input, "timeline.ndjson"), "utf8");
const rawTimeline = timelineText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const timeline = sanitizeTimeline(rawTimeline);

const surfaces = await loadSanitizedSurfaces(path.join(input, "surfaces"));

for (const value of [manifest, coverage, performance, timeline, surfaces]) validatePrivacyObject(value);
for (const key of surfaceKeys) {
  if (!coverage[key]) coverage[key] = { status: "MISSING", count: 0 };
  if (!surfaces[key]) surfaces[key] = missingSurface(key);
}

const lifecycle = {
  schemaVersion: 1,
  kind: "mica.liveSurfaceAtlas.lifecycle",
  source: manifest.source || "unknown",
  privacy: manifest.privacy,
  safety: manifest.safety,
  generations: deriveGenerations(timeline),
  timeline
};
const timings = {
  schemaVersion: 1,
  kind: "mica.liveSurfaceAtlas.timings",
  source: manifest.source || "unknown",
  privacy: manifest.privacy,
  safety: manifest.safety,
  metrics: deriveTimings(timeline, performance)
};
await mkdir(output, { recursive: true });
await writeJson(path.join(output, "manifest.json"), { ...manifest, kind: "mica.liveSurfaceAtlas.sanitized", rawPathCommitted: false });
await writeJson(path.join(output, "coverage.json"), coverage);
await writeJson(path.join(output, "lifecycle.json"), lifecycle);
await writeJson(path.join(output, "timings.json"), timings);
await writeJson(path.join(output, "surfaces.json"), surfaces);
console.log(JSON.stringify({ passed: true, input, output, surfaces: Object.values(surfaces).filter((item) => item.status === "OBSERVED").length, events: timeline.length, generations: lifecycle.generations.length }, null, 2));

async function loadSanitizedSurfaces(surfacesDir) {
  const surfaceFiles = await readdir(surfacesDir).catch(() => []);
  const surfaces = {};
  for (const file of surfaceFiles.filter((name) => name.endsWith(".json"))) {
    const value = await readJson(path.join(surfacesDir, file));
    const key = canonicalSurfaceKey(value.name || path.basename(file, ".json").split("-")[0]);
    const sanitized = sanitizeSurface(value, key);
    validatePrivacyObject(sanitized, file);
    surfaces[key] = mergeSurface(surfaces[key], sanitized);
  }
  return surfaces;
}

function sanitizeSurface(value, key) {
  const contract = value.contract ? sanitizeContract(value.contract) : null;
  if (contract) validateSurfaceContract(contract, `${key}.contract`);
  return {
    schemaVersion: 1,
    name: key,
    status: value.status === "OBSERVED" && contract ? "OBSERVED" : "MISSING",
    source: safeSource(value.source),
    privacy: value.privacy || manifest.privacy,
    checkpointId: safeId(value.checkpointId),
    stateClass: safeState(value.stateClass),
    contract
  };
}

function sanitizeContract(contract) {
  if (!contract || typeof contract !== "object") return null;
  return {
    tag: safeTag(contract.tag),
    role: safeRole(contract.role),
    attrs: sanitizeAttrs(contract.attrs || {}),
    rect: sanitizeRect(contract.rect),
    state: sanitizeState(contract.state || {}),
    text: sanitizeTextContract(contract.text || {}),
    styles: sanitizeStyles(contract.styles || {}),
    children: Array.isArray(contract.children) ? contract.children.slice(0, 24).map(sanitizeContract).filter(Boolean) : []
  };
}

function sanitizeTimeline(rawTimeline) {
  const generationState = { current: 0 };
  return rawTimeline.map((event) => {
    const details = sanitizeDetails(event.details || {});
    const stateClass = details.stateClass || event.type;
    if (stateClass === "manual_send_intent") generationState.current += 1;
    const generationId = details.generationId || (isGenerationEvent(stateClass) ? generationState.current || null : null);
    return {
      schemaVersion: 1,
      type: safeEventType(event.type),
      monotonicTimeMs: round(event.monotonicTimeMs),
      relativeTimeMs: round(event.relativeTimeMs),
      epochTimeMs: round(event.epochTimeMs),
      details: { ...details, generationId }
    };
  });
}

function deriveGenerations(timeline) {
  const generations = new Map();
  for (const event of timeline) {
    const stateClass = event.details?.stateClass || event.type;
    const generationId = event.details?.generationId;
    if (!generationId) continue;
    if (!generations.has(generationId)) generations.set(generationId, { generationId, states: {}, eventCount: 0 });
    const generation = generations.get(generationId);
    generation.eventCount += 1;
    if (!generation.states[stateClass]) generation.states[stateClass] = event.relativeTimeMs;
  }
  return [...generations.values()].sort((a, b) => a.generationId - b.generationId);
}

function deriveTimings(timeline, performance) {
  const generations = deriveGenerations(timeline);
  const metric = {
    manualSendIntentToUserTurnMountedMs: [],
    manualSendIntentToComposerBodyZeroMs: [],
    composerMissingToComposerRemountedMs: [],
    userTurnToAssistantMountedMs: [],
    assistantMountedToFirstMutationMs: [],
    streamMutationGapsMs: [],
    lastMutationToActionBarVisibleMs: [],
    lastMutationToSettledMs: [],
    micaRuntimeTransitionToOverlayUpdateMs: [],
    inputDelayMs: [],
    inputProcessingDurationMs: [],
    inputInteractionDurationMs: []
  };
  for (const generation of generations) {
    pushDiff(metric.manualSendIntentToUserTurnMountedMs, generation.states.manual_send_intent, generation.states.user_turn_mounted || generation.states.mounted_turn_window_changed);
    pushDiff(metric.manualSendIntentToComposerBodyZeroMs, generation.states.manual_send_intent, generation.states.composer_body_zero);
    pushDiff(metric.userTurnToAssistantMountedMs, generation.states.user_turn_mounted || generation.states.mounted_turn_window_changed, generation.states.assistant_turn_mounted);
    pushDiff(metric.assistantMountedToFirstMutationMs, generation.states.assistant_turn_mounted, generation.states.assistant_first_content_mutation);
    pushDiff(metric.lastMutationToActionBarVisibleMs, lastMutationForGeneration(timeline, generation.generationId), generation.states.assistant_action_bar_visible);
    pushDiff(metric.lastMutationToSettledMs, lastMutationForGeneration(timeline, generation.generationId), generation.states.assistant_settled || generation.states.assistant_settled_hard_cap);
  }
  for (const pair of pairStates(timeline, "composer_missing", "composer_present")) pushDiff(metric.composerMissingToComposerRemountedMs, pair[0], pair[1]);
  for (const pair of pairStates(timeline, "mica_runtime_transition", "mica_overlay_state")) pushDiff(metric.micaRuntimeTransitionToOverlayUpdateMs, pair[0], pair[1]);
  const streamEvents = timeline.filter((event) => event.type === "assistant_stream_mutation_burst");
  for (let index = 1; index < streamEvents.length; index += 1) {
    if (streamEvents[index].details?.generationId === streamEvents[index - 1].details?.generationId) {
      pushDiff(metric.streamMutationGapsMs, streamEvents[index - 1].relativeTimeMs, streamEvents[index].relativeTimeMs);
    }
  }
  for (const entry of performance.eventTiming || []) {
    const start = Number(entry.startTime);
    const processingStart = Number(entry.processingStart);
    const processingEnd = Number(entry.processingEnd);
    const duration = Number(entry.duration);
    if (Number.isFinite(start) && Number.isFinite(processingStart)) metric.inputDelayMs.push(round(processingStart - start));
    if (Number.isFinite(processingStart) && Number.isFinite(processingEnd)) metric.inputProcessingDurationMs.push(round(processingEnd - processingStart));
    if (Number.isFinite(duration)) metric.inputInteractionDurationMs.push(round(duration));
  }
  return metric;
}

function lastMutationForGeneration(timeline, generationId) {
  let last = null;
  for (const event of timeline) {
    if (event.details?.generationId === generationId && event.type === "assistant_stream_mutation_burst") last = event.relativeTimeMs;
  }
  return last;
}

function pairStates(timeline, from, to) {
  const pairs = [];
  let open = null;
  for (const event of timeline) {
    const stateClass = event.details?.stateClass || event.type;
    if (stateClass === from) open = event.relativeTimeMs;
    if (stateClass === to && open !== null) {
      pairs.push([open, event.relativeTimeMs]);
      open = null;
    }
  }
  return pairs;
}

function pushDiff(target, from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return;
  target.push(round(to - from));
}

function sanitizeDetails(details) {
  const allowed = {};
  const allowedKeys = new Set([
    "checkpointId", "stateClass", "source", "generationId", "turnId", "surfaceId", "rootId", "editableId",
    "mountedTurns", "previousMountedTurns", "textLength", "inputType", "dataLength", "delta", "composing",
    "keyClass", "ctrl", "meta", "shift", "alt", "repeat", "present", "reason", "idleGapMs", "capMs",
    "copyAreaVisible", "mode", "recording", "addedNodes", "removedNodes", "attributes", "count",
    "burstCount", "mutationCount", "elapsedFromMountMs", "label", "rect", "monotonicTimestamp", "clipped",
    "surfaceKey", "screenshot", "counts"
  ]);
  for (const [key, value] of Object.entries(details)) {
    if (!allowedKeys.has(key)) continue;
    if (key === "rect") allowed[key] = sanitizeRect(value);
    else if (key === "counts" && value && typeof value === "object") allowed[key] = sanitizeCounts(value);
    else if (typeof value === "string") allowed[key] = safeDetailString(key, value);
    else if (typeof value === "number") allowed[key] = round(value);
    else if (typeof value === "boolean" || value === null) allowed[key] = value;
  }
  return allowed;
}

function sanitizeCounts(value) {
  return {
    user: Math.max(0, Math.round(Number(value.user || 0))),
    assistant: Math.max(0, Math.round(Number(value.assistant || 0))),
    tool: Math.max(0, Math.round(Number(value.tool || 0)))
  };
}

function mergeSurface(existing, next) {
  if (!existing || existing.status !== "OBSERVED") return next;
  return existing;
}

function missingSurface(key) {
  return { schemaVersion: 1, name: key, status: "MISSING", source: "sanitizer", privacy: manifest.privacy, contract: null };
}

function sanitizeAttrs(attrs) {
  const out = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!/^(role|aria-expanded|aria-pressed|aria-label|disabled|contenteditable|data-composer-surface|data-message-author-role|data-mica-root|data-inline-selection-pill|data-symbol|data-testid|data-id)$/.test(key)) continue;
    if (key === "aria-label") out[key] = ["Copy", "Retry", "Stop", "Continue", "Regenerate"].includes(value) ? value : `label-length-${String(value).length}`;
    else if (key === "data-id" && /^plugin:/.test(String(value))) out[key] = "plugin:anonymous";
    else out[key] = safeAttr(value);
  }
  return out;
}

function sanitizeStyles(styles) {
  const out = {};
  for (const [key, value] of Object.entries(styles)) {
    if (!/^(display|position|border-radius|box-shadow|background-color|color|font-size|line-height|opacity|transform)$/.test(key)) continue;
    if (/url\(|https?:|file:|data:text/i.test(String(value))) continue;
    out[key] = String(value).slice(0, 120);
  }
  return out;
}

function sanitizeState(state) {
  return {
    disabled: !!state.disabled,
    expanded: state.expanded === "true" || state.expanded === "false" ? state.expanded : null,
    pressed: state.pressed === "true" || state.pressed === "false" ? state.pressed : null,
    contenteditable: safeAttr(state.contenteditable || "")
  };
}

function sanitizeTextContract(text) {
  return {
    category: ["empty", "short", "medium", "long", "redacted"].includes(text.category) ? text.category : "redacted",
    length: Number.isFinite(text.length) ? Math.max(0, Math.round(text.length)) : 0
  };
}

function sanitizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  return { x: round(rect.x), y: round(rect.y), width: Math.max(0, round(rect.width)), height: Math.max(0, round(rect.height)) };
}

function canonicalSurfaceKey(key) {
  return surfaceKeys.includes(key) ? key : "composer";
}

function safeTag(value) {
  const tag = String(value || "div").toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(tag) ? tag : "div";
}

function safeRole(value) {
  if (!value) return null;
  return /^[a-z0-9_-]{1,40}$/i.test(value) ? value : null;
}

function safeSource(value) {
  return /^[a-z0-9_.:-]{1,80}$/i.test(String(value || "")) ? String(value) : "redacted-source";
}

function safeId(value) {
  if (!value) return null;
  return /^[a-zA-Z0-9:_-]{1,100}$/.test(String(value)) ? String(value) : `id-length-${String(value).length}`;
}

function safeState(value) {
  return /^[a-z0-9_:-]{1,80}$/i.test(String(value || "")) ? String(value) : "unknown";
}

function safeEventType(value) {
  return /^[a-z0-9_:-]{1,80}$/i.test(String(value || "")) ? String(value) : "event";
}

function safeAttr(value) {
  const text = String(value || "");
  if (text === "") return "";
  return /^[a-zA-Z0-9:_ -]{1,80}$/.test(text) ? text : `attr-length-${text.length}`;
}

function safeDetailString(key, value) {
  if (key === "label" && ["Copy", "Retry", "Stop", "Continue", "Regenerate"].includes(value)) return value;
  if (/^(checkpointId|stateClass|source|turnId|surfaceId|rootId|editableId|reason|mode|surfaceKey|screenshot|keyClass|inputType)$/.test(key)) return /^[a-zA-Z0-9:_./-]{1,120}$/.test(value) ? value : `${key}-length-${value.length}`;
  return `${key}-length-${value.length}`;
}

function isGenerationEvent(stateClass) {
  return /^(manual_send_intent|user_turn_mounted|composer_body_zero|assistant_turn_mounted|assistant_first_content_mutation|assistant_action_bar_visible|assistant_settled|assistant_settled_hard_cap)$/.test(stateClass);
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}
