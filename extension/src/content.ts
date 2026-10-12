(() => {
  const VERSION = "__MICA_VERSION__";
  const VERSION_NAME = "__MICA_VERSION_NAME__";
  const BUILD_LABEL = "__MICA_BUILD_LABEL__";
  const CONTRACT_HASH = "__MICA_CHATGPT_CONTRACT_HASH__";
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, lowMemory: true, lowMemoryKeepCount: 40, lowMemoryThreshold: 80 });
  const adapter = globalThis.MicaChatGPTAdapter;
  const answerDocument = globalThis.MicaAnswerDocument;
  let settings = { ...DEFAULT_SETTINGS };
  let observer = null;
  let scheduled = false;
  let lastStatus = loadingStatus();
  let lowMemoryStatus = readLowMemoryPageStatus() || defaultLowMemoryStatus();
  let historyControl = null;
  let scrollFrame = 0;

  if (!adapter || !answerDocument || !isSupportedPage()) return;

  initialize();

  async function initialize() {
    settings = await readSettings();
    const tabMode = await globalThis.MicaLowMemoryConfig?.getTabMode?.();
    if (tabMode?.mode === "full_history_bypass") {
      lowMemoryStatus = { ...defaultLowMemoryStatus("user_requested_full_history"), state: "full_history_bypass" };
    }
    setupMessages();
    setupNavigationSignals();
    setupLowMemorySignals();
    if (settings.enabled) setupObserver();
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
      storage.get(DEFAULT_SETTINGS, (items) => resolve(chrome.runtime?.lastError
        ? { ...DEFAULT_SETTINGS, enabled: false, lowMemory: false }
        : sanitizeSettings(items || DEFAULT_SETTINGS)));
    });
  }

  function writeSettings(next) {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve();
      storage.set(next, () => resolve());
    });
  }

  function sanitizeSettings(value) {
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled,
      lowMemory: typeof value.lowMemory === "boolean" ? value.lowMemory : DEFAULT_SETTINGS.lowMemory,
      lowMemoryKeepCount: clampNumber(value.lowMemoryKeepCount, 8, 120, DEFAULT_SETTINGS.lowMemoryKeepCount),
      lowMemoryThreshold: clampNumber(value.lowMemoryThreshold, 10, 500, DEFAULT_SETTINGS.lowMemoryThreshold)
    };
  }

  function setupObserver() {
    if (observer || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(() => scheduleRefresh());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function teardownObserver() {
    observer?.disconnect();
    observer = null;
  }

  function setupNavigationSignals() {
    addEventListener("popstate", scheduleRefresh, { passive: true });
    addEventListener("hashchange", scheduleRefresh, { passive: true });
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
      if (message?.type === "MICA_LOAD_FULL_HISTORY") {
        void requestFullHistory("popup").then(sendResponse);
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

  async function applySettings(value) {
    const wasLowMemoryActive = lowMemoryStatus.active === true;
    const wasLowMemoryEnabled = settings.enabled && settings.lowMemory;
    const next = sanitizeSettings({ ...settings, ...(value || {}) });
    settings = next;
    await writeSettings(settings);
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
      if (safeToReload()) await requestFullHistory("disabled_after_windowing");
    }
    if (settings.enabled) setupObserver();
    else teardownObserver();
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
      bytesRemoved: 0, recentTurnLimit: 40, actualTruncation: false,
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
    shadow.querySelector("button").addEventListener("click", async () => {
      if (lowMemoryStatus.state === "full_history_bypass" || lowMemoryStatus.state === "reload_required") {
        if (!safeToReload()) return;
        const resumed = await globalThis.MicaLowMemoryConfig?.resumeWindowing?.();
        if (resumed?.ok) scheduleReload();
        return;
      }
      await requestFullHistory("history_control");
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

  async function requestFullHistory(reason) {
    if (!lowMemoryStatus.active && lowMemoryStatus.state !== "restore_required") return { ok: false, reason: "not_windowed" };
    if (!safeToReload()) return { ok: false, reason: "active_draft_or_stream" };
    const prepared = await globalThis.MicaLowMemoryConfig?.prepareFullHistory?.();
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

  function getAnswerDocument(turnId) {
    if (!settings.enabled) return null;
    const turn = adapter.listTurns(document).find((candidate) => candidate.turnId === turnId && candidate.role === "assistant");
    if (!turn) return null;
    const generationState = adapter.generationStateForTurn(turn);
    if (!generationState) return null;
    return answerDocument.fromAssistantTurn(turn, {
      conversationId: `conversation-${hashText(location.pathname)}`,
      generationState
    });
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
        lowMemory: { ...lowMemoryStatus, enabled: settings.enabled && settings.lowMemory }
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
      applySettings,
      requestFullHistory,
      getLowMemoryStatus: () => ({ ...lowMemoryStatus }),
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
