import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { surfaceKeys } from "./live-atlas-common.mjs";

export const READ_ONLY_CDP_COMMANDS = new Set([
  "Runtime.enable",
  "Log.enable",
  "Target.getTargets",
  "Target.attachToTarget",
  "DOMSnapshot.captureSnapshot",
  "Page.getLayoutMetrics",
  "Page.captureScreenshot",
  "Performance.getMetrics"
]);

export const FORBIDDEN_CDP_PREFIXES = ["Input.", "Network.", "Tracing.", "Fetch."];
export const FORBIDDEN_CDP_COMMANDS = new Set([
  "Page.navigate",
  "Page.reload",
  "Runtime.evaluate",
  "Network.enable",
  "Network.setRequestInterception",
  "Fetch.enable",
  "Tracing.start"
]);

export const STYLE_WHITELIST = [
  "display",
  "position",
  "border-radius",
  "box-shadow",
  "background-color",
  "color",
  "font-size",
  "line-height",
  "opacity",
  "transform"
];

export const CHECKPOINT_PREFIX = "MICA_ATLAS_CHECKPOINT ";
export const REPORT_PREFIX = "MICA_ATLAS_REPORT_CHUNK ";
export const DEFAULT_INACTIVITY_HARD_CAP_MS = 15 * 60 * 1000;
export const DEFAULT_DRAIN_MS = 750;
export const DEFAULT_MAX_CHECKPOINTS = 500;
export const DEFAULT_MAX_VISUAL_QUEUE = 80;
export const DEFAULT_VISUAL_COALESCE_MS = 80;
export const DEFAULT_VISUAL_RECAPTURE_COOLDOWN_MS = 400;
export const DEFAULT_TOTAL_HEAVY_CAPTURE_BUDGET = 30;
export const DEFAULT_NORMAL_HEAVY_CAPTURE_BUDGET = 22;
export const DEFAULT_HEAVY_CAPTURE_PER_10S_BUDGET = 8;
export const CONNECTOR_BURST_WINDOW_MS = 10_000;

export function assertReadOnlyCommand(command) {
  if (FORBIDDEN_CDP_COMMANDS.has(command) || FORBIDDEN_CDP_PREFIXES.some((prefix) => command.startsWith(prefix))) {
    throw new Error(`Forbidden CDP command: ${command}`);
  }
  if (!READ_ONLY_CDP_COMMANDS.has(command)) throw new Error(`CDP command is not allowlisted: ${command}`);
}

export function validateAtlasThreadUrl(threadUrl) {
  let parsed;
  try {
    parsed = new URL(threadUrl);
  } catch (_error) {
    throw new Error("Atlas thread URL must be a valid https://chatgpt.com conversation URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") {
    throw new Error("Atlas thread URL must use https://chatgpt.com");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const conversationIndex = segments.indexOf("c");
  const conversationId = conversationIndex >= 0 ? segments[conversationIndex + 1] : "";
  if (!conversationId || !/^[A-Za-z0-9_-]{1,160}$/.test(conversationId)) {
    throw new Error("Atlas thread URL must contain a /c/<conversation-id> path segment");
  }
  return {
    href: threadUrl,
    conversationId,
    exactTargetUrl: threadUrl
  };
}

export async function resolveExactTarget({ port, threadUrl, fetchImpl = fetch }) {
  validateAtlasThreadUrl(threadUrl);
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, fetchImpl);
  const matches = targets.filter((target) => target.type === "page" && target.url === threadUrl);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one dedicated ChatGPT capture tab for ${threadUrl}; found ${matches.length}`);
  }
  const target = matches[0];
  if (!target.webSocketDebuggerUrl) throw new Error("Resolved target does not expose webSocketDebuggerUrl");
  return target;
}

export function defaultEdgeUserDataDir(env = process.env) {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Microsoft", "Edge", "User Data") : null;
}

export async function readDevToolsActivePort(userDataDir, readFileImpl = readFile) {
  if (!userDataDir) throw new Error("DevToolsActivePort discovery requires --user-data-dir");
  const file = path.join(userDataDir, "DevToolsActivePort");
  const text = await readFileImpl(file, "utf8");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const port = Number(lines[0]);
  const browserPath = lines[1] || "";
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid DevToolsActivePort port in ${file}`);
  }
  if (!browserPath.startsWith("/devtools/browser/")) {
    throw new Error(`Invalid DevToolsActivePort browser WebSocket path in ${file}`);
  }
  return {
    file,
    port,
    browserPath,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}${browserPath}`
  };
}

export async function resolveCaptureEndpoint({ port, threadUrl, userDataDir = null, fetchImpl = fetch, readFileImpl = readFile }) {
  validateAtlasThreadUrl(threadUrl);
  const attempts = [];
  const tryDevToolsFile = async (dir, source) => {
    if (!dir) return null;
    try {
      const entry = await readDevToolsActivePort(dir, readFileImpl);
      attempts.push({ mode: "devtools-active-port", source, ok: true });
      return { mode: "browser", source, userDataDir: dir, webSocketDebuggerUrl: entry.webSocketDebuggerUrl, port: entry.port, attempts };
    } catch (error) {
      attempts.push({ mode: "devtools-active-port", source, ok: false, error: error.message });
      return null;
    }
  };

  if (userDataDir) {
    const endpoint = await tryDevToolsFile(userDataDir, "explicit-user-data-dir");
    if (endpoint) return endpoint;
  }

  try {
    const target = await resolveExactTarget({ port, threadUrl, fetchImpl });
    attempts.push({ mode: "http-json-list", port, ok: true });
    return { mode: "direct-page", target, webSocketDebuggerUrl: target.webSocketDebuggerUrl, port, attempts };
  } catch (error) {
    attempts.push({ mode: "http-json-list", port, ok: false, error: error.message });
  }

  const defaultDir = defaultEdgeUserDataDir();
  if (defaultDir && defaultDir !== userDataDir) {
    const endpoint = await tryDevToolsFile(defaultDir, "default-edge-user-data-dir");
    if (endpoint) return endpoint;
  }

  const detail = attempts.map((attempt) => `${attempt.mode}${attempt.source ? `:${attempt.source}` : ""}${attempt.port ? `:${attempt.port}` : ""}=${attempt.ok ? "ok" : attempt.error}`).join("; ");
  throw new Error(`Unable to resolve Atlas CDP target for exact thread URL. Attempts: ${detail}`);
}

export async function attachBrowserPageTarget(client, threadUrl) {
  validateAtlasThreadUrl(threadUrl);
  const targetResult = await client.send("Target.getTargets", {}, { rootSession: true });
  const targetInfos = Array.isArray(targetResult.targetInfos) ? targetResult.targetInfos : [];
  const matches = targetInfos.filter((target) => target.type === "page" && target.url === threadUrl);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one browser target for ${threadUrl}; found ${matches.length}`);
  }
  const target = matches[0];
  if (!target.targetId) throw new Error("Browser target discovery returned a page without targetId");
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, { rootSession: true });
  if (!attached.sessionId) throw new Error("Target.attachToTarget did not return a flattened sessionId");
  client.setPageSessionId?.(attached.sessionId);
  return {
    target: {
      type: target.type,
      url: target.url,
      title: target.title || "",
      targetId: target.targetId,
      attachedVia: "browser-websocket"
    },
    sessionId: attached.sessionId
  };
}

