(() => {
  const MODEL_VERSION = 1;
  const COLORS = new Set(["yellow", "mint", "blue", "pink"]);
  const MAX_TEXT_LENGTH = 1_000_000;

  function buildModel(answerDocument, records = []) {
    if (!answerDocument?.durable || answerDocument.generationState !== "SETTLED") return failure("answer_not_settled");
    if (!Array.isArray(answerDocument.orderedBlocks) || answerDocument.orderedBlocks.length === 0) return failure("answer_empty");
    if (answerDocument.orderedBlocks.some((block) => ["opaque_interactive", "unknown_block"].includes(block?.kind))) {
      return failure("unsupported_answer_structure");
    }

    const state = { text: "", units: [] };
    const blocks = answerDocument.orderedBlocks.map((block) => serializeBlock(block, state));
    if (state.text.length > MAX_TEXT_LENGTH) return failure("answer_too_large");
    const highlights = resolveHighlights(records, answerDocument, state.text);
    return {
      ok: true,
      model: {
        schemaVersion: MODEL_VERSION,
        title: "ChatGPT answer",
        documentId: answerDocument.documentId,
        conversationId: answerDocument.conversationId,
        turnId: answerDocument.turnId,
        sourceVersion: answerDocument.sourceVersion,
        createdAt: new Date().toISOString(),
        blocks,
        plainText: state.text,
        highlights: highlights.resolved,
        unresolvedHighlightCount: highlights.unresolved,
        mathFallback: "visible-tex-source",
        localOnly: true
      }
    };
  }

  function serializeBlock(block, state) {
    if (state.text) appendSeparator(state, "\n");
    const base = { blockId: block.blockId, kind: block.kind, order: block.order };
    if (block.kind === "heading") return { ...base, level: block.level, units: serializeInlines(block.inlines, state) };
    if (block.kind === "paragraph" || block.kind === "quote") return { ...base, units: serializeInlines(block.inlines, state) };
    if (block.kind === "list") {
      const items = block.items.map((item, index) => {
        if (index) appendSeparator(state, "\n");
        return serializeInlines(item.inlines, state);
      });
      return { ...base, ordered: block.ordered, items };
    }
    if (block.kind === "table") {
      const rows = block.rows.map((row, rowIndex) => {
        if (rowIndex) appendSeparator(state, "\n");
        return row.map((cell, cellIndex) => {
          if (cellIndex) appendSeparator(state, "\t");
          return [appendUnit(state, String(cell || ""), "text")];
        });
      });
      return { ...base, rows };
    }
    if (block.kind === "code") return { ...base, language: block.language || null, units: [appendUnit(state, block.text || "", "code")] };
    if (block.kind === "display_math") {
      const text = visibleMath(block);
      return { ...base, units: [appendUnit(state, text, "display_math", block.rawTeX || null)] };
    }
    return { ...base, units: [appendUnit(state, block.text || block.label || "", "text")] };
  }

  function serializeInlines(inlines, state) {
    return (inlines || []).map((run) => {
      if (run.kind === "inline_math") return appendUnit(state, visibleMath(run), "inline_math", run.rawTeX || null);
      if (run.kind === "image") return appendUnit(state, run.alt ? `[Image: ${run.alt}]` : "[Image]", "image");
      return appendUnit(state, run.text || run.label || "", run.kind || "text", null, run.href || null);
    }).filter((unit) => unit.text.length > 0);
  }

  function visibleMath(value) {
    return String(value?.rawTeX || value?.renderedText || "").trim();
  }

  function appendSeparator(state, text) {
    state.text += text;
  }

  function appendUnit(state, text, kind, rawTeX = null, href = null) {
    const value = String(text || "");
    const start = state.text.length;
    state.text += value;
    const unit = { text: value, kind, start, end: state.text.length, rawTeX, href };
    state.units.push(unit);
    return unit;
  }

  function resolveHighlights(records, answerDocument, text) {
    const resolved = [];
    let unresolved = 0;
    for (const record of Array.isArray(records) ? records : []) {
      const anchor = record?.anchor;
      if (!anchor || anchor.conversationId !== answerDocument.conversationId || anchor.turnId !== answerDocument.turnId || anchor.documentId !== answerDocument.documentId) continue;
      const match = resolveAnchor(anchor, answerDocument.sourceVersion, text);
      if (!match) {
        unresolved += 1;
        continue;
      }
      resolved.push({ id: record.id, color: COLORS.has(record.color) ? record.color : "yellow", ...match });
    }
    return { resolved, unresolved };
  }

  function resolveAnchor(anchor, sourceVersion, text) {
    const start = anchor.sourceSpan?.start;
    const end = anchor.sourceSpan?.end;
    if (anchor.sourceVersion === sourceVersion && Number.isInteger(start) && Number.isInteger(end) && text.slice(start, end) === anchor.textQuote) {
      return { start, end };
    }
    const matches = allOccurrences(text, anchor.textQuote).filter((offset) => {
      const after = offset + anchor.textQuote.length;
      return (!anchor.prefix || text.slice(Math.max(0, offset - anchor.prefix.length), offset) === anchor.prefix)
        && (!anchor.suffix || text.slice(after, after + anchor.suffix.length) === anchor.suffix);
    });
    return matches.length === 1 ? { start: matches[0], end: matches[0] + anchor.textQuote.length } : null;
  }

  function allOccurrences(text, quote) {
    const output = [];
    let cursor = 0;
    while (quote && cursor <= text.length - quote.length) {
      const found = text.indexOf(quote, cursor);
      if (found < 0) break;
      output.push(found);
      cursor = found + 1;
    }
    return output;
  }

  function failure(reason) {
    return { ok: false, reason };
  }

  globalThis.MicaPdfExport = Object.freeze({ modelVersion: MODEL_VERSION, buildModel });
})();
