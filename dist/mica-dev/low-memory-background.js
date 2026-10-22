(() => {
  const SCHEMA_VERSION = 5;
  const STORAGE_KEY = "micaSettings";
  const COLORS = Object.freeze(["yellow", "mint", "blue", "pink"]);
  const DEFAULTS = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    theme: "system",
    language: "auto",
    features: {
      highlighter: true,
      copyExport: true,
      lowMemory: true,
      reliability: true,
      hideSuggestedWork: false,
      generalWebHighlighter: false
    },
    highlighter: {
      defaultColor: "yellow",
      shortcut: "Alt+Shift+H",
      toolbarBehavior: "selection",
      generalWebEnabled: false,
      generalWebOrigins: []
    },
    export: {
      defaultFormat: "markdown",
      markdownFlavor: "gfm",
      inlineMathDelimiter: "dollar",
      displayMathDelimiter: "double-dollar",
      pdfPageSize: "A4",
      pdfIncludeHighlights: true,
      notionMode: "clipboard"
    },
    lowMemory: {
      keepRecentTurns: 40,
      activationThreshold: 80
    },
    reliability: {
      enabled: true,
      stallWatchdogEnabled: true,
      noProgressTimeoutSeconds: 60,
      commitConfirmationTimeoutSeconds: 12,
      autoRecoveryEnabled: true,
      autoReloadEnabled: true,
      autoStopEnabled: false,
      maxAutoReloadsPerTurn: 2,
      maxRecoveryCyclesPerTurn: 1,
      nativeStopSettleSeconds: 3,
      postReloadReconcileTimeoutSeconds: 15,
      maxAutoNewMessageResends: 1,
      maxAutoAssistantRetries: 1,
      retryBackoffSeconds: 3,
      recoverySnapshotTtlMinutes: 30,
      safeReadOnlyToolRecovery: true,
      consequentialActionAutoReplay: false,
      showRecoveryNotifications: true,
      recordPrivacySafeRecoveryHistory: true,
      resendPolicy: "confirm"
    }
  });

  function defaults() {
    return clone(DEFAULTS);
  }

  function fromStorage(storage = {}) {
    const nested = isRecord(storage?.[STORAGE_KEY]) ? storage[STORAGE_KEY] : storage;
    return sanitize(migrate(nested, storage));
  }

  function migrate(value = {}, legacy = value) {
    const source = isRecord(value) ? value : {};
    const next = mergeKnown(DEFAULTS, source);
    const flat = isRecord(legacy) ? legacy : {};
    if (typeof flat.enabled === "boolean") next.enabled = flat.enabled;
    if (typeof flat.highlighter === "boolean") next.features.highlighter = flat.highlighter;
    if (typeof flat.copyExport === "boolean") next.features.copyExport = flat.copyExport;
    if (typeof flat.lowMemory === "boolean") next.features.lowMemory = flat.lowMemory;
    if (typeof flat.reliability === "boolean") {
      next.features.reliability = flat.reliability;
      next.reliability.enabled = flat.reliability;
    }
    if (typeof flat.hideSuggestedWork === "boolean") next.features.hideSuggestedWork = flat.hideSuggestedWork;
    if (Number.isFinite(Number(flat.lowMemoryKeepCount))) next.lowMemory.keepRecentTurns = Number(flat.lowMemoryKeepCount);
    if (Number.isFinite(Number(flat.lowMemoryThreshold))) next.lowMemory.activationThreshold = Number(flat.lowMemoryThreshold);
    next.schemaVersion = SCHEMA_VERSION;
    return next;
  }

  function sanitize(value = {}) {
    const input = mergeKnown(DEFAULTS, isRecord(value) ? value : {});
    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: bool(input.enabled, DEFAULTS.enabled),
      theme: oneOf(input.theme, ["system", "light", "dark"], DEFAULTS.theme),
      language: oneOf(input.language, ["auto", "zh-CN", "en"], DEFAULTS.language),
      features: {
        highlighter: bool(input.features?.highlighter, DEFAULTS.features.highlighter),
        copyExport: bool(input.features?.copyExport, DEFAULTS.features.copyExport),
        lowMemory: bool(input.features?.lowMemory, DEFAULTS.features.lowMemory),
        reliability: bool(input.features?.reliability, DEFAULTS.features.reliability),
        hideSuggestedWork: bool(input.features?.hideSuggestedWork, DEFAULTS.features.hideSuggestedWork),
        generalWebHighlighter: bool(input.features?.generalWebHighlighter, DEFAULTS.features.generalWebHighlighter)
      },
      highlighter: {
        defaultColor: oneOf(input.highlighter?.defaultColor, COLORS, DEFAULTS.highlighter.defaultColor),
        shortcut: boundedString(input.highlighter?.shortcut, 64, DEFAULTS.highlighter.shortcut),
        toolbarBehavior: oneOf(input.highlighter?.toolbarBehavior, ["selection", "shortcut", "both"], DEFAULTS.highlighter.toolbarBehavior),
        generalWebEnabled: bool(input.highlighter?.generalWebEnabled, DEFAULTS.highlighter.generalWebEnabled),
        generalWebOrigins: sanitizeWebOrigins(input.highlighter?.generalWebOrigins)
      },
      export: {
        defaultFormat: oneOf(input.export?.defaultFormat, ["markdown", "notion", "pdf"], DEFAULTS.export.defaultFormat),
        markdownFlavor: oneOf(input.export?.markdownFlavor, ["standard", "gfm"], DEFAULTS.export.markdownFlavor),
        inlineMathDelimiter: oneOf(input.export?.inlineMathDelimiter, ["dollar", "parentheses"], DEFAULTS.export.inlineMathDelimiter),
        displayMathDelimiter: oneOf(input.export?.displayMathDelimiter, ["double-dollar", "brackets"], DEFAULTS.export.displayMathDelimiter),
        pdfPageSize: oneOf(input.export?.pdfPageSize, ["A4", "Letter"], DEFAULTS.export.pdfPageSize),
        pdfIncludeHighlights: bool(input.export?.pdfIncludeHighlights, DEFAULTS.export.pdfIncludeHighlights),
        notionMode: oneOf(input.export?.notionMode, ["clipboard", "import-file", "disabled"], DEFAULTS.export.notionMode)
      },
      lowMemory: {
        keepRecentTurns: integer(input.lowMemory?.keepRecentTurns, 8, 120, DEFAULTS.lowMemory.keepRecentTurns),
        activationThreshold: integer(input.lowMemory?.activationThreshold, 10, 500, DEFAULTS.lowMemory.activationThreshold)
      },
      reliability: sanitizeReliability(input.reliability)
    };
  }

  function sanitizeReliability(value = {}) {
    return {
      enabled: bool(value.enabled, DEFAULTS.reliability.enabled),
      stallWatchdogEnabled: bool(value.stallWatchdogEnabled, DEFAULTS.reliability.stallWatchdogEnabled),
      noProgressTimeoutSeconds: integer(value.noProgressTimeoutSeconds, 30, 600, DEFAULTS.reliability.noProgressTimeoutSeconds),
      commitConfirmationTimeoutSeconds: integer(value.commitConfirmationTimeoutSeconds, 5, 60, DEFAULTS.reliability.commitConfirmationTimeoutSeconds),
      autoRecoveryEnabled: bool(value.autoRecoveryEnabled, DEFAULTS.reliability.autoRecoveryEnabled),
      autoReloadEnabled: bool(value.autoReloadEnabled, DEFAULTS.reliability.autoReloadEnabled),
      autoStopEnabled: bool(value.autoStopEnabled, DEFAULTS.reliability.autoStopEnabled),
      maxAutoReloadsPerTurn: integer(value.maxAutoReloadsPerTurn, 0, 2, DEFAULTS.reliability.maxAutoReloadsPerTurn),
      maxRecoveryCyclesPerTurn: integer(value.maxRecoveryCyclesPerTurn, 0, 3, DEFAULTS.reliability.maxRecoveryCyclesPerTurn),
      nativeStopSettleSeconds: integer(value.nativeStopSettleSeconds, 1, 10, DEFAULTS.reliability.nativeStopSettleSeconds),
      postReloadReconcileTimeoutSeconds: integer(value.postReloadReconcileTimeoutSeconds, 5, 60, DEFAULTS.reliability.postReloadReconcileTimeoutSeconds),
      maxAutoNewMessageResends: integer(value.maxAutoNewMessageResends, 0, 1, DEFAULTS.reliability.maxAutoNewMessageResends),
      maxAutoAssistantRetries: integer(value.maxAutoAssistantRetries, 0, 1, DEFAULTS.reliability.maxAutoAssistantRetries),
      retryBackoffSeconds: integer(value.retryBackoffSeconds, 1, 60, DEFAULTS.reliability.retryBackoffSeconds),
      recoverySnapshotTtlMinutes: integer(value.recoverySnapshotTtlMinutes, 5, 120, DEFAULTS.reliability.recoverySnapshotTtlMinutes),
      safeReadOnlyToolRecovery: bool(value.safeReadOnlyToolRecovery, DEFAULTS.reliability.safeReadOnlyToolRecovery),
      consequentialActionAutoReplay: false,
      showRecoveryNotifications: bool(value.showRecoveryNotifications, DEFAULTS.reliability.showRecoveryNotifications),
      recordPrivacySafeRecoveryHistory: bool(value.recordPrivacySafeRecoveryHistory, DEFAULTS.reliability.recordPrivacySafeRecoveryHistory),
      resendPolicy: oneOf(value.resendPolicy, ["never", "confirm", "confirmed-unsent-once"], DEFAULTS.reliability.resendPolicy)
    };
  }

  function patch(current, partial) {
    return sanitize(mergeKnown(sanitize(current), isRecord(partial) ? partial : {}));
  }

  function withLegacyPatch(current, partial = {}) {
    const next = sanitize(current);
    if (typeof partial.enabled === "boolean") next.enabled = partial.enabled;
    if (typeof partial.highlighter === "boolean") next.features.highlighter = partial.highlighter;
    if (typeof partial.copyExport === "boolean") next.features.copyExport = partial.copyExport;
    if (typeof partial.lowMemory === "boolean") next.features.lowMemory = partial.lowMemory;
    if (typeof partial.reliability === "boolean") {
      next.features.reliability = partial.reliability;
      next.reliability.enabled = partial.reliability;
    }
    if (typeof partial.hideSuggestedWork === "boolean") next.features.hideSuggestedWork = partial.hideSuggestedWork;
    if (Number.isFinite(Number(partial.lowMemoryKeepCount))) next.lowMemory.keepRecentTurns = Number(partial.lowMemoryKeepCount);
    if (Number.isFinite(Number(partial.lowMemoryThreshold))) next.lowMemory.activationThreshold = Number(partial.lowMemoryThreshold);
    return sanitize(next);
  }

  function toLegacyFlat(value) {
    const settings = sanitize(value);
    return {
      enabled: settings.enabled,
      highlighter: settings.features.highlighter,
      copyExport: settings.features.copyExport,
      lowMemory: settings.features.lowMemory,
      reliability: settings.features.reliability && settings.reliability.enabled,
      hideSuggestedWork: settings.features.hideSuggestedWork,
      lowMemoryKeepCount: settings.lowMemory.keepRecentTurns,
      lowMemoryThreshold: settings.lowMemory.activationThreshold
    };
  }

  function toStorageRecord(value) {
    const settings = sanitize(value);
    return { [STORAGE_KEY]: settings, ...toLegacyFlat(settings) };
  }

  function exportJson(value) {
    return `${JSON.stringify(sanitize(value), null, 2)}\n`;
  }

  function importJson(text) {
    try {
      const parsed = JSON.parse(String(text || ""));
      if (!isRecord(parsed)) return { ok: false, reason: "settings_not_an_object" };
      return { ok: true, settings: sanitize(parsed) };
    } catch (_error) {
      return { ok: false, reason: "settings_invalid_json" };
    }
  }

  function mergeKnown(base, incoming) {
    if (!isRecord(base)) return clone(incoming);
    const output = clone(base);
    if (!isRecord(incoming)) return output;
    for (const key of Object.keys(base)) {
      if (!(key in incoming)) continue;
      output[key] = isRecord(base[key]) ? mergeKnown(base[key], incoming[key]) : incoming[key];
    }
    return output;
  }

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function integer(value, min, max, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
  }

  function bool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function boundedString(value, max, fallback) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
  }

  function normalizeWebOrigin(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      if (["chatgpt.com", "chat.openai.com"].includes(url.hostname)) return null;
      return url.origin;
    } catch (_error) {
      return null;
    }
  }

  function toMatchPattern(value) {
    const origin = normalizeWebOrigin(value);
    return origin ? `${origin}/*` : null;
  }

  function sanitizeWebOrigins(value) {
    if (!Array.isArray(value)) return [];
    const origins = [];
    const seen = new Set();
    for (const candidate of value) {
      const origin = normalizeWebOrigin(candidate);
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      origins.push(origin);
      if (origins.length >= 100) break;
    }
    return origins;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!isRecord(value) && !Array.isArray(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }

  globalThis.MicaSettingsModel = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    storageKey: STORAGE_KEY,
    colors: COLORS,
    defaults,
    fromStorage,
    sanitize,
    patch,
    withLegacyPatch,
    toLegacyFlat,
    toStorageRecord,
    exportJson,
    importJson,
    normalizeWebOrigin,
    toMatchPattern,
    sanitizeWebOrigins
  });
})();

