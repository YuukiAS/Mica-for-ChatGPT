(() => {
  const VERSION = "0.1.0";
  const VERSION_NAME = "0.1.0-alpha.2";
  const DEFAULT_SETTINGS = {
    enabled: true,
    showStatus: true,
    autoDismissKnownInterruptions: true,
    recentTurnKeepCount: 8,
    nativeOnlyTurnThreshold: 14,
    viewportBufferMultiple: 1.75
  };
  const STORAGE_KEYS = Object.keys(DEFAULT_SETTINGS);
  const STATUS = {
    ACTIVE: "Active",
    NATIVE_VIRTUALIZATION: "Native virtualization",
    NATIVE_ONLY: "Native only",
    DEGRADED: "Degraded",
    DISABLED: "Disabled"
  };
  const TURN_SELECTOR = [
    "[data-message-author-role]",
    "[data-testid^='conversation-turn-']",
    "[data-testid*='conversation-turn']",
    "article"
  ].join(",");
  const ROLE_SELECTOR = "[data-message-author-role='user'], [data-message-author-role='assistant'], [data-message-author-role='tool']";
  const SPECIAL_SELECTOR = [
    "textarea",
    "input:not([type='hidden'])",
    "select",
    "form",
    "[contenteditable='true']",
    "[role='dialog']",
    "iframe",
    "[data-testid*='composer']",
    "[data-testid*='tool']",
    "[data-testid*='file']",
    "[data-testid*='attachment']",
    "[data-testid*='drive']",
    "[data-testid*='oauth']",
    "[data-testid*='auth']"
  ].join(",");
  const SUPPORTS_CONTENT_VISIBILITY = typeof CSS !== "undefined" && CSS.supports?.("content-visibility", "auto");
  const FRAME_STALL_MS = 50;
  const bootTime = Date.now();
  const measuredHeights = new WeakMap();
  const observedTurns = new WeakSet();
  const optimizedTurns = new Set();
  const globalCounters = {
    mutations: 0,
    addedNodes: 0,
    removedNodes: 0,
    turnMounts: 0,
    turnUnmounts: 0,
    turnSamples: 0,
    knownInterruptionDismissals: 0,
    knownInterruptionDismissalsByRule: {},
    lastKnownInterruptionRuleId: null
  };
  const turnWindow = {
    previousKeys: new Set(),
    currentKeys: new Set(),
    lastMountedCount: 0,
    lastSampleAt: 0
  };
  let diagnostics = createDiagnosticsState();
  let settings = { ...DEFAULT_SETTINGS };
  let currentStatus = {
    name: STATUS.NATIVE_ONLY,
    reason: "Initializing",
    mountedTurns: 0,
    optimizedTurns: 0,
    protectedTurns: 0,
    updatedAt: new Date().toISOString(),
    version: VERSION,
    versionName: VERSION_NAME,
    label: "Mica · Native only · 0 mounted"
  };
  let badgeHost = null;
  let badgeRoot = null;
  let mutationObserver = null;
  let resizeObserver = null;
  let scheduled = false;
  let lastUrl = location.href;

  if (!isSupportedPage()) {
    return;
  }

  initialize();

  async function initialize() {
    injectStyles();
    settings = { ...DEFAULT_SETTINGS, ...(await readSettings()) };
    setupBadge();
    setupObservers();
    setupMessages();
    scheduleScan();
  }

  function isSupportedPage() {
    const host = location.hostname;
    return host === "chatgpt.com" || host === "chat.openai.com" || document.documentElement.dataset.micaFixture === "true";
  }

  function readSettings() {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) {
        resolve({});
        return;
      }
      storage.get(STORAGE_KEYS, (items) => {
        resolve(chrome.runtime?.lastError ? {} : sanitizeSettings(items || {}));
      });
    });
  }

  function writeSettings(next) {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) {
        settings = { ...settings, ...next };
        resolve();
        return;
      }
      storage.set(next, () => resolve());
    });
  }

  function sanitizeSettings(value) {
    const next = {};
    if (typeof value.enabled === "boolean") next.enabled = value.enabled;
    if (typeof value.showStatus === "boolean") next.showStatus = value.showStatus;
    if (typeof value.autoDismissKnownInterruptions === "boolean") next.autoDismissKnownInterruptions = value.autoDismissKnownInterruptions;
    if (Number.isFinite(value.recentTurnKeepCount)) next.recentTurnKeepCount = clamp(Math.round(value.recentTurnKeepCount), 4, 20);
    if (Number.isFinite(value.nativeOnlyTurnThreshold)) next.nativeOnlyTurnThreshold = clamp(Math.round(value.nativeOnlyTurnThreshold), 6, 40);
    if (Number.isFinite(value.viewportBufferMultiple)) next.viewportBufferMultiple = clamp(Number(value.viewportBufferMultiple), 1, 4);
    return next;
  }

  function setupObservers() {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        if (!(target instanceof HTMLElement)) continue;
        const height = Math.max(80, Math.ceil(entry.borderBoxSize?.[0]?.blockSize || target.getBoundingClientRect().height));
        measuredHeights.set(target, height);
        target.style.setProperty("--mica-intrinsic-height", `${height}px`);
      }
    });

    mutationObserver = new MutationObserver((mutations) => {
      recordMutations(mutations);
      processKnownInterruptions();
      scheduleScan();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    addEventListener("scroll", () => {
      recordScrollSample();
      scheduleScan();
    }, { passive: true, capture: true });
    addEventListener("resize", () => scheduleScan(), { passive: true });
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        clearOptimization();
        turnWindow.previousKeys = new Set();
      }
      scheduleScan();
      processKnownInterruptions();
    }, 1500);
  }

  function setupMessages() {
    globalThis.chrome?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") return false;
      if (message.type === "MICA_GET_STATUS") {
        sendResponse({ status: currentStatus, settings, diagnostics: summarizeDiagnostics() });
        return true;
      }
      if (message.type === "MICA_SET_SETTINGS") {
        const next = sanitizeSettings(message.settings || {});
        settings = { ...settings, ...next };
        writeSettings(next).then(() => {
          scheduleScan();
          processKnownInterruptions();
          sendResponse({ status: currentStatus, settings, diagnostics: summarizeDiagnostics() });
        });
        return true;
      }
      if (message.type === "MICA_DIAGNOSTICS_START") {
        startDiagnostics();
        sendResponse({ status: currentStatus, diagnostics: summarizeDiagnostics() });
        return true;
      }
      if (message.type === "MICA_DIAGNOSTICS_STOP") {
        stopDiagnostics();
        sendResponse({ status: currentStatus, diagnostics: summarizeDiagnostics(), report: buildDiagnosticsReport() });
        return true;
      }
      if (message.type === "MICA_DIAGNOSTICS_COPY_REPORT") {
        const report = buildDiagnosticsReport();
        sendResponse({ status: currentStatus, diagnostics: summarizeDiagnostics(), report, reportText: JSON.stringify(report, null, 2) });
        return true;
      }
      if (message.type === "MICA_DIAGNOSTICS_RESET") {
        resetDiagnostics();
        sendResponse({ status: currentStatus, diagnostics: summarizeDiagnostics() });
        return true;
      }
      return false;
    });

    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      const next = {};
      for (const key of STORAGE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          next[key] = changes[key].newValue;
        }
      }
      settings = { ...settings, ...sanitizeSettings(next) };
      scheduleScan();
    });
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        scanAndApply();
      } catch (error) {
        clearOptimization();
        setStatus(STATUS.DEGRADED, `Scan failed: ${error?.message || String(error)}`, []);
      }
    });
  }

  function scanAndApply() {
    if (!settings.enabled) {
      clearOptimization();
      setStatus(STATUS.DISABLED, "Disabled by user", []);
      return;
    }
    processKnownInterruptions();
    if (!SUPPORTS_CONTENT_VISIBILITY) {
      clearOptimization();
      setStatus(STATUS.DEGRADED, "Browser lacks content-visibility support", []);
      return;
    }

    const turns = collectConversationTurns();
    updateTurnWindowStats(turns);
    if (turns.length === 0) {
      clearOptimization();
      const conversationPath = isConversationPath();
      const hasTimedOut = Date.now() - bootTime > 5000;
      const name = conversationPath && hasTimedOut ? STATUS.DEGRADED : STATUS.NATIVE_ONLY;
      const reason = conversationPath && hasTimedOut ? "No safe conversation turn container found" : "No mounted conversation turns";
      setStatus(name, reason, turns);
      return;
    }

    if (!isSafeTurnSet(turns)) {
      clearOptimization();
      setStatus(STATUS.DEGRADED, "Mounted turn structure is ambiguous", turns);
      return;
    }

    for (const turn of turns) {
      observeTurn(turn);
    }

    if (turns.length <= settings.nativeOnlyTurnThreshold) {
      clearOptimization();
      const nativeName = isNativeVirtualizationLikely(turns) ? STATUS.NATIVE_VIRTUALIZATION : STATUS.NATIVE_ONLY;
      const reason = nativeName === STATUS.NATIVE_VIRTUALIZATION
        ? "ChatGPT appears to keep only a small mounted conversation window"
        : "Mounted turn count is small enough for native rendering";
      setStatus(nativeName, reason, turns);
      return;
    }

    const protectedIndexes = getProtectedIndexes(turns);
    let optimizedCount = 0;
    let protectedCount = 0;
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      const shouldProtect = protectedIndexes.has(index);
      const shouldOptimize = !shouldProtect && isFarFromViewport(turn);
      if (shouldOptimize) {
        applyOptimization(turn);
        optimizedCount += 1;
      } else {
        removeOptimization(turn);
        if (shouldProtect) protectedCount += 1;
      }
    }

    if (optimizedCount > 0) {
      setStatus(STATUS.ACTIVE, "Mica render containment applied to offscreen mounted turns", turns, optimizedCount, protectedCount);
      return;
    }

    setStatus(STATUS.NATIVE_ONLY, "All mounted turns are protected or near the viewport", turns, optimizedCount, protectedCount);
  }

  function collectConversationTurns() {
    const main = document.querySelector("main") || document.body;
    const raw = Array.from(main.querySelectorAll(TURN_SELECTOR)).filter((node) => node instanceof HTMLElement);
    const unique = new Set();

    for (const node of raw) {
      if (!(node instanceof HTMLElement) || node.closest("[data-mica-root='true']")) continue;
      let turn = null;
      const roleNode = node.matches("[data-message-author-role]") ? node : node.querySelector("[data-message-author-role]");
      if (roleNode instanceof HTMLElement) {
        turn =
          roleNode.closest("[data-testid^='conversation-turn-']") ||
          roleNode.closest("[data-testid*='conversation-turn']") ||
          roleNode.closest("article") ||
          roleNode;
      } else if (node.matches("article") && (node.childElementCount > 0 || node.getBoundingClientRect().height > 20)) {
        turn = node;
      }

      if (!(turn instanceof HTMLElement)) continue;
      if (!main.contains(turn)) continue;
      if (turn.offsetParent === null && turn.getClientRects().length === 0) continue;
      unique.add(turn);
    }

    return Array.from(unique).sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function isSafeTurnSet(turns) {
    if (turns.length < 2) return true;
    const roleCount = turns.filter((turn) => turn.querySelector(ROLE_SELECTOR) || turn.matches(ROLE_SELECTOR)).length;
    const articleCount = turns.filter((turn) => turn.matches("article") || turn.querySelector("article")).length;
    return roleCount >= 2 || articleCount >= Math.min(3, turns.length);
  }

  function getProtectedIndexes(turns) {
    const protectedIndexes = new Set();
    const recentStart = Math.max(0, turns.length - settings.recentTurnKeepCount);
    const streaming = hasStreamingControl();

    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      if (index >= recentStart) protectedIndexes.add(index);
      if (isNearViewport(turn)) protectedIndexes.add(index);
      if (turn.contains(document.activeElement)) protectedIndexes.add(index);
      if (isSpecialTurn(turn)) protectedIndexes.add(index);
      if (streaming && index >= turns.length - Math.max(4, settings.recentTurnKeepCount)) protectedIndexes.add(index);
    }
    return protectedIndexes;
  }

  function isNearViewport(element) {
    const rect = element.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight || 900;
    const buffer = viewport * settings.viewportBufferMultiple;
    return rect.bottom >= -buffer && rect.top <= viewport + buffer;
  }

  function isFarFromViewport(element) {
    return !isNearViewport(element);
  }

  function isSpecialTurn(turn) {
    if (turn.querySelector(SPECIAL_SELECTOR)) return true;
    const text = turn.innerText || "";
    return /authorize|authorization|allow access|connect (google|drive|github|slack)|sign in to|log in to|授权|允许访问|登录到/i.test(text);
  }

  function hasStreamingControl() {
    const text = document.body?.innerText || "";
    if (/stop (generating|streaming)|停止生成|停止回答/i.test(text)) return true;
    return !!document.querySelector("[aria-label*='Stop'], [data-testid*='stop']");
  }

  function observeTurn(turn) {
    if (observedTurns.has(turn)) return;
    observedTurns.add(turn);
    const height = Math.max(80, Math.ceil(turn.getBoundingClientRect().height));
    measuredHeights.set(turn, height);
    turn.style.setProperty("--mica-intrinsic-height", `${height}px`);
    resizeObserver?.observe(turn);
  }

  function applyOptimization(turn) {
    const height = measuredHeights.get(turn) || Math.max(240, Math.ceil(turn.getBoundingClientRect().height));
    turn.style.setProperty("--mica-intrinsic-height", `${height}px`);
    turn.classList.add("mica-turn-optimized");
    turn.dataset.micaOptimized = "true";
    optimizedTurns.add(turn);
  }

  function removeOptimization(turn) {
    turn.classList.remove("mica-turn-optimized");
    delete turn.dataset.micaOptimized;
    optimizedTurns.delete(turn);
  }

  function clearOptimization() {
    for (const turn of Array.from(optimizedTurns)) {
      removeOptimization(turn);
    }
  }

  function updateTurnWindowStats(turns) {
    const nextKeys = new Set(turns.map((turn, index) => getTurnKey(turn, index)));
    if (turnWindow.lastSampleAt > 0) {
      for (const key of nextKeys) {
        if (!turnWindow.previousKeys.has(key)) globalCounters.turnMounts += 1;
      }
      for (const key of turnWindow.previousKeys) {
        if (!nextKeys.has(key)) globalCounters.turnUnmounts += 1;
      }
    }
    globalCounters.turnSamples += 1;
    turnWindow.previousKeys = nextKeys;
    turnWindow.currentKeys = nextKeys;
    turnWindow.lastMountedCount = turns.length;
    turnWindow.lastSampleAt = Date.now();
  }

  function getTurnKey(turn, index) {
    const roleNode = turn.matches("[data-message-author-role]") ? turn : turn.querySelector("[data-message-author-role]");
    const role = roleNode?.getAttribute("data-message-author-role") || "unknown";
    const testId = turn.getAttribute("data-testid") || roleNode?.closest("[data-testid]")?.getAttribute("data-testid") || "";
    const messageId = turn.getAttribute("data-message-id") || roleNode?.getAttribute("data-message-id") || "";
    const id = turn.id || "";
    if (testId || messageId || id) {
      return `${role}:${testId}:${messageId}:${id}`;
    }
    const rect = turn.getBoundingClientRect();
    return `${role}:${index}:${Math.round(rect.top / 20)}:${Math.round(rect.height / 20)}`;
  }

  function isNativeVirtualizationLikely(turns) {
    if (!isConversationPath() && document.documentElement.dataset.micaFixture !== "true") return false;
    if (globalCounters.turnUnmounts > 0 && turns.length <= settings.nativeOnlyTurnThreshold) return true;
    const scrollElement = document.scrollingElement || document.documentElement;
    const viewport = window.innerHeight || document.documentElement.clientHeight || 900;
    return turns.length > 0 && turns.length <= 12 && scrollElement.scrollHeight > viewport * 4;
  }

  function isConversationPath() {
    return /^\/(?:c|share)\//.test(location.pathname);
  }

  function setStatus(name, reason, turns, optimizedCount = 0, protectedCount = 0) {
    const mountedCount = turns.length;
    currentStatus = {
      name,
      reason,
      mountedTurns: mountedCount,
      optimizedTurns: optimizedCount,
      protectedTurns: protectedCount,
      updatedAt: new Date().toISOString(),
      version: VERSION,
      versionName: VERSION_NAME,
      label: formatStatusLabel(name, mountedCount, optimizedCount)
    };
    globalThis.__MICA_LONG_THREAD_STATUS__ = currentStatus;
    if (globalThis.window) {
      globalThis.window.__MICA_LONG_THREAD_STATUS__ = currentStatus;
    }
    document.documentElement.dataset.micaStatus = name;
    document.documentElement.dataset.micaMountedTurns = String(mountedCount);
    document.documentElement.dataset.micaOptimizedTurns = String(optimizedCount);
    delete document.documentElement.dataset.micaTurns;
    renderBadge();
  }

  function formatStatusLabel(name, mountedCount, optimizedCount) {
    if (name === STATUS.DISABLED) return "Mica · Disabled";
    if (name === STATUS.ACTIVE) return `Mica · Active · ${mountedCount} mounted · ${optimizedCount} optimized`;
    return `Mica · ${name} · ${mountedCount} mounted`;
  }

  function recordMutations(mutations) {
    globalCounters.mutations += mutations.length;
    for (const mutation of mutations) {
      globalCounters.addedNodes += mutation.addedNodes?.length || 0;
      globalCounters.removedNodes += mutation.removedNodes?.length || 0;
    }
  }

  function processKnownInterruptions() {
    const api = globalThis.MicaKnownInterruptions;
    if (!api || typeof api.scan !== "function") return;
    api.scan({
      enabled: settings.enabled && settings.autoDismissKnownInterruptions,
      onDismiss: ({ ruleId }) => {
        globalCounters.knownInterruptionDismissals += 1;
        globalCounters.lastKnownInterruptionRuleId = ruleId;
        globalCounters.knownInterruptionDismissalsByRule[ruleId] = (globalCounters.knownInterruptionDismissalsByRule[ruleId] || 0) + 1;
      }
    });
  }

  function createDiagnosticsState() {
    return {
      running: false,
      startedAt: null,
      stoppedAt: null,
      baseline: null,
      longTaskObserver: null,
      longTasks: {
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0
      },
      frames: {
        count: 0,
        stallCount: 0,
        maxFrameGapMs: 0,
        lastFrameAt: 0,
        rafId: 0
      },
      scroll: {
        samples: 0,
        lastAt: 0
      }
    };
  }

  function startDiagnostics() {
    stopDiagnostics();
    diagnostics = createDiagnosticsState();
    diagnostics.running = true;
    diagnostics.startedAt = Date.now();
    diagnostics.baseline = snapshotCounters();
    startLongTaskObserver();
    diagnostics.frames.rafId = requestAnimationFrame(sampleFrame);
  }

  function stopDiagnostics() {
    if (diagnostics.longTaskObserver) {
      diagnostics.longTaskObserver.disconnect();
      diagnostics.longTaskObserver = null;
    }
    if (diagnostics.frames.rafId) {
      cancelAnimationFrame(diagnostics.frames.rafId);
      diagnostics.frames.rafId = 0;
    }
    if (diagnostics.running) {
      diagnostics.running = false;
      diagnostics.stoppedAt = Date.now();
    }
  }

  function resetDiagnostics() {
    stopDiagnostics();
    diagnostics = createDiagnosticsState();
  }

  function startLongTaskObserver() {
    if (typeof PerformanceObserver === "undefined") return;
    const supported = PerformanceObserver.supportedEntryTypes || [];
    if (!supported.includes("longtask")) return;
    try {
      diagnostics.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Math.round(entry.duration * 10) / 10;
          diagnostics.longTasks.count += 1;
          diagnostics.longTasks.totalDurationMs += duration;
          diagnostics.longTasks.maxDurationMs = Math.max(diagnostics.longTasks.maxDurationMs, duration);
        }
      });
      diagnostics.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch (_error) {
      diagnostics.longTaskObserver = null;
    }
  }

  function sampleFrame(timestamp) {
    if (!diagnostics.running) return;
    if (diagnostics.frames.lastFrameAt > 0) {
      const gap = timestamp - diagnostics.frames.lastFrameAt;
      diagnostics.frames.count += 1;
      diagnostics.frames.maxFrameGapMs = Math.max(diagnostics.frames.maxFrameGapMs, Math.round(gap * 10) / 10);
      if (gap >= FRAME_STALL_MS) diagnostics.frames.stallCount += 1;
    }
    diagnostics.frames.lastFrameAt = timestamp;
    diagnostics.frames.rafId = requestAnimationFrame(sampleFrame);
  }

  function recordScrollSample() {
    if (!diagnostics.running) return;
    diagnostics.scroll.samples += 1;
    diagnostics.scroll.lastAt = Date.now();
  }

  function snapshotCounters() {
    return {
      mutations: globalCounters.mutations,
      addedNodes: globalCounters.addedNodes,
      removedNodes: globalCounters.removedNodes,
      turnMounts: globalCounters.turnMounts,
      turnUnmounts: globalCounters.turnUnmounts,
      turnSamples: globalCounters.turnSamples,
      knownInterruptionDismissals: globalCounters.knownInterruptionDismissals,
      knownInterruptionDismissalsByRule: { ...globalCounters.knownInterruptionDismissalsByRule },
      lastKnownInterruptionRuleId: globalCounters.lastKnownInterruptionRuleId,
      domNodes: countDomNodes()
    };
  }

  function summarizeDiagnostics() {
    const durationMs = getDiagnosticsDuration();
    return {
      running: diagnostics.running,
      durationMs,
      longTaskCount: diagnostics.longTasks.count,
      frameStallCount: diagnostics.frames.stallCount,
      maxFrameGapMs: diagnostics.frames.maxFrameGapMs
    };
  }

  function buildDiagnosticsReport() {
    const turns = collectConversationTurns();
    const durationMs = getDiagnosticsDuration();
    const baseline = diagnostics.baseline || snapshotCounters();
    const current = snapshotCounters();
    const durationSeconds = durationMs > 0 ? durationMs / 1000 : 0;
    const mutationDelta = Math.max(0, current.mutations - baseline.mutations);
    const mountDelta = Math.max(0, current.turnMounts - baseline.turnMounts);
    const unmountDelta = Math.max(0, current.turnUnmounts - baseline.turnUnmounts);
    const interruptionDismissalDelta = Math.max(0, current.knownInterruptionDismissals - baseline.knownInterruptionDismissals);
    const frameCount = diagnostics.frames.count;

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      privacy: {
        localOnly: true,
        telemetryUploaded: false,
        conversationTextIncluded: false,
        attachmentContentIncluded: false
      },
      extension: {
        name: "Mica for ChatGPT",
        version: VERSION,
        versionName: VERSION_NAME
      },
      page: {
        origin: location.origin,
        pathKind: getPathKind(),
        uptimeMs: Date.now() - bootTime
      },
      status: {
        name: currentStatus.name,
        reason: currentStatus.reason,
        mountedTurns: currentStatus.mountedTurns,
        optimizedTurns: currentStatus.optimizedTurns
      },
      diagnostics: {
        running: diagnostics.running,
        startedAt: diagnostics.startedAt ? new Date(diagnostics.startedAt).toISOString() : null,
        stoppedAt: diagnostics.stoppedAt ? new Date(diagnostics.stoppedAt).toISOString() : null,
        durationMs
      },
      mountedTurns: {
        current: turns.length,
        lastObserved: turnWindow.lastMountedCount
      },
      turnChurn: {
        mounts: mountDelta,
        unmounts: unmountDelta,
        mountRatePerMinute: ratePerMinute(mountDelta, durationSeconds),
        unmountRatePerMinute: ratePerMinute(unmountDelta, durationSeconds)
      },
      dom: {
        nodes: current.domNodes,
        nodeDelta: current.domNodes - baseline.domNodes
      },
      mutations: {
        count: mutationDelta,
        addedNodes: Math.max(0, current.addedNodes - baseline.addedNodes),
        removedNodes: Math.max(0, current.removedNodes - baseline.removedNodes),
        ratePerSecond: durationSeconds > 0 ? round(mutationDelta / durationSeconds) : 0
      },
      longTasks: {
        supported: isLongTaskSupported(),
        count: diagnostics.longTasks.count,
        totalDurationMs: round(diagnostics.longTasks.totalDurationMs),
        maxDurationMs: round(diagnostics.longTasks.maxDurationMs)
      },
      frames: {
        sampledFrames: frameCount,
        stallThresholdMs: FRAME_STALL_MS,
        stallCount: diagnostics.frames.stallCount,
        maxFrameGapMs: diagnostics.frames.maxFrameGapMs,
        jankRatio: frameCount > 0 ? round(diagnostics.frames.stallCount / frameCount) : null,
        scrollSamples: diagnostics.scroll.samples
      },
      memory: getMemorySnapshot(),
      knownInterruptions: {
        dismissals: interruptionDismissalDelta,
        dismissalsByRule: diffRuleCounts(current.knownInterruptionDismissalsByRule, baseline.knownInterruptionDismissalsByRule),
        lastMatchedRuleId: current.lastKnownInterruptionRuleId
      },
      mountedTurnComplexity: measureMountedTurnComplexity(turns)
    };
  }

  function getDiagnosticsDuration() {
    if (!diagnostics.startedAt) return 0;
    const end = diagnostics.running ? Date.now() : diagnostics.stoppedAt || Date.now();
    return Math.max(0, end - diagnostics.startedAt);
  }

  function getPathKind() {
    if (/^\/c\//.test(location.pathname)) return "conversation";
    if (/^\/share\//.test(location.pathname)) return "shared-conversation";
    if (document.documentElement.dataset.micaFixture === "true") return "fixture";
    return "other";
  }

  function countDomNodes() {
    return document.getElementsByTagName("*").length;
  }

  function isLongTaskSupported() {
    return typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes || []).includes("longtask");
  }

  function getMemorySnapshot() {
    const memory = performance?.memory;
    if (!memory) {
      return { supported: false };
    }
    return {
      supported: true,
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit
    };
  }

  function measureMountedTurnComplexity(turns) {
    const counts = turns.map((turn) => turn.getElementsByTagName("*").length).sort((a, b) => a - b);
    if (counts.length === 0) {
      return { count: 0, descendantElements: { min: 0, median: 0, max: 0 } };
    }
    return {
      count: counts.length,
      descendantElements: {
        min: counts[0],
        median: counts[Math.floor(counts.length / 2)],
        max: counts[counts.length - 1]
      }
    };
  }

  function ratePerMinute(count, durationSeconds) {
    return durationSeconds > 0 ? round((count / durationSeconds) * 60) : 0;
  }

  function diffRuleCounts(current, baseline) {
    const result = {};
    for (const [ruleId, count] of Object.entries(current || {})) {
      const delta = count - (baseline?.[ruleId] || 0);
      if (delta > 0) result[ruleId] = delta;
    }
    return result;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function injectStyles() {
    if (document.getElementById("mica-long-thread-style")) return;
    const style = document.createElement("style");
    style.id = "mica-long-thread-style";
    style.textContent = `
.mica-turn-optimized {
  content-visibility: auto !important;
  contain: layout paint style !important;
  contain-intrinsic-size: auto var(--mica-intrinsic-height, 640px) !important;
}
`;
    document.documentElement.appendChild(style);
  }

  function setupBadge() {
    if (badgeHost) return;
    badgeHost = document.createElement("div");
    badgeHost.dataset.micaRoot = "true";
    badgeHost.style.position = "fixed";
    badgeHost.style.right = "12px";
    badgeHost.style.bottom = "12px";
    badgeHost.style.zIndex = "2147483646";
    badgeHost.style.pointerEvents = "auto";
    badgeRoot = badgeHost.attachShadow({ mode: "open" });
    document.documentElement.appendChild(badgeHost);
    renderBadge();
  }

  function renderBadge() {
    if (!badgeRoot) return;
    const hidden = !settings.showStatus;
    badgeHost.hidden = hidden;
    badgeRoot.innerHTML = `
<style>
  :host { all: initial; }
  .mica-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: min(440px, calc(100vw - 24px));
    min-height: 32px;
    padding: 6px 8px 6px 10px;
    border: 1px solid rgba(23, 23, 23, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.94);
    color: #171717;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
    font: 12px/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .mica-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: ${statusColor(currentStatus.name)};
    flex: 0 0 auto;
  }
  .mica-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.06);
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: rgba(0, 0, 0, 0.12); }
  @media (prefers-color-scheme: dark) {
    .mica-badge {
      border-color: rgba(255, 255, 255, 0.18);
      background: rgba(32, 33, 35, 0.94);
      color: #f7f7f8;
    }
    button { background: rgba(255, 255, 255, 0.12); }
    button:hover { background: rgba(255, 255, 255, 0.18); }
  }
</style>
<div class="mica-badge" title="${escapeHtml(currentStatus.reason)}">
  <span class="mica-dot" aria-hidden="true"></span>
  <span class="mica-label">${escapeHtml(currentStatus.label)}</span>
  <button type="button" title="Disable Mica" aria-label="Disable Mica">x</button>
</div>`;
    badgeRoot.querySelector("button")?.addEventListener("click", () => {
      settings = { ...settings, enabled: false };
      writeSettings({ enabled: false }).then(() => scheduleScan());
    });
  }

  function statusColor(name) {
    if (name === STATUS.ACTIVE) return "#16803c";
    if (name === STATUS.NATIVE_VIRTUALIZATION) return "#0f766e";
    if (name === STATUS.NATIVE_ONLY) return "#2563eb";
    if (name === STATUS.DEGRADED) return "#b45309";
    return "#737373";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