export async function runReadOnlyCaptureSession(options) {
  const {
    port,
    threadUrl,
    out,
    userDataDir = null,
    maxCheckpoints = DEFAULT_MAX_CHECKPOINTS,
    maxVisualQueue = DEFAULT_MAX_VISUAL_QUEUE,
    visualCoalesceMs = DEFAULT_VISUAL_COALESCE_MS,
    visualRecaptureCooldownMs = DEFAULT_VISUAL_RECAPTURE_COOLDOWN_MS,
    totalHeavyCaptureBudget = DEFAULT_TOTAL_HEAVY_CAPTURE_BUDGET,
    normalHeavyCaptureBudget = DEFAULT_NORMAL_HEAVY_CAPTURE_BUDGET,
    heavyCapturePer10sBudget = DEFAULT_HEAVY_CAPTURE_PER_10S_BUDGET,
    idleMs = DEFAULT_INACTIVITY_HARD_CAP_MS,
    drainMs = DEFAULT_DRAIN_MS,
    abortSignal = null,
    fetchImpl = fetch,
    readFileImpl = readFile,
    connect = connectWebSocket,
    onAttached = null
  } = options;
  const endpoint = await resolveCaptureEndpoint({ port, threadUrl, userDataDir, fetchImpl, readFileImpl });
  const client = await connect(endpoint.webSocketDebuggerUrl);
  let target = endpoint.target || null;
  let pageSessionId = null;
  if (endpoint.mode === "browser") {
    const attachedTarget = await attachBrowserPageTarget(client, threadUrl);
    target = attachedTarget.target;
    pageSessionId = attachedTarget.sessionId;
  }
  const timeline = [];
  const surfaces = [];
  const recorderReports = [];
  const screenshotsDir = path.join(out, "screenshots");
  const surfacesDir = path.join(out, "surfaces");
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(surfacesDir, { recursive: true });

  let attached = false;
  let checkpointCount = 0;
  let capturedCheckpointCount = 0;
  let stopped = false;
  let terminationReason = null;
  let truncation = null;
  let inactivityTimer = null;
  let drainTimer = null;
  let finishSession = null;
  const reportChunks = new Map();
  const visualQueue = new Map();
  const pendingSemanticKeys = new Set();
  const capturedSemanticKeys = new Set();
  const lastCapturedAtByKey = new Map();
  const inFlightVisualKeys = new Set();
  const heavyCaptureTimestamps = [];
  let visualWorkerTimer = null;
  let visualWorkerPromise = null;
  let activeHeavyCaptures = 0;
  const visualCapture = {
    maxConcurrentHeavyCapture: 0,
    receivedVisualCheckpointCount: 0,
    queuedVisualCheckpointCount: 0,
    executedHeavyCaptureCount: 0,
    coalescedVisualCheckpointCount: 0,
    skippedVisualCheckpointCount: 0,
    maxVisualQueueDepth: 0,
    maxVisualQueue,
    visualCoalesceMs,
    visualRecaptureCooldownMs,
    totalHeavyCaptureBudget,
    normalHeavyCaptureBudget,
    heavyCapturePer10sBudget,
    heavyCaptureCount: 0,
    heavyCaptureBySurface: {},
    heavyCaptureByGeneration: {},
    heavyCapturePer10sPeak: 0,
    budgetSkippedVisualCount: 0,
    normalCaptureCount: 0,
    priorityCaptureCount: 0
  };
  const sessionDone = new Promise((resolve) => {
    finishSession = resolve;
  });

  const clearInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = null;
  };
  const armInactivityTimer = () => {
    clearInactivityTimer();
    if (!Number.isFinite(idleMs) || idleMs <= 0) return;
    inactivityTimer = setTimeout(() => requestFinish("inactivity_hard_cap"), idleMs);
  };
  const requestFinish = (reason) => {
    if (terminationReason) return;
    terminationReason = reason;
    clearInactivityTimer();
    if (reason === "atlas_stopped" || reason === "operator_stop") {
      drainTimer = setTimeout(() => finishSession(), Math.max(0, drainMs));
      return;
    }
    finishSession();
  };
  const onAbort = () => requestFinish("operator_stop");
  if (abortSignal) {
    if (abortSignal.aborted) requestFinish("operator_stop");
    else abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  let messageListenerActive = false;
  client.onMessage((message) => {
    if (stopped) return;
    const checkpoint = parseCheckpointMessage(message);
    if (!checkpoint) return;
    try {
      handleCheckpoint(checkpoint);
    } catch (error) {
      timeline.push(cdpLifecycleEvent("cdp_capture_error", {
        checkpointId: checkpoint.checkpointId || null,
        stateClass: checkpoint.stateClass || null,
        message: error.message
      }));
      requestFinish("capture_error");
    }
  });
  messageListenerActive = true;

  await client.send("Runtime.enable");
  await client.send("Log.enable");
  attached = true;
  if (typeof onAttached === "function") {
    onAttached({ attached: true, target, endpointMode: endpoint.mode, pageSessionId, messageListenerActive, runtimeEnabled: true, logEnabled: true });
  }
  await client.send("Performance.getMetrics");
  armInactivityTimer();
  await sessionDone;
  if (drainTimer) clearTimeout(drainTimer);
  await flushVisualQueue();
  stopped = true;
  if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
  clearInactivityTimer();
  await client.close();
  return {
    attached,
    target,
    endpointMode: endpoint.mode,
    pageSessionId,
    discoveryAttempts: endpoint.attempts || [],
    timeline,
    surfaces: surfaces.slice(),
    recorderReports,
    checkpointCount,
    capturedCheckpointCount,
    commandsSent: client.commandsSent,
    terminationReason: terminationReason || "unknown",
    explicitStop: terminationReason === "atlas_stopped",
    drainMs,
    inactivityHardCapMs: idleMs,
    maxCheckpoints,
    visualCapture,
    maxConcurrentHeavyCapture: visualCapture.maxConcurrentHeavyCapture,
    queuedVisualCheckpointCount: visualCapture.queuedVisualCheckpointCount,
    executedHeavyCaptureCount: visualCapture.executedHeavyCaptureCount,
    coalescedVisualCheckpointCount: visualCapture.coalescedVisualCheckpointCount,
    truncated: !!truncation,
    truncation
  };

  function handleCheckpoint(checkpoint) {
    if (isRecorderReportCheckpoint(checkpoint)) {
      armInactivityTimer();
      const report = checkpoint.report || assembleRecorderReportChunk(checkpoint, reportChunks);
      if (report) {
        recorderReports.push(report);
        timeline.push(cdpLifecycleEvent("cdp_recorder_report_ingested", {
          sessionId: safeFilePart(report.session?.id || "unknown"),
          eventCount: Array.isArray(report.timeline) ? report.timeline.length : 0,
          performanceCaptured: !!report.performance
        }));
      }
      return;
    }
    checkpointCount += 1;
    armInactivityTimer();
    const terminal = isTerminalCheckpoint(checkpoint);
    if (checkpointCount > maxCheckpoints) {
      if (!truncation) {
        truncation = {
          reason: "checkpoint_capacity_exceeded",
          maxCheckpoints,
          firstDroppedCheckpointId: checkpoint.checkpointId || null,
          firstDroppedStateClass: checkpoint.stateClass || null
        };
        timeline.push(cdpLifecycleEvent("cdp_checkpoint_truncation", truncation));
        requestFinish("checkpoint_capacity_exceeded");
      }
      if (terminal) requestFinish("atlas_stopped");
      return;
    }
    timeline.push({
      schemaVersion: 1,
      type: "cdp_checkpoint_observed",
      timeBase: "cdp-page-monotonic",
      relativeTimeMs: null,
      details: safeCheckpointTimelineDetails(checkpoint)
    });
    if (!isVisualCheckpoint(checkpoint)) {
      if (terminal) requestFinish("atlas_stopped");
      return;
    }
    enqueueVisualCheckpoint(checkpoint);
    if (terminal) requestFinish("atlas_stopped");
  }

  function enqueueVisualCheckpoint(checkpoint) {
    const surfaceKey = surfaceKeyForCheckpoint(checkpoint.stateClass);
    if (!surfaceKey) return;
    visualCapture.receivedVisualCheckpointCount += 1;
    const decision = visualCaptureDecision(checkpoint, surfaceKey);
    if (!decision.capture) {
      visualCapture.skippedVisualCheckpointCount += 1;
      visualCapture.coalescedVisualCheckpointCount += 1;
      if (decision.reason === "budget") visualCapture.budgetSkippedVisualCount += 1;
      timeline.push(cdpLifecycleEvent("cdp_visual_checkpoint_coalesced", {
        checkpointId: checkpoint.checkpointId || null,
        stateClass: checkpoint.stateClass || null,
        surfaceKey,
        key: decision.key || null,
        semanticKey: decision.semanticKey || null,
        priority: decision.priority || null,
        reason: decision.reason
      }));
      return;
    }
    if (visualQueue.has(decision.semanticKey)) {
      visualQueue.set(decision.semanticKey, { checkpoint, surfaceKey, ...decision });
      visualCapture.coalescedVisualCheckpointCount += 1;
      timeline.push(cdpLifecycleEvent("cdp_visual_checkpoint_coalesced", {
        checkpointId: checkpoint.checkpointId || null,
        stateClass: checkpoint.stateClass || null,
        surfaceKey,
        key: decision.key,
        semanticKey: decision.semanticKey,
        priority: decision.priority,
        reason: "pending_replaced"
      }));
      return;
    }
    if (visualCapture.executedHeavyCaptureCount + visualQueue.size >= totalHeavyCaptureBudget && decision.priority === "HIGH") {
      evictQueuedNormalForHighPriority(decision);
    }
    if (visualQueue.size >= maxVisualQueue && !evictQueuedNormalForHighPriority(decision)) {
      if (!truncation) {
        truncation = {
          reason: "visual_queue_capacity_exceeded",
          maxVisualQueue,
          firstDroppedCheckpointId: checkpoint.checkpointId || null,
          firstDroppedStateClass: checkpoint.stateClass || null
        };
        timeline.push(cdpLifecycleEvent("cdp_visual_queue_truncation", truncation));
        requestFinish("visual_queue_capacity_exceeded");
      }
      return;
    }
    visualQueue.set(decision.semanticKey, { checkpoint, surfaceKey, ...decision });
    pendingSemanticKeys.add(decision.semanticKey);
    visualCapture.queuedVisualCheckpointCount += 1;
    visualCapture.maxVisualQueueDepth = Math.max(visualCapture.maxVisualQueueDepth, visualQueue.size);
    scheduleVisualWorker();
  }

  function visualCaptureDecision(checkpoint, surfaceKey) {
    const key = visualCoalesceKey(checkpoint, surfaceKey);
    const priority = visualPriorityFor(surfaceKey, checkpoint);
    const semanticKey = semanticVisualKey(checkpoint, surfaceKey, {
      composerBaselineAlreadyRepresented: capturedSemanticKeys.has("composer:baseline")
    });
    if (!semanticKey) return { capture: false, surfaceKey, key, semanticKey: null, priority, reason: "timing_only" };
    if (capturedSemanticKeys.has(semanticKey)) return { capture: false, surfaceKey, key, semanticKey, priority, reason: "semantic_episode_seen" };
    if (pendingSemanticKeys.has(semanticKey)) return { capture: false, surfaceKey, key, semanticKey, priority, reason: "pending_semantic_duplicate" };
    if (inFlightVisualKeys.has(semanticKey)) return { capture: false, surfaceKey, key, semanticKey, priority, reason: "in_flight_duplicate" };
    if (isWithinRecaptureCooldown(semanticKey)) return { capture: false, surfaceKey, key, semanticKey, priority, reason: "recapture_cooldown" };
    if ((surfaceKey === "assistantActionBar" || surfaceKey === "nativeCopyArea") && checkpoint.generationId == null) {
      return { capture: false, surfaceKey, key, semanticKey, priority, reason: "baseline_owned_surface" };
    }
    if (isTurnBoundSurface(surfaceKey) && checkpoint.generationId == null) {
      return { capture: false, surfaceKey, key, semanticKey, priority, reason: "baseline_turn_surface" };
    }
    const projectedTotal = visualCapture.executedHeavyCaptureCount + visualQueue.size;
    const projectedNormal = visualCapture.normalCaptureCount + queuedNormalCount();
    if (priority !== "HIGH" && projectedNormal >= normalHeavyCaptureBudget && !isGenerationLifecycleSurface(surfaceKey)) {
      return { capture: false, surfaceKey, key, semanticKey, priority, reason: "budget" };
    }
    if (projectedTotal >= totalHeavyCaptureBudget && priority !== "HIGH") {
      return { capture: false, surfaceKey, key, semanticKey, priority, reason: "budget" };
    }
    if (projectedTotal >= totalHeavyCaptureBudget && priority === "HIGH" && !hasQueuedNormal()) {
      return { capture: false, surfaceKey, key, semanticKey, priority, reason: "budget" };
    }
    if (wouldExceedRollingBudget(checkpoint) && priority !== "HIGH" && !isGenerationLifecycleSurface(surfaceKey)) {
      return { capture: false, surfaceKey, key, semanticKey, priority, reason: "budget" };
    }
    return { capture: true, surfaceKey, key, semanticKey, priority, reason: "selected" };
  }

  function isWithinRecaptureCooldown(key) {
    const lastCapturedAt = lastCapturedAtByKey.get(key);
    if (!Number.isFinite(lastCapturedAt)) return false;
    return Date.now() - lastCapturedAt < visualRecaptureCooldownMs;
  }

  function evictQueuedNormalForHighPriority(decision) {
    if (decision.priority !== "HIGH") return false;
    for (const [key, item] of visualQueue.entries()) {
      if (item.priority === "HIGH") continue;
      visualQueue.delete(key);
      pendingSemanticKeys.delete(item.semanticKey);
      visualCapture.budgetSkippedVisualCount += 1;
      visualCapture.skippedVisualCheckpointCount += 1;
      timeline.push(cdpLifecycleEvent("cdp_visual_checkpoint_coalesced", {
        checkpointId: item.checkpoint?.checkpointId || null,
        stateClass: item.checkpoint?.stateClass || null,
        surfaceKey: item.surfaceKey,
        key: item.key,
        semanticKey: item.semanticKey,
        priority: item.priority,
        reason: "evicted_for_high_priority"
      }));
      return true;
    }
    return false;
  }

  function hasQueuedNormal() {
    for (const item of visualQueue.values()) {
      if (item.priority !== "HIGH") return true;
    }
    return false;
  }

  function queuedNormalCount() {
    let count = 0;
    for (const item of visualQueue.values()) {
      if (item.priority !== "HIGH") count += 1;
    }
    return count;
  }

  function wouldExceedRollingBudget(checkpoint) {
    const at = checkpointTimeForBudget(checkpoint);
    const pendingTimes = [...visualQueue.values()].map((item) => checkpointTimeForBudget(item.checkpoint));
    const windowStart = at - CONNECTOR_BURST_WINDOW_MS;
    const count = heavyCaptureTimestamps.filter((time) => time >= windowStart && time <= at).length
      + pendingTimes.filter((time) => time >= windowStart && time <= at).length;
    return count >= heavyCapturePer10sBudget;
  }

  function scheduleVisualWorker() {
    if (visualWorkerTimer || visualWorkerPromise) return;
    visualWorkerTimer = setTimeout(() => {
      visualWorkerTimer = null;
      visualWorkerPromise = runVisualWorker().finally(() => {
        visualWorkerPromise = null;
        if (visualQueue.size && !stopped) scheduleVisualWorker();
      });
    }, Math.max(0, visualCoalesceMs));
  }

  async function flushVisualQueue() {
    if (visualWorkerTimer) {
      clearTimeout(visualWorkerTimer);
      visualWorkerTimer = null;
    }
    if (visualWorkerPromise) await visualWorkerPromise;
    while (visualQueue.size) {
      visualWorkerPromise = runVisualWorker().finally(() => {
        visualWorkerPromise = null;
      });
      await visualWorkerPromise;
    }
  }

  async function runVisualWorker() {
    while (visualQueue.size) {
      const nextKey = nextVisualQueueKey();
      const item = visualQueue.get(nextKey);
      visualQueue.delete(nextKey);
      if (item?.semanticKey) pendingSemanticKeys.delete(item.semanticKey);
      if (!item || capturedSemanticKeys.has(item.semanticKey)) {
        visualCapture.skippedVisualCheckpointCount += 1;
        continue;
      }
      await executeVisualCapture(item);
    }
  }

  async function executeVisualCapture(item) {
    activeHeavyCaptures += 1;
    inFlightVisualKeys.add(item.semanticKey);
    visualCapture.maxConcurrentHeavyCapture = Math.max(visualCapture.maxConcurrentHeavyCapture, activeHeavyCaptures);
    try {
      const captured = await captureCheckpoint(client, item.checkpoint, { screenshotsDir, surfacesDir });
      visualCapture.executedHeavyCaptureCount += 1;
      recordHeavyCaptureStats(item);
      if (captured.status === "OBSERVED") {
        capturedCheckpointCount += 1;
        surfaces.push(captured.surfaceKey);
        capturedSemanticKeys.add(item.semanticKey);
        lastCapturedAtByKey.set(item.semanticKey, Date.now());
      }
      timeline.push({
        schemaVersion: 1,
        type: "cdp_checkpoint_capture",
        timeBase: "cdp-page-monotonic",
        relativeTimeMs: null,
        details: {
          checkpointId: item.checkpoint.checkpointId,
          stateClass: item.checkpoint.stateClass,
          generationId: item.checkpoint.generationId ?? null,
          turnId: captured.turnId || null,
          surfaceKey: captured.surfaceKey,
          screenshot: captured.screenshotFile ? path.basename(captured.screenshotFile) : null,
          clipped: !!captured.screenshotFile,
          status: captured.status,
          missingReason: captured.missingReason || null
        }
      });
    } catch (error) {
      timeline.push(cdpLifecycleEvent("cdp_capture_error", {
        checkpointId: item.checkpoint.checkpointId || null,
        stateClass: item.checkpoint.stateClass || null,
        message: error.message
      }));
      requestFinish("capture_error");
    } finally {
      inFlightVisualKeys.delete(item.semanticKey);
      activeHeavyCaptures -= 1;
    }
  }

  function nextVisualQueueKey() {
    let firstKey = null;
    for (const [key, item] of visualQueue.entries()) {
      if (firstKey === null) firstKey = key;
      if (item.priority === "HIGH") return key;
    }
    return firstKey;
  }

  function recordHeavyCaptureStats(item) {
    const at = checkpointTimeForBudget(item.checkpoint);
    heavyCaptureTimestamps.push(at);
    visualCapture.heavyCaptureCount = visualCapture.executedHeavyCaptureCount;
    visualCapture.heavyCaptureBySurface[item.surfaceKey] = (visualCapture.heavyCaptureBySurface[item.surfaceKey] || 0) + 1;
    const generationKey = item.checkpoint.generationId == null ? "global" : `g${item.checkpoint.generationId}`;
    visualCapture.heavyCaptureByGeneration[generationKey] = (visualCapture.heavyCaptureByGeneration[generationKey] || 0) + 1;
    const windowStart = at - CONNECTOR_BURST_WINDOW_MS;
    const rolling = heavyCaptureTimestamps.filter((time) => time >= windowStart && time <= at).length;
    visualCapture.heavyCapturePer10sPeak = Math.max(visualCapture.heavyCapturePer10sPeak, rolling);
    if (item.priority === "HIGH") visualCapture.priorityCaptureCount += 1;
    else visualCapture.normalCaptureCount += 1;
  }
}

