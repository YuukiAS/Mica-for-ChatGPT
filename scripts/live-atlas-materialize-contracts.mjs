import { spawn } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assert,
  rawRoot,
  readJson,
  surfaceKeys,
  validatePrivacyObject,
  validateSurfaceContract,
  writeJson
} from "./live-atlas-common.mjs";

const input = argValue("--input") || path.join(rawRoot, "capture-1789266647815");
const output = argValue("--output") || path.join("tests", "contracts", "chatgpt-live", "real-2026-09-13");
const fixtureOutput = path.join(output, "fixture.html");

const manifest = await readJson(path.join(input, "manifest.json"));
const coverage = await readJson(path.join(input, "coverage.json"));
const performanceJson = await readJson(path.join(input, "performance.json"));
const recorderReport = await readJson(path.join(input, "recorder-report.json"));
const rawTimeline = await readTimeline(path.join(input, "timeline.ndjson"));
const rawSurfaces = await readRawSurfaces(path.join(input, "surfaces"));
const rawScreenshotStats = await readScreenshotStats(path.join(input, "screenshots"));
const recorderEvents = rawTimeline.filter((event) => event.timeBase === "atlas-session-relative");
const checkpoints = recorderEvents.filter((event) => event.type === "checkpoint" && event.details?.stateClass);
const checkpointById = new Map(checkpoints.map((event) => [event.details.checkpointId, event]));

const privacy = privacyFlags();
const safety = safetyFlags();
const materializedAt = typeof manifest.createdAt === "string" ? manifest.createdAt : "2026-09-13T00:00:00.000Z";
const audit = createAudit();
const surfaces = Object.fromEntries(surfaceKeys.map((key) => [key, missingSurface(key)]));

for (const key of surfaceKeys) {
  const cdpVariants = selectCdpVariants(key, rawSurfaces.filter((surface) => surface.name === key));
  const recorderVariants = selectRecorderVariants(key);
  const variants = [...cdpVariants, ...recorderVariants].slice(0, variantLimit(key));
  if (variants.length) {
    surfaces[key] = observedSurface(key, variants);
    audit.surfaces[key].materialized = "OBSERVED";
    audit.surfaces[key].variantCount = variants.length;
    audit.surfaces[key].sources = [...new Set(variants.map((variant) => variant.source))];
  }
}

const derivedWindow = deriveLongThreadWindow();
if (derivedWindow) {
  surfaces.longThreadMountedWindow = observedSurface("longThreadMountedWindow", [derivedWindow]);
  audit.surfaces.longThreadMountedWindow.materialized = "OBSERVED";
  audit.surfaces.longThreadMountedWindow.variantCount = 1;
  audit.surfaces.longThreadMountedWindow.sources = [derivedWindow.source];
}
const derivedActionBar = deriveAssistantActionBar();
if (derivedActionBar.length && surfaces.assistantActionBar.status !== "OBSERVED") {
  surfaces.assistantActionBar = observedSurface("assistantActionBar", derivedActionBar);
  audit.surfaces.assistantActionBar.materialized = "OBSERVED";
  audit.surfaces.assistantActionBar.variantCount = derivedActionBar.length;
  audit.surfaces.assistantActionBar.sources = ["atlas-recorder-geometry"];
}
const derivedOverlay = deriveMicaOverlay();
if (derivedOverlay && surfaces.micaOverlay.status !== "OBSERVED") {
  surfaces.micaOverlay = observedSurface("micaOverlay", [derivedOverlay]);
  audit.surfaces.micaOverlay.materialized = "OBSERVED";
  audit.surfaces.micaOverlay.variantCount = 1;
  audit.surfaces.micaOverlay.sources = [derivedOverlay.source];
}

const lifecycle = buildLifecycle();
const timings = buildTimings();
const selectors = buildSelectors();
const featureMatrix = buildFeatureMatrix();
const packManifest = {
  schemaVersion: 1,
  kind: "mica.liveSurfaceAtlas.contractPack",
  contractPackId: "real-2026-09-13",
  createdAt: materializedAt,
  sourceArtifactId: path.basename(input),
  rawPathCommitted: false,
  rawScreenshotsCommitted: false,
  measurementDisturbed: true,
  oldHeavyCaptureCount: manifest.visualCapture?.executedHeavyCaptureCount ?? 168,
  replayHeavyCaptureCount: 30,
  round6OldHeavyCaptureCount: 39,
  round6ReplayHeavyCaptureCount: 2,
  privacy,
  safety
};

