(() => {
  const STATUS_EVENT = "mica-low-memory-page-status";
  const core = globalThis.MicaLowMemoryCore;
  if (!core) return;

  const config = Object.freeze({ enabled: true, keepCount: core.DEFAULT_KEEP_COUNT, threshold: core.DEFAULT_THRESHOLD });
  let lastStatus = status("standby", "initializing");
  const streamState = {};
  const nativeFetch = globalThis.fetch?.bind(globalThis);

  installReactRouterHook();
  if (nativeFetch) globalThis.fetch = (...args) => interceptFetch(nativeFetch, ...args);
  publish(lastStatus);

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
    if (!request || !isConversationRequest(request)) return fetchImpl(...args);
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

  function status(stateName, reason, meta = {}, source = "none") {
    return {
      schemaVersion: 2,
      state: stateName,
      reason,
      source,
      active: stateName === "active" && meta.actualTruncation === true,
      keptTurns: meta.retainedRecentTurns || meta.visibleKept || 0,
      totalTurns: meta.visibleTotal || 0,
      completenessProof: Number.isInteger(meta.visibleTotal) && meta.visibleTotal > 0 && /^[a-f0-9]{8}$/.test(meta.visibleRoleSequenceHash || "") ? {
        schemaVersion: 1,
        expectedTurnCount: meta.visibleTotal,
        roleSequenceHash: meta.visibleRoleSequenceHash,
        source: "validated-conversation-graph",
        conversationId: `conversation-${hashText(location.pathname)}`,
        capturedAt: new Date().toISOString()
      } : null,
      removedTurns: Math.max(0, (meta.visibleTotal || 0) - (meta.visibleKept || 0)),
      keptNodes: meta.keptNodes || 0,
      totalNodes: meta.totalNodes || 0,
      bytesBefore: meta.bytesBefore || 0,
      bytesAfter: meta.bytesAfter || 0,
      bytesRemoved: meta.bytesRemoved || 0,
      recentTurnLimit: meta.recentTurnLimit || core.DEFAULT_KEEP_COUNT,
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

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  if (document.documentElement?.dataset?.micaFixture === "true") {
    globalThis.__MICA_LOW_MEMORY_PAGE_TEST__ = Object.freeze({
      snapshot: () => ({ ...lastStatus }),
      processChunk: (chunk) => core.windowTurboStreamChunk(chunk, {}, config)
    });
  }
})();
