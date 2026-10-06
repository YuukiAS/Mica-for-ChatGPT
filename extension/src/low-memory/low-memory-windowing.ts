(() => {
  const TURN_SELECTOR = "[data-testid^='conversation-turn-']";
  const ROLE_SELECTOR = "[data-message-author-role='user'], [data-message-author-role='assistant'], [data-message-author-role='tool']";
  const BYPASS_KEY = "mica.lowMemory.bypass.v1";
  const DOM_THRESHOLD = 120;
  const DEFAULT_KEEP_COUNT = 40;
  const UNSAFE_GLOBAL_SELECTOR = "[role='dialog'], [data-is-streaming='true'], [data-testid*='stop'], [aria-label*='Stop generating' i], [aria-label*='停止生成']";
  const UNSAFE_TURN_SELECTOR = "input, textarea, select, form, iframe, [contenteditable='true'], [data-testid*='file'], [data-testid*='attachment'], [data-testid*='connector'], [data-testid*='auth'], [data-testid*='oauth']";
  let enabled = true;
  let keepCount = DEFAULT_KEEP_COUNT;
  let scheduled = false;
  let observer = null;
  let suppressedUntil = 0;
  let state = createState();

  function createState() {
    return {
      state: "standby",
      mode: "none",
      active: false,
      totalTurns: 0,
      keptTurns: 0,
      removedTurns: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      reloadRequired: false,
      reason: "initializing",
      contentUpload: false
    };
  }

  async function configure(options = {}) {
    const wasEnabled = enabled;
    enabled = options.enabled !== false;
    keepCount = clamp(Number(options.keepCount) || DEFAULT_KEEP_COUNT, 20, 80);
    ensureObserver();
    if (options.userInitiated && enabled && !wasEnabled) clearBypass();
    if (!enabled) {
      if (state.active) {
        state = { ...state, state: "restore_required", reloadRequired: true, reason: "disabled_after_windowing" };
        dispatchUpdate();
        if (options.userInitiated && safeToReload()) setTimeout(() => requestFullHistory("disabled"), 80);
      } else {
        removeHistoryControl();
        state = { ...createState(), state: "disabled", reason: "disabled_by_user" };
        dispatchUpdate();
      }
      return snapshot();
    }
    scheduleApply("configure");
    return snapshot();
  }

  function ensureObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    globalThis.addEventListener?.("mica-low-memory-page-status", handlePageStatus);
    observer = new MutationObserver((mutations) => {
      if (!enabled || Date.now() < suppressedUntil || mutations.every(isIgnoredMutation)) return;
      scheduleApply("structure");
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });
  }

  function handlePageStatus() {
    scheduleApply("page_status");
  }

  function scheduleApply(reason) {
    if (!enabled || scheduled) return;
    scheduled = true;
    const callback = () => {
      scheduled = false;
      applyWindowing(reason);
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(callback, { timeout: 900 });
    else setTimeout(callback, 500);
  }

  function applyWindowing(reason = "manual") {
    if (!enabled) return snapshot();
    if (isBypassedConversation()) {
      removeHistoryControl();
      state = { ...createState(), state: "full_history", reason: "conversation_bypass" };
      dispatchUpdate();
      return snapshot();
    }
    const page = readPageStatus();
    if (page?.active && page.mode === "data_window") {
      ensureHistoryControl(page.removedTurns, page.keptTurns, "data_window");
      state = { ...createState(), ...page, reloadRequired: false, reason: "response_mapping_windowed" };
      dispatchUpdate();
      return snapshot();
    }
    if (document.querySelector(UNSAFE_GLOBAL_SELECTOR)) {
      state = { ...createState(), state: "degraded", reason: "active_sensitive_or_streaming_surface" };
      dispatchUpdate();
      return snapshot();
    }
    const turns = collectTurns();
    if (turns.length < DOM_THRESHOLD) {
      state = {
        ...createState(),
        state: isPageFailOpen(page?.state) ? "degraded" : "standby",
        mode: "none",
        totalTurns: turns.length,
        keptTurns: turns.length,
        reason: page?.state || "below_dom_threshold"
      };
      dispatchUpdate();
      return snapshot();
    }
    const parent = turns[0]?.parentElement;
    if (!parent || turns.some((turn) => turn.parentElement !== parent) || turns.some((turn) => !isSafeTurn(turn))) {
      state = { ...createState(), state: "degraded", totalTurns: turns.length, keptTurns: turns.length, reason: "ambiguous_or_sensitive_turn_structure" };
      dispatchUpdate();
      return snapshot();
    }
    const cut = Math.max(0, turns.length - keepCount);
    const removable = turns.slice(0, cut);
    if (!removable.length) return snapshot();
    const estimatedBytes = removable.reduce((total, turn) => total + String(turn.outerHTML || "").length * 2, 0);
    suppressedUntil = Date.now() + 700;
    for (const turn of removable) turn.remove();
    ensureHistoryControl(removable.length, turns.length - removable.length, "dom_window", parent, turns[cut]);
    state = {
      ...createState(),
      state: "active",
      mode: "dom_window",
      active: true,
      totalTurns: turns.length,
      keptTurns: turns.length - removable.length,
      removedTurns: removable.length,
      bytesBefore: estimatedBytes,
      bytesAfter: 0,
      reloadRequired: true,
      reason
    };
    dispatchUpdate();
    return snapshot();
  }

  function collectTurns() {
    const candidates = Array.from(document.querySelectorAll(TURN_SELECTOR)).filter((node) => node instanceof HTMLElement && !node.closest("[data-mica-ui]"));
    return candidates.filter((turn) => {
      const roles = turn.querySelectorAll(ROLE_SELECTOR);
      return roles.length === 1;
    });
  }

  function isSafeTurn(turn) {
    if (!(turn instanceof HTMLElement) || !/^conversation-turn-/.test(turn.dataset.testid || "")) return false;
    if (turn.querySelector(UNSAFE_TURN_SELECTOR)) return false;
    const role = turn.querySelector(ROLE_SELECTOR)?.getAttribute("data-message-author-role");
    return role === "user" || role === "assistant";
  }

  function ensureHistoryControl(removed, kept, mode, parent = null, before = null) {
    let control = document.querySelector("[data-mica-ui='history-window']");
    if (!control) {
      control = document.createElement("div");
      control.dataset.micaUi = "history-window";
      control.className = "mica-history-window";
      const text = document.createElement("span");
      text.dataset.micaUi = "history-window-label";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Load full history";
      button.addEventListener("click", () => requestFullHistory("history_control"));
      control.append(text, button);
    }
    control.querySelector("[data-mica-ui='history-window-label']").textContent = `${removed} older turns are paused to reduce memory. ${kept} recent turns stay active.`;
    control.dataset.micaWindowMode = mode;
    if (!control.isConnected) {
      const targetParent = parent || document.querySelector(TURN_SELECTOR)?.parentElement;
      if (targetParent) targetParent.insertBefore(control, before || targetParent.firstChild);
    }
  }

  function removeHistoryControl() {
    document.querySelector("[data-mica-ui='history-window']")?.remove();
  }

  function requestFullHistory(reason = "manual") {
    try { sessionStorage.setItem(BYPASS_KEY, `${location.origin}${location.pathname}`); } catch (_error) { /* reload still fails open */ }
    state = { ...state, state: "restoring", active: false, reloadRequired: false, reason };
    dispatchUpdate();
    location.reload();
  }

  function clearBypass() {
    try { sessionStorage.removeItem(BYPASS_KEY); } catch (_error) { /* unavailable storage stays fail-open */ }
  }

  function isBypassedConversation() {
    try { return sessionStorage.getItem(BYPASS_KEY) === `${location.origin}${location.pathname}`; } catch (_error) { return false; }
  }

  function safeToReload() {
    const composer = document.querySelector("textarea#prompt-textarea, textarea#mobile-composer-prompt, [contenteditable='true'][role='textbox']");
    const value = composer instanceof HTMLTextAreaElement ? composer.value : composer?.textContent || "";
    return !String(value).trim() && !document.querySelector(UNSAFE_GLOBAL_SELECTOR);
  }

  function readPageStatus() {
    try { return JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status") || "null"); } catch (_error) { return null; }
  }

  function isPageFailOpen(pageState) {
    return ["shape_unrecognized", "graph_invalid", "root_unrecognized", "cut_unavailable", "recent_branch_detected", "processing_failed"].includes(pageState);
  }

  function isIgnoredMutation(mutation) {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    return !!target?.closest?.("[data-mica-ui], form, textarea, input, [contenteditable='true']");
  }

  function snapshot() {
    return { ...state, enabled, keepCount, contentUpload: false };
  }

  function dispatchUpdate() {
    const next = snapshot();
    document.documentElement.dataset.micaLowMemoryStatus = JSON.stringify(next);
    globalThis.dispatchEvent?.(new CustomEvent("mica:low-memory-updated", { detail: next }));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  globalThis.MicaLowMemoryWindowing = { configure, applyWindowing, snapshot, requestFullHistory, safeToReload };
})();
