(() => {
  function serializeNotion(root) {
    const base = globalThis.MicaMarkdownCopy?.serializeAnswer(root);
    if (!base?.ok) return base || failure("serializer_unavailable");
    const template = document.createElement("template");
    template.innerHTML = base.html;
    replaceMathWithNotionSource(template.content);
    const html = wrapNotionHtml(template.innerHTML);
    return {
      ok: true,
      plainText: toNotionPlain(base.markdown),
      html,
      mathMode: "official-katex-source-deterministic-fallback",
      source: "mica-notion-ready-v1"
    };
  }

  function preparePdfExport(root) {
    const base = globalThis.MicaMarkdownCopy?.serializeAnswer(root);
    if (!base?.ok) return base || failure("serializer_unavailable");
    const template = document.createElement("template");
    template.innerHTML = base.html;
    replaceMathWithExportNodes(template.content);
    template.content.querySelectorAll("mark[data-mica-highlight-id]").forEach((mark) => {
      mark.setAttribute("data-export-highlight", "true");
    });
    const title = template.content.querySelector("h1, h2, h3")?.textContent?.trim() || "ChatGPT answer";
    return {
      ok: true,
      title: title.slice(0, 120),
      html: template.innerHTML,
      plainText: base.plainText,
      createdAt: new Date().toISOString(),
      renderer: "mica-print-surface-v1",
      contentUpload: false
    };
  }

  function replaceMathWithNotionSource(root) {
    for (const element of findOutermostMath(root)) {
      const source = extractMathSource(element);
      if (!source) continue;
      const display = isDisplayMath(element);
      const replacement = document.createElement(display ? "div" : "span");
      replacement.className = display ? "mica-notion-equation-block" : "mica-notion-equation-inline";
      replacement.dataset.equationExpression = source;
      replacement.textContent = display ? `$$\n${source}\n$$` : `$$${source}$$`;
      element.replaceWith(replacement);
    }
  }

  function replaceMathWithExportNodes(root) {
    for (const element of findOutermostMath(root)) {
      const source = extractMathSource(element);
      if (!source) continue;
      const display = isDisplayMath(element);
      const replacement = document.createElement(display ? "div" : "span");
      replacement.className = display ? "mica-export-math mica-export-math-display" : "mica-export-math mica-export-math-inline";
      replacement.dataset.mathSource = source;
      replacement.dataset.mathDisplay = display ? "true" : "false";
      replacement.textContent = source;
      element.replaceWith(replacement);
    }
  }

  function findOutermostMath(root) {
    const selector = ".katex-display, .katex, math, [data-latex], [data-tex], [data-math-display]";
    return Array.from(root.querySelectorAll(selector)).filter((element) => !element.parentElement?.closest(selector));
  }

  function extractMathSource(element) {
    return element.querySelector("annotation[encoding='application/x-tex']")?.textContent?.trim()
      || element.getAttribute("data-latex")?.trim()
      || element.getAttribute("data-tex")?.trim()
      || "";
  }

  function isDisplayMath(element) {
    return element.matches(".katex-display, [data-math-display='block']") || !!element.closest(".katex-display, [data-math-display='block']");
  }

  function toNotionPlain(markdown) {
    return String(markdown).replace(/(^|[^$])\$([^$\n]+)\$(?!\$)/g, (_match, prefix, source) => `${prefix}$$${source}$$`);
  }

  function wrapNotionHtml(body) {
    return `<div data-mica-notion-ready="v1">${body}</div>`;
  }

  function failure(reason) {
    return { ok: false, reason, plainText: "", html: "" };
  }

  globalThis.MicaResearchExport = {
    serializeNotion,
    preparePdfExport,
    toNotionPlain,
    findOutermostMath
  };
})();