export async function writeRawSessionBundle({ out, threadUrl, session }) {
  const coverage = Object.fromEntries(surfaceKeys.map((key) => [
    key,
    { status: session.surfaces.includes(key) ? "OBSERVED" : "MISSING", count: session.surfaces.filter((item) => item === key).length }
  ]));
  await mkdir(out, { recursive: true });
  await writeJson(path.join(out, "manifest.json"), createManifest({ threadUrl, target: session.target, commandsSent: session.commandsSent, session }));
  const recorderReports = Array.isArray(session.recorderReports) ? session.recorderReports : [];
  const recorderTimeline = recorderReports.flatMap((report) => Array.isArray(report.timeline) ? report.timeline : [])
    .map((event) => ({ ...event, timeBase: "atlas-session-relative" }));
  const cdpTimeline = session.timeline.map((event) => ({ ...event, timeBase: event.timeBase || "cdp-page-monotonic" }));
  const combinedTimeline = [...recorderTimeline, ...cdpTimeline];
  await writeFile(path.join(out, "timeline.ndjson"), `${combinedTimeline.map((event) => JSON.stringify(event)).join("\n")}\n`);
  if (recorderReports.length) await writeJson(path.join(out, "recorder-report.json"), mergeRecorderReports(recorderReports));
  await writeJson(path.join(out, "coverage.json"), coverage);
  await writeJson(path.join(out, "performance.json"), {
    schemaVersion: 1,
    source: "real-cdp-companion",
    privacy: privacyFlags(),
    safety: safetyFlags(),
    cdpMetricsCaptured: session.commandsSent.includes("Performance.getMetrics"),
    visualCapture: session.visualCapture || null,
    recorderReportsIngested: recorderReports.length,
    recorderPerformanceIngested: recorderReports.some((report) => !!report.performance),
    recorderPerformance: mergeRecorderPerformance(recorderReports),
    terminationReason: session.terminationReason,
    explicitStop: session.explicitStop,
    truncated: session.truncated
  });
  return { coverage };
}

