(() => {
  const DEFAULT_KEEP_COUNT = 40;
  const DEFAULT_THRESHOLD = 80;
  const MAX_GRAPH_NODES = 20000;
  const HIDDEN_CONTENT_TYPES = new Set(["model_editable_context"]);

  function windowJsonPayload(payload, options = {}) {
    const candidates = findConversationCandidates(payload);
    if (candidates.length !== 1) return unchanged(candidates.length ? "ambiguous_conversation_shape" : "shape_unrecognized");
    const result = windowMapping(candidates[0], options);
    if (!result.changed) return result;
    return { ...result, payload };
  }

  function windowTurboStreamChunk(chunk, streamState = {}, options = {}) {
    if (typeof chunk !== "string") return { action: "pass", chunk, reason: "non_string_chunk" };
    let flat;
    if (/^\s*\[/.test(chunk)) {
      try { flat = JSON.parse(chunk); } catch (_error) { return { action: "pass", chunk, reason: "initial_chunk_invalid" }; }
    }
    if (!Array.isArray(flat)) {
      if (streamState.indexMap instanceof Map) return rewriteContinuation(chunk, streamState.indexMap);
      return { action: "pass", chunk, reason: "non_initial_chunk" };
    }
    delete streamState.indexMap;
    delete streamState.meta;
    const result = windowTurboFlatGraph(flat, options);
    if (!result.changed) return { action: "pass", chunk, ...result };
    streamState.indexMap = result.indexMap;
    streamState.meta = result.meta;
    return {
      action: "replace",
      chunk: JSON.stringify(result.flat),
      reason: "windowed",
      meta: result.meta,
      indexMap: result.indexMap
    };
  }

  function windowMapping(container, options = {}) {
    if (!isRecord(container?.mapping) || typeof container.current_node !== "string") return unchanged("shape_unrecognized");
    const analysis = analyzeMapping(container.mapping, container.current_node, options);
    if (!analysis.ok) return unchanged(analysis.reason, analysis.meta);
    if (!analysis.apply) return unchanged("below_threshold", analysis.meta);
    const nextMapping = {};
    nextMapping[analysis.rootId] = { ...container.mapping[analysis.rootId], children: [analysis.cutId] };
    delete nextMapping[analysis.rootId].parent;
    for (const id of analysis.retainedIds) {
      if (id === analysis.rootId) continue;
      nextMapping[id] = { ...container.mapping[id] };
    }
    nextMapping[analysis.cutId] = { ...nextMapping[analysis.cutId], parent: analysis.rootId };
    container.mapping = nextMapping;
    if (Object.hasOwn(container, "root")) container.root = analysis.rootId;
    const bytesBefore = byteLength(JSON.stringify({ mapping: analysis.originalMapping, current_node: container.current_node }));
    const bytesAfter = byteLength(JSON.stringify({ mapping: nextMapping, current_node: container.current_node }));
    return changedResult(analysis, bytesBefore, bytesAfter);
  }

  function windowTurboFlatGraph(flat, options = {}) {
    const originalBytes = byteLength(JSON.stringify(flat));
    const candidates = [];
    for (let index = 0; index < flat.length; index += 1) {
      const value = flat[index];
      if (!isRecord(value)) continue;
      const mappingProp = findFlatProperty(value, "mapping", flat);
      const currentProp = findFlatProperty(value, "current_node", flat);
      if (mappingProp && currentProp) candidates.push({ index, value, mappingProp, currentProp });
    }
    if (candidates.length !== 1) return unchanged(candidates.length ? "ambiguous_conversation_shape" : "shape_unrecognized");
    const candidate = candidates[0];
    const mapping = dereference(candidate.mappingProp.value, flat);
    const currentNode = dereference(candidate.currentProp.value, flat);
    if (!isRecord(mapping) || typeof currentNode !== "string") return unchanged("shape_unrecognized");

    const entries = new Map();
    for (const [encodedKey, nodeRef] of Object.entries(mapping)) {
      const idIndex = parseEncodedKey(encodedKey);
      const id = idIndex == null ? null : flat[idIndex];
      const node = dereference(nodeRef, flat);
      if (typeof id !== "string" || !Number.isInteger(nodeRef) || nodeRef < 0 || !isRecord(node) || entries.has(id)) {
        return unchanged("graph_invalid");
      }
      entries.set(id, { idIndex, nodeRef, node });
    }
    const adapter = {
      getNode: (id) => entries.get(id)?.node || null,
      getParent: (node) => readFlatStringProperty(node, "parent", flat),
      getChildren: (node) => readFlatStringArrayProperty(node, "children", flat),
      getRole: (node) => {
        const message = readFlatObjectProperty(node, "message", flat);
        const author = readFlatObjectProperty(message, "author", flat);
        return readFlatStringProperty(author, "role", flat);
      },
      getContentType: (node) => {
        const message = readFlatObjectProperty(node, "message", flat);
        const content = readFlatObjectProperty(message, "content", flat);
        return readFlatStringProperty(content, "content_type", flat);
      }
    };
    const analysis = analyzeGraph(entries.size, currentNode, adapter, options);
    if (!analysis.ok) return unchanged(analysis.reason, analysis.meta);
    if (!analysis.apply) return unchanged("below_threshold", analysis.meta);

    const rootEntry = entries.get(analysis.rootId);
    const cutEntry = entries.get(analysis.cutId);
    const rootChildren = findFlatProperty(rootEntry.node, "children", flat);
    const cutParent = findFlatProperty(cutEntry.node, "parent", flat);
    if (!rootChildren || !cutParent) return unchanged("graph_invalid");
    for (const encodedKey of Object.keys(mapping)) delete mapping[encodedKey];
    for (const id of analysis.retainedIds) {
      const entry = entries.get(id);
      mapping[`_${entry.idIndex}`] = entry.nodeRef;
    }
    const nextChildrenRef = flat.length;
    flat.push([cutEntry.idIndex]);
    rootChildren.owner[rootChildren.key] = nextChildrenRef;
    cutParent.owner[cutParent.key] = rootEntry.idIndex;

    const compacted = compactFlatGraph(flat);
    if (!compacted.ok) return unchanged(compacted.reason);
    const bytesAfter = byteLength(JSON.stringify(compacted.flat));
    return {
      changed: true,
      flat: compacted.flat,
      indexMap: compacted.indexMap,
      meta: changedResult(analysis, originalBytes, bytesAfter).meta
    };
  }

  function analyzeMapping(mapping, currentNode, options) {
    const adapter = {
      getNode: (id) => mapping[id] || null,
      getParent: (node) => node?.parent,
      getChildren: (node) => node?.children,
      getRole: (node) => node?.message?.author?.role,
      getContentType: (node) => node?.message?.content?.content_type
    };
    const result = analyzeGraph(Object.keys(mapping).length, currentNode, adapter, options);
    return { ...result, originalMapping: mapping };
  }

  function analyzeGraph(totalNodes, currentNode, adapter, options = {}) {
    const keepCount = clamp(options.keepCount ?? DEFAULT_KEEP_COUNT, 8, 120);
    const threshold = Math.max(keepCount + 2, clamp(options.threshold ?? DEFAULT_THRESHOLD, keepCount + 2, 500));
    if (!Number.isInteger(totalNodes) || totalNodes < 1 || totalNodes > MAX_GRAPH_NODES) return { ok: false, reason: "graph_invalid" };
    const reversePath = [];
    const visited = new Set();
    let cursor = currentNode;
    while (typeof cursor === "string" && reversePath.length <= MAX_GRAPH_NODES) {
      if (visited.has(cursor)) return { ok: false, reason: "graph_invalid" };
      const node = adapter.getNode(cursor);
      if (!isRecord(node)) return { ok: false, reason: "graph_invalid" };
      visited.add(cursor);
      reversePath.push(cursor);
      const parent = adapter.getParent(node);
      if (parent == null) break;
      if (typeof parent !== "string") return { ok: false, reason: "graph_invalid" };
      cursor = parent;
    }
    if (!reversePath.length || reversePath.length > MAX_GRAPH_NODES) return { ok: false, reason: "graph_invalid" };
    const path = reversePath.reverse();
    const rootId = path[0];
    if (isVisible(adapter.getNode(rootId), adapter)) return { ok: false, reason: "root_unrecognized" };
    for (let index = 0; index < path.length; index += 1) {
      const id = path[index];
      const children = adapter.getChildren(adapter.getNode(id));
      if (!Array.isArray(children) || children.some((child) => typeof child !== "string" || !adapter.getNode(child))) return { ok: false, reason: "graph_invalid" };
      if (index + 1 < path.length && !children.includes(path[index + 1])) return { ok: false, reason: "graph_invalid" };
    }
    const visibleTotal = path.reduce((total, id) => total + (isVisible(adapter.getNode(id), adapter) ? 1 : 0), 0);
    const baseMeta = { totalNodes, visibleTotal, recentTurnLimit: keepCount };
    if (visibleTotal < threshold) return { ok: true, apply: false, rootId, meta: { ...baseMeta, visibleKept: visibleTotal, keptNodes: totalNodes } };

    let visibleSeen = 0;
    let boundaryIndex = -1;
    for (let index = path.length - 1; index > 0; index -= 1) {
      if (!isVisible(adapter.getNode(path[index]), adapter)) continue;
      visibleSeen += 1;
      if (visibleSeen === keepCount) { boundaryIndex = index; break; }
    }
    if (boundaryIndex <= 1) return { ok: false, reason: "cut_unavailable", meta: baseMeta };
    let cutIndex = boundaryIndex;
    while (cutIndex > 1 && !isVisible(adapter.getNode(path[cutIndex - 1]), adapter)) cutIndex -= 1;
    const cutId = path[cutIndex];
    const retainedIds = new Set([rootId]);
    const stack = [cutId];
    while (stack.length) {
      const id = stack.pop();
      if (retainedIds.has(id)) continue;
      const node = adapter.getNode(id);
      if (!isRecord(node)) return { ok: false, reason: "graph_invalid", meta: baseMeta };
      retainedIds.add(id);
      if (retainedIds.size > MAX_GRAPH_NODES) return { ok: false, reason: "graph_invalid", meta: baseMeta };
      const children = adapter.getChildren(node);
      if (!Array.isArray(children)) return { ok: false, reason: "graph_invalid", meta: baseMeta };
      for (const child of children) {
        const childNode = adapter.getNode(child);
        if (!isRecord(childNode) || adapter.getParent(childNode) !== id) return { ok: false, reason: "graph_invalid", meta: baseMeta };
        stack.push(child);
      }
    }
    if (!retainedIds.has(currentNode)) return { ok: false, reason: "cut_unavailable", meta: baseMeta };
    const visibleKept = [...retainedIds].reduce((total, id) => total + (id !== rootId && isVisible(adapter.getNode(id), adapter) ? 1 : 0), 0);
    if (visibleKept < keepCount) return { ok: false, reason: "cut_unavailable", meta: baseMeta };
    return {
      ok: true,
      apply: true,
      rootId,
      cutId,
      retainedIds,
      meta: { ...baseMeta, retainedRecentTurns: keepCount, visibleKept, keptNodes: retainedIds.size, removedNodes: totalNodes - retainedIds.size }
    };
  }

  function compactFlatGraph(flat) {
    const reachable = new Set();
    const stack = [0];
    while (stack.length) {
      const index = stack.pop();
      if (!Number.isInteger(index) || index < 0 || index >= flat.length || reachable.has(index)) continue;
      reachable.add(index);
      const value = flat[index];
      if (Array.isArray(value)) {
        for (const item of value) if (Number.isInteger(item) && item >= 0) stack.push(item);
      } else if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
          const keyIndex = parseEncodedKey(key);
          if (keyIndex == null) return { ok: false, reason: "stream_key_unrecognized" };
          stack.push(keyIndex);
          if (Number.isInteger(item) && item >= 0) stack.push(item);
        }
      }
    }
    const ordered = [...reachable].sort((a, b) => a - b);
    const indexMap = new Map(ordered.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const next = [];
    try {
      for (const oldIndex of ordered) {
        const value = flat[oldIndex];
        if (Array.isArray(value)) {
          next.push(value.map((item) => remapReference(item, indexMap)));
        } else if (isRecord(value)) {
          const object = {};
          for (const [key, item] of Object.entries(value)) {
            const keyIndex = indexMap.get(parseEncodedKey(key));
            if (!Number.isInteger(keyIndex)) return { ok: false, reason: "stream_reference_invalid" };
            object[`_${keyIndex}`] = remapReference(item, indexMap);
          }
          next.push(object);
        } else {
          next.push(value);
        }
      }
    } catch (_error) {
      return { ok: false, reason: "stream_reference_invalid" };
    }
    return { ok: true, flat: next, indexMap };
  }

  function rewriteContinuation(chunk, indexMap) {
    const match = /^([A-Z])(\d+):(.*)$/s.exec(chunk);
    if (!match) return { action: "pass", chunk, reason: "continuation_unrecognized" };
    const nextIndex = indexMap.get(Number(match[2]));
    if (!Number.isInteger(nextIndex)) return { action: "drop", chunk: "", reason: "unreachable_continuation" };
    return { action: "replace", chunk: `${match[1]}${nextIndex}:${match[3]}`, reason: "continuation_remapped" };
  }

  function findConversationCandidates(root) {
    const found = [];
    const seen = new Set();
    const stack = [{ value: root, depth: 0 }];
    while (stack.length) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value) || depth > 10) continue;
      seen.add(value);
      if (isRecord(value.mapping) && typeof value.current_node === "string") found.push(value);
      if (found.length > 1) return found;
      for (const child of Array.isArray(value) ? value : Object.values(value)) {
        if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
      }
    }
    return found;
  }

  function findFlatProperty(owner, name, flat) {
    if (!isRecord(owner)) return null;
    const matches = [];
    for (const [key, value] of Object.entries(owner)) {
      const index = parseEncodedKey(key);
      if (index != null && flat[index] === name) matches.push({ owner, key, value, keyIndex: index });
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function readFlatObjectProperty(owner, name, flat) {
    const prop = findFlatProperty(owner, name, flat);
    const value = prop ? dereference(prop.value, flat) : null;
    return isRecord(value) ? value : null;
  }

  function readFlatStringProperty(owner, name, flat) {
    const prop = findFlatProperty(owner, name, flat);
    if (!prop) return undefined;
    const value = dereference(prop.value, flat);
    return value == null || typeof value === "string" ? value : undefined;
  }

  function readFlatStringArrayProperty(owner, name, flat) {
    const prop = findFlatProperty(owner, name, flat);
    const value = prop ? dereference(prop.value, flat) : null;
    if (!Array.isArray(value)) return null;
    const strings = value.map((item) => dereference(item, flat));
    return strings.every((item) => typeof item === "string") ? strings : null;
  }

  function isVisible(node, adapter) {
    const role = adapter.getRole(node);
    if (role !== "user" && role !== "assistant") return false;
    return !HIDDEN_CONTENT_TYPES.has(adapter.getContentType(node));
  }

  function changedResult(analysis, bytesBefore, bytesAfter) {
    return {
      changed: true,
      reason: "windowed",
      meta: {
        ...analysis.meta,
        bytesBefore,
        bytesAfter,
        bytesRemoved: Math.max(0, bytesBefore - bytesAfter),
        actualTruncation: bytesAfter < bytesBefore && analysis.meta.removedNodes > 0,
        truncatedRepresentation: "client-history-window",
        serverMutation: false,
        reactManagedInteractiveNodesDetached: false
      }
    };
  }

  function unchanged(reason, meta = {}) {
    return { changed: false, reason, meta: { ...meta, actualTruncation: false, serverMutation: false, reactManagedInteractiveNodesDetached: false } };
  }

  function remapReference(value, indexMap) {
    if (!Number.isInteger(value) || value < 0) return value;
    const mapped = indexMap.get(value);
    if (!Number.isInteger(mapped)) throw new Error("stream_reference_invalid");
    return mapped;
  }

  function dereference(value, flat) {
    return Number.isInteger(value) && value >= 0 ? flat[value] : value;
  }

  function parseEncodedKey(key) {
    const match = /^_(\d+)$/.exec(key);
    return match ? Number(match[1]) : null;
  }

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function clamp(value, min, max) {
    const numeric = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(numeric) ? Math.round(numeric) : min));
  }

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  globalThis.MicaLowMemoryCore = Object.freeze({
    DEFAULT_KEEP_COUNT,
    DEFAULT_THRESHOLD,
    windowJsonPayload,
    windowTurboStreamChunk
  });
})();
