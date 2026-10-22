(() => {
  const model = globalThis.MicaGeneralWebHighlightModel;
  const settingsModel = globalThis.MicaSettingsModel;
  const SETTINGS_KEY = settingsModel?.storageKey || "micaSettings";
  const STORE_KEY = model?.storeKey || "micaGeneralWebHighlightsV1";
  const HIGHLIGHT_NAMES = Object.freeze({
    yellow: "mica-web-yellow",
    mint: "mica-web-mint",
    blue: "mica-web-blue",
    pink: "mica-web-pink"
  });
  const EXCLUDED = "script,style,noscript,template,input,textarea,select,option,button,[contenteditable='true'],[role='textbox'],[aria-hidden='true'],[data-mica-ui]";
  let settings = settingsModel?.defaults?.() || null;
  let records = [];
  let active = false;
  let toolbarHost = null;
  let selectedRecordId = null;
  let pendingSelectionFrame = 0;
  let pendingRenderHandle = 0;
  let pendingRenderKind = null;
  let pageObserver = null;
  let shortcut = parseShortcut("Alt+Shift+H");
  let resolvedById = new Map();

  if (!model || !settingsModel || !globalThis.CSS?.highlights || typeof globalThis.Highlight !== "function") return;
  if (["chatgpt.com", "chat.openai.com"].includes(location.hostname)) return;

  chrome.storage.onChanged.addListener(handleStorageChanged);
  chrome.storage.local.get({ [SETTINGS_KEY]: null, [STORE_KEY]: [] }, (items) => {
    settings = settingsModel.fromStorage(items || {});
    records = model.sanitizeRecords(items?.[STORE_KEY]);
    reconcileActivation();
  });

  function handleStorageChanged(changes, area) {
    if (area !== "local") return;
    if (SETTINGS_KEY in changes) settings = settingsModel.fromStorage({ [SETTINGS_KEY]: changes[SETTINGS_KEY].newValue });
    if (STORE_KEY in changes) records = model.sanitizeRecords(changes[STORE_KEY].newValue);
    reconcileActivation();
    if (active) renderHighlights();
  }

  function reconcileActivation() {
    const originAllowed = settings?.highlighter?.generalWebOrigins?.includes(location.origin);
    const shouldActivate = !!(settings?.enabled && settings?.features?.generalWebHighlighter && settings?.highlighter?.generalWebEnabled && originAllowed);
    shortcut = parseShortcut(settings?.highlighter?.shortcut || "Alt+Shift+H");
    if (shouldActivate && !active) activate();
    if (!shouldActivate && active) deactivate();
  }

  function activate() {
    active = true;
    installHighlightStyle();
    document.addEventListener("mouseup", scheduleSelectionToolbar, true);
    document.addEventListener("click", handlePageClick, true);
    document.addEventListener("keydown", handleShortcutKeydown, true);
    globalThis.addEventListener("pagehide", hideToolbar, { capture: true });
    globalThis.addEventListener("popstate", scheduleRender, true);
    globalThis.addEventListener("hashchange", scheduleRender, true);
    pageObserver = new MutationObserver(scheduleRender);
    pageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderHighlights();
  }

  function deactivate() {
    active = false;
    document.removeEventListener("mouseup", scheduleSelectionToolbar, true);
    document.removeEventListener("click", handlePageClick, true);
    document.removeEventListener("keydown", handleShortcutKeydown, true);
    globalThis.removeEventListener("pagehide", hideToolbar, true);
    globalThis.removeEventListener("popstate", scheduleRender, true);
    globalThis.removeEventListener("hashchange", scheduleRender, true);
    pageObserver?.disconnect();
    pageObserver = null;
    if (pendingSelectionFrame) cancelAnimationFrame(pendingSelectionFrame);
    pendingSelectionFrame = 0;
    cancelScheduledRender();
    hideToolbar();
    clearCustomHighlights();
    document.getElementById("mica-general-web-highlight-style")?.remove();
  }

  function handleShortcutKeydown(event) {
    if (!active || event.defaultPrevented || isEditableTarget(event.target)) return;
    if (!shortcut || event.key.toLowerCase() !== shortcut.key || event.altKey !== shortcut.alt || event.ctrlKey !== shortcut.ctrl || event.metaKey !== shortcut.meta || event.shiftKey !== shortcut.shift) return;
    requestAnimationFrame(showToolbarForSelection);
  }

  function scheduleSelectionToolbar(event) {
    if (!active || event.button !== 0 || event.target?.closest?.("[data-mica-ui]")) return;
    if (pendingSelectionFrame) cancelAnimationFrame(pendingSelectionFrame);
    pendingSelectionFrame = requestAnimationFrame(() => {
      pendingSelectionFrame = 0;
      showToolbarForSelection();
    });
  }

  function showToolbarForSelection() {
    const snapshot = captureSelection();
    if (!snapshot) return hideToolbar();
    selectedRecordId = findOverlappingRecord(snapshot)?.id || null;
    const rect = snapshot.range.getBoundingClientRect();
    showToolbar(rect.left + rect.width / 2, rect.bottom + 8, selectedRecordId);
  }

  function handlePageClick(event) {
    if (!active || resolvedById.size === 0 || event.target?.closest?.("[data-mica-ui]")) return;
    const hit = findRecordAtPoint(event.clientX, event.clientY);
    if (!hit) return;
    selectedRecordId = hit.record.id;
    showToolbar(event.clientX, event.clientY + 10, true);
  }

  function captureSelection() {
    const selection = globalThis.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (range.startContainer.nodeType !== Node.TEXT_NODE || range.endContainer.nodeType !== Node.TEXT_NODE) return null;
    const root = findSemanticRoot(range.commonAncestorContainer);
    if (!root || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const indexed = indexRoot(root);
    if (!indexed) return null;
    const start = boundaryOffset(indexed.nodes, range.startContainer, range.startOffset);
    const end = boundaryOffset(indexed.nodes, range.endContainer, range.endOffset);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    return { range, root, rootKey: semanticRootKey(root), text: indexed.text, start, end, pageKey: model.normalizePageKey(location.href) };
  }

  function findOverlappingRecord(snapshot) {
    for (const record of model.recordsForPage(records, snapshot.pageKey)) {
      if (record.anchor.rootKey !== snapshot.rootKey) continue;
      const resolution = model.resolveRecord(record, snapshot);
      if (resolution.status === "resolved" && resolution.start < snapshot.end && resolution.end > snapshot.start) return record;
    }
    return null;
  }

  function findRecordAtPoint(x, y) {
    const caret = document.caretPositionFromPoint?.(x, y);
    const fallback = !caret ? document.caretRangeFromPoint?.(x, y) : null;
    const node = caret?.offsetNode || fallback?.startContainer;
    const offset = caret?.offset ?? fallback?.startOffset;
    if (!node || node.nodeType !== Node.TEXT_NODE || !Number.isInteger(offset)) return null;
    const root = findSemanticRoot(node);
    const indexed = root ? indexRoot(root) : null;
    if (!indexed) return null;
    const point = boundaryOffset(indexed.nodes, node, offset);
    const rootKey = semanticRootKey(root);
    for (const [id, value] of resolvedById) {
      if (value.rootKey === rootKey && point >= value.start && point <= value.end) {
        const record = records.find((candidate) => candidate.id === id);
        if (record) return { record, resolution: value };
      }
    }
    return null;
  }

  function renderHighlights() {
    clearCustomHighlights();
    resolvedById = new Map();
    const rangesByColor = Object.fromEntries(model.colors.map((color) => [color, []]));
    const roots = new Map();
    const next = [...records];
    let recordsChanged = false;
    for (const record of model.recordsForPage(records, location.href)) {
      if (!roots.has(record.anchor.rootKey)) {
        const root = findRootByKey(record.anchor.rootKey);
        roots.set(record.anchor.rootKey, root ? indexRoot(root) : null);
      }
      const indexed = roots.get(record.anchor.rootKey);
      const resolution = indexed
        ? model.resolveRecord(record, { pageKey: location.href, rootKey: record.anchor.rootKey, text: indexed.text })
        : { status: "unresolved", reason: "root_missing" };
      const updated = model.withResolution(record, resolution);
      if (updated && updated !== record) {
        const index = next.findIndex((candidate) => candidate.id === record.id);
        if (index >= 0) next[index] = updated;
        recordsChanged = true;
      }
      if (resolution.status !== "resolved" || !indexed) continue;
      const range = rangeFromOffsets(indexed.nodes, resolution.start, resolution.end);
      if (!range) continue;
      rangesByColor[record.color].push(range);
      resolvedById.set(record.id, { ...resolution, rootKey: record.anchor.rootKey, range });
    }
    for (const color of model.colors) {
      if (rangesByColor[color].length) CSS.highlights.set(HIGHLIGHT_NAMES[color], new Highlight(...rangesByColor[color]));
    }
    if (recordsChanged) {
      records = model.sanitizeRecords(next);
      void persistRecords();
    }
  }

  function scheduleRender() {
    if (!active || pendingRenderHandle) return;
    if (typeof globalThis.requestIdleCallback === "function") {
      pendingRenderKind = "idle";
      pendingRenderHandle = globalThis.requestIdleCallback(runScheduledRender, { timeout: 500 });
    } else {
      pendingRenderKind = "timeout";
      pendingRenderHandle = globalThis.setTimeout(runScheduledRender, 100);
    }
  }

  function runScheduledRender() {
    pendingRenderHandle = 0;
    pendingRenderKind = null;
    if (active) renderHighlights();
  }

  function cancelScheduledRender() {
    if (!pendingRenderHandle) return;
    if (pendingRenderKind === "idle") globalThis.cancelIdleCallback?.(pendingRenderHandle);
    else globalThis.clearTimeout(pendingRenderHandle);
    pendingRenderHandle = 0;
    pendingRenderKind = null;
  }

  async function applyColor(color) {
    if (!model.colors.includes(color)) return;
    if (selectedRecordId) {
      records = records.map((record) => record.id === selectedRecordId ? model.withColor(record, color) || record : record);
    } else {
      const snapshot = captureSelection();
      if (!snapshot) return hideToolbar();
      const record = model.createRecord({ ...snapshot, color });
      if (!record) return hideToolbar();
      records = model.mergeRecords(records, [record]);
      selectedRecordId = record.id;
    }
    await persistRecords();
    renderHighlights();
    hideToolbar();
  }

  async function deleteSelected() {
    if (!selectedRecordId) return;
    records = records.filter((record) => record.id !== selectedRecordId);
    await persistRecords();
    renderHighlights();
    hideToolbar();
  }

  async function clearPage() {
    const pageKey = model.normalizePageKey(location.href);
    if (!globalThis.confirm("Clear all Mica highlights on this page?")) return;
    records = records.filter((record) => record.anchor.pageKey !== pageKey);
    await persistRecords();
    renderHighlights();
    hideToolbar();
  }

  function persistRecords() {
    return new Promise((resolve) => chrome.storage.local.set({ [STORE_KEY]: model.sanitizeRecords(records) }, resolve));
  }

  function showToolbar(x, y, editing) {
    hideToolbar();
    toolbarHost = document.createElement("div");
    toolbarHost.dataset.micaUi = "general-web-highlight-toolbar";
    toolbarHost.style.cssText = `all:initial;position:fixed;left:${Math.max(8, Math.round(x))}px;top:${Math.max(8, Math.round(y))}px;z-index:2147483647;transform:translateX(-50%)`;
    const shadow = toolbarHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host{color-scheme:light dark}.bar{display:flex;gap:6px;align-items:center;padding:7px;background:#17201e;color:#fff;border:1px solid #40504b;border-radius:10px;box-shadow:0 6px 24px #0005;font:12px/1.2 system-ui,sans-serif}.swatch,.action{height:28px;border:1px solid #ffffff66;border-radius:7px;cursor:pointer}.swatch{width:28px}.action{padding:0 9px;background:#27332f;color:#fff}.yellow{background:#f8df6a}.mint{background:#86deb9}.blue{background:#8fc8ff}.pink{background:#f3a6c8}";
    const bar = document.createElement("div");
    bar.className = "bar";
    for (const color of model.colors) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `swatch ${color}`;
      button.title = `${editing ? "Change to" : "Highlight"} ${color}`;
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", () => { void applyColor(color); });
      bar.append(button);
    }
    if (editing) bar.append(actionButton("Delete", deleteSelected));
    bar.append(actionButton("Clear page", clearPage));
    shadow.append(style, bar);
    document.documentElement.append(toolbarHost);
  }

  function actionButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action";
    button.textContent = label;
    button.addEventListener("click", () => { void action(); });
    return button;
  }

  function hideToolbar() {
    toolbarHost?.remove();
    toolbarHost = null;
    selectedRecordId = null;
  }

  function installHighlightStyle() {
    if (document.getElementById("mica-general-web-highlight-style")) return;
    const style = document.createElement("style");
    style.id = "mica-general-web-highlight-style";
    style.dataset.micaUi = "general-web-highlight-style";
    style.textContent = "::highlight(mica-web-yellow){background:#f8df6a99;color:inherit}::highlight(mica-web-mint){background:#86deb999;color:inherit}::highlight(mica-web-blue){background:#8fc8ff99;color:inherit}::highlight(mica-web-pink){background:#f3a6c899;color:inherit}";
    document.documentElement.append(style);
  }

  function clearCustomHighlights() {
    for (const name of Object.values(HIGHLIGHT_NAMES)) CSS.highlights.delete(name);
  }

  function findSemanticRoot(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest?.("article,main,[role='article'],[role='main']") || document.body;
  }

  function semanticRootKey(root) {
    if (root === document.body) return "body";
    if (root.id && /^[A-Za-z][\w:.-]{0,127}$/.test(root.id) && document.querySelectorAll(`#${CSS.escape(root.id)}`).length === 1) return `id:${root.id}`;
    const role = root.getAttribute("role");
    if (["main", "article"].includes(role)) return `role:${role}:${indexAmong(document.querySelectorAll(`[role='${role}']`), root)}`;
    const tag = root.tagName.toLowerCase();
    if (["main", "article"].includes(tag)) return `tag:${tag}:${indexAmong(document.querySelectorAll(tag), root)}`;
    return "body";
  }

  function findRootByKey(key) {
    if (key === "body") return document.body;
    if (key.startsWith("id:")) return document.getElementById(key.slice(3));
    const match = /^(role|tag):(main|article):(\d+)$/.exec(key);
    if (!match) return null;
    const list = match[1] === "role" ? document.querySelectorAll(`[role='${match[2]}']`) : document.querySelectorAll(match[2]);
    return list[Number(match[3])] || null;
  }

  function indexRoot(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.data || node.parentElement?.closest?.(EXCLUDED)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let text = "";
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start: text.length, end: text.length + walker.currentNode.data.length });
      text += walker.currentNode.data;
      if (text.length > model.maxPageText) return null;
    }
    return { nodes, text };
  }

  function boundaryOffset(nodes, target, offset) {
    const entry = nodes.find((candidate) => candidate.node === target);
    return entry && offset >= 0 && offset <= target.data.length ? entry.start + offset : null;
  }

  function rangeFromOffsets(nodes, start, end) {
    const first = nodes.find((entry) => start >= entry.start && start <= entry.end);
    const last = [...nodes].reverse().find((entry) => end >= entry.start && end <= entry.end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }

  function indexAmong(list, target) {
    return Math.max(0, Array.prototype.indexOf.call(list, target));
  }

  function parseShortcut(value) {
    const parts = String(value || "").split("+").map((part) => part.trim()).filter(Boolean);
    const key = parts.at(-1)?.toLowerCase();
    if (!key || key.length !== 1) return null;
    return { key, alt: parts.includes("Alt"), ctrl: parts.includes("Ctrl"), meta: parts.includes("Meta"), shift: parts.includes("Shift") };
  }

  function isEditableTarget(target) {
    return !!target?.closest?.("input,textarea,select,[contenteditable='true'],[role='textbox']");
  }
})();