export async function captureCheckpoint(client, checkpoint, paths) {
  const surfaceKey = surfaceKeyForCheckpoint(checkpoint.stateClass);
  const layout = await client.send("Page.getLayoutMetrics");
  const snapshot = await client.send("DOMSnapshot.captureSnapshot", { computedStyles: STYLE_WHITELIST });
  const metrics = await client.send("Performance.getMetrics");
  const match = resolveSurfaceMatch(snapshot, surfaceKey, checkpoint, { layoutMetrics: layout });
  if (!match) {
    const surface = {
      schemaVersion: 1,
      name: surfaceKey,
      status: "MISSING",
      source: "real-cdp-companion",
      checkpointId: checkpoint.checkpointId,
      stateClass: checkpoint.stateClass,
      generationId: checkpoint.generationId ?? null,
      missingReason: "surface_not_resolved",
      privacy: privacyFlags(),
      contract: null,
      performanceMetricCount: Array.isArray(metrics?.metrics) ? metrics.metrics.length : 0
    };
    const surfaceFile = path.join(paths.surfacesDir, `${surfaceKey}-${safeFilePart(checkpoint.checkpointId)}.json`);
    await writeJson(surfaceFile, surface);
    return { surfaceKey, status: "MISSING", surfaceFile, screenshotFile: null, missingReason: surface.missingReason, turnId: null };
  }
  const clip = screenshotClipForDocumentRect(match.documentRect, layout);
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", clip, fromSurface: true, captureBeyondViewport: true });
  const surface = {
    schemaVersion: 1,
    name: surfaceKey,
    status: "OBSERVED",
    source: "real-cdp-companion",
    checkpointId: checkpoint.checkpointId,
    stateClass: checkpoint.stateClass,
    generationId: checkpoint.generationId ?? null,
    turnId: match.turnId || safeCheckpointTurnId(checkpoint.turnId) || null,
    variant: variantForCheckpoint(checkpoint),
    coordinateEvidence: {
      documentRect: roundRect(match.documentRect),
      viewportRect: roundRect(match.viewportRect),
      screenshotClip: clipToRect(clip),
      screenshotClipSource: "documentRect",
      viewportOffset: roundRectOffset(viewportOffsetFor(snapshot?.documents?.[0], layout)),
      cssViewportMetricsPreferred: hasCssViewportMetrics(layout),
      cssZoom: zoomForScreenshot(layout)
    },
    privacy: privacyFlags(),
    contract: contractForSurface(snapshot, surfaceKey, match.viewportRect, match.nodeIndex),
    performanceMetricCount: Array.isArray(metrics?.metrics) ? metrics.metrics.length : 0
  };
  const surfaceFile = path.join(paths.surfacesDir, `${surfaceKey}-${safeFilePart(checkpoint.checkpointId)}.json`);
  const screenshotFile = path.join(paths.screenshotsDir, `${surfaceKey}-${safeFilePart(checkpoint.checkpointId)}.png`);
  await writeJson(surfaceFile, surface);
  await writeFile(screenshotFile, Buffer.from(String(screenshot?.data || ""), "base64"));
  return { surfaceKey, status: "OBSERVED", surfaceFile, screenshotFile, clip, turnId: surface.turnId, documentRect: match.documentRect, viewportRect: match.viewportRect };
}

export function parseCheckpointMessage(message) {
  const text = message?.params?.entry?.text
    || message?.params?.args?.map((arg) => arg.value).join(" ")
    || message?.params?.message?.text
    || "";
  if (String(text).startsWith(REPORT_PREFIX)) return parseRecorderReportMessage(String(text));
  if (!String(text).startsWith(CHECKPOINT_PREFIX)) return null;
  try {
    return JSON.parse(String(text).slice(CHECKPOINT_PREFIX.length));
  } catch (_error) {
    return null;
  }
}

function parseRecorderReportMessage(text) {
  try {
    const chunk = JSON.parse(text.slice(REPORT_PREFIX.length));
    if (chunk && typeof chunk === "object" && typeof chunk.data === "string") {
      return {
        stateClass: "recorder_report_chunk",
        checkpointId: `recorder-report:${chunk.index ?? 0}`,
        monotonicTimestamp: null,
        chunk
      };
    }
    return {
      stateClass: "recorder_report_exported",
      checkpointId: "recorder-report",
      monotonicTimestamp: null,
      report: chunk
    };
  } catch (_error) {
    return null;
  }
}

export function isTerminalCheckpoint(checkpoint) {
  return checkpoint?.stateClass === "atlas_stopped" || checkpoint?.terminal === true;
}

