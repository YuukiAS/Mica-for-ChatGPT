(() => {
  const CONFIG_KEY = "mica.lowMemory.config.v1";
  const BYPASS_KEY = "mica.lowMemory.bypass.v1";
  const STATUS_EVENT = "mica-low-memory-page-status";
  const HIDDEN_ROLES = new Set(["system", "tool", "thinking"]);
  const MAX_PATH_NODES = 20000;
  const MIN_VISIBLE_TURNS = 80;
  const CONFIG_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
  let config = readConfig();
  let freshConfigReceived = false;
  let resolveConfigReady = null;
  const configReady = new Promise((resolve) => { resolveConfigReady = resolve; });

  globalThis.addEventListener("mica-low-memory-config", (event) => {
    try {
      const parsed = JSON.parse(String(event.detail || ""));
      if (typeof parsed.enabled !== "boolean") return;
      config = { enabled: parsed.enabled, keepCount: clamp(Number(parsed.keepCount) || 40, 20, 80), updatedAt: Number(parsed.updatedAt) || Date.now() };
      freshConfigReceived = true;
      resolveConfigReady?.();
      resolveConfigReady = null;
    } catch (_error) {
      // Invalid configuration is ignored and the interceptor remains fail-open.
    }
  });

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args) => interceptFetch(nativeFetch, ...args);
  publish({ state: "ready", mode: "data_window", active: false, removedTurns: 0, keptTurns: 0, contentUpload: false });

  async function interceptFetch(fetchImpl, ...args) {
    const request = describeRequest(args[0], args[1]);
    if (!request || !isConversationRequest(request)) return fetchImpl(...args);
    if (!freshConfigReceived) await Promise.race([configReady, delay(180)]);
    config ||= readConfig();
    if (!freshConfigReceived && (!config?.updatedAt || Date.now() - config.updatedAt > CONFIG_CACHE_MAX_AGE_MS)) return fetchImpl(...args);
    if (!config?.enabled || isBypassedConversation()) return fetchImpl(...args);
    const response = await fetchImpl(...args);
    try {
      if (!response.ok || !/application\/json/i.test(response.headers.get("content-type") || "")) return response;
      const payload = await response.clone().json();
      const result = windowConversation(payload, config.keepCount);
      if (!result?.changed) {
        publish({
          state: result?.reason || "not_windowed",
          mode: "data_window",
          active: false,
          totalTurns: result?.visibleTotal || 0,
          keptTurns: result?.visibleKept || 0,
          removedTurns: 0,
          contentUpload: false
        });
        return response;
      }
      publish({
        state: "active",
        mode: "data_window",
        active: true,
        totalTurns: result.visibleTotal,
        keptTurns: result.visibleKept,
        removedTurns: result.visibleTotal - result.visibleKept,
        totalNodes: result.totalNodes,
        keptNodes: result.keptNodes,
        bytesBefore: result.bytesBefore,
        bytesAfter: result.bytesAfter,
        contentUpload: false
      });
      return modifiedJsonResponse(response, { ...payload, mapping: result.mapping, current_node: result.currentNode, root: result.root });
    } catch (_error) {
      publish({ state: "processing_failed", mode: "data_window", active: false, removedTurns: 0, keptTurns: 0, contentUpload: false });
      return response;
    }
  }

  function windowConversation(data, keepCount) {
    const mapping = data?.mapping;
    const currentNode = data?.current_node;
    if (!isPlainRecord(mapping) || typeof currentNode !== "string" || !isPlainRecord(mapping[currentNode])) return { changed: false, reason: "shape_unrecognized" };
    const reversePath = [];
    const visited = new Set();
    let cursor = currentNode;
    let terminatedAtRoot = false;
    while (cursor && reversePath.length < MAX_PATH_NODES) {
      const node = mapping[cursor];
      if (!isPlainRecord(node) || visited.has(cursor)) return { changed: false, reason: "graph_invalid" };
      visited.add(cursor);
      reversePath.push(cursor);
      if (node.parent == null) {
        terminatedAtRoot = true;
        break;
      }
      if (typeof node.parent !== "string") return { changed: false, reason: "graph_invalid" };
      cursor = node.parent;
    }
    if (!terminatedAtRoot || reversePath.length >= MAX_PATH_NODES) return { changed: false, reason: "graph_invalid" };
    const path = reversePath.reverse();
    const rootId = path[0];
    const rootNode = mapping[rootId];
    if (!rootId || !isPlainRecord(rootNode) || isVisibleNode(rootNode)) return { changed: false, reason: "root_unrecognized" };
    const visibleTotal = countVisibleTurns(path, mapping);
    if (visibleTotal < Math.max(MIN_VISIBLE_TURNS, keepCount + 2)) return { changed: false, reason: "below_threshold", visibleTotal, visibleKept: visibleTotal };
    const cutIndex = findCutIndex(path, mapping, keepCount);
    if (cutIndex <= 1 || cutIndex >= path.length) return { changed: false, reason: "cut_unavailable", visibleTotal, visibleKept: visibleTotal };
    const keptPath = path.slice(cutIndex);
    for (let index = 0; index < keptPath.length - 1; index += 1) {
      const children = Array.isArray(mapping[keptPath[index]]?.children) ? mapping[keptPath[index]].children : [];
      if (children.some((child) => child !== keptPath[index + 1])) {
        return { changed: false, reason: "recent_branch_detected", visibleTotal, visibleKept: visibleTotal };
      }
    }
    const nextRootChild = keptPath[0];
    const nextMapping = {
      [rootId]: { ...rootNode, parent: null, children: nextRootChild ? [nextRootChild] : [] }
    };
    for (let index = 0; index < keptPath.length; index += 1) {
      const id = keptPath[index];
      const node = mapping[id];
      if (!isPlainRecord(node)) return { changed: false, reason: "graph_invalid", visibleTotal, visibleKept: visibleTotal };
      nextMapping[id] = {
        ...node,
        parent: index === 0 ? rootId : keptPath[index - 1],
        children: index + 1 < keptPath.length ? [keptPath[index + 1]] : []
      };
    }
    const visibleKept = countVisibleTurns([rootId, ...keptPath], nextMapping);
    if (visibleKept <= 0 || visibleKept > keepCount) return { changed: false, reason: "cut_unavailable", visibleTotal, visibleKept: visibleTotal };
    const bytesBefore = byteLength(JSON.stringify(data));
    const modified = { ...data, mapping: nextMapping, current_node: keptPath.at(-1), root: rootId };
    return {
      changed: true,
      mapping: nextMapping,
      currentNode: keptPath.at(-1),
      root: rootId,
      visibleTotal,
      visibleKept,
      totalNodes: Object.keys(mapping).length,
      keptNodes: Object.keys(nextMapping).length,
      bytesBefore,
      bytesAfter: byteLength(JSON.stringify(modified))
    };
  }

  function findCutIndex(path, mapping, keepCount) {
    let turns = 0;
    for (let index = path.length - 1; index >= 1; index -= 1) {
      const role = visibleRole(mapping[path[index]]);
      if (!role) continue;
      turns += 1;
      if (turns > keepCount) return index + 1;
    }
    return 1;
  }

  function countVisibleTurns(path, mapping) {
    let total = 0;
    for (const id of path) {
      const role = visibleRole(mapping[id]);
      if (!role) continue;
      total += 1;
    }
    return total;
  }

  function visibleRole(node) {
    const role = node?.message?.author?.role;
    return typeof role === "string" && role && !HIDDEN_ROLES.has(role) ? role : null;
  }

  function isVisibleNode(node) {
    return !!visibleRole(node);
  }

  function describeRequest(input, init) {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      return { url, method };
    } catch (_error) {
      return null;
    }
  }

  function isConversationRequest(request) {
    return request.method === "GET"
      && request.url.origin === location.origin
      && /^\/backend-api\/(?:conversation|shared_conversation)\/[^/]+\/?$/.test(request.url.pathname);
  }

  function modifiedJsonResponse(original, data) {
    const headers = new Headers(original.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", "application/json; charset=utf-8");
    const next = new Response(JSON.stringify(data), { status: original.status, statusText: original.statusText, headers });
    for (const key of ["url", "type", "redirected"]) {
      try { Object.defineProperty(next, key, { value: original[key] }); } catch (_error) { /* non-critical response metadata */ }
    }
    return next;
  }

  function isBypassedConversation() {
    try {
      return sessionStorage.getItem(BYPASS_KEY) === `${location.origin}${location.pathname}`;
    } catch (_error) {
      return false;
    }
  }

  function readConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (typeof parsed?.enabled !== "boolean") return null;
      return { enabled: parsed.enabled, keepCount: clamp(Number(parsed.keepCount) || 40, 20, 80), updatedAt: Number(parsed.updatedAt) || 0 };
    } catch (_error) {
      return null;
    }
  }

  function publish(status) {
    const detail = JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), ...status });
    document.documentElement?.setAttribute("data-mica-low-memory-page-status", detail);
    globalThis.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail }));
  }

  function isPlainRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  globalThis.MicaLowMemoryPage = { windowConversation };
})();
