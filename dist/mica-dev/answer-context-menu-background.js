(() => {
  const ROOT_ID = "mica-answer-actions";
  const ACTION_IDS = Object.freeze({
    "mica-answer-copy-markdown": "markdown",
    "mica-answer-copy-notion": "notion",
    "mica-answer-export-pdf": "pdf"
  });
  const ACTION_LABELS = Object.freeze({
    "mica-answer-copy-markdown": "Copy answer as Markdown",
    "mica-answer-copy-notion": "Copy answer for Notion",
    "mica-answer-export-pdf": "Export answer as PDF"
  });
  const DOCUMENT_PATTERNS = Object.freeze(["https://chatgpt.com/*", "https://chat.openai.com/*"]);
  const CONTEXT_TTL_MS = 15_000;
  const pendingByTab = new Map();
  const menuApi = chrome.contextMenus;
  let menusReady = false;

  chrome.runtime.onInstalled.addListener(() => { void rebuildMenus(); });
  chrome.runtime.onStartup.addListener(() => { void rebuildMenus(); });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "MICA_ANSWER_CONTEXT") return false;
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !isSupportedUrl(sender.tab?.url)) {
      sendResponse({ ok: false, reason: "invalid_answer_context_source" });
      return false;
    }
    const context = sanitizeContext(message.context);
    if (context) pendingByTab.set(tabId, context);
    else pendingByTab.delete(tabId);
    sendResponse({ ok: true, available: !!context });
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => pendingByTab.delete(tabId));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading" || changeInfo.url) pendingByTab.delete(tabId);
  });

  if (menuApi?.onShown && menuApi?.onClicked) {
    menuApi.onShown.addListener((info, tab) => { void updateMenuState(tab, info); });
    menuApi.onClicked.addListener((info, tab) => { void runMenuAction(info, tab); });
    void rebuildMenus();
  }

  async function rebuildMenus() {
    if (!menuApi?.create || !menuApi?.remove) return { ok: false, reason: "context_menus_unavailable" };
    await removeMenu(ROOT_ID);
    createMenu({ id: ROOT_ID, title: "Mica answer actions", contexts: ["page", "selection"], documentUrlPatterns: [...DOCUMENT_PATTERNS] });
    for (const [id, title] of Object.entries(ACTION_LABELS)) {
      createMenu({ id, parentId: ROOT_ID, title, contexts: ["page", "selection"], documentUrlPatterns: [...DOCUMENT_PATTERNS], enabled: false });
    }
    menusReady = true;
    return { ok: true };
  }

  async function updateMenuState(tab, info) {
    if (!Number.isInteger(tab?.id) || !isSupportedUrl(tab.url || info?.pageUrl)) return;
    const context = currentContext(tab.id);
    await Promise.all(Object.keys(ACTION_IDS).map((id) => updateMenu(id, { enabled: !!context })));
    menuApi.refresh?.();
  }

  async function runMenuAction(info, tab) {
    const action = ACTION_IDS[info?.menuItemId];
    if (!action || !Number.isInteger(tab?.id) || !isSupportedUrl(tab.url || info?.pageUrl)) return;
    const context = currentContext(tab.id);
    pendingByTab.delete(tab.id);
    if (!context || !chrome.tabs.sendMessage) return;
    await sendToTab(tab.id, {
      type: "MICA_RUN_ANSWER_CONTEXT_ACTION",
      action,
      turnId: context.turnId,
      observedAt: context.observedAt,
      evidenceClass: "EXACT"
    });
  }

  function currentContext(tabId) {
    const context = pendingByTab.get(tabId);
    if (!context) return null;
    if (Date.now() - context.observedAt > CONTEXT_TTL_MS || context.observedAt > Date.now() + 1_000) {
      pendingByTab.delete(tabId);
      return null;
    }
    return context;
  }

  function sanitizeContext(value) {
    if (value?.evidenceClass !== "EXACT" || !/^conversation-turn-[A-Za-z0-9._:-]{1,160}$/.test(value.turnId || "")) return null;
    const observedAt = Number(value.observedAt);
    if (!Number.isFinite(observedAt) || Date.now() - observedAt > CONTEXT_TTL_MS || observedAt > Date.now() + 1_000) return null;
    return { turnId: value.turnId, observedAt, evidenceClass: "EXACT", textIncluded: false };
  }

  function isSupportedUrl(value) {
    try { return ["chatgpt.com", "chat.openai.com"].includes(new URL(value).hostname); }
    catch (_error) { return false; }
  }

  function createMenu(properties) {
    try { menuApi.create(properties, () => { void chrome.runtime.lastError; }); }
    catch (_error) { /* fail open */ }
  }

  function removeMenu(id) {
    return new Promise((resolve) => {
      try { menuApi.remove(id, () => { void chrome.runtime.lastError; resolve(); }); }
      catch (_error) { resolve(); }
    });
  }

  function updateMenu(id, patch) {
    return new Promise((resolve) => {
      try { menuApi.update(id, patch, () => { void chrome.runtime.lastError; resolve(); }); }
      catch (_error) { resolve(); }
    });
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      try { chrome.tabs.sendMessage(tabId, message, (response) => { void chrome.runtime.lastError; resolve(response || null); }); }
      catch (_error) { resolve(null); }
    });
  }

  globalThis.MicaAnswerContextMenuBackground = Object.freeze({
    rootId: ROOT_ID,
    actionIds: ACTION_IDS,
    contextTtlMs: CONTEXT_TTL_MS,
    rebuildMenus,
    getStatus: () => ({ menusReady, pendingContextCount: pendingByTab.size, textIncluded: false })
  });
})();
