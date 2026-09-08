(() => {
  const GLOBAL_KEY = "MicaConnectorContinuity";
  const WATCH_WINDOW_MS = 4200;
  const SHELL_HARD_CAP_MS = 2000;
  const SNAPSHOT_FRESHNESS_MS = 2500;
  const CONNECTOR_LIFECYCLE_EVENT = "mica-connector-lifecycle-latched";
  const SURFACE_SELECTOR = "[data-composer-surface='true']";
  const CONNECTOR_PILL_SELECTOR = "[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:'], [data-inline-selection-pill][data-id^='plugin:'], [data-system-hint-type^='plugin:']";

  let configured = false;
  let enabled = false;
  let listenersAttached = false;
  let lifecycle = null;
  let shellHost = null;
  let observer = null;
  let scheduledCheck = 0;
  let scheduledSnapshot = 0;
  let expireTimer = 0;
  let shellTimer = 0;
  let ids = new WeakMap();
  let nextId = 1;
  let lastReport = createEmptyReport();
  const perf = {
    cloneCount: 0,
    computedStyleCopyCount: 0,
    documentDiscoveryCount: 0,
    geometryReadCount: 0,
    activePollingTimer: false
  };

  function configure(options = {}) {
    configured = true;
    setEnabled(options.enabled === true);
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    if (enabled) {
      attachListeners();
      return;
    }
    cleanup("disabled");
    detachListeners();
  }

  function getState() {
    return {
      ...lastReport,
      enabled,
      listenersAttached,
      active: !!lifecycle,
      skippedReason: lastReport.skippedReason || (enabled ? null : "disabled"),
      perf: { ...perf }
    };
  }

  function resetForTests() {
    cleanup("reset");
    ids = new WeakMap();
    nextId = 1;
    perf.cloneCount = 0;
    perf.computedStyleCopyCount = 0;
    perf.documentDiscoveryCount = 0;
    perf.geometryReadCount = 0;
    perf.activePollingTimer = false;
    lastReport = createEmptyReport();
  }

  function attachListeners() {
    if (listenersAttached) return;
    addEventListener(CONNECTOR_LIFECYCLE_EVENT, handleSharedConnectorLifecycle, { capture: true });
    addEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    removeEventListener(CONNECTOR_LIFECYCLE_EVENT, handleSharedConnectorLifecycle, { capture: true });
    removeEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = false;
  }

  function handleNavigationCleanup() {
    cleanup("navigation");
  }

  function handleSharedConnectorLifecycle(event) {
    if (!enabled || !configured) return;
    const shared = event?.detail || getSharedConnectorLifecycleState();
    if (!shared?.connectorContextLatched && !shared?.latched && !shared?.detected) return;
    beginLifecycle(shared);
  }

  function beginLifecycle(shared) {
    const now = Date.now();
    const generation = shared?.latchId || 0;
    if (!lifecycle || lifecycle.connectorContextGeneration !== generation) {
      lifecycle = {
        startedAt: now,
        expiresAt: now + WATCH_WINDOW_MS,
        activationCandidateRecorded: false,
        source: sanitizeSource(shared?.source || shared?.selectionSource || "connector-context"),
        currentSurface: null,
        composerRootId: null,
        editableId: null,
        lastRect: normalizeRect(shared?.lastComposerRect),
        visualClone: null,
        capturedAt: 0,
        connectorContextGeneration: generation,
        pillSignature: "",
        cssVariableCount: 0,
        shellActivated: false,
        shellActivatedAt: 0,
        shellRemovedAt: 0,
        shellDurationMs: 0,
        connectorLifecycleLatched: true,
        selectionWindowOnly: false,
        sanitizedCloneAvailable: false,
        cleanupReason: null,
        skippedReason: null
      };
    } else {
      lifecycle.expiresAt = Math.max(lifecycle.expiresAt, now + WATCH_WINDOW_MS);
      lifecycle.source ||= sanitizeSource(shared?.source || shared?.selectionSource || "connector-context");
      lifecycle.lastRect = normalizeRect(shared?.lastComposerRect) || lifecycle.lastRect;
      lifecycle.connectorLifecycleLatched = true;
    }
    startObserver();
    scheduleSnapshotRefresh("connector_latch");
    scheduleComposerCheck();
    scheduleExpiry();
    lastReport = reportFromLifecycle(lifecycle);
  }

  function startObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  function handleMutations(mutations) {
    if (!lifecycle || !enabled) return;
    let composerStructureChanged = false;
    let connectorStructureChanged = false;
    for (const mutation of mutations) {
      if (mutation.type !== "childList" || mutationTouchesMica(mutation)) continue;
      if (mutationTouchesComposerStructure(mutation)) composerStructureChanged = true;
      if (mutationTouchesConnectorStructure(mutation)) connectorStructureChanged = true;
      if (composerStructureChanged && connectorStructureChanged) break;
    }
    if (connectorStructureChanged) scheduleSnapshotRefresh("connector_structure");
    if (composerStructureChanged || connectorStructureChanged) scheduleComposerCheck();
  }

  function scheduleComposerCheck() {
    if (scheduledCheck) return;
    scheduledCheck = requestFrame(() => {
      scheduledCheck = 0;
      checkComposerPresence();
    });
  }

  function scheduleSnapshotRefresh(source) {
    if (scheduledSnapshot) return;
    scheduledSnapshot = requestFrame(() => {
      scheduledSnapshot = 0;
      refreshSnapshot(source);
    });
  }

  function checkComposerPresence() {
    if (!lifecycle || !enabled) return;
    const now = Date.now();
    if (now > lifecycle.expiresAt) {
      cleanup("expired");
      return;
    }
    const surface = findNativeComposerSurface();
    if (surface) {
      lifecycle.currentSurface = surface;
      lifecycle.composerRootId = elementId(surface);
      const rect = measureComposerRect(surface);
      if (rect) lifecycle.lastRect = rect;
      if (shellHost) removeShell("composer_returned");
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    recordActivationCandidate();
    const skipReason = continuitySkipReason();
    if (skipReason) {
      lifecycle.skippedReason = skipReason;
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    showShell(lifecycle.lastRect);
  }

  function refreshSnapshot(source) {
    if (!lifecycle || !enabled) return;
    const now = Date.now();
    if (now > lifecycle.expiresAt) {
      cleanup("expired");
      return;
    }
    const surface = findNativeComposerSurface();
    if (!surface) {
      checkComposerPresence();
      return;
    }
    const signature = connectorPillSignature(surface);
    if (lifecycle.visualClone && lifecycle.currentSurface === surface && lifecycle.pillSignature === signature) {
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    const rect = measureComposerRect(surface) || lifecycle.lastRect;
    const visualClone = createSanitizedComposerClone(surface);
    lifecycle.currentSurface = surface;
    lifecycle.composerRootId = elementId(surface);
    lifecycle.editableId = elementId(findEditableWithin(surface));
    lifecycle.lastRect = rect || lifecycle.lastRect;
    if (visualClone && rect) {
      lifecycle.visualClone = visualClone;
      lifecycle.capturedAt = now;
      lifecycle.pillSignature = signature;
      lifecycle.cssVariableCount = countCssVariables(surface);
      lifecycle.sanitizedCloneAvailable = true;
      lifecycle.skippedReason = null;
      record("connector_continuity_shadow_cached", {
        source: sanitizeSource(source || lifecycle.source),
        connectorContextGeneration: lifecycle.connectorContextGeneration || 0,
        hasLastRect: true,
        sanitizedCloneAvailable: true,
        cacheAgeMs: 0,
        cssVariableCount: lifecycle.cssVariableCount || 0
      });
    } else if (!rect) {
      lifecycle.skippedReason = "no_last_rect";
    } else if (!visualClone) {
      lifecycle.skippedReason = "no_visual_clone";
    }
    lastReport = reportFromLifecycle(lifecycle);
  }

  function showShell(rect) {
    if (!lifecycle || shellHost || !rect) return;
    const skipReason = continuitySkipReason();
    if (skipReason) {
      lifecycle.skippedReason = skipReason;
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    shellHost = document.createElement("div");
    shellHost.dataset.micaConnectorContinuityShell = "true";
    shellHost.setAttribute("aria-hidden", "true");
    shellHost.setAttribute("inert", "");
    Object.assign(shellHost.style, {
      position: "fixed",
      left: `${Math.round(rect.left)}px`,
      top: `${Math.round(rect.top)}px`,
      width: `${Math.max(1, Math.round(rect.width))}px`,
      height: `${Math.max(1, Math.round(rect.height))}px`,
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "2147483644"
    });
    shellHost.appendChild(lifecycle.visualClone.cloneNode(true));
    document.documentElement.appendChild(shellHost);
    lifecycle.shellActivated = true;
    lifecycle.shellActivatedAt = Date.now();
    lastReport = reportFromLifecycle(lifecycle);
    record("connector_continuity_shell_shown", {
      source: lifecycle.source,
      composerRootId: lifecycle.composerRootId,
      editableId: lifecycle.editableId,
      connectorContextGeneration: lifecycle.connectorContextGeneration || 0,
      cacheAgeMs: cacheAgeMs(lifecycle)
    });
    clearTimeout(shellTimer);
    shellTimer = setTimeout(() => cleanup("shell_hard_cap"), SHELL_HARD_CAP_MS);
  }

  function removeShell(reason) {
    if (!shellHost) return;
    shellHost.remove();
    shellHost = null;
    clearTimeout(shellTimer);
    shellTimer = 0;
    if (lifecycle?.shellActivatedAt) {
      lifecycle.shellRemovedAt = Date.now();
      lifecycle.shellDurationMs += Math.max(0, lifecycle.shellRemovedAt - lifecycle.shellActivatedAt);
      lifecycle.shellActivatedAt = 0;
      lifecycle.cleanupReason = reason;
    }
    lastReport = lifecycle ? reportFromLifecycle(lifecycle) : lastReport;
    record("connector_continuity_shell_removed", {
      reason,
      durationMs: lastReport.shellDurationMs
    });
  }

  function cleanup(reason) {
    if (shellHost) removeShell(reason);
    if (lifecycle) {
      lifecycle.cleanupReason = reason;
      lastReport = reportFromLifecycle(lifecycle);
    }
    lifecycle = null;
    stopObserver();
    cancelScheduled();
    clearTimeout(expireTimer);
    clearTimeout(shellTimer);
    expireTimer = 0;
    shellTimer = 0;
  }

  function cancelScheduled() {
    cancelFrame(scheduledCheck);
    cancelFrame(scheduledSnapshot);
    scheduledCheck = 0;
    scheduledSnapshot = 0;
  }

  function scheduleExpiry() {
    clearTimeout(expireTimer);
    if (!lifecycle) return;
    expireTimer = setTimeout(() => {
      if (lifecycle && Date.now() >= lifecycle.expiresAt) cleanup("completed");
    }, Math.max(0, lifecycle.expiresAt - Date.now()) + 20);
  }

  function continuitySkipReason() {
    if (!enabled) return "feature_disabled";
    if (!lifecycle?.connectorLifecycleLatched && !getSharedConnectorLifecycleState()?.connectorContextLatched) return "not_connector_latched";
    if (!lifecycle?.lastRect) return "no_last_rect";
    if (!lifecycle?.visualClone) return "no_visual_clone";
    if (!lifecycle?.capturedAt || cacheAgeMs(lifecycle) > SNAPSHOT_FRESHNESS_MS) return "stale_snapshot";
    if (isRealSendGenerationActive()) return "real_send_active";
    if (isStaleClearRecoveryActive()) return "stale_clear_active";
    return null;
  }

  function isRealSendGenerationActive() {
    const state = globalThis.MicaSendResidualRecovery?.getState?.();
    return !!state?.active || !!state?.sendCandidateActive || !!state?.userTurnCommittedLatched;
  }

  function isStaleClearRecoveryActive() {
    const state = globalThis.MicaStaleComposerRecovery?.getState?.();
    if (!state?.enabled) return false;
    if (state.armed || state.guardActive || state.tombstoneActive) return true;
    return !!state.phase && state.phase !== "IDLE" && state.clearConfirmed === true && state.finalClearStable !== true;
  }

  function recordActivationCandidate() {
    if (!lifecycle || lifecycle.activationCandidateRecorded) return;
    lifecycle.activationCandidateRecorded = true;
    record("connector_continuity_activation_candidate", {
      source: lifecycle.source,
      connectorLifecycleLatched: lifecycle.connectorLifecycleLatched,
      hasLastRect: !!lifecycle.lastRect,
      sanitizedCloneAvailable: !!lifecycle.visualClone,
      cachedSnapshotFresh: !!lifecycle.visualClone && cacheAgeMs(lifecycle) <= SNAPSHOT_FRESHNESS_MS,
      cacheAgeMs: cacheAgeMs(lifecycle),
      selectionWindowOnly: false,
      skippedReason: continuitySkipReason()
    });
  }

  function createSanitizedComposerClone(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected || isMicaNode(element)) return null;
    if (!element.matches(SURFACE_SELECTOR)) return null;
    perf.cloneCount += 1;
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return null;
    copyComputedVisualStyles(element, clone);
    sanitizeCloneTree(clone);
    Object.assign(clone.style, {
      position: "static",
      left: "auto",
      right: "auto",
      top: "auto",
      bottom: "auto",
      transform: "none",
      margin: "0",
      width: "100%",
      height: "100%",
      minHeight: "100%",
      minWidth: "0",
      maxWidth: "none",
      pointerEvents: "none",
      boxSizing: "border-box"
    });
    clone.dataset.micaConnectorContinuityClone = "true";
    return clone;
  }

  function sanitizeCloneTree(root) {
    const nodes = [root, ...root.querySelectorAll("*")];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      node.removeAttribute("id");
      node.removeAttribute("name");
      node.removeAttribute("for");
      node.removeAttribute("aria-controls");
      node.removeAttribute("aria-describedby");
      node.removeAttribute("aria-labelledby");
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("tabindex", "-1");
      node.style.pointerEvents = "none";
      if (node.hasAttribute("contenteditable")) node.setAttribute("contenteditable", "false");
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        node.defaultValue = node.value;
        node.setAttribute("readonly", "true");
        node.setAttribute("disabled", "true");
      }
      if (node instanceof HTMLButtonElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        node.setAttribute("disabled", "true");
      }
      if (node instanceof HTMLFormElement) {
        node.removeAttribute("action");
        node.removeAttribute("method");
      }
      if (node instanceof HTMLAnchorElement) {
        node.removeAttribute("href");
      }
    }
  }

  function copyComputedVisualStyles(sourceRoot, cloneRoot) {
    const sourceNodes = [sourceRoot, ...sourceRoot.querySelectorAll("*")];
    const cloneNodes = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
    const limit = Math.min(sourceNodes.length, cloneNodes.length, 120);
    for (let index = 0; index < limit; index += 1) {
      const source = sourceNodes[index];
      const clone = cloneNodes[index];
      if (!(source instanceof HTMLElement) || !(clone instanceof HTMLElement)) continue;
      perf.computedStyleCopyCount += 1;
      const style = getComputedStyle(source);
      const properties = [
        "box-sizing",
        "display",
        "grid-template-columns",
        "grid-template-rows",
        "grid-template-areas",
        "grid-area",
        "align-items",
        "justify-content",
        "flex-direction",
        "flex",
        "gap",
        "min-width",
        "min-height",
        "max-width",
        "max-height",
        "width",
        "height",
        "padding",
        "margin",
        "overflow",
        "overflow-x",
        "overflow-y",
        "border",
        "border-radius",
        "background",
        "background-color",
        "box-shadow",
        "color",
        "font",
        "line-height",
        "white-space",
        "text-overflow",
        "vertical-align",
        "object-fit"
      ];
      for (const property of properties) {
        const value = style.getPropertyValue(property);
        if (value) clone.style.setProperty(property, value);
      }
      for (let variableIndex = 0; variableIndex < style.length; variableIndex += 1) {
        const variable = style[variableIndex];
        if (!String(variable || "").startsWith("--")) continue;
        const value = style.getPropertyValue(variable);
        if (value) clone.style.setProperty(variable, value);
      }
    }
  }

  function findNativeComposerSurface() {
    perf.documentDiscoveryCount += 1;
    const surface = document.querySelector(SURFACE_SELECTOR);
    return surface instanceof HTMLElement && !isMicaNode(surface) && surface.isConnected ? surface : null;
  }

  function findEditableWithin(surface) {
    if (!(surface instanceof Element)) return null;
    const editable = surface.querySelector("textarea, input:not([type='hidden']), [contenteditable], [role='textbox']");
    return editable instanceof HTMLElement ? editable : null;
  }

  function mutationTouchesMica(mutation) {
    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
      const element = getMutationElement(node);
      if (element && isMicaNode(element)) return true;
    }
    return false;
  }

  function mutationTouchesComposerStructure(mutation) {
    if (nodeListTouchesSelector(mutation.addedNodes, SURFACE_SELECTOR)) return true;
    if (nodeListTouchesSelector(mutation.removedNodes, SURFACE_SELECTOR)) return true;
    if (lifecycle?.currentSurface && !lifecycle.currentSurface.isConnected) return true;
    return false;
  }

  function mutationTouchesConnectorStructure(mutation) {
    if (nodeListTouchesSelector(mutation.addedNodes, CONNECTOR_PILL_SELECTOR)) return true;
    if (nodeListTouchesSelector(mutation.removedNodes, CONNECTOR_PILL_SELECTOR)) return true;
    return false;
  }

  function nodeListTouchesSelector(nodes, selector) {
    for (const node of Array.from(nodes || [])) {
      const element = node instanceof Element ? node : null;
      if (!(element instanceof Element) || isMicaNode(element)) continue;
      if (element.matches?.(selector) || element.querySelector?.(selector)) return true;
      if (lifecycle?.currentSurface && (element === lifecycle.currentSurface || element.contains(lifecycle.currentSurface))) return true;
    }
    return false;
  }

  function connectorPillSignature(root) {
    if (!(root instanceof Element)) return "";
    const pills = root.querySelectorAll(CONNECTOR_PILL_SELECTOR);
    return Array.from(pills).map((pill) => {
      const element = pill instanceof Element ? pill : null;
      return [
        element?.getAttribute("data-symbol") || "",
        element?.getAttribute("data-id") || "",
        element?.getAttribute("data-system-hint-type") || "",
        String(element?.textContent || "").length
      ].join(":");
    }).join("|");
  }

  function countCssVariables(element) {
    if (!(element instanceof HTMLElement)) return 0;
    const style = getComputedStyle(element);
    let count = 0;
    for (let index = 0; index < style.length; index += 1) {
      if (String(style[index] || "").startsWith("--")) count += 1;
    }
    return count;
  }

  function measureComposerRect(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return null;
    perf.geometryReadCount += 1;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function normalizeRect(rect) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function cacheAgeMs(active = lifecycle) {
    return active?.capturedAt ? Math.max(0, Date.now() - active.capturedAt) : null;
  }

  function reportFromLifecycle(active) {
    return {
      activated: !!active?.shellActivated,
      source: active?.source || null,
      active: !!active,
      shellPresent: !!shellHost,
      shellDurationMs: Math.round(active?.shellDurationMs || 0),
      composerRootId: active?.composerRootId || null,
      editableId: active?.editableId || null,
      connectorLifecycleLatched: !!active?.connectorLifecycleLatched,
      selectionWindowOnly: !!active?.selectionWindowOnly,
      connectorContextGeneration: active?.connectorContextGeneration || 0,
      cachedSnapshotAvailable: !!active?.visualClone,
      cachedSnapshotFresh: !!active?.visualClone && cacheAgeMs(active) <= SNAPSHOT_FRESHNESS_MS,
      cacheAgeMs: cacheAgeMs(active),
      snapshotFreshnessMs: SNAPSHOT_FRESHNESS_MS,
      cssVariableCount: active?.cssVariableCount || 0,
      sanitizedCloneAvailable: !!active?.sanitizedCloneAvailable,
      cleanupReason: active?.cleanupReason || null,
      skippedReason: active?.skippedReason || null,
      pollingActive: false
    };
  }

  function createEmptyReport() {
    return {
      activated: false,
      source: null,
      active: false,
      shellPresent: false,
      shellDurationMs: 0,
      composerRootId: null,
      editableId: null,
      connectorLifecycleLatched: false,
      selectionWindowOnly: false,
      connectorContextGeneration: 0,
      cachedSnapshotAvailable: false,
      cachedSnapshotFresh: false,
      cacheAgeMs: null,
      snapshotFreshnessMs: SNAPSHOT_FRESHNESS_MS,
      cssVariableCount: 0,
      sanitizedCloneAvailable: false,
      skippedReason: null,
      cleanupReason: null,
      pollingActive: false
    };
  }

  function requestFrame(callback) {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    return setTimeout(callback, 16);
  }

  function cancelFrame(id) {
    if (!id) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    else clearTimeout(id);
  }

  function sanitizeSource(source) {
    if (/^(chip|chooser|chooser-selection|mention-enter-candidate|structural-marker|mention-trigger|resolved-connector-pill|connector-context|connector_latch|connector_structure)$/.test(source)) return source;
    return "unknown";
  }

  function getMutationElement(node) {
    if (node instanceof HTMLElement) return node;
    if (node instanceof Element) return node.closest("*");
    if (node instanceof CharacterData) return node.parentElement;
    return null;
  }

  function isMicaNode(node) {
    return !!node.closest?.("[data-mica-root='true'], [data-mica-composer-diagnostics-root='true'], [data-mica-connector-continuity-shell='true']");
  }

  function elementId(element) {
    if (!(element instanceof Element)) return null;
    if (!ids.has(element)) ids.set(element, nextId++);
    return ids.get(element);
  }

  function getSharedConnectorLifecycleState() {
    return globalThis.MicaConnectorLifecycleSignal?.getState?.() || null;
  }

  function record(type, details = {}) {
    const api = globalThis.MicaComposerDiagnostics;
    if (!api || typeof api.recordConnectorContinuityEvent !== "function" || api.isActive?.() !== true) return;
    api.recordConnectorContinuityEvent(type, details);
  }

  globalThis[GLOBAL_KEY] = {
    configure,
    setEnabled,
    getState,
    resetForTests
  };
})();
