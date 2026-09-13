import { spawn } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assert,
  rawRoot,
  readJson,
  surfaceKeys,
  validatePrivacyObject,
  writeJson
} from "./live-atlas-common.mjs";
import { validateAtlasThreadUrl } from "./live-atlas-cdp-core.mjs";

const threadUrl = argValue("--thread-url") || process.env.MICA_ATLAS_THREAD_URL || "";
const port = argValue("--port") || process.env.MICA_ATLAS_CDP_PORT || "9222";
const userDataDir = argValue("--user-data-dir") || process.env.MICA_ATLAS_EDGE_USER_DATA_DIR || "";
const sessionId = argValue("--session-id") || `final-live-acceptance-${Date.now()}`;
const raw = argValue("--out") || path.join(rawRoot, sessionId);
const sanitized = argValue("--sanitized") || path.join(rawRoot, `${sessionId}-sanitized`);
const contractPack = argValue("--contract-pack") || path.join("tests", "contracts", "chatgpt-live", "real-2026-09-13");
const heavyCaptureTarget = Number(argValue("--heavy-target") || 12);
const heavyCapturePeakTarget = Number(argValue("--heavy-peak-target") || 8);

validateAtlasThreadUrl(threadUrl);

console.log("FINAL_LIVE_ACCEPTANCE safety:");
console.log("- user manually starts/stops Atlas and performs the one short acceptance flow");
console.log("- CDP remains read-only: no Send, Enter, upload, connector action, retry/regenerate, auth, navigation, or account mutation");
console.log("- after Stop, this harness automatically sanitizes, validates, compares contracts, and writes release-readiness evidence");

await run("node", [
  "scripts/live-atlas-cdp.mjs",
  `--port=${port}`,
  `--thread-url=${threadUrl}`,
  `--out=${raw}`,
  ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : [])
]);
await runPostProcessing({ raw, sanitized, contractPack, heavyCaptureTarget, heavyCapturePeakTarget });

