(() => {
  const GLOBAL_KEY = "MicaConnectorLifecycleSignal";
  const LATCH_TTL_MS = 120000;
  const CHOOSER_ACTIVE_GRACE_MS = 300;
  const SELECTION_WINDOW_MS = 2200;
  const MENTION_QUERY_MS = 15000;
  const EVENT_NAME = "mica-connector-lifecycle-latched";

  let configured = false;
  let enabled = false;
  let listenersAttached = false;
  let latchId = 0;
  let latch = createEmptyLatch();
  let ids = new WeakMap();
  let nextId = 1;

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
    clearLatch("disabled");
    detachListeners();
  }

  function getState() {
    expireIfNeeded();
    return {
      ...publicLatch(),
      enabled,
      listenersAttached
    };
  }

  function resetForTests() {
    clearLatch("reset");
    ids = new WeakMap();
    nextId = 1;
  }

  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener("focusin", handlePotentialConnectorSignal, true);
    document.addEventListener("beforeinput", handlePotentialConnectorSignal, true);
    document.addEventListener("input", handlePotentialConnectorSignal, true);
    document.addEventListener("keydown", handlePotentialConnectorSignal, true);
    document.addEventListener("click", handlePotentialConnectorSignal, true);
    document.addEventListener("pointerdown", handlePotentialConnectorSignal, true);
    addEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    document.removeEventListener("focusin", handlePotentialConnectorSignal, true);
    document.removeEventListener("beforeinput", handlePotentialConnectorSignal, true);
    document.removeEventListener("input", handlePotentialConnectorSignal, true);
    document.removeEventListener("keydown", handlePotentialConnectorSignal, true);
    document.removeEventListener("click", handlePotentialConnectorSignal, true);
    document.removeEventListener("pointerdown", handlePotentialConnectorSignal, true);
    removeEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = false;
  }

  function handleNavigationCleanup() {
    clearLatch("navigation");
  }

  function handlePotentialConnectorSignal(event) {
    if (!enabled || !configured || !isTrustedEvent(event)) return;
    const signal = detectSignal(event);
    if (!signal.detected) return;
    latchConnectorLifecycle(signal.source, signal.root, signal.editable);
  }

  function latchConnectorLifecycle(source = "unknown", root = null, editable = null) {
    if (!enabled || !configured) return publicLatch();
    const now = Date.now();
    const activeRoot = root instanceof HTMLElement ? root : findComposerRoot(findComposerEditable());
    const activeEditable = editable instanceof HTMLElement ? editable : findComposerEditable();
    const rect = measureComposerRect(activeRoot || activeEditable) || latch.lastComposerRect;
    latchId += latch.latched ? 0 : 1;
    latch = {
      detected: true,
      latched: true,
      source: sanitizeSource(source),
      latchId,
      latchedAt: now,
      expiresAt: now + LATCH_TTL_MS,
      composerRootId: elementId(activeRoot),
      editableId: elementId(activeEditable),
      lastComposerRect: rect,
      chooserActiveUntil: latch.chooserActiveUntil || 0,
      chooserSource: latch.chooserSource || null,
      selectionWindowUntil: latch.selectionWindowUntil || 0,
      selectionSource: latch.selectionSource || null,
      selectionId: latch.selectionId || 0,
      mentionQueryUntil: latch.mentionQueryUntil || 0,
      skippedReason: null
    };
    dispatchLatchEvent();
    return publicLatch();
  }

  function detectSignal(event) {
    const element = getEventElement(event.target);
    const editable = findComposerEditableFromTarget(event.target) || findComposerEditable();
    const root = findComposerRoot(editable);
    const chooser = findActiveMentionChooser();
    if (isChooserSelectionGesture(event, element, chooser)) {
      markChooserActive("chooser-selection");
      const selection = markSelectionWindow("chooser-selection", root, editable);
      return { detected: true, source: selection.source, root, editable };
    }
    if (isMentionEnterSelectionCandidate(event, root, editable)) {
      const selection = markSelectionWindow("mention-enter-candidate", root, editable);
      return { detected: true, source: selection.source, root, editable };
    }
    const structural = detectStructuralSignal(element, root, editable);
    if (structural.detected) {
      if (structural.source === "chooser") markChooserActive("chooser");
      if (structural.source === "mention-trigger") markMentionQueryActive();
      return { ...structural, root, editable };
    }
    if (isAtMentionTrigger(event, editable)) {
      markMentionQueryActive();
      return { detected: true, source: "mention-trigger", root, editable };
    }
    return { detected: false, source: null, root, editable };
  }

  function detectStructuralSignal(element, root, editable) {
    for (const candidate of [element, root, editable]) {
      const signal = detectSignalInRoot(candidate);
      if (signal.detected) return signal;
    }
    const chooser = findActiveMentionChooser();
    if (chooser) return { detected: true, source: "chooser" };
    return { detected: false, source: null };
  }

  function detectSignalInRoot(root) {
    if (!(root instanceof Element) || isMicaNode(root)) return { detected: false, source: null };
    if (hasResolvedConnectorContext(root)) return { detected: true, source: "resolved-connector-pill" };
    if (root.matches?.("[data-mention], [data-token-type], [data-entity]")) return { detected: true, source: "chip" };
    if (root.querySelector?.("[data-mention], [data-token-type], [data-entity]")) return { detected: true, source: "chip" };
    const marked = root.querySelectorAll?.("[aria-label], [data-testid], [data-type], [role], [aria-controls], [aria-expanded], [data-radix-collection-item]") || [];
    for (const node of marked) {
      const source = sourceFromAttributes(node);
      if (source) return { detected: true, source };
    }
    const source = sourceFromAttributes(root);
    return source ? { detected: true, source } : { detected: false, source: null };
  }

  function sourceFromAttributes(node) {
    if (!(node instanceof Element) || isMicaNode(node)) return null;
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
    if (node.hasAttribute("data-radix-collection-item") && node.closest("[role='listbox'], [role='menu'], [role='dialog']")) return "chooser";
    return null;
  }

  function isChooserSelectionGesture(event, element, chooser = findActiveMentionChooser()) {
    if (!chooser) return false;
    if (event?.type === "keydown" && event.key === "Enter") return true;
    if ((event?.type === "pointerdown" || event?.type === "click") && element instanceof Element) {
      return element === chooser || chooser.contains(element);
    }
    return false;
  }

  function markChooserActive(source) {
    latch.chooserActiveUntil = Math.max(latch.chooserActiveUntil || 0, Date.now() + CHOOSER_ACTIVE_GRACE_MS);
    latch.chooserSource = sanitizeSource(source) === "unknown" ? "chooser" : sanitizeSource(source);
  }

  function markMentionQueryActive() {
    latch.mentionQueryUntil = Math.max(latch.mentionQueryUntil || 0, Date.now() + MENTION_QUERY_MS);
  }

  function markSelectionWindow(source, root = null, editable = null) {
    const now = Date.now();
    const activeRoot = root instanceof HTMLElement ? root : findComposerRoot(findComposerEditable());
    const activeEditable = editable instanceof HTMLElement ? editable : findComposerEditable();
    const rect = measureComposerRect(activeRoot || activeEditable) || latch.lastComposerRect;
    latch.selectionWindowUntil = now + SELECTION_WINDOW_MS;
    latch.selectionSource = sanitizeSource(source) === "unknown" ? "chooser-selection" : sanitizeSource(source);
    latch.selectionId = (latch.selectionId || 0) + 1;
    latch.lastComposerRect = rect || latch.lastComposerRect;
    latch.composerRootId = elementId(activeRoot) || latch.composerRootId;
    latch.editableId = elementId(activeEditable) || latch.editableId;
    return {
      source: latch.selectionSource,
      root: activeRoot,
      editable: activeEditable
    };
  }

  function findActiveMentionChooser() {
    const selectors = [
      "[data-testid*='mention' i]",
      "[data-testid*='connector' i]",
      "[aria-label*='mention' i]",
      "[aria-label*='connector' i]",
      "[role='listbox'][aria-activedescendant]",
      "[role='menu'][aria-activedescendant]",
      "[role='dialog'] [role='option']",
      "[role='dialog'] [role='menuitem']",
      "[data-radix-collection-item]"
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof Element) || isMicaNode(node)) continue;
        const owner = node.closest("[role='listbox'], [role='menu'], [role='dialog']") || node;
        const signal = [
          owner.getAttribute("role"),
          owner.getAttribute("aria-label"),
          owner.getAttribute("data-testid")
        ].filter(Boolean).join(" ");
        const chooserRole = /listbox|menu|dialog/i.test(signal);
        const controlledOpenChooser = owner.getAttribute("aria-expanded") === "true" && owner.hasAttribute("aria-controls");
        const collectionOption = node.hasAttribute("data-radix-collection-item");
        if (chooserRole || controlledOpenChooser || collectionOption) return owner;
      }
    }
    return null;
  }

  function isAtMentionTrigger(event, editable) {
    if (!isComposerEventTarget(event.target)) return false;
    if (event.type === "keydown") return event.key === "@" || (event.key === "2" && event.shiftKey);
    const inputType = typeof event.inputType === "string" ? event.inputType : "";
    const data = typeof event.data === "string" ? event.data : "";
    if (/insert/i.test(inputType) && data === "@") return true;
    if (!(editable instanceof HTMLElement)) return false;
    const text = readComposerText(editable);
    return /(^|\s)@$/.test(text);
  }

  function isMentionEnterSelectionCandidate(event, root, editable) {
    if (event?.type !== "keydown" || event.key !== "Enter") return false;
    if (!isComposerEventTarget(event.target)) return false;
    if (hasResolvedConnectorContext(root) || hasResolvedConnectorContext(editable)) return false;
    const now = Date.now();
    if (now > (latch.mentionQueryUntil || 0) && now > (latch.chooserActiveUntil || 0)) return false;
    const text = readComposerText(editable).trimEnd();
    return /(^|\s)@[\p{L}\p{N}_-]{0,64}$/u.test(text);
  }

  function hasResolvedConnectorContext(root) {
    if (!(root instanceof Element) || isMicaNode(root)) return false;
    if (isResolvedConnectorPill(root)) return true;
    return !!root.querySelector?.("[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:'], [data-inline-selection-pill][data-id^='plugin:'], [data-system-hint-type^='plugin:']");
  }

  function isResolvedConnectorPill(node) {
    if (!(node instanceof Element)) return false;
    if (node.matches?.("[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:']")) return true;
    if (node.matches?.("[data-inline-selection-pill][data-id^='plugin:']")) return true;
    return node.matches?.("[data-system-hint-type^='plugin:']") === true;
  }

  function expireIfNeeded() {
    if (latch.latched && Date.now() > latch.expiresAt) clearLatch("expired");
  }

  function clearLatch(reason) {
    if (latch.latched) latch.skippedReason = reason;
    latch = createEmptyLatch();
  }

  function publicLatch() {
    expireIfNeeded();
    const chooserOpen = !!findActiveMentionChooser();
    if (chooserOpen) markChooserActive("chooser");
    const now = Date.now();
    const chooserActiveNow = enabled && (chooserOpen || now <= (latch.chooserActiveUntil || 0));
    const selectionWindowActive = enabled && now <= (latch.selectionWindowUntil || 0);
    return {
      detected: !!latch.detected,
      latched: !!latch.latched,
      connectorLifecycleLatched: !!latch.latched,
      connectorContextLatched: !!latch.latched,
      chooserActiveNow,
      chooserSource: latch.chooserSource || null,
      selectionWindowActive,
      selectionSource: latch.selectionSource || null,
      selectionId: latch.selectionId || 0,
      mentionQueryActive: enabled && now <= (latch.mentionQueryUntil || 0),
      source: latch.source || null,
      latchId: latch.latchId || 0,
      ageMs: latch.latchedAt ? Math.max(0, Date.now() - latch.latchedAt) : 0,
      ttlMs: LATCH_TTL_MS,
      composerRootId: latch.composerRootId || null,
      editableId: latch.editableId || null,
      lastComposerRect: latch.lastComposerRect || null,
      skippedReason: latch.skippedReason || (enabled ? null : "disabled")
    };
  }

  function createEmptyLatch() {
    return {
      detected: false,
      latched: false,
      source: null,
      latchId,
      latchedAt: 0,
      expiresAt: 0,
      composerRootId: null,
      editableId: null,
      lastComposerRect: null,
      chooserActiveUntil: 0,
      chooserSource: null,
      selectionWindowUntil: 0,
      selectionSource: null,
      selectionId: 0,
      mentionQueryUntil: 0,
      skippedReason: null
    };
  }

  function dispatchLatchEvent() {
    try {
      dispatchEvent(new CustomEvent(EVENT_NAME, { detail: publicLatch() }));
    } catch (_error) {
      // Connector signal must never affect native connector behavior.
    }
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

  function readComposerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || "";
    return element.textContent ?? element.innerText ?? "";
  }

  function sanitizeSource(source) {
    if (/^(chip|chooser|chooser-selection|mention-enter-candidate|structural-marker|mention-trigger|resolved-connector-pill)$/.test(source)) return source;
    return "unknown";
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

  function isTrustedEvent(event) {
    return event?.isTrusted === true || document.documentElement.dataset.micaFixture === "true";
  }

  function elementId(element) {
    if (!(element instanceof Element)) return null;
    if (!ids.has(element)) ids.set(element, nextId++);
    return ids.get(element);
  }

  globalThis[GLOBAL_KEY] = {
    configure,
    setEnabled,
    getState,
    resetForTests,
    latchConnectorLifecycle,
    eventName: EVENT_NAME
  };
})();
