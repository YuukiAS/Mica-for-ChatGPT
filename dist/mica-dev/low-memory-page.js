(() => {
  const CONFIG_KEY = "mica.lowMemory.config.v2";
  const BYPASS_KEY = "mica.lowMemory.bypass.v2";
  const STATUS_EVENT = "mica-low-memory-page-status";
  const core = globalThis.MicaLowMemoryCore;
  if (!core) return;

  let config = readConfig();
  let lastStatus = status("standby", "initializing");
  const streamState = {};
  const nativeFetch = globalThis.fetch?.bind(globalThis);

  installReactRouterHook();
  if (nativeFetch) globalThis.fetch = (...args) => interceptFetch(nativeFetch, ...args);
  globalThis.addEventListener("mica-low-memory-config", onConfig);
  publish(lastStatus);

  function onConfig(event) {
    try {
      const next = JSON.parse(String(event.detail || ""));
      if (typeof next.enabled !== "boolean") return;
      config = normalizeConfig(next);
    } catch (_error) {
      config = null;
    }
  }

  function installReactRouterHook() {
    const key = "__reactRouterContext";
    try {
      const existing = Object.getOwnPropertyDescriptor(globalThis, key);
      if (existing && !existing.configurable) {
        wrapContext(globalThis[key]);
        return;
      }
      let value = existing?.get ? existing.get.call(globalThis) : existing?.value;
      Object.defineProperty(globalThis, key, {
        configurable: true,
        enumerable: existing?.enumerable ?? true,
        get() { return existing?.get ? existing.get.call(this) : value; },
        set(next) {
          if (existing?.set) existing.set.call(this, next);
          else value = next;
          wrapContext(next);
        }
      });
      if (value) wrapContext(value);
    } catch (_error) {
      publish(status("degraded", "react_router_hook_unavailable"));
    }
  }

  function wrapContext(context) {
    if (!context || typeof context !== "object") return;
    const key = "streamController";
    try {
      const existing = Object.getOwnPropertyDescriptor(context, key);
      if (existing && !existing.configurable) {
        wrapController(context[key]);
        return;
      }
      let value = existing?.get ? existing.get.call(context) : existing?.value;
      Object.defineProperty(context, key, {
        configurable: true,
        enumerable: existing?.enumerable ?? true,
        get() { return existing?.get ? existing.get.call(this) : value; },
        set(next) {
          if (existing?.set) existing.set.call(this, next);
          else value = next;
          wrapController(next);
        }
      });
      if (value) wrapController(value);
    } catch (_error) {
      publish(status("degraded", "stream_controller_hook_unavailable"));
    }
  }

  function wrapController(controller) {
    if (!controller || typeof controller.enqueue !== "function" || controller.enqueue.__micaLowMemoryWrapped) return;
    const original = controller.enqueue;
    const wrapped = function (chunk, ...rest) {
      if (!isActiveForPage()) return original.call(this, chunk, ...rest);
      try {
        const result = core.windowTurboStreamChunk(chunk, streamState, config);
        if (result.meta) publish(status(result.meta.actualTruncation ? "active" : "standby", result.reason, result.meta, "react-router-stream"));
        if (result.action === "drop") return undefined;
        return original.call(this, result.chunk, ...rest);
      } catch (_error) {
        publish(status("degraded", "stream_processing_failed", {}, "react-router-stream"));
        return original.call(this, chunk, ...rest);
      }
    };
    Object.defineProperty(wrapped, "__micaLowMemoryWrapped", { value: true });
    try { Object.defineProperty(controller, "enqueue", { configurable: true, writable: true, value: wrapped }); }
    catch (_error) { publish(status("degraded", "stream_enqueue_unavailable", {}, "react-router-stream")); }
  }

  async function interceptFetch(fetchImpl, ...args) {
    const request = describeRequest(args[0], args[1]);
    if (!request || !isConversationRequest(request) || !isActiveForPage()) return fetchImpl(...args);
    const response = await fetchImpl(...args);
    try {
      if (!response.ok || !/application\/json/i.test(response.headers.get("content-type") || "")) return response;
      const payload = await response.clone().json();
      const result = core.windowJsonPayload(payload, config);
      publish(status(result.changed ? "active" : (result.reason === "below_threshold" ? "standby" : "degraded"), result.reason, result.meta, "conversation-json"));
      return result.changed ? modifiedJsonResponse(response, result.payload) : response;
    } catch (_error) {
      publish(status("degraded", "json_processing_failed", {}, "conversation-json"));
      return response;
    }
  }

  function isActiveForPage() {
    return config?.enabled === true && !isBypassedConversation();
  }

  function isConversationRequest(request) {
    return request.method === "GET" && request.url.origin === location.origin
      && /^\/backend-api\/(?:conversation|shared_conversation)\/[^/]+\/?$/.test(request.url.pathname);
  }

  function describeRequest(input, init) {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      return { url, method };
    } catch (_error) { return null; }
  }

  function modifiedJsonResponse(original, data) {
    const headers = new Headers(original.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", "application/json; charset=utf-8");
    const next = new Response(JSON.stringify(data), { status: original.status, statusText: original.statusText, headers });
    for (const key of ["url", "type", "redirected"]) {
      try { Object.defineProperty(next, key, { value: original[key] }); } catch (_error) { /* metadata is non-critical */ }
    }
    return next;
  }

  function readConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      return typeof parsed?.enabled === "boolean" ? normalizeConfig(parsed) : null;
    } catch (_error) { return null; }
  }

  function normalizeConfig(value) {
    return {
      enabled: value.enabled === true,
      keepCount: clamp(value.keepCount || core.DEFAULT_KEEP_COUNT, 8, 120),
      threshold: clamp(value.threshold || core.DEFAULT_THRESHOLD, 10, 500),
      updatedAt: Number(value.updatedAt) || Date.now()
    };
  }

  function isBypassedConversation() {
    try { return sessionStorage.getItem(BYPASS_KEY) === `${location.origin}${location.pathname}`; }
    catch (_error) { return false; }
  }

  function status(stateName, reason, meta = {}, source = "none") {
    return {
      schemaVersion: 2,
      state: stateName,
      reason,
      source,
      active: stateName === "active" && meta.actualTruncation === true,
      keptTurns: meta.retainedRecentTurns || meta.visibleKept || 0,
      totalTurns: meta.visibleTotal || 0,
      removedTurns: Math.max(0, (meta.visibleTotal || 0) - (meta.visibleKept || 0)),
      keptNodes: meta.keptNodes || 0,
      totalNodes: meta.totalNodes || 0,
      bytesBefore: meta.bytesBefore || 0,
      bytesAfter: meta.bytesAfter || 0,
      bytesRemoved: meta.bytesRemoved || 0,
      recentTurnLimit: meta.recentTurnLimit || config?.keepCount || core.DEFAULT_KEEP_COUNT,
      actualTruncation: meta.actualTruncation === true,
      truncatedRepresentation: meta.truncatedRepresentation || "client-history-window",
      serverMutation: false,
      reactManagedInteractiveNodesDetached: false,
      contentUpload: false,
      updatedAt: new Date().toISOString()
    };
  }

  function publish(next) {
    lastStatus = next;
    const detail = JSON.stringify(next);
    document.documentElement?.setAttribute("data-mica-low-memory-page-status", detail);
    globalThis.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail }));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
  }

  if (document.documentElement?.dataset?.micaFixture === "true") {
    globalThis.__MICA_LOW_MEMORY_PAGE_TEST__ = Object.freeze({
      snapshot: () => ({ ...lastStatus }),
      processChunk: (chunk) => core.windowTurboStreamChunk(chunk, {}, config || { enabled: true, keepCount: 40, threshold: 80 })
    });
  }
})();
