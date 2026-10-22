(() => {
  const SCHEMA_VERSION = 4;
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
      generalWebEnabled: false
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
        generalWebEnabled: bool(input.highlighter?.generalWebEnabled, DEFAULTS.highlighter.generalWebEnabled)
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
    importJson
  });
})();
