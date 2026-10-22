(() => {
  const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
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
  const root = document.getElementById("document");
  const status = document.getElementById("status");
  const printButton = document.getElementById("print");

  printButton?.addEventListener("click", () => window.print());

  function renderModel(model) {
    if (!root || !validModel(model)) return renderError("This export is unavailable because its document model is incomplete.");
    document.documentElement.dataset.pageSize = model.pageSize === "Letter" ? "Letter" : "A4";
    root.replaceChildren();
    const header = element("header", "document-header");
    header.append(element("h1", "", model.title || "ChatGPT answer"));
    const meta = element("p");
    meta.textContent = `Local export · ${new Date(model.createdAt).toLocaleString()} · ${model.highlights.length} highlight${model.highlights.length === 1 ? "" : "s"}`;
    header.append(meta);
    root.append(header);
    const answer = element("article", "answer");
    answer.dataset.documentId = model.documentId;
    const mathRendering = { semantic: 0, fallback: 0, partialHighlightFallback: 0, invalidTreeFallback: 0 };
    for (const block of model.blocks) answer.append(renderBlock(block, model.highlights, mathRendering));
    root.append(answer);
    const note = element("footer", "export-note");
    note.textContent = exportNote(model, mathRendering);
    root.append(note);
    document.title = `${model.title || "ChatGPT answer"} - Mica`;
    if (status) status.textContent = "Ready. Use the browser print dialog to save the selectable PDF.";
    if (printButton) printButton.disabled = false;
    document.documentElement.dataset.ready = "true";
    return {
      ok: true,
      plainText: model.plainText,
      highlights: model.highlights.length,
      semanticMath: mathRendering.semantic,
      fallbackMath: mathRendering.fallback,
      partialHighlightMathFallback: mathRendering.partialHighlightFallback,
      invalidTreeMathFallback: mathRendering.invalidTreeFallback
    };
  }

  function renderBlock(block, highlights, mathRendering) {
    if (block.kind === "heading") return renderUnits(element(`h${Math.max(1, Math.min(6, block.level || 2))}`), block.units, highlights, mathRendering);
    if (block.kind === "paragraph") return renderUnits(element("p"), block.units, highlights, mathRendering);
    if (block.kind === "quote") return renderUnits(element("blockquote"), block.units, highlights, mathRendering);
    if (block.kind === "code") return renderUnits(element("pre"), block.units, highlights, mathRendering);
    if (block.kind === "display_math") return renderUnits(element("div", "math display-math"), block.units, highlights, mathRendering);
    if (block.kind === "list") {
      const list = element(block.ordered ? "ol" : "ul");
      for (const item of block.items) list.append(renderUnits(element("li"), item, highlights, mathRendering));
      return list;
    }
    if (block.kind === "table") {
      const table = element("table");
      const body = element("tbody");
      for (const row of block.rows) {
        const tr = element("tr");
        for (const cell of row) tr.append(renderUnits(element("td"), cell, highlights, mathRendering));
        body.append(tr);
      }
      table.append(body);
      return table;
    }
    return renderUnits(element("p"), block.units || [], highlights, mathRendering);
  }

  function renderUnits(parent, units, highlights, mathRendering) {
    for (const unit of units || []) appendHighlightedUnit(parent, unit, highlights, mathRendering);
    return parent;
  }

  function appendHighlightedUnit(parent, unit, highlights, mathRendering) {
    let mathFallback = "text-fallback";
    if (["inline_math", "display_math"].includes(unit.kind) && unit.mathMlTree) {
      const semanticResult = appendSemanticMathUnit(parent, unit, highlights);
      if (semanticResult === "rendered") {
        mathRendering.semantic += 1;
        return;
      }
      mathFallback = semanticResult === "partial-highlight" ? "text-fallback-partial-highlight" : "text-fallback-invalid-mathml";
    }
    if (["inline_math", "display_math"].includes(unit.kind)) {
      mathRendering.fallback += 1;
      if (mathFallback === "text-fallback-partial-highlight") mathRendering.partialHighlightFallback += 1;
      if (mathFallback === "text-fallback-invalid-mathml") mathRendering.invalidTreeFallback += 1;
    }
    const boundaries = new Set([unit.start, unit.end]);
    for (const highlight of highlights) {
      if (highlight.end > unit.start && highlight.start < unit.end) {
        boundaries.add(Math.max(unit.start, highlight.start));
        boundaries.add(Math.min(unit.end, highlight.end));
      }
    }
    const points = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const text = unit.text.slice(start - unit.start, end - unit.start);
      if (!text) continue;
      const active = highlights.find((highlight) => highlight.start <= start && highlight.end >= end);
      const leaf = active ? element("mark") : element("span");
      if (active) leaf.dataset.color = active.color;
      applyUnitSemantics(leaf, unit);
      if (["inline_math", "display_math"].includes(unit.kind)) {
        leaf.classList.add("math");
        leaf.dataset.micaPdfKind = unit.kind;
        leaf.dataset.micaMathRendering = mathFallback;
        if (unit.rawTeX) leaf.dataset.tex = unit.rawTeX;
      }
      leaf.textContent = text;
      const href = safeHref(unit.href);
      if (["link", "citation"].includes(unit.kind) && href) {
        const link = element("a", "mica-export-link");
        link.setAttribute("href", href);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        link.append(leaf);
        parent.append(link);
      } else {
        parent.append(leaf);
      }
    }
  }

  function appendSemanticMathUnit(parent, unit, highlights) {
    const overlapping = highlights.filter((highlight) => highlight.end > unit.start && highlight.start < unit.end);
    if (overlapping.some((highlight) => highlight.start > unit.start || highlight.end < unit.end)) return "partial-highlight";
    const math = createMathMlNode(unit.mathMlTree);
    if (!math) return "invalid-tree";
    const active = overlapping[0];
    const leaf = active ? element("mark") : element("span");
    if (active) leaf.dataset.color = active.color;
    applyUnitSemantics(leaf, unit);
    leaf.classList.add("math");
    leaf.dataset.micaPdfKind = unit.kind;
    leaf.dataset.micaMathRendering = "semantic-mathml";
    if (unit.rawTeX) leaf.dataset.tex = unit.rawTeX;
    leaf.append(math);
    parent.append(leaf);
    return "rendered";
  }

  function createMathMlNode(value, depth = 0, budget = { nodes: 0, text: 0 }) {
    if (depth > MAX_MATHML_DEPTH || !value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof value.text === "string" && Object.keys(value).every((key) => key === "text")) {
      budget.nodes += 1;
      budget.text += value.text.length;
      return budget.nodes <= MAX_MATHML_NODES && budget.text <= MAX_MATHML_TEXT ? document.createTextNode(value.text) : null;
    }
    const tag = String(value.tag || "").toLowerCase();
    if (!MATHML_TAGS.has(tag) || !Array.isArray(value.children)) return null;
    budget.nodes += 1;
    if (budget.nodes > MAX_MATHML_NODES) return null;
    const node = document.createElementNS(MATHML_NAMESPACE, tag);
    for (const [name, raw] of Object.entries(value.attributes || {})) {
      const attribute = String(name).toLowerCase();
      const text = String(raw);
      if (!MATHML_ATTRIBUTES.has(attribute) || text.length > 128 || /[<>\u0000-\u001f]/.test(text)) return null;
      node.setAttribute(attribute, text);
    }
    for (const child of value.children) {
      const childNode = createMathMlNode(child, depth + 1, budget);
      if (!childNode) return null;
      node.append(childNode);
    }
    return node;
  }

  function exportNote(model, mathRendering) {
    const notes = ["Generated locally by Mica."];
    if (mathRendering.semantic) notes.push(`${mathRendering.semantic} mathematical unit${mathRendering.semantic === 1 ? " uses" : "s use"} semantic MathML.`);
    if (mathRendering.fallback) notes.push(`${mathRendering.fallback} mathematical unit${mathRendering.fallback === 1 ? " uses" : "s use"} visible TeX fallback.`);
    if (model.unresolvedHighlightCount) notes.push(`${model.unresolvedHighlightCount} unresolved highlight${model.unresolvedHighlightCount === 1 ? " was" : "s were"} kept locally and not attached by guess.`);
    return notes.join(" ");
  }

  function applyUnitSemantics(leaf, unit) {
    leaf.classList.add(`unit-${["text", "inline_code", "link", "citation", "image"].includes(unit.kind) ? unit.kind : "text"}`);
    for (const mark of Array.isArray(unit.marks) ? unit.marks : []) {
      if (["strong", "emphasis", "strikethrough", "code"].includes(mark)) leaf.classList.add(`mark-${mark}`);
    }
  }

  function safeHref(value) {
    const href = String(value || "").trim();
    return /^(https?:|mailto:)/i.test(href) ? href.replace(/[\s<>]/g, "") : null;
  }

  function renderError(message) {
    root?.replaceChildren(element("div", "error", message));
    if (status) status.textContent = message;
    if (printButton) printButton.disabled = true;
    document.documentElement.dataset.ready = "error";
    return { ok: false, reason: message };
  }

  function validModel(model) {
    return model?.schemaVersion === 1
      && typeof model.documentId === "string"
      && Array.isArray(model.blocks)
      && Array.isArray(model.highlights)
      && typeof model.plainText === "string"
      && [undefined, "A4", "Letter"].includes(model.pageSize)
      && [undefined, true, false].includes(model.includeHighlights);
  }

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function loadPendingExport() {
    const token = location.hash.slice(1);
    if (!/^[a-f0-9-]{16,64}$/.test(token) || !globalThis.chrome?.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: "MICA_GET_PDF_EXPORT", token }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) renderError("This local export expired. Return to ChatGPT and choose Export PDF again.");
      else renderModel(response.model);
    });
  }

  globalThis.MicaPdfExportPage = Object.freeze({ renderModel });
  loadPendingExport();
})();
