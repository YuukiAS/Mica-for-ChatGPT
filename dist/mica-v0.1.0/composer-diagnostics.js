(() => {
  const GLOBAL_KEY = "MicaComposerDiagnostics";
  const SESSION_VERSION = "composer-guided-diagnostics.v1";
  const SAMPLE_INTERVAL_MS = 150;
  const PANEL_MARGIN = 12;
  const steps = [
    {
      id: "normal-delete",
      title: "Step 1: normal delete",
      instruction: "Type abc test in the composer, then press Ctrl+A and Delete. Do not send."
    },
    {
      id: "mention-delete",
      title: "Step 2: GitHub mention delete",
      instruction: "Type @GitHub, choose GitHub from ChatGPT's candidates yourself, then press Ctrl+A and Delete. Do not send."
    },
    {
      id: "manual-send",
      title: "Step 3: manual send",
      instruction: "Type one very short test message and click Send yourself. Mica will not send it for you."
    },
    {
      id: "complete",
      title: "Step 4: report",
      instruction: "Review the summary and copy the privacy-safe report."
    }
  ];

  const defaultBridge = {
    getRuntimeSnapshot: () => ({}),
    countMountedTurns: () => countMountedTurns(),
    countUserTurns: () => countUserTurns()
  };

  let bridge = { ...defaultBridge };
  let session = null;
  let lastReport = null;
  let panelHost = null;
  let panelRoot = null;

  function configure(nextBridge) {
    bridge = { ...bridge, ...(nextBridge || {}) };
  }

  function start() {
    stop({ keepPanel: false });
    session = createSession();
    ensurePanel();
    startSampler();
    sample();
    renderPanel();
    return summarize();
  }

  function nextStep() {
    if (!session) return summarize();
    sample();
    finishCurrentStep();
    session.stepIndex = Math.min(session.stepIndex + 1, steps.length - 1);
    startCurrentStep();
    if (getCurrentStep().id === "complete") {
      stopSampler();
      lastReport = buildReport();
    }
    renderPanel();
    return summarize();
  }

  function stop(options = {}) {
    if (session) {
      sample();
      finishCurrentStep();
      stopSampler();
      session.stoppedAt = Date.now();
      lastReport = buildReport();
      session = null;
    }
    if (!options.keepPanel) removePanel();
    return summarize();
  }

  function reset() {
    stop({ keepPanel: false });
    lastReport = null;
    return summarize();
  }

  function summarize() {
    return {
      available: true,
      running: !!session,
      samplerActive: !!session?.timer,
      stepId: session ? getCurrentStep().id : null,
      stepIndex: session ? session.stepIndex : null,
      stepCount: steps.length,
      sampleCount: session?.samples.length || 0,
      lastReport: lastReport ? summarizeReport(lastReport) : null
    };
  }

  function getReport() {
    if (session) {
      sample();
      lastReport = buildReport();
    }
    return lastReport;
  }

  function getReportText() {
    const report = getReport();
    return report ? JSON.stringify(report, null, 2) : "";
  }

  function getDebugState() {
    return {
      running: !!session,
      samplerActive: !!session?.timer,
      sampleCount: session?.samples.length || 0,
      panelVisible: !!panelHost,
      stepId: session ? getCurrentStep().id : null
    };
  }

  function createSession() {
    const now = Date.now();
    const next = {
      version: SESSION_VERSION,
      id: `${now}-${Math.random().toString(16).slice(2)}`,
      startedAt: now,
      stoppedAt: null,
      stepIndex: 0,
      timer: 0,
      ids: new WeakMap(),
      nextId: 1,
      samples: [],
      lastSampleKey: "",
      previousEditableId: null,
      previousRootId: null,
      steps: steps.map((step) => ({
        id: step.id,
        title: step.title,
        startedAt: null,
        endedAt: null,
        samples: 0,
        composerMissing: false,
        maxMissingDurationMs: 0,
        missingSince: 0,
        editableIdentityChanges: 0,
        rootIdentityChanges: 0,
        zeroTextSeen: false,
        nonZeroTextSeen: false,
        mentionSignalSeen: false,
        newUserTurnObserved: false,
        staleTextAfterUserTurn: false,
        startUserTurns: null,
        maxTextLengthAfterUserTurn: 0
      }))
    };
    next.steps[0].startedAt = now;
    return next;
  }

  function startSampler() {
    if (!session || session.timer) return;
    session.timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  }

  function stopSampler() {
    if (!session?.timer) return;
    clearInterval(session.timer);
    session.timer = 0;
  }

  function startCurrentStep() {
    const step = session?.steps[session.stepIndex];
    if (!step || step.startedAt) return;
    step.startedAt = Date.now();
    step.startUserTurns = safeCall(bridge.countUserTurns, 0);
  }

  function finishCurrentStep() {
    const step = session?.steps[session.stepIndex];
    if (!step || step.endedAt) return;
    if (step.missingSince) {
      step.maxMissingDurationMs = Math.max(step.maxMissingDurationMs, Date.now() - step.missingSince);
      step.missingSince = 0;
    }
    step.endedAt = Date.now();
  }

  function getCurrentStep() {
    return steps[session?.stepIndex || 0] || steps[0];
  }

  function sample() {
    if (!session) return null;
    const snapshot = readSnapshot();
    const keyState = { ...snapshot };
    delete keyState.ms;
    const key = JSON.stringify(keyState);
    if (key !== session.lastSampleKey) {
      session.lastSampleKey = key;
      session.samples.push(snapshot);
    }
    updateCurrentStep(snapshot);
    renderPanel();
    return snapshot;
  }

  function updateCurrentStep(snapshot) {
    const step = session?.steps[session.stepIndex];
    if (!step) return;
    if (step.startUserTurns === null) step.startUserTurns = snapshot.userTurns;
    step.samples += 1;
    if (!snapshot.exists) {
      step.composerMissing = true;
      if (!step.missingSince) step.missingSince = Date.now();
    } else if (step.missingSince) {
      step.maxMissingDurationMs = Math.max(step.maxMissingDurationMs, Date.now() - step.missingSince);
      step.missingSince = 0;
    }
    if (snapshot.textLength === 0) step.zeroTextSeen = true;
    if (snapshot.textLength > 0) step.nonZeroTextSeen = true;
    if (snapshot.hasMentionSignal) step.mentionSignalSeen = true;
    if (session.previousEditableId && snapshot.editableId && session.previousEditableId !== snapshot.editableId) {
      step.editableIdentityChanges += 1;
    }
    if (session.previousRootId && snapshot.rootId && session.previousRootId !== snapshot.rootId) {
      step.rootIdentityChanges += 1;
    }
    if (snapshot.editableId) session.previousEditableId = snapshot.editableId;
    if (snapshot.rootId) session.previousRootId = snapshot.rootId;
    if (snapshot.userTurns > (step.startUserTurns || 0)) {
      step.newUserTurnObserved = true;
      if (snapshot.textLength > 0) {
        step.staleTextAfterUserTurn = true;
        step.maxTextLengthAfterUserTurn = Math.max(step.maxTextLengthAfterUserTurn, snapshot.textLength);
      }
    }
  }

  function readSnapshot() {
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    const textLength = getComposerTextLength(editable);
    const runtime = safeCall(bridge.getRuntimeSnapshot, {});
    return {
      ms: Math.round(performance.now()),
      stepId: getCurrentStep().id,
      exists: !!editable,
      editableId: elementId(editable),
      rootId: elementId(root),
      tag: editable?.tagName?.toLowerCase() || null,
      role: editable?.getAttribute?.("role") || null,
      contenteditable: editable?.getAttribute?.("contenteditable") ?? null,
      testId: editable?.getAttribute?.("data-testid") || null,
      rootTag: root?.tagName?.toLowerCase() || null,
      rootTestId: root?.getAttribute?.("data-testid") || null,
      textLength,
      hasMentionSignal: hasMentionSignal(root),
      focused: !!editable && (document.activeElement === editable || editable.contains(document.activeElement)),
      mountedTurns: safeCall(bridge.countMountedTurns, countMountedTurns()),
      userTurns: safeCall(bridge.countUserTurns, countUserTurns()),
      micaStatus: runtime.status?.name || null,
      nativeSafeMode: !!runtime.runtime?.nativeSafeMode,
      documentMutationObserverActive: !!runtime.runtime?.documentMutationObserverActive,
      composerLifecycleListenersAttached: !!runtime.runtime?.composerLifecycleListenersAttached
    };
  }

  function buildReport() {
    if (!session) return lastReport;
    const runtime = safeCall(bridge.getRuntimeSnapshot, {});
    const stepReports = session.steps.map((step) => ({
      id: step.id,
      title: step.title,
      startedAt: step.startedAt ? new Date(step.startedAt).toISOString() : null,
      endedAt: step.endedAt ? new Date(step.endedAt).toISOString() : null,
      samples: step.samples,
      composerDisappeared: step.composerMissing,
      maxMissingDurationMs: Math.round(step.maxMissingDurationMs),
      editableIdentityChanges: step.editableIdentityChanges,
      rootIdentityChanges: step.rootIdentityChanges,
      zeroTextSeen: step.zeroTextSeen,
      nonZeroTextSeen: step.nonZeroTextSeen,
      mentionSignalSeen: step.mentionSignalSeen,
      newUserTurnObserved: step.newUserTurnObserved,
      staleTextAfterUserTurn: step.staleTextAfterUserTurn,
      maxTextLengthAfterUserTurn: step.maxTextLengthAfterUserTurn
    }));
    const maxMissingDurationMs = Math.max(0, ...stepReports.map((step) => step.maxMissingDurationMs));
    return {
      schemaVersion: 1,
      probe: SESSION_VERSION,
      generatedAt: new Date().toISOString(),
      privacy: {
        localOnly: true,
        telemetryUploaded: false,
        conversationTextIncluded: false,
        promptTextIncluded: false,
        answerTextIncluded: false,
        requestDataIncluded: false
      },
      page: {
        origin: location.origin,
        pathKind: runtime.page?.pathKind || getPathKind()
      },
      mica: {
        status: runtime.status || null,
        runtime: runtime.runtime || null,
        extension: runtime.extension || null
      },
      summary: {
        composerDisappearedDuringDelete: stepReports.slice(0, 2).some((step) => step.composerDisappeared),
        maxMissingDurationMs,
        editableIdentityChanges: stepReports.reduce((sum, step) => sum + step.editableIdentityChanges, 0),
        rootIdentityChanges: stepReports.reduce((sum, step) => sum + step.rootIdentityChanges, 0),
        normalDeleteTextCleared: !!stepReports[0]?.zeroTextSeen,
        mentionSignalObserved: !!stepReports[1]?.mentionSignalSeen,
        newUserTurnObserved: !!stepReports[2]?.newUserTurnObserved,
        staleTextAfterSend: !!stepReports[2]?.staleTextAfterUserTurn,
        runtimeNativeSafeMode: !!runtime.runtime?.nativeSafeMode
      },
      steps: stepReports,
      samples: session.samples.slice(-80)
    };
  }

  function summarizeReport(report) {
    return {
      generatedAt: report.generatedAt,
      probe: report.probe,
      summary: report.summary
    };
  }

  function ensurePanel() {
    if (panelHost) return;
    panelHost = document.createElement("div");
    panelHost.dataset.micaComposerDiagnosticsRoot = "true";
    panelHost.style.position = "fixed";
    panelHost.style.top = `${PANEL_MARGIN}px`;
    panelHost.style.right = `${PANEL_MARGIN}px`;
    panelHost.style.zIndex = "2147483645";
    panelHost.style.width = `min(360px, calc(100vw - ${PANEL_MARGIN * 2}px))`;
    panelHost.style.pointerEvents = "none";
    panelRoot = panelHost.attachShadow({ mode: "open" });
    document.documentElement.appendChild(panelHost);
  }

  function removePanel() {
    panelHost?.remove();
    panelHost = null;
    panelRoot = null;
  }

  function renderPanel() {
    if (!panelRoot || !session) return;
    const step = getCurrentStep();
    const report = getCurrentStep().id === "complete" ? (lastReport || buildReport()) : null;
    const summary = report?.summary || null;
    const nextLabel = step.id === "manual-send" ? "Finish" : "Next";
    panelRoot.innerHTML = `
<style>
  :host { all: initial; }
  .card {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid rgba(23, 23, 23, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.97);
    color: #171717;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
    font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    line-height: 1.25;
  }
  p {
    margin: 0;
  }
  .notice {
    color: #6b7280;
  }
  .summary {
    display: grid;
    gap: 4px;
    color: #374151;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button {
    min-height: 30px;
    padding: 5px 9px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #f9fafb;
    color: #111827;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: #f3f4f6; }
  @media (prefers-color-scheme: dark) {
    .card {
      border-color: rgba(255, 255, 255, 0.18);
      background: rgba(32, 33, 35, 0.96);
      color: #f7f7f8;
    }
    .notice,
    .summary { color: #d1d5db; }
    button {
      border-color: rgba(255, 255, 255, 0.2);
      background: #2f3033;
      color: #f7f7f8;
    }
    button:hover { background: #3a3b3f; }
  }
</style>
<section class="card" role="status" aria-live="polite">
  <h2>${escapeHtml(step.title)}</h2>
  <p>${escapeHtml(step.instruction)}</p>
  <p class="notice">Mica will not type, click connectors, send messages, retry, reload, or record prompt/answer text.</p>
  ${summary ? renderSummary(summary) : ""}
  <div class="actions">
    ${step.id === "complete" ? "" : `<button type="button" data-action="next">${escapeHtml(nextLabel)}</button>`}
    <button type="button" data-action="copy">Copy report</button>
    <button type="button" data-action="stop">Stop</button>
  </div>
</section>`;
    panelRoot.querySelector("[data-action='next']")?.addEventListener("click", nextStep);
    panelRoot.querySelector("[data-action='stop']")?.addEventListener("click", () => stop({ keepPanel: false }));
    panelRoot.querySelector("[data-action='copy']")?.addEventListener("click", copyReportFromPanel);
  }

  function renderSummary(summary) {
    return `
  <div class="summary">
    <div>Delete disappearance: ${summary.composerDisappearedDuringDelete ? "yes" : "no"}</div>
    <div>Max missing: ${Math.round(summary.maxMissingDurationMs)} ms</div>
    <div>Identity changes: ${summary.editableIdentityChanges}/${summary.rootIdentityChanges}</div>
    <div>New user turn: ${summary.newUserTurnObserved ? "yes" : "unknown"}</div>
    <div>Stale text after send: ${summary.staleTextAfterSend ? "yes" : "no"}</div>
    <div>Native-safe: ${summary.runtimeNativeSafeMode ? "yes" : "no"}</div>
  </div>`;
  }

  async function copyReportFromPanel() {
    const text = getReportText();
    if (!text || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      // Popup copy remains available if page clipboard access is denied.
    }
  }

  function findComposerEditable() {
    const selectors = [
      "#prompt-textarea",
      "[data-testid*='composer'] [contenteditable]",
      "[data-testid*='composer'] textarea",
      "[contenteditable][role='textbox']",
      "textarea[placeholder]",
      "[role='textbox']"
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement) || seen.has(node) || node.closest("[data-mica-root='true']") || node.closest("[data-mica-composer-diagnostics-root='true']")) continue;
        seen.add(node);
        candidates.push(node);
      }
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && candidates.includes(active)) return active;
    return candidates.find((node) => node.isConnected && !node.hidden && node.getAttribute("aria-hidden") !== "true") || null;
  }

  function findComposerRoot(element) {
    if (!(element instanceof Element)) return null;
    return element.closest("[data-testid*='composer'], form") || element.parentElement;
  }

  function getComposerTextLength(element) {
    if (!element) return 0;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return (element.value || "").length;
    return (element.innerText || element.textContent || "").length;
  }

  function hasMentionSignal(root) {
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

  function countMountedTurns() {
    return collectTurns().length;
  }

  function countUserTurns() {
    return collectTurns().filter((turn) => {
      const role = turn.matches("[data-message-author-role='user']")
        ? turn
        : turn.querySelector("[data-message-author-role='user']");
      return !!role;
    }).length;
  }

  function collectTurns() {
    const main = document.querySelector("main") || document.body;
    if (!main) return [];
    const raw = Array.from(main.querySelectorAll("[data-message-author-role], [data-testid^='conversation-turn-'], [data-testid*='conversation-turn']"));
    const unique = new Set();
    for (const node of raw) {
      if (!(node instanceof HTMLElement) || node.closest("[data-mica-root='true']") || node.closest("[data-mica-composer-diagnostics-root='true']")) continue;
      const roleNode = node.matches("[data-message-author-role]") ? node : node.querySelector("[data-message-author-role]");
      if (!(roleNode instanceof HTMLElement)) continue;
      const turn = roleNode.closest("[data-testid^='conversation-turn-'], [data-testid*='conversation-turn'], article") || roleNode;
      if (turn instanceof HTMLElement && main.contains(turn)) unique.add(turn);
    }
    return Array.from(unique);
  }

  function elementId(element) {
    if (!(element instanceof Element) || !session) return null;
    if (!session.ids.has(element)) session.ids.set(element, session.nextId++);
    return session.ids.get(element);
  }

  function getPathKind() {
    if (/^\/c\//.test(location.pathname)) return "conversation";
    if (/^\/share\//.test(location.pathname)) return "shared-conversation";
    if (document.documentElement.dataset.micaFixture === "true") return "fixture";
    return "other";
  }

  function safeCall(fn, fallback) {
    try {
      const value = typeof fn === "function" ? fn() : fallback;
      return value === undefined ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  globalThis[GLOBAL_KEY] = {
    configure,
    start,
    nextStep,
    stop,
    reset,
    summarize,
    getReport,
    getReportText,
    getDebugState
  };
})();
