(() => {
  const VERSION = "__MICA_VERSION__";
  const VERSION_NAME = "__MICA_VERSION_NAME__";
  const BUILD_LABEL = "__MICA_BUILD_LABEL__";
  const DEFAULT_SETTINGS = { enabled: true, copyExport: true, reliability: true, pageIntegration: true, highlighter: true, lowMemory: true };
  const STORAGE_KEYS = Object.keys(DEFAULT_SETTINGS);
  const SUPPORTED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  let settings = { ...DEFAULT_SETTINGS };
  let injectionScheduled = false;

  if (!isSupportedPage()) return;
  initialize();

  async function initialize() {
    injectStyles();
    settings = { ...DEFAULT_SETTINGS, ...(await readSettings()) };
    globalThis.MicaTurnDeliveryGuard?.configure({ enabled: settings.enabled && settings.reliability });
    await globalThis.MicaHighlighter?.configure({ enabled: settings.enabled && settings.highlighter });
    await globalThis.MicaLowMemoryWindowing?.configure({ enabled: settings.enabled && settings.lowMemory, keepCount: 40 });
    attachLifecycleListeners();
    observeStructure();
    setupMessages();
    scheduleInjectionCheck();
    exposeTestApi();
  }

  function isSupportedPage() {
    return SUPPORTED_HOSTS.has(location.hostname) || document.documentElement.dataset.micaFixture === "true";
  }

  function readSettings() {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve({});
      storage.get(STORAGE_KEYS, (items) => resolve(globalThis.chrome?.runtime?.lastError ? {} : sanitizeSettings(items || {})));
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
    const next = {};
    for (const key of STORAGE_KEYS) if (typeof value[key] === "boolean") next[key] = value[key];
    return next;
  }

  function attachLifecycleListeners() {
    document.addEventListener("submit", (event) => {
      if (!settings.enabled || !settings.reliability) return;
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const composer = form?.querySelector("textarea#mobile-composer-prompt, textarea, [contenteditable='true'][role='textbox']");
      if (!composer) return;
      globalThis.MicaTurnDeliveryGuard?.recordSendIntent({
        promptText: globalThis.MicaTurnDeliveryGuard?.getComposerValue(composer) || "",
        sensitiveContext: globalThis.MicaTurnDeliveryGuard?.hasSensitiveContext(form) || false,
        source: "form_submit"
      });
    }, true);
  }

  function observeStructure() {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      if (!settings.enabled || !settings.pageIntegration) return;
      if (!mutations.some((mutation) => mutation.type === "childList" && (mutation.addedNodes.length || mutation.removedNodes.length))) return;
      scheduleInjectionCheck();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });
  }

  function scheduleInjectionCheck() {
    if (injectionScheduled) return;
    injectionScheduled = true;
    requestAnimationFrame(() => {
      injectionScheduled = false;
      reconcileCopyControls();
    });
  }

  function reconcileCopyControls() {
    document.querySelectorAll("[data-mica-ui='copy-markdown']").forEach((control) => {
      if (!settings.enabled || !settings.copyExport || !settings.pageIntegration || !isVerifiedCurrentActionCluster(control.parentElement)) control.remove();
    });
    if (!settings.enabled || !settings.copyExport || !settings.pageIntegration) return;
    for (const cluster of findVerifiedActionClusters()) {
      if (cluster.querySelector(":scope > [data-mica-ui='copy-markdown']")) continue;
      const nativeCopy = findNativeCopyButton(cluster);
      if (!nativeCopy) continue;
      nativeCopy.insertAdjacentElement("afterend", createCopyButton(cluster));
    }
  }

  function findVerifiedActionClusters() {
    const fixtureClusters = Array.from(document.querySelectorAll("[data-mica-current-action-cluster='exact-v1']"));
    const currentLiveClusters = Array.from(document.querySelectorAll("button[data-testid='copy-turn-action-button']"), (button) => button.parentElement);
    return Array.from(new Set([...fixtureClusters, ...currentLiveClusters])).filter((cluster) => isVerifiedCurrentActionCluster(cluster));
  }

  function isVerifiedCurrentActionCluster(cluster) {
    if (!(cluster instanceof Element)) return false;
    const fixtureContract = cluster.getAttribute("data-mica-current-action-cluster") === "exact-v1";
    const liveContract = cluster.getAttribute("role") === "group" && !!cluster.querySelector(":scope > button[data-testid='copy-turn-action-button']");
    if (!fixtureContract && !liveContract) return false;
    const turn = cluster.closest("[data-testid^='conversation-turn-'], article, section");
    const answer = turn?.querySelector("[data-message-author-role='assistant']") || (turn?.matches("[data-message-author-role='assistant']") ? turn : null);
    const nativeCopy = findNativeCopyButton(cluster);
    return !!answer && !!nativeCopy && nativeCopy.parentElement === cluster;
  }

  function findNativeCopyButton(cluster) {
    return Array.from(cluster.children).find((child) => {
      if (!(child instanceof HTMLElement)) return false;
      if (child.matches("button[data-testid='copy-turn-action-button']")) return true;
      const label = `${child.getAttribute("aria-label") || ""} ${child.getAttribute("data-testid") || ""}`;
      return /(^|\b)(copy|复制)(\b|$)/i.test(label);
    }) || null;
  }

  function createCopyButton(cluster) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.micaUi = "copy-markdown";
    button.className = "mica-native-action";
    button.setAttribute("aria-label", "Copy as Markdown");
    button.title = "Copy as Markdown";
    const nativeCopy = findNativeCopyButton(cluster);
    const nativeRect = nativeCopy?.getBoundingClientRect();
    if (nativeRect && nativeRect.width >= 24 && nativeRect.width <= 44 && nativeRect.height >= 24 && nativeRect.height <= 44) {
      button.style.width = `${Math.round(nativeRect.width)}px`;
      button.style.height = `${Math.round(nativeRect.height)}px`;
    }
    button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 5.5V4.25A1.75 1.75 0 0 1 8.25 2.5h7.5a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75H14.5M4.25 6.5h7.5a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75h-7.5a1.75 1.75 0 0 1-1.75-1.75v-7.5A1.75 1.75 0 0 1 4.25 6.5Z"/></svg>';
    button.addEventListener("click", async () => {
      const answer = cluster.closest("[data-message-author-role='assistant'], [data-testid^='conversation-turn-']");
      const result = globalThis.MicaMarkdownCopy?.serializeAnswer(answer);
      if (!result?.ok) return showTransientFeedback(button, "Copy unavailable", "error");
      try {
        await writeClipboardText(result.markdown);
        showTransientFeedback(button, "Copied as Markdown", "success");
      } catch (_error) {
        showTransientFeedback(button, "Clipboard blocked", "error");
      }
    });
    return button;
  }

  async function writeClipboardText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_error) {
      const field = document.createElement("textarea");
      field.dataset.micaUi = "clipboard-fallback";
      field.value = text;
      field.setAttribute("aria-hidden", "true");
      field.style.cssText = "position:fixed;inset:-9999px;width:1px;height:1px;opacity:0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (!copied) throw new Error("clipboard_write_failed");
    }
  }

  function showTransientFeedback(anchor, message, kind) {
    anchor.parentElement?.querySelector(":scope > [data-mica-ui='feedback']")?.remove();
    const feedback = document.createElement("span");
    feedback.dataset.micaUi = "feedback";
    feedback.className = `mica-transient-feedback mica-${kind}`;
    feedback.setAttribute("role", "status");
    feedback.textContent = message;
    anchor.insertAdjacentElement("afterend", feedback);
    setTimeout(() => feedback.remove(), 2200);
  }

  function setupMessages() {
    globalThis.chrome?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") return false;
      if (message.type === "MICA_GET_PRODUCT_STATUS") {
        sendResponse(buildProductStatus());
        return true;
      }
      if (message.type === "MICA_SET_SETTINGS") {
        const next = sanitizeSettings(message.settings || {});
        settings = { ...settings, ...next };
        writeSettings(next).then(async () => {
          await globalThis.MicaLowMemoryConfig?.syncFromExtensionStorage?.();
          globalThis.MicaTurnDeliveryGuard?.configure({ enabled: settings.enabled && settings.reliability });
          await globalThis.MicaHighlighter?.configure({ enabled: settings.enabled && settings.highlighter });
          await globalThis.MicaLowMemoryWindowing?.configure({ enabled: settings.enabled && settings.lowMemory, keepCount: 40, userInitiated: true });
          reconcileCopyControls();
          sendResponse(buildProductStatus());
        });
        return true;
      }
      if (message.type === "MICA_SERIALIZE_ACTIVE_ANSWER") {
        sendResponse(globalThis.MicaMarkdownCopy?.serializeAnswer(findLatestAssistantTurn()) || { ok: false, reason: "serializer_unavailable" });
        return true;
      }
      if (message.type === "MICA_SERIALIZE_NOTION") {
        sendResponse(globalThis.MicaResearchExport?.serializeNotion(findLatestAssistantTurn()) || { ok: false, reason: "exporter_unavailable" });
        return true;
      }
      if (message.type === "MICA_PREPARE_PDF_EXPORT") {
        sendResponse(globalThis.MicaResearchExport?.preparePdfExport(findLatestAssistantTurn()) || { ok: false, reason: "exporter_unavailable" });
        return true;
      }
      return false;
    });
  }

  function findLatestAssistantTurn() {
    const role = Array.from(document.querySelectorAll("[data-message-author-role='assistant']")).at(-1);
    return role?.closest("[data-testid^='conversation-turn-']") || role || null;
  }

  function buildProductStatus() {
    const answer = findLatestAssistantTurn();
    const delivery = globalThis.MicaTurnDeliveryGuard?.snapshot?.() || null;
    return {
      version: VERSION,
      versionName: VERSION_NAME,
      buildLabel: BUILD_LABEL,
      supported: true,
      settings: { ...settings },
      copy: {
        available: !!answer && !!globalThis.MicaMarkdownCopy?.findAnswerBody?.(answer),
        injected: document.querySelectorAll("[data-mica-ui='copy-markdown']").length > 0,
        placementContract: findVerifiedActionClusters().length > 0 ? "exact-v1" : "closed"
      },
      reliability: delivery ? { state: delivery.name, recoveryOffered: delivery.recoveryOffered, promptTextIncluded: false } : { state: "native", recoveryOffered: false, promptTextIncluded: false },
      pageIntegration: findVerifiedActionClusters().length > 0 ? "integrated" : "native_handling",
      highlighter: globalThis.MicaHighlighter?.snapshot?.() || { enabled: false, count: 0, rendered: 0, contentUpload: false },
      lowMemory: globalThis.MicaLowMemoryWindowing?.snapshot?.() || { enabled: settings.enabled && settings.lowMemory, state: "unavailable", active: false, keptTurns: 0, removedTurns: 0, contentUpload: false },
      privacy: { contentUpload: false, promptTextInDiagnostics: false, answerTextInDiagnostics: false }
    };
  }

  function exposeTestApi() {
    if (document.documentElement.dataset.micaFixture !== "true") return;
    const syncDeliveryState = () => {
      document.documentElement.dataset.micaDeliveryState = JSON.stringify(globalThis.MicaTurnDeliveryGuard?.snapshot?.() || null);
    };
    globalThis.addEventListener("mica:delivery-state", syncDeliveryState);
    syncDeliveryState();
    globalThis.__MICA_TEST_CONTROLS__ = {
      setSettings(next) {
        settings = { ...settings, ...sanitizeSettings(next) };
        globalThis.MicaTurnDeliveryGuard?.configure({ enabled: settings.enabled && settings.reliability });
        globalThis.MicaLowMemoryWindowing?.configure({ enabled: settings.enabled && settings.lowMemory, keepCount: 40 });
        reconcileCopyControls();
      },
      getStatus: buildProductStatus,
      reconcileCopyControls,
      serializeLatestAnswer: () => globalThis.MicaMarkdownCopy?.serializeAnswer(findLatestAssistantTurn())
    };
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.dataset.micaUi = "styles";
    style.textContent = `
.mica-native-action { align-items:center; background:transparent; border:0; border-radius:6px; color:inherit; cursor:pointer; display:inline-flex; height:28px; justify-content:center; padding:4px; width:28px; }
.mica-native-action:hover { background:color-mix(in srgb, currentColor 9%, transparent); }
.mica-native-action:focus-visible { outline:2px solid #55c2c7; outline-offset:2px; }
.mica-native-action svg { fill:none; height:18px; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.7; width:18px; }
.mica-transient-feedback { font:500 12px/16px system-ui,sans-serif; margin-inline-start:6px; white-space:nowrap; }
.mica-success { color:#247a46; } .mica-error { color:#b33a3a; }
.mica-delivery-notice { align-items:center; background:color-mix(in srgb, Canvas 94%, #e5aa5b 6%); border:1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius:10px; color:CanvasText; display:flex; font:500 12px/17px system-ui,sans-serif; gap:12px; justify-content:space-between; margin:0 auto 8px; max-width:768px; padding:8px 10px; }
.mica-delivery-notice button { background:transparent; border:1px solid currentColor; border-radius:7px; color:inherit; cursor:pointer; font:600 12px/16px system-ui,sans-serif; min-height:30px; padding:5px 9px; }
.mica-delivery-notice button:focus-visible { outline:2px solid #55c2c7; outline-offset:2px; }
.mica-highlight { background:#fff0a8; box-decoration-break:clone; color:inherit; padding:.04em .08em; -webkit-box-decoration-break:clone; }
.mica-highlight-affordance { background:#202322; border:1px solid rgba(255,255,255,.16); border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,.18); color:#fff; cursor:pointer; font:600 12px/16px system-ui,sans-serif; min-height:32px; padding:7px 10px; position:fixed; z-index:2147483646; }
.mica-highlight-affordance:hover { background:#2b302e; }
.mica-highlight-affordance:focus-visible { outline:2px solid #55c2c7; outline-offset:2px; }
.mica-history-window { align-items:center; background:color-mix(in srgb, Canvas 96%, #168b91 4%); border:1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius:10px; color:CanvasText; display:flex; font:500 12px/17px system-ui,sans-serif; gap:12px; justify-content:space-between; margin:12px auto 18px; max-width:768px; padding:9px 11px; }
.mica-history-window button { background:transparent; border:1px solid currentColor; border-radius:7px; color:inherit; cursor:pointer; flex:0 0 auto; font:600 12px/16px system-ui,sans-serif; min-height:30px; padding:5px 9px; }
.mica-history-window button:focus-visible { outline:2px solid #55c2c7; outline-offset:2px; }
@media (prefers-color-scheme:dark) { .mica-success { color:#70c88d; } .mica-error { color:#f18a8a; } }
@media (prefers-reduced-motion:reduce) { [data-mica-ui] { scroll-behavior:auto !important; transition:none !important; } }
`;
    document.documentElement.append(style);
  }
})();