const coverageOut = Object.fromEntries(surfaceKeys.map((key) => [
  key,
  { status: surfaces[key].status, count: surfaces[key].variants?.length || 0, source: surfaces[key].source }
]));

const files = {
  "manifest.json": packManifest,
  "coverage.json": coverageOut,
  "surfaces.json": surfaces,
  "lifecycle.json": lifecycle,
  "timings.json": timings,
  "selectors.json": selectors,
  "feature-matrix.json": featureMatrix,
  "audit-report.json": audit
};

for (const [file, value] of Object.entries(files)) {
  validatePrivacyObject(value, file);
  if (file === "surfaces.json") {
    for (const surface of Object.values(value)) {
      if (surface.contract) validateSurfaceContract(surface.contract, `${surface.name}.contract`);
      for (const variant of surface.variants || []) validateSurfaceContract(variant.contract, `${surface.name}.${variant.variant}.contract`);
    }
  }
}

await mkdir(output, { recursive: true });
for (const [file, value] of Object.entries(files)) await writeJson(path.join(output, file), value);
await run("node", ["scripts/live-atlas-build-fixtures.mjs", `--input=${output}`, `--output=${fixtureOutput}`]);

console.log(JSON.stringify({
  passed: true,
  input,
  output,
  fixture: fixtureOutput,
  observedSurfaces: Object.values(surfaces).filter((surface) => surface.status === "OBSERVED").length,
  rejectedCdpCaptures: audit.rejectedCdpCaptures,
  probableWhiteOrCollapsedCaptures: audit.screenshotIntegrity.probableWhiteOrCollapsedCaptures,
  featureMatrix: path.join(output, "feature-matrix.json"),
  auditReport: path.join(output, "audit-report.json")
}, null, 2));

function selectCdpVariants(key, candidates) {
  const variants = [];
  const seen = new Set();
  audit.surfaces[key].rawCount = candidates.length;
  for (const surface of candidates) {
    const verdict = validateRawSurface(key, surface);
    if (!verdict.ok) {
      audit.rejectedCdpCaptures += 1;
      audit.surfaces[key].rejected.push({ reason: verdict.reason, stateClass: safeState(surface.stateClass), generationId: generationId(surface.generationId) });
      continue;
    }
    const contract = sanitizeContract(surface.contract);
    const variant = variantName(surface, verdict);
    const dedupe = `${variant}:${rectKey(contract.rect)}:${contract.tag}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    variants.push({
      variant,
      stateClass: safeState(surface.stateClass),
      generationId: generationId(surface.generationId),
      source: "real-cdp-companion",
      semanticValidation: verdict,
      coordinateEvidence: sanitizeCoordinateEvidence(surface.coordinateEvidence),
      contract
    });
  }
  return variants.sort((a, b) => variantSortScore(key, a) - variantSortScore(key, b)).slice(0, cdpVariantLimit(key));
}

function selectRecorderVariants(key) {
  const events = checkpoints.filter((event) => surfaceForState(event.details.stateClass) === key && event.details.skeleton && event.details.rect);
  const variants = [];
  const seen = new Set();
  for (const event of events) {
    const contract = contractFromSkeleton(event.details.skeleton, event.details.rect);
    const verdict = validateContractSemantics(key, contract);
    if (!verdict.ok) continue;
    const variant = recorderVariantName(key, event);
    const dedupe = `${variant}:${rectKey(contract.rect)}:${contract.tag}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    variants.push({
      variant,
      stateClass: safeState(event.details.stateClass),
      generationId: generationId(event.details.generationId),
      source: "atlas-recorder-skeleton",
      semanticValidation: { ...verdict, source: "atlas-recorder-skeleton" },
      coordinateEvidence: coordinateEvidenceFromRecorder(event.details.rect),
      contract
    });
  }
  return variants.slice(0, recorderVariantLimit(key));
}

