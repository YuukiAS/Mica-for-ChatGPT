(() => {
  const MODEL_VERSION = 1;
  const COLORS = new Set(["yellow", "mint", "blue", "pink"]);
  const MAX_TEXT_LENGTH = 1_000_000;
  const MATHML_TAGS = new Set([
    "math", "semantics", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace",
    "mfrac", "msqrt", "mroot", "msub", "msup", "msubsup", "munder", "mover",
    "munderover", "mmultiscripts", "mprescripts", "none", "mtable", "mtr", "mlabeledtr",
    "mtd", "menclose", "mfenced", "mstyle", "mpadded", "mphantom"
  ]);
  const MATHML_ATTRIBUTES = new Set([
    "display", "mathvariant", "scriptlevel", "displaystyle", "stretchy", "symmetric",
    "maxsize", "minsize", "largeop", "movablelimits", "accent", "accentunder", "fence",
    "separator", "form", "notation", "rowalign", "columnalign", "rowspacing", "columnspacing",
    "columnspan", "rowspan", "bevelled", "linethickness"
  ]);
  const MAX_MATHML_NODES = 512;
  const MAX_MATHML_DEPTH = 32;
  const MAX_MATHML_TEXT = 4096;

  function buildModel(answerDocument, records = [], options = {}) {
    if (!answerDocument?.durable || answerDocument.generationState !== "SETTLED") return failure("answer_not_settled");
    if (!Array.isArray(answerDocument.orderedBlocks) || answerDocument.orderedBlocks.length === 0) return failure("answer_empty");
    if (answerDocument.orderedBlocks.some((block) => ["opaque_interactive", "unknown_block"].includes(block?.kind))) {
      return failure("unsupported_answer_structure");
    }

    const exportOptions = sanitizeOptions(options);
    const state = { text: "", units: [] };
    const blocks = answerDocument.orderedBlocks.map((block) => serializeBlock(block, state));
    if (state.text.length > MAX_TEXT_LENGTH) return failure("answer_too_large");
    const highlights = resolveHighlights(exportOptions.includeHighlights ? records : [], answerDocument, state.text);
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
        pageSize: exportOptions.pageSize,
        includeHighlights: exportOptions.includeHighlights,
        mathRendering: summarizeMathRendering(state.units),
        mathFallback: "visible-tex-source-when-semantic-mathml-unavailable",
        localOnly: true
      }
    };
  }

  function buildConversationModel(bundle, records = [], options = {}) {
    const checked = globalThis.MicaConversationExport?.validateBundle?.(bundle);
    if (!checked?.ok) return failure(checked?.reason || "conversation_completeness_unproven");
    const exportOptions = sanitizeOptions(options);
    const state = { text: "", blocks: [], highlights: [], unresolved: 0, order: 0 };
    const counts = { user: 0, assistant: 0 };
    for (const entry of checked.bundle.entries) {
      const built = buildModel(entry.document, entry.role === "assistant" ? records : [], exportOptions);
      if (!built.ok) return failure(`conversation_turn_failed:${built.reason}`);
      counts[entry.role] += 1;
      if (state.text) state.text += "\n\n";
      const label = entry.role === "user" ? `User ${counts.user}` : `Assistant ${counts.assistant}`;
      const headingStart = state.text.length;
      state.text += label;
      state.blocks.push({
        blockId: `conversation-role-${entry.order}`,
        kind: "heading",
        order: state.order++,
        level: 2,
        units: [{ text: label, kind: "text", start: headingStart, end: state.text.length, rawTeX: null, href: null }]
      });
      state.text += "\n";
      const offset = state.text.length;
      state.text += built.model.plainText;
      for (const block of built.model.blocks) state.blocks.push(shiftBlock(block, offset, state.order++));
      for (const highlight of built.model.highlights) state.highlights.push({ ...highlight, start: highlight.start + offset, end: highlight.end + offset });
      state.unresolved += built.model.unresolvedHighlightCount;
      if (state.text.length > MAX_TEXT_LENGTH) return failure("conversation_too_large");
    }
    return {
      ok: true,
      model: {
        schemaVersion: MODEL_VERSION,
        title: "ChatGPT conversation",
        documentId: checked.bundle.bundleId,
        conversationId: checked.bundle.conversationId,
        turnId: null,
        sourceVersion: checked.bundle.completionProof.turnSequenceHash,
        createdAt: new Date().toISOString(),
        blocks: state.blocks,
        plainText: state.text,
        highlights: state.highlights,
        unresolvedHighlightCount: state.unresolved,
        pageSize: exportOptions.pageSize,
        includeHighlights: exportOptions.includeHighlights,
        mathRendering: summarizeMathRendering(collectBlockUnits(state.blocks)),
        mathFallback: "visible-tex-source-when-semantic-mathml-unavailable",
        turnCount: checked.bundle.entries.length,
        answerCount: counts.assistant,
        completionProof: { ...checked.bundle.completionProof },
        localOnly: true
      }
    };
  }

  function shiftBlock(block, offset, order) {
    const shifted = { ...block, order };
    if (Array.isArray(block.units)) shifted.units = block.units.map((unit) => shiftUnit(unit, offset));
    if (Array.isArray(block.items)) shifted.items = block.items.map((item) => item.map((unit) => shiftUnit(unit, offset)));
    if (Array.isArray(block.rows)) shifted.rows = block.rows.map((row) => row.map((cell) => cell.map((unit) => shiftUnit(unit, offset))));
    return shifted;
  }

  function sanitizeOptions(options) {
    return {
      pageSize: options?.pageSize === "Letter" ? "Letter" : "A4",
      includeHighlights: options?.includeHighlights !== false
    };
  }

  function shiftUnit(unit, offset) {
    return { ...unit, start: unit.start + offset, end: unit.end + offset };
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
          const inlines = block.cellInlines?.[rowIndex]?.[cellIndex];
          return Array.isArray(inlines) ? serializeInlines(inlines, state) : [appendUnit(state, String(cell || ""), "text")];
        });
      });
      return { ...base, rows };
    }
    if (block.kind === "code") return { ...base, language: block.language || null, units: [appendUnit(state, block.text || "", "code")] };
    if (block.kind === "display_math") {
      const text = visibleMath(block);
      return { ...base, units: [appendUnit(state, text, "display_math", block.rawTeX || null, null, [], block.mathMlTree)] };
    }
    return { ...base, units: [appendUnit(state, block.text || block.label || "", "text")] };
  }

  function serializeInlines(inlines, state) {
    return (inlines || []).map((run) => {
      if (run.kind === "inline_math") return appendUnit(state, visibleMath(run), "inline_math", run.rawTeX || null, null, run.marks, run.mathMlTree);
      if (run.kind === "image") return appendUnit(state, run.alt ? `[Image: ${run.alt}]` : "[Image]", "image", null, null, run.marks);
      const kind = run.kind || "text";
      const href = kind === "link" || kind === "citation" ? safeHref(run.href) : null;
      return appendUnit(state, run.text || run.label || "", kind, null, href, run.marks);
    }).filter((unit) => unit.text.length > 0);
  }

  function visibleMath(value) {
    return String(value?.rawTeX || value?.renderedText || "").trim();
  }

  function appendSeparator(state, text) {
    state.text += text;
  }

  function appendUnit(state, text, kind, rawTeX = null, href = null, marks = [], mathMlTree = null) {
    const value = String(text || "");
    const start = state.text.length;
    state.text += value;
    const unit = { text: value, kind, start, end: state.text.length, rawTeX, href, marks: sanitizeMarks(marks), mathMlTree: sanitizeMathMlTree(mathMlTree) };
    state.units.push(unit);
    return unit;
  }

  function sanitizeMarks(value) {
    const allowed = new Set(["strong", "emphasis", "strikethrough", "code"]);
    return [...new Set(Array.isArray(value) ? value.filter((mark) => allowed.has(mark)) : [])];
  }

  function safeHref(value) {
    const href = String(value || "").trim();
    return /^(https?:|mailto:)/i.test(href) ? href.replace(/[\s<>]/g, "") : null;
  }

  function sanitizeMathMlTree(value) {
    if (!value) return null;
    const budget = { nodes: 0, text: 0, invalid: false };
    const tree = sanitizeMathMlNode(value, 0, budget);
    return !budget.invalid && tree?.tag === "math" ? tree : null;
  }

  function sanitizeMathMlNode(value, depth, budget) {
    if (budget.invalid || depth > MAX_MATHML_DEPTH || !value || typeof value !== "object" || Array.isArray(value)) {
      budget.invalid = true;
      return null;
    }
    if (typeof value.text === "string") {
      const text = value.text.replace(/\s+/g, " ").trim();
      if (!text || Object.keys(value).some((key) => key !== "text")) {
        if (Object.keys(value).some((key) => key !== "text")) budget.invalid = true;
        return null;
      }
      budget.nodes += 1;
      budget.text += text.length;
      if (budget.nodes > MAX_MATHML_NODES || budget.text > MAX_MATHML_TEXT) budget.invalid = true;
      return budget.invalid ? null : { text };
    }
    const tag = String(value.tag || "").toLowerCase();
    if (!MATHML_TAGS.has(tag)) {
      budget.invalid = true;
      return null;
    }
    budget.nodes += 1;
    if (budget.nodes > MAX_MATHML_NODES) {
      budget.invalid = true;
      return null;
    }
    const attributes = {};
    for (const [name, raw] of Object.entries(value.attributes || {})) {
      const attribute = String(name).toLowerCase();
      const text = String(raw);
      if (!MATHML_ATTRIBUTES.has(attribute) || text.length > 128 || /[<>\u0000-\u001f]/.test(text)) {
        budget.invalid = true;
        return null;
      }
      attributes[attribute] = text;
    }
    if (!Array.isArray(value.children)) {
      budget.invalid = true;
      return null;
    }
    const children = [];
    for (const child of value.children) {
      const sanitized = sanitizeMathMlNode(child, depth + 1, budget);
      if (sanitized) children.push(sanitized);
    }
    return budget.invalid ? null : { tag, attributes, children };
  }

  function summarizeMathRendering(units) {
    const mathUnits = units.filter((unit) => ["inline_math", "display_math"].includes(unit.kind));
    const semanticUnitCount = mathUnits.filter((unit) => unit.mathMlTree).length;
    return {
      strategy: "semantic-mathml-with-visible-tex-fallback",
      totalUnitCount: mathUnits.length,
      semanticUnitCount,
      fallbackUnitCount: mathUnits.length - semanticUnitCount
    };
  }

  function collectBlockUnits(blocks) {
    const units = [];
    for (const block of blocks || []) {
      if (Array.isArray(block.units)) units.push(...block.units);
      if (Array.isArray(block.items)) for (const item of block.items) units.push(...item);
      if (Array.isArray(block.rows)) for (const row of block.rows) for (const cell of row) units.push(...cell);
    }
    return units;
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

  globalThis.MicaPdfExport = Object.freeze({ modelVersion: MODEL_VERSION, buildModel, buildConversationModel });
})();
