(() => {
  const GLOBAL_KEY = "__MICA_COMPOSER_PROBE__";
  const previous = globalThis[GLOBAL_KEY];
  if (previous?.stop) previous.stop();

  const startedAt = new Date().toISOString();
  const startedPerf = performance.now();
  const elementIds = new WeakMap();
  const events = [];
  let nextElementId = 1;
  let lastKey = "";
  let timer = 0;

  function elementId(element) {
    if (!(element instanceof Element)) return null;
    if (!elementIds.has(element)) elementIds.set(element, nextElementId++);
    return elementIds.get(element);
  }

  function findComposerEditable() {
    const selectors = [
      "#prompt-textarea",
      "[data-testid*='composer'] [contenteditable]",
      "[data-testid*='composer'] textarea",
      "[contenteditable][role='textbox']",
      "textarea[placeholder]"
    ];

    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement) || seen.has(node)) continue;
        seen.add(node);
        candidates.push(node);
      }
    }

    if (document.activeElement instanceof HTMLElement && candidates.includes(document.activeElement)) {
      return document.activeElement;
    }

    return candidates.find((node) => node.isConnected && !node.hidden && node.getAttribute("aria-hidden") !== "true") || null;
  }

  function readComposerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || "";
    return element.innerText || element.textContent || "";
  }

  function findComposerRoot(element) {
    if (!(element instanceof Element)) return null;
    return element.closest("[data-testid*='composer'], form") || element.parentElement;
  }

  function hasGithubMention(root, text) {
    if (/\bgithub\b/i.test(text)) return true;
    if (!(root instanceof Element)) return false;
    const marked = root.querySelectorAll("[aria-label], [data-testid], [data-mention], [data-entity], [data-type]");
    for (const node of marked) {
      const signal = [
        node.getAttribute("aria-label"),
        node.getAttribute("data-testid"),
        node.getAttribute("data-mention"),
        node.getAttribute("data-entity"),
        node.getAttribute("data-type")
      ].filter(Boolean).join(" ");
      if (/github/i.test(signal)) return true;
    }
    return false;
  }

  function readMicaStatus() {
    const host = document.querySelector("[data-mica-root='true']");
    if (!(host instanceof HTMLElement)) return { present: false };
    const shadow = host.shadowRoot;
    const label = shadow?.querySelector(".mica-label")?.textContent?.trim() || null;
    return {
      present: true,
      hidden: !!host.hidden,
      status: label
    };
  }

  function snapshot() {
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    const text = readComposerText(editable);
    const active = document.activeElement;

    return {
      ms: Math.round(performance.now() - startedPerf),
      exists: !!editable,
      editableId: elementId(editable),
      rootId: elementId(root),
      tag: editable?.tagName?.toLowerCase() || null,
      role: editable?.getAttribute?.("role") || null,
      contenteditable: editable?.getAttribute?.("contenteditable") ?? null,
      testId: editable?.getAttribute?.("data-testid") || null,
      rootTag: root?.tagName?.toLowerCase() || null,
      rootTestId: root?.getAttribute?.("data-testid") || null,
      textLength: text.length,
      hasGithubMention: hasGithubMention(root, text),
      focused: !!editable && (active === editable || editable.contains(active)),
      mica: readMicaStatus()
    };
  }

  function sample() {
    const state = snapshot();
    const keyState = { ...state };
    delete keyState.ms;
    const key = JSON.stringify(keyState);
    if (key !== lastKey) {
      lastKey = key;
      events.push(state);
      console.log("[Mica composer probe]", state);
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = 0;
    sample();
    console.log("[Mica composer probe] stopped");
    return report();
  }

  function report() {
    return {
      probe: "mica-composer-page-probe.v1",
      startedAt,
      durationMs: Math.round(performance.now() - startedPerf),
      browser: navigator.userAgent,
      host: location.hostname,
      samples: events.slice()
    };
  }

  function reportText() {
    return JSON.stringify(report(), null, 2);
  }

  timer = setInterval(sample, 100);
  globalThis[GLOBAL_KEY] = { stop, report, reportText, sample };
  sample();
  console.log("[Mica composer probe] running. Use __MICA_COMPOSER_PROBE__.reportText() to export, or .stop() to stop.");
})();