(() => {
  const MODEL_VERSION = 1;
  const PHASES = Object.freeze({
    IDLE: "idle",
    AWAITING_USER_COMMIT: "awaiting_user_commit",
    USER_COMMITTED: "user_committed",
    ASSISTANT_GENERATING: "assistant_generating",
    STALLED: "stalled",
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
      resendCount: 0,
      assistantRetryCount: 0,
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

    if (TERMINAL.has(state.phase) && !["CONTEXT_CHANGED", "RESET"].includes(type)) return state;
    if (type === "RESET") return create(event.scope || state.scope, now);
    if (type === "CONTEXT_CHANGED") return terminal(next, PHASES.CANCELLED, "context_changed", now);
    if (type === "USER_STOPPED") return terminal({ ...next, userStopped: true }, PHASES.CANCELLED, "user_stopped", now);
    if (type === "RECOVERY_BACKEND_UNAVAILABLE") return terminal(next, PHASES.MANUAL_REQUIRED, "recovery_backend_unavailable", now, { type: "notify", automatic: false });

    if (type === "USER_COMMITTED" && [PHASES.AWAITING_USER_COMMIT, PHASES.RECONCILING].includes(state.phase)) {
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
    if (type === "ASSISTANT_STARTED" && [PHASES.USER_COMMITTED, PHASES.RECONCILING, PHASES.ASSISTANT_GENERATING].includes(state.phase)) {
      return progress(next, event, now, "assistant_started");
    }
    if (type === "MEANINGFUL_PROGRESS" && [PHASES.USER_COMMITTED, PHASES.ASSISTANT_GENERATING, PHASES.RECONCILING, PHASES.STALLED].includes(state.phase)) {
      return progress(next, event, now, "meaningful_progress");
    }
    if (type === "TOOL_PROGRESS" && [PHASES.USER_COMMITTED, PHASES.ASSISTANT_GENERATING, PHASES.RECONCILING].includes(state.phase)) {
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
    if (type === "TICK") return tick(next, config, now);
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
      resendCount: integer(value.resendCount, 0, 1, 0),
      assistantRetryCount: integer(value.assistantRetryCount, 0, 1, 0),
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
      maxAutoReloadsPerTurn: integer(value.maxAutoReloadsPerTurn, 0, 2, defaults.maxAutoReloadsPerTurn),
      maxRecoveryCyclesPerTurn: integer(value.maxRecoveryCyclesPerTurn, 0, 3, defaults.maxRecoveryCyclesPerTurn),
      postReloadReconcileTimeoutSeconds: integer(value.postReloadReconcileTimeoutSeconds, 5, 60, defaults.postReloadReconcileTimeoutSeconds),
      recoverySnapshotTtlMinutes: integer(value.recoverySnapshotTtlMinutes, 5, 120, defaults.recoverySnapshotTtlMinutes),
      safeReadOnlyToolRecovery: value.safeReadOnlyToolRecovery !== false,
      showRecoveryNotifications: value.showRecoveryNotifications !== false,
      recordPrivacySafeRecoveryHistory: value.recordPrivacySafeRecoveryHistory !== false
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
      sensitiveContext: state.sensitiveContext,
      consequentialAction: state.consequentialAction,
      updatedAt: state.updatedAt,
      conversationTextIncluded: false,
      promptTextIncluded: false,
      draftIncluded: false,
      rawConversationIdIncluded: false
    };
  }

  function actionClaim(value) {
    const state = sanitizeSnapshot(value);
    const action = state?.pendingAction;
    if (!state || action?.type !== "reload" || !Number.isInteger(action.ordinal) || action.ordinal < 1 || action.ordinal > 2) return null;
    const recoveryId = makeRecoveryId(state);
    const scopeHash = hashIdentity(`${state.scope.tabId}|${state.scope.conversationKey}`);
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
    if (!value || !["reload", "notify", "offer_restore_draft"].includes(value.type)) return null;
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

(() => {
  const SCHEMA_VERSION = 1;
  const ACTION_CLAIMS_KEY = "micaRecoveryActionClaimsV1";
  const HISTORY_KEY = "micaRecoveryHistoryV1";
  const CLAIM_TTL_MS = 5 * 60 * 1000;
  const MAX_CLAIMS_PER_TAB = 8;
  const MAX_HISTORY_ENTRIES = 50;
  const PHASES = new Set([
    "idle",
    "awaiting_user_commit",
    "user_committed",
    "assistant_generating",
    "stalled",
    "reloading",
    "reconciling",
    "manual_required",
    "settled",
    "cancelled"
  ]);
  const SUBMISSION = new Set(["A_COMMITTED", "B_NOT_COMMITTED", "C_UNKNOWN"]);
  let queue = Promise.resolve();

  function claimAction(sessionArea, tabId, rawClaim, now = Date.now()) {
    return exclusive(async () => {
      const claim = sanitizeActionClaim(rawClaim);
      if (!sessionArea || !Number.isInteger(tabId) || tabId < 1 || !claim) {
        return { ok: false, granted: false, reason: "invalid_action_claim" };
      }
      const read = await readStorage(sessionArea, { [ACTION_CLAIMS_KEY]: {} });
      if (!read.ok) return { ok: false, granted: false, reason: "claim_store_unavailable" };
      const allClaims = sanitizeClaims(read.value?.[ACTION_CLAIMS_KEY], now);
      const tabKey = String(tabId);
      const current = allClaims[tabKey] || [];
      const duplicate = current.find((item) => item.actionId === claim.actionId);
      if (duplicate) {
        await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
        return { ok: true, granted: false, reason: "already_claimed", actionId: claim.actionId, expiresAt: duplicate.expiresAt };
      }
      const conflictingIdentity = current.find((item) => item.recoveryId === claim.recoveryId && item.type === claim.type && item.ordinal === claim.ordinal);
      if (conflictingIdentity) {
        await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
        return { ok: false, granted: false, reason: "claim_identity_conflict" };
      }
      const stored = {
        ...claim,
        tabId,
        claimedAt: now,
        expiresAt: now + CLAIM_TTL_MS
      };
      allClaims[tabKey] = [...current, stored].slice(-MAX_CLAIMS_PER_TAB);
      const wrote = await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
      return wrote
        ? { ok: true, granted: true, reason: "claim_granted", actionId: claim.actionId, expiresAt: stored.expiresAt }
        : { ok: false, granted: false, reason: "claim_store_unavailable" };
    });
  }

  function appendHistory(localArea, rawEntry) {
    return exclusive(async () => {
      const entry = sanitizeHistoryEntry(rawEntry);
      if (!localArea || !entry) return { ok: false, appended: false, reason: "invalid_history_entry" };
      const read = await readStorage(localArea, { [HISTORY_KEY]: [] });
      if (!read.ok) return { ok: false, appended: false, reason: "history_store_unavailable" };
      const current = (Array.isArray(read.value?.[HISTORY_KEY]) ? read.value[HISTORY_KEY] : [])
        .map(sanitizeHistoryEntry)
        .filter(Boolean);
      if (current.some((item) => item.eventId === entry.eventId)) {
        return { ok: true, appended: false, reason: "history_duplicate", size: current.length };
      }
      const next = [...current, entry].slice(-MAX_HISTORY_ENTRIES);
      const wrote = await writeStorage(localArea, { [HISTORY_KEY]: next });
      return wrote
        ? { ok: true, appended: true, reason: "history_appended", size: next.length }
        : { ok: false, appended: false, reason: "history_store_unavailable" };
    });
  }

  function clearTabClaims(sessionArea, tabId, now = Date.now()) {
    return exclusive(async () => {
      if (!sessionArea || !Number.isInteger(tabId) || tabId < 1) return { ok: false, reason: "invalid_tab" };
      const read = await readStorage(sessionArea, { [ACTION_CLAIMS_KEY]: {} });
      if (!read.ok) return { ok: false, reason: "claim_store_unavailable" };
      const allClaims = sanitizeClaims(read.value?.[ACTION_CLAIMS_KEY], now);
      delete allClaims[String(tabId)];
      const wrote = await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
      return { ok: wrote, reason: wrote ? "tab_claims_cleared" : "claim_store_unavailable" };
    });
  }

  function sanitizeActionClaim(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION) return null;
    if (!isIdentity(value.actionId) || !isIdentity(value.recoveryId) || !isIdentity(value.scopeHash)) return null;
    if (value.type !== "reload" || !Number.isInteger(value.ordinal) || value.ordinal < 1 || value.ordinal > 2) return null;
    if (!Number.isInteger(value.sequence) || value.sequence < 1 || value.sequence > 1_000_000) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      actionId: value.actionId,
      recoveryId: value.recoveryId,
      scopeHash: value.scopeHash,
      sequence: value.sequence,
      type: value.type,
      ordinal: value.ordinal
    };
  }

  function sanitizeHistoryEntry(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION) return null;
    if (!isIdentity(value.eventId) || !isIdentity(value.recoveryId) || !isIdentity(value.scopeHash)) return null;
    if (!PHASES.has(value.phase) || !SUBMISSION.has(value.submissionStatus)) return null;
    const reason = boundedToken(value.reason, 120);
    const updatedAt = Number(value.updatedAt);
    if (!reason || !Number.isFinite(updatedAt) || updatedAt < 0) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      eventId: value.eventId,
      recoveryId: value.recoveryId,
      scopeHash: value.scopeHash,
      phase: value.phase,
      reason,
      submissionStatus: value.submissionStatus,
      reloadCount: integer(value.reloadCount, 0, 2, 0),
      recoveryCycle: integer(value.recoveryCycle, 0, 3, 0),
      sensitiveContext: value.sensitiveContext === true,
      consequentialAction: value.consequentialAction === true,
      updatedAt,
      conversationTextIncluded: false,
      promptTextIncluded: false,
      draftIncluded: false,
      rawConversationIdIncluded: false
    };
  }

  function sanitizeClaims(value, now) {
    const output = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return output;
    for (const [tabKey, entries] of Object.entries(value)) {
      const tabId = Number(tabKey);
      if (!Number.isInteger(tabId) || tabId < 1 || !Array.isArray(entries)) continue;
      const retained = entries.map((item) => sanitizeStoredClaim(item, tabId)).filter((item) => item && item.expiresAt > now);
      if (retained.length) output[tabKey] = retained.slice(-MAX_CLAIMS_PER_TAB);
    }
    return output;
  }

  function sanitizeStoredClaim(value, tabId) {
    const claim = sanitizeActionClaim(value);
    const claimedAt = Number(value?.claimedAt);
    const expiresAt = Number(value?.expiresAt);
    if (!claim || value?.tabId !== tabId || !Number.isFinite(claimedAt) || !Number.isFinite(expiresAt) || expiresAt <= claimedAt) return null;
    return { ...claim, tabId, claimedAt, expiresAt };
  }

  function exclusive(task) {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function readStorage(area, defaults) {
    try {
      const value = await area.get(defaults);
      return { ok: true, value: value || defaults };
    } catch (_error) {
      return { ok: false, value: defaults };
    }
  }

  async function writeStorage(area, value) {
    try {
      await area.set(value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function isIdentity(value) {
    return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
  }

  function boundedToken(value, max) {
    return typeof value === "string" && /^[a-z0-9_:-]+$/.test(value) ? value.slice(0, max) : null;
  }

  function integer(value, min, max, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
  }

  globalThis.MicaRecoveryLedger = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    actionClaimsKey: ACTION_CLAIMS_KEY,
    historyKey: HISTORY_KEY,
    claimTtlMs: CLAIM_TTL_MS,
    maxHistoryEntries: MAX_HISTORY_ENTRIES,
    claimAction,
    appendHistory,
    clearTabClaims,
    sanitizeActionClaim,
    sanitizeHistoryEntry
  });
})();

const SCRIPT_ID = "mica-low-memory-main-v3";
const MATCHES = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const MODE_KEY = "mica.lowMemory.tabModes.v3";
const COMPLETENESS_KEY = "mica.lowMemory.completeness.v1";
const DEFAULTS = Object.freeze({ enabled: true, lowMemory: true });
const SETTINGS_KEY = globalThis.MicaSettingsModel?.storageKey || "micaSettings";
const RECOVERY_PREFIX = "mica.recovery.v1.";
const PDF_EXPORT_PREFIX = "mica.pdf.export.";
const MAX_PDF_EXPORT_BYTES = 2_000_000;
const recoveryLedger = globalThis.MicaRecoveryLedger;
const pendingFullHistory = new Set();
let registrationQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => { void migrateSettings().then(syncRegistration); });
chrome.runtime.onStartup.addListener(() => { void migrateSettings().then(syncRegistration); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("enabled" in changes || "lowMemory" in changes || SETTINGS_KEY in changes)) void syncRegistration();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && !pendingFullHistory.has(tabId)) void clearCompletedTabMode(tabId);
  if (changeInfo.status === "complete") void finishFullHistoryReload(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingFullHistory.delete(tabId);
  void clearTabMode(tabId);
  void clearCompletenessProof(tabId);
  void chrome.storage.session.remove(`${RECOVERY_PREFIX}${tabId}`);
  void recoveryLedger?.clearTabClaims?.(chrome.storage.session, tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MICA_LOW_MEMORY_SYNC") {
    void syncRegistration().then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_RELIABILITY_CONTEXT") {
    sendResponse({ ok: Number.isInteger(sender.tab?.id), tabId: sender.tab?.id || 0 });
    return false;
  }
  if (message?.type === "MICA_RELIABILITY_CLAIM_ACTION") {
    void claimRecoveryAction(message, sender).then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_RELIABILITY_APPEND_HISTORY") {
    void appendRecoveryHistory(message, sender).then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_LOW_MEMORY_GET_TAB_MODE") {
    void getTabMode(sender.tab?.id).then((state) => sendResponse({ ok: true, ...state }));
    return true;
  }
  if (message?.type === "MICA_LOW_MEMORY_PREPARE_FULL_HISTORY") {
    void prepareFullHistory(sender.tab, message.completenessProof).then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_LOW_MEMORY_RESUME_WINDOWING") {
    void resumeWindowing(sender.tab).then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_OPEN_PDF_EXPORT") {
    void openPdfExport(message, sender).then(sendResponse);
    return true;
  }
  if (message?.type === "MICA_GET_PDF_EXPORT") {
    void consumePdfExport(message, sender).then(sendResponse);
    return true;
  }
  return false;
});

async function claimRecoveryAction(message, sender) {
  if (!recoveryLedger || !isSupportedTab(sender.tab)) return { ok: false, granted: false, reason: "invalid_recovery_source" };
  return recoveryLedger.claimAction(chrome.storage.session, sender.tab.id, message?.claim);
}

async function appendRecoveryHistory(message, sender) {
  if (!recoveryLedger || !isSupportedTab(sender.tab)) return { ok: false, appended: false, reason: "invalid_recovery_source" };
  return recoveryLedger.appendHistory(chrome.storage.local, message?.entry);
}

async function openPdfExport(message, sender) {
  if (!isSupportedTab(sender.tab) || !validPdfToken(message?.token) || !validPdfModel(message?.model)) return { ok: false, reason: "invalid_export_request" };
  const serialized = JSON.stringify(message.model);
  if (serialized.length > MAX_PDF_EXPORT_BYTES) return { ok: false, reason: "export_too_large" };
  const key = `${PDF_EXPORT_PREFIX}${message.token}`;
  try {
    await chrome.storage.session.set({ [key]: message.model });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`pdf/pdf-export.html#${message.token}`), active: true });
    if (!Number.isInteger(tab?.id)) {
      await chrome.storage.session.remove(key);
      return { ok: false, reason: "export_tab_unavailable" };
    }
    return { ok: true, tabId: tab.id };
  } catch (error) {
    await chrome.storage.session.remove(key).catch(() => {});
    return { ok: false, reason: `export_open_failed:${String(error?.message || error || "unknown")}` };
  }
}

