(() => {
  const MODEL_VERSION = 1;
  const MAX_DOCUMENT_CHARS = 1_000_000;

  function serializeMarkdown(answerDocument, options = {}) {
    const checked = validateDocument(answerDocument);
    if (!checked.ok) return checked;
    const config = sanitizeOptions(options);
    const warnings = [];
    const parts = [];
    for (const block of answerDocument.orderedBlocks) {
      const rendered = blockToMarkdown(block, config, warnings);
      if (rendered) parts.push(rendered);
    }
    const markdown = normalizeDocument(parts.join("\n\n"));
    if (!markdown) return failure("answer_empty");
    if (markdown.length > MAX_DOCUMENT_CHARS) return failure("answer_too_large");
    return {
      ok: true,
      schemaVersion: MODEL_VERSION,
      format: config.flavor,
      documentId: answerDocument.documentId,
      sourceVersion: answerDocument.sourceVersion,
      markdown,
      plainText: markdown,
      mime: { "text/plain": markdown, "text/markdown": markdown },
      warnings: unique(warnings),
      localOnly: true
    };
  }

  function serializeNotion(answerDocument, options = {}) {
    const checked = validateDocument(answerDocument);
    if (!checked.ok) return checked;
    const warnings = [];
    const html = answerDocument.orderedBlocks.map((block) => blockToNotionHtml(block, warnings)).filter(Boolean).join("\n");
    const plain = serializeMarkdown(answerDocument, { ...options, inlineMathDelimiter: "dollar", displayMathDelimiter: "double-dollar" });
    if (!plain.ok) return plain;
    const wrapped = `<div data-mica-notion-payload="v1">${html}</div>`;
    return {
      ok: true,
      schemaVersion: MODEL_VERSION,
      format: "notion-clipboard",
      documentId: answerDocument.documentId,
      sourceVersion: answerDocument.sourceVersion,
      plainText: plain.markdown,
      html: wrapped,
      mime: { "text/plain": plain.markdown, "text/html": wrapped },
      nativeEquationStatus: "UNVERIFIED",
      deterministicImportFallback: true,
      warnings: unique([...plain.warnings, ...warnings, "notion_native_equations_require_real_target_validation"]),
      localOnly: true
    };
  }

  function serializeNotionImport(answerDocument, options = {}) {
    const markdown = serializeMarkdown(answerDocument, { ...options, flavor: "gfm", inlineMathDelimiter: "dollar", displayMathDelimiter: "double-dollar" });
    if (!markdown.ok) return markdown;
    return {
      ...markdown,
      format: "notion-import-markdown",
      fileName: `mica-${safeFilePart(answerDocument.documentId)}.md`,
      content: markdown.markdown,
      mime: { "text/markdown": markdown.markdown, "text/plain": markdown.markdown },
      nativeEquationStatus: "IMPORT_REQUIRES_REAL_TARGET_VALIDATION",
      warnings: unique([...markdown.warnings, "notion_import_requires_real_target_validation"])
    };
  }

  function serializeConversation(bundle, options = {}) {
    const checked = globalThis.MicaConversationExport?.validateBundle?.(bundle);
    if (!checked?.ok) return failure(checked?.reason || "conversation_completeness_unproven");
    const serialized = [];
    const counts = { user: 0, assistant: 0 };
    for (const entry of checked.bundle.entries) {
      const output = serializeMarkdown(entry.document, options);
      if (!output.ok) return failure(`conversation_turn_failed:${output.reason}`);
      counts[entry.role] += 1;
      serialized.push({ ...output, role: entry.role, label: entry.role === "user" ? `User ${counts.user}` : `Assistant ${counts.assistant}` });
    }
    const markdown = serialized.map((item) => `## ${item.label}\n\n${item.markdown}`).join("\n\n---\n\n");
    if (markdown.length > MAX_DOCUMENT_CHARS) return failure("conversation_too_large");
    return {
      ok: true,
      schemaVersion: MODEL_VERSION,
      format: "conversation-markdown",
      bundleId: checked.bundle.bundleId,
      markdown,
      plainText: markdown,
      turnCount: serialized.length,
      answerCount: counts.assistant,
      completionProof: { ...checked.bundle.completionProof },
      warnings: unique(serialized.flatMap((item) => item.warnings)),
      localOnly: true
    };
  }

  function blockToMarkdown(block, config, warnings) {
    if (!block || typeof block.kind !== "string") return "";
    if (block.kind === "heading") return `${"#".repeat(clamp(block.level, 1, 6, 2))} ${inlinesToMarkdown(block.inlines, config)}`;
    if (block.kind === "paragraph") return inlinesToMarkdown(block.inlines, config);
    if (block.kind === "quote") return inlinesToMarkdown(block.inlines, config).split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
    if (block.kind === "list") return (block.items || []).map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${inlinesToMarkdown(item.inlines, config)}`).join("\n");
    if (block.kind === "table") return tableToMarkdown(block.rows, config, warnings);
    if (block.kind === "code") return fencedCode(block.text, block.language);
    if (block.kind === "display_math") return mathMarkdown(block.rawTeX || block.renderedText, true, config);
    if (block.kind === "link" || block.kind === "citation") return safeLink(block.text, block.href);
    if (block.kind === "image") return block.src ? `![${escapeBrackets(block.alt || "")}](${safeHref(block.src)})` : "";
    if (block.kind === "opaque_interactive") {
      warnings.push("opaque_interactive_omitted");
      return "";
    }
    warnings.push(`unsupported_block_omitted:${block.kind}`);
    return "";
  }

  function inlinesToMarkdown(inlines, config) {
    return (Array.isArray(inlines) ? inlines : []).map((run) => {
      let output = "";
      if (run.kind === "inline_math") output = mathMarkdown(run.rawTeX || run.renderedText, false, config);
      else if (run.kind === "link" || run.kind === "citation") output = safeLink(run.text, run.href);
      else if (run.kind === "image") output = run.src ? `![${escapeBrackets(run.alt || "")}](${safeHref(run.src)})` : run.alt || "";
      else if (run.kind === "inline_code") output = inlineCode(run.text || "");
      else if (run.kind === "opaque_interactive") output = "";
      else output = String(run.text || run.label || "");
      return applyMarks(output, run.marks);
    }).join("");
  }

  function tableToMarkdown(rows, config, warnings) {
    const values = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? row : []).map((cell) => escapeTableCell(String(cell || ""))));
    if (!values.length) return "";
    if (config.flavor !== "gfm") {
      warnings.push("table_rendered_as_tab_separated_text");
      return values.map((row) => row.join("\t")).join("\n");
    }
    const width = Math.max(...values.map((row) => row.length));
    const normalized = values.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
    const [header, ...body] = normalized;
    return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body.map((row) => `| ${row.join(" | ")} |`)].join("\n");
  }

  function blockToNotionHtml(block, warnings) {
    if (!block || typeof block.kind !== "string") return "";
    if (block.kind === "heading") return `<h${clamp(block.level, 1, 6, 2)}>${inlinesToHtml(block.inlines)}</h${clamp(block.level, 1, 6, 2)}>`;
    if (block.kind === "paragraph") return `<p>${inlinesToHtml(block.inlines)}</p>`;
    if (block.kind === "quote") return `<blockquote>${inlinesToHtml(block.inlines)}</blockquote>`;
    if (block.kind === "list") {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${(block.items || []).map((item) => `<li>${inlinesToHtml(item.inlines)}</li>`).join("")}</${tag}>`;
    }
    if (block.kind === "table") return `<table><tbody>${(block.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    if (block.kind === "code") return `<pre><code data-language="${escapeAttribute(block.language || "")}">${escapeHtml(block.text || "")}</code></pre>`;
    if (block.kind === "display_math") return notionMath(block.rawTeX || block.renderedText, true);
    if (block.kind === "opaque_interactive") {
      warnings.push("opaque_interactive_omitted");
      return "";
    }
    warnings.push(`unsupported_block_omitted:${block.kind}`);
    return "";
  }

  function inlinesToHtml(inlines) {
    return (Array.isArray(inlines) ? inlines : []).map((run) => {
      let output;
      if (run.kind === "inline_math") output = notionMath(run.rawTeX || run.renderedText, false);
      else if (run.kind === "link" || run.kind === "citation") output = `<a href="${escapeAttribute(safeHref(run.href))}">${escapeHtml(run.text || run.href || "")}</a>`;
      else if (run.kind === "image") output = run.src ? `<img src="${escapeAttribute(safeHref(run.src))}" alt="${escapeAttribute(run.alt || "")}">` : escapeHtml(run.alt || "");
      else if (run.kind === "inline_code") output = `<code>${escapeHtml(run.text || "")}</code>`;
      else output = escapeHtml(run.text || run.label || "");
      return applyHtmlMarks(output, run.marks);
    }).join("");
  }

  function notionMath(source, display) {
    const tex = String(source || "").trim();
    if (!tex) return "";
    const tag = display ? "div" : "span";
    const readable = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
    return `<${tag} data-mica-equation="${display ? "block" : "inline"}" data-equation-expression="${escapeAttribute(tex)}">${escapeHtml(readable)}</${tag}>`;
  }

  function mathMarkdown(source, display, config) {
    const tex = String(source || "").trim();
    if (!tex) return "";
    if (display) return config.displayMathDelimiter === "brackets" ? `\\[\n${tex}\n\\]` : `$$\n${tex}\n$$`;
    return config.inlineMathDelimiter === "parentheses" ? `\\(${tex}\\)` : `$${tex}$`;
  }

  function applyMarks(value, marks) {
    let output = value;
    const set = new Set(Array.isArray(marks) ? marks : []);
    if (set.has("code")) output = inlineCode(output);
    if (set.has("strong")) output = `**${output}**`;
    if (set.has("emphasis")) output = `*${output}*`;
    if (set.has("strikethrough")) output = `~~${output}~~`;
    return output;
  }

  function applyHtmlMarks(value, marks) {
    let output = value;
    const set = new Set(Array.isArray(marks) ? marks : []);
    if (set.has("code")) output = `<code>${output}</code>`;
    if (set.has("strong")) output = `<strong>${output}</strong>`;
    if (set.has("emphasis")) output = `<em>${output}</em>`;
    if (set.has("strikethrough")) output = `<s>${output}</s>`;
    return output;
  }

  function fencedCode(value, language) {
    const text = String(value || "").replace(/^\n|\n$/g, "");
    const longest = Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1));
    const fence = "`".repeat(longest);
    return `${fence}${String(language || "").replace(/[^a-z0-9_+-]/gi, "")}\n${text}\n${fence}`;
  }

  function inlineCode(value) {
    const text = String(value || "");
    const fence = text.includes("``") ? "```" : text.includes("`") ? "``" : "`";
    return `${fence}${text}${fence}`;
  }

  function safeLink(label, href) {
    const safe = safeHref(href);
    const text = escapeBrackets(String(label || safe || ""));
    return safe ? `[${text}](${safe})` : text;
  }

  function safeHref(value) {
    const href = String(value || "").trim();
    return /^(https?:|mailto:)/i.test(href) ? href.replace(/[\s<>]/g, "") : "";
  }

  function validateDocument(value) {
    if (!value?.durable || value.generationState !== "SETTLED") return failure("answer_not_settled");
    if (typeof value.documentId !== "string" || typeof value.sourceVersion !== "string") return failure("answer_identity_missing");
    if (!Array.isArray(value.orderedBlocks) || value.orderedBlocks.length === 0) return failure("answer_empty");
    return { ok: true };
  }

  function sanitizeOptions(value) {
    return {
      flavor: value.flavor === "standard" ? "standard" : "gfm",
      inlineMathDelimiter: value.inlineMathDelimiter === "parentheses" ? "parentheses" : "dollar",
      displayMathDelimiter: value.displayMathDelimiter === "brackets" ? "brackets" : "double-dollar"
    };
  }

  function normalizeDocument(value) {
    return String(value).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function escapeTableCell(value) {
    return value.replaceAll("|", "\\|").replace(/\n+/g, "<br>");
  }

  function escapeBrackets(value) {
    return value.replace(/([\[\]])/g, "\\$1");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function safeFilePart(value) {
    const normalized = String(value || "answer").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
    return (normalized || "answer").slice(0, 96);
  }

  function failure(reason) {
    return { ok: false, reason, localOnly: true };
  }

  globalThis.MicaAnswerSerializer = Object.freeze({ modelVersion: MODEL_VERSION, serializeMarkdown, serializeNotion, serializeNotionImport, serializeConversation });
})();
