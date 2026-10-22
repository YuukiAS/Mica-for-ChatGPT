(() => {
  const policy = globalThis.MicaRecoveryActionPolicy;
  let adapter = null;
  let controller = null;
  let config = null;
  let enabled = false;
  let frame = 0;
  let lastEvidenceKey = null;
  let lastStatus = status("disabled", "feature_disabled");

  function configure(options = {}) {
    adapter = options.adapter || adapter;
    controller = options.controller || controller;
    config = sanitizeSettings(options.settings || config || {});
    enabled = !!adapter && !!controller && config.enabled;
    lastEvidenceKey = null;
    if (enabled) scheduleReconcile();
    else lastStatus = status("disabled", "feature_disabled");
    return getStatus();
  }

  function updateSettings(value = {}) {
    config = sanitizeSettings(value);
    enabled = !!adapter && !!controller && config.enabled;
    if (!enabled) {
      lastEvidenceKey = null;
      lastStatus = status("disabled", "feature_disabled");
    } else scheduleReconcile();
    return getStatus();
  }

  function scheduleReconcile() {
    if (!enabled || frame || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      reconcile();
    });
  }

  function reconcile() {
    if (!enabled || !policy?.identityForState || !adapter?.inspectRecoveryControl) return getStatus();
    const state = controller.snapshot?.();
    const actionTypes = eligibleActionTypes(state);
    if (!actionTypes.length) {
      lastEvidenceKey = null;
      lastStatus = status("standby", "no_eligible_recovery_action", { enabled: true });
      return getStatus();
    }
    let lastObservation = null;
    for (const actionType of actionTypes) {
      const observation = adapter.inspectRecoveryControl(actionType, state, document);
      lastObservation = observation;
      if (observation?.evidenceClass !== "EXACT" || !isIdentity(observation.controlIdHash)) continue;
      const identity = policy.identityForState(state, actionType);
      if (!identity || observation.subjectHash !== identity.subjectHash) continue;
      const now = Date.now();
      const evidence = {
        schemaVersion: policy.schemaVersion,
        evidenceClass: "EXACT",
        actionType,
        ...identity,
        controlIdHash: observation.controlIdHash,
        observedAt: now,
        expiresAt: now + policy.evidenceMaxAgeMs
      };
      const authorization = policy.authorize(state, evidence, config, now);
      if (!authorization?.ok) {
        lastStatus = status("native", authorization?.reason || "action_not_authorized", {
          enabled: true,
          actionType,
          evidenceClass: "EXACT",
          variantId: observation.variantId
        });
        continue;
      }
      const evidenceKey = `${identity.recoveryId}|${actionType}|${observation.controlIdHash}`;
      if (evidenceKey === lastEvidenceKey) return getStatus();
      lastEvidenceKey = evidenceKey;
      controller.submitActionEvidence?.(evidence);
      lastStatus = status("authorized", "exact_control_evidence_submitted", {
        enabled: true,
        actionType,
        evidenceClass: "EXACT",
        variantId: observation.variantId
      });
      return getStatus();
    }
    lastStatus = status("native", lastObservation?.reason || "exact_control_unavailable", {
      enabled: true,
      actionType: actionTypes[0],
      evidenceClass: lastObservation?.evidenceClass || "MISSING",
      variantId: lastObservation?.variantId || "unproven-v1"
    });
    return getStatus();
  }

  async function execute(action) {
    if (!enabled || !action || !adapter?.executeRecoveryControl) return { ok: false, actionId: action?.actionId || null, reason: "recovery_control_adapter_disabled" };
    const state = controller.snapshot?.();
    if (!state || !isIdentity(action.actionId) || !isIdentity(action.controlIdHash)) return { ok: false, actionId: action?.actionId || null, reason: "invalid_recovery_action" };
    const identity = policy.identityForState(state, action.type);
    if (!identity || identity.subjectHash !== action.subjectHash) return { ok: false, actionId: action.actionId, reason: "recovery_subject_changed" };
    const result = adapter.executeRecoveryControl(action, state, document);
    if (!result?.ok || result.controlIdHash !== action.controlIdHash) {
      return { ok: false, actionId: action.actionId, reason: result?.reason || "exact_control_execution_failed" };
    }
    lastStatus = status("executed", "exact_native_control_invoked", {
      enabled: true,
      actionType: action.type,
      evidenceClass: "EXACT"
    });
    return { ok: true, actionId: action.actionId, reason: result.reason };
  }

  function eligibleActionTypes(state) {
    if (!state || !config?.autoRecoveryEnabled || state.sensitiveContext || state.consequentialAction || !["none", "read_only"].includes(state.toolSafety) || state.userStopped) return [];
    if (state.submissionStatus === "A_COMMITTED" && ["stalled", "reconciling"].includes(state.phase) && state.assistantTurnId) {
      const actions = [];
      if (config.autoStopEnabled && state.nativeStopCount < 1) actions.push("native_stop");
      if (state.assistantRetryCount < config.maxAutoAssistantRetries) actions.push("assistant_retry");
      return actions;
    }
    if (state.submissionStatus === "B_NOT_COMMITTED" && state.reason === "commit_confirmed_absent" && state.draftAvailable
      && config.resendPolicy === "confirmed-unsent-once" && state.resendCount < config.maxAutoNewMessageResends) return ["confirmed_resend"];
    return [];
  }

  function sanitizeSettings(value = {}) {
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

  function getStatus() {
    return { ...lastStatus };
  }

  function status(state, reason, extra = {}) {
    return {
      state,
      reason,
      enabled,
      actionType: null,
      evidenceClass: "MISSING",
      variantId: "unproven-v1",
      controlIdentityIncluded: false,
      conversationTextIncluded: false,
      ...extra
    };
  }

  function isIdentity(value) {
    return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
  }

  function integer(value, min, max, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
  }

  globalThis.MicaRecoveryControlAdapter = Object.freeze({ configure, updateSettings, scheduleReconcile, reconcile, execute, getStatus });
})();