export function surfaceKeyForCheckpoint(stateClass) {
  if (!stateClass) return null;
  if (/^(atlas_stopped|manual_send_intent|composer_body_zero|assistant_stream_mutation_burst|recorder_report_exported|turn_identity_unresolved|baseline_existing)$/.test(stateClass)) return null;
  if (/^(atlas_started|composer_present|composer_focus|composer_blur|composer_identity_changed)$/.test(stateClass)) return "composer";
  if (stateClass === "user_turn_mounted") return "userTurn";
  if (stateClass === "mention_chooser_visible") return "mentionChooser";
  if (stateClass === "connector_pill_visible") return "connectorPill";
  if (stateClass === "rich_markdown_settled") return "richMarkdown";
  if (stateClass === "mica_copy_invoked") return "micaCopy";
  if (stateClass === "assistant_copy_action_visible_or_invoked") return "nativeCopyArea";
  if (stateClass === "assistant_action_bar_visible") return "assistantActionBar";
  if (stateClass === "assistant_settled" || stateClass === "assistant_settled_hard_cap") return "assistantSettled";
  if (stateClass === "assistant_turn_mounted" || stateClass === "assistant_first_content_mutation") return "assistantStreaming";
  if (stateClass === "mica_overlay_state") return "micaOverlay";
  if (stateClass === "mounted_turn_window_changed") return "longThreadMountedWindow";
  return null;
}

export function isVisualCheckpoint(checkpoint) {
  return !!surfaceKeyForCheckpoint(checkpoint.stateClass);
}

export function resolveSurfaceMatch(snapshot, surfaceKey, checkpoint = {}, options = {}) {
  const doc = snapshot?.documents?.[0];
  const layout = doc?.layout;
  const nodes = doc?.nodes;
  assertOfficialSnapshotStrings(snapshot);
  if (!layout || !nodes || !surfaceKey) return null;
  const targetRect = normalizeTargetRect(checkpoint.targetRect || checkpoint.rect);
  const expectedTurnId = safeCheckpointTurnId(checkpoint.turnId);
  const turnBound = isTurnBoundSurface(surfaceKey);
  const ownerTurnBound = isAssistantOwnedSurface(surfaceKey);
  const viewportOffset = viewportOffsetFor(doc, options.layoutMetrics);
  const candidates = [];
  const layoutNodeIndexes = layout.nodeIndex || [];
  const bounds = layout.bounds || [];
  for (let index = 0; index < layoutNodeIndexes.length; index += 1) {
    const nodeIndex = layoutNodeIndexes[index];
    if (!nodeMatchesSurface(snapshot, doc, nodeIndex, surfaceKey, checkpoint)) continue;
    const documentRect = rectFromBounds(bounds[index]);
    if (!documentRect) continue;
    const viewportRect = documentRectToViewportRect(documentRect, viewportOffset);
    const identity = surfaceTurnIdentity(snapshot, doc, nodeIndex, surfaceKey, checkpoint);
    if ((turnBound || ownerTurnBound) && expectedTurnId && identity.turnId !== expectedTurnId) continue;
    candidates.push({
      nodeIndex,
      rect: viewportRect,
      viewportRect,
      documentRect,
      turnId: identity.turnId || null,
      owningTurnNodeIndex: identity.owningTurnNodeIndex ?? null,
      score: targetRect ? rectDistance(viewportRect, targetRect) : index
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] || null;
}

export function rectForSurface(snapshot, surfaceKey, checkpoint = {}) {
  return resolveSurfaceMatch(snapshot, surfaceKey, checkpoint)?.rect || null;
}

export function contractForSurface(snapshot, surfaceKey, clip, nodeIndex = null) {
  const doc = snapshot?.documents?.[0];
  assertOfficialSnapshotStrings(snapshot);
  if (!doc || nodeIndex === null) return null;
  return sanitizeNodeContract(snapshot, doc, nodeIndex, clip, 0);
}

export function sanitizeNodeContract(snapshot, doc, nodeIndex, clip, depth) {
  const nodes = doc.nodes || {};
  const strings = snapshotStrings(snapshot);
  const tag = stringAt(strings, nodes.nodeName?.[nodeIndex] || "").toLowerCase() || "div";
  const attrs = sanitizedAttributes(snapshot, doc, nodeIndex);
  const role = attrs.role || null;
  const children = depth >= 3 ? [] : childIndexesOf(doc, nodeIndex).slice(0, 12).map((child) => sanitizeNodeContract(snapshot, doc, child, null, depth + 1));
  return {
    tag: normalizeTag(tag),
    role,
    attrs,
    rect: depth === 0 ? clipToRect(clip) : null,
    state: controlState(attrs),
    text: textContract(snapshot, doc, nodeIndex),
    styles: sanitizedStyles(snapshot, doc, nodeIndex),
    children
  };
}

export function createManifest({ threadUrl, target, commandsSent, session = null }) {
  const validation = validateAtlasThreadUrl(threadUrl);
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.raw",
    sessionId: `atlas-cdp-${Date.now()}`,
    createdAt: new Date().toISOString(),
    source: "real-cdp-companion",
    attached: session?.attached === true,
    threadUrlAllowed: true,
    targetUrlExactMatch: target?.url === validation.exactTargetUrl,
    conversationIdLength: validation.conversationId.length,
    targetTitleLength: String(target?.title || "").length,
    styleWhitelist: STYLE_WHITELIST,
    readOnlyCommands: [...READ_ONLY_CDP_COMMANDS],
    commandsSent,
    terminationReason: session?.terminationReason || null,
    explicitStop: session?.explicitStop || false,
    checkpointCount: session?.checkpointCount ?? null,
    capturedCheckpointCount: session?.capturedCheckpointCount ?? null,
    visualCapture: session?.visualCapture || null,
    recorderReportsIngested: session?.recorderReports?.length || 0,
    maxCheckpoints: session?.maxCheckpoints ?? null,
    inactivityHardCapMs: session?.inactivityHardCapMs ?? null,
    drainMs: session?.drainMs ?? null,
    truncated: session?.truncated || false,
    truncation: session?.truncation || null,
    privacy: privacyFlags(),
    safety: safetyFlags()
  };
}

function cdpLifecycleEvent(type, details) {
  return {
    schemaVersion: 1,
    type,
    timeBase: "agent-local",
    relativeTimeMs: null,
    details
  };
}

export function privacyFlags() {
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

export function safetyFlags() {
  return {
    automatedSend: false,
    automatedEnter: false,
    automatedUpload: false,
    automatedConnectorAction: false,
    playwrightRealSiteTraceUsed: false,
    computerUseRequired: false,
    cdpConnection: true
  };
}

export async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Failed to query CDP endpoint ${url}: ${response.status}`);
  return response.json();
}

export async function connectWebSocket(url) {
  const socket = await openWebSocket(url);
  let nextId = 1;
  let pageSessionId = null;
  const pending = new Map();
  const listeners = new Set();
  const commandsSent = [];
  socket.onFrame = (payload) => {
    const message = JSON.parse(payload);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || "CDP command failed"));
      else resolve(message.result || {});
      return;
    }
    if (pageSessionId) {
      if (message.sessionId !== pageSessionId) return;
    }
    for (const listener of listeners) listener(message);
  };
  return {
    commandsSent,
    setPageSessionId(sessionId) {
      pageSessionId = sessionId || null;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(method, params = {}, options = {}) {
      assertReadOnlyCommand(method);
      commandsSent.push(method);
      const id = nextId++;
      const message = { id, method, params };
      if (pageSessionId && options.rootSession !== true) message.sessionId = pageSessionId;
      socket.send(JSON.stringify(message));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      return socket.close();
    }
  };
}

async function openWebSocket(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "ws:") throw new Error("Only ws:// CDP endpoints are supported");
  const key = randomBytes(16).toString("base64");
  const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port || 80) });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write([
    `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "\r\n"
  ].join("\r\n"));
  await readHandshake(socket, key);
  let buffer = Buffer.alloc(0);
  let fragmentedOpcode = null;
  const fragments = [];
  const wrapper = {
    onFrame: null,
    send(payload) {
      socket.write(encodeFrame(Buffer.from(payload)));
    },
    close() {
      if (socket.destroyed) return Promise.resolve();
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (!socket.destroyed) socket.destroy();
          resolve();
        }, 200);
        socket.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.end(encodeFrame(Buffer.alloc(0), 8));
      });
    }
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const decoded = decodeFrame(buffer);
      if (!decoded) break;
      buffer = decoded.rest;
      if (decoded.opcode === 8) continue;
      if (decoded.opcode === 9) {
        socket.write(encodeFrame(decoded.payload, 10));
        continue;
      }
      if (decoded.opcode === 1 && decoded.fin && wrapper.onFrame) {
        wrapper.onFrame(decoded.payload.toString("utf8"));
        continue;
      }
      if (decoded.opcode === 1 && !decoded.fin) {
        fragmentedOpcode = 1;
        fragments.length = 0;
        fragments.push(decoded.payload);
        continue;
      }
      if (decoded.opcode === 0 && fragmentedOpcode === 1) {
        fragments.push(decoded.payload);
        if (decoded.fin && wrapper.onFrame) {
          wrapper.onFrame(Buffer.concat(fragments).toString("utf8"));
          fragmentedOpcode = null;
          fragments.length = 0;
        }
      }
    }
  });
  return wrapper;
}