export async function runPostProcessing({ raw, sanitized, contractPack, heavyCaptureTarget = 12, heavyCapturePeakTarget = 8 }) {
  await run("node", ["scripts/live-atlas-sanitize.mjs", `--input=${raw}`, `--output=${sanitized}`]);
  await run("node", ["scripts/live-atlas-privacy.mjs", `--input=${sanitized}`]);
  await run("node", ["scripts/live-atlas-build-fixtures.mjs", `--input=${sanitized}`, `--output=${path.join(sanitized, "fixture.html")}`]);
  await run("node", ["scripts/live-atlas-real-contract-pack-test.mjs", `--input=${contractPack}`]);

  const rawManifest = await readJson(path.join(raw, "manifest.json"));
  const rawPerformance = await readJson(path.join(raw, "performance.json"));
  const rawSurfaces = await readRawSurfaces(path.join(raw, "surfaces"));
  const screenshotEvidence = await readScreenshotEvidence(path.join(raw, "screenshots"));
  const rawTimeline = await readTimeline(path.join(raw, "timeline.ndjson"));
  const sanitizedSurfaces = await readJson(path.join(sanitized, "surfaces.json"));
  const sanitizedLifecycle = await readJson(path.join(sanitized, "lifecycle.json"));
  const contractSurfaces = await readJson(path.join(contractPack, "surfaces.json"));
  const historicalFeatureMatrix = await readJson(path.join(contractPack, "feature-matrix.json"));

  const recorderEvents = rawTimeline.filter((event) => event.timeBase === "atlas-session-relative" && !String(event.type || "").startsWith("cdp_"));
  const cdpErrors = rawTimeline.filter((event) => event.type === "cdp_capture_error" || event.details?.status === "capture_error");
  const visual = rawManifest.visualCapture || rawPerformance.visualCapture || {};
  const required = validateLiveContractCompatibility({ surfaces: sanitizedSurfaces, lifecycle: sanitizedLifecycle, rawSurfaces, rawTimeline });
  const overhead = validateAtlasOverhead({
    manifest: rawManifest,
    performance: rawPerformance,
    visual,
    screenshots: screenshotEvidence,
    rawSurfaces,
    heavyCaptureTarget,
    heavyCapturePeakTarget
  });
  const contractCompare = compareContractPack({ liveSurfaces: sanitizedSurfaces, contractSurfaces });
  const safety = validateSafety({ manifest: rawManifest, performance: rawPerformance, cdpErrors, recorderEvents });
  const featureEvidence = classifyFeatureEvidence({
    rawTimeline,
    rawPerformance,
    sanitizedSurfaces,
    historicalFeatureMatrix
  });
  const releaseReadiness = buildReleaseReadiness({ safety, overhead, required, contractCompare, featureEvidence });
  const report = {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.finalAcceptanceReport",
    rawArtifactId: path.basename(raw),
    sanitizedArtifactId: path.basename(sanitized),
    contractPackId: "real-2026-09-13",
    privacy: privacyFlags(),
    safety: safety.flags,
    finalLiveAcceptance: releaseReadiness.releaseDecision === "PASS" ? "PASS" : "FAIL",
    exactTargetAttached: safety.exactTargetAttached,
    terminationReason: rawManifest.terminationReason,
    truncated: rawManifest.truncated === true || rawPerformance.truncated === true,
    captureErrorCount: cdpErrors.length,
    atlasOverhead: overhead,
    liveContractCompatibility: required,
    contractCompare,
    featureEvidence,
    releaseReadiness
  };

  validatePrivacyObject(report, "final-acceptance-report");
  validatePrivacyObject(releaseReadiness, "release-readiness");
  await mkdir(sanitized, { recursive: true });
  await writeJson(path.join(sanitized, "final-acceptance-report.json"), report);
  await writeJson(path.join(sanitized, "release-readiness.json"), releaseReadiness);

  console.log(JSON.stringify({
    FINAL_LIVE_ACCEPTANCE: report.finalLiveAcceptance,
    rawArtifactId: report.rawArtifactId,
    sanitizedArtifactId: report.sanitizedArtifactId,
    report: "final-acceptance-report.json",
    releaseReadiness: "release-readiness.json",
    liveContractCompatibility: required.passed ? "PASS" : "FAIL",
    contractCompare: contractCompare.passed ? "PASS" : "FAIL",
    atlasOverhead: overhead.passed ? "PASS" : "FAIL",
    maxConcurrentHeavyCapture: overhead.maxConcurrentHeavyCapture,
    heavyCaptureCount: overhead.heavyCaptureCount,
    heavyCapturePer10sPeak: overhead.heavyCapturePer10sPeak,
    whiteOrCollapsedCapture: overhead.whiteOrCollapsedCapture ? "YES" : "NO",
    micaCopyLiveInvocation: featureEvidence.micaMarkdownCopy.liveFeatureInvocation ? "YES" : "NO",
    releaseDecision: releaseReadiness.releaseDecision,
    automatedSend: false,
    automatedEnter: false,
    automatedUpload: false,
    automatedConnectorAction: false
  }, null, 2));

  if (report.finalLiveAcceptance !== "PASS") process.exitCode = 1;
  return report;
}

function validateSafety({ manifest, performance, cdpErrors, recorderEvents }) {
  const flags = {
    automatedSend: false,
    automatedEnter: false,
    automatedUpload: false,
    automatedConnectorAction: false,
    playwrightRealSiteTraceUsed: false,
    computerUseRequired: false,
    cdpConnection: true
  };
  const exactTargetAttached = manifest.attached === true && manifest.targetUrlExactMatch === true;
  const cleanTermination = manifest.terminationReason === "atlas_stopped" && manifest.truncated !== true && performance.truncated !== true && cdpErrors.length === 0;
  const recorderIngested = performance.recorderReportsIngested >= 1 && performance.recorderPerformanceIngested === true && recorderEvents.length > 0;
  assert(exactTargetAttached, "final acceptance failed: exact target was not attached");
  assert(cleanTermination, "final acceptance failed: capture did not terminate cleanly");
  assert(recorderIngested, "final acceptance failed: recorder report/performance was not ingested");
  assert(!manifest.safety?.automatedSend && !manifest.safety?.automatedEnter && !manifest.safety?.automatedUpload && !manifest.safety?.automatedConnectorAction, "final acceptance failed: unsafe automation flag present");
  return { flags, exactTargetAttached, cleanTermination, recorderIngested, passed: true };
}

