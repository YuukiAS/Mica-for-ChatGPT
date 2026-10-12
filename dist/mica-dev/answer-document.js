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

  function parseBlocks(root, state) {
    if (root.matches(KNOWN_BLOCK_SELECTOR)) return [parseBlock(root, state)].filter(Boolean);
    const candidates = Array.from(root.childNodes).filter((node) => node instanceof HTMLElement || (node.nodeType === Node.TEXT_NODE && normalizeText(node.nodeValue || "")));
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
    if (!(node instanceof HTMLElement)) return null;
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
      const rows = Array.from(node.querySelectorAll("tr")).map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => normalizeText(cell.textContent || "")));
      return finalizeBlock(state, "table", { rows });
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
    walkInline(root, runs);
    return mergeTextRuns(runs);
  }

  function walkInline(node, runs) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = normalizeInlineText(child.nodeValue || "");
        if (text) runs.push(...rawMathRuns(text));
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      if (child.matches(".katex-display")) continue;
      if (child.matches(".katex,mjx-container,math[alttext],[data-tex],[data-math-source]")
        && !child.closest(".katex-display,mjx-container[display='true'],math[display='block'],[data-math-display='true']")) {
        runs.push({ kind: "inline_math", ...mathPayload(child), displayMode: false });
        continue;
      }
      if (child.tagName === "A") {
        const kind = child.matches("[data-testid*='citation'],[data-citation]") ? "citation" : "link";
        runs.push({ kind, text: normalizeText(child.textContent || ""), href: child.getAttribute("href") || null });
        continue;
      }
      if (child.tagName === "IMG") {
        runs.push({ kind: "image", alt: child.getAttribute("alt") || "", src: child.getAttribute("src") || null });
        continue;
      }
      if (child.matches("button,input,select,textarea,[contenteditable='true'],[role='button']")) {
        runs.push({ kind: "opaque_interactive", label: accessibleLabel(child), interactive: true });
        continue;
      }
      walkInline(child, runs);
    }
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
    return { rawTeX, renderedText };
  }

  function rawMathRuns(text) {
    const runs = [];
    const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(^|[^$])\$([^\n$]+?)\$/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const leading = match[4] || "";
      const formulaStart = match.index + leading.length;
      if (formulaStart > cursor) runs.push({ kind: "text", text: text.slice(cursor, formulaStart) });
      const rawTeX = (match[1] || match[2] || match[3] || match[5] || "").trim();
      if (rawTeX) runs.push({ kind: "inline_math", rawTeX, renderedText: rawTeX, displayMode: !!(match[1] || match[2]) });
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) runs.push({ kind: "text", text: text.slice(cursor) });
    return runs.length ? runs : [{ kind: "text", text }];
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
    if (kind === "table") return payload.rows.flat().join("\t");
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
      if (run.kind === "text" && previous?.kind === "text") previous.text += run.text;
      else merged.push(run);
    }
    return merged;
  }

  function captureHighlightSelection(turn, answerDoc, range) {
    if (!turn || !answerDoc?.durable || !(range instanceof Range) || range.collapsed) return null;
    if (!(turn.answerRoot instanceof HTMLElement) || !turn.answerRoot.contains(range.startContainer) || !turn.answerRoot.contains(range.endContainer)) return null;
    const projection = buildHighlightProjection(turn, answerDoc);
    if (!projection || projection.segments.length === 0) return null;
    const selected = projection.segments.filter((segment) => rangeIntersectsNode(range, segment.node));
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
      : Array.from(root.childNodes).filter((node) => node instanceof HTMLElement || (node.nodeType === Node.TEXT_NODE && normalizeText(node.nodeValue || "")));
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
    if (!(node instanceof HTMLElement)) return;
    if (node.matches("[data-mica-ui],script,style,noscript,template") || node.matches(INTERACTIVE_SELECTOR)) return;
    if (isMathRoot(node)) {
      const math = mathPayload(node);
      const text = math.rawTeX || math.renderedText;
      if (text) appendProjectionSegment(projection, text, node, "math", block, math.rawTeX);
      return;
    }
    for (const child of node.childNodes) collectProjectionSegments(child, block, projection);
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
    return node.matches(".katex,.katex-display,mjx-container,math[alttext],[data-tex],[data-math-source]")
      && !node.parentElement?.closest(".katex,.katex-display,mjx-container,math[alttext],[data-tex],[data-math-source]");
  }

  function rangeIntersectsNode(range, node) {
    try { return range.intersectsNode(node); }
    catch (_error) { return false; }
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
    captureHighlightSelection,
    resolveHighlightAnchor,
    extractRawMathSources
  });
})();
