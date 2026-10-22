(() => {
  const MODEL_VERSION = 1;
  const actionPolicy = globalThis.MicaRecoveryActionPolicy;
  const PHASES = Object.freeze({
    IDLE: "idle",
    AWAITING_USER_COMMIT: "awaiting_user_commit",
    USER_COMMITTED: "user_committed",
    ASSISTANT_GENERATING: "assistant_generating",
    STALLED: "stalled",
    ACTION_BACKOFF: "action_backoff",
    NATIVE_STOP_SETTLING: "native_stop_settling",
    RELOADING: "reloading",
    RECONCILING: "reconciling",
    MANUAL_REQUIRED: "manual_required",
    SETTLED: "settled",
    CANCELLED: "cancelled"
  });
  const SUBMISSION = Object.freeze({ COMMITTED: "A_COMMITTED", NOT_COMMITTED: "B_NOT_COMMITTED", UNKNOWN: "C_UNKNOWN" });
  const TERMINAL = new Set([PHASES.MANUAL_REQUIRED, PHASES.SETTLED, PHASES.CANCELLED]);

  function create(scope = {}, now = Date.now()) {
    return {
      schemaVersion: MODEL_VERSION,
      phase: PHASES.IDLE,
      sequence: 0,
      scope: sanitizeScope(scope),
      submissionStatus: SUBMISSION.UNKNOWN,
      intentAt: 0,
      committedAt: 0,
      lastMeaningfulProgressAt: 0,
      reconcileStartedAt: 0,
      reloadCount: 0,
      recoveryCycle: 0,
      nativeStopCount: 0,
      resendCount: 0,
      assistantRetryCount: 0,
      actionStartedAt: 0,
      promptFingerprint: null,
      baselineUserIds: [],
      baselineAssistantIds: [],
      committedTurnId: null,
      assistantTurnId: null,
      progressSignature: null,
      draftAvailable: false,
      sensitiveContext: false,
      consequentialAction: false,
      toolSafety: "none",
      userStopped: false,
      reason: "initialized",
      pendingAction: null,
      updatedAt: now
    };
  }

  function transition(current, event = {}, rawConfig = {}, now = Date.now()) {
    const config = sanitizeConfig(rawConfig);
    const state = sanitizeSnapshot(current) || create(event.scope, now);
    const type = String(event.type || "");
    let next = { ...state, pendingAction: null, updatedAt: now };

    if (type === "SEND_INTENT") {
      if (![PHASES.IDLE, PHASES.SETTLED, PHASES.CANCELLED].includes(state.phase)) return state;
      next = {
        ...create(event.scope || state.scope, now),
        phase: PHASES.AWAITING_USER_COMMIT,
        sequence: state.sequence + 1,
        scope: sanitizeScope(event.scope || state.scope),
        intentAt: now,
        lastMeaningfulProgressAt: now,
        promptFingerprint: boundedString(event.promptFingerprint, 160),
        baselineUserIds: boundedIds(event.baselineUserIds),
        baselineAssistantIds: boundedIds(event.baselineAssistantIds),
        draftAvailable: event.draftAvailable === true,
        sensitiveContext: event.sensitiveContext === true,
        consequentialAction: event.consequentialAction === true,
        toolSafety: oneOf(event.toolSafety, ["none", "read_only", "consequential", "unknown"], "none"),
        reason: "send_intent",
        updatedAt: now
      };
      return next;
    }

    if (type === "ACTION_EVIDENCE") return authorizeAction(state, event.evidence, config, now);
    if (type === "ACTION_SUCCEEDED") return completeAction(state, event, config, now);
    if (type === "ACTION_FAILED") return failAction(state, event, now);

    if (TERMINAL.has(state.phase) && !["CONTEXT_CHANGED", "RESET"].includes(type)) return state;
    if (type === "RESET") return create(event.scope || state.scope, now);
    if (type === "CONTEXT_CHANGED") return terminal(next, PHASES.CANCELLED, "context_changed", now);
    if (type === "USER_STOPPED") return terminal({ ...next, userStopped: true }, PHASES.CANCELLED, "user_stopped", now);
    if (type === "RECOVERY_BACKEND_UNAVAILABLE") return terminal(next, PHASES.MANUAL_REQUIRED, "recovery_backend_unavailable", now, { type: "notify", automatic: false });

    if (type === "USER_COMMITTED" && ([PHASES.AWAITING_USER_COMMIT, PHASES.RECONCILING].includes(state.phase)
      || (state.phase === PHASES.ACTION_BACKOFF && state.pendingAction?.type === "confirmed_resend"))) {
      return {
        ...next,
        phase: PHASES.USER_COMMITTED,
        submissionStatus: SUBMISSION.COMMITTED,
        committedAt: now,
        lastMeaningfulProgressAt: now,
        committedTurnId: boundedString(event.turnId, 240),
        draftAvailable: false,
        reason: "user_commit_exact",
        pendingAction: null
      };
    }
    if (type === "COMMIT_CONFIRMED_ABSENT" && state.phase === PHASES.AWAITING_USER_COMMIT) {
      return terminal({ ...next, submissionStatus: SUBMISSION.NOT_COMMITTED }, PHASES.MANUAL_REQUIRED, "commit_confirmed_absent", now,
        state.draftAvailable ? { type: "offer_restore_draft", automatic: false } : { type: "notify", automatic: false });
    }
    if (type === "COMMIT_UNCERTAIN" && [PHASES.AWAITING_USER_COMMIT, PHASES.RECONCILING].includes(state.phase)) {
      return terminal({ ...next, submissionStatus: SUBMISSION.UNKNOWN }, PHASES.MANUAL_REQUIRED, "commit_uncertain", now, { type: "notify", automatic: false });
    }
    if (type === "ASSISTANT_STARTED" && [PHASES.USER_COMMITTED, PHASES.RECONCILING, PHASES.ASSISTANT_GENERATING, PHASES.ACTION_BACKOFF, PHASES.NATIVE_STOP_SETTLING].includes(state.phase)) {
      return progress(next, event, now, "assistant_started");
    }
    if (type === "MEANINGFUL_PROGRESS" && [PHASES.USER_COMMITTED, PHASES.ASSISTANT_GENERATING, PHASES.RECONCILING, PHASES.STALLED, PHASES.ACTION_BACKOFF, PHASES.NATIVE_STOP_SETTLING].includes(state.phase)) {
      return progress(next, event, now, "meaningful_progress");
    }
    if (type === "TOOL_PROGRESS" && [PHASES.USER_COMMITTED, PHASES.ASSISTANT_GENERATING, PHASES.RECONCILING, PHASES.ACTION_BACKOFF, PHASES.NATIVE_STOP_SETTLING].includes(state.phase)) {
      const safety = oneOf(event.toolSafety, ["read_only", "consequential", "unknown"], "unknown");
      if (safety !== "read_only") return terminal({ ...next, toolSafety: safety, consequentialAction: safety === "consequential" }, PHASES.MANUAL_REQUIRED, "unsafe_tool_state", now, { type: "notify", automatic: false });
      if (!config.safeReadOnlyToolRecovery) return terminal({ ...next, toolSafety: safety }, PHASES.MANUAL_REQUIRED, "read_only_tool_recovery_disabled", now, { type: "notify", automatic: false });
      return progress({ ...next, toolSafety: safety }, event, now, "read_only_tool_progress");
    }
    if (type === "SETTLED") return terminal(next, PHASES.SETTLED, "assistant_settled", now);
    if (type === "PAGE_RESTORED" && state.phase === PHASES.RELOADING) {
      return { ...next, phase: PHASES.RECONCILING, reconcileStartedAt: now, reason: "page_restored_reconciling" };
    }
    if (type === "EXPLICIT_INTERRUPTION" && [PHASES.USER_COMMITTED, PHASES.ASSISTANT_GENERATING, PHASES.RECONCILING].includes(state.phase)) {
      return planRecovery({ ...next, phase: PHASES.STALLED, reason: "explicit_interruption" }, config, now);
    }
    if (type === "TICK") return tick(state.phase === PHASES.ACTION_BACKOFF ? state : next, config, now);
    return next;
  }

  function tick(state, config, now) {
    if (state.phase === PHASES.AWAITING_USER_COMMIT) {
      if (now - state.intentAt < config.commitConfirmationTimeoutSeconds * 1000) return state;
      return terminal({ ...state, submissionStatus: SUBMISSION.UNKNOWN }, PHASES.MANUAL_REQUIRED, "commit_confirmation_timeout_unknown", now, { type: "notify", automatic: false });
    }
    if ([PHASES.USER_COMMITTED, PHASES.ASSISTANT_GENERATING].includes(state.phase)) {
      if (!config.stallWatchdogEnabled || now - state.lastMeaningfulProgressAt < config.noProgressTimeoutSeconds * 1000) return state;
      return planRecovery({ ...state, phase: PHASES.STALLED, reason: "no_meaningful_progress" }, config, now);
    }
    if (state.phase === PHASES.STALLED) return planRecovery(state, config, now);
    if (state.phase === PHASES.NATIVE_STOP_SETTLING) {
      if (now - state.actionStartedAt < config.nativeStopSettleSeconds * 1000) return state;
      return planRecovery({ ...state, phase: PHASES.STALLED, reason: "native_stop_settled" }, config, now);
    }
    if (state.phase === PHASES.ACTION_BACKOFF) return state;
    if (state.phase === PHASES.RECONCILING) {
      if (now - state.reconcileStartedAt < config.postReloadReconcileTimeoutSeconds * 1000) return state;
      return planRecovery({ ...state, phase: PHASES.STALLED, reason: "post_reload_reconcile_timeout" }, config, now);
    }
    return state;
  }

  function planRecovery(state, config, now) {
    const unsafeReason = autoRecoveryBlockReason(state, config);
    if (unsafeReason) return terminal(state, PHASES.MANUAL_REQUIRED, unsafeReason, now, { type: "notify", automatic: false });
    const firstReload = state.reloadCount === 0;
    return {
      ...state,
      phase: PHASES.RELOADING,
      reloadCount: state.reloadCount + 1,
      recoveryCycle: firstReload ? state.recoveryCycle + 1 : state.recoveryCycle,
      reconcileStartedAt: 0,
      reason: firstReload ? "first_bounded_reload" : "second_bounded_reload",
      pendingAction: { type: "reload", automatic: true, ordinal: state.reloadCount + 1 },
      updatedAt: now
    };
  }

  function autoRecoveryBlockReason(state, config) {
    if (!config.enabled || !config.autoRecoveryEnabled || !config.autoReloadEnabled) return "automatic_recovery_disabled";
    if (state.submissionStatus !== SUBMISSION.COMMITTED) return "submission_not_exactly_committed";
    if (state.sensitiveContext || state.consequentialAction || ["consequential", "unknown"].includes(state.toolSafety)) return "consequential_or_unknown_action";
    if (state.userStopped) return "user_stopped";
    if (state.reloadCount >= config.maxAutoReloadsPerTurn) return "reload_limit_reached";
    if (state.recoveryCycle >= config.maxRecoveryCyclesPerTurn && state.reloadCount === 0) return "recovery_cycle_limit_reached";
    return null;
  }

  function progress(state, event, now, reason) {
    return {
      ...state,
      phase: PHASES.ASSISTANT_GENERATING,
      submissionStatus: SUBMISSION.COMMITTED,
      assistantTurnId: boundedString(event.turnId, 240) || state.assistantTurnId,
      progressSignature: boundedString(event.progressSignature, 240) || state.progressSignature,
      lastMeaningfulProgressAt: now,
      reason,
      pendingAction: null,
      updatedAt: now
    };
  }

  function authorizeAction(state, evidence, config, now) {
    if (!actionPolicy?.authorize) return state;
    const result = actionPolicy.authorize(state, evidence, config, now);
    if (!result.ok) return state;
    const authorization = result.authorization;
    return {
      ...state,
      phase: PHASES.ACTION_BACKOFF,
      reason: `${authorization.actionType}_authorized`,
      pendingAction: {
        schemaVersion: authorization.schemaVersion,
        type: authorization.actionType,
        automatic: true,
        actionId: authorization.actionId,
        recoveryId: authorization.recoveryId,
        scopeHash: authorization.scopeHash,
        subjectHash: authorization.subjectHash,
        controlIdHash: authorization.controlIdHash,
        ordinal: authorization.ordinal,
        evidenceObservedAt: authorization.evidenceObservedAt,
        expiresAt: authorization.expiresAt,
        executeAfter: authorization.executeAfter
      },
      updatedAt: now
    };
  }

  function completeAction(state, event, config, now) {
    const action = state.pendingAction;
    if (state.phase !== PHASES.ACTION_BACKOFF || !action || event.actionId !== action.actionId || event.actionType !== action.type) return state;
    if (action.type === "native_stop") {
      return {
        ...state,
        phase: PHASES.NATIVE_STOP_SETTLING,
        nativeStopCount: Math.min(1, state.nativeStopCount + 1),
        actionStartedAt: now,
        reason: "native_stop_executed",
        pendingAction: null,
        updatedAt: now
      };
    }
    if (action.type === "assistant_retry") {
      return {
        ...state,
        phase: PHASES.ASSISTANT_GENERATING,
        assistantRetryCount: Math.min(config.maxAutoAssistantRetries, state.assistantRetryCount + 1),
        lastMeaningfulProgressAt: now,
        reason: "assistant_retry_executed",
        pendingAction: null,
        updatedAt: now
      };
    }
    return {
      ...state,
      phase: PHASES.AWAITING_USER_COMMIT,
      submissionStatus: SUBMISSION.UNKNOWN,
      resendCount: Math.min(config.maxAutoNewMessageResends, state.resendCount + 1),
      intentAt: now,
      lastMeaningfulProgressAt: now,
      reason: "confirmed_resend_executed",
      pendingAction: null,
      updatedAt: now
    };
  }

  function failAction(state, event, now) {
    const action = state.pendingAction;
    if (state.phase !== PHASES.ACTION_BACKOFF || !action || event.actionId !== action.actionId) return state;
    return terminal(state, PHASES.MANUAL_REQUIRED, boundedString(event.reason, 120) || "recovery_action_failed", now, { type: "notify", automatic: false });
  }

  function terminal(state, phase, reason, now, action = null) {
    return { ...state, phase, reason, pendingAction: action, updatedAt: now };
  }

  function sanitizeSnapshot(value) {
    if (!value || value.schemaVersion !== MODEL_VERSION || !Object.values(PHASES).includes(value.phase)) return null;
    return {
      ...create(value.scope, Number(value.updatedAt) || Date.now()),
      ...value,
      schemaVersion: MODEL_VERSION,
      scope: sanitizeScope(value.scope),
      sequence: integer(value.sequence, 0, 1_000_000, 0),
      submissionStatus: oneOf(value.submissionStatus, Object.values(SUBMISSION), SUBMISSION.UNKNOWN),
      reloadCount: integer(value.reloadCount, 0, 2, 0),
      recoveryCycle: integer(value.recoveryCycle, 0, 3, 0),
      nativeStopCount: integer(value.nativeStopCount, 0, 1, 0),
      resendCount: integer(value.resendCount, 0, 1, 0),
      assistantRetryCount: integer(value.assistantRetryCount, 0, 1, 0),
      actionStartedAt: timestamp(value.actionStartedAt),
      intentAt: timestamp(value.intentAt),
      committedAt: timestamp(value.committedAt),
      lastMeaningfulProgressAt: timestamp(value.lastMeaningfulProgressAt),
      reconcileStartedAt: timestamp(value.reconcileStartedAt),
      draftAvailable: value.draftAvailable === true,
      sensitiveContext: value.sensitiveContext === true,
      consequentialAction: value.consequentialAction === true,
      userStopped: value.userStopped === true,
      toolSafety: oneOf(value.toolSafety, ["none", "read_only", "consequential", "unknown"], "unknown"),
      promptFingerprint: boundedString(value.promptFingerprint, 160),
      baselineUserIds: boundedIds(value.baselineUserIds),
      baselineAssistantIds: boundedIds(value.baselineAssistantIds),
      committedTurnId: boundedString(value.committedTurnId, 240),
      assistantTurnId: boundedString(value.assistantTurnId, 240),
      progressSignature: boundedString(value.progressSignature, 240),
      pendingAction: sanitizeAction(value.pendingAction)
    };
  }

  function sanitizeConfig(value = {}) {
    const defaults = globalThis.MicaSettingsModel?.defaults?.().reliability || {
      enabled: true, stallWatchdogEnabled: true, noProgressTimeoutSeconds: 60, commitConfirmationTimeoutSeconds: 12,
      autoRecoveryEnabled: true, autoReloadEnabled: true, maxAutoReloadsPerTurn: 2, maxRecoveryCyclesPerTurn: 1,
      postReloadReconcileTimeoutSeconds: 15, recoverySnapshotTtlMinutes: 30,
      showRecoveryNotifications: true, recordPrivacySafeRecoveryHistory: true
    };
    return {
      enabled: value.enabled !== false,
      stallWatchdogEnabled: value.stallWatchdogEnabled !== false,
      noProgressTimeoutSeconds: integer(value.noProgressTimeoutSeconds, 30, 600, defaults.noProgressTimeoutSeconds),
      commitConfirmationTimeoutSeconds: integer(value.commitConfirmationTimeoutSeconds, 5, 60, defaults.commitConfirmationTimeoutSeconds),
      autoRecoveryEnabled: value.autoRecoveryEnabled !== false,
      autoReloadEnabled: value.autoReloadEnabled !== false,
      autoStopEnabled: value.autoStopEnabled === true,
      maxAutoReloadsPerTurn: integer(value.maxAutoReloadsPerTurn, 0, 2, defaults.maxAutoReloadsPerTurn),
      maxRecoveryCyclesPerTurn: integer(value.maxRecoveryCyclesPerTurn, 0, 3, defaults.maxRecoveryCyclesPerTurn),
      nativeStopSettleSeconds: integer(value.nativeStopSettleSeconds, 1, 10, defaults.nativeStopSettleSeconds || 3),
      postReloadReconcileTimeoutSeconds: integer(value.postReloadReconcileTimeoutSeconds, 5, 60, defaults.postReloadReconcileTimeoutSeconds),
      maxAutoNewMessageResends: integer(value.maxAutoNewMessageResends, 0, 1, defaults.maxAutoNewMessageResends || 1),
      maxAutoAssistantRetries: integer(value.maxAutoAssistantRetries, 0, 1, defaults.maxAutoAssistantRetries || 1),
      retryBackoffSeconds: integer(value.retryBackoffSeconds, 1, 60, defaults.retryBackoffSeconds || 3),
      recoverySnapshotTtlMinutes: integer(value.recoverySnapshotTtlMinutes, 5, 120, defaults.recoverySnapshotTtlMinutes),
      safeReadOnlyToolRecovery: value.safeReadOnlyToolRecovery !== false,
      consequentialActionAutoReplay: false,
      showRecoveryNotifications: value.showRecoveryNotifications !== false,
      recordPrivacySafeRecoveryHistory: value.recordPrivacySafeRecoveryHistory !== false,
      resendPolicy: oneOf(value.resendPolicy, ["never", "confirm", "confirmed-unsent-once"], defaults.resendPolicy || "confirm")
    };
  }

  function snapshotForStorage(value) {
    const state = sanitizeSnapshot(value);
    if (!state) return null;
    return { ...state, pendingAction: null, promptTextIncluded: false };
  }

  function historyEntry(value) {
    const state = sanitizeSnapshot(value);
    if (!state) return null;
    const recoveryId = makeRecoveryId(state);
    const scopeHash = hashIdentity(`${state.scope.tabId}|${state.scope.conversationKey}`);
    return {
      schemaVersion: MODEL_VERSION,
      eventId: hashIdentity(`${recoveryId}|${state.phase}|${state.reason}|${state.updatedAt}`),
      recoveryId,
      scopeHash,
      phase: state.phase,
      reason: state.reason,
      submissionStatus: state.submissionStatus,
      reloadCount: state.reloadCount,
      recoveryCycle: state.recoveryCycle,
      nativeStopCount: state.nativeStopCount,
      resendCount: state.resendCount,
      assistantRetryCount: state.assistantRetryCount,
      sensitiveContext: state.sensitiveContext,
      consequentialAction: state.consequentialAction,
      updatedAt: state.updatedAt,
      conversationTextIncluded: false,
      promptTextIncluded: false,
      draftIncluded: false,
      rawConversationIdIncluded: false
    };
  }

  function actionClaim(value, rawConfig = {}, now = Date.now()) {
    const state = sanitizeSnapshot(value);
    const action = state?.pendingAction;
    if (!state || !action) return null;
    const recoveryId = makeRecoveryId(state);
    const scopeHash = hashIdentity(`${state.scope.tabId}|${state.scope.conversationKey}`);
    if (action.type !== "reload") {
      const validated = actionPolicy?.validateAuthorization?.(state, { ...action, actionType: action.type }, sanitizeConfig(rawConfig), now);
      if (!validated?.ok || !isIdentity(action.actionId) || action.recoveryId !== recoveryId || action.scopeHash !== scopeHash) return null;
      return {
        schemaVersion: MODEL_VERSION,
        actionId: action.actionId,
        recoveryId,
        scopeHash,
        subjectHash: action.subjectHash,
        controlIdHash: action.controlIdHash,
        sequence: state.sequence,
        type: action.type,
        ordinal: action.ordinal
      };
    }
    if (!Number.isInteger(action.ordinal) || action.ordinal < 1 || action.ordinal > 2) return null;
    return {
      schemaVersion: MODEL_VERSION,
      actionId: hashIdentity(`${recoveryId}|${action.type}|${action.ordinal}`),
      recoveryId,
      scopeHash,
      sequence: state.sequence,
      type: action.type,
      ordinal: action.ordinal
    };
  }

  function makeScopeKey(scope = {}) {
    const value = sanitizeScope(scope);
    return `mica.recovery.v1.${value.tabId}.${hashText(value.conversationKey || "unknown")}`;
  }

  function sanitizeScope(value = {}) {
    return {
      tabId: integer(value.tabId, 0, Number.MAX_SAFE_INTEGER, 0),
      conversationKey: boundedString(value.conversationKey, 300) || "unknown",
      turnKey: boundedString(value.turnKey, 300) || null
    };
  }

  function sanitizeAction(value) {
    if (!value || !["reload", "notify", "offer_restore_draft", ...(actionPolicy?.actionTypes || [])].includes(value.type)) return null;
    if (actionPolicy?.actionTypes?.includes(value.type)) {
      const authorization = actionPolicy.sanitizeAuthorization({ ...value, actionType: value.type });
      if (!authorization) return null;
      const { actionType, ...rest } = authorization;
      return { ...rest, type: actionType, automatic: true };
    }
    return { type: value.type, automatic: value.automatic === true, ordinal: integer(value.ordinal, 0, 2, 0) };
  }

  function boundedIds(value) {
    return [...new Set((Array.isArray(value) ? value : []).map((item) => boundedString(item, 240)).filter(Boolean))].slice(0, 500);
  }

  function boundedString(value, max) {
    return typeof value === "string" && value ? value.slice(0, max) : null;
  }

  function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function integer(value, min, max, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
  }

  function timestamp(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }

  function isIdentity(value) {
    return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function hashIdentity(value) {
    return `${hashText(String(value || ""))}${hashText(`mica:${String(value || "")}`)}`;
  }

  function makeRecoveryId(state) {
    return hashIdentity(`${state.scope.tabId}|${state.scope.conversationKey}|${state.sequence}|${state.intentAt}`);
  }

  globalThis.MicaRecoveryStateMachine = Object.freeze({
    modelVersion: MODEL_VERSION,
    phases: PHASES,
    submission: SUBMISSION,
    create,
    transition,
    sanitizeSnapshot,
    sanitizeConfig,
    snapshotForStorage,
    historyEntry,
    actionClaim,
    makeScopeKey
  });
})();
