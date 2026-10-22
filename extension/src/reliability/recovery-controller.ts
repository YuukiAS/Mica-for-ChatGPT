(() => {
  const machine = globalThis.MicaRecoveryStateMachine;
  const SESSION_PREFIX = "mica.recovery.v1.";
  let adapter = null;
  let config = null;
  let getConversationKey = () => location.pathname;
  let state = machine?.create?.({ conversationKey: location.pathname }) || null;
  let tabId = 0;
  let sessionKey = null;
  let draft = "";
  let timer = 0;
  let frame = 0;
  let configured = false;
  let submitListenerInstalled = false;
  let notice = null;
  let actionInFlight = null;

  async function configure(options = {}) {
    if (!machine) return { ok: false, reason: "state_machine_unavailable" };
    adapter = options.adapter || adapter;
    getConversationKey = typeof options.getConversationKey === "function" ? options.getConversationKey : getConversationKey;
    config = machine.sanitizeConfig(options.settings || config || {});
    configured = !!adapter && config.enabled;
    if (!submitListenerInstalled && typeof addEventListener === "function") {
      addEventListener("submit", handleSubmit, true);
      submitListenerInstalled = true;
    }
    const context = await sendRuntime({ type: "MICA_RELIABILITY_CONTEXT" });
    tabId = Number.isInteger(context?.tabId) ? context.tabId : 0;
    sessionKey = `${SESSION_PREFIX}${tabId}`;
    actionInFlight = null;
    const restored = await restoreSnapshot();
    if (!restored) state = machine.create({ tabId, conversationKey: currentConversationKey() });
    scheduleReconcile();
    scheduleTick();
    return { ok: configured, snapshot: snapshot() };
  }

  function handleSubmit(event) {
    if (!configured || !event.isTrusted) return;
    const composer = adapter.findComposer(document)?.element;
    const form = composer?.closest("form");
    if (!composer || (form && event.target !== form)) return;
    const value = composerValue(composer);
    if (!value.trim()) return;
    recordSendIntent(value, {
      source: "trusted_submit",
      sensitiveContext: hasSensitiveContext(form),
      consequentialAction: hasConsequentialContext(form),
      toolSafety: hasSensitiveContext(form) ? "unknown" : "none"
    });
  }

  function recordSendIntent(promptText, evidence = {}) {
    if (!configured || !String(promptText || "").trim()) return snapshot();
    const turns = adapter.listTurns(document);
    const scope = { tabId, conversationKey: currentConversationKey(), turnKey: null };
    const next = machine.transition(state, {
      type: "SEND_INTENT",
      scope,
      promptFingerprint: fingerprint(promptText),
      baselineUserIds: turns.filter((turn) => turn.role === "user").map((turn) => turn.turnId),
      baselineAssistantIds: turns.filter((turn) => turn.role === "assistant").map((turn) => turn.turnId),
      draftAvailable: true,
      sensitiveContext: evidence.sensitiveContext === true,
      consequentialAction: evidence.consequentialAction === true,
      toolSafety: evidence.toolSafety || "none"
    }, config);
    if (next.phase !== machine.phases.AWAITING_USER_COMMIT || next.sequence <= (state?.sequence || 0)) return snapshot();
    draft = String(promptText).slice(0, 200_000);
    state = next;
    actionInFlight = null;
    void persistSnapshot();
    scheduleReconcile();
    scheduleTick();
    return snapshot();
  }

  function scheduleReconcile() {
    if (!configured || frame || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      reconcile();
    });
  }

  function reconcile() {
    if (!configured || !state || isTerminal(state.phase)) return snapshot();
    const conversationKey = currentConversationKey();
    if (state.scope.conversationKey !== "unknown" && state.scope.conversationKey !== conversationKey) {
      state = machine.transition(state, { type: "CONTEXT_CHANGED" }, config);
      void finishSnapshot();
      return snapshot();
    }
    const turns = adapter.listTurns(document);
    if (state.phase === machine.phases.AWAITING_USER_COMMIT) {
      const baseline = new Set(state.baselineUserIds);
      const committed = turns.find((turn) => turn.role === "user" && !baseline.has(turn.turnId) && fingerprint(turn.roleElement?.textContent || "") === state.promptFingerprint);
      if (committed) {
        state = machine.transition(state, { type: "USER_COMMITTED", turnId: committed.turnId }, config);
        draft = "";
      }
    }
    if ([machine.phases.USER_COMMITTED, machine.phases.ASSISTANT_GENERATING, machine.phases.RECONCILING].includes(state.phase)) {
      const baseline = new Set(state.baselineAssistantIds);
      const assistants = turns.filter((turn) => turn.role === "assistant" && (!baseline.has(turn.turnId) || turn.turnId === state.assistantTurnId));
      const assistant = assistants.at(-1);
      if (assistant) {
        const signature = answerProgressSignature(assistant);
        const generationState = adapter.generationStateForTurn(assistant);
        const toolSafety = toolSafetyForTurn(assistant);
        if (toolSafety !== "none" && signature && signature !== state.progressSignature) {
          state = machine.transition(state, { type: "TOOL_PROGRESS", turnId: assistant.turnId, progressSignature: signature, toolSafety }, config);
          if (isTerminal(state.phase)) {
            void applyPendingAction();
            return snapshot();
          }
          if (generationState === "SETTLED") {
            state = machine.transition(state, { type: "SETTLED" }, config);
            void finishSnapshot();
            return snapshot();
          }
        } else if (signature && signature !== state.progressSignature) {
          state = machine.transition(state, { type: state.assistantTurnId ? "MEANINGFUL_PROGRESS" : "ASSISTANT_STARTED", turnId: assistant.turnId, progressSignature: signature }, config);
          if (generationState === "SETTLED") {
            state = machine.transition(state, { type: "SETTLED" }, config);
            void finishSnapshot();
            return snapshot();
          }
        } else if (generationState === "SETTLED" && signature && state.assistantTurnId === assistant.turnId) {
          state = machine.transition(state, { type: "SETTLED" }, config);
          void finishSnapshot();
          return snapshot();
        }
      }
    }
    void persistSnapshot();
    scheduleTick();
    return snapshot();
  }

  function scheduleTick() {
    clearTimeout(timer);
    if (!configured || !state || isTerminal(state.phase)) return;
    const now = Date.now();
    let deadline = now + 1000;
    if (state.phase === machine.phases.AWAITING_USER_COMMIT) deadline = state.intentAt + config.commitConfirmationTimeoutSeconds * 1000;
    else if ([machine.phases.USER_COMMITTED, machine.phases.ASSISTANT_GENERATING].includes(state.phase)) deadline = state.lastMeaningfulProgressAt + config.noProgressTimeoutSeconds * 1000;
    else if (state.phase === machine.phases.RECONCILING) deadline = state.reconcileStartedAt + config.postReloadReconcileTimeoutSeconds * 1000;
    timer = setTimeout(runTick, Math.max(250, deadline - now));
  }

  function runTick() {
    timer = 0;
    if (!configured || !state) return;
    state = machine.transition(state, { type: "TICK" }, config);
    void applyPendingAction();
  }

  async function applyPendingAction() {
    const action = state?.pendingAction;
    if (!action) {
      await persistSnapshot();
      scheduleTick();
      return;
    }
    if (action.type === "reload") {
      const claim = machine.actionClaim(state);
      if (!claim) return handleRecoveryBackendUnavailable();
      if (actionInFlight === claim.actionId) return;
      actionInFlight = claim.actionId;
      const persisted = await persistSnapshot();
      if (!persisted) return handleRecoveryBackendUnavailable();
      const granted = await sendRuntime({ type: "MICA_RELIABILITY_CLAIM_ACTION", claim });
      if (!granted?.ok) return handleRecoveryBackendUnavailable();
      if (!granted.granted) {
        actionInFlight = null;
        return;
      }
      if (document.documentElement.dataset.micaFixture === "true" && typeof globalThis.__MICA_FIXTURE_RELOAD__ === "function") globalThis.__MICA_FIXTURE_RELOAD__();
      else location.reload();
      return;
    }
    const manualMode = action.type === "offer_restore_draft"
      ? "restore"
      : state.submissionStatus === machine.submission.UNKNOWN && draft ? "copy" : "unsafe";
    const preserveDraft = manualMode === "restore" || manualMode === "copy";
    if (preserveDraft) await persistSnapshot(true);
    if (config.showRecoveryNotifications) showNotice(manualMode);
    await finishSnapshot(!preserveDraft);
  }

  async function restoreSnapshot() {
    if (!sessionKey || !globalThis.chrome?.storage?.session) return false;
    const stored = await getStorage(globalThis.chrome.storage.session, { [sessionKey]: null });
    const envelope = stored?.[sessionKey];
    if (!envelope || Number(envelope.expiresAt) <= Date.now() || envelope.conversationKey !== currentConversationKey()) {
      await removeStorage(globalThis.chrome.storage.session, sessionKey);
      return false;
    }
    const restored = machine.sanitizeSnapshot(envelope.state);
    if (!restored || ![machine.phases.RELOADING, machine.phases.MANUAL_REQUIRED].includes(restored.phase)) {
      await removeStorage(globalThis.chrome.storage.session, sessionKey);
      return false;
    }
    state = restored.phase === machine.phases.RELOADING
      ? machine.transition(restored, { type: "PAGE_RESTORED" }, config)
      : restored;
    draft = typeof envelope.draft === "string" ? envelope.draft.slice(0, 200_000) : "";
    if (state.phase === machine.phases.RECONCILING) await persistSnapshot();
    else if (config.showRecoveryNotifications && draft) showNotice(state.submissionStatus === machine.submission.NOT_COMMITTED ? "restore" : "copy");
    return true;
  }

  async function persistSnapshot(includeTerminal = false) {
    if (!sessionKey || !state || !globalThis.chrome?.storage?.session || (!includeTerminal && isTerminal(state.phase))) return false;
    const ttlMinutes = config?.recoverySnapshotTtlMinutes || 30;
    const envelope = {
      schemaVersion: 1,
      tabId,
      conversationKey: state.scope.conversationKey,
      expiresAt: Date.now() + ttlMinutes * 60_000,
      state: machine.snapshotForStorage(state),
      draft: state.draftAvailable ? draft : ""
    };
    return setStorage(globalThis.chrome.storage.session, { [sessionKey]: envelope });
  }

  async function finishSnapshot(remove = true) {
    clearTimeout(timer);
    actionInFlight = null;
    if (config?.recordPrivacySafeRecoveryHistory) await appendHistory();
    if (remove && sessionKey && globalThis.chrome?.storage?.session) await removeStorage(globalThis.chrome.storage.session, sessionKey);
  }

  async function appendHistory() {
    const entry = machine.historyEntry(state);
    if (!entry) return;
    await sendRuntime({ type: "MICA_RELIABILITY_APPEND_HISTORY", entry });
  }

  async function handleRecoveryBackendUnavailable() {
    actionInFlight = null;
    state = machine.transition(state, { type: "RECOVERY_BACKEND_UNAVAILABLE" }, config);
    if (config.showRecoveryNotifications) showNotice("unsafe");
    await finishSnapshot();
    return snapshot();
  }

  function showNotice(mode) {
    notice?.remove();
    notice = document.createElement("div");
    notice.dataset.micaUi = "recovery-notice";
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;max-width:320px;padding:12px;border:1px solid #8a8f8d;border-radius:10px;background:Canvas;color:CanvasText;font:13px/1.4 system-ui;box-shadow:0 8px 28px #0003";
    const text = document.createElement("span");
    text.textContent = mode === "restore"
      ? "Mica confirmed that this message was not submitted. Restore the saved draft when the composer is empty."
      : mode === "copy"
        ? "Mica could not confirm delivery. Copy the saved draft and compare it with the conversation before sending anything."
        : "Mica stopped automatic recovery because the state is not safe to repeat.";
    notice.append(text);
    if (mode === "restore" || mode === "copy") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = mode === "restore" ? "Restore draft" : "Copy saved draft";
      button.style.cssText = "display:block;margin-top:8px";
      button.addEventListener("click", mode === "restore" ? restoreDraft : copyDraft, { once: true });
      notice.append(button);
    }
    document.documentElement.append(notice);
  }

  function restoreDraft(event) {
    if (!event?.isTrusted || state?.submissionStatus !== machine.submission.NOT_COMMITTED || !draft) return false;
    const composer = adapter.findComposer(document)?.element;
    if (!composer || composerValue(composer).trim()) return false;
    setComposerValue(composer, draft);
    clearManualDraft();
    return true;
  }

  async function copyDraft(event) {
    if (!event?.isTrusted || state?.submissionStatus !== machine.submission.UNKNOWN || !draft || !navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(draft);
      clearManualDraft();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clearManualDraft() {
    draft = "";
    notice?.remove();
    notice = null;
    state = machine.transition(state, { type: "RESET", scope: { tabId, conversationKey: currentConversationKey() } }, config);
    if (sessionKey && globalThis.chrome?.storage?.session) void removeStorage(globalThis.chrome.storage.session, sessionKey);
  }

  function onContextChanged() {
    if (!state || state.scope.conversationKey === currentConversationKey()) return;
    state = machine.transition(state, { type: "CONTEXT_CHANGED" }, config);
    void finishSnapshot();
  }

  function updateSettings(value) {
    config = machine.sanitizeConfig(value || {});
    configured = !!adapter && config.enabled;
    if (!configured) {
      clearTimeout(timer);
      if (state) state = machine.transition(state, { type: "CONTEXT_CHANGED" }, config);
      draft = "";
      notice?.remove();
      notice = null;
      void finishSnapshot();
    } else scheduleTick();
    return snapshot();
  }

  function snapshot() {
    const safe = machine?.snapshotForStorage?.(state);
    return safe ? { ...safe, draftIncluded: false, configured, tabScoped: tabId > 0 } : null;
  }

  function answerProgressSignature(turn) {
    const text = String(turn?.answerRoot?.textContent || "").replace(/\s+/g, " ").trim();
    const toolStages = turn?.element?.querySelectorAll?.("[data-testid*='tool'],[data-testid*='search'],[data-mica-tool-stage]")?.length || 0;
    return text || toolStages ? `${fingerprint(text)}:stages=${toolStages}` : null;
  }

  function toolSafetyForTurn(turn) {
    const root = turn?.element;
    if (!root?.querySelector) return "none";
    if (root.querySelector("[data-mica-tool-safety='consequential'],[data-testid*='write'],[data-testid*='purchase'],[data-testid*='delete'],[data-testid*='send-email']")) return "consequential";
    if (root.querySelector("[data-mica-tool-safety='read-only']")) return "read_only";
    if (root.querySelector("[data-testid*='tool'],[data-testid*='search'],[data-mica-tool-stage]")) return "unknown";
    return "none";
  }

  function currentConversationKey() {
    return String(getConversationKey() || "unknown").slice(0, 300);
  }

  function composerValue(composer) {
    return composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement ? composer.value : composer.textContent || "";
  }

  function setComposerValue(composer, value) {
    if (composer instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, value);
    else if (composer instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, value);
    else composer.textContent = value;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
    composer.focus();
  }

  function hasSensitiveContext(form) {
    return !!form?.querySelector("[data-testid*='attachment'],[data-testid*='file'],[data-testid*='connector'],[data-testid*='tool'],[aria-label*='connector' i],[aria-label*='连接器']");
  }

  function hasConsequentialContext(form) {
    return !!form?.querySelector("[data-mica-consequential='true'],[data-testid*='write'],[data-testid*='purchase'],[data-testid*='delete'],[data-testid*='send-email']");
  }

  function isTerminal(phase) {
    return [machine.phases.MANUAL_REQUIRED, machine.phases.SETTLED, machine.phases.CANCELLED].includes(phase);
  }

  function fingerprint(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}:${normalized.length}`;
  }

  function sendRuntime(message) {
    return new Promise((resolve) => {
      const runtime = globalThis.chrome?.runtime;
      if (!runtime?.sendMessage) return resolve(null);
      runtime.sendMessage(message, (response) => resolve(runtime.lastError ? null : response));
    });
  }

  function getStorage(area, defaults) {
    return new Promise((resolve) => area.get(defaults, (items) => resolve(globalThis.chrome?.runtime?.lastError ? defaults : items || defaults)));
  }

  function setStorage(area, value) {
    return new Promise((resolve) => area.set(value, () => resolve(!globalThis.chrome?.runtime?.lastError)));
  }

  function removeStorage(area, key) {
    return new Promise((resolve) => area.remove(key, () => resolve(!globalThis.chrome?.runtime?.lastError)));
  }

  globalThis.MicaRecoveryController = Object.freeze({ configure, updateSettings, recordSendIntent, scheduleReconcile, reconcile, onContextChanged, snapshot, fingerprint });
})();
