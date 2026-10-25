(() => {
  const MODEL_VERSION = 1;
  const BLOCK_KINDS = Object.freeze([
    "heading",
    "paragraph",
    "list",
    "quote",
    "table",
    "code",
    "inline_math",
    "display_math",
    "link",
    "image",
    "citation",
    "opaque_interactive",
    "unknown_block"
  ]);
  const KNOWN_BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,table,pre,.katex-display,mjx-container[display='true'],math[display='block'],[data-math-display='true']";
  const INTERACTIVE_SELECTOR = "button,input,select,textarea,iframe,form,[contenteditable='true'],[role='button'],[role='dialog'],[role='menu'],[data-testid*='tool'],[data-testid*='file'],[data-testid*='attachment'],[data-testid*='connector'],[data-testid*='auth']";
  const MATHML_TAGS = new Set([
    "math", "semantics", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace",
    "mfrac", "msqrt", "mroot", "msub", "msup", "msubsup", "munder", "mover",
    "munderover", "mmultiscripts", "mprescripts", "none", "mtable", "mtr", "mlabeledtr",
    "mtd", "menclose", "mfenced", "mstyle", "mpadded", "mphantom"
  ]);
  const MATHML_ATTRIBUTES = [
    "display", "mathvariant", "scriptlevel", "displaystyle", "stretchy", "symmetric",
    "maxsize", "minsize", "largeop", "movablelimits", "accent", "accentunder", "fence",
    "separator", "form", "notation", "rowalign", "columnalign", "rowspacing", "columnspacing",
    "columnspan", "rowspan", "bevelled", "linethickness"
  ];
  const MAX_MATHML_NODES = 512;
  const MAX_MATHML_DEPTH = 32;
  const MAX_MATHML_TEXT = 4096;

  function fromAssistantTurn(turn, options = {}) {
    if (!turn || turn.role !== "assistant" || !(turn.answerRoot instanceof HTMLElement)) return null;
    const generationState = options.generationState;
    if (generationState !== "STREAMING" && generationState !== "SETTLED") return null;
    const conversationId = options.conversationId || conversationIdentity(turn.answerRoot.ownerDocument);
    const documentId = `answer-${hashText(`${conversationId}:${turn.turnId}`)}`;
    const state = { cursor: 0, documentId };
    const orderedBlocks = parseBlocks(turn.answerRoot, state);
    const sourceVersion = `${generationState.toLowerCase()}-${hashText(stableStringify(orderedBlocks.map(blockIdentity)))}`;
    return {
      modelVersion: MODEL_VERSION,
      role: "assistant",
      documentId,
      conversationId,
      turnId: turn.turnId,
      sourceVersion,
      generationState,
      orderedBlocks,
      durable: generationState === "SETTLED",
      producedBy: "MicaChatGPTAdapter",
      contractHash: globalThis.MicaChatGPTAdapter?.contractHash || null
    };
  }

  function fromUserTurn(turn, options = {}) {
    const root = turn?.contentRoot || turn?.roleElement;
    if (!turn || turn.role !== "user" || !(root instanceof HTMLElement)) return null;
    const conversationId = options.conversationId || conversationIdentity(root.ownerDocument);
    const documentId = `user-${hashText(`${conversationId}:${turn.turnId}`)}`;
    const state = { cursor: 0, documentId };
    const orderedBlocks = parseBlocks(root, state);
    const sourceVersion = `settled-${hashText(stableStringify(orderedBlocks.map(blockIdentity)))}`;
    return {
      modelVersion: MODEL_VERSION,
      role: "user",
      documentId,
      conversationId,
      turnId: turn.turnId,
      sourceVersion,
      generationState: "SETTLED",
      orderedBlocks,
      durable: true,
      producedBy: "MicaChatGPTAdapter",
      contractHash: globalThis.MicaChatGPTAdapter?.contractHash || null
    };
  }

  function parseBlocks(root, state) {
    if (root.matches(KNOWN_BLOCK_SELECTOR)) return [parseBlock(root, state)].filter(Boolean);
    const candidates = Array.from(root.childNodes).filter((node) => isElementNode(node) || (node.nodeType === Node.TEXT_NODE && normalizeText(node.nodeValue || "")));
    if (candidates.length === 0) {
      const text = normalizeText(root.textContent || "");
      return text ? [finalizeBlock(state, "paragraph", { text, inlines: textInline(text, state.cursor) })] : [];
    }
    return candidates.map((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = normalizeText(node.nodeValue || "");
        return text ? finalizeBlock(state, "paragraph", { text, inlines: textInline(text, state.cursor) }) : null;
      }
      return parseBlock(node, state);
    }).filter(Boolean);
  }

  function parseBlock(node, state) {
    if (!isElementNode(node)) return null;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = normalizeText(node.textContent || "");
      return finalizeBlock(state, "heading", { level: Number(tag.slice(1)), text, inlines: parseInlineRuns(node) });
    }
    if (tag === "p") {
      const inlines = parseInlineRuns(node);
      return finalizeBlock(state, "paragraph", { text: inlineText(inlines), inlines });
    }
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(node.children).filter((child) => child.tagName === "LI").map((item) => ({
        text: normalizeText(item.textContent || ""),
        inlines: parseInlineRuns(item)
      }));
      return finalizeBlock(state, "list", { ordered: tag === "ol", items });
    }
    if (tag === "blockquote") {
      const inlines = parseInlineRuns(node);
      return finalizeBlock(state, "quote", { text: inlineText(inlines), inlines });
    }
    if (tag === "table") {
      const cells = Array.from(node.querySelectorAll("tr")).map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => {
        const inlines = parseInlineRuns(cell);
        return { text: inlineText(inlines), inlines };
      }));
      return finalizeBlock(state, "table", {
        rows: cells.map((row) => row.map((cell) => cell.text)),
        cellInlines: cells.map((row) => row.map((cell) => cell.inlines))
      });
    }
    if (tag === "pre") {
      const code = node.querySelector("code")?.textContent ?? node.textContent ?? "";
      return finalizeBlock(state, "code", { language: codeLanguage(node), text: code.replace(/\r\n/g, "\n") });
    }
    if (node.matches(".katex-display,mjx-container[display='true'],math[display='block'],[data-math-display='true']")) {
      return finalizeBlock(state, "display_math", { ...mathPayload(node), displayMode: true });
    }
    if (node.matches("[data-mica-opaque-interactive]") || node.matches(INTERACTIVE_SELECTOR) || node.querySelector(INTERACTIVE_SELECTOR)) {
      return finalizeBlock(state, "opaque_interactive", { label: accessibleLabel(node), interactive: true });
    }
    return finalizeBlock(state, "unknown_block", { tagName: tag, text: normalizeText(node.textContent || "") });
  }

  function parseInlineRuns(root) {
    const runs = [];
    walkInline(root, runs, []);
    return mergeTextRuns(runs);
  }

  function walkInline(node, runs, marks) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = normalizeInlineText(child.nodeValue || "");
        if (text) runs.push(...rawMathRuns(text, marks));
        continue;
      }
      if (!isElementNode(child)) continue;
      if (child.matches(".katex-display")) continue;
      const childMarks = marksForElement(child, marks);
      if (child.matches(".katex,mjx-container,math,[data-tex],[data-math-source]")
        && !child.closest(".katex-display,mjx-container[display='true'],math[display='block'],[data-math-display='true']")) {
        runs.push(withMarks({ kind: "inline_math", ...mathPayload(child), displayMode: false }, childMarks));
        continue;
      }
      if (child.tagName === "CODE") {
        runs.push(withMarks({ kind: "inline_code", text: child.textContent || "" }, childMarks.filter(mark => mark !== "code")));
        continue;
      }
      if (child.tagName === "A") {
        const kind = child.matches("[data-testid*='citation'],[data-citation]") ? "citation" : "link";
        runs.push(withMarks({ kind, text: normalizeText(child.textContent || ""), href: child.getAttribute("href") || null }, childMarks));
        continue;
      }
      if (child.tagName === "IMG") {
        runs.push(withMarks({ kind: "image", alt: child.getAttribute("alt") || "", src: child.getAttribute("src") || null }, childMarks));
        continue;
      }
      if (child.matches("button,input,select,textarea,[contenteditable='true'],[role='button']")) {
        runs.push({ kind: "opaque_interactive", label: accessibleLabel(child), interactive: true });
        continue;
      }
      walkInline(child, runs, childMarks);
    }
  }

  function marksForElement(element, inherited) {
    const marks = new Set(inherited || []);
    const tag = element.tagName;
    if (tag === "STRONG" || tag === "B") marks.add("strong");
    if (tag === "EM" || tag === "I") marks.add("emphasis");
    if (tag === "S" || tag === "DEL") marks.add("strikethrough");
    if (tag === "CODE") marks.add("code");
    return [...marks];
  }

  function withMarks(run, marks) {
    return marks?.length ? { ...run, marks: [...marks] } : run;
  }

  function finalizeBlock(state, kind, payload) {
    const serialized = stableStringify(payload);
    const visibleLength = blockVisibleText(kind, payload).length;
    const start = state.cursor;
    const end = start + visibleLength;
    state.cursor = end + 1;
    const contentIdentity = hashText(`${kind}:${serialized}`);
    const order = Number.isInteger(state.order) ? state.order : 0;
    state.order = order + 1;
    return {
      blockId: `block-${hashText(`${state.documentId}:${order}:${contentIdentity}`)}`,
      order,
      kind,
      sourceSpan: { start, end },
      contentIdentity,
      ...payload
    };
  }

  function mathPayload(node) {
    const rawTeX = node.querySelector("annotation[encoding='application/x-tex']")?.textContent
      || node.getAttribute("data-tex")
      || node.getAttribute("data-math-source")
      || node.getAttribute("alttext")
      || node.getAttribute("aria-label")
      || null;
    const renderedText = normalizeText(node.querySelector(".katex-html")?.textContent || node.textContent || "");
    return { rawTeX, renderedText, mathMlTree: extractMathMlTree(node) };
  }

  function extractMathMlTree(node) {
    const root = node.matches?.("math")
      ? node
      : node.querySelector?.(".katex-mathml math")
        || node.querySelector?.("mjx-assistive-mml math")
        || node.querySelector?.("math");
    if (!root) return null;
    const budget = { nodes: 0, text: 0, invalid: false };
    const tree = sanitizeMathMlDomNode(root, 0, budget);
    return !budget.invalid && tree?.tag === "math" ? tree : null;
  }

  function sanitizeMathMlDomNode(node, depth, budget) {
    if (budget.invalid || depth > MAX_MATHML_DEPTH) {
      budget.invalid = true;
      return null;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      budget.nodes += 1;
      budget.text += text.length;
      if (budget.nodes > MAX_MATHML_NODES || budget.text > MAX_MATHML_TEXT) {
        budget.invalid = true;
        return null;
      }
      return { text };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = String(node.localName || node.tagName || "").toLowerCase();
    if (tag === "annotation" || tag === "annotation-xml") return null;
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
    for (const name of MATHML_ATTRIBUTES) {
      const value = node.getAttribute?.(name);
      if (value !== null && value.length <= 128 && !/[<>\u0000-\u001f]/.test(value)) attributes[name] = value;
    }
    const children = [];
    for (const child of node.childNodes || []) {
      const sanitized = sanitizeMathMlDomNode(child, depth + 1, budget);
      if (sanitized) children.push(sanitized);
    }
    return { tag, attributes, children };
  }

  function rawMathRuns(text, marks = []) {
    const runs = [];
    const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(^|[^$])\$([^\n$]+?)\$/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const leading = match[4] || "";
      const formulaStart = match.index + leading.length;
      const rawTeX = (match[1] || match[2] || match[3] || match[5] || "").trim();
      const inlineDollar = !!match[5];
      if ((inlineDollar && (text[formulaStart - 1] === "\\" || !plausibleInlineMath(rawTeX))) || !rawTeX) continue;
      if (formulaStart > cursor) runs.push(withMarks({ kind: "text", text: text.slice(cursor, formulaStart) }, marks));
      runs.push(withMarks({ kind: "inline_math", rawTeX, renderedText: rawTeX, displayMode: !!(match[1] || match[2]) }, marks));
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) runs.push(withMarks({ kind: "text", text: text.slice(cursor) }, marks));
    return runs.length ? runs : [withMarks({ kind: "text", text }, marks)];
  }

  function plausibleInlineMath(source) {
    const value = String(source || "").trim();
    if (!value || /^\d+(?:[.,]\d+)?(?:\s*(?:USD|HKD|CNY|dollars?))?$/i.test(value)) return false;
    if (/^[\p{L}\p{N}]+(?:\s+[\p{L}\p{N}]+){1,}$/u.test(value)) return false;
    return /[\\_^{}=+\-*/<>]|^[\p{L}]$/u.test(value);
  }

  function codeLanguage(node) {
    const className = `${node.className || ""} ${node.querySelector("code")?.className || ""}`;
    return className.match(/(?:language-|lang-)([a-z0-9_+-]+)/i)?.[1] || null;
  }

  function accessibleLabel(node) {
    return node.getAttribute("aria-label") || node.getAttribute("title") || normalizeText(node.textContent || "") || node.tagName.toLowerCase();
  }

  function blockVisibleText(kind, payload) {
    if (typeof payload.text === "string") return payload.text;
    if (kind === "list") return payload.items.map((item) => item.text).join("\n");
    if (kind === "table") return payload.rows.map((row) => row.join("\t")).join("\n");
    if (kind === "display_math") return payload.renderedText || payload.rawTeX || "";
    return payload.label || "";
  }

  function inlineText(runs) {
    return normalizeText(runs.map((run) => run.text || run.renderedText || run.alt || run.label || "").join(""));
  }

  function textInline(text, start) {
    return [{ kind: "text", text, sourceSpan: { start, end: start + text.length } }];
  }

  function mergeTextRuns(runs) {
    const merged = [];
    for (const run of runs) {
      const previous = merged.at(-1);
      if (run.kind === "text" && previous?.kind === "text" && stableStringify(run.marks || []) === stableStringify(previous.marks || [])) previous.text += run.text;
      else merged.push(run);
    }
    return merged;
  }

  function captureHighlightSelection(turn, answerDoc, range) {
    if (!turn || !answerDoc?.durable || !(range instanceof Range) || range.collapsed) return null;
    if (!(turn.answerRoot instanceof HTMLElement) || !turn.answerRoot.contains(range.startContainer) || !turn.answerRoot.contains(range.endContainer)) return null;
    const projection = buildHighlightProjection(turn, answerDoc);
    if (!projection || projection.segments.length === 0) return null;
    const selected = projection.segments.filter((segment) => segment.kind !== "separator" && rangeIntersectsNode(range, segment.node));
    if (selected.length === 0) return null;
    let start = projection.text.length;
    let end = 0;
    for (const segment of selected) {
      let localStart = 0;
      let localEnd = segment.text.length;
      if (segment.kind === "text" && range.startContainer === segment.node) localStart = clampOffset(range.startOffset, segment.text.length);
      if (segment.kind === "text" && range.endContainer === segment.node) localEnd = clampOffset(range.endOffset, segment.text.length);
      if (localEnd <= localStart) continue;
      start = Math.min(start, segment.start + localStart);
      end = Math.max(end, segment.start + localEnd);
    }
    if (!(end > start)) return null;
    const textQuote = projection.text.slice(start, end);
    if (!textQuote.trim() || textQuote.length > 4000) return null;
    const selectedSegments = projection.segments.filter((segment) => segment.end > start && segment.start < end);
    const first = selectedSegments[0];
    const last = selectedSegments.at(-1);
    const mathTeX = [...new Set([
      ...selectedSegments.filter((segment) => segment.kind === "math" && segment.rawTeX).map((segment) => segment.rawTeX),
      ...extractRawMathSources(textQuote)
    ])];
    return {
      textQuote,
      prefix: projection.text.slice(Math.max(0, start - 48), start),
      suffix: projection.text.slice(end, Math.min(projection.text.length, end + 48)),
      sourceSpan: { start, end },
      structuralHint: {
        startBlockId: first.blockId,
        endBlockId: last.blockId,
        startKind: first.blockKind,
        endKind: last.blockKind,
        startOrder: first.blockOrder,
        endOrder: last.blockOrder
      },
      mathTeX,
      range: rangeFromProjection(projection, start, end)
    };
  }

  function resolveHighlightAnchor(turn, answerDoc, anchor) {
    if (!turn || !answerDoc?.durable || !anchor || !(turn.answerRoot instanceof HTMLElement)) return unresolvedHighlight("invalid_context");
    const projection = buildHighlightProjection(turn, answerDoc);
    if (!projection || !anchor.textQuote) return unresolvedHighlight("projection_unavailable");
    const exactVersion = anchor.sourceVersion === answerDoc.sourceVersion;
    const directStart = anchor.sourceSpan?.start;
    const directEnd = anchor.sourceSpan?.end;
    if (exactVersion && Number.isInteger(directStart) && Number.isInteger(directEnd)
      && projection.text.slice(directStart, directEnd) === anchor.textQuote) {
      const range = rangeFromProjection(projection, directStart, directEnd);
      return range ? { status: "resolved", reason: "exact_version_span", candidateCount: 1, range } : unresolvedHighlight("range_unavailable");
    }
    const matches = allOccurrences(projection.text, anchor.textQuote).filter((start) => {
      const end = start + anchor.textQuote.length;
      if (anchor.prefix && projection.text.slice(Math.max(0, start - anchor.prefix.length), start) !== anchor.prefix) return false;
      if (anchor.suffix && projection.text.slice(end, end + anchor.suffix.length) !== anchor.suffix) return false;
      const segments = projection.segments.filter((segment) => segment.end > start && segment.start < end);
      const first = segments[0];
      const last = segments.at(-1);
      if (!first || !last) return false;
      const hint = anchor.structuralHint || {};
      if (hint.startKind && first.blockKind !== hint.startKind) return false;
      if (hint.endKind && last.blockKind !== hint.endKind) return false;
      if (anchor.mathTeX?.length) {
        const candidateMath = [...new Set([
          ...segments.filter((segment) => segment.kind === "math" && segment.rawTeX).map((segment) => segment.rawTeX),
          ...extractRawMathSources(anchor.textQuote)
        ])];
        if (stableStringify(candidateMath) !== stableStringify(anchor.mathTeX)) return false;
      }
      return true;
    });
    if (matches.length !== 1) return unresolvedHighlight(matches.length > 1 ? "ambiguous_anchor" : "source_missing", matches.length);
    const start = matches[0];
    const range = rangeFromProjection(projection, start, start + anchor.textQuote.length);
    return range ? { status: "resolved", reason: "unique_quote_context", candidateCount: 1, range } : unresolvedHighlight("range_unavailable");
  }

  function buildHighlightProjection(turn, answerDoc) {
    if (!(turn?.answerRoot instanceof HTMLElement) || !Array.isArray(answerDoc?.orderedBlocks)) return null;
    const root = turn.answerRoot;
    const nodes = root.matches(KNOWN_BLOCK_SELECTOR)
      ? [root]
      : Array.from(root.childNodes).filter((node) => isElementNode(node) || (node.nodeType === Node.TEXT_NODE && normalizeText(node.nodeValue || "")));
    if (nodes.length !== answerDoc.orderedBlocks.length) return null;
    const projection = { text: "", segments: [] };
    nodes.forEach((node, index) => {
      const block = answerDoc.orderedBlocks[index];
      if (!block || block.kind === "opaque_interactive" || block.kind === "unknown_block") return;
      if (projection.text && !projection.text.endsWith("\n")) projection.text += "\n";
      collectProjectionSegments(node, block, projection);
    });
    return projection;
  }

  function collectProjectionSegments(node, block, projection) {
    if (node.nodeType === Node.TEXT_NODE) {
      appendProjectionSegment(projection, node.nodeValue || "", node, "text", block, null);
      return;
    }
    if (!isElementNode(node)) return;
    if (node.matches("[data-mica-ui],script,style,noscript,template") || node.matches(INTERACTIVE_SELECTOR)) return;
    if (block.kind === "table" && node.tagName === "TABLE") {
      collectTableProjectionSegments(node, block, projection);
      return;
    }
    if (block.kind === "list" && (node.tagName === "UL" || node.tagName === "OL")) {
      collectListProjectionSegments(node, block, projection);
      return;
    }
    if (isMathRoot(node)) {
      const math = mathPayload(node);
      const text = math.rawTeX || math.renderedText;
      if (text) appendProjectionSegment(projection, text, node, "math", block, math.rawTeX);
      return;
    }
    for (const child of node.childNodes) collectProjectionSegments(child, block, projection);
  }

  function collectListProjectionSegments(list, block, projection) {
    Array.from(list.children).filter((item) => item.tagName === "LI").forEach((item, itemIndex) => {
      if (itemIndex) appendProjectionSegment(projection, "\n", item, "separator", block, null);
      for (const child of item.childNodes) collectProjectionSegments(child, block, projection);
    });
  }

  function collectTableProjectionSegments(table, block, projection) {
    Array.from(table.querySelectorAll("tr")).forEach((row, rowIndex) => {
      if (rowIndex) appendProjectionSegment(projection, "\n", row, "separator", block, null);
      Array.from(row.querySelectorAll("th,td")).forEach((cell, cellIndex) => {
        if (cellIndex) appendProjectionSegment(projection, "\t", cell, "separator", block, null);
        for (const child of cell.childNodes) collectProjectionSegments(child, block, projection);
      });
    });
  }

  function appendProjectionSegment(projection, text, node, kind, block, rawTeX) {
    if (!text) return;
    const start = projection.text.length;
    projection.text += text;
    projection.segments.push({
      start,
      end: projection.text.length,
      text,
      node,
      kind,
      rawTeX,
      blockId: block.blockId,
      blockKind: block.kind,
      blockOrder: block.order
    });
  }

  function rangeFromProjection(projection, start, end) {
    const first = projection.segments.find((segment) => segment.end > start);
    const last = [...projection.segments].reverse().find((segment) => segment.start < end);
    if (!first || !last) return null;
    const range = first.node.ownerDocument.createRange();
    if (first.kind === "text") range.setStart(first.node, clampOffset(start - first.start, first.text.length));
    else range.setStartBefore(first.node);
    if (last.kind === "text") range.setEnd(last.node, clampOffset(end - last.start, last.text.length));
    else range.setEndAfter(last.node);
    return range.collapsed ? null : range;
  }

  function isMathRoot(node) {
    return node.matches(".katex,.katex-display,mjx-container,math,[data-tex],[data-math-source]")
      && !node.parentElement?.closest(".katex,.katex-display,mjx-container,math,[data-tex],[data-math-source]");
  }

  function rangeIntersectsNode(range, node) {
    try { return range.intersectsNode(node); }
    catch (_error) { return false; }
  }

  function isElementNode(node) {
    return node?.nodeType === Node.ELEMENT_NODE
      && typeof node.matches === "function"
      && typeof node.querySelector === "function";
  }

  function extractRawMathSources(text) {
    const sources = [];
    const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(^|[^$])\$([^\n$]+?)\$/g;
    let match;
    while ((match = pattern.exec(String(text || ""))) && sources.length < 32) {
      const source = match[1] || match[2] || match[3] || match[5];
      if (source?.trim()) sources.push(source.trim());
    }
    return sources;
  }

  function allOccurrences(text, quote) {
    const matches = [];
    let cursor = 0;
    while (quote && cursor <= text.length - quote.length) {
      const found = text.indexOf(quote, cursor);
      if (found < 0) break;
      matches.push(found);
      cursor = found + 1;
    }
    return matches;
  }

  function unresolvedHighlight(reason, candidateCount = 0) {
    return { status: "unresolved", reason, candidateCount, range: null };
  }

  function clampOffset(value, length) {
    return Math.max(0, Math.min(length, Number(value) || 0));
  }

  function blockIdentity(block) {
    return { kind: block.kind, contentIdentity: block.contentIdentity, order: block.order };
  }

  function conversationIdentity(doc) {
    const pathname = doc?.location?.pathname || "/unknown";
    return `conversation-${hashText(pathname)}`;
  }

  function normalizeText(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function normalizeInlineText(value) {
    return String(value).replace(/\s+/g, " ");
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

  globalThis.MicaAnswerDocument = Object.freeze({
    modelVersion: MODEL_VERSION,
    blockKinds: BLOCK_KINDS,
    fromAssistantTurn,
    fromUserTurn,
    captureHighlightSelection,
    resolveHighlightAnchor,
    extractRawMathSources
  });
})();
