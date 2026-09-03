(() => {
  const VERSION = "0.1.0";
  const VERSION_NAME = "0.1.0-alpha.3";
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
    "[data-testid*='conversation-turn']"
  ].join(",");
  const ROLE_SELECTOR = "[data-message-author-role='user'], [data-message-author-role='assistant'], [data-message-author-role='tool']";
  const COMPOSER_SELECTOR = [
    "[data-testid*='composer']",
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "form"
  ].join(",");
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
  const OVERLAY_MARGIN = 12;
  const OVERLAY_EXPAND_MS = 2600;
  const TOAST_MS = 2800;
  const TOAST_MERGE_MS = 3000;
  const NARROW_VIEWPORT_WIDTH = 720;
  const COMPOSER_PROTECTION_MS = 5000;
  const COMPOSER_PROTECTION_PADDING = 28;
  const COMPOSER_SEND_ACTIVITY_MS = 8000;
  const COMPOSER_EDIT_ACTIVITY_MS = 900;
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
    lastKnownInterruptionRuleId: null,
    knownInterruptionToasts: 0,
    composerProtectionSkips: 0,
    composerMutationBatchesIgnored: 0,
    composerLifecycleMutationBatchesIgnored: 0,
    composerEditScansSkipped: 0,
    overlayPlacements: 0,
    overlayStaticPlacements: 0
  };
  const composerState = {
    currentElement: null,
    currentRoot: null,
    currentRect: null,
    currentAncestors: [],
    lastKnownElement: null,
    lastKnownRoot: null,
    lastKnownRect: null,
    lastKnownAncestors: [],
    lastSeenAt: 0,
    missingSince: 0,
    maxMissingDurationMs: 0,
    seenOnce: false,
    mountCount: 0,
    unmountCount: 0,
    identityChanges: 0,
    currentTextLength: 0,
    visible: false,
    optimizationIntersectionCount: 0,
    optimizationApplyDuringSendCount: 0,
    optimizationRemoveDuringSendCount: 0,
    lastOptimizationIntersection: null,
    submitEvents: 0,
    sendClickEvents: 0,
    sendingUntil: 0,
    editingUntil: 0
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
  let overlayComposerObserver = null;
  let overlayObservedComposer = null;
  let overlayPlacementScheduled = false;
  let scheduled = false;
  let lastUrl = location.href;
  const overlayState = {
    expanded: false,
    expandedByUser: false,
    initializedExpansionShown: false,
    forceCompactForPlacement: false,
    placement: "unplaced",
    expandTimer: 0,
    toastTimer: 0,
    toastVisible: false,
    toastCount: 0,
    lastToastAt: 0
  };

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
    setupFixtureTestHooks();
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
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const target = entry.target;
          if (!(target instanceof HTMLElement)) continue;
          const height = Math.max(80, Math.ceil(entry.borderBoxSize?.[0]?.blockSize || target.getBoundingClientRect().height));
          measuredHeights.set(target, height);
          target.style.setProperty("--mica-intrinsic-height", `${height}px`);
        }
      });
    }

    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver((mutations) => {
        recordMutations(mutations);
        if (areOnlyComposerMutations(mutations)) {
          globalCounters.composerMutationBatchesIgnored += 1;
          updateComposerTextLengthOnly();
          return;
        }
        if (isComposerLifecycleUnstable()) {
          globalCounters.composerLifecycleMutationBatchesIgnored += 1;
          updateComposerTextLengthOnly();
          return;
        }
        processKnownInterruptions();
        scheduleScan();
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    addEventListener("scroll", () => {
      recordScrollSample();
      if (!isComposerLifecycleUnstable()) scheduleScan();
    }, { passive: true, capture: true });
    addEventListener("resize", () => {
      if (!isComposerLifecycleUnstable()) {
        scheduleScan();
        scheduleOverlayPlacement();
      }
    }, { passive: true });
    document.addEventListener("submit", (event) => {
      if (isComposerEventTarget(event.target)) {
        composerState.submitEvents += 1;
        markComposerSendActivity();
      }
    }, true);
    document.addEventListener("beforeinput", (event) => {
      if (isComposerEventTarget(event.target)) markComposerEditActivity();
    }, true);
    document.addEventListener("input", (event) => {
      if (isComposerEventTarget(event.target)) markComposerEditActivity();
    }, true);
    document.addEventListener("cut", (event) => {
      if (isComposerEventTarget(event.target)) markComposerEditActivity();
    }, true);
    document.addEventListener("paste", (event) => {
      if (isComposerEventTarget(event.target)) markComposerEditActivity();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (isComposerEventTarget(event.target) && isEditingKey(event)) markComposerEditActivity();
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button, [role='button']");
      if (button instanceof HTMLElement && isComposerEventTarget(button) && isLikelySendButton(button)) {
        composerState.sendClickEvents += 1;
        markComposerSendActivity();
      }
    }, true);
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        clearOptimization();
        turnWindow.previousKeys = new Set();
      }
      if (!isComposerLifecycleUnstable()) {
        scheduleScan();
        processKnownInterruptions();
        if (shouldPollOverlayPlacement()) scheduleOverlayPlacement();
      }
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
      renderBadge();
    });
  }

  function setupFixtureTestHooks() {
    if (document.documentElement.dataset.micaFixture !== "true") return;
    globalThis.__MICA_TEST_CONTROLS__ = {
      setSettings(next) {
        settings = { ...settings, ...sanitizeSettings(next || {}) };
        renderBadge();
        scheduleScan();
        processKnownInterruptions();
      },
      getSettings() {
        return { ...settings };
      },
      expandStatus() {
        expandOverlay(true);
      },
      forceScan() {
        scanAndApply();
      },
      getDiagnosticsReport() {
        return buildDiagnosticsReport();
      }
    };
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    nextFrame(() => {
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
    if (isComposerEditWindowActive()) {
      globalCounters.composerEditScansSkipped += 1;
      updateComposerTextLengthOnly();
      return;
    }
    updateComposerState();
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

    if (isComposerLifecycleUnstable()) {
      removeUnsafeComposerOptimizations();
      const optimizedCount = countCurrentOptimizedTurns(turns);
      const nativeName = optimizedCount > 0 ? STATUS.ACTIVE : STATUS.NATIVE_ONLY;
      const reason = optimizedCount > 0
        ? "Composer lifecycle is active; existing render containment preserved"
        : "Composer lifecycle is active; render containment changes paused";
      setStatus(nativeName, reason, turns, optimizedCount, 0);
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
        if (applyOptimization(turn)) {
          optimizedCount += 1;
        } else {
          protectedCount += 1;
        }
      } else {
        removeOptimization(turn);
        if (shouldProtect) protectedCount += 1;
      }
    }
    removeUnsafeComposerOptimizations();

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
      }

      if (!(turn instanceof HTMLElement)) continue;
      if (!main.contains(turn)) continue;
      if (turn.offsetParent === null && turn.getClientRects().length === 0) continue;
      if (isComposerProtectedElement(turn)) continue;
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
    const testIdCount = turns.filter((turn) => /conversation-turn/.test(turn.getAttribute("data-testid") || "")).length;
    return roleCount >= 2 || (testIdCount >= Math.min(3, turns.length) && roleCount >= 1);
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
      if (isComposerProtectedElement(turn)) protectedIndexes.add(index);
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
    if (isComposerProtectedElement(turn)) {
      globalCounters.composerProtectionSkips += 1;
      removeOptimization(turn);
      return false;
    }
    const height = measuredHeights.get(turn) || Math.max(240, Math.ceil(turn.getBoundingClientRect().height));
    turn.style.setProperty("--mica-intrinsic-height", `${height}px`);
    turn.classList.add("mica-turn-optimized");
    turn.dataset.micaOptimized = "true";
    optimizedTurns.add(turn);
    if (isComposerSendWindowActive()) composerState.optimizationApplyDuringSendCount += 1;
    return true;
  }

  function removeOptimization(turn) {
    const wasOptimized = optimizedTurns.has(turn);
    turn.classList.remove("mica-turn-optimized");
    delete turn.dataset.micaOptimized;
    optimizedTurns.delete(turn);
    if (wasOptimized && isComposerSendWindowActive()) composerState.optimizationRemoveDuringSendCount += 1;
  }

  function clearOptimization() {
    for (const turn of Array.from(optimizedTurns)) {
      removeOptimization(turn);
    }
  }

  function updateComposerState() {
    const now = Date.now();
    const area = findComposerProtectionArea();

    if (area) {
      if (!composerState.seenOnce) {
        composerState.mountCount += 1;
      } else if (!composerState.currentElement) {
        composerState.mountCount += 1;
      } else if (composerState.currentElement !== area.element) {
        composerState.identityChanges += 1;
      }
      if (composerState.missingSince > 0) {
        composerState.maxMissingDurationMs = Math.max(composerState.maxMissingDurationMs, now - composerState.missingSince);
      }
      composerState.currentElement = area.element;
      composerState.currentRoot = area.root;
      composerState.currentRect = area.rect;
      composerState.currentAncestors = getComposerAncestorChain(area.root);
      composerState.lastKnownElement = area.element;
      composerState.lastKnownRoot = area.root;
      composerState.lastKnownRect = area.rect;
      composerState.lastKnownAncestors = composerState.currentAncestors;
      composerState.lastSeenAt = now;
      composerState.missingSince = 0;
      composerState.seenOnce = true;
      composerState.currentTextLength = getComposerTextLength(area.element);
      composerState.visible = true;
      removeUnsafeComposerOptimizations();
      return;
    }

    if (composerState.currentElement && composerState.missingSince === 0) {
      composerState.unmountCount += 1;
      composerState.missingSince = now;
    }
    if (composerState.missingSince > 0) {
      composerState.maxMissingDurationMs = Math.max(composerState.maxMissingDurationMs, now - composerState.missingSince);
    }
    composerState.currentElement = null;
    composerState.currentRoot = null;
    composerState.currentRect = null;
    composerState.currentAncestors = [];
    composerState.currentTextLength = 0;
    composerState.visible = false;
  }

  function findComposerProtectionArea() {
    const candidates = getComposerProtectionCandidates();
    if (candidates.length === 0) return null;
    const active = document.activeElement instanceof HTMLElement
      ? candidates.find((item) => item.root.contains(document.activeElement) || item.element.contains(document.activeElement))
      : null;
    const chosen = active || candidates.sort((a, b) => b.rect.bottom - a.rect.bottom)[0];
    return { element: chosen.element, root: chosen.root, rect: chosen.rect };
  }

  function getComposerProtectionCandidates() {
    const nodes = Array.from(document.querySelectorAll(COMPOSER_SELECTOR))
      .filter((node) => node instanceof HTMLElement && isVisibleForOverlay(node) && isLikelyComposerNode(node));
    const results = [];
    const seenRoots = new Set();

    for (const node of nodes) {
      const root = chooseComposerContainer(node);
      if (!root || seenRoots.has(root) || root.closest("[data-mica-root='true']")) continue;
      const rect = rectFromDomRect(root.getBoundingClientRect());
      if (!isComposerProtectionRect(rect)) continue;
      const editable = root.querySelector("textarea, input:not([type='hidden']), [contenteditable='true'], [role='textbox']");
      seenRoots.add(root);
      results.push({ element: editable instanceof HTMLElement ? editable : node, root, rect });
    }
    return results;
  }

  function isLikelyComposerNode(node) {
    if (!(node instanceof HTMLElement) || node.closest("[data-mica-root='true']")) return false;
    if (node.matches("textarea, [contenteditable='true'], [role='textbox']")) return true;
    const testId = node.getAttribute("data-testid") || "";
    if (/composer/i.test(testId)) {
      return !!node.querySelector("textarea, [contenteditable='true'], [role='textbox']");
    }
    if (node.matches("form")) {
      return !!node.querySelector("textarea, [contenteditable='true'], [role='textbox']");
    }
    return false;
  }

  function isComposerProtectionRect(rect) {
    return !!rect && rect.width >= 120 && rect.height >= 18 && rect.bottom > 0 && rect.top < (window.innerHeight || document.documentElement.clientHeight || 768);
  }

  function getComposerTextLength(element) {
    if (!element) return 0;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value.length;
    return (element.innerText || element.textContent || "").length;
  }

  function isComposerProtectedElement(element) {
    if (!(element instanceof HTMLElement) || element.closest("[data-mica-root='true']")) return false;
    if (element.matches(COMPOSER_SELECTOR) || element.querySelector(COMPOSER_SELECTOR)) return true;

    const protectedNodes = [
      composerState.currentElement,
      composerState.currentRoot,
      isRecentComposerProtectionActive() ? composerState.lastKnownElement : null,
      isRecentComposerProtectionActive() ? composerState.lastKnownRoot : null
    ]
      .concat(composerState.currentAncestors || [])
      .concat(isRecentComposerProtectionActive() ? composerState.lastKnownAncestors || [] : [])
      .filter((node) => node instanceof HTMLElement);

    for (const node of protectedNodes) {
      if (element === node || element.contains(node) || node.contains(element)) return true;
    }

    const rect = getRecentComposerProtectedRect();
    if (!rect) return false;
    return intersects(rectFromDomRect(element.getBoundingClientRect()), rect);
  }

  function getRecentComposerProtectedRect() {
    const rect = composerState.currentRect || (isRecentComposerProtectionActive() ? composerState.lastKnownRect : null);
    if (!rect) return null;
    return expandRect(rect, COMPOSER_PROTECTION_PADDING);
  }

  function isRecentComposerProtectionActive() {
    if (!composerState.lastSeenAt) return false;
    return Date.now() - composerState.lastSeenAt <= COMPOSER_PROTECTION_MS;
  }

  function removeUnsafeComposerOptimizations() {
    for (const turn of Array.from(optimizedTurns)) {
      if (!isComposerProtectedElement(turn)) continue;
      composerState.optimizationIntersectionCount += 1;
      composerState.lastOptimizationIntersection = describeElementForDiagnostics(turn);
      removeOptimization(turn);
    }
  }

  function isComposerEventTarget(target) {
    const element = target instanceof HTMLElement ? target : null;
    if (!element || element.closest("[data-mica-root='true']")) return false;
    if (element.matches(COMPOSER_SELECTOR) || element.closest(COMPOSER_SELECTOR)) return true;
    if (composerState.currentRoot && composerState.currentRoot.contains(element)) return true;
    if (composerState.lastKnownRoot && isRecentComposerProtectionActive() && composerState.lastKnownRoot.contains(element)) return true;
    return false;
  }

  function getComposerAncestorChain(root) {
    const chain = [];
    let current = root;
    for (let depth = 0; depth < 5 && current instanceof HTMLElement; depth += 1) {
      if (current.matches("main, body, html")) break;
      chain.push(current);
      current = current.parentElement;
    }
    return chain;
  }

  function isLikelySendButton(button) {
    const text = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`;
    const testId = button.getAttribute("data-testid") || "";
    return /send|submit|发送|提交/i.test(text) || /send|submit/i.test(testId);
  }

  function markComposerSendActivity() {
    composerState.sendingUntil = Math.max(composerState.sendingUntil, Date.now() + COMPOSER_SEND_ACTIVITY_MS);
  }

  function markComposerEditActivity() {
    composerState.editingUntil = Math.max(composerState.editingUntil, Date.now() + COMPOSER_EDIT_ACTIVITY_MS);
  }

  function isComposerEditWindowActive() {
    return Date.now() <= composerState.editingUntil;
  }

  function isComposerSendWindowActive() {
    return Date.now() <= composerState.sendingUntil;
  }

  function isComposerLifecycleUnstable() {
    return isComposerEditWindowActive() || isComposerSendWindowActive() || (!!composerState.seenOnce && !composerState.currentElement && isRecentComposerProtectionActive());
  }

  function isEditingKey(event) {
    if (!event) return false;
    return event.key === "Backspace" || event.key === "Delete" || event.key === "Enter" || event.key.length === 1;
  }

  function countCurrentOptimizedTurns(turns) {
    return turns.reduce((count, turn) => count + (optimizedTurns.has(turn) ? 1 : 0), 0);
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
    const previousName = currentStatus.name;
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
    maybeExpandForStatus(previousName, name);
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

  function areOnlyComposerMutations(mutations) {
    if (!mutations || mutations.length === 0) return false;
    return mutations.every((mutation) => isComposerMutation(mutation));
  }

  function isComposerMutation(mutation) {
    if (!mutation) return false;
    if (isComposerMutationNode(mutation.target)) return true;
    for (const node of Array.from(mutation.addedNodes || [])) {
      if (isComposerMutationNode(node)) return true;
    }
    for (const node of Array.from(mutation.removedNodes || [])) {
      if (isComposerMutationNode(node)) return true;
    }
    return false;
  }

  function isComposerMutationNode(node) {
    const element = getMutationElement(node);
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest("[data-mica-root='true']")) return false;
    if (element.matches(COMPOSER_SELECTOR) || element.closest(COMPOSER_SELECTOR)) return true;
    if (node instanceof HTMLElement && node.querySelector?.(COMPOSER_SELECTOR)) return true;
    if (composerState.currentRoot && (element === composerState.currentRoot || composerState.currentRoot.contains(element) || element.contains(composerState.currentRoot))) return true;
    if (composerState.lastKnownRoot && isRecentComposerProtectionActive() && (element === composerState.lastKnownRoot || composerState.lastKnownRoot.contains(element) || element.contains(composerState.lastKnownRoot))) return true;
    return false;
  }

  function getMutationElement(node) {
    if (node instanceof HTMLElement) return node;
    if (node instanceof Element) return node.closest("*");
    if (node instanceof CharacterData) return node.parentElement;
    return null;
  }

  function updateComposerTextLengthOnly() {
    const element = composerState.currentElement;
    if (element instanceof HTMLElement && element.isConnected) {
      composerState.currentTextLength = getComposerTextLength(element);
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
        showKnownInterruptionToast();
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
    if (typeof requestAnimationFrame === "function") {
      diagnostics.frames.rafId = requestAnimationFrame(sampleFrame);
    }
  }

  function stopDiagnostics() {
    if (diagnostics.longTaskObserver) {
      diagnostics.longTaskObserver.disconnect();
      diagnostics.longTaskObserver = null;
    }
    if (diagnostics.frames.rafId && typeof cancelAnimationFrame === "function") {
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
    diagnostics.frames.rafId = typeof requestAnimationFrame === "function" ? requestAnimationFrame(sampleFrame) : 0;
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
      knownInterruptionToasts: globalCounters.knownInterruptionToasts,
      composerProtectionSkips: globalCounters.composerProtectionSkips,
      composerMutationBatchesIgnored: globalCounters.composerMutationBatchesIgnored,
      composerLifecycleMutationBatchesIgnored: globalCounters.composerLifecycleMutationBatchesIgnored,
      composerEditScansSkipped: globalCounters.composerEditScansSkipped,
      overlayPlacements: globalCounters.overlayPlacements,
      overlayStaticPlacements: globalCounters.overlayStaticPlacements,
      composer: snapshotComposerState(),
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
      overlay: {
        placement: overlayState.placement,
        mode: getOverlayMode(),
        toastVisible: overlayState.toastVisible,
        toastCount: overlayState.toastCount,
        toastEvents: current.knownInterruptionToasts,
        placements: Math.max(0, current.overlayPlacements - (baseline.overlayPlacements || 0)),
        staticPlacements: Math.max(0, current.overlayStaticPlacements - (baseline.overlayStaticPlacements || 0))
      },
      composer: {
        exists: current.composer.exists,
        visible: current.composer.visible,
        textLength: current.composer.textLength,
        mountCount: current.composer.mountCount,
        unmountCount: current.composer.unmountCount,
        identityChanges: current.composer.identityChanges,
        maxMissingDurationMs: current.composer.maxMissingDurationMs,
        submitEvents: current.composer.submitEvents,
        sendClickEvents: current.composer.sendClickEvents,
        optimizationIntersections: current.composer.optimizationIntersectionCount,
        lastOptimizationIntersection: current.composer.lastOptimizationIntersection,
        optimizationChangesPaused: isComposerLifecycleUnstable(),
        protectionSkips: Math.max(0, current.composerProtectionSkips - (baseline.composerProtectionSkips || 0)),
        mutationBatchesIgnored: Math.max(0, current.composerMutationBatchesIgnored - (baseline.composerMutationBatchesIgnored || 0)),
        lifecycleMutationBatchesIgnored: Math.max(0, current.composerLifecycleMutationBatchesIgnored - (baseline.composerLifecycleMutationBatchesIgnored || 0)),
        editScansSkipped: Math.max(0, current.composerEditScansSkipped - (baseline.composerEditScansSkipped || 0)),
        optimizationApplyDuringSend: Math.max(0, current.composer.optimizationApplyDuringSendCount - (baseline.composer?.optimizationApplyDuringSendCount || 0)),
        optimizationRemoveDuringSend: Math.max(0, current.composer.optimizationRemoveDuringSendCount - (baseline.composer?.optimizationRemoveDuringSendCount || 0))
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

  function snapshotComposerState() {
    updateComposerState();
    return {
      exists: !!composerState.currentElement,
      visible: composerState.visible,
      textLength: composerState.currentTextLength,
      mountCount: composerState.mountCount,
      unmountCount: composerState.unmountCount,
      identityChanges: composerState.identityChanges,
      maxMissingDurationMs: Math.round(composerState.maxMissingDurationMs),
      submitEvents: composerState.submitEvents,
      sendClickEvents: composerState.sendClickEvents,
      optimizationIntersectionCount: composerState.optimizationIntersectionCount,
      lastOptimizationIntersection: composerState.lastOptimizationIntersection,
      optimizationApplyDuringSendCount: composerState.optimizationApplyDuringSendCount,
      optimizationRemoveDuringSendCount: composerState.optimizationRemoveDuringSendCount
    };
  }

  function describeElementForDiagnostics(element) {
    if (!(element instanceof HTMLElement)) return null;
    return {
      tagName: element.tagName.toLowerCase(),
      testId: element.getAttribute("data-testid") || null,
      role: element.getAttribute("role") || null,
      messageRole: element.getAttribute("data-message-author-role") || element.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role") || null
    };
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

  function nextFrame(callback) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(callback);
      return;
    }
    setTimeout(callback, 16);
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
    badgeHost.style.left = "0";
    badgeHost.style.top = "0";
    badgeHost.style.zIndex = "2147483646";
    badgeHost.style.pointerEvents = "none";
    badgeRoot = badgeHost.attachShadow({ mode: "open" });
    document.documentElement.appendChild(badgeHost);
    renderBadge();
  }

  function renderBadge() {
    if (!badgeRoot) return;
    const statusVisible = !!settings.showStatus;
    const expanded = statusVisible && shouldShowExpandedStatus();
    const toastVisible = overlayState.toastVisible;
    badgeHost.hidden = !statusVisible && !toastVisible;
    badgeRoot.innerHTML = `
<style>
  :host { all: initial; }
  .mica-overlay {
    display: grid;
    justify-items: end;
    gap: 8px;
    max-width: min(360px, calc(100vw - ${OVERLAY_MARGIN * 2}px));
    pointer-events: none;
  }
  .mica-status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid rgba(23, 23, 23, 0.18);
    background: rgba(255, 255, 255, 0.94);
    color: #171717;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.12);
    font: 12px/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
    transition: opacity 140ms ease, transform 140ms ease, width 140ms ease;
  }
  .mica-status.compact {
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 999px;
    opacity: 0.58;
  }
  .mica-status.expanded {
    min-height: 32px;
    max-width: min(360px, calc(100vw - ${OVERLAY_MARGIN * 2}px));
    padding: 6px 9px;
    border-radius: 8px;
    opacity: 0.96;
  }
  .mica-status:hover,
  .mica-status:focus-visible {
    opacity: 1;
  }
  .mica-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: ${statusColor(currentStatus.name)};
    flex: 0 0 auto;
    box-shadow: 0 0 0 3px ${statusGlowColor(currentStatus.name)};
  }
  .mica-label {
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .compact .mica-label {
    display: none;
  }
  button {
    appearance: none;
    border: 0;
    cursor: pointer;
    font: inherit;
  }
  .mica-toast {
    max-width: min(320px, calc(100vw - ${OVERLAY_MARGIN * 2}px));
    padding: 8px 10px;
    border: 1px solid rgba(23, 23, 23, 0.14);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.96);
    color: #171717;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
    font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
  }
  .mica-hidden {
    display: none;
  }
  @media (prefers-color-scheme: dark) {
    .mica-status,
    .mica-toast {
      border-color: rgba(255, 255, 255, 0.18);
      background: rgba(32, 33, 35, 0.94);
      color: #f7f7f8;
    }
  }
