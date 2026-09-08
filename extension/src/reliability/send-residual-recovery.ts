(() => {
  const GLOBAL_KEY = "MicaSendResidualRecovery";
  const SAMPLE_INTERVAL_MS = 80;
  const HARD_LIFETIME_MS = 5600;
  const SETTLE_MS = 160;
  const VERIFY_MS = 240;
  const NONMATCHING_GRACE_MS = 700;
  const MIN_PARTIAL_RESIDUAL_LENGTH = 8;
  const MAX_ATTEMPTS = 3;
  const SEND_CANDIDATE_WINDOW_MS = 3200;

  const defaultBridge = {
    countUserTurns: () => countUserTurns(),
    getConnectorLifecycleSnapshot: () => getSharedConnectorLifecycleState()
  };

  let bridge = { ...defaultBridge };
  let configured = false;
  let enabled = false;
  let listenersAttached = false;
  let ids = new WeakMap();
  let nextId = 1;
  let generationId = 0;
  let candidateId = 0;
  let sendCandidate = null;
  let generation = null;
  let timer = 0;
  let hardTimer = 0;
  let settleTimer = 0;
  let recoveryApplying = false;
  let lastReport = createEmptyReport();

  function configure(options = {}) {
    configured = true;
    bridge = { ...bridge, ...(options.bridge || {}) };
    setEnabled(options.enabled === true);
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    if (enabled) {
      attachListeners();
      return;
    }
    finishCandidate("disabled");
    cancelGeneration("disabled");
    detachListeners();
  }

  function getState() {
    return {
      ...lastReport,
      skippedReason: enabled ? (lastReport.generationId ? lastReport.skippedReason : "no_send_generation") : "disabled",
      enabled,
      listenersAttached,
      active: !!generation,
      sendCandidateActive: !!sendCandidate,
      guardActive: !!timer
    };
  }

  function resetForTests() {
    cancelGeneration("reset");
    ids = new WeakMap();
    nextId = 1;
    generationId = 0;
    candidateId = 0;
    sendCandidate = null;
    lastReport = createEmptyReport();
  }

  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("beforeinput", handleBeforeInput, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("paste", handleUserInput, true);
    document.addEventListener("compositionstart", handleUserInput, true);
    document.addEventListener("compositionupdate", handleUserInput, true);
    document.addEventListener("compositionend", handleUserInput, true);
    addEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    document.removeEventListener("submit", handleSubmit, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeydown, true);
    document.removeEventListener("beforeinput", handleBeforeInput, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("paste", handleUserInput, true);
    document.removeEventListener("compositionstart", handleUserInput, true);
    document.removeEventListener("compositionupdate", handleUserInput, true);
    document.removeEventListener("compositionend", handleUserInput, true);
    removeEventListener("pagehide", handleNavigationCleanup, { capture: true });
    listenersAttached = false;
  }

  function handleNavigationCleanup() {
    cancelGeneration("navigation");
  }

  function handleSubmit(event) {
    if (!shouldObserveEvent(event) || !isComposerEventTarget(event.target)) return;
    captureSendCandidate("submit");
  }

  function handleClick(event) {
    if (!shouldObserveEvent(event) || !isComposerEventTarget(event.target)) return;
    const button = getEventElement(event.target)?.closest?.("button, [role='button']");
    if (!(button instanceof HTMLElement) || !isLikelySendButton(button)) return;
    captureSendCandidate("click");
  }

  function handleKeydown(event) {
    if (!shouldObserveEvent(event) || !isLikelySendKey(event) || !isComposerEventTarget(event.target)) return;
    if (isConnectorSelectionEnter(event)) return;
    captureSendCandidate("enter");
  }

  function handleBeforeInput(event) {
    if (!shouldObserveEvent(event)) return;
    const inputType = getInputType(event);
    if (isInsertLikeInputType(inputType)) handleUserInput(event);
  }

  function handleInput(event) {
    if (!shouldObserveEvent(event)) return;
    const inputType = getInputType(event);
    if (isInsertLikeInputType(inputType)) handleUserInput(event);
  }

  function handleUserInput(event) {
    if (!shouldObserveEvent(event) || recoveryApplying || !generation?.userTurnCommittedLatched) return;
    cancelGeneration("new_user_input");
  }

  function captureSendCandidate(source) {
    const snapshot = readComposerSnapshot();
    if (!snapshot.exists || snapshot.bodyTextLength <= 0) return;
    const mentionSignal = detectMentionSignal(snapshot.root, snapshot.editable);
    const connectorLifecycle = safeCall(bridge.getConnectorLifecycleSnapshot, getSharedConnectorLifecycleState());
    const connectorLifecycleLatched = !!(connectorLifecycle?.latched || mentionSignal.seen);
    const canonical = canonicalize(snapshot.text);
    const bodyCanonical = canonicalize(snapshot.bodyText);
    const hash = fingerprintCanonical(canonical);
    candidateId += 1;
    sendCandidate = {
      candidateId,
      source,
      startedAt: Date.now(),
      preSendLength: snapshot.textLength,
      preSendCanonical: canonical,
      preSendBodyLength: snapshot.bodyTextLength,
      preSendBodyCanonical: bodyCanonical,
      preSendBodyCanonicalLength: bodyCanonical.length,
      preSendBodyHash: bodyCanonical ? fingerprintCanonical(bodyCanonical) : null,
      preSendCanonicalLength: canonical.length,
      preSendHash: hash,
      preSendFingerprintCaptured: true,
      mentionSignalObserved: mentionSignal.seen || !!connectorLifecycle?.detected,
      mentionSignalSource: mentionSignal.source || connectorLifecycle?.source || null,
      connectorLifecycleDetected: !!(connectorLifecycle?.detected || mentionSignal.seen),
      connectorLifecycleLatched,
      connectorChooserActiveAtGesture: !!connectorLifecycle?.chooserActiveNow,
      selectionWindowActiveAtGesture: !!connectorLifecycle?.selectionWindowActive,
      baselineUserTurns: safeCall(bridge.countUserTurns, countUserTurns()),
      lastUserTurns: safeCall(bridge.countUserTurns, countUserTurns()),
      previousComposerExists: snapshot.exists,
      unmountSeen: false,
      remountSeen: false,
      classification: "PENDING_COMMIT"
    };
    lastReport = reportFromCandidate(sendCandidate, snapshot);
    record("send_residual_candidate_created", {
      candidateId: sendCandidate.candidateId,
      source,
      preSendLength: sendCandidate.preSendLength,
      mentionSignalObserved: sendCandidate.mentionSignalObserved,
      mentionSignalSource: sendCandidate.mentionSignalSource,
      connectorLifecycleLatched: sendCandidate.connectorLifecycleLatched,
      chooserActiveNow: !!connectorLifecycle?.chooserActiveNow,
      selectionWindowActive: !!connectorLifecycle?.selectionWindowActive
    });
    ensureCandidateTimer();
  }

  function promoteCandidateToGeneration(snapshot, delta) {
    if (!sendCandidate) return;
    generationId += 1;
    const promoted = sendCandidate;
    sendCandidate = null;
    generation = {
      generationId,
      phase: "COMMITTED",
      source: promoted.source,
      startedAt: promoted.startedAt,
      preSendLength: promoted.preSendLength,
      preSendCanonical: promoted.preSendCanonical,
      preSendBodyCanonical: promoted.preSendBodyCanonical,
      preSendBodyLength: promoted.preSendBodyLength,
      preSendBodyCanonicalLength: promoted.preSendBodyCanonicalLength,
      preSendBodyHash: promoted.preSendBodyHash,
      preSendCanonicalLength: promoted.preSendCanonicalLength,
      preSendHash: promoted.preSendHash,
      preSendFingerprintCaptured: promoted.preSendFingerprintCaptured,
      mentionSignalObserved: promoted.mentionSignalObserved,
      mentionSignalSource: promoted.mentionSignalSource,
      connectorLifecycleDetected: promoted.connectorLifecycleDetected,
      connectorLifecycleLatched: promoted.connectorLifecycleLatched,
      baselineUserTurns: promoted.baselineUserTurns,
      lastUserTurns: safeCall(bridge.countUserTurns, countUserTurns()),
      userTurnCommitSignalObserved: false,
      userTurnCommittedLatched: false,
      userTurnDelta: 0,
      userTurnDeltaHistory: [],
      firstCommitAt: 0,
      firstComposerZeroAt: 0,
      firstComposerZeroBeforeRecoveryAt: 0,
      unmountCountAfterSend: 0,
      mountCountAfterSend: 0,
      previousComposerExists: snapshot.exists,
      stalePayloadReappeared: false,
      staleFingerprintMatched: false,
      staleProvenanceMatched: false,
      staleProvenanceReason: null,
      staleReappearanceElapsedMs: null,
      attemptCount: 0,
      succeeded: false,
      cancelledByUserInput: false,
      nonmatchingTextObserved: false,
      nonmatchingFirstAt: 0,
      attemptsExhausted: false,
      recoveryEvidencePath: null,
      finalTextLength: snapshot.textLength,
      finalComposerPresent: snapshot.exists,
      cleanupReason: null
    };
    recordPromotedUserTurnDelta(delta, snapshot);
    lastReport = reportFromGeneration(generation, snapshot);
    record("send_residual_candidate_promoted", {
      generationId: generation.generationId,
      candidateId: promoted.candidateId,
      source: promoted.source,
      preSendLength: generation.preSendLength,
      mentionSignalObserved: generation.mentionSignalObserved,
      mentionSignalSource: generation.mentionSignalSource,
      connectorLifecycleLatched: generation.connectorLifecycleLatched,
      skippedReason: skipReasonFor(generation)
    });
    record("send_residual_pre_send_captured", {
      generationId: generation.generationId,
      source: promoted.source,
      preSendLength: generation.preSendLength,
      mentionSignalObserved: generation.mentionSignalObserved,
      mentionSignalSource: generation.mentionSignalSource,
      connectorLifecycleLatched: generation.connectorLifecycleLatched,
      skippedReason: skipReasonFor(generation)
    });
    ensureGenerationTimers();
  }

  function recordPromotedUserTurnDelta(delta, snapshot) {
    if (!generation) return;
    generation.userTurnCommitSignalObserved = true;
    generation.userTurnCommittedLatched = true;
    generation.firstCommitAt = Date.now();
    generation.userTurnDelta = safeCall(bridge.countUserTurns, snapshot.userTurns) - generation.baselineUserTurns;
    generation.userTurnDeltaHistory.push({
      elapsedMs: elapsedMs(generation),
      delta,
      totalDelta: generation.userTurnDelta
    });
    generation.phase = "COMMITTED";
    record("send_residual_commit_latched", {
      generationId: generation.generationId,
      delta,
      totalDelta: generation.userTurnDelta,
      connectorLifecycleLatched: generation.connectorLifecycleLatched,
      armed: isArmed(generation),
      skippedReason: skipReasonFor(generation)
    });
    if (isArmed(generation)) record("send_residual_armed", { generationId: generation.generationId });
  }

  function ensureCandidateTimer() {
    if (timer) return;
    timer = setInterval(tick, SAMPLE_INTERVAL_MS);
    tick();
  }

  function ensureGenerationTimers() {
    clearTimers();
    timer = setInterval(tick, SAMPLE_INTERVAL_MS);
    hardTimer = setTimeout(() => finishGeneration("hard_cap"), HARD_LIFETIME_MS);
    tick();
  }

  function tick() {
    if (sendCandidate && !generation) {
      tickCandidate();
      return;
    }
    if (!generation) return;
    const snapshot = readComposerSnapshot();
    trackUserTurnDelta(snapshot);
    trackComposerPresence(snapshot);
    generation.finalTextLength = snapshot.textLength;
    generation.finalComposerPresent = snapshot.exists;

    if (!generation.userTurnCommittedLatched) {
      lastReport = reportFromGeneration(generation, snapshot);
      return;
    }
    if (snapshot.exists && snapshot.bodyTextLength === 0) {
      if (!generation.firstComposerZeroAt) generation.firstComposerZeroAt = Date.now();
      if (!generation.firstComposerZeroBeforeRecoveryAt && generation.attemptCount === 0) {
        generation.firstComposerZeroBeforeRecoveryAt = Date.now();
      }
      generation.phase = generation.succeeded ? "TOMBSTONE" : "EMPTY_STABLE";
      lastReport = reportFromGeneration(generation, snapshot);
      return;
    }
    if (!snapshot.exists || snapshot.bodyTextLength <= 0) {
      lastReport = reportFromGeneration(generation, snapshot);
      return;
    }
    if (!hasPostSendInvalidationEvidence(generation)) {
      lastReport = reportFromGeneration(generation, snapshot);
      return;
    }
    if (!canRecoverGeneration(generation)) {
      lastReport = reportFromGeneration(generation, snapshot);
      return;
    }
    const provenance = matchPreSendProvenance(snapshot, generation);
    if (!provenance.matched) {
      generation.nonmatchingTextObserved = true;
      generation.phase = "NONMATCHING_TEXT_PRESENT";
      lastReport = reportFromGeneration(generation, snapshot);
      if (!generation.nonmatchingFirstAt) generation.nonmatchingFirstAt = Date.now();
      if (Date.now() - generation.nonmatchingFirstAt >= NONMATCHING_GRACE_MS) finishGeneration("nonmatching_text", snapshot);
      return;
    }
    generation.nonmatchingFirstAt = 0;
    generation.stalePayloadReappeared = true;
    generation.staleFingerprintMatched = provenance.reason === "exact_full";
    generation.staleProvenanceMatched = true;
    generation.staleProvenanceReason = provenance.reason;
    generation.phase = "SETTLING";
    if (generation.staleReappearanceElapsedMs === null) {
      generation.staleReappearanceElapsedMs = Date.now() - generation.firstCommitAt;
      record("send_residual_same_payload_reappeared", {
        generationId: generation.generationId,
        staleReappearanceElapsedMs: Math.round(generation.staleReappearanceElapsedMs),
        newLength: snapshot.textLength,
        provenanceReason: generation.staleProvenanceReason
      });
    }
    scheduleSettledAttempt(generation.generationId);
    lastReport = reportFromGeneration(generation, snapshot);
  }

  function tickCandidate() {
    if (!sendCandidate) return;
    const snapshot = readComposerSnapshot();
    trackCandidateUserTurnDelta(snapshot);
    if (!sendCandidate) return;
    trackCandidateComposerPresence(snapshot);
    if (!sendCandidate) return;
    if ((sendCandidate.remountSeen || sendCandidate.unmountSeen) && hasResolvedConnectorContext(snapshot.root, snapshot.editable)) {
      finishCandidate("connector_selection", snapshot);
      return;
    }
    if (Date.now() - sendCandidate.startedAt >= SEND_CANDIDATE_WINDOW_MS) {
      finishCandidate("expired", snapshot);
      return;
    }
    lastReport = reportFromCandidate(sendCandidate, snapshot);
  }

  function trackCandidateUserTurnDelta(snapshot) {
    if (!sendCandidate) return;
    const current = safeCall(bridge.countUserTurns, snapshot.userTurns);
    if (current === sendCandidate.lastUserTurns) return;
    const delta = current - sendCandidate.lastUserTurns;
    sendCandidate.lastUserTurns = current;
    if (delta > 0) {
      promoteCandidateToGeneration(snapshot, delta);
    }
  }

  function trackCandidateComposerPresence(snapshot) {
    if (!sendCandidate) return;
    const previous = sendCandidate.previousComposerExists;
    if (previous && !snapshot.exists) sendCandidate.unmountSeen = true;
    if (!previous && snapshot.exists) sendCandidate.remountSeen = true;
    sendCandidate.previousComposerExists = snapshot.exists;
  }

  function finishCandidate(reason, snapshot = readComposerSnapshot()) {
    if (!sendCandidate) return;
    const discarded = sendCandidate;
    discarded.classification = reason === "connector_selection" ? "CONNECTOR_SELECTION" : "INSUFFICIENT_SEND_EVIDENCE";
    record("send_residual_candidate_discarded", {
      candidateId: discarded.candidateId,
      source: discarded.source,
      classification: discarded.classification,
      unmountSeen: !!discarded.unmountSeen,
      remountSeen: !!discarded.remountSeen,
      resolvedConnectorContext: hasResolvedConnectorContext(snapshot.root, snapshot.editable)
    });
    lastReport = reportFromCandidate(discarded, snapshot, reason);
    sendCandidate = null;
    if (!generation) clearTimers();
  }

  function trackUserTurnDelta(snapshot) {
    if (!generation) return;
    const current = safeCall(bridge.countUserTurns, snapshot.userTurns);
    if (current === generation.lastUserTurns) return;
    const delta = current - generation.lastUserTurns;
    generation.lastUserTurns = current;
    generation.userTurnDelta = current - generation.baselineUserTurns;
    generation.userTurnDeltaHistory.push({
      elapsedMs: elapsedMs(generation),
      delta,
      totalDelta: generation.userTurnDelta
    });
    if (generation.userTurnDeltaHistory.length > 12) generation.userTurnDeltaHistory.shift();
    if (delta > 0 && !generation.userTurnCommittedLatched) {
      generation.userTurnCommitSignalObserved = true;
      generation.userTurnCommittedLatched = true;
      generation.firstCommitAt = Date.now();
      generation.phase = "COMMITTED";
      record("send_residual_commit_latched", {
        generationId: generation.generationId,
        delta,
        totalDelta: generation.userTurnDelta,
        connectorLifecycleLatched: generation.connectorLifecycleLatched,
        armed: isArmed(generation),
        skippedReason: skipReasonFor(generation)
      });
      if (isArmed(generation)) record("send_residual_armed", { generationId: generation.generationId });
    }
  }

  function trackComposerPresence(snapshot) {
    if (!generation) return;
    const previous = generation.previousComposerExists;
    if (previous && !snapshot.exists && generation.userTurnCommittedLatched) generation.unmountCountAfterSend += 1;
    if (!previous && snapshot.exists && generation.userTurnCommittedLatched) generation.mountCountAfterSend += 1;
    generation.previousComposerExists = snapshot.exists;
  }

  function scheduleSettledAttempt(expectedGenerationId) {
    if (settleTimer || !generation || generation.attemptCount >= MAX_ATTEMPTS) return;
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (!generation || generation.generationId !== expectedGenerationId) return;
      const snapshot = readComposerSnapshot();
      if (!snapshot.exists || !matchPreSendProvenance(snapshot, generation).matched) return;
      attemptRecovery(snapshot);
    }, SETTLE_MS);
  }

  function attemptRecovery(snapshot) {
    if (!generation || generation.attemptCount >= MAX_ATTEMPTS) {
      markAttemptsExhausted(snapshot);
      return;
    }
    generation.phase = "RECOVERING";
    generation.attemptCount += 1;
    generation.recoveryEvidencePath = generation.firstComposerZeroBeforeRecoveryAt ? "composer_clear" : "post_send_remount";
    record("send_residual_recovery_attempt", {
      generationId: generation.generationId,
      attemptCount: generation.attemptCount,
      oldLength: generation.preSendLength,
      newLength: snapshot.textLength,
      recoveryEvidencePath: generation.recoveryEvidencePath
    });
    recoveryApplying = true;
    const attempted = nativeDeleteComposerContents(snapshot.editable);
    recoveryApplying = false;
    setTimeout(() => verifyRecovery(attempted), VERIFY_MS);
  }

  function verifyRecovery(attempted) {
    if (!generation) return;
    const snapshot = readComposerSnapshot();
    if (attempted && snapshot.exists && snapshot.bodyTextLength === 0) {
      generation.succeeded = true;
      generation.phase = "TOMBSTONE";
      generation.finalTextLength = snapshot.textLength;
      generation.finalComposerPresent = true;
      record("send_residual_recovery_success", {
        generationId: generation.generationId,
        attemptCount: generation.attemptCount
      });
      lastReport = reportFromGeneration(generation, snapshot);
      return;
    }
    if (generation.attemptCount >= MAX_ATTEMPTS) {
      markAttemptsExhausted(snapshot);
      return;
    }
    generation.phase = "COMMITTED";
    lastReport = reportFromGeneration(generation, snapshot);
  }

  function markAttemptsExhausted(snapshot = readComposerSnapshot()) {
    if (!generation) return;
    generation.attemptsExhausted = true;
    generation.phase = "EXHAUSTED";
    record("send_residual_attempts_exhausted", {
      generationId: generation.generationId,
      attemptCount: generation.attemptCount,
      maxAttempts: MAX_ATTEMPTS
    });
    finishGeneration("attempts_exhausted", snapshot);
  }

  function finishGeneration(reason, snapshot = readComposerSnapshot()) {
    if (!generation) return;
    generation.cleanupReason = reason;
    lastReport = reportFromGeneration(generation, snapshot);
    generation = null;
    clearTimers();
  }

  function cancelGeneration(reason) {
    if (!generation) {
      clearTimers();
      return;
    }
    if (reason === "new_user_input") {
      generation.cancelledByUserInput = true;
      record("send_residual_cancelled_new_input", {
        generationId: generation.generationId,
        attemptCount: generation.attemptCount
      });
    }
    finishGeneration(reason);
  }

  function clearTimers() {
    if (timer) clearInterval(timer);
    if (hardTimer) clearTimeout(hardTimer);
    if (settleTimer) clearTimeout(settleTimer);
    timer = 0;
    hardTimer = 0;
    settleTimer = 0;
  }

  function canRecoverGeneration(active) {
    return !!active
      && active.preSendFingerprintCaptured
      && active.connectorLifecycleLatched
      && active.userTurnCommittedLatched
      && hasPostSendInvalidationEvidence(active)
      && !active.cancelledByUserInput
      && !active.attemptsExhausted;
  }

  function hasPostSendInvalidationEvidence(active) {
    return !!active?.firstComposerZeroBeforeRecoveryAt || (!!active?.unmountCountAfterSend && !!active?.mountCountAfterSend);
  }

  function isArmed(active) {
    return !!active
      && active.preSendFingerprintCaptured
      && active.connectorLifecycleLatched
      && active.userTurnCommittedLatched;
  }

  function skipReasonFor(active) {
    if (!enabled) return "disabled";
    if (!active) return "no_send_generation";
    if (!active.preSendFingerprintCaptured) return "no_pre_send_fingerprint";
    if (!active.connectorLifecycleLatched) return "no_connector_lifecycle_latch";
    if (!active.userTurnCommittedLatched) return "waiting_for_user_turn_commit";
    if (!hasPostSendInvalidationEvidence(active)) return "waiting_for_clear_or_remount";
    if (active.cancelledByUserInput) return "cancelled_new_user_input";
    if (active.attemptsExhausted) return "attempts_exhausted";
    if (active.nonmatchingTextObserved && !active.staleFingerprintMatched) return "nonmatching_text";
    return null;
  }

  function reportFromGeneration(active, snapshot = readComposerSnapshot()) {
    if (!active) return createEmptyReport();
    return {
      generationId: active.generationId,
      phase: active.phase,
      source: active.source,
      preSendLength: active.preSendLength,
      preSendBodyLength: active.preSendBodyLength || 0,
      preSendFingerprintCaptured: active.preSendFingerprintCaptured,
      mentionSignalObserved: active.mentionSignalObserved,
      mentionSignalSource: active.mentionSignalSource,
      connectorLifecycleDetected: !!active.connectorLifecycleDetected,
      connectorLifecycleLatched: !!active.connectorLifecycleLatched,
      userTurnCommitSignalObserved: active.userTurnCommitSignalObserved,
      userTurnCommittedLatched: active.userTurnCommittedLatched,
      userTurnDelta: active.userTurnDelta,
      userTurnDeltaHistory: active.userTurnDeltaHistory.slice(),
      composerUnmountCountAfterSend: active.unmountCountAfterSend,
      composerMountCountAfterSend: active.mountCountAfterSend,
      observedComposerClearPath: !!active.firstComposerZeroBeforeRecoveryAt,
      postSendRemountPath: !!(active.unmountCountAfterSend && active.mountCountAfterSend),
      recoveryEvidencePath: active.recoveryEvidencePath,
      stalePayloadReappeared: active.stalePayloadReappeared,
      staleFingerprintMatched: active.staleFingerprintMatched,
      staleProvenanceMatched: active.staleProvenanceMatched,
      staleProvenanceReason: active.staleProvenanceReason,
      staleReappearanceElapsedMs: roundNullable(active.staleReappearanceElapsedMs),
      attemptCount: active.attemptCount,
      armed: isArmed(active),
      skippedReason: skipReasonFor(active),
      succeeded: active.succeeded,
      cancelledByUserInput: active.cancelledByUserInput,
      nonmatchingTextObserved: active.nonmatchingTextObserved,
      attemptsExhausted: active.attemptsExhausted,
      finalTextLength: snapshot.textLength,
      finalEditableBodyLength: snapshot.bodyTextLength,
      connectorPillTextLength: snapshot.connectorPillTextLength,
      finalComposerPresent: snapshot.exists,
      maxAttempts: MAX_ATTEMPTS,
      hardLifetimeMs: HARD_LIFETIME_MS,
      nonmatchingGraceMs: NONMATCHING_GRACE_MS,
      minPartialResidualLength: MIN_PARTIAL_RESIDUAL_LENGTH,
      elapsedMs: elapsedMs(active),
      cleanupReason: active.cleanupReason
    };
  }

  function reportFromCandidate(candidate, snapshot = readComposerSnapshot(), reason = null) {
    if (!candidate) return createEmptyReport();
    const classification = candidate.classification
      || (reason === "connector_selection" ? "CONNECTOR_SELECTION" : "INSUFFICIENT_SEND_EVIDENCE");
    return {
      generationId,
      phase: "CANDIDATE",
      source: candidate.source,
      preSendLength: candidate.preSendLength,
      preSendBodyLength: candidate.preSendBodyLength || 0,
      preSendFingerprintCaptured: candidate.preSendFingerprintCaptured,
      mentionSignalObserved: candidate.mentionSignalObserved,
      mentionSignalSource: candidate.mentionSignalSource,
      connectorLifecycleDetected: !!candidate.connectorLifecycleDetected,
      connectorLifecycleLatched: !!candidate.connectorLifecycleLatched,
      userTurnCommitSignalObserved: false,
      userTurnCommittedLatched: false,
      userTurnDelta: 0,
      userTurnDeltaHistory: [],
      composerUnmountCountAfterSend: 0,
      composerMountCountAfterSend: 0,
      observedComposerClearPath: false,
      postSendRemountPath: false,
      recoveryEvidencePath: null,
      stalePayloadReappeared: false,
      staleFingerprintMatched: false,
      staleProvenanceMatched: false,
      staleProvenanceReason: null,
      staleReappearanceElapsedMs: null,
      attemptCount: 0,
      armed: false,
      skippedReason: reason || "waiting_for_user_turn_commit",
      succeeded: false,
      cancelledByUserInput: false,
      nonmatchingTextObserved: false,
      attemptsExhausted: false,
      finalTextLength: snapshot.textLength,
      finalEditableBodyLength: snapshot.bodyTextLength,
      connectorPillTextLength: snapshot.connectorPillTextLength,
      finalComposerPresent: snapshot.exists,
      maxAttempts: MAX_ATTEMPTS,
      hardLifetimeMs: HARD_LIFETIME_MS,
      nonmatchingGraceMs: NONMATCHING_GRACE_MS,
      minPartialResidualLength: MIN_PARTIAL_RESIDUAL_LENGTH,
      elapsedMs: Date.now() - candidate.startedAt,
      cleanupReason: reason,
      sendCandidateActive: reason ? false : true,
      sendCandidateId: candidate.candidateId,
      sendCandidateClassification: classification,
      sendCandidateUnmountSeen: !!candidate.unmountSeen,
      sendCandidateRemountSeen: !!candidate.remountSeen
    };
  }

  function createEmptyReport() {
    return {
      generationId,
      phase: "IDLE",
      source: null,
      preSendLength: 0,
      preSendBodyLength: 0,
      preSendFingerprintCaptured: false,
      mentionSignalObserved: false,
      mentionSignalSource: null,
      connectorLifecycleDetected: false,
      connectorLifecycleLatched: false,
      userTurnCommitSignalObserved: false,
      userTurnCommittedLatched: false,
      userTurnDelta: 0,
      userTurnDeltaHistory: [],
      composerUnmountCountAfterSend: 0,
      composerMountCountAfterSend: 0,
      observedComposerClearPath: false,
      postSendRemountPath: false,
      recoveryEvidencePath: null,
      stalePayloadReappeared: false,
      staleFingerprintMatched: false,
      staleProvenanceMatched: false,
      staleProvenanceReason: null,
      staleReappearanceElapsedMs: null,
      attemptCount: 0,
      armed: false,
      skippedReason: enabled ? "no_send_generation" : "disabled",
      succeeded: false,
      cancelledByUserInput: false,
      nonmatchingTextObserved: false,
      attemptsExhausted: false,
      finalTextLength: 0,
      finalEditableBodyLength: 0,
      connectorPillTextLength: 0,
      finalComposerPresent: false,
      maxAttempts: MAX_ATTEMPTS,
      hardLifetimeMs: HARD_LIFETIME_MS,
      nonmatchingGraceMs: NONMATCHING_GRACE_MS,
      minPartialResidualLength: MIN_PARTIAL_RESIDUAL_LENGTH,
      elapsedMs: 0,
      cleanupReason: null
    };
  }

  function readComposerSnapshot() {
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    const parts = extractComposerText(editable, root);
    const text = parts.rawText;
    return {
      exists: !!editable,
      editable,
      root,
      editableId: elementId(editable),
      rootId: elementId(root),
      text,
      textLength: text.length,
      bodyText: parts.editableBodyText,
      bodyTextLength: parts.editableBodyText.length,
      connectorPillTextLength: parts.connectorPillTextLength,
      attachmentOrNonEditableTokenLength: parts.attachmentOrNonEditableTokenLength,
      userTurns: safeCall(bridge.countUserTurns, countUserTurns())
    };
  }

  function matchesPreSendPayload(text, active) {
    return matchPreSendProvenance(text, active).matched;
  }

  function matchPreSendProvenance(snapshotOrText, active) {
    if (!active) return { matched: false, reason: null };
    const candidateText = typeof snapshotOrText === "string"
      ? canonicalizeConnectorBody(canonicalize(snapshotOrText))
      : canonicalize(snapshotOrText?.bodyText || "");
    const canonical = canonicalize(candidateText);
    if (!canonical) return { matched: false, reason: null };
    if (canonical.length === active.preSendBodyCanonicalLength && active.preSendBodyHash && fingerprintCanonical(canonical) === active.preSendBodyHash) {
      return { matched: true, reason: "exact_full" };
    }
    if (canonical.length < MIN_PARTIAL_RESIDUAL_LENGTH) return { matched: false, reason: null };
    if (typeof active.preSendBodyCanonical === "string" && active.preSendBodyCanonical.includes(canonical)) {
      return { matched: true, reason: "partial_substring" };
    }
    if (typeof active.preSendBodyCanonical === "string" && active.preSendBodyCanonical.length >= MIN_PARTIAL_RESIDUAL_LENGTH) {
      if (canonical === active.preSendBodyCanonical || active.preSendBodyCanonical.includes(canonical)) {
        return { matched: true, reason: "connector_body_subset" };
      }
    }
    return { matched: false, reason: null };
  }

  function canonicalizeConnectorBody(canonical) {
    return String(canonical)
      .replace(/(^|\s)@[\p{L}\p{N}_-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function nativeDeleteComposerContents(editable) {
    if (!(editable instanceof HTMLElement)) return false;
    try {
      editable.focus({ preventScroll: true });
    } catch (_error) {
      editable.focus();
    }
    try {
      if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
        editable.setSelectionRange(0, editable.value.length);
      } else {
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return document.execCommand?.("delete") === true || readComposerText(editable).length === 0;
    } catch (_error) {
      return false;
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
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement) || isMicaNode(node) || node.hidden || node.getAttribute("aria-hidden") === "true") continue;
        return node;
      }
    }
    return null;
  }

  function findComposerRoot(element) {
    if (!(element instanceof Element)) return null;
    return element.closest("[data-testid*='composer'], form") || element.parentElement;
  }

  function isComposerEventTarget(target) {
    const element = getEventElement(target);
    if (!element || isMicaNode(element)) return false;
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    if (editable && (element === editable || editable.contains(element) || element.contains(editable))) return true;
    if (root && (element === root || root.contains(element))) return true;
    return !!element.closest("#prompt-textarea, [data-testid*='composer'], textarea, [contenteditable][role='textbox'], [role='textbox']");
  }

  function detectMentionSignal(root, editable) {
    const rootSignal = detectMentionSignalInRoot(root);
    if (rootSignal.seen) return rootSignal;
    const editableSignal = detectMentionSignalInRoot(editable);
    if (editableSignal.seen) return editableSignal;
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
        if (!(node instanceof Element) || isMicaNode(node)) continue;
        const owner = node.closest("[role='listbox'], [role='menu'], [role='dialog']") || node;
        const signal = [owner.getAttribute("role"), owner.getAttribute("aria-label"), owner.getAttribute("data-testid")].filter(Boolean).join(" ");
        const chooserRole = /listbox|menu|dialog/i.test(signal);
        const controlledOpenChooser = owner.getAttribute("aria-expanded") === "true" && owner.hasAttribute("aria-controls");
        const collectionOption = node.hasAttribute("data-radix-collection-item");
        if (chooserRole || controlledOpenChooser || collectionOption) return owner;
      }
    }
    return null;
  }

  function countUserTurns() {
    const main = document.querySelector("main") || document.body;
    if (!main) return 0;
    return Array.from(main.querySelectorAll("[data-message-author-role='user']")).length;
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

  function getInputType(event) {
    return typeof event?.inputType === "string" ? event.inputType : null;
  }

  function isInsertLikeInputType(inputType) {
    return typeof inputType === "string" && /^insert|paste|composition/i.test(inputType);
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

  function shouldObserveEvent(event) {
    return enabled && configured && !recoveryApplying && isTrustedEvent(event);
  }

  function isTrustedEvent(event) {
    return event?.isTrusted === true || document.documentElement.dataset.micaFixture === "true";
  }

  function getEventElement(target) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Element) return target.closest("*");
    if (target instanceof CharacterData) return target.parentElement;
    return null;
  }

  function isMicaNode(node) {
    return !!node.closest?.("[data-mica-root='true'], [data-mica-composer-diagnostics-root='true'], [data-mica-connector-continuity-shell='true']");
  }

  function elementId(element) {
    if (!(element instanceof Element)) return null;
    if (!ids.has(element)) ids.set(element, nextId++);
    return ids.get(element);
  }

  function elapsedMs(active) {
    return active?.startedAt ? Math.max(0, Date.now() - active.startedAt) : 0;
  }

  function roundNullable(value) {
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  function safeCall(fn, fallback) {
    try {
      const value = typeof fn === "function" ? fn() : fallback;
      return value === undefined ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  function getSharedConnectorLifecycleState() {
    return globalThis.MicaConnectorLifecycleSignal?.getState?.() || null;
  }

  function record(type, details = {}) {
    const api = globalThis.MicaComposerDiagnostics;
    if (!api || typeof api.recordSendResidualRecoveryEvent !== "function" || api.isActive?.() !== true) return;
    api.recordSendResidualRecoveryEvent(type, details);
  }

  globalThis[GLOBAL_KEY] = {
    configure,
    setEnabled,
    getState,
    resetForTests
  };
})();