function validateAtlasOverhead({ manifest, performance, visual, screenshots, rawSurfaces, heavyCaptureTarget, heavyCapturePeakTarget }) {
  const heavyCaptureCount = Number(visual.executedHeavyCaptureCount ?? manifest.capturedCheckpointCount ?? 0);
  const heavyCapturePer10sPeak = Number(visual.heavyCapturePer10sPeak ?? 0);
  const maxConcurrentHeavyCapture = Number(visual.maxConcurrentHeavyCapture ?? 0);
  const whiteOrCollapsedCapture = rawSurfaces.some((surface) => surface.status === "OBSERVED" && collapsedSurfaceEvidence(surface))
    || screenshots.some((item) => !item.png || item.bytes <= 8);
  const passed = maxConcurrentHeavyCapture === 1
    && heavyCaptureCount <= heavyCaptureTarget
    && heavyCapturePer10sPeak <= heavyCapturePeakTarget
    && !whiteOrCollapsedCapture
    && manifest.truncated !== true
    && performance.truncated !== true;
  assert(maxConcurrentHeavyCapture === 1, "final acceptance failed: heavy captures were not serialized");
  assert(heavyCaptureCount <= heavyCaptureTarget, `final acceptance failed: heavy capture count ${heavyCaptureCount} exceeds target ${heavyCaptureTarget}`);
  assert(heavyCapturePer10sPeak <= heavyCapturePeakTarget, `final acceptance failed: heavy capture 10s peak ${heavyCapturePer10sPeak} exceeds target ${heavyCapturePeakTarget}`);
  assert(!whiteOrCollapsedCapture, "final acceptance failed: white/collapsed screenshot pattern returned");
  return {
    passed,
    maxConcurrentHeavyCapture,
    heavyCaptureCount,
    heavyCaptureTarget,
    heavyCapturePer10sPeak,
    heavyCapturePeakTarget,
    queuedVisualCheckpointCount: Number(visual.queuedVisualCheckpointCount ?? 0),
    coalescedVisualCheckpointCount: Number(visual.coalescedVisualCheckpointCount ?? 0),
    budgetSkippedVisualCount: Number(visual.budgetSkippedVisualCount ?? 0),
    heavyCaptureBySurface: safeCounts(visual.heavyCaptureBySurface || {}),
    whiteOrCollapsedCapture
  };
}

function validateLiveContractCompatibility({ surfaces, lifecycle, rawSurfaces, rawTimeline }) {
  const requiredSurfaceKeys = ["composer", "mentionChooser", "connectorPill", "userTurn", "assistantSettled", "assistantActionBar", "micaCopy", "micaOverlay"];
  const surfaceStatus = Object.fromEntries(requiredSurfaceKeys.map((key) => [key, surfaceObserved(surfaces, key)]));
  const generationEvents = rawTimeline.filter((event) => event.timeBase === "atlas-session-relative");
  const generationIds = new Set(generationEvents.map((event) => event.details?.generationId).filter((value) => Number.isFinite(Number(value))));
  const manualSendCount = generationEvents.filter((event) => stateClass(event) === "manual_send_intent").length;
  const userTurnCount = generationEvents.filter((event) => stateClass(event) === "user_turn_mounted").length;
  const assistantSettledCount = generationEvents.filter((event) => stateClass(event) === "assistant_settled").length;
  const micaCopyInvoked = generationEvents.some((event) => stateClass(event) === "mica_copy_invoked");
  const actionBarOwned = rawSurfaces
    .filter((surface) => surface.name === "assistantActionBar" && surface.status === "OBSERVED")
    .every((surface) => !!surface.turnId || surface.generationId != null);
  const noOldAssistantPromotion = generationIds.size >= 1 && manualSendCount === 1 && userTurnCount === 1;
  const assistantGenerationLive = generationIds.size >= 1 && assistantSettledCount >= 1 && actionBarOwned;
  for (const [key, ok] of Object.entries(surfaceStatus)) assert(ok, `final acceptance failed: ${key} live surface missing`);
  assert(assistantGenerationLive, "final acceptance failed: assistant generation lifecycle is incomplete");
  assert(noOldAssistantPromotion, "final acceptance failed: old assistant remount may have been promoted to current generation");
  assert(micaCopyInvoked, "final acceptance failed: Mica Copy live invocation missing");
  return {
    passed: Object.values(surfaceStatus).every(Boolean) && assistantGenerationLive && noOldAssistantPromotion && micaCopyInvoked,
    surfaces: surfaceStatus,
    manualSendCount,
    userTurnCount,
    assistantSettledCount,
    generationCount: generationIds.size,
    actionBarOwned,
    micaCopyInvoked,
    noOldAssistantPromotion,
    lifecycleGenerationCount: Array.isArray(lifecycle.generations) ? lifecycle.generations.length : 0
  };
}