function readHandshake(socket, key) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("latin1");
      if (!data.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      if (!/^HTTP\/1\.1 101/m.test(data)) {
        reject(new Error(`WebSocket handshake failed: ${data.split(/\r?\n/)[0]}`));
        return;
      }
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      if (!data.toLowerCase().includes(`sec-websocket-accept: ${accept}`.toLowerCase())) {
        reject(new Error("WebSocket accept header mismatch"));
        return;
      }
      resolve();
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function encodeFrame(payload, opcode = 1) {
  const header = [];
  header.push(0x80 | opcode);
  const mask = randomBytes(4);
  if (payload.length < 126) header.push(0x80 | payload.length);
  else if (payload.length < 65536) header.push(0x80 | 126, payload.length >> 8, payload.length & 0xff);
  else {
    const length = BigInt(payload.length);
    header.push(0x80 | 127);
    for (let shift = 56n; shift >= 0n; shift -= 8n) header.push(Number((length >> shift) & 0xffn));
  }
  const out = Buffer.concat([Buffer.from(header), mask, payload]);
  for (let index = 0; index < payload.length; index += 1) out[header.length + 4 + index] = payload[index] ^ mask[index % 4];
  return out;
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const bigLength = buffer.readBigUInt64BE(2);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CDP frame exceeds safe JavaScript length");
    length = Number(bigLength);
    offset = 10;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { fin, opcode, payload, rest: buffer.subarray(offset + length) };
}

function nodeMatchesSurface(snapshot, doc, nodeIndex, surfaceKey, checkpoint = {}) {
  const attrs = nodeAttributes(snapshot, doc, nodeIndex);
  const strings = snapshotStrings(snapshot);
  const tag = stringAt(strings, doc.nodes?.nodeName?.[nodeIndex] || "").toLowerCase();
  const checkpointRole = checkpoint.role || checkpoint.surfaceRole || null;
  if (checkpointRole && attrs["data-message-author-role"] && attrs["data-message-author-role"] !== checkpointRole) return false;
  if (surfaceKey === "composer") return attrs["data-composer-surface"] === "true" || /composer/i.test(attrs["data-testid"] || "");
  if (surfaceKey === "mentionChooser") return attrs.role === "listbox" || /mention|composer-menu/i.test(attrs["data-testid"] || "");
  if (surfaceKey === "connectorPill") return attrs["data-inline-selection-pill"] !== undefined || /plugin:/.test(attrs["data-id"] || "");
  if (surfaceKey === "assistantActionBar" || surfaceKey === "nativeCopyArea") return attrs.role === "toolbar" || /action|copy/i.test(attrs["data-testid"] || attrs["aria-label"] || "");
  if (surfaceKey === "micaCopy") return attrs["data-testid"] === "mica-copy" || /mica.*copy/i.test(attrs["data-testid"] || attrs["aria-label"] || "");
  if (surfaceKey === "micaOverlay") return attrs["data-mica-root"] === "true" || tag === "mica-overlay";
  if (surfaceKey === "userTurn") return attrs["data-message-author-role"] === "user" || /conversation-turn/i.test(attrs["data-testid"] || "") && checkpointRole === "user";
  if (surfaceKey === "assistantStreaming" || surfaceKey === "assistantSettled" || surfaceKey === "richMarkdown") {
    return attrs["data-message-author-role"] === "assistant" || /conversation-turn/i.test(attrs["data-testid"] || "") && checkpointRole !== "user";
  }
  if (surfaceKey === "longThreadMountedWindow") return /conversation|thread|scroll/i.test(attrs["data-testid"] || attrs.role || "");
  return false;
}

function isTurnBoundSurface(surfaceKey) {
  return surfaceKey === "userTurn"
    || surfaceKey === "assistantStreaming"
    || surfaceKey === "assistantSettled"
    || surfaceKey === "richMarkdown";
}

function isAssistantOwnedSurface(surfaceKey) {
  return surfaceKey === "assistantActionBar" || surfaceKey === "nativeCopyArea";
}

function surfaceTurnIdentity(snapshot, doc, nodeIndex, surfaceKey, checkpoint = {}) {
  if (surfaceKey === "userTurn") {
    return { turnId: turnHintForNode(snapshot, doc, nodeIndex, "user"), owningTurnNodeIndex: nodeIndex };
  }
  if (surfaceKey === "assistantStreaming" || surfaceKey === "assistantSettled" || surfaceKey === "richMarkdown") {
    return { turnId: turnHintForNode(snapshot, doc, nodeIndex, "assistant"), owningTurnNodeIndex: nodeIndex };
  }
  if (isAssistantOwnedSurface(surfaceKey)) {
    const owner = findOwningTurnNodeIndex(snapshot, doc, nodeIndex, "assistant");
    return {
      turnId: owner === null ? null : turnHintForNode(snapshot, doc, owner, "assistant"),
      owningTurnNodeIndex: owner
    };
  }
  return { turnId: safeCheckpointTurnId(checkpoint.turnId), owningTurnNodeIndex: null };
}

function findOwningTurnNodeIndex(snapshot, doc, nodeIndex, expectedRole) {
  const parentIndex = doc.nodes?.parentIndex || [];
  let current = nodeIndex;
  while (current !== null && current !== undefined && current >= 0) {
    const role = roleForNode(snapshot, doc, current);
    if (role === expectedRole) return current;
    current = parentIndex[current];
  }
  return null;
}

function turnHintForNode(snapshot, doc, nodeIndex, expectedRole = null) {
  const role = expectedRole || roleForNode(snapshot, doc, nodeIndex);
  if (!role) return null;
  const direct = nodeAttributes(snapshot, doc, nodeIndex);
  const roleNodeIndex = direct["data-message-author-role"] === role ? nodeIndex : findDescendantRoleNodeIndex(snapshot, doc, nodeIndex, role);
  const roleAttrs = roleNodeIndex === null ? {} : nodeAttributes(snapshot, doc, roleNodeIndex);
  const stable = direct["data-testid"] || roleAttrs["data-testid"] || direct["data-message-id"] || roleAttrs["data-message-id"];
  if (stable && /^[a-zA-Z0-9:_-]{1,120}$/.test(stable)) return safeTurnHint(`${role}:${stable}`);
  return null;
}

function roleForNode(snapshot, doc, nodeIndex) {
  const direct = nodeAttributes(snapshot, doc, nodeIndex)["data-message-author-role"];
  if (direct) return direct;
  for (const role of ["user", "assistant", "tool"]) {
    if (findDescendantRoleNodeIndex(snapshot, doc, nodeIndex, role) !== null) return role;
  }
  return null;
}

function findDescendantRoleNodeIndex(snapshot, doc, nodeIndex, role) {
  const pending = childIndexesOf(doc, nodeIndex).slice(0, 64);
  let inspected = 0;
  while (pending.length && inspected < 256) {
    inspected += 1;
    const current = pending.shift();
    const attrs = nodeAttributes(snapshot, doc, current);
    if (attrs["data-message-author-role"] === role) return current;
    pending.push(...childIndexesOf(doc, current).slice(0, 32));
  }
  return null;
}

function nodeAttributes(snapshot, doc, nodeIndex) {
  const attrs = {};
  const strings = snapshotStrings(snapshot);
  const raw = doc.nodes?.attributes?.[nodeIndex] || [];
  for (let index = 0; index < raw.length; index += 2) {
    const key = stringAt(strings, raw[index]);
    const value = stringAt(strings, raw[index + 1]);
    attrs[key] = value;
  }
  return attrs;
}

function findSurfaceNodeIndex(snapshot, doc, surfaceKey, checkpoint = {}) {
  const nodes = doc.nodes || {};
  for (let index = 0; index < (nodes.nodeName?.length || 0); index += 1) {
    if (nodeMatchesSurface(snapshot, doc, index, surfaceKey, checkpoint)) return index;
  }
  return null;
}

function sanitizedAttributes(snapshot, doc, nodeIndex) {
  const attrs = {};
  const strings = snapshotStrings(snapshot);
  const raw = doc.nodes?.attributes?.[nodeIndex] || [];
  const allow = new Set(["role", "aria-expanded", "aria-pressed", "disabled", "contenteditable", "data-composer-surface", "data-message-author-role", "data-mica-root", "data-inline-selection-pill", "data-symbol", "data-testid", "data-id", "aria-label"]);
  for (let index = 0; index < raw.length; index += 2) {
    const key = stringAt(strings, raw[index]);
    const value = stringAt(strings, raw[index + 1]);
    if (!allow.has(key)) continue;
    if (key === "aria-label" && !["Copy", "Stop", "Retry", "Continue", "Regenerate"].includes(value)) {
      attrs[key] = `label-length-${value.length}`;
    } else if (key === "data-id" && /^plugin:/.test(value)) {
      attrs[key] = "plugin:anonymous";
    } else if (/^(data-testid|data-symbol|data-message-author-role|role|contenteditable|aria-expanded|aria-pressed|disabled|data-composer-surface|data-mica-root|data-inline-selection-pill)$/.test(key)) {
      attrs[key] = stableAttr(value);
    }
  }
  return attrs;
}

function sanitizedStyles(snapshot, doc, nodeIndex) {
  const styles = {};
  const strings = snapshotStrings(snapshot);
  const layout = doc.layout || {};
  const layoutIndex = (layout.nodeIndex || []).indexOf(nodeIndex);
  const styleIndexes = layoutIndex >= 0 ? layout.styles?.[layoutIndex] || [] : [];
  for (let index = 0; index < Math.min(styleIndexes.length, STYLE_WHITELIST.length); index += 1) {
    const value = stringAt(strings, styleIndexes[index]);
    if (value && value.length <= 120 && !/url\(|https?:|file:|data:text/i.test(value)) styles[STYLE_WHITELIST[index]] = value;
  }
  return styles;
}

function textContract(snapshot, doc, nodeIndex) {
  const children = childIndexesOf(doc, nodeIndex);
  let textLength = 0;
  const strings = snapshotStrings(snapshot);
  for (const child of children) {
    const name = stringAt(strings, doc.nodes?.nodeName?.[child] || "");
    if (name === "#text") {
      const value = stringAt(strings, doc.nodes?.nodeValue?.[child] || "");
      textLength += value.length;
    }
  }
  return { category: textLength === 0 ? "empty" : textLength <= 24 ? "short" : textLength <= 240 ? "medium" : "long", length: textLength };
}

function childIndexesOf(doc, nodeIndex) {
  const parentIndex = doc.nodes?.parentIndex || [];
  const children = [];
  for (let index = 0; index < parentIndex.length; index += 1) {
    if (parentIndex[index] === nodeIndex) children.push(index);
  }
  return children;
}

function controlState(attrs) {
  return {
    disabled: attrs.disabled !== undefined,
    expanded: attrs["aria-expanded"] ?? null,
    pressed: attrs["aria-pressed"] ?? null,
    contenteditable: attrs.contenteditable ?? null
  };
}

function assertOfficialSnapshotStrings(snapshot) {
  if (!Array.isArray(snapshot?.strings)) throw new Error("DOMSnapshot response missing top-level strings table");
}

function snapshotStrings(snapshot) {
  assertOfficialSnapshotStrings(snapshot);
  return snapshot.strings;
}

function rectFromBounds(rect) {
  if (!Array.isArray(rect) || rect.length < 4) return null;
  return { x: Number(rect[0]), y: Number(rect[1]), width: Number(rect[2]), height: Number(rect[3]) };
}

function viewportOffsetFor(doc, layoutMetrics = null) {
  const cssVisual = layoutMetrics?.cssVisualViewport || {};
  const cssLayout = layoutMetrics?.cssLayoutViewport || {};
  const visual = layoutMetrics?.visualViewport || {};
  const layout = layoutMetrics?.layoutViewport || {};
  const deprecatedScale = firstFinite(cssVisual.zoom, cssVisual.scale, visual.zoom, visual.scale, 1);
  const pageX = firstFinite(cssVisual.pageX, cssLayout.pageX, doc?.scrollOffsetX, normalizeDeprecatedMetric(visual.pageX, deprecatedScale), normalizeDeprecatedMetric(layout.pageX, deprecatedScale), 0);
  const pageY = firstFinite(cssVisual.pageY, cssLayout.pageY, doc?.scrollOffsetY, normalizeDeprecatedMetric(visual.pageY, deprecatedScale), normalizeDeprecatedMetric(layout.pageY, deprecatedScale), 0);
  return { x: pageX, y: pageY };
}

function documentRectToViewportRect(rect, offset) {
  return { x: rect.x - offset.x, y: rect.y - offset.y, width: rect.width, height: rect.height };
}

export function screenshotClipForDocumentRect(documentRect, layoutMetrics = null) {
  const rect = normalizeTargetRect(documentRect);
  if (!rect) return { x: 0, y: 0, width: 1, height: 1, scale: 1 };
  const zoom = zoomForScreenshot(layoutMetrics);
  const cssContent = layoutMetrics?.cssContentSize || {};
  const legacyContent = layoutMetrics?.contentSize || {};
  const maxWidthCss = firstFinite(cssContent.width, normalizeDeprecatedMetric(legacyContent.width, zoom), rect.x + rect.width);
  const maxHeightCss = firstFinite(cssContent.height, normalizeDeprecatedMetric(legacyContent.height, zoom), rect.y + rect.height);
  const xCss = Math.max(0, Math.min(rect.x, Math.max(0, maxWidthCss - 1)));
  const yCss = Math.max(0, Math.min(rect.y, Math.max(0, maxHeightCss - 1)));
  const clippedCss = {
    x: xCss,
    y: yCss,
    width: Math.max(1, Math.min(rect.width, Math.max(1, maxWidthCss - xCss))),
    height: Math.max(1, Math.min(rect.height, Math.max(1, maxHeightCss - yCss)))
  };
  return {
    x: round(clippedCss.x * zoom),
    y: round(clippedCss.y * zoom),
    width: round(clippedCss.width * zoom),
    height: round(clippedCss.height * zoom),
    scale: 1
  };
}

function normalizeTargetRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const out = rectFromBounds([rect.x, rect.y, rect.width, rect.height]);
  return out && Number.isFinite(out.x) && Number.isFinite(out.y) && out.width > 0 && out.height > 0 ? out : null;
}

function rectDistance(rect, target) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const areaDelta = Math.abs((rect.width * rect.height) - (target.width * target.height)) / Math.max(1, target.width * target.height);
  return Math.hypot(cx - tx, cy - ty) + areaDelta * 100;
}

