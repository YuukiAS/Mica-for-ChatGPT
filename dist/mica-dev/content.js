(() => {
  const VERSION = "0.2.0";
  const VERSION_NAME = "0.2.0";
  const BUILD_LABEL = "product-foundation.1";
  const CONTRACT_HASH = "cc6f89fc65d4c36da2f859618ec7dc61efa3ceafd336a21a997ef93d5572bd7f";
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true });
  const STORAGE_KEYS = Object.keys(DEFAULT_SETTINGS);
  const adapter = globalThis.MicaChatGPTAdapter;
  const answerDocument = globalThis.MicaAnswerDocument;
  let settings = { ...DEFAULT_SETTINGS };
  let observer = null;
  let scheduled = false;
  let lastStatus = loadingStatus();

  if (!adapter || !answerDocument || !isSupportedPage()) return;

  initialize();

  async function initialize() {
    settings = { ...DEFAULT_SETTINGS, ...(await readSettings()) };
    setupMessages();
    setupNavigationSignals();
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
      if (!storage) return resolve({});
      storage.get(STORAGE_KEYS, (items) => resolve(chrome.runtime?.lastError ? {} : sanitizeSettings(items || {})));
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
    return { enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled };
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
        sendResponse({ answerDocument: getAnswerDocument(message.turnId, message.generationState) });
        return false;
      }
      return false;
    });
  }

  async function applySettings(value) {
    const next = sanitizeSettings(value || {});
    settings = { ...settings, ...next };
    await writeSettings(settings);
    if (settings.enabled) setupObserver();
    else teardownObserver();
  }

  function getAnswerDocument(turnId, generationState) {
    if (!settings.enabled) return null;
    const turn = adapter.listTurns(document).find((candidate) => candidate.turnId === turnId && candidate.role === "assistant");
    if (!turn) return null;
    return answerDocument.fromAssistantTurn(turn, {
      conversationId: `conversation-${hashText(location.pathname)}`,
      generationState: generationState === "STREAMING" ? "STREAMING" : "SETTLED"
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
        observerActive: !!observer
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
})();