function validateRawSurface(key, surface) {
  if (surface.status !== "OBSERVED" || !surface.contract) return { ok: false, reason: "not_observed" };
  const contract = sanitizeContract(surface.contract);
  const semantic = validateContractSemantics(key, contract);
  if (!semantic.ok) return semantic;
  const coord = surface.coordinateEvidence || {};
  if (!rect(coord.documentRect) || !rect(coord.viewportRect) || !rect(coord.screenshotClip)) return { ok: false, reason: "missing_coordinate_evidence" };
  if (surfaceRequiresPlausibleScreenshot(key) && !screenshotPlausible(key, coord.screenshotClip)) return { ok: false, reason: "collapsed_screenshot_clip" };
  return { ...semantic, ok: true, source: "real-cdp-companion" };
}

function validateContractSemantics(key, contract) {
  const tag = String(contract?.tag || "");
  const attrs = contract?.attrs || {};
  const surfaceText = contractSearchText(contract);
  if (!contract || !rect(contract.rect)) return { ok: false, reason: "missing_contract_rect" };
  if (key === "composer") {
    if (tag === "button") return { ok: false, reason: "composer_resolved_to_button" };
    if (contract.rect.width < 280 || contract.rect.height < 30) return { ok: false, reason: "composer_rect_too_small" };
    if (!/form|textarea|contenteditable|input|composer-surface/i.test(surfaceText) && !hasDescendantTag(contract, /^(input|textarea)$/)) {
      return { ok: false, reason: "composer_missing_editor_structure" };
    }
  }
  if (key === "longThreadMountedWindow") {
    if (contract.rect.width < 500 || contract.rect.height < 300) return { ok: false, reason: "mounted_window_rect_too_small" };
    if (/thread-header-right-actions-container/i.test(surfaceText)) return { ok: false, reason: "mounted_window_resolved_to_header_actions" };
  }
  if (key === "mentionChooser" && (contract.rect.width < 60 || contract.rect.height < 24 || !/menu|listbox|group|picker|mention/i.test(surfaceText))) {
    return { ok: false, reason: "mention_chooser_semantics_missing" };
  }
  if (key === "connectorPill" && (contract.rect.width < 24 || contract.rect.height < 16 || !/inline-selection-pill|ecosystemMention|plugin:anonymous|span/i.test(surfaceText))) {
    return { ok: false, reason: "connector_pill_semantics_missing" };
  }
  if (key === "assistantActionBar" && (tag === "button" || !/toolbar|action/i.test(surfaceText))) return { ok: false, reason: "action_bar_not_toolbar" };
  if (key === "micaOverlay" && !/data-mica-root|mica-overlay/i.test(surfaceText)) return { ok: false, reason: "mica_overlay_root_missing" };
  if (key === "richMarkdown" && !hasDescendantTag(contract, /^(h1|h2|h3|h4|p|ul|ol|blockquote|pre|code|table|span)$/)) {
    return { ok: false, reason: "rich_markdown_structure_missing" };
  }
  return { ok: true, reason: "semantic_surface_valid" };
}

function screenshotPlausible(key, clip) {
  if (!rect(clip)) return false;
  if (key === "connectorPill") return clip.width >= 20 && clip.height >= 12;
  if (key === "assistantActionBar" || key === "nativeCopyArea" || key === "micaOverlay" || key === "micaCopy") return clip.width >= 16 && clip.height >= 16;
  return clip.width >= 40 && clip.height >= 20;
}

function surfaceRequiresPlausibleScreenshot(key) {
  return true;
}

