const STORAGE_KEY = "mica.pendingExport.v1";
const elements = {
  title: document.getElementById("documentTitle"),
  createdAt: document.getElementById("createdAt"),
  content: document.getElementById("exportContent"),
  status: document.getElementById("exportStatus"),
  print: document.getElementById("printPdf")
};

initialize();
elements.print.addEventListener("click", () => window.print());

async function initialize() {
  const payload = await readPayload();
  if (!payload?.html) {
    elements.status.textContent = "No export is waiting.";
    elements.content.removeAttribute("aria-busy");
    return;
  }
  elements.title.textContent = payload.title || "ChatGPT answer";
  elements.createdAt.textContent = formatDate(payload.createdAt);
  elements.createdAt.dateTime = payload.createdAt || "";
  elements.content.innerHTML = payload.html;
  const math = renderMath(elements.content);
  elements.content.removeAttribute("aria-busy");
  elements.print.disabled = false;
  elements.status.textContent = math.fallbacks ? `Ready with ${math.fallbacks} math fallback${math.fallbacks === 1 ? "" : "s"}.` : "Ready. Content stays on this device.";
  document.documentElement.dataset.micaExportReady = "true";
  document.documentElement.dataset.micaMathFallbacks = String(math.fallbacks);
}

function renderMath(root) {
  let fallbacks = 0;
  for (const node of root.querySelectorAll(".mica-export-math")) {
    const source = node.dataset.mathSource || node.textContent || "";
    const displayMode = node.dataset.mathDisplay === "true";
    try {
      katex.render(source, node, { displayMode, output: "htmlAndMathml", throwOnError: true, strict: "warn", trust: false });
      const copySource = document.createElement(displayMode ? "div" : "span");
      copySource.className = displayMode ? "mica-export-math-source mica-export-math-source-display" : "mica-export-math-source mica-export-math-source-inline";
      copySource.textContent = `TeX source: ${source}`;
      copySource.setAttribute("aria-label", `Copyable TeX source: ${source}`);
      node.append(copySource);
    } catch (_error) {
      fallbacks += 1;
      node.classList.add("mica-export-math-fallback");
      node.textContent = source;
      node.setAttribute("aria-label", `LaTeX source: ${source}`);
    }
  }
  return { fallbacks };
}

function readPayload() {
  return new Promise((resolve) => chrome.storage.session.get({ [STORAGE_KEY]: null }, (items) => resolve(items[STORAGE_KEY])));
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
