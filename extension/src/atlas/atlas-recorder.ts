(() => {
  const SCHEMA_VERSION = 1;
  const MAX_EVENTS = 2400;
  const MAX_PERFORMANCE_ENTRIES = 80;
  const MAX_MUTATION_BURSTS = 220;
  const MUTATION_FLUSH_MS = 120;
  const SETTLED_IDLE_MS = 1800;
  const ASSISTANT_SETTLED_HARD_CAP_MS = 18000;
  const TURN_SELECTOR = "[data-message-author-role], [data-testid^='conversation-turn-'], [data-testid*='conversation-turn']";
  const ROLE_SELECTOR = "[data-message-author-role='user'], [data-message-author-role='assistant'], [data-message-author-role='tool']";
  const COMPOSER_SELECTOR = "[data-testid*='composer'], textarea, [contenteditable], [role='textbox'], form";
  const CHECKPOINT_PREFIX = "MICA_ATLAS_CHECKPOINT ";
  const ALLOWED_TEXT_LABELS = new Set(["Copy", "Retry", "Stop", "Continue", "Regenerate"]);

  const state = {
    active: false,
    session: null,
    events: [],
    coverage: createCoverage(),
    observers: [],
    timers: new Set(),
    listeners: [],
    performanceObservers: [],
    mutationQueue: [],
    mutationFlushTimer: 0,
    assistantState: new WeakMap(),
    nodeIds: new WeakMap(),
    nextNodeId: 1,
    epochMs: 0,
    startedAt: 0,
    lastComposerRoot: null,
    lastComposerEditable: null,
    lastComposerSurface: null,
    lastComposerPresent: false,
    lastComposerTextLength: 0,
    lastMountedTurns: 0,
    lastOverlayMode: null,
    lastOverlayRecording: false,
    settledTimer: 0,
    hardSettleTimer: 0,
    performance: createPerformanceSummary(),
    counters: createCounters()
  };

  globalThis.MicaAtlasRecorder = {
    start(options = {}) {
      return start(options);
    },
    stop(reason = "manual") {
      return stop(reason);
    },
    isActive() {
      return state.active;
    },
    recordRuntimeTransition(type, details = {}) {
      if (!state.active) return null;
      return record(type, sanitizeDetails(details));
    },
    recordCopyInvocation(details = {}) {
      if (!state.active) return null;
      markObserved("micaCopy");
      return checkpoint("mica_copy_invoked", sanitizeDetails(details));
    },
    getReport() {
      return buildReport();
    },
    getDebugState() {
      return {
        active: state.active,
        sessionId: state.session?.id || null,
        events: state.events.length,
        observers: state.observers.length,
        listeners: state.listeners.length,
        timers: state.timers.size,
        performanceObservers: state.performanceObservers.length,
        mutationQueue: state.mutationQueue.length,
        coverage: state.coverage,
        counters: { ...state.counters }
      };
    },
    resetForTests() {
      stop("reset");
      resetSessionState();
    }
  };

  function start(options = {}) {
    if (state.active) return summarizeSession("already_active");
    resetSessionState();
    state.active = true;
    state.epochMs = Date.now();
    state.startedAt = now();
    state.session = {
      id: options.sessionId || `atlas-${state.epochMs.toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
      startedAtEpochMs: state.epochMs,
      startedAtMonotonicMs: state.startedAt,
      urlKind: getUrlKind(),
      dedicatedThreadHint: String(options.dedicatedThreadHint || ""),
      safety: safetyFlags()
    };
    setupListeners();
    setupObservers();
    setupPerformanceObservers();
    sampleStructuralState("start");
    checkpoint("atlas_started", { urlKind: state.session.urlKind });
    return summarizeSession("started");
  }

  function stop(reason = "manual") {
    if (!state.active) return summarizeSession("inactive");
    flushMutationQueue();
    record("atlas_stopping", { reason });
    clearTimer(state.mutationFlushTimer);
    clearTimer(state.settledTimer);
    clearTimer(state.hardSettleTimer);
    state.mutationFlushTimer = 0;
    state.settledTimer = 0;
    state.hardSettleTimer = 0;
    for (const entry of state.listeners.splice(0)) entry.target.removeEventListener(entry.type, entry.handler, entry.options);
    for (const observer of state.observers.splice(0)) observer.disconnect();
    for (const observer of state.performanceObservers.splice(0)) {
      try { observer.disconnect(); } catch (_error) {}
    }
    for (const timer of Array.from(state.timers)) clearTimer(timer);
    state.active = false;
    state.session.stoppedAtEpochMs = Date.now();
    state.session.stoppedAtMonotonicMs = now();
    state.session.stopReason = reason;
    record("atlas_stopped", { reason, listenerCount: 0, observerCount: 0, timerCount: 0 });
    return summarizeSession("stopped");
  }

  function resetSessionState() {
    state.events = [];
    state.coverage = createCoverage();
    state.observers = [];
    state.timers = new Set();
    state.listeners = [];
    state.performanceObservers = [];
    state.mutationQueue = [];
    state.assistantState = new WeakMap();
    state.nodeIds = new WeakMap();
    state.nextNodeId = 1;
    state.epochMs = 0;
    state.startedAt = 0;
    state.lastComposerRoot = null;
    state.lastComposerEditable = null;
    state.lastComposerSurface = null;
    state.lastComposerPresent = false;
    state.lastComposerTextLength = 0;
    state.lastMountedTurns = 0;
    state.lastOverlayMode = null;
    state.lastOverlayRecording = false;
    state.performance = createPerformanceSummary();
    state.counters = createCounters();
  }

  function setupListeners() {
    addTrackedListener(document, "focusin", handleFocus, true);
    addTrackedListener(document, "focusout", handleFocus, true);
    addTrackedListener(document, "keydown", handleKeydown, true);
    addTrackedListener(document, "beforeinput", handleInputLike, true);
    addTrackedListener(document, "input", handleInputLike, true);
    addTrackedListener(document, "compositionstart", handleComposition, true);
    addTrackedListener(document, "compositionupdate", handleComposition, true);
    addTrackedListener(document, "compositionend", handleComposition, true);
    addTrackedListener(document, "cut", handleClipboard, true);
    addTrackedListener(document, "paste", handleClipboard, true);
    addTrackedListener(document, "submit", handleSubmit, true);
    addTrackedListener(document, "click", handleClick, true);
  }

  function setupObservers() {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      if (!state.active) return;
      queueMutationSummary(mutations);
      sampleStructuralState("mutation");
      inspectAssistantMutations(mutations);
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-testid", "data-message-author-role", "aria-label", "aria-expanded", "aria-pressed", "contenteditable", "disabled", "data-mica-root"]
    });
    state.observers.push(observer);
    state.counters.observersAttached += 1;
  }

  function setupPerformanceObservers() {
    if (typeof PerformanceObserver === "undefined") return;
    observePerformanceType("event", state.performance.eventTiming, "event");
    observePerformanceType("long-animation-frame", state.performance.longAnimationFrame, "long-animation-frame");
    observePerformanceType("longtask", state.performance.longTask, "longtask");
    observePerformanceType("layout-shift", state.performance.layoutShift, "layout-shift");
    updateMemorySnapshot();
  }

  function observePerformanceType(label, bucket, entryType) {
    try {
      const supported = PerformanceObserver.supportedEntryTypes || [];
      if (!supported.includes(entryType)) return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          appendBounded(bucket, summarizePerformanceEntry(label, entry), MAX_PERFORMANCE_ENTRIES);
          state.counters.performanceEntries += 1;
        }
      });
      observer.observe({ type: entryType, buffered: true });
      state.performanceObservers.push(observer);
    } catch (_error) {
      record("performance_observer_unavailable", { label });
    }
  }

  function handleFocus(event) {
    const target = getEventElement(event.target);
    if (!isComposerRelated(target)) return;
    checkpoint(event.type === "focusin" ? "composer_focus" : "composer_blur", composerSummary());
  }

  function handleKeydown(event) {
    const target = getEventElement(event.target);
    if (!isComposerRelated(target)) return;
    state.counters.inputEvents += 1;
    record("composer_keydown", {
      keyClass: classifyKey(event),
      ctrl: !!event.ctrlKey,
      meta: !!event.metaKey,
      shift: !!event.shiftKey,
      alt: !!event.altKey,
      composing: !!event.isComposing,
      repeat: !!event.repeat
    });
  }

  function handleInputLike(event) {
    const target = getEventElement(event.target);
    if (!isComposerRelated(target)) return;
    state.counters.inputEvents += 1;
    const before = state.lastComposerTextLength;
    state.lastComposerTextLength = textLengthOf(target);
    record(`composer_${event.type}`, {
      inputType: typeof event.inputType === "string" ? event.inputType : null,
      dataLength: typeof event.data === "string" ? event.data.length : 0,
      textLengthBefore: before,
      textLengthAfter: state.lastComposerTextLength,
      delta: state.lastComposerTextLength - before,
      composing: !!event.isComposing
    });
    if (state.lastComposerTextLength === 0 && before > 0) checkpoint("composer_body_zero", composerSummary());
  }

  function handleComposition(event) {
    const target = getEventElement(event.target);
    if (!isComposerRelated(target)) return;
    record(`composer_${event.type}`, { dataLength: typeof event.data === "string" ? event.data.length : 0 });
  }

  function handleClipboard(event) {
    const target = getEventElement(event.target);
    if (!isComposerRelated(target)) return;
    record(`composer_${event.type}`, { textLength: state.lastComposerTextLength });
  }

  function handleSubmit(event) {
    const target = getEventElement(event.target);
    if (!isComposerRelated(target)) return;
    checkpoint("manual_send_intent", { source: "submit", ...composerSummary() });
  }

  function handleClick(event) {
    const target = getEventElement(event.target);
    const button = target?.closest?.("button, [role='button']");
    if (!(button instanceof HTMLElement)) return;
    if (isLikelySendButton(button) && isComposerRelated(button)) {
      checkpoint("manual_send_intent", { source: "send_click", ...composerSummary() });
      return;
    }
    if (isCopyAction(button)) {
      markObserved("nativeCopyArea");
      checkpoint("assistant_copy_action_visible_or_invoked", { source: "click", label: safeLabel(button), rect: rectSummary(button) });
    }
  }

  function sampleStructuralState(reason) {
    const composer = findComposer();
    const present = !!composer.editable || !!composer.root;
    if (present !== state.lastComposerPresent) checkpoint(present ? "composer_present" : "composer_missing", { reason, ...composerSummary(composer) });
    if (present) {
      markObserved("composer");
      const textLength = textLengthOf(composer.editable || composer.root);
      const rootChanged = composer.root && composer.root !== state.lastComposerRoot;
      const editableChanged = composer.editable && composer.editable !== state.lastComposerEditable;
      const surfaceChanged = composer.surface && composer.surface !== state.lastComposerSurface;
      if (rootChanged || editableChanged || surfaceChanged) {
        checkpoint("composer_identity_changed", {
          reason,
          rootId: nodeId(composer.root),
          editableId: nodeId(composer.editable),
          surfaceId: nodeId(composer.surface),
          rootChanged,
          editableChanged,
          surfaceChanged,
          rect: rectSummary(composer.root || composer.editable)
        });
      }
      state.lastComposerRoot = composer.root || null;
      state.lastComposerEditable = composer.editable || null;
      state.lastComposerSurface = composer.surface || null;
      state.lastComposerTextLength = textLength;
    }
    state.lastComposerPresent = present;

    const turns = collectTurns();
    if (turns.length !== state.lastMountedTurns) {
      checkpoint("mounted_turn_window_changed", { reason, mountedTurns: turns.length, previousMountedTurns: state.lastMountedTurns });
      markObserved("longThreadMountedWindow");
      state.lastMountedTurns = turns.length;
    }
    inspectTurns(turns);
    inspectMentionAndConnector();
    inspectOverlay();
  }

  function inspectTurns(turns) {
    for (const turn of turns) {
      const role = getTurnRole(turn);
      if (role === "user") markObserved("userTurn");
      if (role === "assistant") {
        markObserved("assistantStreaming");
        const actionBar = findActionBar(turn);
        if (actionBar) {
          markObserved("assistantActionBar");
          checkpoint("assistant_action_bar_visible", { turnId: nodeId(turn), rect: rectSummary(actionBar), copyAreaVisible: !!actionBar.querySelector?.("[aria-label*='Copy'], [data-testid*='copy']") });
        }
        if (!state.assistantState.has(turn)) {
          state.assistantState.set(turn, { mountedAt: now(), firstMutationAt: 0, settled: false, lastMutationAt: 0 });
          checkpoint("assistant_turn_mounted", { turnId: nodeId(turn), rect: rectSummary(turn) });
        }
      }
    }
  }

  function inspectAssistantMutations(mutations) {
    for (const mutation of mutations) {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
      const turn = target?.closest?.(TURN_SELECTOR);
      if (!(turn instanceof HTMLElement) || getTurnRole(turn) !== "assistant") continue;
      const entry = state.assistantState.get(turn) || { mountedAt: now(), firstMutationAt: 0, settled: false, lastMutationAt: 0 };
      const timestamp = now();
      if (!entry.firstMutationAt) {
        entry.firstMutationAt = timestamp;
        checkpoint("assistant_first_content_mutation", { turnId: nodeId(turn), elapsedFromMountMs: Math.round(timestamp - entry.mountedAt) });
      }
      entry.lastMutationAt = timestamp;
      entry.settled = false;
      state.assistantState.set(turn, entry);
      record("assistant_stream_mutation_burst", { turnId: nodeId(turn), mutationType: mutation.type, addedNodes: mutation.addedNodes?.length || 0, removedNodes: mutation.removedNodes?.length || 0 });
      scheduleAssistantSettled(turn, entry);
    }
  }

  function scheduleAssistantSettled(turn, entry) {
    clearTimer(state.settledTimer);
    state.settledTimer = setTrackedTimeout(() => {
      if (!state.active || entry.settled) return;
      const gap = now() - (entry.lastMutationAt || entry.mountedAt);
      if (gap >= SETTLED_IDLE_MS) {
        entry.settled = true;
        markObserved("assistantSettled");
        checkpoint("assistant_settled", { turnId: nodeId(turn), idleGapMs: Math.round(gap), actionBarVisible: !!findActionBar(turn) });
      }
    }, SETTLED_IDLE_MS + 20);
    if (!state.hardSettleTimer) {
      state.hardSettleTimer = setTrackedTimeout(() => {
        if (!state.active || entry.settled) return;
        entry.settled = true;
        checkpoint("assistant_settled_hard_cap", { turnId: nodeId(turn), capMs: ASSISTANT_SETTLED_HARD_CAP_MS, actionBarVisible: !!findActionBar(turn) });
      }, ASSISTANT_SETTLED_HARD_CAP_MS);
    }
  }

  function inspectMentionAndConnector() {
    const chooser = document.querySelector("[role='listbox'], [data-testid*='mention'], [data-testid*='composer-menu'], [data-radix-popper-content-wrapper]");
    if (chooser instanceof HTMLElement && isVisible(chooser)) {
      markObserved("mentionChooser");
      checkpoint("mention_chooser_visible", { rect: rectSummary(chooser), skeleton: skeletonSummary(chooser, 2) });
    }
    const pill = document.querySelector("[data-inline-selection-pill], [data-symbol='ecosystemMention'], [data-testid*='connector'], [contenteditable='false'][data-id*='plugin']");
    if (pill instanceof HTMLElement && isVisible(pill)) {
      markObserved("connectorPill");
      checkpoint("connector_pill_visible", { rect: rectSummary(pill), textLength: textLengthOf(pill), skeleton: skeletonSummary(pill, 1) });
    }
  }

  function inspectOverlay() {
    const host = document.querySelector("[data-mica-root='true']");
    if (!(host instanceof HTMLElement)) return;
    markObserved("micaOverlay");
    const shadow = host.shadowRoot;
    const overlay = shadow?.getElementById?.("mica-overlay");
    const status = shadow?.querySelector?.(".mica-status");
    const dot = shadow?.querySelector?.(".mica-dot");
    const mode = overlay?.dataset?.mode || status?.className || null;
    const recording = dot?.classList?.contains("recording") === true;
    if (mode !== state.lastOverlayMode || recording !== state.lastOverlayRecording) {
      checkpoint("mica_overlay_state", { mode, recording, rect: rectSummary(host) });
      state.lastOverlayMode = mode;
      state.lastOverlayRecording = recording;
    }
  }

  function queueMutationSummary(mutations) {
    let added = 0;
    let removed = 0;
    let attributes = 0;
    for (const mutation of mutations) {
      added += mutation.addedNodes?.length || 0;
      removed += mutation.removedNodes?.length || 0;
      if (mutation.type === "attributes") attributes += 1;
    }
    state.mutationQueue.push({ at: relativeNow(), added, removed, attributes, count: mutations.length });
    if (state.mutationQueue.length > MAX_MUTATION_BURSTS) state.mutationQueue.shift();
    if (!state.mutationFlushTimer) state.mutationFlushTimer = setTrackedTimeout(flushMutationQueue, MUTATION_FLUSH_MS);
  }

  function flushMutationQueue() {
    if (!state.mutationQueue.length) return;
    const queue = state.mutationQueue.splice(0);
    clearTimer(state.mutationFlushTimer);
    state.mutationFlushTimer = 0;
    const summary = queue.reduce((acc, item) => {
      acc.added += item.added;
      acc.removed += item.removed;
      acc.attributes += item.attributes;
      acc.count += item.count;
      return acc;
    }, { added: 0, removed: 0, attributes: 0, count: 0 });
    state.counters.mutationBursts += 1;
    record("mutation_burst", summary);
  }

  function checkpoint(stateClass, details = {}) {
    state.counters.checkpoints += 1;
    const event = record("checkpoint", { checkpointId: `${state.session?.id || "inactive"}:${state.counters.checkpoints}`, stateClass, ...sanitizeDetails(details) });
    try {
      console.info(`${CHECKPOINT_PREFIX}${JSON.stringify({
        checkpointId: event.details.checkpointId,
        stateClass,
        monotonicTimestamp: event.monotonicTimeMs
      })}`);
    } catch (_error) {}
    return event;
  }

  function record(type, details = {}) {
    if (!state.session) return null;
    const event = {
      schemaVersion: SCHEMA_VERSION,
      type,
      monotonicTimeMs: round(now()),
      relativeTimeMs: round(relativeNow()),
      epochTimeMs: state.epochMs + relativeNow(),
      details: sanitizeDetails(details)
    };
    state.events.push(event);
    if (state.events.length > MAX_EVENTS) state.events.shift();
    return event;
  }

  function buildReport() {
    updateMemorySnapshot();
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: "mica.liveSurfaceAtlas",
      session: state.session ? { ...state.session } : null,
      active: state.active,
      generatedAtEpochMs: Date.now(),
      privacy: {
        localOnly: true,
        telemetryUploaded: false,
        promptTextIncluded: false,
        answerTextIncluded: false,
        rawDomIncluded: false,
        fullPageScreenshotIncluded: false,
        headersIncluded: false,
        cookiesIncluded: false,
        requestBodiesIncluded: false
      },
      safety: safetyFlags(),
      coverage: state.coverage,
      counters: { ...state.counters },
      performance: state.performance,
      timeline: state.events.slice(),
      runtime: {
        listeners: state.listeners.length,
        observers: state.observers.length,
        timers: state.timers.size,
        performanceObservers: state.performanceObservers.length
      }
    };
  }

  function summarizeSession(status) {
    return {
      status,
      active: state.active,
      sessionId: state.session?.id || null,
      events: state.events.length,
      coverage: state.coverage,
      safety: safetyFlags(),
      runtime: {
        listeners: state.listeners.length,
        observers: state.observers.length,
        timers: state.timers.size,
        performanceObservers: state.performanceObservers.length
      },
      report: buildReport()
    };
  }

  function addTrackedListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.listeners.push({ target, type, handler, options });
    state.counters.listenersAttached += 1;
  }

  function setTrackedTimeout(handler, delay) {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      handler();
    }, delay);
    state.timers.add(timer);
    state.counters.timersCreated += 1;
    return timer;
  }

  function clearTimer(timer) {
    if (!timer) return;
    clearTimeout(timer);
    state.timers.delete(timer);
  }

  function findComposer() {
    const nodes = Array.from(document.querySelectorAll(COMPOSER_SELECTOR)).filter((node) => node instanceof HTMLElement && !node.closest("[data-mica-root='true']"));
    for (const node of nodes) {
      const editable = isEditable(node) ? node : node.querySelector?.("textarea, input:not([type='hidden']), [contenteditable], [role='textbox']");
      if (!(editable instanceof HTMLElement) || !isVisible(editable)) continue;
      const root = node.closest?.("form, [data-testid*='composer']") || node;
      const surface = editable.closest?.("[data-composer-surface='true'], form, [data-testid*='composer']") || root;
      return { root, editable, surface };
    }
    return { root: null, editable: null, surface: null };
  }

  function collectTurns() {
    return Array.from(document.querySelectorAll(TURN_SELECTOR)).filter((node) => node instanceof HTMLElement && !!getTurnRole(node));
  }

  function getTurnRole(node) {
    if (!(node instanceof HTMLElement)) return null;
    const direct = node.getAttribute("data-message-author-role");
    if (direct) return direct;
    const roleNode = node.querySelector?.(ROLE_SELECTOR);
    return roleNode?.getAttribute?.("data-message-author-role") || null;
  }

  function findActionBar(turn) {
    if (!(turn instanceof HTMLElement)) return null;
    const buttons = Array.from(turn.querySelectorAll("[data-testid*='copy'], [aria-label*='Copy'], button, [role='button']")).filter((node) => node instanceof HTMLElement && isVisible(node));
    if (buttons.length === 0) return null;
    return buttons[0].closest("[data-testid*='action'], [role='toolbar'], div") || buttons[0].parentElement;
  }

  function isCopyAction(node) {
    if (!(node instanceof HTMLElement)) return false;
    const label = safeLabel(node);
    const testId = node.getAttribute("data-testid") || "";
    return /copy/i.test(label) || /copy/i.test(testId) || node.hasAttribute("data-mica-copy-action");
  }

  function isLikelySendButton(node) {
    const label = safeLabel(node);
    const testId = node.getAttribute("data-testid") || "";
    return /send/i.test(label) || /send/i.test(testId);
  }

  function isComposerRelated(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.closest("[data-mica-root='true']")) return false;
    if (isEditable(node)) return true;
    return !!node.closest?.(COMPOSER_SELECTOR) || !!node.querySelector?.("textarea, input:not([type='hidden']), [contenteditable], [role='textbox']");
  }

  function isEditable(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.type !== "hidden";
    return node.isContentEditable || node.hasAttribute("contenteditable") || node.getAttribute("role") === "textbox";
  }

  function getEventElement(target) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Element) return target.closest("*");
    if (target instanceof CharacterData) return target.parentElement;
    return null;
  }

  function composerSummary(nextComposer = null) {
    const composer = nextComposer || findComposer();
    return {
      present: !!composer.editable || !!composer.root,
      rootId: nodeId(composer.root),
      editableId: nodeId(composer.editable),
      surfaceId: nodeId(composer.surface),
      textLength: textLengthOf(composer.editable || composer.root),
      rect: rectSummary(composer.root || composer.editable),
      skeleton: skeletonSummary(composer.root || composer.editable, 2)
    };
  }

  function skeletonSummary(node, depth) {
    if (!(node instanceof HTMLElement) || depth < 0) return null;
    return {
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute("role") || null,
      testid: safeAttr(node.getAttribute("data-testid")),
      ariaLabel: safeAria(node.getAttribute("aria-label")),
      contenteditable: node.getAttribute("contenteditable"),
      disabled: node.hasAttribute("disabled"),
      expanded: node.getAttribute("aria-expanded"),
      pressed: node.getAttribute("aria-pressed"),
      childCount: node.children.length,
      textCategory: textCategory(node),
      textLength: textLengthOf(node),
      children: depth > 0 ? Array.from(node.children).slice(0, 8).map((child) => skeletonSummary(child, depth - 1)).filter(Boolean) : []
    };
  }

  function rectSummary(node) {
    if (!(node instanceof Element) || typeof node.getBoundingClientRect !== "function") return null;
    const rect = node.getBoundingClientRect();
    return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
  }

  function summarizePerformanceEntry(label, entry) {
    const summary = { type: label, name: safePerformanceName(entry.name), startTime: round(entry.startTime || 0), duration: round(entry.duration || 0) };
    if (Number.isFinite(entry.processingStart)) summary.processingStart = round(entry.processingStart);
    if (Number.isFinite(entry.processingEnd)) summary.processingEnd = round(entry.processingEnd);
    if (Number.isFinite(entry.interactionId)) summary.interactionId = entry.interactionId;
    if (Number.isFinite(entry.value)) summary.value = round(entry.value);
    return summary;
  }

  function updateMemorySnapshot() {
    const memory = performance?.memory;
    if (!memory) return;
    state.performance.memory = {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit
    };
  }

  function classifyKey(event) {
    const key = event.key || "";
    if (key === "Enter") return event.ctrlKey || event.metaKey ? "submit_combo_enter" : "enter";
    if (key === "Backspace" || key === "Delete") return "delete";
    if (key === "Escape") return "escape";
    if (key === "Tab") return "tab";
    if (key.length === 1) return "printable";
    if (/Arrow/.test(key)) return "navigation";
    return "control";
  }

  function sanitizeDetails(details) {
    if (!details || typeof details !== "object") return {};
    return JSON.parse(JSON.stringify(details, (_key, value) => {
      if (typeof value === "string") {
        if (value.length > 160) return `${value.slice(0, 80)}...[redacted:${value.length}]`;
        return value;
      }
      if (value instanceof Element) return { nodeId: nodeId(value), tag: value.tagName?.toLowerCase?.() || null };
      return value;
    }));
  }

  function safeAttr(value) {
    if (!value) return null;
    return /^[a-zA-Z0-9:_-]{1,80}$/.test(value) ? value : `attr-length-${value.length}`;
  }

  function safeAria(value) {
    if (!value) return null;
    return ALLOWED_TEXT_LABELS.has(value) ? value : `aria-length-${value.length}`;
  }

  function safeLabel(node) {
    if (!(node instanceof HTMLElement)) return "";
    const aria = node.getAttribute("aria-label");
    if (aria && ALLOWED_TEXT_LABELS.has(aria)) return aria;
    const title = node.getAttribute("title");
    if (title && ALLOWED_TEXT_LABELS.has(title)) return title;
    const text = (node.innerText || node.textContent || "").trim();
    return ALLOWED_TEXT_LABELS.has(text) ? text : "";
  }

  function safePerformanceName(name) {
    if (!name) return "";
    if (/^(keydown|beforeinput|input|click|pointer|composition|longtask|self)$/i.test(name)) return name;
    return `name-length-${String(name).length}`;
  }

  function textLengthOf(node) {
    if (!node) return 0;
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value.length;
    return (node.textContent || "").length;
  }

  function textCategory(node) {
    const length = textLengthOf(node);
    if (length === 0) return "empty";
    if (length <= 24) return "short";
    if (length <= 240) return "medium";
    return "long";
  }

  function nodeId(node) {
    if (!(node instanceof Element)) return null;
    if (!state.nodeIds.has(node)) state.nodeIds.set(node, `n${state.nextNodeId++}`);
    return state.nodeIds.get(node);
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function markObserved(key) {
    if (!state.coverage[key]) state.coverage[key] = { status: "OBSERVED", count: 0 };
    state.coverage[key].status = "OBSERVED";
    state.coverage[key].count += 1;
  }

  function createCoverage() {
    const keys = ["composer", "userTurn", "assistantStreaming", "assistantSettled", "assistantActionBar", "nativeCopyArea", "richMarkdown", "mentionChooser", "connectorPill", "micaOverlay", "longThreadMountedWindow", "toolFileAuthSurface", "micaCopy"];
    return Object.fromEntries(keys.map((key) => [key, { status: "MISSING", count: 0 }]));
  }

  function createPerformanceSummary() {
    return { eventTiming: [], longAnimationFrame: [], longTask: [], layoutShift: [], memory: null };
  }

  function createCounters() {
    return { listenersAttached: 0, observersAttached: 0, timersCreated: 0, checkpoints: 0, inputEvents: 0, mutationBursts: 0, performanceEntries: 0 };
  }

  function safetyFlags() {
    return { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false, computerUseRequired: false, playwrightRealSiteTraceUsed: false, cdpConnection: false };
  }

  function getUrlKind() {
    if (document.documentElement.dataset.micaFixture === "true") return "fixture";
    if (/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(location.href)) return "chatgpt";
    return "unsupported";
  }

  function appendBounded(array, value, limit) {
    array.push(value);
    while (array.length > limit) array.shift();
  }

  function now() {
    return performance.now();
  }

  function relativeNow() {
    return now() - state.startedAt;
  }

  function round(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }
})();