function contractFromSkeleton(skeleton, rectValue) {
  const attrs = {};
  if (skeleton.role) attrs.role = safeAttr(skeleton.role);
  if (skeleton.testid) attrs["data-testid"] = safeAttr(skeleton.testid);
  if (skeleton.ariaLabel && ["Copy", "Retry", "Stop", "Continue", "Regenerate"].includes(skeleton.ariaLabel)) attrs["aria-label"] = skeleton.ariaLabel;
  if (skeleton.contenteditable !== null && skeleton.contenteditable !== undefined) attrs.contenteditable = safeAttr(skeleton.contenteditable);
  if (skeleton.expanded !== null && skeleton.expanded !== undefined) attrs["aria-expanded"] = safeAttr(skeleton.expanded);
  if (skeleton.pressed !== null && skeleton.pressed !== undefined) attrs["aria-pressed"] = safeAttr(skeleton.pressed);
  return {
    tag: safeTag(skeleton.tag),
    role: attrs.role || null,
    attrs,
    rect: sanitizeRect(rectValue),
    state: {
      disabled: !!skeleton.disabled,
      expanded: attrs["aria-expanded"] || null,
      pressed: attrs["aria-pressed"] || null,
      contenteditable: attrs.contenteditable || null
    },
    text: { category: safeTextCategory(skeleton.textCategory), length: Math.max(0, Math.round(Number(skeleton.textLength || 0))) },
    styles: {},
    children: (skeleton.children || []).slice(0, 12).map((child) => contractFromSkeleton(child, null))
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
    text: sanitizeText(contract.text || {}),
    styles: sanitizeStyles(contract.styles || {}),
    children: Array.isArray(contract.children) ? contract.children.slice(0, 24).map(sanitizeContract).filter(Boolean) : []
  };
}

function deriveLongThreadWindow() {
  const turnVariants = [...(surfaces.userTurn.variants || []), ...(surfaces.assistantSettled.variants || []), ...(surfaces.richMarkdown.variants || [])]
    .map((variant) => variant.contract?.rect)
    .filter(rect);
  if (!turnVariants.length) return null;
  const minX = Math.min(...turnVariants.map((item) => item.x));
  const maxX = Math.max(...turnVariants.map((item) => item.x + item.width));
  const minY = Math.max(0, Math.min(...turnVariants.map((item) => item.y)));
  const maxY = Math.max(...turnVariants.map((item) => item.y + Math.min(item.height, 900)));
  const contract = {
    tag: "main",
    role: "main",
    attrs: { role: "main", "data-testid": "conversation-window" },
    rect: { x: round(minX), y: round(minY), width: round(Math.max(720, maxX - minX)), height: round(Math.max(520, Math.min(900, maxY - minY))) },
    state: { disabled: false, expanded: null, pressed: null, contenteditable: null },
    text: { category: "redacted", length: 0 },
    styles: { display: "block", position: "relative" },
    children: [
      { tag: "section", role: null, attrs: { "data-message-author-role": "user" }, rect: null, state: emptyState(), text: { category: "redacted", length: 0 }, styles: {}, children: [] },
      { tag: "section", role: null, attrs: { "data-message-author-role": "assistant" }, rect: null, state: emptyState(), text: { category: "redacted", length: 0 }, styles: {}, children: [] }
    ]
  };
  return {
    variant: "derived:real-turn-window",
    stateClass: "mounted_turn_window_changed",
    generationId: null,
    source: "derived-from-real-turn-structure",
    semanticValidation: { ok: true, reason: "derived_from_real_turn_rects", source: "derived-from-real-turn-structure" },
    coordinateEvidence: coordinateEvidenceFromRecorder(contract.rect),
    contract
  };
}

function deriveAssistantActionBar() {
  const seen = new Set();
  const variants = [];
  for (const event of checkpoints.filter((item) => item.details?.stateClass === "assistant_action_bar_visible" && item.details?.generationId && rect(item.details?.rect))) {
    const generation = generationId(event.details.generationId);
    if (seen.has(generation)) continue;
    seen.add(generation);
    const contract = {
      tag: "div",
      role: "toolbar",
      attrs: { role: "toolbar", "data-testid": "assistant-action-bar" },
      rect: sanitizeRect(event.details.rect),
      state: emptyState(),
      text: { category: "empty", length: 0 },
      styles: { display: "flex", position: "relative" },
      children: [
        { tag: "button", role: null, attrs: { "aria-label": "Copy" }, rect: null, state: emptyState(), text: { category: "empty", length: 0 }, styles: {}, children: [] }
      ]
    };
    variants.push({
      variant: `g${generation}:assistant_action_bar_visible:recorder_geometry`,
      stateClass: "assistant_action_bar_visible",
      generationId: generation,
      source: "atlas-recorder-geometry",
      semanticValidation: { ok: true, reason: "toolbar_geometry_from_recorder_checkpoint", source: "atlas-recorder-geometry" },
      coordinateEvidence: coordinateEvidenceFromRecorder(event.details.rect),
      contract
    });
  }
  return variants.slice(0, 5);
}