</style>
<div id="mica-overlay" class="mica-overlay" data-placement="${escapeHtml(overlayState.placement)}">
  <button class="mica-status ${expanded ? "expanded" : "compact"}${statusVisible ? "" : " mica-hidden"}" type="button" title="${escapeHtml(getCompactTooltip())}" aria-label="Mica status">
    <span class="mica-dot" aria-hidden="true"></span>
    <span class="mica-label">${escapeHtml(formatExpandedStatusLabel(currentStatus.name, currentStatus.mountedTurns, currentStatus.optimizedTurns))}</span>
  </button>
  <div class="mica-toast${toastVisible ? "" : " mica-hidden"}" role="status" aria-live="polite">${escapeHtml(getToastText())}</div>
</div>`;
    badgeRoot.querySelector(".mica-status")?.addEventListener("click", () => {
      expandOverlay(true);
    });
    scheduleOverlayPlacement();
  }

  function maybeExpandForStatus(previousName, nextName) {
    if (!settings.showStatus) return;
    const width = window.innerWidth || document.documentElement.clientWidth || 1024;
    if (!overlayState.initializedExpansionShown) {
      overlayState.initializedExpansionShown = true;
      if (width >= NARROW_VIEWPORT_WIDTH || nextName === STATUS.DEGRADED) expandOverlay(false);
      return;
    }
    if (previousName === nextName) return;
    if (width < NARROW_VIEWPORT_WIDTH && nextName !== STATUS.DEGRADED) return;
    if (previousName === STATUS.NATIVE_ONLY && nextName === STATUS.NATIVE_VIRTUALIZATION) expandOverlay(false);
    if (nextName === STATUS.ACTIVE || nextName === STATUS.DEGRADED) expandOverlay(false);
  }

  function expandOverlay(byUser) {
    overlayState.expanded = true;
    overlayState.expandedByUser = !!byUser;
    overlayState.forceCompactForPlacement = false;
    clearTimeout(overlayState.expandTimer);
    overlayState.expandTimer = setTimeout(() => {
      overlayState.expanded = false;
      overlayState.expandedByUser = false;
      overlayState.forceCompactForPlacement = false;
      renderBadge();
    }, OVERLAY_EXPAND_MS);
    renderBadge();
  }

  function shouldShowExpandedStatus() {
    if (overlayState.forceCompactForPlacement) return false;
    if (!overlayState.expanded) return false;
    const width = window.innerWidth || document.documentElement.clientWidth || 1024;
    return overlayState.expandedByUser || width >= NARROW_VIEWPORT_WIDTH || currentStatus.name === STATUS.DEGRADED;
  }

  function showKnownInterruptionToast() {
    const now = Date.now();
    const shouldMerge = overlayState.toastVisible && now - overlayState.lastToastAt <= TOAST_MERGE_MS;
    overlayState.toastCount = shouldMerge ? overlayState.toastCount + 1 : 1;
    overlayState.lastToastAt = now;
    overlayState.toastVisible = true;
    globalCounters.knownInterruptionToasts += 1;
    clearTimeout(overlayState.toastTimer);
    overlayState.toastTimer = setTimeout(() => {
      overlayState.toastVisible = false;
      overlayState.toastCount = 0;
      renderBadge();
    }, TOAST_MS);
    renderBadge();
  }

  function getToastText() {
    if (overlayState.toastCount > 1) {
      return `Mica 已自动关闭 ${overlayState.toastCount} 个已知提示`;
    }
    return "Mica 已自动关闭一个已知提示";
  }

  function getOverlayMode() {
    if (shouldShowExpandedStatus()) return "expanded";
    return "compact";
  }

  function formatExpandedStatusLabel(name, mountedCount, optimizedCount) {
    if (name === STATUS.DISABLED) return "Disabled";
    if (name === STATUS.ACTIVE) return `Active · ${mountedCount} mounted · ${optimizedCount} optimized`;
    return `${name} · ${mountedCount} mounted`;
  }

  function getCompactTooltip() {
    return `Mica: ${formatExpandedStatusLabel(currentStatus.name, currentStatus.mountedTurns, currentStatus.optimizedTurns)}. Click for details.`;
  }

  function scheduleOverlayPlacement() {
    if (!badgeHost || badgeHost.hidden || overlayPlacementScheduled) return;
    overlayPlacementScheduled = true;
    nextFrame(() => {
      overlayPlacementScheduled = false;
      placeOverlay();
    });
  }

  function placeOverlay() {
    if (!badgeRoot || !badgeHost || badgeHost.hidden) return;
    const overlay = badgeRoot.getElementById("mica-overlay");
    if (!overlay) return;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    let size = measureOverlay(overlay);
    if (shouldUseStaticOverlayPlacement()) {
      disconnectOverlayComposerObserver();
      const placement = clampPlacement({
        name: "top-right-static",
        x: viewportWidth - size.width - OVERLAY_MARGIN,
        y: OVERLAY_MARGIN
      }, size, viewportWidth, viewportHeight);
      applyOverlayPlacement(placement.name, placement, size, null);
      globalCounters.overlayStaticPlacements += 1;
      return;
    }

    updateComposerState();
    observeComposerForOverlay();
    const composer = findComposerArea();
    let placement = chooseOverlayPlacement(size, composer?.rect, viewportWidth, viewportHeight);
    if (placement.collides && shouldShowExpandedStatus()) {
      overlayState.forceCompactForPlacement = true;
      renderBadge();
      return;
    }
    applyOverlayPlacement(placement.name, placement, size, composer?.rect || null);
  }

  function shouldUseStaticOverlayPlacement() {
    return isComposerEditWindowActive() || (!overlayState.toastVisible && !shouldShowExpandedStatus());
  }

  function shouldPollOverlayPlacement() {
    return overlayState.toastVisible || shouldShowExpandedStatus() || currentStatus.name === STATUS.DEGRADED;
  }

  function applyOverlayPlacement(name, placement, size, composerRect) {
    badgeHost.style.transform = `translate(${placement.x}px, ${placement.y}px)`;
    overlayState.placement = name;
    globalCounters.overlayPlacements += 1;
    const placedRect = {
      left: placement.x,
      top: placement.y,
      right: placement.x + size.width,
      bottom: placement.y + size.height,
      width: size.width,
      height: size.height
    };
    globalThis.__MICA_OVERLAY_DEBUG__ = {
      placement: placement.name,
      mode: getOverlayMode(),
      toastVisible: overlayState.toastVisible,
      toastCount: overlayState.toastCount,
      rect: placedRect,
      composerRect,
      intersectsComposer: composerRect ? intersects(placedRect, composerRect) : false
    };
  }

  function measureOverlay(overlay) {
    const rect = overlay.getBoundingClientRect();
    return {
      width: Math.max(26, Math.ceil(rect.width)),
      height: Math.max(26, Math.ceil(rect.height))
    };
  }

  function chooseOverlayPlacement(size, composerRect, viewportWidth, viewportHeight) {
    const candidates = [
      {
        name: "bottom-right",
        x: viewportWidth - size.width - OVERLAY_MARGIN,
        y: viewportHeight - size.height - OVERLAY_MARGIN
      }
    ];
    if (composerRect) {
      candidates.push({
        name: "right-above-composer",
        x: viewportWidth - size.width - OVERLAY_MARGIN,
        y: composerRect.top - size.height - OVERLAY_MARGIN
      });
    }
    candidates.push(
      {
        name: "bottom-left",
        x: OVERLAY_MARGIN,
        y: viewportHeight - size.height - OVERLAY_MARGIN
      },
      {
        name: "top-right",
        x: viewportWidth - size.width - OVERLAY_MARGIN,
        y: OVERLAY_MARGIN
      },
      {
        name: "top-left",
        x: OVERLAY_MARGIN,
        y: OVERLAY_MARGIN
      }
    );

    for (const candidate of candidates) {
      const placed = clampPlacement(candidate, size, viewportWidth, viewportHeight);
      const rect = {
        left: placed.x,
        top: placed.y,
        right: placed.x + size.width,
        bottom: placed.y + size.height
      };
      if (!composerRect || !intersects(rect, composerRect)) {
        return { ...placed, name: candidate.name, collides: false };
      }
    }
    const fallback = clampPlacement(candidates[candidates.length - 2], size, viewportWidth, viewportHeight);
    return { ...fallback, name: "top-right", collides: composerRect ? intersects({
      left: fallback.x,
      top: fallback.y,
      right: fallback.x + size.width,
      bottom: fallback.y + size.height
    }, composerRect) : false };
  }

  function clampPlacement(candidate, size, viewportWidth, viewportHeight) {
    return {
      x: clamp(candidate.x, OVERLAY_MARGIN, Math.max(OVERLAY_MARGIN, viewportWidth - size.width - OVERLAY_MARGIN)),
      y: clamp(candidate.y, OVERLAY_MARGIN, Math.max(OVERLAY_MARGIN, viewportHeight - size.height - OVERLAY_MARGIN))
    };
  }

  function observeComposerForOverlay() {
    if (typeof ResizeObserver === "undefined") return;
    if (shouldUseStaticOverlayPlacement()) {
      disconnectOverlayComposerObserver();
      return;
    }
    const composer = findComposerArea()?.element || null;
    if (!composer || composer === overlayObservedComposer) return;
    if (!overlayComposerObserver) {
      overlayComposerObserver = new ResizeObserver(() => scheduleOverlayPlacement());
    }
    if (overlayObservedComposer) overlayComposerObserver.unobserve(overlayObservedComposer);
    overlayObservedComposer = composer;
    overlayComposerObserver.observe(composer);
  }

  function disconnectOverlayComposerObserver() {
    if (overlayObservedComposer && overlayComposerObserver) {
      overlayComposerObserver.unobserve(overlayObservedComposer);
    }
    overlayObservedComposer = null;
  }

  function findComposerArea() {
    const candidates = getComposerCandidates();
    if (candidates.length === 0) return null;
    const rects = candidates.map((item) => item.rect);
    const rect = unionRects(rects);
    const element = candidates[0].element;
    return rect ? { element, rect } : null;
  }

  function getComposerCandidates() {
    const nodes = Array.from(document.querySelectorAll([
      "[data-testid*='composer']",
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']",
      "form"
    ].join(","))).filter((node) => node instanceof HTMLElement && isVisibleForOverlay(node));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
    const results = [];
    const seen = new Set();

    for (const node of nodes) {
      const composer = chooseComposerContainer(node);
      if (!composer || seen.has(composer)) continue;
      seen.add(composer);
      const rect = rectFromDomRect(composer.getBoundingClientRect());
      if (!isComposerLikeRect(rect, viewportHeight)) continue;
      results.push({ element: composer, rect });
    }
    return results;
  }

  function chooseComposerContainer(node) {
    const testIdComposer = node.closest("[data-testid*='composer']");
    if (testIdComposer instanceof HTMLElement) return testIdComposer;
    const form = node.closest("form");
    if (form instanceof HTMLElement) return form;
    let current = node;
    for (let depth = 0; depth < 4 && current?.parentElement; depth += 1) {
      const parent = current.parentElement;
      const rect = parent.getBoundingClientRect();
      if (rect.width >= node.getBoundingClientRect().width && rect.height <= Math.max(360, node.getBoundingClientRect().height + 160)) {
        current = parent;
      }
    }
    return current;
  }

  function isComposerLikeRect(rect, viewportHeight) {
    if (!rect || rect.width < 180 || rect.height < 24) return false;
    if (rect.bottom < viewportHeight * 0.45) return false;
    if (rect.top > viewportHeight || rect.bottom < 0) return false;
    return rect.height <= Math.max(380, viewportHeight * 0.7);
  }

  function unionRects(rects) {
    if (rects.length === 0) return null;
    return {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
      width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
      height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top))
    };
  }

  function expandRect(rect, padding) {
    return {
      left: rect.left - padding,
      top: rect.top - padding,
      right: rect.right + padding,
      bottom: rect.bottom + padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2
    };
  }

  function rectFromDomRect(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function isVisibleForOverlay(element) {
    if (element.closest("[data-mica-root='true']")) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function statusColor(name) {
    if (name === STATUS.ACTIVE) return "#16803c";
    if (name === STATUS.NATIVE_VIRTUALIZATION) return "#0f766e";
    if (name === STATUS.NATIVE_ONLY) return "#2563eb";
    if (name === STATUS.DEGRADED) return "#b45309";
    return "#737373";
  }

  function statusGlowColor(name) {
    if (name === STATUS.ACTIVE) return "rgba(22, 128, 60, 0.16)";
    if (name === STATUS.NATIVE_VIRTUALIZATION) return "rgba(15, 118, 110, 0.16)";
    if (name === STATUS.NATIVE_ONLY) return "rgba(37, 99, 235, 0.16)";
    if (name === STATUS.DEGRADED) return "rgba(180, 83, 9, 0.18)";
    return "rgba(115, 115, 115, 0.16)";
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
