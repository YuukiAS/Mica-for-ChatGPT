(() => {
  const GLOBAL_KEY = "MicaComposerDiagnostics";
  const SESSION_VERSION = "composer-capture-diagnostics.v2";
  const SAMPLE_INTERVAL_MS = 150;
  const PANEL_MARGIN = 12;
  const MAX_EVENTS = 180;
  const USER_TURN_STALE_GRACE_MS = 600;
  const CORRELATION_WINDOW_MS = 250;

  const defaultBridge = {
    getRuntimeSnapshot: () => ({}),
    getStaleRecoverySnapshot: () => null,
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
    attachSessionListeners();
    startSampler();
    const snapshot = sample();
    addEvent("session_start", snapshot);
    renderPanel();
    return summarize();
  }

  function nextStep() {
    return summarize();
  }

  function stop(options = {}) {
    if (session) {
      const snapshot = sample();
      addEvent("session_stop", snapshot);
      stopSampler();
      detachSessionListeners();
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
    const activeReport = session ? buildReport() : null;
    const report = activeReport || lastReport;
    return {
      available: true,
      running: !!session,
      samplerActive: !!session?.timer,
      listenersActive: !!session?.listenersActive,
      stepId: session ? "capture" : null,
      stepIndex: session ? 0 : null,
      stepCount: 1,
      sampleCount: session?.sampleCount || 0,
      eventCount: session?.events.length || report?.events?.length || 0,
      lastReport: report ? summarizeReport(report) : null
    };
  }

  function getReport() {
    if (session) {
      sample();
      lastReport = buildReport();
      return lastReport;
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
      listenersActive: !!session?.listenersActive,
      sampleCount: session?.sampleCount || 0,
      eventCount: session?.events.length || 0,
      panelVisible: !!panelHost,
      stepId: session ? "capture" : null
    };
  }

  function isActive() {
    return !!session;
  }

  function recordRuntimeCallback(name, details = {}) {
    if (!session || typeof name !== "string" || !name) return;
    addSafeEvent("mica_callback", { callback: name, ...(details || {}) });
  }

  function recordStaleRecoveryEvent(type, details = {}) {
    if (!session || typeof type !== "string" || !/^stale_recovery_/.test(type)) return;
    addSafeEvent(type, details || {});
  }

  function addSafeEvent(type, details = {}) {
    if (!session || typeof type !== "string" || !type) return;
    const safeDetails = {};
    for (const [key, value] of Object.entries(details || {})) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        safeDetails[key] = value;
      }
    }
    addEvent(type, readSnapshot(), safeDetails);
  }

  function createSession() {
    const now = Date.now();
    return {
      version: SESSION_VERSION,
      id: `${now}-${Math.random().toString(16).slice(2)}`,
      startedAt: now,
      stoppedAt: null,
      timer: 0,
      listenersActive: false,
      ids: new WeakMap(),
      nextId: 1,
      sampleCount: 0,
      lastSampleKey: "",
      lastSnapshot: null,
      events: [],
      missingSince: 0,
      maxMissingDurationMs: 0,
      composerUnmountCount: 0,
      composerMountCount: 0,
      editableIdentityChanges: 0,
      rootIdentityChanges: 0,
      mentionSignalObserved: false,
      deleteClearObserved: false,
      nativeLikeRemountObserved: false,
      remountWithTextObserved: false,
      staleTextRestoredAfterClear: false,
      staleTextAfterUserTurn: false,
      clearAnchor: null,
      staleRestoration: null,
      staleAfterUserTurn: null,
      userTurnBaseline: safeCall(bridge.countUserTurns, countUserTurns()),
      userTurnLastCount: null,
      userTurnDelta: 0,
      lastUserTurnChangeAt: null,
      deleteFlow: null,
      lastNonZeroTextSnapshot: null,
      missingFromSnapshot: null,
      connectorLifecycle: createConnectorLifecycle()
    };
  }

  function createConnectorLifecycle() {
    return {
      mentionSeen: false,
      mentionSignalSource: null,
      composerUnmounted: false,
      composerRemounted: false,
      editableChanged: false,
      rootChanged: false,
      finalTextLength: 0,
      staleRestorationObserved: false,
      classification: "NO_MENTION_SIGNAL"
    };
  }

  function attachSessionListeners() {
    if (!session || session.listenersActive) return;
    document.addEventListener("focusin", handleFocus, true);
    document.addEventListener("focusout", handleBlur, true);
    document.addEventListener("beforeinput", handleBeforeInput, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("cut", handleCut, true);
    session.listenersActive = true;
  }

  function detachSessionListeners() {
    if (!session?.listenersActive) return;
    document.removeEventListener("focusin", handleFocus, true);
    document.removeEventListener("focusout", handleBlur, true);
    document.removeEventListener("beforeinput", handleBeforeInput, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("cut", handleCut, true);
    session.listenersActive = false;
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

  function handleFocus(event) {
    if (!isComposerEventTarget(event.target)) return;
    addEvent("focus", sample());
  }

  function handleBlur(event) {
    if (!isComposerEventTarget(event.target)) return;
    addEvent("blur", sample());
  }

  function handleBeforeInput(event) {
    if (!isComposerEventTarget(event.target)) return;
    const inputType = getInputType(event);
    const snapshot = sample();
    if (isDeleteLikeInputType(inputType)) beginDeleteFlow(snapshot, "beforeinput", inputType);
    addEvent("beforeinput", snapshot, inputType ? { inputType } : {});
    if (isDeleteLikeInputType(inputType)) addEvent("delete_like_inputType", snapshot, { inputType });
  }

  function handleInput(event) {
    if (!isComposerEventTarget(event.target)) return;
    const inputType = getInputType(event);
    const snapshot = sample();
    if (isDeleteLikeInputType(inputType)) beginDeleteFlow(snapshot, "input", inputType);
    addEvent("input", snapshot, inputType ? { inputType } : {});
    if (isDeleteLikeInputType(inputType)) addEvent("delete_like_inputType", snapshot, { inputType });
  }

  function handleCut(event) {
    if (!isComposerEventTarget(event.target)) return;
    const snapshot = sample();
    beginDeleteFlow(snapshot, "cut", "cut");
    addEvent("cut", snapshot);
  }

  function getInputType(event) {
    return typeof event?.inputType === "string" ? event.inputType : null;
  }

  function isDeleteLikeInputType(inputType) {
    return typeof inputType === "string" && /delete|cut|clear/i.test(inputType);
  }

  function beginDeleteFlow(snapshot, source, inputType) {
    if (!session || !snapshot) return;
    const existing = session.deleteFlow;
    if (existing?.active && !existing.staleRestored) return;
    session.deleteFlow = {
      active: true,
      source,
      inputType,
      startedAtMs: snapshot.elapsedMs,
      beforeLength: snapshot.textLength,
      beforeEditableId: snapshot.editableId,
      beforeRootId: snapshot.rootId,
      clearSeen: snapshot.exists && snapshot.textLength === 0,
      clearAtMs: snapshot.exists && snapshot.textLength === 0 ? snapshot.elapsedMs : null,
      missingSeen: !snapshot.exists,
      missingAtMs: !snapshot.exists ? snapshot.elapsedMs : null,
      remountSeen: false,
      staleRestored: false,
      runtimeAtRestoration: null
    };
    if (snapshot.exists && snapshot.textLength === 0) {
      if (session.clearAnchor?.elapsedMs === snapshot.elapsedMs) {
        session.clearAnchor.type = "delete_then_present_zero";
      } else {
        establishClearAnchor(snapshot, "delete_then_present_zero");
      }
    }
  }

  function sample() {
    if (!session) return null;
    const snapshot = readSnapshot();
    session.sampleCount += 1;
    processSnapshotTransitions(snapshot);
    renderPanel();
    return snapshot;
  }

  function processSnapshotTransitions(snapshot) {
    if (!session || !snapshot) return;
    const previous = session.lastSnapshot;
    const keyState = { ...snapshot };
    delete keyState.elapsedMs;
    delete keyState.ms;
    const key = JSON.stringify(keyState);

    if (snapshot.hasMentionSignal) {
      session.mentionSignalObserved = true;
      session.connectorLifecycle.mentionSeen = true;
      session.connectorLifecycle.mentionSignalSource ||= snapshot.mentionSignalSource || "unknown";
      session.connectorLifecycle.finalTextLength = snapshot.textLength;
    }

    if (previous) {
      trackComposerPresence(previous, snapshot);
      trackIdentity(previous, snapshot);
      trackMention(previous, snapshot);
      trackUserTurns(previous, snapshot);
    } else {
      session.userTurnLastCount = snapshot.userTurns;
      if (snapshot.exists) session.composerMountCount += 1;
      if (snapshot.hasMentionSignal) addEvent("mention_signal_on", snapshot);
    }

    trackReliableClearAnchor(snapshot);
    trackDeleteFlow(snapshot);
    trackManualSendStale(snapshot);

    if (key !== session.lastSampleKey) {
      session.lastSampleKey = key;
    }
    session.lastSnapshot = snapshot;
  }

  function trackComposerPresence(previous, snapshot) {
    if (!session) return;
    if (previous.exists && !snapshot.exists) {
      session.composerUnmountCount += 1;
      session.missingSince = Date.now();
      session.missingFromSnapshot = {
        elapsedMs: previous.elapsedMs,
        textLength: previous.textLength,
        editableId: previous.editableId,
        rootId: previous.rootId
      };
      if (session.clearAnchor) session.clearAnchor.unmountAfter = true;
      if (session.connectorLifecycle.mentionSeen) session.connectorLifecycle.composerUnmounted = true;
      addEvent("composer_unmount", snapshot);
      return;
    }
    if (!previous.exists && snapshot.exists) {
      session.composerMountCount += 1;
      const missingDuration = session.missingSince ? Date.now() - session.missingSince : 0;
      session.maxMissingDurationMs = Math.max(session.maxMissingDurationMs, missingDuration);
      session.missingSince = 0;
      if (session.connectorLifecycle.mentionSeen) {
        session.connectorLifecycle.composerRemounted = true;
        session.nativeLikeRemountObserved = true;
      }
      if (session.clearAnchor) session.clearAnchor.remountAfter = true;
      if (!session.clearAnchor && session.missingFromSnapshot?.textLength > 0 && snapshot.textLength > 0) {
        session.remountWithTextObserved = true;
      }
      session.missingFromSnapshot = null;
      addEvent("composer_mount", snapshot, { missingDurationMs: Math.round(missingDuration) });
      return;
    }
    if (!snapshot.exists && session.missingSince) {
      session.maxMissingDurationMs = Math.max(session.maxMissingDurationMs, Date.now() - session.missingSince);
    }
    if (session.connectorLifecycle.mentionSeen) {
      session.connectorLifecycle.finalTextLength = snapshot.textLength;
    }
  }

  function trackIdentity(previous, snapshot) {
    if (!session) return;
    if (previous.editableId && snapshot.editableId && previous.editableId !== snapshot.editableId) {
      session.editableIdentityChanges += 1;
      if (session.clearAnchor) session.clearAnchor.identityAfter = true;
      if (session.connectorLifecycle.mentionSeen) session.connectorLifecycle.editableChanged = true;
      addEvent("editable_identity_change", snapshot, { previousEditableId: previous.editableId });
    }
    if (previous.rootId && snapshot.rootId && previous.rootId !== snapshot.rootId) {
      session.rootIdentityChanges += 1;
      if (session.clearAnchor) session.clearAnchor.identityAfter = true;
      if (session.connectorLifecycle.mentionSeen) session.connectorLifecycle.rootChanged = true;
      addEvent("root_identity_change", snapshot, { previousRootId: previous.rootId });
    }
  }

  function trackMention(previous, snapshot) {
    if (!session) return;
    if (!previous.hasMentionSignal && snapshot.hasMentionSignal) {
      session.mentionSignalObserved = true;
      session.connectorLifecycle.mentionSeen = true;
      session.connectorLifecycle.mentionSignalSource ||= snapshot.mentionSignalSource || "unknown";
      addEvent("mention_signal_on", snapshot);
    } else if (previous.hasMentionSignal && !snapshot.hasMentionSignal) {
      addEvent("mention_signal_off", snapshot);
    }
  }

  function trackUserTurns(previous, snapshot) {
    if (!session) return;
    if (session.userTurnLastCount === null) session.userTurnLastCount = previous.userTurns;
    if (snapshot.userTurns !== session.userTurnLastCount) {
      const delta = snapshot.userTurns - session.userTurnLastCount;
      session.userTurnLastCount = snapshot.userTurns;
      session.userTurnDelta = snapshot.userTurns - session.userTurnBaseline;
      session.lastUserTurnChangeAt = snapshot.elapsedMs;
      addEvent("user_turn_count_change", snapshot, { delta, totalDelta: session.userTurnDelta });
    }
  }

  function trackReliableClearAnchor(snapshot) {
    if (!session || !snapshot?.exists) return;
    if (snapshot.textLength > 0) {
      session.lastNonZeroTextSnapshot = {
        elapsedMs: snapshot.elapsedMs,
        textLength: snapshot.textLength,
        editableId: snapshot.editableId,
        rootId: snapshot.rootId
      };
      maybeDetectStaleRestoration(snapshot);
      return;
    }
    if (snapshot.textLength !== 0 || !session.lastNonZeroTextSnapshot || session.staleTextRestoredAfterClear) return;
    const flow = session.deleteFlow;
    establishClearAnchor(snapshot, flow?.active ? "delete_then_present_zero" : "present_zero");
  }

  function establishClearAnchor(snapshot, type) {
    if (!session || !snapshot?.exists || session.clearAnchor) return;
    session.deleteClearObserved = true;
    session.clearAnchor = {
      type,
      elapsedMs: snapshot.elapsedMs,
      editableId: snapshot.editableId,
      rootId: snapshot.rootId,
      previousNonZeroLength: session.lastNonZeroTextSnapshot?.textLength ?? null,
      unmountAfter: false,
      remountAfter: false,
      identityAfter: false
    };
    if (session.deleteFlow?.active) {
      session.deleteFlow.clearSeen = true;
      if (session.deleteFlow.clearAtMs === null) session.deleteFlow.clearAtMs = snapshot.elapsedMs;
    }
  }

  function maybeDetectStaleRestoration(snapshot) {
    const anchor = session?.clearAnchor;
    if (!session || !anchor || session.staleTextRestoredAfterClear || !snapshot?.exists || snapshot.textLength <= 0) return;
    if (!anchor.unmountAfter && !anchor.remountAfter && !anchor.identityAfter) return;
    const flow = session.deleteFlow;
    if (flow) {
      flow.staleRestored = true;
      flow.runtimeAtRestoration = runtimeFlags(snapshot);
    }
    session.staleTextRestoredAfterClear = true;
    session.staleRestoration = {
      restorationDelayMs: Math.max(0, snapshot.elapsedMs - anchor.elapsedMs),
      beforeEditableId: anchor.editableId,
      beforeRootId: anchor.rootId,
      afterEditableId: snapshot.editableId,
      afterRootId: snapshot.rootId,
      restoredLength: snapshot.textLength,
      clearAnchor: publicClearAnchor(anchor),
      runtime: runtimeFlags(snapshot)
    };
    session.connectorLifecycle.staleRestorationObserved = true;
    addEvent("stale_text_suspected", snapshot, {
      reason: "text_restored_after_clear",
      restorationDelayMs: session.staleRestoration.restorationDelayMs,
      clearAnchorType: anchor.type
    });
  }

  function trackDeleteFlow(snapshot) {
    const flow = session?.deleteFlow;
    if (!flow?.active) return;
    if (!snapshot.exists) {
      flow.missingSeen = true;
      if (flow.missingAtMs === null) flow.missingAtMs = snapshot.elapsedMs;
    }
    if (snapshot.exists && flow.missingSeen) {
      flow.remountSeen = true;
    }
    if (snapshot.exists && snapshot.textLength === 0) establishClearAnchor(snapshot, "delete_then_present_zero");
    maybeDetectStaleRestoration(snapshot);
  }

  function trackManualSendStale(snapshot) {
    if (!session?.lastUserTurnChangeAt || session.staleTextAfterUserTurn) return;
    const delay = snapshot.elapsedMs - session.lastUserTurnChangeAt;
    if (delay < USER_TURN_STALE_GRACE_MS) return;
    if (snapshot.exists && snapshot.textLength > 0) {
      session.staleTextAfterUserTurn = true;
      session.staleAfterUserTurn = {
        delayMs: Math.round(delay),
        textLength: snapshot.textLength,
        userTurnDelta: session.userTurnDelta,
        editableId: snapshot.editableId,
        rootId: snapshot.rootId,
        editableIdentityChanges: session.editableIdentityChanges,
        rootIdentityChanges: session.rootIdentityChanges,
        runtime: runtimeFlags(snapshot)
      };
      addEvent("stale_text_suspected", snapshot, {
        reason: "text_after_user_turn",
        delayMs: Math.round(delay),
        userTurnDelta: session.userTurnDelta
      });
    }
  }

  function readSnapshot() {
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    const textLength = getComposerTextLength(editable);
    const runtime = safeCall(bridge.getRuntimeSnapshot, {});
    const mentionSignal = detectMentionSignal(root, editable);
    const now = Date.now();
    return {
      elapsedMs: session ? now - session.startedAt : 0,
      ms: Math.round(performance.now()),
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
      hasMentionSignal: mentionSignal.seen,
      mentionSignalSource: mentionSignal.source,
      focused: !!editable && (document.activeElement === editable || editable.contains(document.activeElement)),
      mountedTurns: safeCall(bridge.countMountedTurns, countMountedTurns()),
      userTurns: safeCall(bridge.countUserTurns, countUserTurns()),
      micaStatus: runtime.status?.name || null,
      nativeSafeMode: !!runtime.runtime?.nativeSafeMode,
      documentMutationObserverActive: !!runtime.runtime?.documentMutationObserverActive,
      composerLifecycleListenersAttached: !!runtime.runtime?.composerLifecycleListenersAttached,
      optimizedTurns: Number(runtime.status?.optimizedTurns || 0),
      micaEnabled: runtime.runtime?.micaEnabled ?? runtime.settings?.enabled ?? null
    };
  }

  function addEvent(type, snapshot = readSnapshot(), data = {}) {
    if (!session || !snapshot) return;
    const event = {
      elapsedMs: Math.round(snapshot.elapsedMs || 0),
      type,
      composerPresent: !!snapshot.exists,
      editableId: snapshot.editableId,
      rootId: snapshot.rootId,
      textLength: snapshot.textLength,
      focused: !!snapshot.focused,
      mentionSignal: !!snapshot.hasMentionSignal,
      mentionSignalSource: snapshot.mentionSignalSource || null,
      mountedTurns: snapshot.mountedTurns,
      userTurns: snapshot.userTurns,
      nativeSafeMode: !!snapshot.nativeSafeMode,
      documentMutationObserverActive: !!snapshot.documentMutationObserverActive,
      composerLifecycleListenersAttached: !!snapshot.composerLifecycleListenersAttached,
      optimizedTurns: snapshot.optimizedTurns,
      ...data
    };
    session.events.push(event);
    if (session.events.length > MAX_EVENTS) {
      session.events.splice(0, session.events.length - MAX_EVENTS);
    }
  }

  function buildReport() {
    if (!session) return lastReport;
    const runtime = safeCall(bridge.getRuntimeSnapshot, {});
    const staleRecovery = safeCall(bridge.getStaleRecoverySnapshot, null);
    const snapshot = session.lastSnapshot || readSnapshot();
    const connectorLifecycle = buildConnectorLifecycle(snapshot);
    const summary = buildSummary(snapshot, connectorLifecycle);
    const currentClearGeneration = buildCurrentClearGeneration(staleRecovery, snapshot);
    return {
      schemaVersion: 2,
      probe: SESSION_VERSION,
      generatedAt: new Date().toISOString(),
      privacy: {
        localOnly: true,
        telemetryUploaded: false,
        conversationTextIncluded: false,
        promptTextIncluded: false,
        answerTextIncluded: false,
        requestDataIncluded: false,
        headersIncluded: false,
        cookiesIncluded: false,
        rawDomIncluded: false
      },
      extension: runtime.extension || null,
      runtime: {
        ...(runtime.runtime || {}),
        micaEnabled: runtime.runtime?.micaEnabled ?? runtime.settings?.enabled ?? null,
        optimizedTurns: runtime.status?.optimizedTurns ?? snapshot.optimizedTurns ?? null
      },
      page: {
        origin: location.origin,
        pathKind: runtime.page?.pathKind || getPathKind()
      },
      session: {
        id: session.id,
        version: session.version,
        startedAt: new Date(session.startedAt).toISOString(),
        stoppedAt: session.stoppedAt ? new Date(session.stoppedAt).toISOString() : null,
        durationMs: (session.stoppedAt || Date.now()) - session.startedAt,
        sampleIntervalMs: SAMPLE_INTERVAL_MS,
        sampleCount: session.sampleCount,
        eventLimit: MAX_EVENTS,
        eventCount: session.events.length,
        diagnosticTimerActive: !!session.timer,
        diagnosticListenersActive: !!session.listenersActive
      },
      summary,
      currentClearGeneration,
      connectorLifecycle,
      clearAnchor: publicClearAnchor(session.clearAnchor),
      staleRecovery,
      staleRestoration: session.staleRestoration,
      staleAfterUserTurn: session.staleAfterUserTurn,
      correlations: buildCorrelations(),
      events: session.events.slice()
    };
  }

  function buildSummary(snapshot, connectorLifecycle) {
    return {
      composerUnmountCount: session.composerUnmountCount,
      composerMountCount: session.composerMountCount,
      editableIdentityChanges: session.editableIdentityChanges,
      rootIdentityChanges: session.rootIdentityChanges,
      deleteClearObserved: session.deleteClearObserved,
      nativeLikeRemountObserved: session.nativeLikeRemountObserved,
      remountWithTextObserved: session.remountWithTextObserved,
      staleTextRestoredAfterClear: session.staleTextRestoredAfterClear,
      staleTextAfterUserTurn: session.staleTextAfterUserTurn,
      clearAnchor: publicClearAnchor(session.clearAnchor),
      maxMissingDurationMs: Math.round(session.maxMissingDurationMs),
      mentionSignalObserved: session.mentionSignalObserved,
      mentionSignalSource: session.connectorLifecycle.mentionSignalSource || null,
      userTurnDelta: session.userTurnDelta,
      finalTextLength: snapshot?.textLength ?? 0,
      finalComposerPresent: !!snapshot?.exists,
      classification: classifySummary(connectorLifecycle)
    };
  }

  function buildCurrentClearGeneration(staleRecovery, snapshot) {
    const empty = {
      clearConfirmed: false,
      remountCount: 0,
      remountWithTextObserved: false,
      staleFingerprintReappeared: false,
      recoveryAttemptCount: 0,
      finalClearStable: false,
      finalTextLength: snapshot?.textLength ?? 0,
      successMode: null
    };
    if (!session || !staleRecovery?.clearConfirmed) return empty;
    const generationId = staleRecovery.generationId;
    let clearEvent = null;
    for (let index = session.events.length - 1; index >= 0; index -= 1) {
      const event = session.events[index];
      if (event.type === "stale_recovery_clear_confirmed" && event.generationId === generationId) {
        clearEvent = event;
        break;
      }
    }
    const clearElapsedMs = clearEvent?.elapsedMs ?? session.clearAnchor?.elapsedMs ?? 0;
    const generationEvents = session.events.filter((event) => event.elapsedMs >= clearElapsedMs);
    return {
      clearConfirmed: true,
      remountCount: generationEvents.filter((event) => event.type === "composer_mount").length,
      remountWithTextObserved: generationEvents.some((event) => event.type === "composer_mount" && event.textLength > 0),
      staleFingerprintReappeared: !!staleRecovery.sameStalePayloadReappeared || generationEvents.some((event) => event.type === "stale_recovery_same_payload_reappeared"),
      recoveryAttemptCount: Number(staleRecovery.attemptCount || 0),
      finalClearStable: !!staleRecovery.finalClearStable,
      finalTextLength: snapshot?.textLength ?? 0,
      successMode: staleRecovery.successMode || null
    };
  }

  function buildConnectorLifecycle(snapshot) {
    const flow = { ...session.connectorLifecycle };
    flow.finalTextLength = snapshot?.textLength ?? flow.finalTextLength ?? 0;
    flow.staleRestorationObserved = !!session.staleTextRestoredAfterClear;
    flow.mentionSignalSource = flow.mentionSignalSource || null;
    const lifecycleObserved = flow.composerUnmounted
      || flow.composerRemounted
      || flow.editableChanged
      || flow.rootChanged
      || session.composerUnmountCount > 0
      || session.editableIdentityChanges > 0
      || session.rootIdentityChanges > 0;
    if (flow.staleRestorationObserved) {
      flow.classification = "SUSPICIOUS_STALE_RESTORATION";
    } else if (flow.mentionSeen && (flow.composerUnmounted || flow.composerRemounted || flow.editableChanged || flow.rootChanged)) {
      flow.classification = "EXPECTED_NATIVE_LIKE_REMOUNT";
    } else if (!flow.mentionSeen && session.remountWithTextObserved) {
      flow.classification = "REMOUNT_WITH_TEXT";
    } else if (!flow.mentionSeen && lifecycleObserved) {
      flow.classification = "COMPOSER_LIFECYCLE_OBSERVED";
    } else if (!flow.mentionSeen) {
      flow.classification = "NO_MENTION_SIGNAL";
    } else {
      flow.classification = "MENTION_OBSERVED_NO_REMOUNT";
    }
    return flow;
  }

  function classifySummary(connectorLifecycle) {
    if (session.staleTextRestoredAfterClear) return "STALE_TEXT_RESTORED_AFTER_CLEAR";
    if (session.staleTextAfterUserTurn) return "STALE_TEXT_AFTER_USER_TURN";
    if (connectorLifecycle.classification === "EXPECTED_NATIVE_LIKE_REMOUNT") return "EXPECTED_NATIVE_LIKE_REMOUNT";
    if (connectorLifecycle.classification === "REMOUNT_WITH_TEXT") return "REMOUNT_WITH_TEXT";
    if (session.deleteClearObserved) return "DELETE_CLEAR_SUCCESS";
    return "CAPTURED";
  }

  function buildCorrelations() {
    const suspicious = session.events.filter((event) => event.type === "stale_text_suspected");
    return suspicious.map((event) => ({
      eventElapsedMs: event.elapsedMs,
      reason: event.reason || null,
      micaCallbacksWithin250ms: session.events
        .filter((candidate) => candidate.type === "mica_callback" && Math.abs(candidate.elapsedMs - event.elapsedMs) <= CORRELATION_WINDOW_MS)
        .map((candidate) => ({
          elapsedMs: candidate.elapsedMs,
          callback: candidate.callback || null,
          nativeSafeMode: candidate.nativeSafeMode,
          documentMutationObserverActive: candidate.documentMutationObserverActive,
          composerLifecycleListenersAttached: candidate.composerLifecycleListenersAttached,
          optimizedTurns: candidate.optimizedTurns
        }))
    }));
  }

  function summarizeReport(report) {
    return {
      generatedAt: report.generatedAt,
      probe: report.probe,
      summary: report.summary,
      connectorLifecycle: report.connectorLifecycle
    };
  }

  function runtimeFlags(snapshot) {
    return {
      micaEnabled: snapshot.micaEnabled,
      nativeSafeMode: snapshot.nativeSafeMode,
      documentMutationObserverActive: snapshot.documentMutationObserverActive,
      composerLifecycleListenersAttached: snapshot.composerLifecycleListenersAttached,
      optimizedTurns: snapshot.optimizedTurns
    };
  }

  function publicClearAnchor(anchor) {
    if (!anchor) {
      return {
        type: null,
        elapsedMs: null,
        editableId: null,
        rootId: null
      };
    }
    return {
      type: anchor.type,
      elapsedMs: Math.round(anchor.elapsedMs),
      editableId: anchor.editableId,
      rootId: anchor.rootId
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
    panelHost.style.width = `min(300px, calc(100vw - ${PANEL_MARGIN * 2}px))`;
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
    const report = buildReport();
    const summary = report.summary;
    panelRoot.innerHTML = `
<style>
  :host { all: initial; }
  .card {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid rgba(23, 23, 23, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.97);
    color: #171717;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
    font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    line-height: 1.25;
  }
  p { margin: 0; }
  .summary {
    display: grid;
    gap: 3px;
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
  <h2>Composer check recording</h2>
  <p>Reproduce one short composer issue, then copy the report.</p>
  <div class="summary">
    <div>Events: ${summary.composerUnmountCount} unmounts, ${summary.editableIdentityChanges}/${summary.rootIdentityChanges} identity changes</div>
    <div>Mention: ${summary.mentionSignalObserved ? "seen" : "not seen"}; final length: ${summary.finalTextLength}</div>
    <div>Stale after clear: ${summary.staleTextRestoredAfterClear ? "yes" : "no"}</div>
    <div>Stale after user turn: ${summary.staleTextAfterUserTurn ? "yes" : "no"}</div>
  </div>
  <div class="actions">
    <button type="button" data-action="copy">Copy report</button>
    <button type="button" data-action="stop">Stop</button>
  </div>
</section>`;
    panelRoot.querySelector("[data-action='stop']")?.addEventListener("click", () => stop({ keepPanel: false }));
    panelRoot.querySelector("[data-action='copy']")?.addEventListener("click", copyReportFromPanel);
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

  function isComposerEventTarget(target) {
    const element = getEventElement(target);
    if (!element || element.closest("[data-mica-root='true']") || element.closest("[data-mica-composer-diagnostics-root='true']")) return false;
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    if (editable && (element === editable || editable.contains(element) || element.contains(editable))) return true;
    if (root && (element === root || root.contains(element))) return true;
    return !!element.closest("#prompt-textarea, [data-testid*='composer'], textarea, [contenteditable][role='textbox'], [role='textbox']");
  }

  function getEventElement(target) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Element) return target.closest("*");
    if (target instanceof CharacterData) return target.parentElement;
    return null;
  }

  function getComposerTextLength(element) {
    if (!element) return 0;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return (element.value || "").length;
    return (element.textContent ?? element.innerText ?? "").length;
  }

  function detectMentionSignal(root, editable) {
    const rootSignal = detectMentionSignalInRoot(root);
    if (rootSignal.seen) return rootSignal;
    const editableSignal = detectMentionSignalInRoot(editable);
    if (editableSignal.seen) return editableSignal;
    if (hasComposerControlledChooser(root, editable)) return { seen: true, source: "chooser" };
    const chooser = findActiveMentionChooser();
    if (chooser) return { seen: true, source: "chooser" };
    return { seen: false, source: null };
  }

  function detectMentionSignalInRoot(root) {
    if (!(root instanceof Element)) return { seen: false, source: null };
    if (root.matches?.("[data-mention], [data-token-type], [data-entity]")) return { seen: true, source: "chip" };
    if (root.querySelector?.("[data-mention], [data-token-type], [data-entity]")) return { seen: true, source: "chip" };
    const marked = root.querySelectorAll?.("[aria-label], [data-testid], [data-type], [role], [aria-controls], [aria-expanded]") || [];
    for (const node of marked) {
      const source = mentionSourceFromAttributes(node);
      if (source) return { seen: true, source };
    }
    const rootSource = mentionSourceFromAttributes(root);
    return rootSource ? { seen: true, source: rootSource } : { seen: false, source: null };
  }

  function mentionSourceFromAttributes(node) {
    if (!(node instanceof Element)) return null;
    if (node.hasAttribute("data-mention") || node.hasAttribute("data-entity") || node.hasAttribute("data-token-type")) return "chip";
    const signal = [
      node.getAttribute("aria-label"),
      node.getAttribute("data-testid"),
      node.getAttribute("data-type"),
      node.getAttribute("role")
    ].filter(Boolean).join(" ");
    if (/connector|mention/i.test(signal)) return "structural-marker";
    if (/github/i.test(signal)) return "chip";
    if (node.getAttribute("aria-expanded") === "true" && node.hasAttribute("aria-controls")) return "chooser";
    return null;
  }

  function hasComposerControlledChooser(root, editable) {
    const owner = editable instanceof Element ? editable : root;
    if (!(owner instanceof Element)) return false;
    const controls = owner.getAttribute("aria-controls") || root?.getAttribute?.("aria-controls") || "";
    if (!controls || owner.getAttribute("aria-expanded") !== "true") return false;
    const controlled = document.getElementById(controls);
    return controlled instanceof Element && isLikelyChooser(controlled);
  }

  function findActiveMentionChooser() {
    const selectors = [
      "[data-testid*='mention' i]",
      "[data-testid*='connector' i]",
      "[aria-label*='mention' i]",
      "[aria-label*='connector' i]",
      "[role='listbox'][aria-activedescendant]",
      "[role='menu'][aria-activedescendant]"
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof Element) || node.closest("[data-mica-root='true']") || node.closest("[data-mica-composer-diagnostics-root='true']")) continue;
        if (isLikelyChooser(node)) return node;
      }
    }
    return null;
  }

  function isLikelyChooser(node) {
    if (!(node instanceof Element)) return false;
    const signal = [
      node.getAttribute("role"),
      node.getAttribute("aria-label"),
      node.getAttribute("data-testid")
    ].filter(Boolean).join(" ");
    return /listbox|menu|dialog|connector|mention/i.test(signal);
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

  globalThis[GLOBAL_KEY] = {
    configure,
    start,
    nextStep,
    stop,
    reset,
    summarize,
    getReport,
    getReportText,
    getDebugState,
    isActive,
    recordRuntimeCallback,
    recordStaleRecoveryEvent
  };
})();