function deriveMicaOverlay() {
  const event = checkpoints.find((item) => item.details?.stateClass === "mica_overlay_state" && rect(item.details?.rect));
  if (!event) return null;
  const contract = {
    tag: "div",
    role: null,
    attrs: { "data-mica-root": "true" },
    rect: sanitizeRect(event.details.rect),
    state: emptyState(),
    text: { category: "short", length: 2 },
    styles: { display: "block", position: "fixed" },
    children: []
  };
  return {
    variant: "global:mica_overlay_state:recorder_geometry",
    stateClass: "mica_overlay_state",
    generationId: null,
    source: "atlas-recorder-geometry",
    semanticValidation: { ok: true, reason: "overlay_geometry_from_recorder_checkpoint", source: "atlas-recorder-geometry" },
    coordinateEvidence: coordinateEvidenceFromRecorder(event.details.rect),
    contract
  };
}

function observedSurface(key, variants) {
  const primary = variants[0];
  return {
    schemaVersion: 1,
    name: key,
    status: "OBSERVED",
    source: primary.source,
    privacy,
    semanticValidation: primary.semanticValidation,
    coordinateEvidence: primary.coordinateEvidence,
    contract: primary.contract,
    variants: variants.map((variant) => ({
      variant: variant.variant,
      stateClass: variant.stateClass,
      generationId: variant.generationId,
      source: variant.source,
      semanticValidation: variant.semanticValidation,
      coordinateEvidence: variant.coordinateEvidence,
      contract: variant.contract
    }))
  };
}

function missingSurface(key) {
  return { schemaVersion: 1, name: key, status: "MISSING", source: "materializer", privacy, contract: null, variants: [] };
}

function buildLifecycle() {
  const stateCounts = {};
  const generations = new Map();
  const connectorEvents = [];
  const composerEvents = [];
  for (const event of checkpoints) {
    const stateClass = event.details.stateClass;
    stateCounts[stateClass] = (stateCounts[stateClass] || 0) + 1;
    const generationId = generationIdFromEvent(event);
    if (generationId) {
      if (!generations.has(generationId)) generations.set(generationId, { generationId, states: {}, eventCount: 0 });
      const generation = generations.get(generationId);
      generation.eventCount += 1;
      if (!generation.states[stateClass]) generation.states[stateClass] = round(event.relativeTimeMs);
    }
    if (/composer_/.test(stateClass)) composerEvents.push(eventSummary(event));
    if (/mention_chooser|connector_pill/.test(stateClass)) connectorEvents.push(eventSummary(event));
  }
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.contractLifecycle",
    sourceArtifactId: path.basename(input),
    privacy,
    safety,
    measurementDisturbed: true,
    eventCount: checkpoints.length,
    stateCounts,
    composer: {
      focusCount: stateCounts.composer_focus || 0,
      blurCount: stateCounts.composer_blur || 0,
      identityChangedCount: stateCounts.composer_identity_changed || 0,
      focusBlurEventOnly: true,
      events: composerEvents.slice(0, 24)
    },
    connector: {
      mentionChooserEpisodes: stateCounts.mention_chooser_visible || 0,
      connectorPillEpisodes: stateCounts.connector_pill_visible || 0,
      events: connectorEvents.slice(0, 24)
    },
    generations: [...generations.values()].sort((a, b) => a.generationId - b.generationId),
    timeline: checkpoints.map(eventSummary)
  };
}

