(() => {
  const MODEL_VERSION = 1;
  const STORE_KEY = "micaHighlightsV1";
  const COLORS = Object.freeze(["yellow", "mint", "blue", "pink"]);
  const MAX_RECORDS = 500;

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
    if (!validRecord(record)) return null;
    const status = resolution?.status === "resolved" ? "active" : "unresolved";
    const reason = status === "active" ? null : String(resolution?.reason || "anchor_unresolved");
    if (record.status === status && record.unresolvedReason === reason) return record;
    return { ...record, status, unresolvedReason: reason, updatedAt: new Date().toISOString() };
  }

  function withColor(record, color) {
    if (!validRecord(record) || !COLORS.includes(color)) return null;
    return { ...record, color, updatedAt: new Date().toISOString() };
  }

  function sanitizeRecords(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const records = [];
    for (const candidate of value) {
      if (!validRecord(candidate) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      records.push({
        ...candidate,
        color: COLORS.includes(candidate.color) ? candidate.color : COLORS[0],
        anchor: {
          ...candidate.anchor,
          textQuote: bounded(candidate.anchor.textQuote, 4000),
          prefix: bounded(candidate.anchor.prefix || "", 64),
          suffix: bounded(candidate.anchor.suffix || "", 64),
          mathTeX: Array.isArray(candidate.anchor.mathTeX) ? candidate.anchor.mathTeX.slice(0, 32).map((item) => bounded(item, 1000)) : []
        }
      });
      if (records.length >= MAX_RECORDS) break;
    }
    return records;
  }

  function validRecord(record) {
    const anchor = record?.anchor;
    return record?.schemaVersion === MODEL_VERSION
      && typeof record.id === "string" && record.id.startsWith("highlight-")
      && typeof anchor?.conversationId === "string"
      && typeof anchor?.turnId === "string"
      && typeof anchor?.documentId === "string"
      && typeof anchor?.sourceVersion === "string"
      && typeof anchor?.blockId === "string"
      && typeof anchor?.textQuote === "string" && anchor.textQuote.length > 0
      && Number.isInteger(anchor?.sourceSpan?.start)
      && Number.isInteger(anchor?.sourceSpan?.end)
      && anchor.sourceSpan.start >= 0 && anchor.sourceSpan.end > anchor.sourceSpan.start;
  }

  function unresolved(reason, candidateCount = 0) {
    return { status: "unresolved", reason, candidateCount, range: null };
  }

  function bounded(value, max) {
    return String(value || "").slice(0, max);
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
    createRecord,
    resolveRecord,
    withResolution,
    withColor,
    sanitizeRecords
  });
})();
