(() => {
  const MODEL_VERSION = 1;
  const STORE_KEY = "micaGeneralWebHighlightsV1";
  const COLORS = Object.freeze(["yellow", "mint", "blue", "pink"]);
  const MAX_RECORDS = 500;
  const MAX_PAGE_TEXT = 1_000_000;
  const MAX_SOURCE_OFFSET = 10_000_000;
  const ANNOTATION_LIMITS = Object.freeze({ noteChars: 2000, tags: 16, tagChars: 64 });
  const ROOT_KEY = /^(?:id:[A-Za-z][\w:.-]{0,127}|role:(?:main|article):\d{1,4}|tag:(?:main|article):\d{1,4}|body)$/;

  function normalizePageKey(value) {
    try {
      const url = new URL(String(value || ""));
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (["chatgpt.com", "chat.openai.com"].includes(url.hostname)) return null;
      return `${url.origin}${url.pathname || "/"}`;
    } catch (_error) {
      return null;
    }
  }

  function createRecord(input = {}) {
    const text = typeof input.text === "string" && input.text.length <= MAX_PAGE_TEXT ? input.text : null;
    const pageKey = normalizePageKey(input.pageKey);
    const rootKey = validRootKey(input.rootKey) ? input.rootKey : null;
    const start = Number(input.start);
    const end = Number(input.end);
    if (!text || !pageKey || !rootKey || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return null;
    const textQuote = text.slice(start, end);
    if (!textQuote.trim() || textQuote.length > 4000) return null;
    const createdAt = validTimestamp(input.createdAt) || new Date().toISOString();
    const anchor = {
      pageKey,
      origin: new URL(pageKey).origin,
      rootKey,
      textQuote,
      prefix: text.slice(Math.max(0, start - 64), start),
      suffix: text.slice(end, Math.min(text.length, end + 64)),
      sourceSpan: { start, end }
    };
    return {
      schemaVersion: MODEL_VERSION,
      id: `web-highlight-${hashText(`${createdAt}:${stableStringify(anchor)}`)}`,
      color: COLORS.includes(input.color) ? input.color : COLORS[0],
      anchor,
      annotation: sanitizeAnnotation(input.annotation),
      status: "active",
      unresolvedReason: null,
      createdAt,
      updatedAt: createdAt
    };
  }

  function resolveRecord(record, input = {}) {
    if (!validRecord(record)) return unresolved("invalid_record");
    const pageKey = normalizePageKey(input.pageKey);
    if (!pageKey || pageKey !== record.anchor.pageKey) return unresolved("page_mismatch");
    if (input.rootKey !== record.anchor.rootKey) return unresolved("root_mismatch");
    const text = typeof input.text === "string" && input.text.length <= MAX_PAGE_TEXT ? input.text : null;
    if (text === null) return unresolved("page_text_unavailable");
    const occurrences = findOccurrences(text, record.anchor.textQuote, 64);
    if (occurrences.length === 0) return unresolved("quote_missing");
    const contextual = occurrences.filter((start) => contextMatches(text, record.anchor, start));
    if (contextual.length === 1) return resolved(contextual[0], record.anchor.textQuote.length, "quote_context");
    if (occurrences.length === 1) return resolved(occurrences[0], record.anchor.textQuote.length, "unique_quote");
    return unresolved("quote_ambiguous", occurrences.length);
  }

  function withColor(record, color) {
    const sanitized = sanitizeRecords([record])[0];
    if (!sanitized || !COLORS.includes(color)) return null;
    return { ...sanitized, color, updatedAt: new Date().toISOString() };
  }

  function withResolution(record, resolution) {
    const sanitized = sanitizeRecords([record])[0];
    if (!sanitized) return null;
    const status = resolution?.status === "resolved" ? "active" : "unresolved";
    const unresolvedReason = status === "active" ? null : String(resolution?.reason || "anchor_unresolved").slice(0, 100);
    if (sanitized.status === status && sanitized.unresolvedReason === unresolvedReason) return sanitized;
    return { ...sanitized, status, unresolvedReason, updatedAt: new Date().toISOString() };
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
    const output = [];
    const seen = new Set();
    for (const candidate of value) {
      if (!validRecord(candidate) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      output.push({
        schemaVersion: MODEL_VERSION,
        id: candidate.id,
        color: COLORS.includes(candidate.color) ? candidate.color : COLORS[0],
        anchor: {
          pageKey: normalizePageKey(candidate.anchor.pageKey),
          origin: new URL(candidate.anchor.pageKey).origin,
          rootKey: candidate.anchor.rootKey,
          textQuote: candidate.anchor.textQuote.slice(0, 4000),
          prefix: String(candidate.anchor.prefix || "").slice(-64),
          suffix: String(candidate.anchor.suffix || "").slice(0, 64),
          sourceSpan: { start: candidate.anchor.sourceSpan.start, end: candidate.anchor.sourceSpan.end }
        },
        annotation: sanitizeAnnotation(candidate.annotation),
        status: candidate.status === "unresolved" ? "unresolved" : "active",
        unresolvedReason: candidate.status === "unresolved" ? String(candidate.unresolvedReason || "anchor_unresolved").slice(0, 100) : null,
        createdAt: validTimestamp(candidate.createdAt) || new Date(0).toISOString(),
        updatedAt: validTimestamp(candidate.updatedAt) || validTimestamp(candidate.createdAt) || new Date(0).toISOString()
      });
      if (output.length >= MAX_RECORDS) break;
    }
    return output;
  }

  function recordsForPage(value, pageKey) {
    const normalized = normalizePageKey(pageKey);
    return normalized ? sanitizeRecords(value).filter((record) => record.anchor.pageKey === normalized) : [];
  }

  function mergeRecords(current, incoming) {
    const byId = new Map(sanitizeRecords(current).map((record) => [record.id, record]));
    for (const record of sanitizeRecords(incoming)) byId.set(record.id, record);
    return sanitizeRecords([...byId.values()].slice(-MAX_RECORDS));
  }

  function exportJson(value) {
    return `${JSON.stringify({ schemaVersion: MODEL_VERSION, exportedAt: new Date().toISOString(), records: sanitizeRecords(value) }, null, 2)}\n`;
  }

  function importJson(text) {
    try {
      const parsed = JSON.parse(String(text || ""));
      const source = Array.isArray(parsed) ? parsed : (parsed?.generalWebRecords || parsed?.records);
      if (!Array.isArray(source)) return { ok: false, reason: "general_web_highlight_records_missing" };
      const records = sanitizeRecords(source);
      if (source.length > 0 && records.length === 0) return { ok: false, reason: "general_web_highlight_records_invalid" };
      return { ok: true, records, rejectedCount: Math.max(0, source.length - records.length) };
    } catch (_error) {
      return { ok: false, reason: "general_web_highlight_records_invalid_json" };
    }
  }

  function validRecord(record) {
    const anchor = record?.anchor;
    const normalized = normalizePageKey(anchor?.pageKey);
    return record?.schemaVersion === MODEL_VERSION
      && typeof record.id === "string" && /^web-highlight-[a-f0-9]{8}$/.test(record.id)
      && !!normalized
      && normalized === anchor?.pageKey
      && anchor?.origin === new URL(normalized).origin
      && validRootKey(anchor?.rootKey)
      && typeof anchor?.textQuote === "string" && anchor.textQuote.length > 0 && anchor.textQuote.length <= 4000
      && typeof anchor?.prefix === "string" && anchor.prefix.length <= 64
      && typeof anchor?.suffix === "string" && anchor.suffix.length <= 64
      && Number.isInteger(anchor?.sourceSpan?.start) && Number.isInteger(anchor?.sourceSpan?.end)
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

  function validRootKey(value) {
    return typeof value === "string" && ROOT_KEY.test(value);
  }

  function findOccurrences(text, quote, limit) {
    const output = [];
    let cursor = 0;
    while (output.length < limit) {
      const index = text.indexOf(quote, cursor);
      if (index < 0) break;
      output.push(index);
      cursor = index + Math.max(1, quote.length);
    }
    return output;
  }

  function contextMatches(text, anchor, start) {
    const before = text.slice(Math.max(0, start - anchor.prefix.length), start);
    const after = text.slice(start + anchor.textQuote.length, start + anchor.textQuote.length + anchor.suffix.length);
    return before === anchor.prefix && after === anchor.suffix;
  }

  function resolved(start, length, method) {
    return { status: "resolved", start, end: start + length, method, candidateCount: 1 };
  }

  function unresolved(reason, candidateCount = 0) {
    return { status: "unresolved", reason, candidateCount, start: null, end: null };
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
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

  globalThis.MicaGeneralWebHighlightModel = Object.freeze({
    modelVersion: MODEL_VERSION,
    storeKey: STORE_KEY,
    colors: COLORS,
    maxRecords: MAX_RECORDS,
    maxPageText: MAX_PAGE_TEXT,
    annotationLimits: ANNOTATION_LIMITS,
    normalizePageKey,
    createRecord,
    resolveRecord,
    withColor,
    withResolution,
    withAnnotation,
    sanitizeRecords,
    recordsForPage,
    mergeRecords,
    exportJson,
    importJson
  });
})();
