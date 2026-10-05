(() => {
  const MAX_EVENTS = 80;
  const COMPOSER_SELECTOR = "textarea#mobile-composer-prompt, textarea, [contenteditable='true'][role='textbox']";
  let session = null;
  let observer = null;
  let captureTimer = 0;
  const nodeIds = new WeakMap();
  let nextNodeId = 1;

  globalThis.chrome?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "MICA_CURRENT_UI_CHECK_PING") {
      sendResponse({ supported: location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com" || document.documentElement.dataset.micaFixture === "true" });
      return true;
    }
    if (message.type === "MICA_CURRENT_UI_CHECK_START") {
      sendResponse(startCheck());
      return true;
    }
    if (message.type === "MICA_CURRENT_UI_CHECK_STATUS") {
      sendResponse({ active: !!session, startedAt: session?.startedAt || null, eventCount: session?.events.length || 0 });
      return true;
    }
    if (message.type === "MICA_CURRENT_UI_CHECK_STOP") {
      sendResponse(stopCheck());
      return true;
    }
    return false;
  });

  function startCheck() {
    if (session) return { ok: true, active: true, startedAt: session.startedAt };
    session = {
      schemaVersion: 1,
      kind: "mica_current_ui_check",
      startedAt: new Date().toISOString(),
      location: { origin: location.origin, pathHash: fingerprint(location.pathname), pathLength: location.pathname.length },
      privacy: { promptText: false, answerText: false, requestData: false, contentUpload: false },
      events: [],
      snapshots: []
    };
    document.addEventListener("focusin", recordInputEvent, true);
    document.addEventListener("focusout", recordInputEvent, true);
    document.addEventListener("input", recordInputEvent, true);
    document.addEventListener("compositionstart", recordInputEvent, true);
    document.addEventListener("compositionend", recordInputEvent, true);
    document.addEventListener("submit", recordSubmit, true);
    observer = new MutationObserver((mutations) => {
      if (!session || !mutations.some((mutation) => mutation.type === "childList" && (mutation.addedNodes.length || mutation.removedNodes.length))) return;
      scheduleCapture("structure_change");
    });
    observer.observe(document.documentElement, { subtree: true, childList: true });
    capture("start");
    return { ok: true, active: true, startedAt: session.startedAt };
  }

  function stopCheck() {
    if (!session) return { ok: false, reason: "not_active" };
    capture("stop");
    const completed = session;
    completed.stoppedAt = new Date().toISOString();
    completed.summary = buildSummary(completed);
    cleanup();
    session = null;
    return { ok: true, report: completed };
  }

  function cleanup() {
    clearTimeout(captureTimer);
    observer?.disconnect();
    observer = null;
    document.removeEventListener("focusin", recordInputEvent, true);
    document.removeEventListener("focusout", recordInputEvent, true);
    document.removeEventListener("input", recordInputEvent, true);
    document.removeEventListener("compositionstart", recordInputEvent, true);
    document.removeEventListener("compositionend", recordInputEvent, true);
    document.removeEventListener("submit", recordSubmit, true);
  }

  function recordInputEvent(event) {
    if (!session || !(event.target instanceof Element) || !event.target.matches(COMPOSER_SELECTOR)) return;
    const value = composerValue(event.target);
    pushEvent({ type: event.type, composerId: elementIdentity(event.target), length: value.length, focused: document.activeElement === event.target });
  }

  function recordSubmit(event) {
    if (!session || !(event.target instanceof HTMLFormElement) || !event.target.querySelector(COMPOSER_SELECTOR)) return;
    pushEvent({ type: "form_submit", composerId: elementIdentity(event.target.querySelector(COMPOSER_SELECTOR)) });
    scheduleCapture("submit");
  }

  function scheduleCapture(reason) {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => capture(reason), 180);
  }

  function capture(reason) {
    if (!session) return;
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const copyButtons = Array.from(document.querySelectorAll("button, [role='button']")).filter((node) => /(^|\b)(copy|复制)(\b|$)/i.test(node.getAttribute("aria-label") || ""));
    const turnNodes = Array.from(document.querySelectorAll("[data-turn-id], [data-testid^='conversation-turn-']"));
    const snapshot = {
      at: new Date().toISOString(),
      reason,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      theme: { dark: matchMedia("(prefers-color-scheme: dark)").matches, colorScheme: getComputedStyle(document.documentElement).colorScheme || null },
      composer: describeComposer(composer),
      nativeCopyCandidates: copyButtons.slice(-8).map(describeActionCluster),
      turns: { count: turnNodes.length, identities: turnNodes.slice(-8).map(turnIdentity) },
      assistantCount: document.querySelectorAll("[data-message-author-role='assistant']").length,
      userCount: document.querySelectorAll("[data-message-author-role='user']").length,
      streamingSignals: document.querySelectorAll("[data-is-streaming='true'], [aria-label*='Stop'], [data-testid*='stop']").length,
      alerts: document.querySelectorAll("[role='alert']").length,
      dialogs: document.querySelectorAll("[role='dialog'], dialog[open]").length,
      connectorSignals: countConnectorSignals()
    };
    const previous = session.snapshots.at(-1);
    if (!previous || JSON.stringify(withoutTimestamp(previous)) !== JSON.stringify(withoutTimestamp(snapshot))) {
      session.snapshots.push(snapshot);
      if (session.snapshots.length > 24) session.snapshots.shift();
    }
  }

  function describeComposer(composer) {
    if (!(composer instanceof Element)) return null;
    const rect = composer.getBoundingClientRect();
    return {
      identity: elementIdentity(composer),
      tag: composer.tagName.toLowerCase(),
      role: composer.getAttribute("role"),
      ariaLabel: structuralLabel(composer.getAttribute("aria-label")),
      valueSource: composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement ? "property" : composer.isContentEditable ? "contenteditable" : "unknown",
      length: composerValue(composer).length,
      focused: document.activeElement === composer,
      connected: composer.isConnected,
      disabled: "disabled" in composer ? !!composer.disabled : false,
      rect: roundedRect(rect)
    };
  }

  function describeActionCluster(button) {
    const parent = button.parentElement;
    return {
      button: { identity: elementIdentity(button), ariaLabel: structuralLabel(button.getAttribute("aria-label")), rect: roundedRect(button.getBoundingClientRect()) },
      parent: parent ? { tag: parent.tagName.toLowerCase(), role: parent.getAttribute("role"), childCount: parent.children.length, rect: roundedRect(parent.getBoundingClientRect()) } : null,
      siblings: parent ? Array.from(parent.children).slice(0, 12).map((node, index) => ({ index, tag: node.tagName.toLowerCase(), role: node.getAttribute("role"), ariaLabel: structuralLabel(node.getAttribute("aria-label")), testId: structuralLabel(node.getAttribute("data-testid")) })) : []
    };
  }

  function countConnectorSignals() {
    let count = 0;
    for (const node of document.querySelectorAll("[data-testid], [aria-label], [role='option']")) {
      const signal = `${node.getAttribute("data-testid") || ""} ${node.getAttribute("aria-label") || ""}`;
      if (/connector|mention|github|drive|onedrive|sharepoint/i.test(signal)) count += 1;
    }
    return count;
  }

  function turnIdentity(node) {
    return {
      turnId: structuralLabel(node.getAttribute("data-turn-id")),
      testId: structuralLabel(node.getAttribute("data-testid")),
      idHash: node.id ? fingerprint(node.id) : null,
      assistant: !!node.querySelector("[data-message-author-role='assistant']"),
      user: !!node.querySelector("[data-message-author-role='user']")
    };
  }

  function buildSummary(report) {
    const composers = new Set(report.snapshots.map((snapshot) => snapshot.composer?.identity).filter(Boolean));
    return {
      snapshotCount: report.snapshots.length,
      eventCount: report.events.length,
      composerIdentityCount: composers.size,
      composerRemounted: composers.size > 1,
      actionClusterObserved: report.snapshots.some((snapshot) => snapshot.nativeCopyCandidates.length > 0),
      connectorSignalObserved: report.snapshots.some((snapshot) => snapshot.connectorSignals > 0),
      streamingObserved: report.snapshots.some((snapshot) => snapshot.streamingSignals > 0)
    };
  }

  function pushEvent(event) {
    session.events.push({ at: new Date().toISOString(), ...event });
    if (session.events.length > MAX_EVENTS) session.events.shift();
  }

  function composerValue(node) {
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value || "";
    return node.isContentEditable ? node.innerText || "" : "";
  }

  function elementIdentity(node) {
    if (!(node instanceof Element)) return null;
    if (!nodeIds.has(node)) nodeIds.set(node, nextNodeId++);
    return `node-${nodeIds.get(node)}:${node.tagName.toLowerCase()}:${node.id || "-"}:${node.getAttribute("data-testid") || "-"}:${node.getAttribute("role") || "-"}`;
  }

  function structuralLabel(value) {
    if (!value) return null;
    return String(value).replace(/\s+/g, " ").trim().slice(0, 96);
  }

  function roundedRect(rect) {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  }

  function withoutTimestamp(value) {
    const copy = { ...value };
    delete copy.at;
    delete copy.reason;
    return copy;
  }

  function fingerprint(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
})();