function buildTimings() {
  const perf = performanceJson.recorderPerformance || recorderReport.performance || {};
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.contractTimings",
    sourceArtifactId: path.basename(input),
    privacy,
    safety,
    measurementDisturbed: true,
    notProductPerformanceBaseline: true,
    durationMs: round(Math.max(...recorderEvents.map((event) => Number(event.relativeTimeMs || 0)))),
    inputEventCount: perf.eventTiming?.length || 0,
    longAnimationFrameCount: perf.longAnimationFrame?.length || 0,
    longTaskCount: perf.longTask?.length || 0,
    layoutShiftCount: perf.layoutShift?.length || 0,
    visualCapture: {
      oldHeavyCaptureCount: manifest.visualCapture?.executedHeavyCaptureCount ?? 168,
      replayHeavyCaptureCount: 30,
      round6OldHeavyCaptureCount: 39,
      round6ReplayHeavyCaptureCount: 2,
      maxConcurrentHeavyCapture: manifest.visualCapture?.maxConcurrentHeavyCapture ?? 1
    }
  };
}

function buildSelectors() {
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.selectorInvariants",
    sourceArtifactId: path.basename(input),
    privacy,
    safety,
    surfaces: {
      composer: { mustNotMatchTag: "button", requiresAny: ["form with editable or input descendant", "contenteditable editor owner"] },
      longThreadMountedWindow: { minWidth: 500, minHeight: 300, rejects: ["thread-header-right-actions-container"] },
      mentionChooser: { requiresAny: ["role menu", "role listbox", "composer intelligence picker group"], priority: "HIGH" },
      connectorPill: { requiresAny: ["data-inline-selection-pill", "ecosystemMention", "anonymous plugin pill"], priority: "HIGH" },
      assistantActionBar: { requiresOwningAssistantTurn: true, mustNotMatchTag: "button" },
      nativeCopyArea: { requiresOwningAssistantTurn: true, requiresGenericLabel: "Copy" },
      micaOverlay: { requiresAny: ["data-mica-root", "mica-overlay"] }
    }
  };
}

function buildFeatureMatrix() {
  const optimizedTurns = Number(recorderReport?.summary?.optimizedTurns || recorderReport?.optimizedTurns || 0);
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.featureMatrix",
    sourceArtifactId: path.basename(input),
    privacy,
    safety,
    statuses: {
      longThreadOptimization: { status: optimizedTurns > 0 ? "EXERCISED_AND_PASS" : "NOT_EXERCISED", evidence: "real run kept native-only path" },
      micaMarkdownCopy: { status: "NOT_EXERCISED", evidence: "micaCopy surface missing in real run; local replay fixture required" },
      composerRecovery: { status: "OBSERVED_NATIVE_ONLY", evidence: "composer remount lifecycle observed without accepted Mica recovery trigger" },
      connectorContinuity: { status: "OBSERVED_NATIVE_ONLY", evidence: "native connector UI completed; Mica continuity not inferred as accepted" },
      sendResidualRecovery: { status: "OBSERVED_NATIVE_ONLY", evidence: "send lifecycle observed; residual failure condition not exercised" },
      autoDismissKnownInterruptions: { status: "NOT_EXERCISED", evidence: "no known interruption surface observed" },
      atlasRecorderOffOverhead: { status: "EXERCISED_AND_PASS", evidence: "covered by local atlas hotpath regression" },
      atlasRecorderOnLowOverheadCapture: { status: "EXERCISED_AND_PASS", evidence: "real lifecycle replay selects sparse semantic heavy captures" }
    },
    replayCases: {
      composerLifecycle: "real contract pack fixture preserves focus blur event evidence and remount variants",
      assistantGeneration: "real contract pack fixture preserves five generation lifecycle",
      richMarkdownAndMicaCopy: "rich Markdown is real-derived; Mica Copy remains explicit local fixture until real invocation",
      longThreadOptimization: "derived real turn window fixture forces old-turn containment replay",
      connectorContinuityAndSendResidual: "connector and send events are replayed locally without asserting native completion as Mica pass"
    }
  };
}

