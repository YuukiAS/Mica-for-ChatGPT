(() => {
  const GLOBAL_KEY = "MicaComposerDiagnostics";
  const SESSION_VERSION = "composer-capture-diagnostics.v3";
  const SAMPLE_INTERVAL_MS = 150;
  const PANEL_MARGIN = 12;
  const MAX_EVENTS = 180;
  const USER_TURN_STALE_GRACE_MS = 600;
  const CORRELATION_WINDOW_MS = 250;
  const SEND_CANDIDATE_WINDOW_MS = 3200;

  const defaultBridge = {
    getRuntimeSnapshot: () => ({}),
    getStaleRecoverySnapshot: () => null,
    getConnectorLifecycleSnapshot: () => getSharedConnectorLifecycleState(),
    getConnectorContinuitySnapshot: () => null,
    getSendResidualRecoverySnapshot: () => null,
    countMountedTurns: () => countMountedTurns(),
    countUserTurns: () => countUserTurns()
  };

  let bridge = { ...defaultBridge };
  let session = null;
  let lastReport = null;
  let panelHost = null;
  let panelRoot = null;
  let panelDelegatedListenerAttached = false;

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

  function recordConnectorContinuityEvent(type, details = {}) {
    if (!session || typeof type !== "string" || !/^connector_continuity_/.test(type)) return;
    addSafeEvent(type, details || {});
  }

  function recordSendResidualRecoveryEvent(type, details = {}) {
    if (!session || typeof type !== "string" || !/^send_residual_/.test(type)) return;
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
      coalescedLowPriorityEvents: 0,
      droppedLowPriorityEvents: 0,
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
      sendCandidateId: 0,
      sendCandidate: null,
      sendLifecycle: createSendLifecycle(),
      deleteFlow: null,
      lastNonZeroTextSnapshot: null,
      missingFromSnapshot: null,
      connectorLifecycle: createConnectorLifecycle(),
      overlayHandlerAttached: false,
      lastOverlayActionReceived: null,
      lastOverlayActionSessionId: null,
      lastOverlayActionResult: null
    };
  }

  function createConnectorLifecycle() {
    return {
      mentionSeen: false,
      detected: false,
      latched: false,
      mentionSignalSource: null,
      source: null,
      composerUnmounted: false,
      composerRemounted: false,
      editableChanged: false,
      rootChanged: false,
      finalTextLength: 0,
      staleRestorationObserved: false,
      classification: "NO_MENTION_SIGNAL"
    };
  }

  function createSendLifecycle() {
    return {
      observed: false,
      preSendLength: 0,
      preSendCanonicalLength: 0,
      preSendBodyLength: 0,
      preSendBodyCanonicalLength: 0,
      preSendBodyHash: null,
      preSendHash: null,
      preSendFingerprintCaptured: false,
      userTurnCommitted: false,
      userTurnCommitSignalObserved: false,
      userTurnCommittedLatched: false,
      userTurnDelta: 0,
      userTurnDeltaHistory: [],
      firstUserTurnChangeAt: null,
      firstComposerZeroElapsedMs: null,
      composerUnmountBaseline: 0,
      composerMountBaseline: 0,
      composerUnmountCountAfterSend: 0,
      composerMountCountAfterSend: 0,
      stalePayloadReappeared: false,
      staleFingerprintMatched: false,
      staleReappearanceElapsedMs: null,
      newTrustedUserInputAfterSend: false,
      staleClearRecoveryEnabled: null,
      staleClearRecoveryAttemptedDuringSend: false,
      staleClearRecoveryEventCountAfterSend: 0,
      finalTextLength: 0,
      finalEditableBodyLength: 0,
      finalConnectorPillTextLength: 0,
      finalComposerPresent: false,
      classification: "INSUFFICIENT_SEND_EVIDENCE"
    };
  }

  function attachSessionListeners() {
    if (!session || session.listenersActive) return;
    document.addEventListener("focusin", handleFocus, true);
    document.addEventListener("focusout", handleBlur, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("beforeinput", handleBeforeInput, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("cut", handleCut, true);
    session.listenersActive = true;
  }

  function detachSessionListeners() {
    if (!session?.listenersActive) return;
    document.removeEventListener("focusin", handleFocus, true);
    document.removeEventListener("focusout", handleBlur, true);
    document.removeEventListener("submit", handleSubmit, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeydown, true);
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

  function handleSubmit(event) {
    if (!isComposerEventTarget(event.target)) return;
    const snapshot = sample();
    captureSendCandidate(snapshot, "submit");
  }

  function handleClick(event) {
    if (!isComposerEventTarget(event.target)) return;
    const button = getEventElement(event.target)?.closest?.("button, [role='button']");
    if (!(button instanceof HTMLElement) || !isLikelySendButton(button)) return;
    const snapshot = sample();
    captureSendCandidate(snapshot, "click");
  }

  function handleKeydown(event) {
    if (!isLikelySendKey(event) || !isComposerEventTarget(event.target)) return;
    if (isConnectorSelectionEnter(event)) return;
    const snapshot = sample();
    captureSendCandidate(snapshot, "enter");
  }

  function handleBeforeInput(event) {
    if (!isComposerEventTarget(event.target)) return;
    const inputType = getInputType(event);
    const snapshot = sample();
    if (isDeleteLikeInputType(inputType)) beginDeleteFlow(snapshot, "beforeinput", inputType);
    if (isTrustedInputEvent(event) && isInsertLikeInputType(inputType)) markTrustedUserInputAfterSend(snapshot, inputType);
    addEvent("beforeinput", snapshot, inputType ? { inputType } : {});
    if (isDeleteLikeInputType(inputType)) addEvent("delete_like_inputType", snapshot, { inputType });
  }

  function handleInput(event) {
    if (!isComposerEventTarget(event.target)) return;
    const inputType = getInputType(event);
    const snapshot = sample();
    if (isDeleteLikeInputType(inputType)) beginDeleteFlow(snapshot, "input", inputType);
    if (isTrustedInputEvent(event) && isInsertLikeInputType(inputType)) markTrustedUserInputAfterSend(snapshot, inputType);
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

  function isInsertLikeInputType(inputType) {
    return typeof inputType === "string" && /^insert|paste|composition/i.test(inputType);
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
      if (Number.isFinite(session.sendLifecycle.firstUserTurnChangeAt) && snapshot.elapsedMs >= session.sendLifecycle.firstUserTurnChangeAt) {
        session.sendLifecycle.composerUnmountCountAfterSend += 1;
      }
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
      if (Number.isFinite(session.sendLifecycle.firstUserTurnChangeAt) && snapshot.elapsedMs >= session.sendLifecycle.firstUserTurnChangeAt) {
        session.sendLifecycle.composerMountCountAfterSend += 1;
      }
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
      if (delta > 0 && session.sendCandidate) promoteSendCandidate(snapshot);
      recordSendUserTurnDelta(delta, snapshot);
      if (delta > 0 && session.sendLifecycle.observed) beginSendLifecycle(previous, snapshot, delta);
      addEvent("user_turn_count_change", snapshot, { delta, totalDelta: session.userTurnDelta });
    }
    trackSendCandidate(previous, snapshot);
  }

  function captureSendCandidate(snapshot, source) {
    if (!session || !snapshot?.exists || snapshot.composerEditableBodyLength <= 0) return;
    session.lastNonZeroTextSnapshot = privateTextSnapshot(snapshot);
    const connectorLifecycle = safeCall(bridge.getConnectorLifecycleSnapshot, getSharedConnectorLifecycleState());
    const mentionSignal = detectMentionSignal(snapshot.root, snapshot.editable);
    session.sendCandidateId += 1;
    session.sendCandidate = {
      id: session.sendCandidateId,
      source,
      createdAtMs: snapshot.elapsedMs,
      preSend: privateTextSnapshot(snapshot),
      connectorContextLatched: !!(connectorLifecycle?.connectorContextLatched || connectorLifecycle?.latched || mentionSignal.seen),
      chooserActiveNow: !!connectorLifecycle?.chooserActiveNow,
      selectionWindowActive: !!connectorLifecycle?.selectionWindowActive,
      mentionSignalObserved: mentionSignal.seen || !!connectorLifecycle?.detected,
      mentionSignalSource: mentionSignal.source || connectorLifecycle?.source || null,
      previousComposerExists: !!snapshot.exists,
      unmountSeen: false,
      remountSeen: false
    };
    addEvent("send_candidate_created", snapshot, {
      candidateId: session.sendCandidate.id,
      source,
      preSendLength: session.sendCandidate.preSend?.textLength || 0,
      connectorContextLatched: session.sendCandidate.connectorContextLatched,
      chooserActiveNow: session.sendCandidate.chooserActiveNow,
      selectionWindowActive: session.sendCandidate.selectionWindowActive,
      mentionSignalObserved: session.sendCandidate.mentionSignalObserved,
      mentionSignalSource: session.sendCandidate.mentionSignalSource
    });
  }

  function promoteSendCandidate(snapshot) {
    if (!session?.sendCandidate) return;
    const candidate = session.sendCandidate;
    const flow = session.sendLifecycle;
    flow.observed = true;
    flow.preSendLength = candidate.preSend?.textLength || 0;
    flow.preSendCanonicalLength = candidate.preSend?.textCanonicalLength || 0;
    flow.preSendBodyLength = candidate.preSend?.composerEditableBodyLength || 0;
    flow.preSendBodyCanonicalLength = candidate.preSend?.composerEditableBodyCanonicalLength || 0;
    flow.preSendBodyHash = candidate.preSend?.composerEditableBodyHash || null;
    flow.preSendHash = candidate.preSend?.textHash || null;
    flow.preSendFingerprintCaptured = !!flow.preSendHash;
    flow.staleClearRecoveryEnabled = safeCall(bridge.getStaleRecoverySnapshot, null)?.enabled ?? null;
    session.sendCandidate = null;
    addEvent("send_candidate_promoted", snapshot, {
      candidateId: candidate.id,
      source: candidate.source,
      preSendLength: flow.preSendLength,
      preSendFingerprintCaptured: flow.preSendFingerprintCaptured,
      connectorContextLatched: candidate.connectorContextLatched
    });
    addEvent("send_intent", snapshot, {
      source: candidate.source,
      candidateId: candidate.id,
      promotedBy: "user_turn_commit"
    });
    addEvent("send_lifecycle_pre_send_captured", snapshot, {
      source: candidate.source,
      preSendLength: flow.preSendLength,
      preSendFingerprintCaptured: flow.preSendFingerprintCaptured
    });
  }

  function trackSendCandidate(previous, snapshot) {
    const candidate = session?.sendCandidate;
    if (!candidate || !previous || !snapshot) return;
    if (previous.exists && !snapshot.exists) candidate.unmountSeen = true;
    if (!previous.exists && snapshot.exists) candidate.remountSeen = true;
    candidate.previousComposerExists = !!snapshot.exists;
    if ((candidate.remountSeen || candidate.unmountSeen) && hasResolvedConnectorContext(snapshot.root, snapshot.editable)) {
      finishSendCandidate("CONNECTOR_SELECTION", snapshot);
      return;
    }
    if (snapshot.elapsedMs - candidate.createdAtMs >= SEND_CANDIDATE_WINDOW_MS) {
      finishSendCandidate("INSUFFICIENT_SEND_EVIDENCE", snapshot);
    }
  }

  function finishSendCandidate(classification, snapshot) {
    const candidate = session?.sendCandidate;
    if (!session || !candidate) return;
    if (classification !== "CONNECTOR_SELECTION") {
      const flow = session.sendLifecycle;
      flow.observed = true;
      flow.preSendLength = candidate.preSend?.textLength || 0;
      flow.preSendCanonicalLength = candidate.preSend?.textCanonicalLength || 0;
      flow.preSendBodyLength = candidate.preSend?.composerEditableBodyLength || 0;
      flow.preSendBodyCanonicalLength = candidate.preSend?.composerEditableBodyCanonicalLength || 0;
      flow.preSendBodyHash = candidate.preSend?.composerEditableBodyHash || null;
      flow.preSendHash = candidate.preSend?.textHash || null;
      flow.preSendFingerprintCaptured = !!flow.preSendHash;
      flow.staleClearRecoveryEnabled = safeCall(bridge.getStaleRecoverySnapshot, null)?.enabled ?? null;
      updateSendLifecycle(snapshot);
    }
    addEvent("send_candidate_discarded", snapshot, {
      candidateId: candidate.id,
      source: candidate.source,
      classification,
      unmountSeen: !!candidate.unmountSeen,
      remountSeen: !!candidate.remountSeen,
      resolvedConnectorContext: hasResolvedConnectorContext(snapshot.root, snapshot.editable)
    });
    session.sendCandidate = null;
  }

  function recordSendUserTurnDelta(delta, snapshot) {
    const flow = session?.sendLifecycle;
    if (!flow?.observed || !snapshot) return;
    flow.userTurnDelta = session.userTurnDelta;
    flow.userTurnDeltaHistory.push({
      elapsedMs: Math.round(snapshot.elapsedMs),
      delta,
      totalDelta: session.userTurnDelta
    });
    if (flow.userTurnDeltaHistory.length > 12) flow.userTurnDeltaHistory.shift();
    if (delta > 0) {
      flow.userTurnCommitSignalObserved = true;
      flow.userTurnCommittedLatched = true;
      flow.userTurnCommitted = true;
    }
  }

  function beginSendLifecycle(previous, snapshot, delta = 0) {
    if (!session) return;
    const flow = session.sendLifecycle;
    const alreadyLatched = !!flow.userTurnCommittedLatched;
    const firstCommitAnchor = !Number.isFinite(flow.firstUserTurnChangeAt);
    const preSend = previous?.textLength > 0 ? privateTextSnapshot(previous) : session.lastNonZeroTextSnapshot;
    flow.observed = true;
    if (!flow.preSendFingerprintCaptured) {
      flow.preSendLength = preSend?.textLength || 0;
      flow.preSendCanonicalLength = preSend?.textCanonicalLength || 0;
      flow.preSendBodyLength = preSend?.composerEditableBodyLength || 0;
      flow.preSendBodyCanonicalLength = preSend?.composerEditableBodyCanonicalLength || 0;
      flow.preSendBodyHash = preSend?.composerEditableBodyHash || null;
      flow.preSendHash = preSend?.textHash || null;
      flow.preSendFingerprintCaptured = !!flow.preSendHash;
    }
    flow.userTurnCommitSignalObserved = true;
    flow.userTurnCommittedLatched = true;
    flow.userTurnCommitted = true;
    flow.userTurnDelta = session.userTurnDelta;
    if (!alreadyLatched || firstCommitAnchor) {
      flow.firstUserTurnChangeAt = snapshot.elapsedMs;
      flow.composerUnmountBaseline = session.composerUnmountCount;
      flow.composerMountBaseline = session.composerMountCount;
    }
    flow.staleClearRecoveryEnabled = safeCall(bridge.getStaleRecoverySnapshot, null)?.enabled ?? null;
    updateSendLifecycle(snapshot);
    if (!alreadyLatched || firstCommitAnchor) {
      addEvent("send_lifecycle_user_turn_committed", snapshot, {
        preSendLength: flow.preSendLength,
        preSendFingerprintCaptured: flow.preSendFingerprintCaptured,
        userTurnDelta: flow.userTurnDelta,
        delta
      });
    }
  }

  function updateSendLifecycle(snapshot) {
    const flow = session?.sendLifecycle;
    if (!flow?.observed || !snapshot) return;
    if (flow.userTurnCommitSignalObserved || flow.userTurnCommittedLatched) {
      flow.userTurnCommittedLatched = true;
      flow.userTurnCommitted = true;
    }
    flow.userTurnDelta = session.userTurnDelta;
    flow.finalTextLength = snapshot.textLength;
    flow.finalEditableBodyLength = snapshot.composerEditableBodyLength;
    flow.finalConnectorPillTextLength = snapshot.connectorPillTextLength;
    flow.finalComposerPresent = !!snapshot.exists;
    flow.composerUnmountCountAfterSend = Math.max(flow.composerUnmountCountAfterSend, session.composerUnmountCount - flow.composerUnmountBaseline);
    flow.composerMountCountAfterSend = Math.max(flow.composerMountCountAfterSend, session.composerMountCount - flow.composerMountBaseline);
    const staleRecovery = safeCall(bridge.getStaleRecoverySnapshot, null);
    if (flow.staleClearRecoveryEnabled === null) flow.staleClearRecoveryEnabled = staleRecovery?.enabled ?? null;
    const hasCommitAnchor = Number.isFinite(flow.firstUserTurnChangeAt);
    flow.staleClearRecoveryEventCountAfterSend = hasCommitAnchor
      ? session.events.filter((event) => event.elapsedMs >= flow.firstUserTurnChangeAt && event.type.startsWith("stale_recovery_")).length
      : 0;
    flow.staleClearRecoveryAttemptedDuringSend = flow.staleClearRecoveryEventCountAfterSend > 0
      && session.events.some((event) => event.elapsedMs >= flow.firstUserTurnChangeAt && event.type === "stale_recovery_attempt");
    if (hasCommitAnchor && snapshot.exists && snapshot.composerEditableBodyLength === 0 && flow.firstComposerZeroElapsedMs === null) {
      flow.firstComposerZeroElapsedMs = snapshot.elapsedMs - flow.firstUserTurnChangeAt;
    }
    if (hasCommitAnchor && snapshot.exists && snapshot.composerEditableBodyLength > 0 && snapshot.elapsedMs - flow.firstUserTurnChangeAt >= USER_TURN_STALE_GRACE_MS) {
      const matched = matchesPreSendFingerprint(snapshot, flow);
      if (matched) {
        flow.stalePayloadReappeared = true;
        flow.staleFingerprintMatched = true;
        if (flow.staleReappearanceElapsedMs === null) {
          flow.staleReappearanceElapsedMs = snapshot.elapsedMs - flow.firstUserTurnChangeAt;
          addEvent("send_lifecycle_stale_payload_reappeared", snapshot, {
            staleReappearanceElapsedMs: Math.round(flow.staleReappearanceElapsedMs),
            staleFingerprintMatched: true
          });
        }
      }
    }
  }

  function markTrustedUserInputAfterSend(snapshot, inputType) {
    const flow = session?.sendLifecycle;
    if (!flow?.observed || !flow.userTurnCommittedLatched || !snapshot || snapshot.elapsedMs < flow.firstUserTurnChangeAt) return;
    flow.newTrustedUserInputAfterSend = true;
    addEvent("trusted_user_input_after_send", snapshot, { inputType: inputType || null });
  }

  function trackReliableClearAnchor(snapshot) {
    if (!session || !snapshot?.exists) return;
    if (snapshot.textLength > 0) {
      session.lastNonZeroTextSnapshot = {
        elapsedMs: snapshot.elapsedMs,
        textLength: snapshot.textLength,
        textCanonicalLength: snapshot.textCanonicalLength,
        textHash: snapshot.textHash,
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
    const flow = session?.sendLifecycle;
    if (!session?.lastUserTurnChangeAt || !flow?.observed) return;
    updateSendLifecycle(snapshot);
    if (session.staleTextAfterUserTurn) return;
    const delay = snapshot.elapsedMs - session.lastUserTurnChangeAt;
    if (delay < USER_TURN_STALE_GRACE_MS) return;
    if (snapshot.exists && snapshot.composerEditableBodyLength > 0) {
      const matched = matchesPreSendFingerprint(snapshot, flow);
      session.staleTextAfterUserTurn = true;
      session.staleAfterUserTurn = {
        delayMs: Math.round(delay),
        textLength: snapshot.textLength,
        editableBodyLength: snapshot.composerEditableBodyLength,
        connectorPillTextLength: snapshot.connectorPillTextLength,
        userTurnDelta: session.userTurnDelta,
        preSendFingerprintMatched: matched,
        editableId: snapshot.editableId,
        rootId: snapshot.rootId,
        editableIdentityChanges: session.editableIdentityChanges,
        rootIdentityChanges: session.rootIdentityChanges,
        runtime: runtimeFlags(snapshot)
      };
      addEvent("stale_text_suspected", snapshot, {
        reason: "text_after_user_turn",
        delayMs: Math.round(delay),
        userTurnDelta: session.userTurnDelta,
        preSendFingerprintMatched: matched
      });
    }
  }

  function readSnapshot() {
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    const textParts = extractComposerText(editable, root);
    const text = textParts.rawText;
    const canonical = canonicalize(text);
    const bodyCanonical = canonicalize(textParts.editableBodyText);
    const textLength = text.length;
    const runtime = safeCall(bridge.getRuntimeSnapshot, {});
    const mentionSignal = detectMentionSignal(root, editable);
    const connectorSignal = safeCall(bridge.getConnectorLifecycleSnapshot, getSharedConnectorLifecycleState());
    const hasMentionSignal = mentionSignal.seen || !!connectorSignal?.latched;
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
      composerRawTextLength: textParts.rawText.length,
      composerEditableBodyLength: textParts.editableBodyText.length,
      composerEditableBodyCanonicalLength: bodyCanonical.length,
      composerEditableBodyHash: bodyCanonical.length > 0 ? fingerprintCanonical(bodyCanonical) : null,
      connectorPillTextLength: textParts.connectorPillTextLength,
      attachmentOrNonEditableTokenLength: textParts.attachmentOrNonEditableTokenLength,
      nonEditableTokenLength: textParts.attachmentOrNonEditableTokenLength,
      textCanonicalLength: canonical.length,
      textHash: canonical.length > 0 ? fingerprintCanonical(canonical) : null,
      hasMentionSignal,
      mentionSignalSource: mentionSignal.source || connectorSignal?.source || null,
      connectorLifecycleDetected: !!connectorSignal?.detected,
      connectorLifecycleLatched: !!connectorSignal?.latched,
      connectorContextLatched: !!connectorSignal?.connectorContextLatched,
      chooserActiveNow: !!connectorSignal?.chooserActiveNow,
      selectionWindowActive: !!connectorSignal?.selectionWindowActive,
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
      composerRawTextLength: snapshot.composerRawTextLength,
      composerEditableBodyLength: snapshot.composerEditableBodyLength,
      connectorPillTextLength: snapshot.connectorPillTextLength,
      attachmentOrNonEditableTokenLength: snapshot.attachmentOrNonEditableTokenLength,
      focused: !!snapshot.focused,
      mentionSignal: !!snapshot.hasMentionSignal,
      mentionSignalSource: snapshot.mentionSignalSource || null,
      connectorLifecycleDetected: !!snapshot.connectorLifecycleDetected,
      connectorLifecycleLatched: !!snapshot.connectorLifecycleLatched,
      connectorContextLatched: !!snapshot.connectorContextLatched,
      chooserActiveNow: !!snapshot.chooserActiveNow,
      selectionWindowActive: !!snapshot.selectionWindowActive,
      mountedTurns: snapshot.mountedTurns,
      userTurns: snapshot.userTurns,
      nativeSafeMode: !!snapshot.nativeSafeMode,
      documentMutationObserverActive: !!snapshot.documentMutationObserverActive,
      composerLifecycleListenersAttached: !!snapshot.composerLifecycleListenersAttached,
      optimizedTurns: snapshot.optimizedTurns,
      ...data
    };
    if (maybeCoalesceEvent(event)) return;
    session.events.push(event);
    if (session.events.length > MAX_EVENTS) {
      trimEventBuffer();
    }
  }

  function maybeCoalesceEvent(event) {
    if (!isLowPriorityEvent(event)) return false;
    const previous = session.events[session.events.length - 1];
    if (!previous || !isLowPriorityEvent(previous)) return false;
    if (previous.type !== event.type || previous.callback !== event.callback || previous.status !== event.status) return false;
    previous.elapsedMs = event.elapsedMs;
    previous.textLength = event.textLength;
    previous.mountedTurns = event.mountedTurns;
    previous.userTurns = event.userTurns;
    previous.optimizedTurns = event.optimizedTurns;
    previous.repeatCount = (previous.repeatCount || 1) + 1;
    session.coalescedLowPriorityEvents += 1;
    return true;
  }

  function trimEventBuffer() {
    while (session.events.length > MAX_EVENTS) {
      const removableIndex = session.events.findIndex((event) => !isHighPriorityEvent(event));
      if (removableIndex >= 0) {
        if (isLowPriorityEvent(session.events[removableIndex])) session.droppedLowPriorityEvents += 1;
        session.events.splice(removableIndex, 1);
      } else {
        session.events.shift();
      }
    }
  }

  function isHighPriorityEvent(event) {
    if (!event?.type) return false;
    if (/^(connector_continuity_|send_residual_|stale_recovery_|send_lifecycle_|send_candidate_|overlay_action_)/.test(event.type)) return true;
    return [
      "send_intent",
      "user_turn_count_change",
      "composer_unmount",
      "composer_mount",
      "mention_signal_on",
      "mention_signal_off",
      "stale_text_suspected",
      "trusted_user_input_after_send"
    ].includes(event.type);
  }

  function isLowPriorityEvent(event) {
    return event?.type === "mica_callback" && /^(scan|status_update|turn_optimization_update|known_interruption_check)$/.test(event.callback || "");
  }

  function buildReport() {
    if (!session) return lastReport;
    const runtime = safeCall(bridge.getRuntimeSnapshot, {});
    const staleRecovery = safeCall(bridge.getStaleRecoverySnapshot, null);
    const connectorLifecycleSignal = safeCall(bridge.getConnectorLifecycleSnapshot, getSharedConnectorLifecycleState());
    const connectorContinuity = safeCall(bridge.getConnectorContinuitySnapshot, null);
    const sendResidualRecovery = safeCall(bridge.getSendResidualRecoverySnapshot, null);
    const snapshot = session.lastSnapshot || readSnapshot();
    updateSendLifecycle(snapshot);
    const connectorLifecycle = buildConnectorLifecycle(snapshot);
    const summary = buildSummary(snapshot, connectorLifecycle);
    const currentClearGeneration = buildCurrentClearGeneration(staleRecovery, snapshot);
    const sendLifecycle = buildPublicSendLifecycle(snapshot);
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
        coalescedLowPriorityEvents: session.coalescedLowPriorityEvents,
        droppedLowPriorityEvents: session.droppedLowPriorityEvents,
        diagnosticTimerActive: !!session.timer,
        diagnosticListenersActive: !!session.listenersActive,
        overlayHandlerAttached: !!session.overlayHandlerAttached,
        lastOverlayActionReceived: session.lastOverlayActionReceived,
        lastOverlayActionSessionId: session.lastOverlayActionSessionId,
        lastOverlayActionResult: session.lastOverlayActionResult
      },
      summary,
      sendLifecycle,
      currentClearGeneration,
      connectorLifecycle,
      connectorLifecycleSignal,
      connectorContinuity,
      sendResidualRecovery,
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
      connectorLifecycleDetected: !!connectorLifecycle.detected,
      connectorLifecycleLatched: !!connectorLifecycle.latched,
      connectorLifecycleSource: connectorLifecycle.source || connectorLifecycle.mentionSignalSource || null,
      userTurnDelta: session.userTurnDelta,
      userTurnCommittedLatched: !!session.sendLifecycle.userTurnCommittedLatched,
      finalTextLength: snapshot?.textLength ?? 0,
      composerRawTextLength: snapshot?.composerRawTextLength ?? snapshot?.textLength ?? 0,
      composerEditableBodyLength: snapshot?.composerEditableBodyLength ?? snapshot?.textLength ?? 0,
      connectorPillTextLength: snapshot?.connectorPillTextLength ?? 0,
      attachmentOrNonEditableTokenLength: snapshot?.attachmentOrNonEditableTokenLength ?? 0,
      finalComposerPresent: !!snapshot?.exists,
      sendClassification: classifySendLifecycle(session.sendLifecycle, snapshot),
      classification: classifySummary(connectorLifecycle)
    };
  }

  function buildPublicSendLifecycle(snapshot) {
    const flow = session?.sendLifecycle || createSendLifecycle();
    if (session && snapshot) updateSendLifecycle(snapshot);
    const sendResidualRecovery = safeCall(bridge.getSendResidualRecoverySnapshot, null);
    const connectorContinuity = safeCall(bridge.getConnectorContinuitySnapshot, null);
    const connectorLifecycleSignal = safeCall(bridge.getConnectorLifecycleSnapshot, getSharedConnectorLifecycleState());
    const mergedForClassification = {
      ...flow,
      stalePayloadReappeared: !!(flow.stalePayloadReappeared || sendResidualRecovery?.stalePayloadReappeared),
      staleFingerprintMatched: !!(flow.staleFingerprintMatched || sendResidualRecovery?.staleFingerprintMatched)
    };
    const classification = classifySendLifecycle(mergedForClassification, snapshot);
    flow.classification = classification;
    return {
      observed: !!flow.observed,
      sendCandidateActive: !!session?.sendCandidate,
      sendCandidateId: session?.sendCandidate?.id || null,
      sendCandidateSource: session?.sendCandidate?.source || null,
      sendCandidateConnectorContextLatched: !!session?.sendCandidate?.connectorContextLatched,
      preSendLength: flow.preSendLength || 0,
      preSendBodyLength: flow.preSendBodyLength || 0,
      preSendFingerprintCaptured: !!flow.preSendFingerprintCaptured,
      userTurnCommitted: !!flow.userTurnCommittedLatched,
      userTurnCommitSignalObserved: !!flow.userTurnCommitSignalObserved,
      userTurnCommittedLatched: !!flow.userTurnCommittedLatched,
      userTurnDelta: flow.userTurnDelta || 0,
      userTurnDeltaHistory: Array.isArray(flow.userTurnDeltaHistory) ? flow.userTurnDeltaHistory.slice() : [],
      firstComposerZeroElapsedMs: roundNullable(flow.firstComposerZeroElapsedMs),
      composerUnmountCountAfterSend: flow.composerUnmountCountAfterSend || 0,
      composerMountCountAfterSend: flow.composerMountCountAfterSend || 0,
      stalePayloadReappeared: !!(flow.stalePayloadReappeared || sendResidualRecovery?.stalePayloadReappeared),
      staleFingerprintMatched: !!(flow.staleFingerprintMatched || sendResidualRecovery?.staleFingerprintMatched),
      staleReappearanceElapsedMs: roundNullable(flow.staleReappearanceElapsedMs ?? sendResidualRecovery?.staleReappearanceElapsedMs),
      finalTextLength: snapshot?.textLength ?? flow.finalTextLength ?? 0,
      composerRawTextLength: snapshot?.composerRawTextLength ?? snapshot?.textLength ?? flow.finalTextLength ?? 0,
      composerEditableBodyLength: snapshot?.composerEditableBodyLength ?? flow.finalEditableBodyLength ?? 0,
      connectorPillTextLength: snapshot?.connectorPillTextLength ?? flow.finalConnectorPillTextLength ?? 0,
      attachmentOrNonEditableTokenLength: snapshot?.attachmentOrNonEditableTokenLength ?? 0,
      finalComposerPresent: !!(snapshot?.exists ?? flow.finalComposerPresent),
      mentionSignalObserved: !!(session?.mentionSignalObserved || sendResidualRecovery?.mentionSignalObserved || connectorLifecycleSignal?.detected),
      mentionSignalSource: session?.connectorLifecycle?.mentionSignalSource || sendResidualRecovery?.mentionSignalSource || connectorLifecycleSignal?.source || null,
      connectorLifecycleDetected: !!connectorLifecycleSignal?.detected,
      connectorLifecycleLatched: !!connectorLifecycleSignal?.latched,
      newTrustedUserInputAfterSend: !!flow.newTrustedUserInputAfterSend,
      staleClearRecoveryEnabled: flow.staleClearRecoveryEnabled,
      staleClearRecoveryAttemptedDuringSend: !!flow.staleClearRecoveryAttemptedDuringSend,
      staleClearRecoveryEventCountAfterSend: flow.staleClearRecoveryEventCountAfterSend || 0,
      connectorContinuityActivated: !!connectorContinuity?.activated,
      connectorContinuitySkippedReason: connectorContinuity?.skippedReason || null,
      connectorContinuityDurationMs: Number(connectorContinuity?.shellDurationMs || 0),
      sendResidualRecoveryEnabled: sendResidualRecovery?.enabled ?? null,
      sendResidualRecoveryArmed: !!sendResidualRecovery?.armed,
      sendResidualRecoverySkippedReason: sendResidualRecovery?.skippedReason || null,
      sendResidualRecoveryConnectorLifecycleLatched: !!sendResidualRecovery?.connectorLifecycleLatched,
      sendResidualRecoveryUserTurnCommittedLatched: !!sendResidualRecovery?.userTurnCommittedLatched,
      sendResidualRecoveryPreSendFingerprintCaptured: !!sendResidualRecovery?.preSendFingerprintCaptured,
      sendResidualRecoveryStaleFingerprintMatched: !!sendResidualRecovery?.staleFingerprintMatched,
      sendResidualRecoveryStaleProvenanceMatched: !!sendResidualRecovery?.staleProvenanceMatched,
      sendResidualRecoveryStaleProvenanceReason: sendResidualRecovery?.staleProvenanceReason || null,
      sendResidualRecoveryAttemptCount: Number(sendResidualRecovery?.attemptCount || 0),
      sendResidualRecoverySucceeded: !!sendResidualRecovery?.succeeded,
      sendResidualRecoveryCancelledByUserInput: !!sendResidualRecovery?.cancelledByUserInput,
      sendResidualRecoveryAttemptsExhausted: !!sendResidualRecovery?.attemptsExhausted,
      classification
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
    const shared = safeCall(bridge.getConnectorLifecycleSnapshot, getSharedConnectorLifecycleState());
    if (shared?.detected || shared?.latched) {
      flow.detected = !!shared.detected;
      flow.latched = !!shared.latched;
      flow.mentionSeen = true;
      flow.mentionSignalSource ||= shared.source || "unknown";
      flow.source = shared.source || flow.source || null;
    }
    flow.finalTextLength = snapshot?.textLength ?? flow.finalTextLength ?? 0;
    flow.staleRestorationObserved = !!session.staleTextRestoredAfterClear;
    flow.mentionSignalSource = flow.mentionSignalSource || null;
    flow.source = flow.source || flow.mentionSignalSource || null;
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

  function classifySendLifecycle(flow, snapshot) {
    if (!flow?.observed) return "INSUFFICIENT_SEND_EVIDENCE";
    if (!flow.userTurnCommittedLatched) return "SEND_NOT_COMMITTED";
    const finalTextLength = snapshot?.textLength ?? flow.finalTextLength ?? 0;
    const finalBodyLength = snapshot?.composerEditableBodyLength ?? flow.finalEditableBodyLength ?? finalTextLength;
    const connectorPillTextLength = snapshot?.connectorPillTextLength ?? flow.finalConnectorPillTextLength ?? 0;
    if (flow.staleFingerprintMatched || flow.stalePayloadReappeared) return "SEND_STALE_PAYLOAD_REAPPEARED";
    if (finalBodyLength === 0 && connectorPillTextLength > 0) return "SEND_BODY_CLEARED_CONNECTOR_CONTEXT_RETAINED";
    if (finalBodyLength > 0) return "SEND_NONMATCHING_TEXT_PRESENT";
    if (flow.firstComposerZeroElapsedMs !== null && finalBodyLength === 0) return "SEND_CLEARED_STABLE";
    return "INSUFFICIENT_SEND_EVIDENCE";
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
      sendLifecycle: report.sendLifecycle,
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

  function privateTextSnapshot(snapshot) {
    if (!snapshot || snapshot.textLength <= 0 || !snapshot.textHash) return null;
    return {
      elapsedMs: snapshot.elapsedMs,
      textLength: snapshot.textLength,
      textCanonicalLength: snapshot.textCanonicalLength,
      textHash: snapshot.textHash,
      composerRawTextLength: snapshot.composerRawTextLength,
      composerEditableBodyLength: snapshot.composerEditableBodyLength,
      composerEditableBodyCanonicalLength: snapshot.composerEditableBodyCanonicalLength,
      composerEditableBodyHash: snapshot.composerEditableBodyHash,
      connectorPillTextLength: snapshot.connectorPillTextLength,
      attachmentOrNonEditableTokenLength: snapshot.attachmentOrNonEditableTokenLength,
      editableId: snapshot.editableId,
      rootId: snapshot.rootId
    };
  }

  function matchesPreSendFingerprint(snapshot, flow) {
    if (!snapshot || !flow) return false;
    if (snapshot.composerEditableBodyHash && flow.preSendBodyHash) {
      return snapshot.composerEditableBodyCanonicalLength === flow.preSendBodyCanonicalLength
        && snapshot.composerEditableBodyHash === flow.preSendBodyHash;
    }
    return !!snapshot.textHash
      && !!flow.preSendHash
      && snapshot.textCanonicalLength === flow.preSendCanonicalLength
      && snapshot.textHash === flow.preSendHash;
  }

  function roundNullable(value) {
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  function getSharedConnectorLifecycleState() {
    return globalThis.MicaConnectorLifecycleSignal?.getState?.() || null;
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
    panelHost.style.pointerEvents = "auto";
    panelRoot = panelHost;
    attachPanelDelegatedListener();
    document.documentElement.appendChild(panelHost);
  }

  function attachPanelDelegatedListener() {
    if (panelDelegatedListenerAttached) {
      if (session) session.overlayHandlerAttached = true;
      return;
    }
    document.addEventListener("click", handlePanelDelegatedAction, true);
    panelDelegatedListenerAttached = true;
    if (session) session.overlayHandlerAttached = true;
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
    const copyButton = canCopyReport()
      ? `<button type="button" data-action="copy">Copy report</button>`
      : "";
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
    ${copyButton}
    <button type="button" data-action="stop">Stop</button>
  </div>
</section>`;
  }

  function handlePanelDelegatedAction(event) {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest?.("[data-mica-composer-diagnostics-root='true'] button[data-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.dataset.action;
    if (action !== "stop" && action !== "copy") return;
    recordOverlayAction(action, "received");
    if (action === "stop") {
      recordOverlayAction(action, "stopped");
      stop({ keepPanel: false });
      return;
    }
    if (action === "copy") {
      copyReportFromPanel().then((result) => {
        recordOverlayAction(action, result);
        renderPanel();
      });
    }
  }

  async function copyReportFromPanel() {
    const text = getReportText();
    if (!text) return "no_report";
    try {
      await copyText(text);
      return "copied";
    } catch (_error) {
      // Popup copy remains available if page clipboard access is denied.
      return "copy_failed";
    }
  }

  function recordOverlayAction(action, result) {
    if (!session) return;
    session.overlayHandlerAttached = panelDelegatedListenerAttached;
    session.lastOverlayActionReceived = action;
    session.lastOverlayActionSessionId = session.id;
    session.lastOverlayActionResult = result;
    addEvent("overlay_action_result", readSnapshot(), {
      action,
      sessionId: session.id,
      result
    });
  }

  function canCopyReport() {
    return !!navigator.clipboard?.writeText
      || document.queryCommandSupported?.("copy") === true
      || document.documentElement.dataset.micaFixture === "true";
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (document.queryCommandSupported?.("copy") !== true && document.documentElement.dataset.micaFixture !== "true") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    Object.assign(textarea.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      opacity: "0"
    });
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand?.("copy") === true;
    textarea.remove();
    return copied;
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

  function isTrustedInputEvent(event) {
    return event?.isTrusted === true || document.documentElement.dataset.micaFixture === "true";
  }

  function isLikelySendButton(button) {
    const signal = [
      button.getAttribute("aria-label"),
      button.getAttribute("data-testid"),
      button.textContent
    ].filter(Boolean).join(" ");
    return /send|submit|发送|送出/i.test(signal);
  }

  function isLikelySendKey(event) {
    return event?.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing;
  }

  function isConnectorChooserActiveNow() {
    const signal = safeCall(bridge.getConnectorLifecycleSnapshot, getSharedConnectorLifecycleState());
    return signal?.chooserActiveNow === true;
  }

  function isConnectorSelectionEnter(event) {
    if (event?.type !== "keydown" || event.key !== "Enter") return false;
    if (isConnectorChooserActiveNow()) return true;
    if (findActiveMentionChooser()) return true;
    const editable = getEventElement(event.target)?.closest?.("#prompt-textarea, [contenteditable], textarea, [role='textbox']");
    if (!(editable instanceof HTMLElement)) return false;
    const root = findComposerRoot(editable);
    if (hasResolvedConnectorContext(root, editable)) return false;
    return /(^|\s)@[\p{L}\p{N}_-]{0,64}$/u.test(readComposerText(editable).trimEnd());
  }

  function getEventElement(target) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Element) return target.closest("*");
    if (target instanceof CharacterData) return target.parentElement;
    return null;
  }

  function getComposerTextLength(element) {
    return readComposerText(element).length;
  }

  function extractComposerText(editable, root) {
    const rawText = readComposerText(editable);
    if (!(editable instanceof HTMLElement)) {
      return {
        rawText,
        editableBodyText: "",
        connectorPillTextLength: 0,
        attachmentOrNonEditableTokenLength: 0
      };
    }
    const clone = editable.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return {
        rawText,
        editableBodyText: rawText,
        connectorPillTextLength: 0,
        attachmentOrNonEditableTokenLength: 0
      };
    }
    const sourceRoot = root instanceof Element ? root : editable;
    const connectorPillTextLength = sumTextLength(sourceRoot, "[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:'], [data-inline-selection-pill][data-id^='plugin:'], [data-system-hint-type^='plugin:']");
    const nonEditableTextLength = sumTextLength(sourceRoot, "[contenteditable='false'], [data-inline-selection-pill], [data-system-hint-type]");
    for (const node of clone.querySelectorAll("[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:'], [data-inline-selection-pill][data-id^='plugin:'], [data-system-hint-type^='plugin:'], [contenteditable='false']")) {
      node.remove();
    }
    const editableBodyText = canonicalize(readComposerText(clone)).trim();
    return {
      rawText,
      editableBodyText,
      connectorPillTextLength,
      attachmentOrNonEditableTokenLength: Math.max(0, nonEditableTextLength - connectorPillTextLength)
    };
  }

  function sumTextLength(root, selector) {
    if (!(root instanceof Element)) return 0;
    let total = 0;
    const seen = new Set();
    if (root.matches?.(selector)) seen.add(root);
    for (const node of root.querySelectorAll(selector)) seen.add(node);
    for (const node of seen) total += String(node.textContent || "").length;
    return total;
  }

  function readComposerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || "";
    return element.textContent ?? element.innerText ?? "";
  }

  function canonicalize(value) {
    return String(value)
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "");
  }

  function fingerprintCanonical(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
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
    if (hasResolvedConnectorContext(root)) return { seen: true, source: "resolved-connector-pill" };
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
    if (isResolvedConnectorPill(node)) return "resolved-connector-pill";
    if (node.hasAttribute("data-mention") || node.hasAttribute("data-entity") || node.hasAttribute("data-token-type")) return "chip";
    const signal = [
      node.getAttribute("aria-label"),
      node.getAttribute("data-testid"),
      node.getAttribute("data-type"),
      node.getAttribute("role")
    ].filter(Boolean).join(" ");
    if (/connector|mention/i.test(signal)) return "structural-marker";
    if (node.getAttribute("aria-expanded") === "true" && node.hasAttribute("aria-controls")) return "chooser";
    return null;
  }

  function hasResolvedConnectorContext(root, editable) {
    return hasResolvedConnectorPill(root) || hasResolvedConnectorPill(editable);
  }

  function hasResolvedConnectorPill(root) {
    if (!(root instanceof Element)) return false;
    if (isResolvedConnectorPill(root)) return true;
    return !!root.querySelector?.("[data-inline-selection-pill][data-symbol='ecosystemMention'][data-id^='plugin:'], [data-inline-selection-pill][data-id^='plugin:'], [data-system-hint-type^='plugin:']");
  }

  function isResolvedConnectorPill(node) {
    return node instanceof Element
      && node.hasAttribute("data-inline-selection-pill")
      && (node.getAttribute("data-symbol") === "ecosystemMention" || String(node.getAttribute("data-id") || "").startsWith("plugin:"));
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
      "[role='menu'][aria-activedescendant]",
      "[role='dialog'] [role='option']",
      "[role='dialog'] [role='menuitem']",
      "[data-radix-collection-item]"
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof Element) || node.closest("[data-mica-root='true']") || node.closest("[data-mica-composer-diagnostics-root='true']")) continue;
        const owner = node.closest("[role='listbox'], [role='menu'], [role='dialog']") || node;
        if (isLikelyChooser(owner) || node.hasAttribute("data-radix-collection-item")) return owner;
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
    return /listbox|menu|dialog/i.test(signal)
      || (node.getAttribute("aria-expanded") === "true" && node.hasAttribute("aria-controls"))
      || node.hasAttribute("data-radix-collection-item");
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
    recordStaleRecoveryEvent,
    recordConnectorContinuityEvent,
    recordSendResidualRecoveryEvent
  };
})();
