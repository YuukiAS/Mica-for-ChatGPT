(() => {
  const GLOBAL_KEY = "MicaConnectorContinuity";
  const WATCH_WINDOW_MS = 3200;
  const SAMPLE_INTERVAL_MS = 60;
  const SHELL_HARD_CAP_MS = 2000;
  const SNAPSHOT_FRESHNESS_MS = 2500;
  const CONNECTOR_LIFECYCLE_EVENT = "mica-connector-lifecycle-latched";

  let configured = false;
  let enabled = false;
  let listenersAttached = false;
  let lifecycle = null;
  let shellHost = null;
  let timer = 0;
  let ids = new WeakMap();
  let nextId = 1;
  let lastReport = createEmptyReport();

  function configure(options = {}) {
    configured = true;
    setEnabled(options.enabled === true);
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    if (enabled) {
      attachListeners();
      const shared = getSharedConnectorLifecycleState();
      if (shared?.connectorContextLatched || shared?.latched || shared?.detected) {
        const editable = findComposerEditable();
        beginLifecycle(findComposerRoot(editable), editable, shared.source || "unknown", shared.lastComposerRect || null);
      }
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
      skippedReason: lastReport.skippedReason || (enabled ? null : "disabled")
    };
  }

  function resetForTests() {
    cleanup("reset");
    ids = new WeakMap();
    nextId = 1;
    lastReport = createEmptyReport();
  }

  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener("focusin", handlePotentialMentionEvent, true);
    document.addEventListener("beforeinput", handlePotentialMentionEvent, true);
    document.addEventListener("input", handlePotentialMentionEvent, true);
    document.addEventListener("click", handlePotentialMentionEvent, true);
    document.addEventListener("pointerdown", handlePotentialMentionEvent, true);
    document.addEventListener("keydown", handlePotentialMentionEvent, true);
    addEventListener(CONNECTOR_LIFECYCLE_EVENT, handleSharedConnectorLifecycle, { capture: true });
    addEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    document.removeEventListener("focusin", handlePotentialMentionEvent, true);
    document.removeEventListener("beforeinput", handlePotentialMentionEvent, true);
    document.removeEventListener("input", handlePotentialMentionEvent, true);
    document.removeEventListener("click", handlePotentialMentionEvent, true);
    document.removeEventListener("pointerdown", handlePotentialMentionEvent, true);
    document.removeEventListener("keydown", handlePotentialMentionEvent, true);
    removeEventListener(CONNECTOR_LIFECYCLE_EVENT, handleSharedConnectorLifecycle, { capture: true });
    removeEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = false;
  }

  function handleNavigationCleanup() {
    cleanup("navigation");
  }

  function handlePotentialMentionEvent(event) {
    if (!enabled || !configured || !isTrustedEvent(event)) return;
    const shared = getSharedConnectorLifecycleState();
    const editable = findComposerEditableFromTarget(event.target) || findComposerEditable();
    const root = findComposerVisualRoot(editable) || findComposerRoot(editable);
    const mentionSignal = detectMentionSignal(root, editable);
    if (!shared?.connectorContextLatched && !shared?.latched && !shared?.detected && !mentionSignal.seen && !isChooserSelectionGesture(event)) return;
    beginLifecycle(root, editable, mentionSignal.source || shared?.source || shared?.selectionSource || event.type || "connector-context", shared?.lastComposerRect || null);
  }

  function handleSharedConnectorLifecycle(event) {
    if (!enabled || !configured) return;
    const shared = event?.detail || getSharedConnectorLifecycleState();
    if (!shared?.connectorContextLatched && !shared?.latched && !shared?.detected) return;
    const editable = findComposerEditable();
    const root = findComposerVisualRoot(editable) || findComposerRoot(editable);
    beginLifecycle(root, editable, shared.source || shared.selectionSource || "connector-context", shared.lastComposerRect || null);
  }

  function beginLifecycle(root, editable, source, fallbackRect = null) {
    const visualRoot = findComposerVisualRoot(editable) || findComposerVisualRoot(root);
    const rect = measureComposerRect(visualRoot) || normalizeRect(fallbackRect);
    const visualClone = createSanitizedComposerClone(visualRoot);
    const now = Date.now();
    if (!lifecycle) {
      lifecycle = {
        startedAt: now,
        expiresAt: now + WATCH_WINDOW_MS,
        shellExpiresAt: 0,
        missingStartedAt: 0,
        activationCandidateRecorded: false,
        source,
        composerRootId: elementId(visualRoot || root),
        editableId: elementId(editable),
        lastRect: rect,
        visualClone,
        capturedAt: visualClone && rect ? now : 0,
        connectorContextGeneration: getSharedConnectorLifecycleState()?.latchId || 0,
        pillSignature: connectorPillSignature(visualRoot),
        cssVariableCount: countCssVariables(visualRoot),
        shellActivated: false,
        shellActivatedAt: 0,
        shellRemovedAt: 0,
        shellDurationMs: 0,
        connectorLifecycleLatched: !!getSharedConnectorLifecycleState()?.connectorContextLatched,
        selectionWindowOnly: false,
        sanitizedCloneAvailable: !!visualClone,
        cleanupReason: null,
        skippedReason: rect ? (visualClone ? null : "no_visual_clone") : "no_last_rect"
      };
    } else {
      lifecycle.expiresAt = Math.max(lifecycle.expiresAt, now + WATCH_WINDOW_MS);
      lifecycle.source ||= source;
      lifecycle.lastRect = rect || lifecycle.lastRect;
      if (visualClone && rect) {
        lifecycle.visualClone = visualClone;
        lifecycle.capturedAt = now;
        lifecycle.pillSignature = connectorPillSignature(visualRoot);
        lifecycle.cssVariableCount = countCssVariables(visualRoot);
      }
      lifecycle.composerRootId ||= elementId(visualRoot || root);
      lifecycle.editableId ||= elementId(editable);
      lifecycle.connectorLifecycleLatched = lifecycle.connectorLifecycleLatched || !!getSharedConnectorLifecycleState()?.connectorContextLatched;
      lifecycle.connectorContextGeneration ||= getSharedConnectorLifecycleState()?.latchId || 0;
      lifecycle.sanitizedCloneAvailable = lifecycle.sanitizedCloneAvailable || !!visualClone;
      if (rect && lifecycle.visualClone) lifecycle.skippedReason = null;
    }
    lastReport = reportFromLifecycle(lifecycle);
    if (visualClone && rect) {
      record("connector_continuity_shadow_cached", {
        source: lifecycle.source,
        connectorContextGeneration: lifecycle.connectorContextGeneration || 0,
        hasLastRect: true,
        sanitizedCloneAvailable: true,
        cacheAgeMs: 0,
        cssVariableCount: lifecycle.cssVariableCount || 0
      });
    }
    ensureTimer();
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(tick, SAMPLE_INTERVAL_MS);
    tick();
  }

  function tick() {
    if (!lifecycle) {
      clearTimer();
      return;
    }
    const now = Date.now();
    const editable = findComposerEditable();
    const root = findComposerVisualRoot(editable) || findComposerRoot(editable);
    const rect = measureComposerRect(root);
    if (editable && root) {
      if (rect) lifecycle.lastRect = rect;
      if (shellHost) removeShell("composer_returned");
      lifecycle.missingStartedAt = 0;
      lifecycle.shellExpiresAt = 0;
      const shared = getSharedConnectorLifecycleState();
      if (shared?.connectorContextLatched || shared?.latched) {
        const signature = connectorPillSignature(root);
        const shouldRefresh = !lifecycle.visualClone
          || signature !== lifecycle.pillSignature;
        if (shouldRefresh) {
          const visualClone = createSanitizedComposerClone(root);
          if (visualClone) {
            lifecycle.visualClone = visualClone;
            lifecycle.capturedAt = now;
            lifecycle.pillSignature = signature;
            lifecycle.cssVariableCount = countCssVariables(root);
            lifecycle.sanitizedCloneAvailable = true;
          }
        }
      }
      lastReport = reportFromLifecycle(lifecycle);
      if (now > lifecycle.expiresAt) cleanup("completed");
      return;
    }
    if (now > lifecycle.expiresAt) {
      cleanup("expired");
      return;
    }
    if (!lifecycle.missingStartedAt) {
      lifecycle.missingStartedAt = now;
      lifecycle.shellExpiresAt = now + SHELL_HARD_CAP_MS;
      recordActivationCandidate();
    }
    const skipReason = continuitySkipReason();
    if (skipReason) {
      lifecycle.skippedReason = skipReason;
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    if (!lifecycle.lastRect) {
      lifecycle.skippedReason = "no_last_rect";
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    if (!lifecycle.visualClone) {
      lifecycle.skippedReason = "no_visual_clone";
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    if (now > lifecycle.shellExpiresAt) {
      cleanup("expired");
      return;
    }
    if (lifecycle.lastRect) showShell(lifecycle.lastRect);
  }

  function showShell(rect) {
    if (!lifecycle || shellHost) return;
    const skipReason = continuitySkipReason();
    if (skipReason) {
      lifecycle.skippedReason = skipReason;
      lastReport = reportFromLifecycle(lifecycle);
      return;
    }
    if (!lifecycle.visualClone) {
      lifecycle.skippedReason = "no_visual_clone";
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
  }

  function removeShell(reason) {
    if (!shellHost) return;
    shellHost.remove();
    shellHost = null;
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
    clearTimer();
  }

  function clearTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
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
    return !!state?.active && !!state?.userTurnCommittedLatched;
  }

  function isStaleClearRecoveryActive() {
    const state = globalThis.MicaStaleComposerRecovery?.getState?.();
    if (!state?.enabled) return false;
    if (state.armed || state.guardActive || state.tombstoneActive) return true;
    return !!state.phase && state.phase !== "IDLE" && state.clearConfirmed === true && state.finalClearStable !== true;
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
      skippedReason: active?.skippedReason || null
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
      cleanupReason: null
    };
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
    if (!element.matches("[data-composer-surface='true']")) return null;
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

  function measureComposerRect(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return null;
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

  function findComposerEditable() {
    const selectors = [
      "#prompt-textarea",
      "[data-testid*='composer'] [contenteditable]",
      "[data-testid*='composer'] textarea",
      "[contenteditable][role='textbox']",
      "textarea[placeholder]",
      "[role='textbox']"
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement) || isMicaNode(node) || node.hidden || node.getAttribute("aria-hidden") === "true") continue;
        return node;
      }
    }
    return null;
  }

  function findComposerEditableFromTarget(target) {
    const element = getEventElement(target);
    if (!element || isMicaNode(element)) return null;
    if (isEditable(element)) return element;
    const editable = element.closest?.("#prompt-textarea, [contenteditable], textarea, [role='textbox']");
    return editable instanceof HTMLElement ? editable : null;
  }

  function findComposerRoot(element) {
    if (!(element instanceof Element)) return null;
    return element.closest("[data-testid*='composer'], form") || element.parentElement;
  }

  function findComposerVisualRoot(element) {
    let surface = null;
    if (element instanceof Element) {
      surface = element.matches?.("[data-composer-surface='true']")
        ? element
        : element.closest?.("[data-composer-surface='true']") || element.querySelector?.("[data-composer-surface='true']");
    }
    surface ||= document.querySelector("[data-composer-surface='true']");
    return surface instanceof HTMLElement ? surface : null;
  }

  function connectorPillSignature(root) {
    if (!(root instanceof Element)) return "";
    const pills = root.querySelectorAll("[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:'], [data-inline-selection-pill][data-id^='plugin:'], [data-system-hint-type^='plugin:']");
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

  function detectMentionSignal(root, editable) {
    const rootSignal = detectMentionSignalInRoot(root);
    if (rootSignal.seen) return rootSignal;
    const editableSignal = detectMentionSignalInRoot(editable);
    if (editableSignal.seen) return editableSignal;
    const chooser = findActiveMentionChooser();
    if (chooser) return { seen: true, source: "chooser" };
    return { seen: false, source: null };
  }

  function detectMentionSignalInRoot(root) {
    if (!(root instanceof Element)) return { seen: false, source: null };
    if (hasResolvedConnectorContext(root)) return { seen: true, source: "resolved-connector-pill" };
    if (root.matches?.("[data-mention], [data-token-type], [data-entity]")) return { seen: true, source: "chip" };
    if (root.querySelector?.("[data-mention], [data-token-type], [data-entity]")) return { seen: true, source: "chip" };
    const marked = root.querySelectorAll?.("[aria-label], [data-testid], [data-type], [role], [aria-controls], [aria-expanded]") || [];
    for (const node of marked) {
      const source = mentionSourceFromAttributes(node);
      if (source) return { seen: true, source };
    }
    const rootSource = mentionSourceFromAttributes(root);
    return rootSource ? { seen: true, source: rootSource } : { seen: false, source: null };
  }

  function mentionSourceFromAttributes(node) {
    if (!(node instanceof Element)) return null;
    if (isResolvedConnectorPill(node)) return "resolved-connector-pill";
    if (node.hasAttribute("data-mention") || node.hasAttribute("data-entity") || node.hasAttribute("data-token-type")) return "chip";
    const signal = [
      node.getAttribute("aria-label"),
      node.getAttribute("data-testid"),
      node.getAttribute("data-type"),
      node.getAttribute("role")
    ].filter(Boolean).join(" ");
    if (/connector|mention/i.test(signal)) return "structural-marker";
    if (node.getAttribute("aria-expanded") === "true" && node.hasAttribute("aria-controls")) return "chooser";
    return null;
  }

  function hasResolvedConnectorContext(root, editable) {
    return hasResolvedConnectorPill(root) || hasResolvedConnectorPill(editable);
  }

  function hasResolvedConnectorPill(root) {
    if (!(root instanceof Element)) return false;
    if (isResolvedConnectorPill(root)) return true;
    return !!root.querySelector?.("[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:'], [data-inline-selection-pill][data-id^='plugin:'], [data-system-hint-type^='plugin:']");
  }

  function isResolvedConnectorPill(node) {
    return node instanceof Element
      && node.hasAttribute("data-inline-selection-pill")
      && (node.getAttribute("data-symbol") === "ecosystemMention" || String(node.getAttribute("data-id") || "").startsWith("plugin:"));
  }

  function findActiveMentionChooser() {
    const selectors = [
      "[data-testid*='mention' i]",
      "[data-testid*='connector' i]",
      "[aria-label*='mention' i]",
      "[aria-label*='connector' i]",
      "[role='listbox'][aria-activedescendant]",
      "[role='menu'][aria-activedescendant]"
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof Element) || isMicaNode(node)) continue;
        const signal = [node.getAttribute("role"), node.getAttribute("aria-label"), node.getAttribute("data-testid")].filter(Boolean).join(" ");
        if (/listbox|menu|dialog/i.test(signal)
          || (node.getAttribute("aria-expanded") === "true" && node.hasAttribute("aria-controls"))) {
          return node;
        }
      }
    }
    return null;
  }

  function isChooserSelectionGesture(event) {
    const chooser = findActiveMentionChooser();
    if (!chooser) return false;
    const element = getEventElement(event?.target);
    if (event?.type === "keydown" && event.key === "Enter") return true;
    return (event?.type === "pointerdown" || event?.type === "click")
      && element instanceof Element
      && (element === chooser || chooser.contains(element));
  }

  function isComposerEventTarget(target) {
    const element = getEventElement(target);
    if (!element || isMicaNode(element)) return false;
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    if (editable && (element === editable || editable.contains(element) || element.contains(editable))) return true;
    if (root && (element === root || root.contains(element))) return true;
    return !!element.closest("#prompt-textarea, [data-testid*='composer'], textarea, [contenteditable][role='textbox'], [role='textbox']");
  }

  function isEditable(element) {
    return element instanceof HTMLTextAreaElement
      || element instanceof HTMLInputElement
      || element.hasAttribute("contenteditable")
      || element.getAttribute("role") === "textbox";
  }

  function getEventElement(target) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Element) return target.closest("*");
    if (target instanceof CharacterData) return target.parentElement;
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

  function isTrustedEvent(event) {
    return event?.isTrusted === true || document.documentElement.dataset.micaFixture === "true";
  }

  function record(type, details = {}) {
    const api = globalThis.MicaComposerDiagnostics;
    if (!api || typeof api.recordConnectorContinuityEvent !== "function" || api.isActive?.() !== true) return;
    api.recordConnectorContinuityEvent(type, details);
  }

  function getSharedConnectorLifecycleState() {
    return globalThis.MicaConnectorLifecycleSignal?.getState?.() || null;
  }

  globalThis[GLOBAL_KEY] = {
    configure,
    setEnabled,
    getState,
    resetForTests
  };
})();
