import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { defaultContractDir, defaultRawSession, readJson, surfaceKeys, validatePrivacyObject, writeJson } from "./live-atlas-common.mjs";

const input = argValue("--input") || defaultRawSession;
const output = argValue("--output") || defaultContractDir;

const manifest = await readJson(path.join(input, "manifest.json"));
const coverage = await readJson(path.join(input, "coverage.json"));
const performance = await readJson(path.join(input, "performance.json"));
const timelineText = await readFile(path.join(input, "timeline.ndjson"), "utf8");
const timeline = timelineText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const surfacesDir = path.join(input, "surfaces");
const surfaceFiles = await readdir(surfacesDir).catch(() => []);
const surfaces = {};
for (const file of surfaceFiles.filter((name) => name.endsWith(".json"))) {
  const value = await readJson(path.join(surfacesDir, file));
  validatePrivacyObject(value, file);
  surfaces[path.basename(file, ".json")] = value;
}

for (const value of [manifest, coverage, performance, timeline, surfaces]) validatePrivacyObject(value);
for (const key of surfaceKeys) {
  if (!coverage[key]) coverage[key] = { status: "MISSING", count: 0 };
}

const lifecycle = {
  schemaVersion: 1,
  kind: "mica.liveSurfaceAtlas.lifecycle",
  source: manifest.source || "unknown",
  privacy: manifest.privacy,
  safety: manifest.safety,
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
console.log(JSON.stringify({ passed: true, input, output, surfaces: Object.keys(surfaces).length, events: timeline.length }, null, 2));

function deriveTimings(timeline, performance) {
  const firstByState = new Map();
  for (const item of timeline) {
    const state = item.details?.stateClass || item.type;
    if (!firstByState.has(state)) firstByState.set(state, item.relativeTimeMs);
  }
  const diff = (from, to) => firstByState.has(from) && firstByState.has(to) ? Math.round((firstByState.get(to) - firstByState.get(from)) * 10) / 10 : null;
  return {
    inputToHandlerProcessingMs: performance.eventTiming?.map((entry) => entry.duration).filter(Number.isFinite) || [],
    manualSendIntentToUserTurnMountedMs: diff("manual_send_intent", "mounted_turn_window_changed"),
    manualSendIntentToComposerBodyZeroMs: diff("manual_send_intent", "composer_body_zero"),
    userTurnToAssistantMountedMs: diff("mounted_turn_window_changed", "assistant_turn_mounted"),
    assistantMountedToFirstMutationMs: diff("assistant_turn_mounted", "assistant_first_content_mutation"),
    lastMutationToActionBarVisibleMs: diff("assistant_stream_mutation_burst", "assistant_action_bar_visible"),
    lastMutationToSettledMs: diff("assistant_stream_mutation_burst", "assistant_settled")
  };
}

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}
