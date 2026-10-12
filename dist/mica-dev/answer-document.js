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
  const KNOWN_BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,table,pre,.katex-display";
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
    if (node.matches(".katex-display")) {
      return finalizeBlock(state, "display_math", mathPayload(node));
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
        if (text) runs.push({ kind: "text", text });
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      if (child.matches(".katex-display")) continue;
      if (child.matches(".katex") && !child.closest(".katex-display")) {
        runs.push({ kind: "inline_math", ...mathPayload(child) });
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
    const rawTeX = node.querySelector("annotation[encoding='application/x-tex']")?.textContent || node.getAttribute("data-tex") || null;
    const renderedText = normalizeText(node.querySelector(".katex-html")?.textContent || node.textContent || "");
    return { rawTeX, renderedText };
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
    fromAssistantTurn
  });
})();
