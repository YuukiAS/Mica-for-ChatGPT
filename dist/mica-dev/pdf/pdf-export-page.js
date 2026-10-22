(() => {
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
    for (const block of model.blocks) answer.append(renderBlock(block, model.highlights));
    root.append(answer);
    const note = element("footer", "export-note");
    note.textContent = model.unresolvedHighlightCount
      ? `${model.unresolvedHighlightCount} unresolved highlight${model.unresolvedHighlightCount === 1 ? " was" : "s were"} kept locally and not attached by guess.`
      : "Generated locally by Mica. Mathematical fallback remains visible TeX text so it stays searchable and selectable.";
    root.append(note);
    document.title = `${model.title || "ChatGPT answer"} - Mica`;
    if (status) status.textContent = "Ready. Use the browser print dialog to save the selectable PDF.";
    if (printButton) printButton.disabled = false;
    document.documentElement.dataset.ready = "true";
    return { ok: true, plainText: model.plainText, highlights: model.highlights.length };
  }

  function renderBlock(block, highlights) {
    if (block.kind === "heading") return renderUnits(element(`h${Math.max(1, Math.min(6, block.level || 2))}`), block.units, highlights);
    if (block.kind === "paragraph") return renderUnits(element("p"), block.units, highlights);
    if (block.kind === "quote") return renderUnits(element("blockquote"), block.units, highlights);
    if (block.kind === "code") return renderUnits(element("pre"), block.units, highlights);
    if (block.kind === "display_math") return renderUnits(element("div", "math display-math"), block.units, highlights);
    if (block.kind === "list") {
      const list = element(block.ordered ? "ol" : "ul");
      for (const item of block.items) list.append(renderUnits(element("li"), item, highlights));
      return list;
    }
    if (block.kind === "table") {
      const table = element("table");
      const body = element("tbody");
      for (const row of block.rows) {
        const tr = element("tr");
        for (const cell of row) tr.append(renderUnits(element("td"), cell, highlights));
        body.append(tr);
      }
      table.append(body);
      return table;
    }
    return renderUnits(element("p"), block.units || [], highlights);
  }

  function renderUnits(parent, units, highlights) {
    for (const unit of units || []) appendHighlightedUnit(parent, unit, highlights);
    return parent;
  }

  function appendHighlightedUnit(parent, unit, highlights) {
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
      if (["inline_math", "display_math"].includes(unit.kind)) {
        leaf.classList.add("math");
        leaf.dataset.micaPdfKind = unit.kind;
        if (unit.rawTeX) leaf.dataset.tex = unit.rawTeX;
      }
      if (unit.kind === "link" && unit.href) leaf.dataset.href = unit.href;
      leaf.textContent = text;
      parent.append(leaf);
    }
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