async function consumePdfExport(message, sender) {
  if (!validPdfToken(message?.token) || !isPdfExportPage(sender.url)) return { ok: false, reason: "invalid_export_consumer" };
  const key = `${PDF_EXPORT_PREFIX}${message.token}`;
  try {
    const items = await chrome.storage.session.get(key);
    await chrome.storage.session.remove(key);
    return validPdfModel(items?.[key]) ? { ok: true, model: items[key] } : { ok: false, reason: "export_expired" };
  } catch (error) {
    return { ok: false, reason: `export_read_failed:${String(error?.message || error || "unknown")}` };
  }
}

function isPdfExportPage(value) {
  try {
    const actual = new URL(value);
    const expected = new URL(chrome.runtime.getURL("pdf/pdf-export.html"));
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch (_error) {
    return false;
  }
}

function validPdfToken(value) {
  return /^[a-f0-9-]{16,64}$/.test(value || "");
}

function validPdfModel(value) {
  return value?.schemaVersion === 1 && typeof value.documentId === "string" && Array.isArray(value.blocks) && Array.isArray(value.highlights) && typeof value.plainText === "string" && value.localOnly === true;
}

function syncRegistration() {
  registrationQueue = registrationQueue.then(syncRegistrationNow, syncRegistrationNow);
  return registrationQueue;
}

async function syncRegistrationNow() {
  const settings = await readSettings();
  const modes = await readModes();
  const fullHistoryReloadPending = Object.values(modes).includes("preparing_full_history");
  const shouldRegister = settings.ok && settings.value.enabled && settings.value.lowMemory && !fullHistoryReloadPending;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (shouldRegister && existing.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID, matches: MATCHES, js: ["low-memory-core.js", "low-memory-page.js"],
        runAt: "document_start", world: "MAIN", persistAcrossSessions: true
      }]);
    } else if (!shouldRegister && existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
    return { ok: true, registered: shouldRegister, failOpen: !settings.ok };
  } catch (error) {
    try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch (_ignored) { /* fail open */ }
    return { ok: false, registered: false, reason: `registration_failed:${String(error?.message || error || "unknown")}`, failOpen: true };
  }
}