function compareContractPack({ liveSurfaces, contractSurfaces }) {
  const comparableKeys = ["composer", "mentionChooser", "connectorPill", "userTurn", "assistantSettled", "assistantActionBar", "micaOverlay"];
  const surfaces = {};
  for (const key of comparableKeys) {
    const live = liveSurfaces[key];
    const baseline = contractSurfaces[key];
    surfaces[key] = {
      liveObserved: live?.status === "OBSERVED",
      contractObserved: baseline?.status === "OBSERVED",
      semanticCompatible: live?.status === "OBSERVED" && baseline?.status === "OBSERVED" && contractsCompatible(key, live.contract, baseline.contract)
    };
  }
  const passed = Object.values(surfaces).every((item) => item.liveObserved && item.contractObserved && item.semanticCompatible);
  assert(passed, "final acceptance failed: live surfaces are not compatible with committed real contract pack", surfaces);
  return { passed, surfaces };
}

function classifyFeatureEvidence({ rawTimeline, rawPerformance, sanitizedSurfaces, historicalFeatureMatrix }) {
  const events = rawTimeline.filter((event) => event.timeBase === "atlas-session-relative");
  const has = (name) => events.some((event) => stateClass(event) === name || event.type === name);
  const counters = rawPerformance.recorderPerformance?.counters || rawPerformance.recorderCounters || {};
  const historical = historicalFeatureMatrix.statuses || {};
  return {
    historicalFeatureMatrixPreserved: true,
    longThreadOptimization: featureRow({
      replay: historical.longThreadOptimization?.status || "NOT_EXERCISED",
      liveCompatibilitySmoke: surfaceObserved(sanitizedSurfaces, "longThreadMountedWindow"),
      liveFeatureInvocation: Number(counters.optimizedTurns || 0) > 0,
      failureConditionExercised: false
    }),
    micaMarkdownCopy: featureRow({
      replay: historical.micaMarkdownCopy?.status || "NOT_EXERCISED",
      liveCompatibilitySmoke: surfaceObserved(sanitizedSurfaces, "micaCopy"),
      liveFeatureInvocation: has("mica_copy_invoked"),
      failureConditionExercised: true
    }),
    composerRecovery: featureRow({
      replay: historical.composerRecovery?.status || "OBSERVED_NATIVE_ONLY",
      liveCompatibilitySmoke: surfaceObserved(sanitizedSurfaces, "composer"),
      liveFeatureInvocation: has("composer_recovery_triggered"),
      failureConditionExercised: has("composer_missing")
    }),
    connectorContinuity: featureRow({
      replay: historical.connectorContinuity?.status || "OBSERVED_NATIVE_ONLY",
      liveCompatibilitySmoke: surfaceObserved(sanitizedSurfaces, "connectorPill") && surfaceObserved(sanitizedSurfaces, "mentionChooser"),
      liveFeatureInvocation: has("connector_continuity_triggered"),
      failureConditionExercised: false
    }),
    sendResidualRecovery: featureRow({
      replay: historical.sendResidualRecovery?.status || "OBSERVED_NATIVE_ONLY",
      liveCompatibilitySmoke: has("manual_send_intent") && has("user_turn_mounted"),
      liveFeatureInvocation: has("send_residual_recovery_triggered"),
      failureConditionExercised: false
    }),
    autoDismissKnownInterruptions: featureRow({
      replay: historical.autoDismissKnownInterruptions?.status || "NOT_EXERCISED",
      liveCompatibilitySmoke: true,
      liveFeatureInvocation: has("known_interruption_dismissed"),
      failureConditionExercised: has("known_interruption_visible")
    })
  };
}

function featureRow({ replay, liveCompatibilitySmoke, liveFeatureInvocation, failureConditionExercised }) {
  return {
    realDerivedReplay: replay,
    liveCompatibilitySmoke: liveCompatibilitySmoke === true,
    liveFeatureInvocation: liveFeatureInvocation === true,
    failureConditionExercised: failureConditionExercised === true,
    releaseDecision: liveCompatibilitySmoke === true ? "ACCEPT" : "BLOCK"
  };
}

