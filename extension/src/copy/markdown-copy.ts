(() => {
  const GLOBAL_KEY = "MicaMarkdownCopy";
  const BUTTON_ATTR = "data-mica-copy-action";
  const BUTTON_TEXT = "Mica Copy";
  const DISPLAY_MATH_DELIMITER = "$$";

  let enabled = true;
  let lastResult = null;
  let onCopy = null;

  function configure(options = {}) {
    enabled = options.enabled !== false;
    onCopy = typeof options.onCopy === "function" ? options.onCopy : onCopy;
    if (!enabled) removeAllButtons();
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    if (!enabled) removeAllButtons();
  }

  function sync(turns = []) {
    if (!enabled) return;
    for (const turn of turns) {
      if (!(turn instanceof HTMLElement) || !isAssistantTurn(turn)) continue;
      ensureCopyButton(turn);
    }
  }

  async function copyTurn(turn) {
    if (!(turn instanceof HTMLElement)) return { copied: false, reason: "missing_turn" };
    const markdown = serializeTurn(turn);
    if (!markdown.trim()) return { copied: false, reason: "empty_output" };
    await writeClipboard(markdown);
    lastResult = summarizeCopyResult(markdown);
    try {
      onCopy?.(lastResult);
    } catch (_error) {
      // Copy must not depend on optional diagnostics hooks.
    }
    return { copied: true, ...lastResult };
  }

  function serializeTurn(turn) {
    const root = findAnswerRoot(turn) || turn;
    const blocks = [];
    for (const child of visibleChildren(root)) {
      const text = serializeBlock(child, 0).trimEnd();
      if (text) blocks.push(text);
    }
    const fallback = blocks.length ? blocks.join("\n\n") : serializeInline(root).trim();
    return normalizeBlankLines(fallback);
  }

  function ensureCopyButton(turn) {
    if (turn.querySelector(`[${BUTTON_ATTR}="true"]`)) return;
    const bar = findActionBar(turn) || createActionBar(turn);
    if (!bar) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = BUTTON_TEXT;
    button.setAttribute(BUTTON_ATTR, "true");
    button.setAttribute("aria-label", "Copy this answer as Mica Markdown");
    button.style.cssText = "font: inherit; font-size: 12px; line-height: 1.2; padding: 4px 7px; border: 1px solid rgba(95,99,110,.28); border-radius: 6px; background: rgba(255,255,255,.78); color: inherit; cursor: pointer;";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const result = await copyTurn(turn);
        button.textContent = result.copied ? "Copied" : "Copy failed";
      } catch (_error) {
        button.textContent = "Copy failed";
      }
      setTimeout(() => {
        if (button.isConnected) button.textContent = BUTTON_TEXT;
      }, 1400);
    });
    bar.appendChild(button);
  }

  function removeAllButtons() {
    document.querySelectorAll(`[${BUTTON_ATTR}="true"]`).forEach((node) => node.remove());
  }

  function findActionBar(turn) {
    const selectors = [
      "[data-testid*='copy']",
      "[aria-label*='Copy' i]",
      "[data-testid*='message-actions' i]",
      "[class*='action' i]"
    ];
    for (const selector of selectors) {
      const node = turn.querySelector(selector);
      const bar = node?.closest?.("div, menu, section");
      if (bar instanceof HTMLElement && !bar.closest("[data-mica-root='true']")) return bar;
    }
    return null;
  }

  function createActionBar(turn) {
    const bar = document.createElement("div");
    bar.setAttribute("data-mica-copy-bar", "true");
    bar.style.cssText = "display:flex; justify-content:flex-end; gap:6px; margin-top:6px;";
    turn.appendChild(bar);
    return bar;
  }

  function findAnswerRoot(turn) {
    const candidates = [
      "[data-message-author-role='assistant']",
      ".markdown",
      "[data-testid*='markdown']",
      "article"
    ];
    for (const selector of candidates) {
      const node = turn.matches(selector) ? turn : turn.querySelector(selector);
      if (node instanceof HTMLElement) return node;
    }
    return turn;
  }

  function isAssistantTurn(turn) {
    if (turn.matches("[data-message-author-role='assistant']")) return true;
    return !!turn.querySelector("[data-message-author-role='assistant']");
  }

  function serializeBlock(node, depth) {
    if (!(node instanceof Element) || isUiOnly(node) || isHidden(node)) return "";
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${serializeInline(node).trim()}`;
    if (tag === "p") return serializeInline(node).trim();
    if (tag === "br") return "";
    if (tag === "hr") return "---";
    if (tag === "pre") return serializeCodeBlock(node);
    if (tag === "blockquote") return prefixLines(serializeChildrenAsBlocks(node, depth).trim(), "> ");
    if (tag === "ul" || tag === "ol") return serializeList(node, depth, tag === "ol");
    if (tag === "table") return serializeTable(node);
    if (isDisplayMath(node)) return serializeMath(node, true);
    if (hasOnlyInlineContent(node)) return serializeInline(node).trim();
    return serializeChildrenAsBlocks(node, depth);
  }

  function serializeChildrenAsBlocks(node, depth) {
    return visibleChildren(node).map((child) => serializeBlock(child, depth)).filter(Boolean).join("\n\n");
  }

  function serializeInline(node) {
    if (node.nodeType === Node.TEXT_NODE) return escapeMarkdownText(node.textContent || "");
    if (!(node instanceof Element) || isUiOnly(node) || isHidden(node)) return "";
    if (isDisplayMath(node) || isInlineMath(node)) return serializeMath(node, isDisplayMath(node));
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "code" && node.closest("pre") == null) return inlineCode(node.textContent || "");
    if (tag === "strong" || tag === "b") return wrapInline(node, "**");
    if (tag === "em" || tag === "i") return wrapInline(node, "*");
    if (tag === "a") return serializeLink(node);
    return serializeInlineChildren(node);
  }

  function serializeCodeBlock(node) {
    const code = node.querySelector("code") || node;
    const language = languageFromCode(code);
    const text = (code.textContent || "").replace(/\n+$/g, "");
    const fence = longestFence(text);
    return `${fence}${language}\n${text}\n${fence}`;
  }

  function serializeList(list, depth, ordered) {
    const rows = [];
    const items = Array.from(list.children).filter((child) => child.tagName?.toLowerCase() === "li");
    items.forEach((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      const inlineParts = [];
      const nestedBlocks = [];
      for (const child of Array.from(item.childNodes)) {
        if (child instanceof Element && /^(ul|ol)$/i.test(child.tagName)) {
          nestedBlocks.push(serializeBlock(child, depth + 1));
        } else {
          inlineParts.push(serializeInline(child));
        }
      }
      const indent = "  ".repeat(depth);
      rows.push(`${indent}${marker}${inlineParts.join("").trim()}`.trimEnd());
      for (const nested of nestedBlocks) if (nested.trim()) rows.push(nested);
    });
    return rows.join("\n");
  }

  function serializeTable(table) {
    const rows = Array.from(table.querySelectorAll("tr")).map((tr) => {
      const cells = Array.from(tr.children).filter((cell) => /^(th|td)$/i.test(cell.tagName));
      return cells.map((cell) => normalizeCell(serializeInline(cell)));
    }).filter((row) => row.length > 0);
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
    return [normalized[0], normalized[0].map(() => "---"), ...normalized.slice(1)]
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n");
  }

  function serializeMath(node, display) {
    const source = findLatexSource(node) || (node.textContent || "").trim();
    const body = stripMathDelimiters(source);
    return display ? `$$\n${body}\n$$` : `$${body}$`;
  }

  function findLatexSource(node) {
    if (!(node instanceof Element)) return "";
    for (const attr of ["data-latex", "data-tex", "data-math", "aria-label"]) {
      const value = node.getAttribute(attr);
      if (looksLikeLatex(value)) return value.trim();
    }
    const annotation = node.querySelector("annotation[encoding='application/x-tex'], annotation[encoding='application/x-latex']");
    if (annotation?.textContent && looksLikeLatex(annotation.textContent)) return annotation.textContent.trim();
    const script = node.querySelector("script[type*='math/tex']");
    if (script?.textContent && looksLikeLatex(script.textContent)) return script.textContent.trim();
    return "";
  }

  function stripMathDelimiters(value) {
    let text = String(value || "").trim();
    text = text.replace(/^\\\[/, "").replace(/\\\]$/, "").trim();
    text = text.replace(/^\\\(/, "").replace(/\\\)$/, "").trim();
    text = text.replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
    text = text.replace(/^\$/, "").replace(/\$$/, "").trim();
    return text;
  }

  function isDisplayMath(node) {
    if (!(node instanceof Element)) return false;
    const signal = `${node.getAttribute("data-testid") || ""} ${node.getAttribute("data-display") || ""} ${node.className || ""}`;
    const text = (node.textContent || "").trim();
    return /katex-display|math-display|display-math|block-math|true/i.test(signal) || /^\\\[([\s\S]*)\\\]$/.test(text) || /^\$\$([\s\S]*)\$\$$/.test(text);
  }

  function isInlineMath(node) {
    if (!(node instanceof Element)) return false;
    const signal = `${node.getAttribute("data-testid") || ""} ${node.getAttribute("data-inline") || ""} ${node.className || ""}`;
    const text = (node.textContent || "").trim();
    return (/katex|math-inline|inline-math/i.test(signal) && !/katex-display|display/i.test(signal)) || /^\\\(([\s\S]*)\\\)$/.test(text);
  }

  function visibleChildren(node) {
    return Array.from(node.children || []).filter((child) => !isUiOnly(child) && !isHidden(child));
  }

  function hasOnlyInlineContent(node) {
    return !Array.from(node.children || []).some((child) => /^(div|section|article|p|ul|ol|li|pre|blockquote|table|h[1-6]|hr)$/i.test(child.tagName));
  }

  function isUiOnly(node) {
    if (!(node instanceof Element)) return false;
    if (node.closest(`[${BUTTON_ATTR}="true"], [data-mica-copy-bar='true'], [data-mica-root='true']`)) return true;
    const signal = [node.getAttribute("aria-label"), node.getAttribute("data-testid"), node.getAttribute("role"), node.className].filter(Boolean).join(" ");
    return (/copy|copied|regenerate|thumb|reaction|toolbar|action/i.test(signal) && !/markdown|message|prose/i.test(signal)) || node instanceof HTMLButtonElement;
  }

  function isHidden(node) {
    if (!(node instanceof Element)) return false;
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return true;
    return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute("style") || "");
  }

  function serializeLink(node) {
    const href = node.getAttribute("href") || "";
    const label = serializeInlineChildren(node).trim() || href;
    if (!href || /^javascript:/i.test(href)) return label;
    return `[${label.replace(/\]/g, "\\]")}](${href.replace(/\)/g, "%29")})`;
  }

  function serializeInlineChildren(node) {
    return Array.from(node.childNodes).map(serializeInline).join("");
  }

  function wrapInline(node, marker) {
    const value = serializeInlineChildren(node).trim();
    return value ? `${marker}${value}${marker}` : "";
  }

  function prefixLines(value, prefix) {
    return String(value || "").split("\n").map((line) => `${prefix}${line}`.trimEnd()).join("\n");
  }

  function inlineCode(value) {
    const text = String(value || "");
    const runs = text.match(/`+/g) || [];
    const fence = "`".repeat(Math.max(1, ...runs.map((run) => run.length)) + 1);
    const needsSpace = text.startsWith("`") || text.endsWith("`");
    return needsSpace ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
  }

  function languageFromCode(code) {
    const signal = [code.getAttribute?.("class"), code.getAttribute?.("data-language")].filter(Boolean).join(" ");
    const match = signal.match(/language-([A-Za-z0-9_-]+)/);
    return match ? match[1] : "";
  }

  function longestFence(text) {
    const max = Math.max(2, ...((text.match(/`+/g) || []).map((run) => run.length)));
    return "`".repeat(max + 1);
  }

  function normalizeCell(value) {
    return String(value || "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  }

  function escapeMarkdownText(value) {
    return String(value || "").replace(/\u00a0/g, " ");
  }

  function normalizeBlankLines(value) {
    const normalized = String(value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return normalized ? `${normalized}\n` : "";
  }

  function looksLikeLatex(value) {
    return typeof value === "string" && /\\|[_^{}]|\$/.test(value);
  }

  async function writeClipboard(text) {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
  }

  function summarizeCopyResult(markdown) {
    return {
      copiedAt: new Date().toISOString(),
      profile: "Mica Markdown",
      outputLength: markdown.length,
      displayMathDelimiter: DISPLAY_MATH_DELIMITER,
      headings: (markdown.match(/^#{1,6}\s/gm) || []).length,
      codeBlocks: (markdown.match(/^```/gm) || []).length / 2,
      tables: (markdown.match(/^\| .+ \|$/gm) || []).length > 1 ? 1 : 0,
      displayMathBlocks: (markdown.match(/^\$\$/gm) || []).length / 2,
      inlineMath: (markdown.match(/(^|[^$])\$[^$\n]+\$/g) || []).length
    };
  }

  globalThis[GLOBAL_KEY] = {
    configure,
    setEnabled,
    sync,
    serializeTurn,
    copyTurn,
    getLastResult: () => lastResult,
    DISPLAY_MATH_DELIMITER
  };
})();