function variantForCheckpoint(checkpoint) {
  const stateClass = checkpoint.stateClass || "unknown";
  const generation = checkpoint.generationId ? `g${checkpoint.generationId}` : "global";
  return `${generation}:${stateClass}`;
}

function visualCoalesceKey(checkpoint, surfaceKey) {
  const rect = rectKey(normalizeTargetRect(checkpoint.targetRect || checkpoint.rect));
  const generation = checkpoint.generationId == null ? "global" : `g${checkpoint.generationId}`;
  const turnId = safeCheckpointTurnId(checkpoint.turnId) || "no-turn";
  if (surfaceKey === "composer") {
    const identity = stableKeyPart(checkpoint.composerId || checkpoint.composerIdentity || checkpoint.identityHint || "");
    const phase = composerVisualPhase(checkpoint.stateClass);
    return `composer:${phase}:${generation}:${identity}:${rect}`;
  }
  if (surfaceKey === "micaOverlay") {
    const recording = checkpoint.recording === true || checkpoint.overlay?.recording === true ? "recording" : "idle";
    const mode = stableKeyPart(checkpoint.mode || checkpoint.overlay?.mode || checkpoint.state || "");
    return `micaOverlay:${recording}:${mode}:${rect}`;
  }
  if (surfaceKey === "longThreadMountedWindow") return `longThreadMountedWindow:${rect}`;
  if (surfaceKey === "assistantActionBar" || surfaceKey === "nativeCopyArea") {
    return `${surfaceKey}:${generation}:${turnId}:${rect}`;
  }
  if (isTurnBoundSurface(surfaceKey)) {
    return `${surfaceKey}:${generation}:${turnId}:${checkpoint.stateClass || "unknown"}:${rect}`;
  }
  return `${surfaceKey}:${generation}:${checkpoint.stateClass || "unknown"}:${rect}`;
}

