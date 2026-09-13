import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_HEAVY_CAPTURE_PER_10S_BUDGET,
  DEFAULT_NORMAL_HEAVY_CAPTURE_BUDGET,
  DEFAULT_TOTAL_HEAVY_CAPTURE_BUDGET,
  CONNECTOR_BURST_WINDOW_MS,
  isGenerationLifecycleSurface,
  semanticVisualKey,
  surfaceKeyForCheckpoint,
  visualPriorityFor
} from "./live-atlas-cdp-core.mjs";
import { assert, rawRoot, readJson } from "./live-atlas-common.mjs";

const input = argValue("--input") || path.join(rawRoot, "capture-1789266647815");
const oldRound6WindowStartMs = Number(argValue("--round6-start-ms") || 294_900);
const oldRound6WindowEndMs = Number(argValue("--round6-end-ms") || 309_100);
const manifest = await readJson(path.join(input, "manifest.json"));
const timeline = (await readFile(path.join(input, "timeline.ndjson"), "utf8"))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const checkpoints = timeline
  .filter((event) => event.type === "checkpoint" && event.timeBase === "atlas-session-relative")
  .map((event) => ({
    ...event.details,
    relativeTimeMs: event.relativeTimeMs,
    monotonicTimestamp: event.relativeTimeMs
  }));
const selection = simulateSemanticVisualPolicy(checkpoints);
const selectedStates = new Set(selection.selected.map((item) => item.stateClass));
const selectedSurfaces = new Set(selection.selected.map((item) => item.surfaceKey));
const round6Selected = selection.selected.filter((item) => item.at >= oldRound6WindowStartMs && item.at <= oldRound6WindowEndMs);
const focusEvents = checkpoints.filter((event) => event.stateClass === "composer_focus").length;
const blurEvents = checkpoints.filter((event) => event.stateClass === "composer_blur").length;
const assistantSettledSelected = selection.selected.filter((item) => item.surfaceKey === "assistantSettled");
const assistantSettledKeys = new Set(assistantSettledSelected.map((item) => item.semanticKey));

assert(manifest.visualCapture?.executedHeavyCaptureCount === 168, "real failure artifact old heavy capture count drifted");
assert(selection.selected.length <= DEFAULT_TOTAL_HEAVY_CAPTURE_BUDGET, `new policy selected too many heavy captures: ${selection.selected.length}`);
assert(round6Selected.length <= DEFAULT_HEAVY_CAPTURE_PER_10S_BUDGET, `Round 6 burst selected too many captures: ${round6Selected.length}`);
assert(focusEvents === 34 && blurEvents === 34, "composer focus/blur lifecycle events were not preserved in replay input");
assert(!selectedStates.has("composer_focus") && !selectedStates.has("composer_blur"), "composer focus/blur were selected for heavy capture");
assert(selectedStates.has("composer_identity_changed"), "composer remount/identity variant was not retained");
assert(selectedSurfaces.has("mentionChooser"), "mention chooser was not prioritized for capture");
assert(selectedSurfaces.has("connectorPill"), "connector pill was not retained");
assert(selection.selected.filter((item) => item.surfaceKey === "connectorPill").length === 1, "connector pill episode was not deduped");
assert(selectedSurfaces.has("richMarkdown"), "rich markdown surface was not retained");
assert(selectedSurfaces.has("userTurn"), "user turn lifecycle capture was lost");
assert(selectedSurfaces.has("assistantStreaming") && selectedSurfaces.has("assistantSettled"), "assistant generation lifecycle capture was lost");
assert(assistantSettledSelected.length === assistantSettledKeys.size, "assistant settled semantic dedupe failed");
assert(selection.peakPer10s <= DEFAULT_HEAVY_CAPTURE_PER_10S_BUDGET, "rolling 10s budget exceeded");

console.log(JSON.stringify({
  passed: true,
  input,
  oldHeavyCaptureCount: manifest.visualCapture.executedHeavyCaptureCount,
  newPolicyHeavyCaptureCount: selection.selected.length,
  round6OldHeavyCaptureCount: 39,
  round6NewPolicyHeavyCaptureCount: round6Selected.length,
  assistantSettledDedup: true,
  composerFocusBlurEventOnly: true,
  mentionChooserPriority: selectedSurfaces.has("mentionChooser"),
  connectorPillEpisodeDedup: true,
  mountedWindowDedup: selection.selected.filter((item) => item.surfaceKey === "longThreadMountedWindow").length,
  budgetSkippedVisualCount: selection.budgetSkippedVisualCount,
  peakPer10s: selection.peakPer10s,
  selectedBySurface: selection.bySurface
}, null, 2));

function simulateSemanticVisualPolicy(events) {
  const captured = new Set();
  const selected = [];
  const bySurface = {};
  let budgetSkippedVisualCount = 0;
  let peakPer10s = 0;
  let normalCount = 0;
  for (const checkpoint of events) {
    const surfaceKey = surfaceKeyForCheckpoint(checkpoint.stateClass);
    if (!surfaceKey) continue;
    const priority = visualPriorityFor(surfaceKey, checkpoint);
    const semanticKey = semanticVisualKey(checkpoint, surfaceKey, {
      composerBaselineAlreadyRepresented: captured.has("composer:baseline")
    });
    if (!semanticKey || captured.has(semanticKey)) continue;
    if (isBaselineTurnSurface(surfaceKey, checkpoint)) continue;
    const at = Number(checkpoint.relativeTimeMs ?? checkpoint.monotonicTimestamp ?? 0);
    const rolling = selected.filter((item) => item.at >= at - CONNECTOR_BURST_WINDOW_MS && item.at <= at).length;
    if (priority !== "HIGH" && normalCount >= DEFAULT_NORMAL_HEAVY_CAPTURE_BUDGET && !isGenerationLifecycleSurface(surfaceKey)) {
      budgetSkippedVisualCount += 1;
      continue;
    }
    if (selected.length >= DEFAULT_TOTAL_HEAVY_CAPTURE_BUDGET || (rolling >= DEFAULT_HEAVY_CAPTURE_PER_10S_BUDGET && priority !== "HIGH" && !isGenerationLifecycleSurface(surfaceKey))) {
      budgetSkippedVisualCount += 1;
      continue;
    }
    captured.add(semanticKey);
    const item = {
      at,
      stateClass: checkpoint.stateClass,
      generationId: checkpoint.generationId ?? null,
      turnId: checkpoint.turnId || null,
      surfaceKey,
      semanticKey,
      priority
    };
    selected.push(item);
    bySurface[surfaceKey] = (bySurface[surfaceKey] || 0) + 1;
    if (priority !== "HIGH") normalCount += 1;
    const nextPeak = selected.filter((entry) => entry.at >= at - CONNECTOR_BURST_WINDOW_MS && entry.at <= at).length;
    peakPer10s = Math.max(peakPer10s, nextPeak);
  }
  return { selected, bySurface, budgetSkippedVisualCount, peakPer10s };
}

function isBaselineTurnSurface(surfaceKey, checkpoint) {
  if ((surfaceKey === "assistantActionBar" || surfaceKey === "nativeCopyArea") && checkpoint.generationId == null) return true;
  if (["userTurn", "assistantStreaming", "assistantSettled", "richMarkdown"].includes(surfaceKey) && checkpoint.generationId == null) return true;
  return false;
}

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}
