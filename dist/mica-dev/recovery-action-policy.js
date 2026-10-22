(() => {
  const SCHEMA_VERSION = 1;
  const EVIDENCE_MAX_AGE_MS = 10_000;
  const FUTURE_SKEW_MS = 1_000;
  const ACTION_TYPES = Object.freeze(["native_stop", "assistant_retry", "confirmed_resend"]);
  const SAFE_TOOL_STATES = new Set(["none", "read_only"]);

  function authorize(rawState, rawEvidence, rawConfig = {}, now = Date.now()) {
    const state = sanitizeState(rawState);
    const evidence = sanitizeEvidence(rawEvidence);
    const config = sanitizeConfig(rawConfig);
    if (!state) return denied("invalid_recovery_state");
    if (!evidence) return denied("invalid_action_evidence");
    if (evidence.evidenceClass !== "EXACT") return denied("action_evidence_not_exact");
    if (evidence.observedAt > now + FUTURE_SKEW_MS || now - evidence.observedAt > EVIDENCE_MAX_AGE_MS || evidence.expiresAt < now) {
      return denied("action_evidence_expired");
    }

    const identity = identityForState(state, evidence.actionType);
    if (!identity || evidence.recoveryId !== identity.recoveryId || evidence.scopeHash !== identity.scopeHash || evidence.subjectHash !== identity.subjectHash) {
      return denied("action_identity_mismatch");
    }
    const blocked = blockReason(state, evidence.actionType, config);
    if (blocked) return denied(blocked);

    const ordinal = actionOrdinal(state, evidence.actionType);
    const executeAfter = evidence.actionType === "native_stop" ? now : now + config.retryBackoffSeconds * 1000;
    if (executeAfter > evidence.expiresAt) return denied("action_evidence_expires_before_execution");
    return {
      ok: true,
      reason: "action_authorized",
      authorization: {
        schemaVersion: SCHEMA_VERSION,
        actionId: hashIdentity(`${identity.recoveryId}|${evidence.actionType}|${ordinal}|${evidence.controlIdHash}`),
        recoveryId: identity.recoveryId,
        scopeHash: identity.scopeHash,
        subjectHash: identity.subjectHash,
        controlIdHash: evidence.controlIdHash,
        actionType: evidence.actionType,
        ordinal,
        evidenceObservedAt: evidence.observedAt,
        expiresAt: evidence.expiresAt,
        executeAfter
      }
    };
  }

  function validateAuthorization(rawState, rawAuthorization, rawConfig = {}, now = Date.now()) {
    const state = sanitizeState(rawState);
    const authorization = sanitizeAuthorization(rawAuthorization);
    const config = sanitizeConfig(rawConfig);
    if (!state || !authorization) return denied("invalid_action_authorization");
    if (authorization.expiresAt < now || authorization.executeAfter > authorization.expiresAt) return denied("action_authorization_expired");
    const identity = identityForState(state, authorization.actionType);
    if (!identity || authorization.recoveryId !== identity.recoveryId || authorization.scopeHash !== identity.scopeHash || authorization.subjectHash !== identity.subjectHash) {
      return denied("action_identity_mismatch");
    }
    const blocked = blockReason(state, authorization.actionType, config, true);
    if (blocked) return denied(blocked);
    const ordinal = actionOrdinal(state, authorization.actionType);
    const expectedActionId = hashIdentity(`${identity.recoveryId}|${authorization.actionType}|${ordinal}|${authorization.controlIdHash}`);
    if (authorization.ordinal !== ordinal || authorization.actionId !== expectedActionId) return denied("action_authorization_mismatch");
    return { ok: true, reason: "action_authorization_valid", authorization };
  }

  function identityForState(rawState, actionType) {
    const state = sanitizeState(rawState);
    if (!state || !ACTION_TYPES.includes(actionType)) return null;
    const recoveryId = hashIdentity(`${state.scope.tabId}|${state.scope.conversationKey}|${state.sequence}|${state.intentAt}`);
    const scopeHash = hashIdentity(`${state.scope.tabId}|${state.scope.conversationKey}`);
    const subject = actionType === "confirmed_resend" ? state.promptFingerprint : state.assistantTurnId;
    if (!subject) return null;
    return {
      recoveryId,
      scopeHash,
      subjectHash: hashIdentity(subject)
    };
  }

  function blockReason(state, actionType, config, validatingAuthorization = false) {
    if (!config.enabled || !config.autoRecoveryEnabled) return "automatic_recovery_disabled";
    if (state.sensitiveContext || state.consequentialAction || !SAFE_TOOL_STATES.has(state.toolSafety)) return "consequential_or_unknown_action";
    if (state.userStopped) return "user_stopped";
    if (actionType === "native_stop") {
      if (!config.autoStopEnabled) return "native_stop_disabled";
      if (state.submissionStatus !== "A_COMMITTED") return "submission_not_exactly_committed";
      if (!state.assistantTurnId || (!["stalled", "reconciling"].includes(state.phase) && !(validatingAuthorization && state.phase === "action_backoff"))) return "native_stop_wrong_phase";
      if (state.nativeStopCount >= 1) return "native_stop_limit_reached";
      return null;
    }
    if (actionType === "assistant_retry") {
      if (state.submissionStatus !== "A_COMMITTED") return "submission_not_exactly_committed";
      if (!state.assistantTurnId || (!["stalled", "reconciling"].includes(state.phase) && !(validatingAuthorization && state.phase === "action_backoff"))) return "assistant_retry_wrong_phase";
      if (state.assistantRetryCount >= config.maxAutoAssistantRetries) return "assistant_retry_limit_reached";
      return null;
    }
    if (state.submissionStatus !== "B_NOT_COMMITTED" || (state.reason !== "commit_confirmed_absent" && !(validatingAuthorization && state.phase === "action_backoff" && state.reason === "confirmed_resend_authorized"))) return "resend_requires_confirmed_absence";
    if (!state.draftAvailable || !state.promptFingerprint) return "resend_draft_unavailable";
    if (config.resendPolicy !== "confirmed-unsent-once" || state.resendCount >= config.maxAutoNewMessageResends) return "resend_policy_blocked";
    return null;
  }

  function sanitizeEvidence(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION || !ACTION_TYPES.includes(value.actionType)) return null;
    if (value.evidenceClass !== "EXACT") return null;
    if (![value.recoveryId, value.scopeHash, value.subjectHash, value.controlIdHash].every(isIdentity)) return null;
    const observedAt = finiteTimestamp(value.observedAt);
    const expiresAt = finiteTimestamp(value.expiresAt);
    if (observedAt === null || expiresAt === null || expiresAt <= observedAt || expiresAt - observedAt > EVIDENCE_MAX_AGE_MS) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      evidenceClass: "EXACT",
      actionType: value.actionType,
      recoveryId: value.recoveryId,
      scopeHash: value.scopeHash,
      subjectHash: value.subjectHash,
      controlIdHash: value.controlIdHash,
      observedAt,
      expiresAt
    };
  }

  function sanitizeAuthorization(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION || !ACTION_TYPES.includes(value.actionType)) return null;
    if (![value.actionId, value.recoveryId, value.scopeHash, value.subjectHash, value.controlIdHash].every(isIdentity)) return null;
    const evidenceObservedAt = finiteTimestamp(value.evidenceObservedAt);
    const expiresAt = finiteTimestamp(value.expiresAt);
    const executeAfter = finiteTimestamp(value.executeAfter);
    if (evidenceObservedAt === null || expiresAt === null || executeAfter === null || expiresAt <= evidenceObservedAt || expiresAt - evidenceObservedAt > EVIDENCE_MAX_AGE_MS || executeAfter < evidenceObservedAt) return null;
    const ordinal = integer(value.ordinal, 1, 1, 0);
    if (ordinal !== 1) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      actionId: value.actionId,
      recoveryId: value.recoveryId,
      scopeHash: value.scopeHash,
      subjectHash: value.subjectHash,
      controlIdHash: value.controlIdHash,
      actionType: value.actionType,
      ordinal,
      evidenceObservedAt,
      expiresAt,
      executeAfter
    };
  }

  function sanitizeState(value) {
    if (!value || !value.scope || !Number.isInteger(value.scope.tabId) || typeof value.scope.conversationKey !== "string") return null;
    if (!Number.isInteger(value.sequence) || value.sequence < 1 || !Number.isFinite(Number(value.intentAt))) return null;
    return {
      phase: String(value.phase || ""),
      sequence: value.sequence,
      scope: { tabId: value.scope.tabId, conversationKey: value.scope.conversationKey },
      submissionStatus: String(value.submissionStatus || "C_UNKNOWN"),
      intentAt: Number(value.intentAt),
      promptFingerprint: boundedString(value.promptFingerprint, 160),
      assistantTurnId: boundedString(value.assistantTurnId, 240),
      draftAvailable: value.draftAvailable === true,
      sensitiveContext: value.sensitiveContext === true,
      consequentialAction: value.consequentialAction === true,
      toolSafety: ["none", "read_only", "consequential", "unknown"].includes(value.toolSafety) ? value.toolSafety : "unknown",
      userStopped: value.userStopped === true,
      reason: String(value.reason || ""),
      nativeStopCount: integer(value.nativeStopCount, 0, 1, 0),
      resendCount: integer(value.resendCount, 0, 1, 0),
      assistantRetryCount: integer(value.assistantRetryCount, 0, 1, 0)
    };
  }

  function sanitizeConfig(value = {}) {
    return {
      enabled: value.enabled !== false,
      autoRecoveryEnabled: value.autoRecoveryEnabled !== false,
      autoStopEnabled: value.autoStopEnabled === true,
      maxAutoNewMessageResends: integer(value.maxAutoNewMessageResends, 0, 1, 1),
      maxAutoAssistantRetries: integer(value.maxAutoAssistantRetries, 0, 1, 1),
      retryBackoffSeconds: integer(value.retryBackoffSeconds, 1, 60, 3),
      resendPolicy: ["never", "confirm", "confirmed-unsent-once"].includes(value.resendPolicy) ? value.resendPolicy : "confirm"
    };
  }

  function actionOrdinal(state, actionType) {
    if (actionType === "native_stop") return state.nativeStopCount + 1;
    if (actionType === "assistant_retry") return state.assistantRetryCount + 1;
    return state.resendCount + 1;
  }

  function denied(reason) {
    return { ok: false, reason, authorization: null };
  }

  function isIdentity(value) {
    return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
  }

  function finiteTimestamp(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }

  function boundedString(value, max) {
    return typeof value === "string" && value ? value.slice(0, max) : null;
  }

  function integer(value, min, max, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
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

  globalThis.MicaRecoveryActionPolicy = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    actionTypes: ACTION_TYPES,
    evidenceMaxAgeMs: EVIDENCE_MAX_AGE_MS,
    authorize,
    validateAuthorization,
    identityForState,
    sanitizeEvidence,
    sanitizeAuthorization
  });
})();