export function semanticVisualKey(checkpoint, surfaceKey, context = {}) {
  const stateClass = checkpoint?.stateClass || "";
  const generation = checkpoint?.generationId == null ? "global" : `g${checkpoint.generationId}`;
  const turnId = safeCheckpointTurnId(checkpoint?.turnId) || "no-turn";
  if (surfaceKey === "composer") {
    if (stateClass === "composer_focus" || stateClass === "composer_blur") return null;
    if (stateClass === "atlas_started" || stateClass === "composer_present") return "composer:baseline";
    if (stateClass === "composer_identity_changed") {
      if (!context.composerBaselineAlreadyRepresented) return "composer:baseline";
      return `composer:identity_changed:${safeFilePart(checkpoint?.checkpointId)}`;
    }
    return "composer:baseline";
  }
  if (surfaceKey === "longThreadMountedWindow") return `longThreadMountedWindow:${generation}`;
  if (surfaceKey === "mentionChooser") return "mentionChooser:first_visible";
  if (surfaceKey === "connectorPill") return "connectorPill:first_visible";
  if (surfaceKey === "micaOverlay") return `micaOverlay:${checkpoint?.recording === true ? "recording" : "state"}`;
  if (surfaceKey === "micaCopy") return `micaCopy:${safeFilePart(checkpoint?.checkpointId)}`;
  if (surfaceKey === "assistantActionBar" || surfaceKey === "nativeCopyArea") return `${surfaceKey}:${generation}`;
  if (surfaceKey === "assistantStreaming") return `assistantStreaming:${generation}`;
  if (surfaceKey === "assistantSettled") return `assistantSettled:${generation}`;
  if (surfaceKey === "richMarkdown") return `richMarkdown:${generation}`;
  if (surfaceKey === "userTurn") return `userTurn:${generation}`;
  return `${surfaceKey}:${generation}:${stateClass}`;
}

export function visualPriorityFor(surfaceKey, checkpoint = {}) {
  if (surfaceKey === "mentionChooser" || surfaceKey === "micaCopy") return "HIGH";
  if (surfaceKey === "connectorPill") return "HIGH";
  if (surfaceKey === "assistantActionBar" && checkpoint.generationId != null) return "HIGH";
  return "NORMAL";
}

export function isGenerationLifecycleSurface(surfaceKey) {
  return surfaceKey === "userTurn"
    || surfaceKey === "assistantStreaming"
    || surfaceKey === "assistantSettled"
    || surfaceKey === "richMarkdown";
}

export function checkpointTimeForBudget(checkpoint = {}) {
  const value = Number(checkpoint.monotonicTimestamp ?? checkpoint.relativeTimeMs ?? checkpoint.cdpMonotonicTimestamp);
  return Number.isFinite(value) ? value : Date.now();
}

function composerVisualPhase(stateClass) {
  if (stateClass === "composer_focus") return "focus";
  if (stateClass === "composer_blur") return "blur";
  if (stateClass === "composer_identity_changed") return "identity_changed";
  return "stable";
}

function rectKey(rect) {
  if (!rect) return "no-rect";
  return [rect.x, rect.y, rect.width, rect.height].map((value) => String(Math.round(Number(value || 0) / 4) * 4)).join(",");
}

function stableKeyPart(value) {
  const text = String(value || "");
  return /^[a-zA-Z0-9:_-]{1,80}$/.test(text) ? text : text ? `len${text.length}` : "none";
}

function safeCheckpointTimelineDetails(checkpoint) {
  return {
    checkpointId: checkpoint.checkpointId || null,
    stateClass: checkpoint.stateClass || null,
    generationId: checkpoint.generationId ?? null,
    terminal: checkpoint.terminal === true,
    surfaceKey: surfaceKeyForCheckpoint(checkpoint.stateClass),
    cdpMonotonicTimestamp: checkpoint.monotonicTimestamp ?? null,
    targetRect: normalizeTargetRect(checkpoint.targetRect || checkpoint.rect)
  };
}

function isRecorderReportCheckpoint(checkpoint) {
  return (checkpoint?.stateClass === "recorder_report_exported" && checkpoint.report && typeof checkpoint.report === "object")
    || checkpoint?.stateClass === "recorder_report_chunk";
}

function assembleRecorderReportChunk(checkpoint, reportChunks) {
  const chunk = checkpoint.chunk;
  const sessionId = safeFilePart(chunk?.sessionId || "unknown");
  const total = Math.max(1, Math.min(100, Math.round(Number(chunk?.total || 0))));
  const index = Math.round(Number(chunk?.index));
  if (!Number.isFinite(index) || index < 0 || index >= total || typeof chunk.data !== "string") return null;
  if (!reportChunks.has(sessionId)) reportChunks.set(sessionId, { total, chunks: new Array(total).fill(null) });
  const entry = reportChunks.get(sessionId);
  if (entry.total !== total) return null;
  entry.chunks[index] = chunk.data;
  if (entry.chunks.some((item) => item === null)) return null;
  reportChunks.delete(sessionId);
  try {
    return JSON.parse(entry.chunks.join(""));
  } catch (_error) {
    return null;
  }
}

function mergeRecorderReports(reports) {
  const last = reports[reports.length - 1] || {};
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.recorderReport",
    reportCount: reports.length,
    privacy: privacyFlags(),
    safety: safetyFlags(),
    coverage: last.coverage || {},
    counters: last.counters || {},
    performance: mergeRecorderPerformance(reports),
    timeline: reports.flatMap((report) => Array.isArray(report.timeline) ? report.timeline : [])
  };
}

function mergeRecorderPerformance(reports) {
  const performance = { eventTiming: [], longAnimationFrame: [], longTask: [], layoutShift: [], memory: null };
  for (const report of reports) {
    const source = report.performance || {};
    for (const key of ["eventTiming", "longAnimationFrame", "longTask", "layoutShift"]) {
      if (Array.isArray(source[key])) performance[key].push(...source[key]);
    }
    if (source.memory) performance.memory = source.memory;
  }
  return performance;
}

function sanitizeClip(rect, layout) {
  const viewport = layout?.visualViewport || layout?.layoutViewport || { clientWidth: 1200, clientHeight: 900, pageX: 0, pageY: 0 };
  const x = Math.max(0, Number(rect.x || 0));
  const y = Math.max(0, Number(rect.y || 0));
  const width = Math.max(1, Math.min(Number(rect.width || 1), Number(viewport.clientWidth || 1200)));
  const height = Math.max(1, Math.min(Number(rect.height || 1), Number(viewport.clientHeight || 900)));
  return { x, y, width, height, scale: 1 };
}

function clipToRect(clip) {
  return { x: round(clip.x), y: round(clip.y), width: round(clip.width), height: round(clip.height) };
}

function roundRect(rect) {
  if (!rect) return null;
  return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
}

function roundRectOffset(offset) {
  if (!offset) return null;
  return { x: round(offset.x), y: round(offset.y) };
}

function stableAttr(value) {
  if (value === "") return "";
  if (/^[a-zA-Z0-9:_ -]{1,80}$/.test(value)) return value;
  return `attr-length-${String(value).length}`;
}

function safeCheckpointTurnId(value) {
  const text = String(value || "");
  return /^turn:[a-z0-9]{1,32}$/.test(text) ? text : null;
}

function safeTurnHint(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `turn:${(hash >>> 0).toString(36)}`;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function hasCssViewportMetrics(layoutMetrics = null) {
  return !!(layoutMetrics?.cssVisualViewport || layoutMetrics?.cssLayoutViewport || layoutMetrics?.cssContentSize);
}

function zoomForScreenshot(layoutMetrics = null) {
  return saneZoom(layoutMetrics?.cssVisualViewport?.zoom ?? layoutMetrics?.cssVisualViewport?.scale ?? 1);
}

function saneZoom(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function normalizeDeprecatedMetric(value, scale = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const divisor = saneZoom(scale);
  return number / divisor;
}

function normalizeTag(tag) {
  return /^[a-z0-9-]{1,40}$/.test(tag) ? tag : "div";
}

function safeFilePart(value) {
  return String(value || "checkpoint").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

function stringAt(strings, index) {
  return typeof index === "number" ? String(strings[index] || "") : String(index || "");
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
