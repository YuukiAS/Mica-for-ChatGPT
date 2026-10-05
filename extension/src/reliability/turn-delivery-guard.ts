(() => {
  const STATES = Object.freeze({
    IDLE: "idle",
    AWAITING_USER_COMMIT: "awaiting_user_commit",
    USER_COMMITTED: "user_committed",
    ASSISTANT_GENERATING: "assistant_generating",
    SETTLED: "settled",
    GHOST_SEND: "ghost_send_suspected",
    FAKE_WAITING: "fake_waiting_suspected",
    STALE_RESPONSE: "stale_response_suspected",
    GENERATION_ERROR: "generation_error_recovery_available"
  });
  const fixtureTimings = typeof document !== "undefined" && document.documentElement.dataset.micaFixture === "true";
  const COMMIT_DEADLINE_MS = fixtureTimings ? Number(document.documentElement.dataset.micaTestCommitDeadlineMs) || 12000 : 12000;
  const FAKE_WAITING_MS = fixtureTimings ? Number(document.documentElement.dataset.micaTestFakeWaitingMs) || 45000 : 45000;
  const SETTLE_MS = fixtureTimings ? Number(document.documentElement.dataset.micaTestSettleMs) || 1800 : 1800;
  const TURN_SELECTOR = "[data-message-author-role], [data-testid^='conversation-turn-']";
  let enabled = true;
  let state = createInitialState();
  let observer = null;
  let deadlineTimer = 0;
  let settleTimer = 0;
  let notice = null;

  function createInitialState() {
    return {
      name: STATES.IDLE,
      sequence: 0,
      intentAt: 0,
      committedAt: 0,
      lastProgressAt: 0,
      promptLength: 0,
      promptFingerprint: null,
      promptText: "",
      baselineUserIds: [],
      baselineAssistantIds: [],
      baselineAssistantFingerprint: null,
      committedUserId: null,
      assistantId: null,
      assistantFingerprint: null,
      sensitiveContext: false,
      recoveryOffered: false,
      recoveryUsed: false,
      autoRecoveryCount: 0,
      reason: null
    };
  }

  function configure(options = {}) {
    enabled = options.enabled !== false;
    if (!enabled) reset("disabled");
    ensureObserver();
    return snapshot();
  }

  function recordSendIntent({ promptText = "", sensitiveContext = false, source = "unknown" } = {}) {
    if (!enabled || state.name !== STATES.IDLE && state.name !== STATES.SETTLED) return snapshot();
    const text = String(promptText);
    if (!text.trim()) return snapshot();
    clearTimers();
    state = {
      ...createInitialState(),
      name: STATES.AWAITING_USER_COMMIT,
      sequence: state.sequence + 1,
      intentAt: Date.now(),
      lastProgressAt: Date.now(),
      promptLength: text.length,
      promptFingerprint: fingerprint(text),
      promptText: text,
      sensitiveContext: !!sensitiveContext,
      baselineUserIds: collectTurnIds("user"),
      baselineAssistantIds: collectTurnIds("assistant"),
      baselineAssistantFingerprint: fingerprint(getTurnText(collectTurns("assistant").at(-1))),
      reason: source
    };
    deadlineTimer = setTimeout(checkCommitDeadline, COMMIT_DEADLINE_MS);
    notify();
    return snapshot();
  }

  function observe() {
    if (!enabled || state.name === STATES.IDLE || state.name === STATES.SETTLED) return;
    if (state.name === STATES.AWAITING_USER_COMMIT) {
      const committed = findNewMatchingUserTurn();
      if (!committed) return;
      state.name = STATES.USER_COMMITTED;
      state.committedAt = Date.now();
      state.lastProgressAt = Date.now();
      state.committedUserId = getTurnId(committed, 0);
      maybeClearCommittedResidual();
      state.promptText = "";
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(checkFakeWaiting, FAKE_WAITING_MS);
      notify();
    }

    if ([STATES.USER_COMMITTED, STATES.ASSISTANT_GENERATING].includes(state.name)) {
      maybeClearCommittedResidual();
      const assistant = findNewAssistantTurn();
      const generating = hasGenerationSignal();
      const generationError = findGenerationError();
      if (generationError) {
        state.name = STATES.GENERATION_ERROR;
        state.reason = generationError;
        state.recoveryOffered = true;
        showNotice("The response stopped with an error.", "Keep draft", () => dismissNotice());
        notify();
        return;
      }
      if (assistant || generating) {
        const assistantFingerprint = assistant ? fingerprint(getTurnText(assistant)) : null;
        if (assistantFingerprint && assistantFingerprint === state.baselineAssistantFingerprint) {
          state.name = STATES.STALE_RESPONSE;
          state.reason = "exact_duplicate_of_previous_assistant_turn";
          state.recoveryOffered = true;
          showNotice("This response may be stale.", "Dismiss", () => dismissNotice());
          notify();
          return;
        }
        state.name = STATES.ASSISTANT_GENERATING;
        state.lastProgressAt = Date.now();
        if (assistant) {
          state.assistantId = getTurnId(assistant, 0);
          const nextFingerprint = assistantFingerprint;
          if (nextFingerprint !== state.assistantFingerprint) {
            state.assistantFingerprint = nextFingerprint;
            clearTimeout(settleTimer);
            settleTimer = setTimeout(checkSettled, SETTLE_MS);
          }
        }
        notify();
      }
    }
  }

  function checkCommitDeadline() {
    if (state.name !== STATES.AWAITING_USER_COMMIT) return;
    const committed = findNewMatchingUserTurn();
    if (committed) {
      observe();
      return;
    }
    state.name = STATES.GHOST_SEND;
    state.reason = "no_matching_user_turn_before_deadline";
    state.recoveryOffered = true;
    const action = state.sensitiveContext ? "Dismiss" : "Restore draft";
    showNotice(
      state.sensitiveContext ? "Mica could not confirm that the message was sent." : "Your message may not have been sent.",
      action,
      state.sensitiveContext ? () => dismissNotice() : restoreDraft
    );
    notify();
  }

  function checkFakeWaiting() {
    if (![STATES.USER_COMMITTED, STATES.ASSISTANT_GENERATING].includes(state.name)) return;
    if (Date.now() - state.lastProgressAt < FAKE_WAITING_MS) {
      deadlineTimer = setTimeout(checkFakeWaiting, FAKE_WAITING_MS - (Date.now() - state.lastProgressAt));
      return;
    }
    state.name = STATES.FAKE_WAITING;
    state.reason = "no_generation_progress_before_deadline";
    state.recoveryOffered = true;
    showNotice("The response has not progressed.", "Dismiss", () => dismissNotice());
    notify();
  }

  function checkSettled() {
    if (state.name !== STATES.ASSISTANT_GENERATING || hasGenerationSignal()) return;
    const assistant = findNewAssistantTurn();
    if (!assistant) return;
    const nextFingerprint = fingerprint(getTurnText(assistant));
    if (!nextFingerprint || nextFingerprint !== state.assistantFingerprint) {
      state.assistantFingerprint = nextFingerprint;
      settleTimer = setTimeout(checkSettled, SETTLE_MS);
      return;
    }
    state.name = STATES.SETTLED;
    state.promptText = "";
    state.lastProgressAt = Date.now();
    clearTimers();
    dismissNotice();
    notify();
  }

  function restoreDraft() {
    if (state.recoveryUsed || state.sensitiveContext || !state.promptText) return false;
    const composer = findComposer();
    if (!composer || getComposerValue(composer).trim()) return false;
    setComposerValue(composer, state.promptText);
    state.recoveryUsed = true;
    state.promptText = "";
    dismissNotice();
    notify();
    return true;
  }

  function maybeClearCommittedResidual() {
    if (state.autoRecoveryCount >= 1 || !state.promptFingerprint) return false;
    const composer = findComposer();
    if (!composer) return false;
    const value = getComposerValue(composer);
    if (!value || fingerprint(value) !== state.promptFingerprint) return false;
    setComposerValue(composer, "");
    state.autoRecoveryCount += 1;
    state.reason = "confirmed_commit_matching_residual_cleared";
    return true;
  }

  function reset(reason = "manual") {
    clearTimers();
    dismissNotice();
    state = { ...createInitialState(), sequence: state.sequence, reason };
    notify();
  }

  function ensureObserver() {
    if (observer || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    observer = new MutationObserver(() => queueMicrotask(observe));
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function findComposer() {
    return document.querySelector("textarea#mobile-composer-prompt, textarea[data-testid*='composer'], textarea, [contenteditable='true'][role='textbox']");
  }

  function getComposerValue(composer) {
    return composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
      ? composer.value
      : composer.textContent || "";
  }

  function setComposerValue(composer, value) {
    if (composer instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(composer, value);
    } else if (composer instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(composer, value);
    } else {
      composer.textContent = value;
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
    composer.focus();
  }

  function collectTurnIds(role) {
    return collectTurns(role).map((turn, index) => getTurnId(turn, index));
  }

  function collectTurns(role) {
    return Array.from(document.querySelectorAll(`[data-message-author-role='${role}']`))
      .map((node) => node.closest(TURN_SELECTOR) || node)
      .filter((node, index, all) => all.indexOf(node) === index);
  }

  function findNewMatchingUserTurn() {
    const baseline = new Set(state.baselineUserIds);
    return collectTurns("user").find((turn, index) => {
      if (baseline.has(getTurnId(turn, index))) return false;
      const text = getTurnText(turn);
      return text.length > 0 && fingerprint(text) === state.promptFingerprint;
    }) || null;
  }

  function findNewAssistantTurn() {
    const baseline = new Set(state.baselineAssistantIds);
    const turns = collectTurns("assistant");
    return turns.find((turn, index) => !baseline.has(getTurnId(turn, index))) || null;
  }

  function getTurnId(turn, index) {
    return turn.getAttribute("data-turn-id")
      || turn.getAttribute("data-testid")
      || turn.id
      || `${turn.getAttribute("data-message-author-role") || "turn"}:${index}`;
  }

  function getTurnText(turn) {
    if (!turn) return "";
    return String(turn.textContent || "").replace(/\s+/g, " ").trim();
  }

  function hasGenerationSignal() {
    return !!Array.from(document.querySelectorAll("button, [role='button']")).find((button) =>
      /stop|停止|停止生成/i.test(`${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`)
    );
  }

  function findGenerationError() {
    const node = Array.from(document.querySelectorAll("[role='alert'], [data-testid*='error']")).find((item) =>
      /error|出错|网络|network|failed|失败/i.test(item.textContent || "")
    );
    return node ? "generation_error_signal" : null;
  }

  function hasSensitiveContext(form) {
    return !!form?.querySelector("[data-testid*='attachment'], [data-testid*='file'], [data-testid*='connector'], [data-testid*='tool'], [aria-label*='connector' i], [aria-label*='连接器']");
  }

  function showNotice(message, actionLabel, action) {
    dismissNotice();
    const composer = findComposer();
    const form = composer?.closest("form");
    if (!form) return;
    notice = document.createElement("div");
    notice.dataset.micaUi = "delivery-notice";
    notice.className = "mica-delivery-notice";
    notice.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = message;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = actionLabel;
    button.addEventListener("click", action, { once: true });
    notice.append(text, button);
    form.parentElement?.insertBefore(notice, form);
  }

  function dismissNotice() {
    notice?.remove();
    notice = null;
  }

  function snapshot() {
    return {
      name: state.name,
      sequence: state.sequence,
      intentAt: state.intentAt,
      committedAt: state.committedAt,
      lastProgressAt: state.lastProgressAt,
      promptLength: state.promptLength,
      promptFingerprint: state.promptFingerprint,
      promptTextIncluded: false,
      committedUserId: state.committedUserId,
      assistantId: state.assistantId,
      sensitiveContext: state.sensitiveContext,
      recoveryOffered: state.recoveryOffered,
      recoveryUsed: state.recoveryUsed,
      autoRecoveryCount: state.autoRecoveryCount,
      reason: state.reason
    };
  }

  function notify() {
    globalThis.dispatchEvent?.(new CustomEvent("mica:delivery-state", { detail: snapshot() }));
  }

  function clearTimers() {
    clearTimeout(deadlineTimer);
    clearTimeout(settleTimer);
    deadlineTimer = 0;
    settleTimer = 0;
  }

  function fingerprint(value) {
    let hash = 2166136261;
    const normalized = String(value).replace(/\s+/g, " ").trim();
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}:${normalized.length}`;
  }

  function reduce(current, event) {
    const name = current?.name || STATES.IDLE;
    if (event === "send_intent" && [STATES.IDLE, STATES.SETTLED].includes(name)) return STATES.AWAITING_USER_COMMIT;
    if (event === "user_commit" && name === STATES.AWAITING_USER_COMMIT) return STATES.USER_COMMITTED;
    if (event === "assistant_progress" && [STATES.USER_COMMITTED, STATES.ASSISTANT_GENERATING].includes(name)) return STATES.ASSISTANT_GENERATING;
    if (event === "settled" && name === STATES.ASSISTANT_GENERATING) return STATES.SETTLED;
    if (event === "commit_timeout" && name === STATES.AWAITING_USER_COMMIT) return STATES.GHOST_SEND;
    if (event === "progress_timeout" && [STATES.USER_COMMITTED, STATES.ASSISTANT_GENERATING].includes(name)) return STATES.FAKE_WAITING;
    if (event === "stale_response") return STATES.STALE_RESPONSE;
    if (event === "generation_error") return STATES.GENERATION_ERROR;
    return name;
  }

  globalThis.MicaTurnDeliveryGuard = {
    STATES,
    configure,
    recordSendIntent,
    observe,
    reset,
    restoreDraft,
    snapshot,
    fingerprint,
    reduce,
    getComposerValue,
    hasSensitiveContext
  };
})();