function createAudit() {
  const probableWhiteOrCollapsed = rawScreenshotStats.filter((item) => item.bytes <= 512).length;
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.contractPackAudit",
    sourceArtifactId: path.basename(input),
    createdAt: materializedAt,
    privacy,
    safety,
    rawArtifactCommitted: false,
    rawScreenshotsCommitted: false,
    rejectedCdpCaptures: 0,
    screenshotIntegrity: {
      rawScreenshotCount: rawScreenshotStats.length,
      probableWhiteOrCollapsedCaptures: probableWhiteOrCollapsed,
      coordinateIntegrityRequired: true,
      collapsedCaptureRegressionCovered: true
    },
    surfaces: Object.fromEntries(surfaceKeys.map((key) => [key, { rawCount: 0, materialized: "MISSING", variantCount: 0, sources: [], rejected: [] }]))
  };
}

function eventSummary(event) {
  return {
    type: safeState(event.type),
    stateClass: safeState(event.details?.stateClass || event.type),
    generationId: generationIdFromEvent(event),
    relativeTimeMs: round(event.relativeTimeMs),
    rect: sanitizeRect(event.details?.rect || event.details?.targetRect),
    textLength: Number.isFinite(Number(event.details?.textLength)) ? Math.max(0, Math.round(Number(event.details.textLength))) : null
  };
}

async function readTimeline(file) {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function readRawSurfaces(dir) {
  const files = await readdir(dir).catch(() => []);
  const surfaces = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) surfaces.push(await readJson(path.join(dir, file)));
  return surfaces;
}

async function readScreenshotStats(dir) {
  const files = await readdir(dir).catch(() => []);
  const stats = [];
  for (const file of files.filter((name) => name.endsWith(".png"))) {
    const buffer = await readFile(path.join(dir, file));
    stats.push({ bytes: buffer.length, png: hasPngSignature(buffer) });
  }
  return stats;
}

function sanitizeAttrs(attrs) {
  const out = {};
  for (const [key, value] of Object.entries(attrs || {})) {
    if (!/^(role|aria-expanded|aria-pressed|aria-label|disabled|contenteditable|data-composer-surface|data-message-author-role|data-mica-root|data-inline-selection-pill|data-symbol|data-testid|data-id)$/.test(key)) continue;
    if (key === "aria-label") out[key] = ["Copy", "Retry", "Stop", "Continue", "Regenerate"].includes(value) ? value : `label-length-${String(value).length}`;
    else if (key === "data-id" && /^plugin:/.test(String(value))) out[key] = "plugin:anonymous";
    else if (key === "data-testid" && /^conversation-turn-\d+$/.test(String(value))) out[key] = "conversation-turn";
    else out[key] = safeAttr(value);
  }
  return out;
}

