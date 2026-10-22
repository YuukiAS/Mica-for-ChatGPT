(() => {
  const MODEL_VERSION = 1;
  const STORE_KEY = "micaHighlightsV1";
  const COLORS = Object.freeze(["yellow", "mint", "blue", "pink"]);
  const MAX_RECORDS = 500;
  const MAX_IMPORT_CHARS = 32 * 1024 * 1024;
  const MAX_IMPORT_SOURCE_RECORDS = 1000;
  const MAX_SOURCE_OFFSET = 10_000_000;
  const ANNOTATION_LIMITS = Object.freeze({ noteChars: 2000, tags: 16, tagChars: 64 });

  function createRecord(answerDocument, snapshot, color = "yellow") {
    if (!answerDocument?.durable || answerDocument.generationState !== "SETTLED") return null;
    if (!snapshot?.textQuote || !snapshot?.sourceSpan || !snapshot?.structuralHint) return null;
    const normalizedColor = COLORS.includes(color) ? color : COLORS[0];
    const createdAt = new Date().toISOString();
    const anchor = {
      conversationId: answerDocument.conversationId,
      turnId: answerDocument.turnId,
      documentId: answerDocument.documentId,
      sourceVersion: answerDocument.sourceVersion,
      blockId: snapshot.structuralHint.startBlockId,
      textQuote: bounded(snapshot.textQuote, 4000),
      prefix: bounded(snapshot.prefix || "", 64),
      suffix: bounded(snapshot.suffix || "", 64),
      sourceSpan: { start: snapshot.sourceSpan.start, end: snapshot.sourceSpan.end },
      structuralHint: { ...snapshot.structuralHint },
      mathTeX: Array.isArray(snapshot.mathTeX) ? snapshot.mathTeX.slice(0, 32).map((value) => bounded(value, 1000)) : []
    };
    return {
      schemaVersion: MODEL_VERSION,
      id: `highlight-${hashText(`${createdAt}:${stableStringify(anchor)}`)}`,
      color: normalizedColor,
      anchor,
      annotation: sanitizeAnnotation(),
      status: "active",
      unresolvedReason: null,
      createdAt,
      updatedAt: createdAt
    };
  }

  function resolveRecord(record, turn, answerDocument) {
    if (!validRecord(record) || !answerDocument?.durable) return unresolved("invalid_record");
    if (record.anchor.conversationId !== answerDocument.conversationId) return unresolved("conversation_mismatch");
    if (record.anchor.turnId !== answerDocument.turnId) return unresolved("turn_mismatch");
    const resolved = globalThis.MicaAnswerDocument?.resolveHighlightAnchor?.(turn, answerDocument, record.anchor);
    return resolved?.status === "resolved" && resolved.range instanceof Range
      ? resolved
      : unresolved(resolved?.reason || "anchor_unresolved", resolved?.candidateCount || 0);
  }

  function withResolution(record, resolution) {
    const sanitized = sanitizeRecords([record])[0];
    if (!sanitized) return null;
    const status = resolution?.status === "resolved" ? "active" : "unresolved";
    const reason = status === "active" ? null : boundedString(resolution?.reason || "anchor_unresolved", 100);
    if (sanitized.status === status && sanitized.unresolvedReason === reason) return sanitized;
    return { ...sanitized, status, unresolvedReason: reason, updatedAt: new Date().toISOString() };
  }

  function withColor(record, color) {
    const sanitized = sanitizeRecords([record])[0];
    if (!sanitized || !COLORS.includes(color)) return null;
    return { ...sanitized, color, updatedAt: new Date().toISOString() };
  }

  function withAnnotation(record, annotation) {
    const sanitized = sanitizeRecords([record])[0];
    if (!sanitized) return null;
    const next = sanitizeAnnotation(annotation);
    if (stableStringify(sanitized.annotation) === stableStringify(next)) return sanitized;
    return { ...sanitized, annotation: next, updatedAt: new Date().toISOString() };
  }

  function sanitizeRecords(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const records = [];
    for (const candidate of value) {
      if (!validRecord(candidate) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      records.push({
        schemaVersion: MODEL_VERSION,
        id: candidate.id,
        color: COLORS.includes(candidate.color) ? candidate.color : COLORS[0],
        anchor: {
          conversationId: candidate.anchor.conversationId,
          turnId: candidate.anchor.turnId,
          documentId: candidate.anchor.documentId,
          sourceVersion: candidate.anchor.sourceVersion,
          blockId: candidate.anchor.blockId,
          textQuote: boundedString(candidate.anchor.textQuote, 4000),
          prefix: boundedString(candidate.anchor.prefix || "", 64),
          suffix: boundedString(candidate.anchor.suffix || "", 64),
          sourceSpan: { start: candidate.anchor.sourceSpan.start, end: candidate.anchor.sourceSpan.end },
          structuralHint: sanitizeStructuralHint(candidate.anchor.structuralHint),
          mathTeX: Array.isArray(candidate.anchor.mathTeX)
            ? candidate.anchor.mathTeX.filter((item) => typeof item === "string").slice(0, 32).map((item) => boundedString(item, 1000))
            : []
        },
        annotation: sanitizeAnnotation(candidate.annotation),
        status: candidate.status === "unresolved" ? "unresolved" : "active",
        unresolvedReason: candidate.status === "unresolved" ? boundedString(candidate.unresolvedReason || "anchor_unresolved", 100) : null,
        createdAt: validTimestamp(candidate.createdAt) || new Date(0).toISOString(),
        updatedAt: validTimestamp(candidate.updatedAt) || validTimestamp(candidate.createdAt) || new Date(0).toISOString()
      });
      if (records.length >= MAX_RECORDS) break;
    }
    return records;
  }

  function exportJson(value) {
    const records = sanitizeRecords(value);
    return `${JSON.stringify({ schemaVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), records }, null, 2)}\n`;
  }

  function importJson(text) {
    const serialized = typeof text === "string" ? text : String(text || "");
    if (serialized.length > MAX_IMPORT_CHARS) return { ok: false, reason: "highlight_import_too_large" };
    try {
      const parsed = JSON.parse(serialized);
      const source = Array.isArray(parsed) ? parsed : parsed?.records;
      if (!Array.isArray(source)) return { ok: false, reason: "highlight_records_missing" };
      if (source.length > MAX_IMPORT_SOURCE_RECORDS) return { ok: false, reason: "highlight_record_count_exceeded" };
      const records = sanitizeRecords(source);
      if (source.length > 0 && records.length === 0) return { ok: false, reason: "highlight_records_invalid" };
      return { ok: true, records, rejectedCount: Math.max(0, source.length - records.length) };
    } catch (_error) {
      return { ok: false, reason: "highlight_records_invalid_json" };
    }
  }

  function mergeRecords(current, incoming) {
    const byId = new Map(sanitizeRecords(current).map((record) => [record.id, record]));
    for (const record of sanitizeRecords(incoming)) byId.set(record.id, record);
    return sanitizeRecords([...byId.values()].slice(-MAX_RECORDS));
  }

  function recordsForScope(value, scope = {}) {
    return sanitizeRecords(value).filter((record) => {
      if (scope.conversationId && record.anchor.conversationId !== scope.conversationId) return false;
      if (scope.turnId && record.anchor.turnId !== scope.turnId) return false;
      return true;
    });
  }

  function validRecord(record) {
    const anchor = record?.anchor;
    return record?.schemaVersion === MODEL_VERSION
      && typeof record.id === "string" && /^highlight-[a-f0-9]{8}$/.test(record.id)
      && validIdentity(anchor?.conversationId, 512)
      && validIdentity(anchor?.turnId, 512)
      && validIdentity(anchor?.documentId, 1024)
      && validIdentity(anchor?.sourceVersion, 256)
      && validIdentity(anchor?.blockId, 512)
      && typeof anchor?.textQuote === "string" && anchor.textQuote.length > 0 && anchor.textQuote.length <= 4000
      && (anchor.prefix === undefined || (typeof anchor.prefix === "string" && anchor.prefix.length <= 64))
      && (anchor.suffix === undefined || (typeof anchor.suffix === "string" && anchor.suffix.length <= 64))
      && Number.isInteger(anchor?.sourceSpan?.start)
      && Number.isInteger(anchor?.sourceSpan?.end)
      && anchor.sourceSpan.start >= 0 && anchor.sourceSpan.end > anchor.sourceSpan.start
      && anchor.sourceSpan.end <= MAX_SOURCE_OFFSET;
  }

  function sanitizeAnnotation(value = {}) {
    const note = typeof value?.note === "string"
      ? value.note.replace(/\r\n?/g, "\n").slice(0, ANNOTATION_LIMITS.noteChars)
      : "";
    const tags = [];
    const seen = new Set();
    for (const candidate of Array.isArray(value?.tags) ? value.tags : []) {
      if (typeof candidate !== "string") continue;
      const tag = candidate.trim().replace(/\s+/g, " ").slice(0, ANNOTATION_LIMITS.tagChars);
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length >= ANNOTATION_LIMITS.tags) break;
    }
    return { note, tags };
  }

  function sanitizeStructuralHint(value) {
    if (!value || typeof value !== "object") return {};
    const output = {};
    for (const key of ["startBlockId", "endBlockId", "startKind", "endKind"]) {
      if (validIdentity(value[key], key.endsWith("Kind") ? 64 : 512)) output[key] = value[key];
    }
    for (const key of ["startOrder", "endOrder"]) {
      if (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 100_000) output[key] = value[key];
    }
    return output;
  }

  function validIdentity(value, max) {
    return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  }

  function unresolved(reason, candidateCount = 0) {
    return { status: "unresolved", reason, candidateCount, range: null };
  }

  function bounded(value, max) {
    return String(value || "").slice(0, max);
  }

  function boundedString(value, max) {
    return typeof value === "string" ? value.slice(0, max) : "";
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  globalThis.MicaHighlightEngine = Object.freeze({
    modelVersion: MODEL_VERSION,
    storeKey: STORE_KEY,
    colors: COLORS,
    maxRecords: MAX_RECORDS,
    maxImportChars: MAX_IMPORT_CHARS,
    maxImportSourceRecords: MAX_IMPORT_SOURCE_RECORDS,
    annotationLimits: ANNOTATION_LIMITS,
    createRecord,
    resolveRecord,
    withResolution,
    withColor,
    withAnnotation,
    sanitizeRecords,
    exportJson,
    importJson,
    mergeRecords,
    recordsForScope
  });
})();
