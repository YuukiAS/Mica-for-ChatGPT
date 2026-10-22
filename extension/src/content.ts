(() => {
  const VERSION = "__MICA_VERSION__";
  const VERSION_NAME = "__MICA_VERSION_NAME__";
  const BUILD_LABEL = "__MICA_BUILD_LABEL__";
  const CONTRACT_HASH = "__MICA_CHATGPT_CONTRACT_HASH__";
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, lowMemory: true, highlighter: true, copyExport: true, reliability: true, hideSuggestedWork: false, lowMemoryKeepCount: 40, lowMemoryThreshold: 80 });
  const RECOVERY_AUTH = Object.freeze({ popup: Symbol("popup"), settings: Symbol("settings"), trustedGesture: Symbol("trusted-gesture") });
  const adapter = globalThis.MicaChatGPTAdapter;
  const answerDocument = globalThis.MicaAnswerDocument;
  const settingsModel = globalThis.MicaSettingsModel;
  const answerSerializer = globalThis.MicaAnswerSerializer;
  const conversationExport = globalThis.MicaConversationExport;
  const highlightEngine = globalThis.MicaHighlightEngine;
  const pdfExport = globalThis.MicaPdfExport;
  const recoveryController = globalThis.MicaRecoveryController;
  let settings = { ...DEFAULT_SETTINGS };
  let productSettings = settingsModel?.defaults?.() || null;
  let observer = null;
  let scheduled = false;
  let lastStatus = loadingStatus();
  let lowMemoryStatus = readLowMemoryPageStatus() || defaultLowMemoryStatus();
  let historyControl = null;
  let scrollFrame = 0;
  let highlightRecords = [];
  let highlightToolbar = null;
  let pendingHighlight = null;
  let highlightFrame = 0;
  let renderedHighlights = new Map();
  let highlighterReady = false;

  if (!adapter || !answerDocument || !isSupportedPage()) return;

  initialize();

  async function initialize() {
    settings = await readSettings();
    const tabMode = await globalThis.MicaLowMemoryConfig?.getTabMode?.();
    if (tabMode?.mode === "full_history_bypass") {
      lowMemoryStatus = {
        ...defaultLowMemoryStatus("user_requested_full_history"),
        state: "full_history_bypass",
        completenessProof: sanitizeCompletenessProof(tabMode.completenessProof)
      };
    }
    setupMessages();
    setupStorageSignals();
    setupNavigationSignals();
    setupLowMemorySignals();
    if (settings.enabled) setupObserver();
    await initializeHighlighter();
    await recoveryController?.configure?.({
      adapter,
      getConversationKey: () => currentConversationId(),
      settings: { ...(productSettings?.reliability || {}), enabled: settings.enabled && settings.reliability }
    });
    refreshStatus();
    exposeFixtureHook();
  }

  function isSupportedPage() {
    return ["chatgpt.com", "chat.openai.com"].includes(location.hostname) || document.documentElement.dataset.micaFixture === "true";
  }

  function readSettings() {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve({ ...DEFAULT_SETTINGS, enabled: false, lowMemory: false });
      storage.get(null, (items) => {
        if (chrome.runtime?.lastError) return resolve({ ...DEFAULT_SETTINGS, enabled: false, lowMemory: false });
        if (settingsModel) {
          productSettings = settingsModel.fromStorage(items || {});
          return resolve(sanitizeSettings(settingsModel.toLegacyFlat(productSettings)));
        }
        resolve(sanitizeSettings(items || DEFAULT_SETTINGS));
      });
    });
  }

  function writeSettings() {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve();
      const value = settingsModel && productSettings ? settingsModel.toStorageRecord(productSettings) : settings;
      storage.set(value, () => resolve());
    });
  }

  function sanitizeSettings(value) {
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
      lowMemory: typeof value.lowMemory === "boolean" ? value.lowMemory : DEFAULT_SETTINGS.lowMemory,
      highlighter: typeof value.highlighter === "boolean" ? value.highlighter : DEFAULT_SETTINGS.highlighter,
      copyExport: typeof value.copyExport === "boolean" ? value.copyExport : DEFAULT_SETTINGS.copyExport,
      reliability: typeof value.reliability === "boolean" ? value.reliability : DEFAULT_SETTINGS.reliability,
      hideSuggestedWork: typeof value.hideSuggestedWork === "boolean" ? value.hideSuggestedWork : DEFAULT_SETTINGS.hideSuggestedWork,
      lowMemoryKeepCount: clampNumber(value.lowMemoryKeepCount, 8, 120, DEFAULT_SETTINGS.lowMemoryKeepCount),
      lowMemoryThreshold: clampNumber(value.lowMemoryThreshold, 10, 500, DEFAULT_SETTINGS.lowMemoryThreshold)
    };
  }

  function setupObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(() => {
      scheduleRefresh();
      scheduleHighlightReconcile();
      recoveryController?.scheduleReconcile?.();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function teardownObserver() {
    observer?.disconnect();
    observer = null;
  }

  function setupNavigationSignals() {
    const onNavigation = () => {
      recoveryController?.onContextChanged?.();
      scheduleRefresh();
      scheduleHighlightReconcile();
    };
    addEventListener("popstate", onNavigation, { passive: true });
    addEventListener("hashchange", onNavigation, { passive: true });
  }

  function setupStorageSignals() {
    const storage = globalThis.chrome?.storage;
    if (!storage?.onChanged) return;
    storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const nested = settingsModel && changes[settingsModel.storageKey]?.newValue;
      if (nested) {
        void applySettings(settingsModel.sanitize(nested), false);
        return;
      }
      const patch = {};
      for (const key of Object.keys(DEFAULT_SETTINGS)) if (changes[key]) patch[key] = changes[key].newValue;
      if (Object.keys(patch).length) void applySettings(patch, false);
    });
  }

  function setupLowMemorySignals() {
    addEventListener("mica-low-memory-page-status", (event) => {
      try { lowMemoryStatus = sanitizeLowMemoryStatus(JSON.parse(String(event.detail || ""))); }
      catch (_error) { lowMemoryStatus = defaultLowMemoryStatus("status_unavailable"); }
      reconcileHistoryControl();
    });
    addEventListener("scroll", scheduleHistoryControlVisibility, { passive: true, capture: true });
    reconcileHistoryControl();
  }

  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      refreshStatus();
    }, 120);
  }

  function refreshStatus() {
    if (!settings.enabled) {
      lastStatus = disabledStatus();
      return lastStatus;
    }
    const inspection = adapter.inspect(document);
    lastStatus = statusFromInspection(inspection);
    return lastStatus;
  }

  function statusFromInspection(inspection) {
    const state = inspection.status === "CONTENT_UNAVAILABLE" ? "unsupported" : String(inspection.status || "UNKNOWN").toLowerCase();
    return {
      state,
      enabled: true,
      headline: headlineForState(state),
      message: inspection.reason,
      version: VERSION,
      versionName: VERSION_NAME,
      buildLabel: BUILD_LABEL,
      compatibility: sanitizeInspection(inspection),
      answerDocument: {
        modelVersion: answerDocument.modelVersion,
        supportedBlockKinds: [...answerDocument.blockKinds],
        singleProducer: "MicaChatGPTAdapter"
      },
      lowMemory: { ...lowMemoryStatus, enabled: settings.enabled && settings.lowMemory },
      conversationExport: conversationExportStatus(inspection),
      updatedAt: new Date().toISOString()
    };
  }

  function sanitizeInspection(inspection) {
    return {
      status: inspection.status,
      reason: inspection.reason,
      contractId: inspection.contractId,
      contractHash: inspection.contractHash,
      contractVersion: inspection.contractVersion,
      observedAt: inspection.observedAt,
      turnCount: inspection.turns.length,
      assistantTurnCount: inspection.turns.filter((turn) => turn.role === "assistant").length,
      composerPresent: !!inspection.composer,
      capabilities: inspection.capabilities.map((capability) => ({
        capabilityId: capability.capabilityId,
        variantId: capability.variantId,
        status: capability.status,
        observedInvariants: [...capability.observedInvariants],
        invalidatedBy: [...capability.invalidatedBy],
        failOpen: capability.failOpen,
        contractHash: capability.contractHash
      }))
    };
  }

  function headlineForState(state) {
    if (state === "exact") return "Supported";
    if (state === "compatible") return "Supported with limits";
    if (state === "content_unavailable") return "No conversation open";
    if (state === "unsupported") return "Unsupported page";
    return "Compatibility unknown";
  }

  function loadingStatus() {
    return {
      state: "loading",
      enabled: true,
      headline: "Checking this page",
      message: "Mica is checking the current ChatGPT structure.",
      version: VERSION,
      versionName: VERSION_NAME,
      buildLabel: BUILD_LABEL,
      updatedAt: new Date().toISOString()
    };
  }

  function disabledStatus() {
    return {
      state: "disabled",
      enabled: false,
      headline: "Mica is off",
      message: "Turn Mica on to check and improve this page.",
      version: VERSION,
      versionName: VERSION_NAME,
      buildLabel: BUILD_LABEL,
      compatibility: {
        status: "DISABLED",
        contractId: adapter.contractId,
        contractHash: adapter.contractHash,
        contractVersion: adapter.contractVersion,
        capabilities: []
      },
      lowMemory: { ...lowMemoryStatus, enabled: false },
      conversationExport: { ready: false, reason: "copy_export_disabled" },
      updatedAt: new Date().toISOString()
    };
  }

  function setupMessages() {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage) return;
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "MICA_GET_STATUS") {
        sendResponse({ status: refreshStatus(), settings: { ...settings } });
        return false;
      }
      if (message?.type === "MICA_SET_SETTINGS") {
        void applySettings(message.settings).then(() => sendResponse({ status: refreshStatus(), settings: { ...settings } }));
        return true;
      }
      if (message?.type === "MICA_QA_EXPORT") {
        sendResponse({ report: buildSanitizedQaReport() });
        return false;
      }
      if (message?.type === "MICA_GET_ANSWER_DOCUMENT") {
        sendResponse({ answerDocument: getAnswerDocument(message.turnId) });
        return false;
      }
      if (message?.type === "MICA_SERIALIZE_ANSWER") {
        sendResponse(serializeAnswer(message.turnId, message.format));
        return false;
      }
      if (message?.type === "MICA_SERIALIZE_CONVERSATION") {
        sendResponse(serializeConversation());
        return false;
      }
      if (message?.type === "MICA_EXPORT_CONVERSATION_PDF") {
        void exportConversationPdf().then(sendResponse);
        return true;
      }
      if (message?.type === "MICA_LOAD_FULL_HISTORY") {
        void requestFullHistory("popup", RECOVERY_AUTH.popup).then(sendResponse);
        return true;
      }
      if (message?.type === "MICA_RESUME_LOW_MEMORY") {
        if (!safeToReload()) {
          sendResponse({ ok: false, reason: "active_draft_or_stream" });
          return false;
        }
        void globalThis.MicaLowMemoryConfig?.resumeWindowing?.().then((response) => {
          if (response?.ok) scheduleReload();
          sendResponse(response || { ok: false, reason: "runtime_unavailable" });
        });
        return true;
      }
      return false;
    });
  }

  async function applySettings(value, persist = true) {
    const wasLowMemoryActive = lowMemoryStatus.active === true;
    const wasLowMemoryEnabled = settings.enabled && settings.lowMemory;
    if (settingsModel) {
      productSettings = value?.schemaVersion
        ? settingsModel.sanitize(value)
        : settingsModel.withLegacyPatch(productSettings || settingsModel.defaults(), value || {});
    }
    const modelFlat = settingsModel && productSettings ? settingsModel.toLegacyFlat(productSettings) : {};
    const next = sanitizeSettings({ ...settings, ...(value || {}), ...modelFlat });
    settings = next;
    if (persist) await writeSettings();
    const registration = await globalThis.MicaLowMemoryConfig?.syncRegistration?.();
    const isLowMemoryEnabled = settings.enabled && settings.lowMemory;
    if (!registration?.ok) {
      lowMemoryStatus = { ...defaultLowMemoryStatus("registration_failed"), state: "degraded" };
    } else if (isLowMemoryEnabled && !wasLowMemoryEnabled) {
      lowMemoryStatus = { ...defaultLowMemoryStatus("enabled_requires_reload"), state: "reload_required" };
      if (safeToReload()) {
        const resumed = await globalThis.MicaLowMemoryConfig?.resumeWindowing?.();
        if (resumed?.ok) scheduleReload();
      }
    } else if (!isLowMemoryEnabled && wasLowMemoryActive) {
      lowMemoryStatus = { ...lowMemoryStatus, state: "restore_required", active: false, reason: "disabled_after_windowing" };
      if (safeToReload()) await requestFullHistory("disabled_after_windowing", RECOVERY_AUTH.settings);
    }
    if (settings.enabled) setupObserver();
    else {
      teardownObserver();
      clearHighlighterSurface();
    }
    if (settings.enabled && settings.highlighter) scheduleHighlightReconcile();
    else clearHighlighterSurface();
    recoveryController?.updateSettings?.({ ...(productSettings?.reliability || {}), enabled: settings.enabled && settings.reliability });
    reconcileHistoryControl();
  }

  function readLowMemoryPageStatus() {
    try { return sanitizeLowMemoryStatus(JSON.parse(document.documentElement.getAttribute("data-mica-low-memory-page-status") || "null")); }
    catch (_error) { return null; }
  }

  function sanitizeLowMemoryStatus(value) {
    if (!value || typeof value !== "object") return defaultLowMemoryStatus("status_unavailable");
    return {
      state: String(value.state || "standby"),
      reason: String(value.reason || "unknown"),
      source: String(value.source || "none"),
      active: value.active === true && value.actualTruncation === true,
      keptTurns: clampNumber(value.keptTurns, 0, 100000, 0),
      totalTurns: clampNumber(value.totalTurns, 0, 100000, 0),
      removedTurns: clampNumber(value.removedTurns, 0, 100000, 0),
      keptNodes: clampNumber(value.keptNodes, 0, 100000, 0),
      totalNodes: clampNumber(value.totalNodes, 0, 100000, 0),
      bytesBefore: clampNumber(value.bytesBefore, 0, Number.MAX_SAFE_INTEGER, 0),
      bytesAfter: clampNumber(value.bytesAfter, 0, Number.MAX_SAFE_INTEGER, 0),
      bytesRemoved: clampNumber(value.bytesRemoved, 0, Number.MAX_SAFE_INTEGER, 0),
      recentTurnLimit: clampNumber(value.recentTurnLimit, 8, 120, settings.lowMemoryKeepCount || 40),
      actualTruncation: value.actualTruncation === true,
      completenessProof: sanitizeCompletenessProof(value.completenessProof),
      telemetryTrust: "page_untrusted",
      recoveryAuthorization: "extension_ui_or_trusted_user_gesture",
      truncatedRepresentation: value.truncatedRepresentation === "client-history-window" ? value.truncatedRepresentation : "client-history-window",
      serverMutation: false,
      reactManagedInteractiveNodesDetached: false,
      contentUpload: false,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
    };
  }

  function defaultLowMemoryStatus(reason = "not_windowed") {
    return {
      state: "standby", reason, source: "none", active: false, keptTurns: 0, totalTurns: 0,
      removedTurns: 0, keptNodes: 0, totalNodes: 0, bytesBefore: 0, bytesAfter: 0,
      bytesRemoved: 0, recentTurnLimit: 40, actualTruncation: false, completenessProof: null,
      telemetryTrust: "page_untrusted", recoveryAuthorization: "extension_ui_or_trusted_user_gesture",
      truncatedRepresentation: "client-history-window", serverMutation: false,
      reactManagedInteractiveNodesDetached: false, contentUpload: false, updatedAt: new Date().toISOString()
    };
  }

  function reconcileHistoryControl() {
    const recoveryState = ["restore_required", "reload_required", "full_history_bypass"].includes(lowMemoryStatus.state);
    if (!lowMemoryStatus.active && !recoveryState) {
      historyControl?.remove();
      historyControl = null;
      return;
    }
    if (!historyControl) historyControl = createHistoryControl();
    const summary = historyControl.shadowRoot.querySelector("[data-summary]");
    const button = historyControl.shadowRoot.querySelector("button");
    if (lowMemoryStatus.state === "full_history_bypass") {
      summary.textContent = "Full history is active for this tab";
      button.textContent = "Resume Low Memory";
    } else if (lowMemoryStatus.state === "restore_required") {
      summary.textContent = "Reload when your draft or stream is finished";
      button.textContent = "Restore full history";
    } else if (lowMemoryStatus.state === "reload_required") {
      summary.textContent = "Reload when your draft or stream is finished";
      button.textContent = "Start Low Memory";
    } else {
      summary.textContent = `${lowMemoryStatus.keptTurns} recent turns active`;
      button.textContent = "Load full history";
    }
    if (!historyControl.isConnected) document.documentElement.append(historyControl);
    scheduleHistoryControlVisibility();
  }

  function createHistoryControl() {
    const host = document.createElement("div");
    host.dataset.micaUi = "low-memory-history";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{display:none;position:fixed;left:50%;top:68px;transform:translateX(-50%);z-index:2147483645;font:500 12px/1.4 system-ui,sans-serif;color:#17201e}
      :host([data-near-top]){display:block}
      aside{display:flex;align-items:center;gap:10px;padding:7px 8px 7px 11px;border:1px solid rgba(23,32,30,.18);border-radius:999px;background:rgba(255,255,255,.96);box-shadow:0 6px 20px rgba(0,0,0,.12);backdrop-filter:blur(10px)}
      button{min-height:30px;padding:4px 9px;border:1px solid #176b62;border-radius:999px;background:#176b62;color:#fff;font:600 12px/1.3 system-ui,sans-serif;cursor:pointer}
      button:focus-visible{outline:2px solid #0b766b;outline-offset:2px}
      @media(prefers-color-scheme:dark){:host{color:#eef4f1}aside{border-color:rgba(238,244,241,.2);background:rgba(23,29,27,.96)}button{border-color:#67c7bb;background:#67c7bb;color:#092d28}}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style><aside role="status"><span data-summary></span><button type="button">Load full history</button></aside>`;
    shadow.querySelector("button").addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      if (lowMemoryStatus.state === "full_history_bypass" || lowMemoryStatus.state === "reload_required") {
        if (!safeToReload()) return;
        const resumed = await globalThis.MicaLowMemoryConfig?.resumeWindowing?.();
        if (resumed?.ok) scheduleReload();
        return;
      }
      await requestFullHistory("history_control", RECOVERY_AUTH.trustedGesture);
    });
    return host;
  }

  function scheduleHistoryControlVisibility() {
    if (!historyControl || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const root = adapter.findScrollRoot?.(document)?.element;
      const nearTop = root instanceof Element ? root.scrollTop < 96 : scrollY < 96;
      historyControl.toggleAttribute("data-near-top", nearTop);
    });
  }

  async function requestFullHistory(reason, authorization) {
    if (!Object.values(RECOVERY_AUTH).includes(authorization)) return { ok: false, reason: "trusted_action_required" };
    if (!lowMemoryStatus.active && lowMemoryStatus.state !== "restore_required") return { ok: false, reason: "not_windowed" };
    if (!safeToReload()) return { ok: false, reason: "active_draft_or_stream" };
    const prepared = await globalThis.MicaLowMemoryConfig?.prepareFullHistory?.(lowMemoryStatus.completenessProof);
    if (!prepared?.ok) return { ok: false, reason: prepared?.reason || "runtime_unavailable" };
    lowMemoryStatus = { ...lowMemoryStatus, state: "restoring", active: false, reason };
    reconcileHistoryControl();
    scheduleReload();
    return { ok: true, reason: "reloading_full_history" };
  }

  function scheduleReload() {
    setTimeout(() => {
      if (document.documentElement.dataset.micaFixture === "true" && typeof globalThis.__MICA_FIXTURE_RELOAD__ === "function") {
        globalThis.__MICA_FIXTURE_RELOAD__();
      } else {
        location.reload();
      }
    }, 0);
  }

  function safeToReload() {
    const composer = adapter.findComposer(document)?.element;
    const value = composer instanceof HTMLTextAreaElement ? composer.value : composer?.textContent || "";
    const sensitive = document.querySelector("[role='dialog'], [data-is-streaming='true'], [data-testid*='stop' i], [aria-label*='Stop generating' i], [aria-label*='停止生成']");
    return !String(value).trim() && !sensitive;
  }

  async function initializeHighlighter() {
    if (!highlightEngine) {
      highlighterReady = false;
      return;
    }
    highlightRecords = await readHighlightRecords();
    highlighterReady = supportsCssHighlights();
    addEventListener("pointerup", handleHighlightPointerUp, { passive: true, capture: true });
    addEventListener("keyup", handleHighlightKeyUp, { passive: true, capture: true });
    if (settings.enabled) scheduleHighlightReconcile();
  }

  function supportsCssHighlights() {
    return !!(globalThis.CSS?.highlights && typeof globalThis.Highlight === "function");
  }

  function readHighlightRecords() {
    if (!highlightEngine) return Promise.resolve([]);
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve([]);
      storage.get({ [highlightEngine.storeKey]: [] }, (items) => resolve(chrome.runtime?.lastError
        ? []
        : highlightEngine.sanitizeRecords(items?.[highlightEngine.storeKey])));
    });
  }

  function persistHighlightRecords() {
    if (!highlightEngine) return Promise.resolve(false);
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve(false);
      storage.set({ [highlightEngine.storeKey]: highlightRecords }, () => resolve(!chrome.runtime?.lastError));
    });
  }

  function handleHighlightPointerUp(event) {
    if (!settings.enabled || !settings.highlighter || !highlighterReady || highlightToolbar?.contains(event.target)) return;
    const point = { x: event.clientX, y: event.clientY };
    requestAnimationFrame(() => {
      const selection = getSelection();
      if (selection?.rangeCount === 1 && !selection.isCollapsed) inspectHighlightSelection();
      else inspectExistingHighlightAtPoint(point);
    });
  }

  function handleHighlightKeyUp(event) {
    if (!settings.enabled || !settings.highlighter || !highlighterReady) return;
    if (!event.shiftKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    if (isEditableTarget(event.target)) return;
    requestAnimationFrame(() => inspectHighlightSelection(true));
  }

  function inspectHighlightSelection(focusToolbar = false) {
    hideHighlightToolbar();
    const selection = getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return { ok: false, reason: "no_selection" };
    const range = selection.getRangeAt(0);
    if (selectionTouchesExcludedSurface(range)) return { ok: false, reason: "unsupported_selection" };
    const startTurn = adapter.resolveTurnFromNode?.(range.startContainer, document);
    const endTurn = adapter.resolveTurnFromNode?.(range.endContainer, document);
    if (!startTurn || !endTurn || startTurn.turnId !== endTurn.turnId) return { ok: false, reason: "selection_not_in_one_exact_answer" };
    const generationState = adapter.generationStateForTurn(startTurn);
    if (generationState !== "SETTLED") return { ok: false, reason: "answer_not_settled" };
    const documentModel = answerDocument.fromAssistantTurn(startTurn, {
      conversationId: currentConversationId(),
      generationState
    });
    const snapshot = answerDocument.captureHighlightSelection(startTurn, documentModel, range);
    if (!snapshot?.range) return { ok: false, reason: "selection_mapping_failed" };
    const rect = visibleRangeRect(range);
    if (!rect) return { ok: false, reason: "selection_not_visible" };
    pendingHighlight = { turn: startTurn, documentModel, snapshot };
    showHighlightToolbar(rect, null, focusToolbar);
    return {
      ok: true,
      turnId: documentModel.turnId,
      sourceVersion: documentModel.sourceVersion,
      quoteLength: snapshot.textQuote.length,
      mathTeX: [...snapshot.mathTeX],
      structuralHint: { ...snapshot.structuralHint }
    };
  }

  function selectionTouchesExcludedSurface(range) {
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const excluded = "[data-mica-ui],pre,code,input,textarea,select,button,[contenteditable='true'],[role='dialog'],[role='menu'],[data-testid*='tool'],[data-testid*='file'],[data-testid*='attachment'],[data-testid*='connector'],[data-testid*='auth']";
    return !start || !end || !!start.closest(excluded) || !!end.closest(excluded);
  }

  function isEditableTarget(target) {
    return target instanceof Element && !!target.closest("input,textarea,select,[contenteditable='true'],[role='textbox']");
  }

  function visibleRangeRect(range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    return rects.at(-1) || null;
  }

  function showHighlightToolbar(rect, recordId, focusToolbar = false) {
    if (!highlightToolbar) highlightToolbar = createHighlightToolbar();
    pendingHighlight = recordId ? { recordId } : pendingHighlight;
    highlightToolbar.toggleAttribute("data-editing", !!recordId);
    const deleteButton = highlightToolbar.shadowRoot.querySelector("[data-action='delete']");
    deleteButton.hidden = !recordId;
    if (!highlightToolbar.isConnected) document.documentElement.append(highlightToolbar);
    const toolbarWidth = Math.min(highlightToolbar.getBoundingClientRect().width || 520, innerWidth - 24);
    highlightToolbar.style.left = `${Math.max(12, Math.min(innerWidth - toolbarWidth - 12, rect.left + rect.width / 2 - toolbarWidth / 2))}px`;
    highlightToolbar.style.top = `${rect.top >= 104 ? rect.top - 92 : rect.bottom + 8}px`;
    if (focusToolbar) highlightToolbar.shadowRoot.querySelector("button:not([hidden])")?.focus();
  }

  function createHighlightToolbar() {
    const host = document.createElement("div");
    host.dataset.micaUi = "highlight-toolbar";
    host.style.cssText = "position:fixed;z-index:2147483646";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{font:500 12px/1 system-ui,sans-serif;color:#17201e}
      div{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:5px;max-width:calc(100vw - 24px);padding:6px;border:1px solid rgba(23,32,30,.18);border-radius:12px;background:rgba(255,255,255,.98);box-shadow:0 8px 24px rgba(0,0,0,.16)}
      button{width:28px;height:28px;border:1px solid rgba(23,32,30,.22);border-radius:50%;cursor:pointer;padding:0;background:var(--swatch)}
      button:focus-visible{outline:2px solid #0b766b;outline-offset:2px}
      button[data-action]{width:auto;border-radius:999px;padding:0 9px;background:transparent;color:inherit;font:600 11px/1 system-ui,sans-serif;white-space:nowrap}
      @media(prefers-color-scheme:dark){:host{color:#eef4f1}div{border-color:rgba(238,244,241,.2);background:rgba(23,29,27,.98)}button{border-color:rgba(238,244,241,.35)}}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style><div role="toolbar" aria-label="Highlight selection">
      <button type="button" data-color="yellow" aria-label="Yellow highlight" style="--swatch:#f6df79"></button>
      <button type="button" data-color="mint" aria-label="Mint highlight" style="--swatch:#9ee3cf"></button>
      <button type="button" data-color="blue" aria-label="Blue highlight" style="--swatch:#9ec9f5"></button>
      <button type="button" data-color="pink" aria-label="Pink highlight" style="--swatch:#f2acd0"></button>
      <button type="button" data-action="markdown" aria-label="Copy answer as Markdown">Copy Markdown</button>
      <button type="button" data-action="notion" aria-label="Copy answer for Notion">Copy for Notion</button>
      <button type="button" data-action="pdf" aria-label="Export answer as PDF">Export PDF</button>
      <button type="button" data-action="delete" aria-label="Delete highlight">Delete</button>
    </div>`;
    shadow.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!button) return;
      if (button.dataset.action === "delete" && pendingHighlight?.recordId) await deleteHighlight(pendingHighlight.recordId);
      else if (button.dataset.action === "pdf") await exportPendingAnswer();
      else if (button.dataset.action === "markdown") await copyPendingAnswer("markdown");
      else if (button.dataset.action === "notion") await copyPendingAnswer("notion");
      else if (button.dataset.color) {
        if (pendingHighlight?.recordId) await updateHighlightColor(pendingHighlight.recordId, button.dataset.color);
        else await createHighlightFromPending(button.dataset.color);
      }
      getSelection()?.removeAllRanges();
      hideHighlightToolbar();
    });
    shadow.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      hideHighlightToolbar();
    });
    return host;
  }

  async function createHighlightFromPending(color) {
    if (!highlightEngine || !pendingHighlight?.documentModel || !pendingHighlight?.snapshot) return false;
    const record = highlightEngine.createRecord(pendingHighlight.documentModel, pendingHighlight.snapshot, color);
    if (!record) return false;
    highlightRecords = [...highlightRecords.filter((item) => item.id !== record.id), record].slice(-highlightEngine.maxRecords);
    await persistHighlightRecords();
    reconcileHighlights();
    return true;
  }

  async function updateHighlightColor(recordId, color) {
    if (!highlightEngine) return false;
    const index = highlightRecords.findIndex((record) => record.id === recordId);
    if (index < 0) return false;
    const updated = highlightEngine.withColor(highlightRecords[index], color);
    if (!updated) return false;
    highlightRecords = highlightRecords.map((record, current) => current === index ? updated : record);
    await persistHighlightRecords();
    reconcileHighlights();
    return true;
  }

  async function deleteHighlight(recordId) {
    const next = highlightRecords.filter((record) => record.id !== recordId);
    if (next.length === highlightRecords.length) return false;
    highlightRecords = next;
    await persistHighlightRecords();
    reconcileHighlights();
    return true;
  }

  async function exportPendingAnswer() {
    if (!settings.copyExport || !pdfExport || !pendingHighlight) return false;
    const documentModel = documentForPendingAnswer();
    if (!documentModel) return false;
    const built = pdfExport.buildModel(documentModel, highlightRecords);
    if (!built?.ok) return false;
    const token = globalThis.crypto?.randomUUID?.();
    if (!token) return false;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "MICA_OPEN_PDF_EXPORT", token, model: built.model }, (response) => resolve(!chrome.runtime.lastError && response?.ok === true));
    });
  }

  async function copyPendingAnswer(format) {
    if (!settings.copyExport || !answerSerializer || !pendingHighlight) return false;
    const documentModel = documentForPendingAnswer();
    if (!documentModel) return false;
    if (format === "notion" && productSettings?.export?.notionMode === "disabled") return false;
    if (format === "notion" && productSettings?.export?.notionMode === "import-file") {
      const imported = answerSerializer.serializeNotionImport(documentModel, productSettings?.export || {});
      if (!imported?.ok) return false;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([imported.content], { type: "text/markdown" }));
      link.download = imported.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
      hideHighlightToolbar();
      return true;
    }
    const output = format === "notion"
      ? answerSerializer.serializeNotion(documentModel, productSettings?.export || {})
      : answerSerializer.serializeMarkdown(documentModel, {
        flavor: productSettings?.export?.markdownFlavor,
        inlineMathDelimiter: productSettings?.export?.inlineMathDelimiter,
        displayMathDelimiter: productSettings?.export?.displayMathDelimiter
      });
    if (!output?.ok) return false;
    try {
      if (format === "notion" && output.html && typeof ClipboardItem === "function" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([output.plainText], { type: "text/plain" }),
          "text/html": new Blob([output.html], { type: "text/html" })
        })]);
      } else {
        await navigator.clipboard.writeText(output.markdown || output.plainText);
      }
      hideHighlightToolbar();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function documentForPendingAnswer() {
    let documentModel = pendingHighlight?.documentModel || null;
    if (!documentModel && pendingHighlight?.recordId) {
      const record = highlightRecords.find((item) => item.id === pendingHighlight.recordId);
      const turn = record ? adapter.listTurns(document).find((item) => item.role === "assistant" && item.turnId === record.anchor.turnId) : null;
      const generationState = turn ? adapter.generationStateForTurn(turn) : null;
      if (turn && generationState === "SETTLED") documentModel = answerDocument.fromAssistantTurn(turn, { conversationId: currentConversationId(), generationState });
    }
    return documentModel?.durable ? documentModel : null;
  }

  function inspectExistingHighlightAtPoint(point) {
    const hits = [];
    for (const [recordId, range] of renderedHighlights) {
      if (Array.from(range.getClientRects()).some((rect) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)) {
        hits.push({ recordId, range });
      }
    }
    if (hits.length !== 1) return hideHighlightToolbar();
    const rect = visibleRangeRect(hits[0].range);
    if (rect) showHighlightToolbar(rect, hits[0].recordId);
  }

  function hideHighlightToolbar() {
    highlightToolbar?.remove();
    pendingHighlight = null;
  }

  function scheduleHighlightReconcile() {
    if (!settings.enabled || !settings.highlighter || !highlighterReady || highlightFrame) return;
    highlightFrame = requestAnimationFrame(() => {
      highlightFrame = 0;
      reconcileHighlights();
    });
  }

  function reconcileHighlights() {
    if (!highlightEngine || !settings.enabled || !settings.highlighter || !highlighterReady) {
      clearRenderedHighlights();
      return highlighterStatus();
    }
    ensureHighlightStyles();
    const turns = new Map(adapter.listTurns(document).filter((turn) => turn.role === "assistant").map((turn) => [turn.turnId, turn]));
    const colorRanges = new Map(highlightEngine.colors.map((color) => [color, []]));
    const nextRendered = new Map();
    let recordsChanged = false;
    highlightRecords = highlightRecords.map((record) => {
      if (record.anchor.conversationId !== currentConversationId()) return record;
      const turn = turns.get(record.anchor.turnId);
      if (!turn) return record;
      const generationState = adapter.generationStateForTurn(turn);
      if (generationState !== "SETTLED") return record;
      const documentModel = answerDocument.fromAssistantTurn(turn, { conversationId: currentConversationId(), generationState });
      const resolution = highlightEngine.resolveRecord(record, turn, documentModel);
      const updated = highlightEngine.withResolution(record, resolution) || record;
      recordsChanged ||= updated !== record;
      if (resolution.status === "resolved") {
        colorRanges.get(updated.color)?.push(resolution.range);
        nextRendered.set(updated.id, resolution.range);
      }
      return updated;
    });
    clearRenderedHighlights();
    for (const [color, ranges] of colorRanges) {
      if (ranges.length) CSS.highlights.set(`mica-${color}`, new Highlight(...ranges));
    }
    renderedHighlights = nextRendered;
    if (recordsChanged) void persistHighlightRecords();
    return highlighterStatus();
  }

  function ensureHighlightStyles() {
    if (document.querySelector("style[data-mica-highlighter-style]")) return;
    const style = document.createElement("style");
    style.dataset.micaHighlighterStyle = "true";
    style.textContent = `
      ::highlight(mica-yellow){background-color:#f6df79;color:inherit}
      ::highlight(mica-mint){background-color:#9ee3cf;color:inherit}
      ::highlight(mica-blue){background-color:#9ec9f5;color:inherit}
      ::highlight(mica-pink){background-color:#f2acd0;color:inherit}
    `;
    (document.head || document.documentElement).append(style);
  }

  function clearRenderedHighlights() {
    if (globalThis.CSS?.highlights) {
      for (const color of highlightEngine?.colors || []) CSS.highlights.delete(`mica-${color}`);
    }
    renderedHighlights = new Map();
  }

  function clearHighlighterSurface() {
    hideHighlightToolbar();
    clearRenderedHighlights();
  }

  function highlighterStatus() {
    const current = highlightRecords.filter((record) => record.anchor.conversationId === currentConversationId());
    return {
      supported: highlighterReady,
      enabled: settings.enabled && settings.highlighter,
      localOnly: true,
      recordCount: current.length,
      renderedCount: renderedHighlights.size,
      unresolvedCount: current.filter((record) => record.status === "unresolved").length,
      permanentToolbar: false
    };
  }

  function currentConversationId() {
    return `conversation-${hashText(location.pathname)}`;
  }

  function getAnswerDocument(turnId) {
    if (!settings.enabled) return null;
    const turn = adapter.listTurns(document).find((candidate) => candidate.turnId === turnId && candidate.role === "assistant");
    if (!turn) return null;
    const generationState = adapter.generationStateForTurn(turn);
    if (!generationState) return null;
    return answerDocument.fromAssistantTurn(turn, {
      conversationId: currentConversationId(),
      generationState
    });
  }

  function serializeAnswer(turnId, format = "markdown") {
    if (!settings.enabled || !settings.copyExport || !answerSerializer) return { ok: false, reason: "copy_export_disabled" };
    const documentModel = getAnswerDocument(turnId);
    if (!documentModel?.durable) return { ok: false, reason: "answer_not_settled" };
    if (format === "notion") return answerSerializer.serializeNotion(documentModel, productSettings?.export || {});
    if (format === "pdf") return pdfExport?.buildModel(documentModel, highlightRecords) || { ok: false, reason: "pdf_unavailable" };
    return answerSerializer.serializeMarkdown(documentModel, {
      flavor: productSettings?.export?.markdownFlavor,
      inlineMathDelimiter: productSettings?.export?.inlineMathDelimiter,
      displayMathDelimiter: productSettings?.export?.displayMathDelimiter
    });
  }

  function conversationExportStatus(inspection = adapter.inspect(document)) {
    if (!conversationExport) return { ready: false, reason: "conversation_export_unavailable" };
    const status = conversationExport.readiness({
      enabled: settings.enabled && settings.copyExport,
      lowMemoryActive: lowMemoryStatus.active,
      conversationId: currentConversationId(),
      completenessProof: lowMemoryStatus.completenessProof,
      inspection
    });
    if (!status.ready) return status;
    const lastAssistant = [...inspection.turns].reverse().find((turn) => turn.role === "assistant");
    if (!lastAssistant || adapter.generationStateForTurn(lastAssistant) !== "SETTLED") return { ...status, ready: false, reason: "assistant_not_settled" };
    if (inspection.turns.some((turn) => !(turn.contentRoot instanceof HTMLElement))) return { ...status, ready: false, reason: "turn_content_unavailable" };
    return status;
  }

  function collectConversationBundle() {
    if (!conversationExport || !answerSerializer) return { ok: false, reason: "conversation_export_unavailable", localOnly: true };
    const inspection = adapter.inspect(document);
    const conversationId = currentConversationId();
    return conversationExport.collect({
      inspection,
      conversationId,
      completenessProof: lowMemoryStatus.completenessProof,
      createDocument: (turn) => turn.role === "assistant"
        ? answerDocument.fromAssistantTurn(turn, { conversationId, generationState: adapter.generationStateForTurn(turn) })
        : answerDocument.fromUserTurn(turn, { conversationId })
    });
  }

  function serializeConversation() {
    if (!settings.enabled || !settings.copyExport || !answerSerializer) return { ok: false, reason: "copy_export_disabled", localOnly: true };
    const collected = collectConversationBundle();
    if (!collected.ok) return collected;
    return answerSerializer.serializeConversation(collected.bundle, {
      flavor: productSettings?.export?.markdownFlavor,
      inlineMathDelimiter: productSettings?.export?.inlineMathDelimiter,
      displayMathDelimiter: productSettings?.export?.displayMathDelimiter
    });
  }

  async function exportConversationPdf() {
    if (!settings.enabled || !settings.copyExport || !pdfExport?.buildConversationModel) return { ok: false, reason: "pdf_unavailable", localOnly: true };
    const collected = collectConversationBundle();
    if (!collected.ok) return collected;
    const built = pdfExport.buildConversationModel(collected.bundle, highlightRecords);
    if (!built.ok) return built;
    const token = globalThis.crypto?.randomUUID?.();
    if (!token) return { ok: false, reason: "secure_token_unavailable", localOnly: true };
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "MICA_OPEN_PDF_EXPORT", token, model: built.model }, (response) => resolve(chrome.runtime.lastError
        ? { ok: false, reason: "pdf_handoff_failed", localOnly: true }
        : response || { ok: false, reason: "pdf_handoff_failed", localOnly: true }));
    });
  }

  function sanitizeCompletenessProof(value) {
    if (value?.schemaVersion !== 1 || value.source !== "validated-conversation-graph") return null;
    if (!Number.isInteger(value.expectedTurnCount) || value.expectedTurnCount < 1 || value.expectedTurnCount > 20000) return null;
    if (!/^[a-f0-9]{8}$/.test(value.roleSequenceHash || "")) return null;
    const suppliedConversationId = typeof value.conversationId === "string" ? value.conversationId : null;
    if (!/^conversation-[a-f0-9]{8}$/.test(suppliedConversationId || "")) return null;
    return {
      schemaVersion: 1,
      expectedTurnCount: value.expectedTurnCount,
      roleSequenceHash: value.roleSequenceHash,
      source: value.source,
      conversationId: suppliedConversationId,
      capturedAt: typeof value.capturedAt === "string" && Number.isFinite(Date.parse(value.capturedAt)) ? value.capturedAt : new Date().toISOString()
    };
  }

  function buildSanitizedQaReport() {
    const status = refreshStatus();
    return {
      schema: "mica-developer-qa.v1",
      generatedAt: new Date().toISOString(),
      candidate: {
        version: VERSION,
        versionName: VERSION_NAME,
        buildLabel: BUILD_LABEL,
        contractHash: CONTRACT_HASH
      },
      page: {
        supportedHost: ["chatgpt.com", "chat.openai.com"].includes(location.hostname),
        state: status.state,
        compatibility: status.compatibility || null
      },
      runtime: {
        enabled: settings.enabled,
        adapterProducer: "MicaChatGPTAdapter",
        answerDocumentModelVersion: answerDocument.modelVersion,
        observerActive: !!observer,
        lowMemory: { ...lowMemoryStatus, enabled: settings.enabled && settings.lowMemory },
        highlighter: highlighterStatus(),
        reliability: recoveryController?.snapshot?.() || null
      },
      privacy: {
        conversationTextIncluded: false,
        attachmentContentIncluded: false,
        requestBodyIncluded: false,
        authTokenIncluded: false,
        rawDomIncluded: false
      }
    };
  }

  function exposeFixtureHook() {
    if (document.documentElement.dataset.micaFixture !== "true") return;
    globalThis.__MICA_FOUNDATION_TEST__ = Object.freeze({
      refreshStatus,
      buildSanitizedQaReport,
      getAnswerDocument,
      serializeAnswer,
      collectConversationBundle,
      serializeConversation,
      getConversationExportStatus: () => conversationExportStatus(),
      buildConversationPdfModel: () => {
        const collected = collectConversationBundle();
        return collected.ok ? pdfExport?.buildConversationModel?.(collected.bundle, highlightRecords) || null : collected;
      },
      applySettings,
      requestFullHistory,
      getLowMemoryStatus: () => ({ ...lowMemoryStatus }),
      getHighlighterStatus: highlighterStatus,
      inspectHighlightSelection,
      reconcileHighlights,
      getHighlightRecords: () => structuredClone(highlightRecords),
      updateHighlightColor,
      deleteHighlight,
      exportPendingAnswer,
      copyPendingAnswer,
      getRecoveryStatus: () => recoveryController?.snapshot?.() || null,
      buildPdfExportModel: (documentModel) => pdfExport?.buildModel(documentModel, highlightRecords) || null,
      adapter,
      answerDocument
    });
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
  }
})();