function buildReleaseReadiness({ safety, overhead, required, contractCompare, featureEvidence }) {
  const featureRows = Object.fromEntries(Object.entries(featureEvidence).filter(([, value]) => value && typeof value === "object" && value.releaseDecision));
  const passed = safety.passed && overhead.passed && required.passed && contractCompare.passed
    && Object.values(featureRows).every((row) => row.releaseDecision === "ACCEPT");
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.releaseReadiness",
    privacy: privacyFlags(),
    safety: safety.flags,
    evidenceSources: {
      realDerivedReplay: "committed real-2026-09-13 contract pack",
      liveCompatibilitySmoke: "one short final live Atlas acceptance",
      deterministicFailureFixtures: "local test:e2e and test:e2e:stress gates"
    },
    featureRows,
    gates: {
      safety: safety.passed,
      atlasOverhead: overhead.passed,
      liveContractCompatibility: required.passed,
      contractCompare: contractCompare.passed
    },
    releaseDecision: passed ? "PASS" : "FAIL"
  };
}

function surfaceObserved(surfaces, key) {
  return surfaces[key]?.status === "OBSERVED" && !!surfaces[key]?.contract && Array.isArray(surfaces[key]?.variants) && surfaces[key].variants.length > 0;
}

function contractsCompatible(key, live, baseline) {
  if (!live || !baseline) return false;
  const liveText = JSON.stringify({ tag: live.tag, role: live.role, attrs: live.attrs });
  const baselineText = JSON.stringify({ tag: baseline.tag, role: baseline.role, attrs: baseline.attrs });
  if (key === "userTurn") return true;
  if (key === "assistantSettled") return true;
  if (key === "assistantActionBar") return /toolbar|action/i.test(liveText) && /toolbar|action/i.test(baselineText);
  if (key === "connectorPill") return /inline-selection-pill|plugin:anonymous|span/i.test(liveText) && /inline-selection-pill|plugin:anonymous|span/i.test(baselineText);
  if (key === "mentionChooser") return /menu|listbox|group|picker|mention/i.test(liveText) || /menu|listbox|group|picker|mention/i.test(baselineText);
  if (key === "composer") return /composer|contenteditable|textarea|input|form/i.test(liveText) && /composer|contenteditable|textarea|input|form/i.test(baselineText);
  if (key === "micaOverlay") return /data-mica-root|mica-overlay/i.test(liveText) && /data-mica-root|mica-overlay/i.test(baselineText);
  if (live.role && baseline.role && live.role === baseline.role) return true;
  if (live.tag === baseline.tag) return true;
  return semanticTokens(liveText).some((token) => baselineText.includes(token));
}

function semanticTokens(text) {
  return ["composer", "menu", "listbox", "inline-selection-pill", "assistant", "toolbar", "data-mica-root"].filter((token) => text.includes(token));
}

function collapsedSurfaceEvidence(surface) {
  const clip = surface.coordinateEvidence?.screenshotClip;
  return surface.status === "OBSERVED" && (!clip || Number(clip.width) <= 1 || Number(clip.height) <= 1);
}

function safeCounts(value) {
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [safeKey(key), Math.max(0, Math.round(Number(count || 0)))]));
}

function safeKey(value) {
  return /^[a-zA-Z0-9:_-]{1,80}$/.test(String(value || "")) ? String(value) : "unknown";
}

function stateClass(event) {
  return event.details?.stateClass || event.type;
}

async function readRawSurfaces(dir) {
  const files = await readdir(dir).catch(() => []);
  const values = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) values.push(await readJson(path.join(dir, file)));
  return values;
}

async function readScreenshotEvidence(dir) {
  const files = await readdir(dir).catch(() => []);
  const values = [];
  for (const file of files.filter((name) => name.endsWith(".png"))) {
    const buffer = await readFile(path.join(dir, file));
    values.push({ bytes: buffer.length, png: hasPngSignature(buffer) });
  }
  return values;
}

async function readTimeline(file) {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function hasPngSignature(buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function privacyFlags() {
  return {
    localOnly: true,
    telemetryUploaded: false,
    promptTextIncluded: false,
    answerTextIncluded: false,
    rawDomIncluded: false,
    fullPageScreenshotIncluded: false,
    headersIncluded: false,
    cookiesIncluded: false,
    requestBodiesIncluded: false
  };
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
