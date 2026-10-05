(() => {
  const UI_MARKERS = [
    "[data-mica-ui]",
    "[data-message-feedback]",
    "[data-testid*='action']",
    "button",
    "[role='button']"
  ].join(",");

  function serializeAnswer(root) {
    if (!(root instanceof Element)) return failure("answer_not_found");
    const body = findAnswerBody(root);
    if (!body) return failure("answer_body_not_found");
    const clone = body.cloneNode(true);
    if (!(clone instanceof Element)) return failure("answer_clone_failed");
    clone.querySelectorAll(UI_MARKERS).forEach((node) => node.remove());
    const markdown = normalizeDocument(childrenToMarkdown(clone));
    if (!markdown) return failure("answer_empty");
    return {
      ok: true,
      markdown,
      plainText: markdown,
      html: sanitizeHtml(clone),
      source: "mica-dom-serializer-v1"
    };
  }

  function findAnswerBody(root) {
    const explicit = root.matches?.("[data-message-author-role='assistant']")
      ? root
      : root.querySelector("[data-message-author-role='assistant']");
    if (!explicit) return null;
    const candidates = [
      "[data-message-content]",
      ".markdown",
      "[class*='markdown']",
      "article"
    ];
    for (const selector of candidates) {
      const candidate = explicit.querySelector(selector);
      if (candidate && hasMeaningfulContent(candidate)) return candidate;
    }
    return hasMeaningfulContent(explicit) ? explicit : null;
  }

  function childrenToMarkdown(root) {
    return Array.from(root.childNodes).map((node) => nodeToMarkdown(node, { listDepth: 0 })).join("");
  }

  function nodeToMarkdown(node, context) {
    if (node.nodeType === Node.TEXT_NODE) return normalizeInlineText(node.nodeValue || "");
    if (!(node instanceof Element)) return "";
    if (node.matches(UI_MARKERS)) return "";
    const tag = node.tagName.toLowerCase();
    const math = extractMath(node);
    if (math) return math.display ? `\n\n$$\n${math.source}\n$$\n\n` : `$${math.source}$`;
    if (tag === "br") return "\n";
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${inlineChildren(node).trim()}\n\n`;
    if (tag === "p") return `\n\n${inlineChildren(node).trim()}\n\n`;
    if (tag === "strong" || tag === "b") return `**${inlineChildren(node)}**`;
    if (tag === "em" || tag === "i") return `*${inlineChildren(node)}*`;
    if (tag === "s" || tag === "del") return `~~${inlineChildren(node)}~~`;
    if (tag === "a") return linkToMarkdown(node);
    if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return inlineCode(node.textContent || "");
    if (tag === "pre") return preToMarkdown(node);
    if (tag === "blockquote") return blockquoteToMarkdown(node, context);
    if (tag === "ul" || tag === "ol") return listToMarkdown(node, context);
    if (tag === "table") return tableToMarkdown(node);
    if (tag === "hr") return "\n\n---\n\n";
    if (tag === "img") return imageToMarkdown(node);
    return Array.from(node.childNodes).map((child) => nodeToMarkdown(child, context)).join("");
  }

  function inlineChildren(node) {
    return Array.from(node.childNodes).map((child) => nodeToMarkdown(child, { listDepth: 0 })).join("")
      .replace(/\n{2,}/g, " ")
      .replace(/[ \t]+/g, " ");
  }

  function listToMarkdown(list, context) {
    const ordered = list.tagName.toLowerCase() === "ol";
    const start = Number(list.getAttribute("start")) || 1;
    const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === "li");
    const lines = items.map((item, index) => {
      const nested = Array.from(item.children).filter((child) => ["ul", "ol"].includes(child.tagName.toLowerCase()));
      const clone = item.cloneNode(true);
      if (clone instanceof Element) clone.querySelectorAll(":scope > ul, :scope > ol").forEach((child) => child.remove());
      const prefix = ordered ? `${start + index}. ` : "- ";
      const indent = "  ".repeat(context.listDepth || 0);
      const body = normalizeInlineText(inlineChildren(clone)).trim();
      const nestedText = nested.map((child) => listToMarkdown(child, { listDepth: (context.listDepth || 0) + 1 })).join("");
      return `${indent}${prefix}${body}\n${nestedText}`;
    });
    return `\n${lines.join("")}\n`;
  }

  function blockquoteToMarkdown(node, context) {
    const body = normalizeDocument(Array.from(node.childNodes).map((child) => nodeToMarkdown(child, context)).join(""));
    return `\n\n${body.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n")}\n\n`;
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
      Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => escapeTableCell(inlineChildren(cell).trim()))
    ).filter((row) => row.length > 0);
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
    const header = normalized[0];
    const body = normalized.slice(1);
    return `\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${body.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
  }

  function preToMarkdown(pre) {
    const code = pre.querySelector("code") || pre;
    const language = detectLanguage(code);
    const text = (code.textContent || "").replace(/^\n|\n$/g, "");
    const longestFence = Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1));
    const fence = "`".repeat(longestFence);
    return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
  }

  function extractMath(node) {
    if (!node.matches?.(".katex, .katex-display, math, [data-latex], [data-tex], [data-math-display]")) return null;
    const annotation = node.querySelector?.("annotation[encoding='application/x-tex']");
    const source = annotation?.textContent?.trim()
      || node.getAttribute?.("data-latex")?.trim()
      || node.getAttribute?.("data-tex")?.trim();
    if (!source) return null;
    const display = node.matches?.(".katex-display, [data-math-display='block']")
      || !!node.closest?.(".katex-display, [data-math-display='block']");
    return { source, display };
  }

  function sanitizeHtml(root) {
    const clone = root.cloneNode(true);
    if (!(clone instanceof Element)) return "";
    clone.querySelectorAll("script, style, iframe, object, embed, form, input, textarea, button, [data-mica-ui]").forEach((node) => node.remove());
    clone.querySelectorAll("*").forEach((element) => {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name) || ["style", "srcdoc"].includes(attribute.name)) element.removeAttribute(attribute.name);
        if (["href", "src"].includes(attribute.name) && /^javascript:/i.test(attribute.value.trim())) element.removeAttribute(attribute.name);
      }
    });
    return clone.innerHTML;
  }

  function linkToMarkdown(node) {
    const label = inlineChildren(node).trim() || node.getAttribute("href") || "";
    const href = node.getAttribute("href") || "";
    return href && !/^javascript:/i.test(href) ? `[${escapeBrackets(label)}](${href})` : label;
  }

  function imageToMarkdown(node) {
    const src = node.getAttribute("src") || "";
    if (!src || /^data:/i.test(src)) return "";
    return `![${escapeBrackets(node.getAttribute("alt") || "")}](${src})`;
  }

  function inlineCode(value) {
    const text = String(value).trim();
    const fence = text.includes("``") ? "```" : text.includes("`") ? "``" : "`";
    return `${fence}${text}${fence}`;
  }

  function detectLanguage(code) {
    const match = String(code.className || "").match(/(?:language|lang)-([\w+-]+)/i);
    return match ? match[1] : "";
  }

  function hasMeaningfulContent(node) {
    return !!String(node.textContent || "").trim() || !!node.querySelector("img, table, pre, .katex, math");
  }

  function normalizeInlineText(value) {
    return String(value).replace(/[\t\r ]+/g, " ");
  }

  function normalizeDocument(value) {
    return String(value)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeTableCell(value) {
    return value.replaceAll("|", "\\|").replace(/\n+/g, "<br>");
  }

  function escapeBrackets(value) {
    return value.replace(/([\[\]])/g, "\\$1");
  }

  function failure(reason) {
    return { ok: false, reason, markdown: "", plainText: "", html: "" };
  }

  globalThis.MicaMarkdownCopy = {
    serializeAnswer,
    findAnswerBody,
    normalizeDocument
  };
})();