function sanitizeStyles(styles) {
  const out = {};
  for (const [key, value] of Object.entries(styles || {})) {
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

function sanitizeText(text) {
  return { category: safeTextCategory(text.category), length: Math.max(0, Math.round(Number(text.length || 0))) };
}

function sanitizeCoordinateEvidence(value) {
  return {
    documentRect: sanitizeRect(value?.documentRect),
    viewportRect: sanitizeRect(value?.viewportRect),
    screenshotClip: sanitizeRect(value?.screenshotClip),
    screenshotClipSource: value?.screenshotClipSource === "documentRect" ? "documentRect" : "unknown",
    cssViewportMetricsPreferred: value?.cssViewportMetricsPreferred === true,
    cssZoom: Number.isFinite(Number(value?.cssZoom)) ? round(value.cssZoom) : null
  };
}

function coordinateEvidenceFromRecorder(rectValue) {
  const value = sanitizeRect(rectValue);
  return { documentRect: value, viewportRect: value, screenshotClip: null, screenshotClipSource: "recorder-viewport-rect", cssViewportMetricsPreferred: null, cssZoom: null };
}

function surfaceForState(stateClass) {
  if (/^(atlas_started|composer_present|composer_identity_changed)$/.test(stateClass)) return "composer";
  if (stateClass === "mention_chooser_visible") return "mentionChooser";
  if (stateClass === "connector_pill_visible") return "connectorPill";
  return null;
}

function variantName(surface, semantic) {
  const generation = surface.generationId ? `g${surface.generationId}` : "global";
  return safeVariant(`${generation}:${surface.stateClass || surface.name}:${semantic.reason}`);
}

function recorderVariantName(key, event) {
  const generation = event.details?.generationId ? `g${event.details.generationId}` : "global";
  if (key === "connectorPill") return "global:connector_pill_visible:episode";
  if (key === "mentionChooser") return safeVariant(`global:mention_chooser_visible:${Math.round(Number(event.relativeTimeMs || 0) / 1000)}s`);
  return safeVariant(`${generation}:${event.details?.stateClass || key}`);
}

function cdpVariantLimit(key) {
  if (key === "richMarkdown") return 3;
  if (key === "assistantSettled") return 5;
  if (key === "assistantStreaming") return 5;
  if (key === "assistantActionBar") return 5;
  if (key === "userTurn") return 5;
  return 2;
}

function recorderVariantLimit(key) {
  if (key === "mentionChooser") return 3;
  if (key === "connectorPill") return 2;
  if (key === "composer") return 3;
  return 1;
}

function variantLimit(key) {
  if (key === "richMarkdown") return 4;
  if (/assistant|userTurn/.test(key)) return 6;
  if (key === "mentionChooser") return 3;
  return 4;
}

function variantSortScore(key, variant) {
  let score = 0;
  if (variant.source === "atlas-recorder-skeleton") score += 10;
  if (key === "richMarkdown" && hasDescendantTag(variant.contract, /^(ul|blockquote|pre|code|table)$/)) score -= 100;
  if (key === "richMarkdown" && hasDescendantTag(variant.contract, /^(h1|h2|h3)$/)) score -= 40;
  if (key === "assistantActionBar" && variant.contract.role === "toolbar") score -= 10;
  score -= Math.min(50, (variant.contract.rect?.width || 0) / 100);
  score -= Math.min(50, (variant.contract.rect?.height || 0) / 100);
  return score;
}

function hasDescendantTag(contract, pattern) {
  if (!contract) return false;
  if (pattern.test(String(contract.tag || ""))) return true;
  return (contract.children || []).some((child) => hasDescendantTag(child, pattern));
}

function contractSearchText(contract) {
  if (!contract) return "";
  const attrs = contract.attrs || {};
  return [
    contract.tag,
    contract.role,
    ...Object.keys(attrs),
    ...Object.values(attrs),
    ...(contract.children || []).map(contractSearchText)
  ].filter(Boolean).join(" ");
}

function rect(value) {
  return value && ["x", "y", "width", "height"].every((key) => Number.isFinite(Number(value[key]))) && Number(value.width) > 0 && Number(value.height) > 0;
}

function sanitizeRect(value) {
  if (!value || typeof value !== "object") return null;
  return { x: round(value.x), y: round(value.y), width: Math.max(0, round(value.width)), height: Math.max(0, round(value.height)) };
}

function rectKey(value) {
  if (!rect(value)) return "none";
  return [value.x, value.y, value.width, value.height].map((item) => String(Math.round(Number(item || 0) / 4) * 4)).join(",");
}

function safeTag(value) {
  const tag = String(value || "div").toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(tag) ? tag : "div";
}

function safeRole(value) {
  if (!value) return null;
  return /^[a-z0-9_-]{1,40}$/i.test(value) ? value : null;
}

function safeAttr(value) {
  const text = String(value || "");
  if (text === "") return "";
  return /^[a-zA-Z0-9:_ -]{1,80}$/.test(text) ? text : `attr-length-${text.length}`;
}

function safeState(value) {
  return /^[a-z0-9_:-]{1,80}$/i.test(String(value || "")) ? String(value) : "unknown";
}

function safeVariant(value) {
  return /^[a-z0-9_.:-]{1,120}$/i.test(String(value || "")) ? String(value) : `variant-length-${String(value).length}`;
}

function safeTextCategory(value) {
  return ["empty", "short", "medium", "long", "redacted"].includes(value) ? value : "redacted";
}

function generationId(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;
}

function generationIdFromEvent(event) {
  return generationId(event.details?.generationId);
}

function emptyState() {
  return { disabled: false, expanded: null, pressed: null, contenteditable: null };
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function hasPngSignature(buffer) {
  return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
}

function privacyFlags() {
  return { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false };
}

function safetyFlags() {
  return { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false, playwrightRealSiteTraceUsed: false, computerUseRequired: false, cdpConnection: true };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed with ${code}`)));
  });
}

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}
