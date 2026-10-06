(() => {
  const ANSWER_SELECTOR = "[data-message-author-role='assistant']";
  const UI_SELECTOR = "[data-mica-ui], button, [role='button'], textarea, input, [contenteditable='true']";
  const STORAGE_PREFIX = "mica.highlights.v1:";
  let enabled = true;
  let records = [];
  let affordance = null;
  let restoreTimer = 0;
  let observer = null;
  let activeStorageKey = null;
  let contextGeneration = 0;

  async function configure(options = {}) {
    enabled = options.enabled !== false;
    dismissAffordance();
    if (!enabled) {
      removeRenderedHighlights();
      return snapshot();
    }
    ensureListeners();
    await switchPageContext(true);
    return snapshot();
  }

  function ensureListeners() {
    if (observer) return;
    document.addEventListener("mouseup", handleSelectionGesture, true);
    document.addEventListener("keyup", handleSelectionGesture, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("keydown", handleKeyDown, true);
    globalThis.addEventListener?.("popstate", scheduleContextRestore);
    globalThis.addEventListener?.("hashchange", scheduleContextRestore);
    observer = new MutationObserver((mutations) => {
      if (!enabled || mutations.every(isIgnoredMutation)) return;
      scheduleContextRestore();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function handleSelectionGesture(event) {
    if (!enabled || isComposerTarget(event.target) || event.target?.closest?.("[data-mica-ui]")) return;
    if (event.type === "keyup" && ["Escape", "Delete", "Backspace"].includes(event.key)) return;
    queueMicrotask(async () => {
      await switchPageContext();
      showSelectionAffordance();
    });
  }

  function handlePointerDown(event) {
    const mark = event.target instanceof Element ? event.target.closest("mark[data-mica-highlight-id]") : null;
    if (mark) {
      event.stopPropagation();
      showRemoveAffordance(mark);
      return;
    }
    if (!event.target?.closest?.("[data-mica-ui='highlight-affordance']")) dismissAffordance();
  }

  function handleFocusIn(event) {
    const mark = event.target instanceof Element ? event.target.closest("mark[data-mica-highlight-id]") : null;
    if (mark) showRemoveAffordance(mark);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape" && affordance) {
      event.preventDefault();
      dismissAffordance();
      return;
    }
    const mark = event.target instanceof Element ? event.target.closest("mark[data-mica-highlight-id]") : null;
    if (!mark || !["Delete", "Backspace"].includes(event.key)) return;
    event.preventDefault();
    void removeHighlightById(mark.getAttribute("data-mica-highlight-id"));
  }

  function showSelectionAffordance() {
    dismissAffordance();
    const selection = getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return recordFixtureSelection("selection_unavailable");
    const range = selection.getRangeAt(0);
    const answer = commonAnswer(range);
    if (!answer || range.toString().trim().length < 1) return recordFixtureSelection("answer_or_text_unavailable");
    const anchor = createAnchor(answer, range);
    if (!anchor) return recordFixtureSelection("anchor_unavailable");
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return recordFixtureSelection("geometry_unavailable");
    const button = createAffordance("Highlight", async () => {
      records.push(anchor);
      await saveRecords(records);
      let rendered = false;
      let error = null;
      try {
        rendered = renderAnchor(anchor);
      } catch (renderError) {
        error = String(renderError?.name || renderError || "render_error");
      }
      recordFixtureOutcome({ rendered, error });
      if (affordance === button) selection.removeAllRanges();
      dismissAffordance(button);
      dispatchUpdate();
    });
    affordance = button;
    positionAffordance(button, rect);
    recordFixtureSelection("ready");
  }

  function showRemoveAffordance(mark) {
    dismissAffordance();
    const id = mark.getAttribute("data-mica-highlight-id");
    const rect = mark.getBoundingClientRect();
    const button = createAffordance("Remove highlight", async () => {
      records = records.filter((record) => record.id !== id);
      await saveRecords(records);
      unwrapHighlight(id);
      dismissAffordance(button);
      dispatchUpdate();
    });
    affordance = button;
    positionAffordance(button, rect);
  }

  function createAffordance(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.micaUi = "highlight-affordance";
    button.className = "mica-highlight-affordance";
    button.textContent = label;
    button.addEventListener("click", action, { once: true });
    document.body.append(button);
    return button;
  }

  function positionAffordance(button, rect) {
    const width = Math.max(110, button.getBoundingClientRect().width);
    const left = Math.min(innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2));
    const top = rect.top >= 46 ? rect.top - 38 : Math.min(innerHeight - 38, rect.bottom + 8);
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
  }

  function createAnchor(answer, range) {
    const nodes = textNodes(answer);
    if (!nodes.length) return null;
    const start = absoluteOffset(nodes, range.startContainer, range.startOffset);
    const end = absoluteOffset(nodes, range.endContainer, range.endOffset);
    if (start < 0 || end <= start) return null;
    const fullText = nodes.map((node) => node.nodeValue || "").join("");
    const quote = fullText.slice(start, end);
    if (!quote.trim()) return null;
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `mica-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      turnId: turnIdentity(answer),
      quote,
      prefix: fullText.slice(Math.max(0, start - 32), start),
      suffix: fullText.slice(end, end + 32),
      start,
      end,
      createdAt: new Date().toISOString()
    };
  }

  function restoreHighlights() {
    if (!enabled) return;
    if (activeStorageKey !== storageKey()) {
      scheduleContextRestore();
      return;
    }
    for (const record of records) {
      if (document.querySelector(`mark[data-mica-highlight-id='${cssEscape(record.id)}']`)) continue;
      renderAnchor(record);
    }
  }

  function renderAnchor(record) {
    const answer = findAnswer(record.turnId);
    if (!answer || isStreamingAnswer(answer)) return false;
    const nodes = textNodes(answer);
    const fullText = nodes.map((node) => node.nodeValue || "").join("");
    const position = resolveAnchorPosition(record, fullText);
    if (position < 0) return false;
    wrapTextRange(nodes, position, position + record.quote.length, record.id);
    return true;
  }

  function resolveAnchorPosition(record, fullText) {
    if (fullText.slice(record.start, record.end) === record.quote && contextsMatch(record, fullText, record.start)) return record.start;
    const matches = [];
    let cursor = 0;
    while ((cursor = fullText.indexOf(record.quote, cursor)) >= 0) {
      if (contextsMatch(record, fullText, cursor)) matches.push(cursor);
      cursor += Math.max(1, record.quote.length);
    }
    return matches.length === 1 ? matches[0] : -1;
  }

  function contextsMatch(record, text, start) {
    const prefix = text.slice(Math.max(0, start - record.prefix.length), start);
    const suffix = text.slice(start + record.quote.length, start + record.quote.length + record.suffix.length);
    return prefix === record.prefix && suffix === record.suffix;
  }

  function wrapTextRange(nodes, start, end, id) {
    let cursor = 0;
    const segments = [];
    for (const node of nodes) {
      const length = node.nodeValue?.length || 0;
      const from = Math.max(0, start - cursor);
      const to = Math.min(length, end - cursor);
      if (from < to) segments.push({ node, from, to });
      cursor += length;
      if (cursor >= end) break;
    }
    for (const segment of segments.reverse()) {
      const range = document.createRange();
      range.setStart(segment.node, segment.from);
      range.setEnd(segment.node, segment.to);
      const mark = document.createElement("mark");
      mark.dataset.micaHighlightId = id;
      mark.className = "mica-highlight";
      mark.tabIndex = 0;
      mark.setAttribute("aria-label", "Highlighted text. Press Delete to remove highlight.");
      range.surroundContents(mark);
    }
  }

  function unwrapHighlight(id) {
    document.querySelectorAll(`mark[data-mica-highlight-id='${cssEscape(id)}']`).forEach((mark) => mark.replaceWith(...mark.childNodes));
  }

  function removeRenderedHighlights() {
    document.querySelectorAll("mark[data-mica-highlight-id]").forEach((mark) => mark.replaceWith(...mark.childNodes));
  }

  function commonAnswer(range) {
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startAnswer = start?.closest?.(ANSWER_SELECTOR);
    const endAnswer = end?.closest?.(ANSWER_SELECTOR);
    return startAnswer && startAnswer === endAnswer ? startAnswer : null;
  }

  function textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
        return node.parentElement?.closest(UI_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function absoluteOffset(nodes, container, offset) {
    let total = 0;
    for (const node of nodes) {
      if (node === container) return total + offset;
      if (container.nodeType === Node.ELEMENT_NODE && container.contains(node)) {
        const range = document.createRange();
        range.setStart(container, 0);
        range.setEnd(container, Math.min(offset, container.childNodes.length));
        return total + range.toString().length;
      }
      total += node.nodeValue?.length || 0;
    }
    return -1;
  }

  function turnIdentity(answer) {
    const turn = answer.closest("[data-turn-id], [data-testid^='conversation-turn-']") || answer;
    const explicit = turn.getAttribute("data-turn-id") || turn.getAttribute("data-testid") || turn.id;
    if (explicit) return explicit;
    const all = Array.from(document.querySelectorAll(ANSWER_SELECTOR));
    return `assistant:${all.indexOf(answer)}:${fingerprint(answer.textContent || "")}`;
  }

  function findAnswer(id) {
    const exact = Array.from(document.querySelectorAll("[data-turn-id], [data-testid^='conversation-turn-']")).find((turn) =>
      [turn.getAttribute("data-turn-id"), turn.getAttribute("data-testid"), turn.id].includes(id)
    );
    if (exact) return exact.querySelector(ANSWER_SELECTOR) || (exact.matches(ANSWER_SELECTOR) ? exact : null);
    if (!id.startsWith("assistant:")) return null;
    const [, indexText, hash] = id.split(":");
    const answer = Array.from(document.querySelectorAll(ANSWER_SELECTOR))[Number(indexText)];
    return answer && fingerprint(answer.textContent || "") === hash ? answer : null;
  }

  function isStreamingAnswer(answer) {
    return !!answer.closest("[data-is-streaming='true']") || !!answer.querySelector("[data-is-streaming='true']");
  }

  function isComposerTarget(target) {
    return target instanceof Element && !!target.closest("textarea, input, [contenteditable='true'], form");
  }

  function storageKey() {
    return `${STORAGE_PREFIX}${encodeURIComponent(`${location.origin}${location.pathname}`)}`;
  }

  function loadRecords(key = activeStorageKey || storageKey()) {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve([]);
      storage.get({ [key]: [] }, (items) => resolve(Array.isArray(items[key]) ? items[key] : []));
    });
  }

  function saveRecords(next) {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve();
      const key = activeStorageKey;
      if (!key || key !== storageKey()) return resolve();
      storage.set({ [key]: next }, resolve);
    });
  }

  function scheduleContextRestore() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => requestIdle(() => void switchPageContext()), 220);
  }

  async function switchPageContext(force = false) {
    const nextKey = storageKey();
    if (!force && activeStorageKey === nextKey) {
      restoreHighlights();
      return;
    }
    const generation = ++contextGeneration;
    dismissAffordance();
    removeRenderedHighlights();
    records = [];
    activeStorageKey = nextKey;
    const nextRecords = await loadRecords(nextKey);
    if (generation !== contextGeneration || activeStorageKey !== nextKey || storageKey() !== nextKey) return;
    records = nextRecords;
    restoreHighlights();
    dispatchUpdate();
  }

  function isIgnoredMutation(mutation) {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    return !!target?.closest?.("[data-mica-ui], mark[data-mica-highlight-id], form, textarea, input, [contenteditable='true']");
  }

  async function removeHighlightById(id) {
    if (!id) return;
    records = records.filter((record) => record.id !== id);
    await saveRecords(records);
    unwrapHighlight(id);
    dismissAffordance();
    dispatchUpdate();
  }

  function dismissAffordance(target = affordance) {
    target?.remove();
    if (affordance === target) affordance = null;
  }

  function requestIdle(callback) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(callback, { timeout: 500 });
    else setTimeout(callback, 0);
  }

  function snapshot() {
    return { enabled, count: records.length, rendered: new Set(Array.from(document.querySelectorAll("mark[data-mica-highlight-id]"), (mark) => mark.dataset.micaHighlightId)).size, contentUpload: false };
  }

  function dispatchUpdate() {
    globalThis.dispatchEvent?.(new CustomEvent("mica:highlights-updated", { detail: snapshot() }));
  }

  function recordFixtureOutcome(outcome) {
    if (document.documentElement.dataset.micaFixture !== "true") return;
    document.documentElement.dataset.micaHighlightOutcome = JSON.stringify(outcome);
  }

  function recordFixtureSelection(outcome) {
    if (document.documentElement.dataset.micaFixture !== "true") return;
    document.documentElement.dataset.micaHighlightSelection = outcome;
  }

  function fingerprint(value) {
    let hash = 2166136261;
    for (const char of String(value).replace(/\s+/g, " ").trim()) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function cssEscape(value) {
    return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/['\\]/g, "\\$&");
  }

  globalThis.MicaHighlighter = { configure, snapshot, restoreHighlights, resolveAnchorPosition, createAnchor, removeHighlight: removeHighlightById };
})();