async function prepareFullHistory(tab, completenessProof) {
  if (!isSupportedTab(tab)) return { ok: false, reason: "unsupported_tab" };
  try {
    await setTabMode(tab.id, "preparing_full_history");
    const proof = sanitizeCompletenessProof(completenessProof);
    if (proof) await setCompletenessProof(tab.id, proof);
    else await clearCompletenessProof(tab.id);
    pendingFullHistory.add(tab.id);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return { ok: true, mode: "full_history_bypass", reloadRequired: true };
  } catch (error) {
    pendingFullHistory.delete(tab.id);
    await clearTabMode(tab.id);
    await clearCompletenessProof(tab.id);
    return { ok: false, reason: `registration_failed:${String(error?.message || error || "unknown")}` };
  }
}

async function resumeWindowing(tab) {
  if (!isSupportedTab(tab)) return { ok: false, reason: "unsupported_tab" };
  await clearTabMode(tab.id);
  await clearCompletenessProof(tab.id);
  const synced = await syncRegistration();
  return synced.ok && synced.registered
    ? { ok: true, mode: "windowing", reloadRequired: true }
    : { ok: false, reason: synced.reason || "windowing_disabled" };
}

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ ...DEFAULTS, [SETTINGS_KEY]: null }, (items) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, value: { enabled: false, lowMemory: false } });
      if (globalThis.MicaSettingsModel) {
        const settings = globalThis.MicaSettingsModel.fromStorage(items || {});
        const flat = globalThis.MicaSettingsModel.toLegacyFlat(settings);
        return resolve({ ok: true, value: { enabled: flat.enabled, lowMemory: flat.lowMemory } });
      }
      resolve({ ok: true, value: { enabled: items?.enabled !== false, lowMemory: items?.lowMemory !== false } });
    });
  });
}

async function migrateSettings() {
  if (!globalThis.MicaSettingsModel) return { ok: false, reason: "settings_model_unavailable" };
  try {
    const items = await new Promise((resolve) => chrome.storage.local.get(null, (value) => resolve(value || {})));
    const settings = globalThis.MicaSettingsModel.fromStorage(items || {});
    await new Promise((resolve) => {
      if (!chrome.storage.local.set) return resolve();
      chrome.storage.local.set(globalThis.MicaSettingsModel.toStorageRecord(settings), resolve);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `settings_migration_failed:${String(error?.message || error || "unknown")}` };
  }
}

async function getTabMode(tabId) {
  if (!Number.isInteger(tabId)) return { mode: "native", completenessProof: null };
  const modes = await readModes();
  const mode = modes[String(tabId)] || "windowing";
  const effectiveMode = mode === "preparing_full_history" ? "full_history_bypass" : mode;
  const proof = effectiveMode === "full_history_bypass" ? await getCompletenessProof(tabId) : null;
  return { mode: effectiveMode, completenessProof: proof };
}

async function finishFullHistoryReload(tabId) {
  const modes = await readModes();
  if (modes[String(tabId)] !== "preparing_full_history" && !pendingFullHistory.has(tabId)) return;
  pendingFullHistory.delete(tabId);
  modes[String(tabId)] = "full_history_bypass";
  await chrome.storage.session.set({ [MODE_KEY]: modes });
  await syncRegistration();
}

async function clearCompletedTabMode(tabId) {
  const modes = await readModes();
  if (modes[String(tabId)] === "preparing_full_history") return;
  await clearTabMode(tabId);
  await clearCompletenessProof(tabId);
}

async function setTabMode(tabId, mode) {
  const modes = await readModes();
  modes[String(tabId)] = mode;
  await chrome.storage.session.set({ [MODE_KEY]: modes });
}

async function clearTabMode(tabId) {
  if (!Number.isInteger(tabId)) return;
  const modes = await readModes();
  delete modes[String(tabId)];
  await chrome.storage.session.set({ [MODE_KEY]: modes });
}

function readModes() {
  return new Promise((resolve) => {
    chrome.storage.session.get({ [MODE_KEY]: {} }, (items) => {
      if (chrome.runtime.lastError) return resolve({});
      const value = items?.[MODE_KEY];
      resolve(value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});
    });
  });
}

async function getCompletenessProof(tabId) {
  if (!Number.isInteger(tabId)) return null;
  const proofs = await readCompletenessProofs();
  const proof = sanitizeCompletenessProof(proofs[String(tabId)]);
  if (!proof || proof.expiresAt <= Date.now()) {
    if (proofs[String(tabId)]) await clearCompletenessProof(tabId);
    return null;
  }
  return proof;
}

async function setCompletenessProof(tabId, value) {
  if (!Number.isInteger(tabId)) return;
  const proof = sanitizeCompletenessProof(value);
  if (!proof) return clearCompletenessProof(tabId);
  const proofs = await readCompletenessProofs();
  proofs[String(tabId)] = { ...proof, expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
  await chrome.storage.session.set({ [COMPLETENESS_KEY]: proofs });
}

async function clearCompletenessProof(tabId) {
  if (!Number.isInteger(tabId)) return;
  const proofs = await readCompletenessProofs();
  delete proofs[String(tabId)];
  await chrome.storage.session.set({ [COMPLETENESS_KEY]: proofs });
}

function readCompletenessProofs() {
  return new Promise((resolve) => {
    chrome.storage.session.get({ [COMPLETENESS_KEY]: {} }, (items) => {
      if (chrome.runtime.lastError) return resolve({});
      const value = items?.[COMPLETENESS_KEY];
      resolve(value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {});
    });
  });
}

function sanitizeCompletenessProof(value) {
  if (value?.schemaVersion !== 1 || !Number.isInteger(value.expectedTurnCount) || value.expectedTurnCount < 1 || value.expectedTurnCount > 20000) return null;
  if (!/^[a-f0-9]{8}$/.test(value.roleSequenceHash || "") || value.source !== "validated-conversation-graph") return null;
  if (typeof value.conversationId !== "string" || !/^conversation-[a-f0-9]{8}$/.test(value.conversationId)) return null;
  return {
    schemaVersion: 1,
    expectedTurnCount: value.expectedTurnCount,
    roleSequenceHash: value.roleSequenceHash,
    source: value.source,
    conversationId: value.conversationId,
    capturedAt: typeof value.capturedAt === "string" && Number.isFinite(Date.parse(value.capturedAt)) ? value.capturedAt : new Date().toISOString(),
    expiresAt: Number.isFinite(Number(value.expiresAt)) ? Number(value.expiresAt) : Date.now() + 2 * 60 * 60 * 1000
  };
}

function isSupportedTab(tab) {
  if (!Number.isInteger(tab?.id) || typeof tab?.url !== "string") return false;
  try { return ["chatgpt.com", "chat.openai.com"].includes(new URL(tab.url).hostname); }
  catch (_error) { return false; }
}

void migrateSettings().then(syncRegistration);

(() => {
  const SCRIPT_ID = "mica-general-web-highlighter-v1";
  const SETTINGS_KEY = globalThis.MicaSettingsModel?.storageKey || "micaSettings";
  const SCRIPT_FILES = Object.freeze(["settings-model.js", "general-web-model.js", "general-web-highlighter.js"]);
  let syncQueue = Promise.resolve();

  chrome.runtime.onInstalled.addListener(() => { void syncRegistration(); });
  chrome.runtime.onStartup.addListener(() => { void syncRegistration(); });
  chrome.permissions?.onAdded?.addListener(() => { void syncRegistration(); });
  chrome.permissions?.onRemoved?.addListener(() => { void syncRegistration(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && SETTINGS_KEY in changes) void syncRegistration();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "MICA_GENERAL_WEB_SYNC") return false;
    void syncRegistration().then(sendResponse);
    return true;
  });

  function syncRegistration() {
    syncQueue = syncQueue.then(syncRegistrationNow, syncRegistrationNow);
    return syncQueue;
  }

  async function syncRegistrationNow() {
    const settings = await readSettings();
    const desired = settings.ok ? await grantedPatterns(settings.value) : [];
    try {
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
      const currentMatches = existing[0]?.matches || [];
      if (sameStrings(currentMatches, desired)) {
        return { ok: true, registered: desired.length > 0, matches: desired, failOpen: !settings.ok };
      }
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      if (desired.length) {
        await chrome.scripting.registerContentScripts([{
          id: SCRIPT_ID,
          matches: desired,
          js: [...SCRIPT_FILES],
          runAt: "document_idle",
          world: "ISOLATED",
          persistAcrossSessions: true,
          allFrames: false
        }]);
      }
      return { ok: true, registered: desired.length > 0, matches: desired, failOpen: !settings.ok };
    } catch (error) {
      try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch (_ignored) { /* fail open */ }
      return { ok: false, registered: false, matches: [], failOpen: true, reason: `general_web_registration_failed:${String(error?.message || error || "unknown")}` };
    }
  }

  function readSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [SETTINGS_KEY]: null }, (items) => {
        if (chrome.runtime.lastError || !globalThis.MicaSettingsModel) return resolve({ ok: false, value: null });
        resolve({ ok: true, value: globalThis.MicaSettingsModel.fromStorage(items || {}) });
      });
    });
  }

  async function grantedPatterns(settings) {
    if (!settings.enabled || !settings.features.generalWebHighlighter || !settings.highlighter.generalWebEnabled) return [];
    if (!chrome.permissions?.contains) return [];
    const output = [];
    for (const origin of settings.highlighter.generalWebOrigins) {
      const pattern = globalThis.MicaSettingsModel.toMatchPattern(origin);
      if (!pattern) continue;
      const granted = await new Promise((resolve) => chrome.permissions.contains({ origins: [pattern] }, resolve));
      if (granted) output.push(pattern);
    }
    return [...new Set(output)].sort();
  }

  function sameStrings(left, right) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  }

  globalThis.MicaGeneralWebBackground = Object.freeze({ scriptId: SCRIPT_ID, scriptFiles: SCRIPT_FILES, syncRegistration });
  void syncRegistration();
})();
