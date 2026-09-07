(() => {
  const GLOBAL_KEY = "MicaStaleComposerRecovery";
  const GUARD_DURATION_MS = 2600;
  const HARD_GUARD_CAP_MS = 5500;
  const SAMPLE_INTERVAL_MS = 80;
  const SETTLE_MS = 180;
  const VERIFY_MS = 350;
  const MAX_ATTEMPTS = 3;
  const FULL_SELECTION_INTENT_MS = 1000;
  const CLEAR_CONFIRMATION_WINDOW_MS = 300;
  const CLEAR_CONFIRMATION_TIMEOUTS_MS = [0, 32, 64, 96, 150, 220, 280];

  let configured = false;
  let enabled = false;
  let listenersAttached = false;
  let ids = new WeakMap();
  let nextId = 1;
  let generationId = 0;
  let fullSelectionIntent = null;
  let pendingClear = null;
  let guard = null;
  let lastReport = createEmptyReport();
  let recoveryApplying = false;

  function configure(options = {}) {
    configured = true;
    setEnabled(options.enabled === true);
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    if (enabled) {
      attachListeners();
      return;
    }
    cancelGuard("disabled");
    cancelPendingClear("disabled");
    fullSelectionIntent = null;
    pendingClear = null;
    detachListeners();
  }

  function getState() {
    return {
      ...lastReport,
      enabled,
      listenersAttached,
      armed: !!guard,
      guardActive: !!guard?.timer
    };
  }

  function resetForTests() {
    cancelGuard("reset");
    cancelPendingClear("reset");
    fullSelectionIntent = null;
    pendingClear = null;
    lastReport = createEmptyReport();
    ids = new WeakMap();
    nextId = 1;
    generationId = 0;
  }

  function forceExpireForTests(expectedPhase = "WAITING_FOR_REMOUNT") {
    if (document.documentElement.dataset.micaFixture !== "true" || !guard) return false;
    const generation = guard.generationId;
    const reason = expectedPhase === "WAITING_FOR_REMOUNT" ? "WAITING_FOR_REMOUNT_TIMEOUT" : "TEST_FORCED_TIMEOUT";
    expireGuardIfCurrent(generation, expectedPhase, reason);
    return !!guard && guard.generationId === generation;
  }

  function completeTombstoneForTests() {
    if (document.documentElement.dataset.micaFixture !== "true" || !guard) return false;
    completeTombstoneIfCurrent(guard.generationId);
    return true;
  }

  function attachListeners() {
    if (listenersAttached) return;
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("beforeinput", handleBeforeInput, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("blur", handleClearConfirmationEvent, true);
    document.addEventListener("focusout", handleClearConfirmationEvent, true);
    document.addEventListener("cut", handleCut, true);
    document.addEventListener("paste", handleNewUserInput, true);
    document.addEventListener("compositionstart", handleNewUserInput, true);
    document.addEventListener("compositionupdate", handleNewUserInput, true);
    document.addEventListener("compositionend", handleNewUserInput, true);
    listenersAttached = true;
  }

  function detachListeners() {
    if (!listenersAttached) return;
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("beforeinput", handleBeforeInput, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("blur", handleClearConfirmationEvent, true);
    document.removeEventListener("focusout", handleClearConfirmationEvent, true);
    document.removeEventListener("cut", handleCut, true);
    document.removeEventListener("paste", handleNewUserInput, true);
    document.removeEventListener("compositionstart", handleNewUserInput, true);
    document.removeEventListener("compositionupdate", handleNewUserInput, true);
    document.removeEventListener("compositionend", handleNewUserInput, true);
    listenersAttached = false;
  }

  function handleKeyDown(event) {
    if (!shouldObserveEvent(event)) return;
    const editable = findComposerEditableFromTarget(event.target);
    if (!editable) return;
    if (isSelectAllShortcut(event)) {
      fullSelectionIntent = {
        startedAt: Date.now(),
        editableId: elementId(editable),
        rootId: elementId(findComposerRoot(editable))
      };
      return;
    }
    if (isDeleteKey(event)) {
      beginPendingFullClear(event, keyToInputType(event), keyToIntentType(event));
    }
  }

  function handleBeforeInput(event) {
    if (!shouldObserveEvent(event)) return;
    const inputType = getInputType(event);
    if (!isDeleteLikeInputType(inputType)) {
      handleNewUserInput(event);
      return;
    }
    beginPendingFullClear(event, inputType, "selection_delete");
  }

  function handleCut(event) {
    if (!shouldObserveEvent(event)) return;
    if (beginPendingFullClear(event, "cut", "selection_cut")) return;
    if (guard && !recoveryApplying) cancelGuard("new_user_input");
  }

  function handleInput(event) {
    if (!shouldObserveEvent(event)) return;
    const inputType = getInputType(event);
    if (pendingClear) {
      if (isInsertLikeInputType(inputType)) {
        cancelPendingClear("new_user_input");
        return;
      }
      confirmPendingClear(event, "input", inputType || "input");
      return;
    }
    if (guard && !recoveryApplying) cancelGuard("new_user_input");
  }

  function handleClearConfirmationEvent(event) {
    if (!shouldObserveEvent(event) || !pendingClear) return;
    confirmPendingClear(event, event.type, event.type);
  }

  function handleNewUserInput(event) {
    if (!shouldObserveEvent(event)) return;
    if (pendingClear && !recoveryApplying) cancelPendingClear("new_user_input");
    if (guard && !recoveryApplying) cancelGuard("new_user_input");
  }

  function beginPendingFullClear(event, inputType, intentType) {
    if (!enabled || recoveryApplying || pendingClear) return false;
    const editable = findComposerEditableFromTarget(event.target);
    if (!editable) return false;
    const intent = getReliableFullClearIntent(editable);
    if (!intent) return false;
    const text = readComposerText(editable);
    const length = text.length;
    if (length <= 0) return false;
    const replacingGuard = !!guard;
    if (replacingGuard) cancelGuard("replaced");
    generationId += 1;
    const now = Date.now();
    pendingClear = {
      generationId,
      intentType,
      fullClearIntentElapsedMs: intent.elapsedMs,
      preClearOldLength: length,
      inputType,
      startedAt: now,
      expiresAt: now + CLEAR_CONFIRMATION_WINDOW_MS,
      oldText: text,
      oldCanonical: canonicalize(text),
      oldHash: fingerprint(text),
      oldLength: length,
      editable,
      editableId: elementId(editable),
      rootId: elementId(findComposerRoot(editable)),
      clearConfirmationMonitorStarted: false,
      clearConfirmationChecks: 0,
      clearConfirmationExpired: false,
      clearConfirmationSource: null,
      clearConfirmedTargetMatched: false,
      timeoutIds: [],
      rafIds: []
    };
    lastReport = reportFromPending(pendingClear);
    if (replacingGuard) {
      record("stale_recovery_rearmed", {
        generationId: pendingClear.generationId,
        fullClearIntentType: pendingClear.intentType,
        preClearOldLength: pendingClear.preClearOldLength
      });
    }
    record("stale_recovery_full_clear_intent", {
      generationId: pendingClear.generationId,
      fullClearIntentType: pendingClear.intentType,
      fullClearIntentElapsedMs: pendingClear.fullClearIntentElapsedMs,
      preClearOldLength: pendingClear.preClearOldLength,
      inputType,
      editableId: pendingClear.editableId,
      rootId: pendingClear.rootId
    });
    startClearConfirmationMonitor(pendingClear, inputType);
    return true;
  }

  function confirmPendingClear(event, source, inputType) {
    if (!pendingClear) return false;
    if (Date.now() > pendingClear.expiresAt) {
      cancelPendingClear("expired");
      return false;
    }
    const snapshot = readPendingClearSnapshot(pendingClear, event);
    pendingClear.clearConfirmationChecks += 1;
    record("stale_recovery_clear_confirmation_check", {
      generationId: pendingClear.generationId,
      checkCount: pendingClear.clearConfirmationChecks,
      source,
      composerPresent: snapshot.exists,
      textLength: snapshot.textLength,
      targetMatched: snapshot.targetMatched,
      editableId: snapshot.editableId,
      rootId: snapshot.rootId
    });
    lastReport = reportFromPending(pendingClear, snapshot);
    if (!snapshot.targetMatched || !snapshot.exists || snapshot.textLength !== 0) return false;
    const clearState = pendingClear;
    stopClearConfirmationMonitor(clearState);
    clearState.clearConfirmedAt = Date.now();
    clearState.clearConfirmationSource = source;
    clearState.clearConfirmedTargetMatched = snapshot.targetMatched;
    pendingClear = null;
    armGuard(snapshot.editable, clearState, source, inputType);
    return true;
  }

  function startClearConfirmationMonitor(activePending, inputType) {
    if (!activePending || activePending.clearConfirmationMonitorStarted) return;
    activePending.clearConfirmationMonitorStarted = true;
    record("stale_recovery_clear_confirmation_started", {
      generationId: activePending.generationId,
      fullClearIntentType: activePending.intentType,
      preClearOldLength: activePending.preClearOldLength,
      windowMs: CLEAR_CONFIRMATION_WINDOW_MS
    });
    for (const delayMs of CLEAR_CONFIRMATION_TIMEOUTS_MS) {
      const timeoutId = setTimeout(() => {
        if (pendingClear !== activePending) return;
        confirmPendingClear(null, `timeout:${delayMs}`, inputType);
      }, delayMs);
      activePending.timeoutIds.push(timeoutId);
    }
    const rafCheck = () => {
      if (pendingClear !== activePending) return;
      confirmPendingClear(null, "raf", inputType);
      if (pendingClear !== activePending) return;
      const rafId = requestAnimationFrame(rafCheck);
      activePending.rafIds.push(rafId);
    };
    const rafId = requestAnimationFrame(rafCheck);
    activePending.rafIds.push(rafId);
    const expireId = setTimeout(() => {
      if (pendingClear === activePending) cancelPendingClear("expired");
    }, CLEAR_CONFIRMATION_WINDOW_MS);
    activePending.timeoutIds.push(expireId);
  }

  function stopClearConfirmationMonitor(activePending) {
    if (!activePending) return;
    for (const timeoutId of activePending.timeoutIds || []) clearTimeout(timeoutId);
    for (const rafId of activePending.rafIds || []) cancelAnimationFrame(rafId);
    activePending.timeoutIds = [];
    activePending.rafIds = [];
  }

  function armGuard(editable, clearState, source, inputType) {
    if (!clearState) return;
    const now = Date.now();
    const root = findComposerRoot(editable);
    guard = {
      generationId: clearState.generationId,
      armedAt: now,
      waitExpiresAt: now + GUARD_DURATION_MS,
      hardExpiresAt: now + HARD_GUARD_CAP_MS,
      phase: "WAITING_FOR_REMOUNT",
      source,
      inputType,
      fullClearIntentObserved: true,
      fullClearIntentType: clearState.intentType,
      fullClearIntentElapsedMs: clearState.fullClearIntentElapsedMs,
      preClearOldLength: clearState.preClearOldLength,
      clearConfirmationChecks: clearState.clearConfirmationChecks,
      clearConfirmationSource: clearState.clearConfirmationSource,
      clearConfirmedTargetMatched: clearState.clearConfirmedTargetMatched,
      clearConfirmed: true,
      clearConfirmedElapsedMs: Math.max(0, clearState.clearConfirmedAt - clearState.startedAt),
      oldText: clearState.oldText,
      oldCanonical: clearState.oldCanonical,
      oldHash: clearState.oldHash,
      oldLength: clearState.oldLength,
      anchorEditableId: elementId(editable),
      anchorRootId: elementId(root),
      previousSnapshot: readComposerSnapshot(),
      firstNonZeroAt: 0,
      lastCandidateLength: 0,
      lastFingerprintMatched: false,
      fingerprintMatchedEver: false,
      remountObserved: false,
      attemptCount: 0,
      successAttemptCount: 0,
      attemptInFlight: false,
      attempted: false,
      succeeded: false,
      exhausted: false,
      tombstoneActive: true,
      localClearObserved: false,
      sameStalePayloadReappeared: false,
      finalClearStable: false,
      successMode: null,
      attemptsExhausted: false,
      lastLocalClearAttemptCount: 0,
      cancelledByUserInput: false,
      expired: false,
      timer: 0,
      phaseTimer: 0,
      hardTimer: 0
    };
    lastReport = reportFromGuard(guard);
    record("stale_recovery_clear_confirmed", {
      generationId: guard.generationId,
      fullClearIntentType: guard.fullClearIntentType,
      preClearOldLength: guard.preClearOldLength,
      clearConfirmedElapsedMs: guard.clearConfirmedElapsedMs,
      source: guard.clearConfirmationSource,
      targetMatched: guard.clearConfirmedTargetMatched,
      editableId: guard.anchorEditableId,
      rootId: guard.anchorRootId
    });
    record("stale_recovery_armed", {
      generationId: guard.generationId,
      oldLength: guard.oldLength,
      preClearOldLength: guard.preClearOldLength,
      clearConfirmed: true,
      clearConfirmedElapsedMs: guard.clearConfirmedElapsedMs,
      guardDurationMs: GUARD_DURATION_MS,
      editableId: guard.anchorEditableId,
      rootId: guard.anchorRootId
    });
    guard.timer = setInterval(tickGuard, SAMPLE_INTERVAL_MS);
    guard.phaseTimer = setTimeout(() => expireGuardIfCurrent(guard.generationId, "WAITING_FOR_REMOUNT", "WAITING_FOR_REMOUNT_TIMEOUT"), GUARD_DURATION_MS);
    guard.hardTimer = setTimeout(() => completeTombstoneIfCurrent(guard.generationId), HARD_GUARD_CAP_MS);
    tickGuard();
  }

  function tickGuard() {
    if (!guard) return;
    const snapshot = readComposerSnapshot();
    const previous = guard.previousSnapshot;
    if (previous?.exists && !snapshot.exists) {
      guard.remountObserved = true;
    }
    if (!previous?.exists && snapshot.exists) {
      guard.remountObserved = true;
    }
    guard.previousSnapshot = snapshot;

    if (!snapshot.exists || snapshot.textLength === 0) {
      if (guard.phase === "VERIFYING" && snapshot.exists && snapshot.textLength === 0) {
        markLocalClearObserved(snapshot);
      }
      if (guard.phase !== "SETTLING") guard.firstNonZeroAt = 0;
      lastReport = reportFromGuard(guard, snapshot);
      return;
    }

    const wasMatched = guard.lastFingerprintMatched;
    const matched = matchesOldPayload(snapshot.text, guard);
    guard.lastCandidateLength = snapshot.textLength;
    guard.lastFingerprintMatched = matched;
    if (matched) guard.fingerprintMatchedEver = true;
    lastReport = reportFromGuard(guard, snapshot);

    if (!matched) return;
    if (guard.localClearObserved && !wasMatched) {
      markSamePayloadReappeared(snapshot);
    }
    if (guard.localClearObserved && guard.attemptCount >= MAX_ATTEMPTS) {
      markAttemptsExhausted(snapshot);
      return;
    }
    if (guard.phase === "WAITING_FOR_REMOUNT") enterSettling(snapshot);
  }

  function enterSettling(snapshot) {
    if (!guard || guard.phase !== "WAITING_FOR_REMOUNT") return;
    guard.phase = "SETTLING";
    guard.firstNonZeroAt = Date.now();
    clearPhaseTimer(guard);
    record("stale_recovery_waiting_for_settle", {
      generationId: guard.generationId,
      phase: guard.phase,
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      fingerprintMatched: true,
      settleMs: SETTLE_MS
    });
    const generation = guard.generationId;
    guard.phaseTimer = setTimeout(() => completeSettling(generation), SETTLE_MS);
    lastReport = reportFromGuard(guard, snapshot);
  }

  function completeSettling(generation) {
    if (!guard || guard.generationId !== generation || guard.phase !== "SETTLING") return;
    guard.phaseTimer = 0;
    const snapshot = readComposerSnapshot();
    const matched = snapshot.exists && snapshot.textLength > 0 && matchesOldPayload(snapshot.text, guard);
    guard.lastCandidateLength = snapshot.textLength;
    guard.lastFingerprintMatched = matched;
    if (matched) guard.fingerprintMatchedEver = true;
    lastReport = reportFromGuard(guard, snapshot);
    if (!matched) {
      guard.phase = "WAITING_FOR_REMOUNT";
      guard.firstNonZeroAt = 0;
      scheduleWaitingExpiry(guard);
      return;
    }
    guard.phase = "RECOVERING";
    clearPhaseTimer(guard);
    attemptRecovery(snapshot);
  }

  function attemptRecovery(snapshot) {
    if (!guard || guard.attemptInFlight) return;
    if (guard.attemptCount >= MAX_ATTEMPTS) {
      if (guard) markExhausted();
      return;
    }
    guard.attempted = true;
    guard.attemptInFlight = true;
    guard.phase = "VERIFYING";
    guard.attemptCount += 1;
    record("stale_recovery_match", {
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      fingerprintMatched: true,
      attemptCount: guard.attemptCount
    });
    record("stale_recovery_attempt", {
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      attemptCount: guard.attemptCount
    });
    if (guard.attemptCount > 1) {
      record("stale_recovery_retry_attempt", {
        generationId: guard.generationId,
        oldLength: guard.oldLength,
        newLength: snapshot.textLength,
        attemptCount: guard.attemptCount,
        maxAttempts: MAX_ATTEMPTS
      });
    }

    recoveryApplying = true;
    const attempted = nativeDeleteComposerContents(snapshot.editable);
    recoveryApplying = false;

    const afterSnapshot = readComposerSnapshot();
    if (attempted && afterSnapshot.exists && afterSnapshot.textLength === 0) {
      markLocalClearObserved(afterSnapshot);
    }
    setTimeout(() => verifyRecovery(attempted), VERIFY_MS);
  }

  function verifyRecovery(attempted) {
    if (!guard) return;
    guard.attemptInFlight = false;
    const snapshot = readComposerSnapshot();
    if (attempted && snapshot.exists && snapshot.textLength === 0) {
      markLocalClearObserved(snapshot);
    }
    if (attempted && guard.localClearObserved && guard.lastLocalClearAttemptCount === guard.attemptCount) {
      recordRecoverySuccessForAttempt(snapshot);
      guard.phase = "WAITING_FOR_REMOUNT";
      scheduleWaitingExpiry(guard);
      return;
    }
    record("stale_recovery_failed", {
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      fingerprintMatched: matchesOldPayload(snapshot.text, guard),
      attemptCount: guard.attemptCount
    });
    if (guard.attemptCount >= MAX_ATTEMPTS) {
      markExhausted();
      return;
    }
    guard.phase = "WAITING_FOR_REMOUNT";
    guard.firstNonZeroAt = 0;
    scheduleWaitingExpiry(guard);
  }

  function markExhausted() {
    markAttemptsExhausted(readComposerSnapshot());
  }

  function markLocalClearObserved(snapshot) {
    if (!guard) return;
    if (guard.lastLocalClearAttemptCount === guard.attemptCount) {
      lastReport = reportFromGuard(guard, snapshot);
      return;
    }
    guard.localClearObserved = true;
    guard.lastLocalClearAttemptCount = guard.attemptCount;
    guard.lastCandidateLength = 0;
    guard.lastFingerprintMatched = false;
    record("stale_recovery_local_clear_observed", {
      generationId: guard.generationId,
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      attemptCount: guard.attemptCount
    });
    lastReport = reportFromGuard(guard, snapshot);
  }

  function recordRecoverySuccessForAttempt(snapshot) {
    if (!guard || guard.successAttemptCount >= guard.attemptCount) return;
    guard.succeeded = true;
    guard.successAttemptCount = guard.attemptCount;
    guard.firstNonZeroAt = 0;
    guard.lastCandidateLength = 0;
    guard.lastFingerprintMatched = false;
    lastReport = reportFromGuard(guard, snapshot);
    record("stale_recovery_success", {
      generationId: guard.generationId,
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      attemptCount: guard.attemptCount
    });
  }

  function markSamePayloadReappeared(snapshot) {
    if (!guard) return;
    guard.sameStalePayloadReappeared = true;
    record("stale_recovery_same_payload_reappeared", {
      generationId: guard.generationId,
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      attemptCount: guard.attemptCount
    });
    lastReport = reportFromGuard(guard, snapshot);
  }

  function markAttemptsExhausted(snapshot) {
    if (!guard) return;
    guard.attemptsExhausted = true;
    guard.exhausted = true;
    guard.phase = "EXHAUSTED";
    record("stale_recovery_attempts_exhausted", {
      generationId: guard.generationId,
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      attemptCount: guard.attemptCount,
      maxAttempts: MAX_ATTEMPTS
    });
    finishGuard();
  }

  function completeTombstoneIfCurrent(expectedGenerationId) {
    if (!guard || guard.generationId !== expectedGenerationId) return;
    const snapshot = readComposerSnapshot();
    const matched = snapshot.exists && snapshot.textLength > 0 && matchesOldPayload(snapshot.text, guard);
    guard.lastCandidateLength = snapshot.textLength;
    guard.lastFingerprintMatched = matched;
    if (matched) guard.fingerprintMatchedEver = true;
    if (matched && guard.attemptCount >= MAX_ATTEMPTS) {
      markAttemptsExhausted(snapshot);
      return;
    }
    if (guard.localClearObserved && !matched) {
      markFinalClearStable(snapshot, "local_clear_stable");
      return;
    }
    if (!guard.localClearObserved && snapshot.exists && snapshot.textLength === 0 && !matched) {
      markFinalClearStable(snapshot, "native_stayed_empty");
      return;
    }
    guard.expired = true;
    record("stale_recovery_expired", { ...safeGuardEventDetails(guard), reason: "HARD_CAP_TIMEOUT", phase: guard.phase });
    finishGuard();
  }

  function markFinalClearStable(snapshot, successMode) {
    if (!guard) return;
    guard.finalClearStable = true;
    guard.successMode = successMode;
    guard.phase = "FINAL_CLEAR_STABLE";
    record("stale_recovery_final_clear_stable", {
      generationId: guard.generationId,
      oldLength: guard.oldLength,
      newLength: snapshot.textLength,
      attemptCount: guard.attemptCount,
      maxAttempts: MAX_ATTEMPTS,
      successMode
    });
    finishGuard();
  }

  function cancelGuard(reason) {
    if (!guard) return;
    if (reason === "new_user_input") {
      guard.cancelledByUserInput = true;
      record("stale_recovery_cancelled_new_input", safeGuardEventDetails(guard));
      record("stale_recovery_tombstone_cancelled", { ...safeGuardEventDetails(guard), reason: "new_user_input" });
    } else if (reason !== "replaced") {
      record("stale_recovery_expired", { ...safeGuardEventDetails(guard), reason });
    }
    finishGuard();
  }

  function cancelPendingClear(reason) {
    if (!pendingClear) return;
    stopClearConfirmationMonitor(pendingClear);
    if (reason === "new_user_input") {
      lastReport = {
        ...reportFromPending(pendingClear),
        cancelledByUserInput: true
      };
      record("stale_recovery_cancelled_new_input", {
        generationId: pendingClear.generationId,
        fullClearIntentType: pendingClear.intentType,
        preClearOldLength: pendingClear.preClearOldLength,
        clearConfirmationChecks: pendingClear.clearConfirmationChecks,
        clearConfirmed: false
      });
    } else if (reason === "expired") {
      pendingClear.clearConfirmationExpired = true;
      lastReport = reportFromPending(pendingClear);
      record("stale_recovery_clear_confirmation_expired", {
        generationId: pendingClear.generationId,
        fullClearIntentType: pendingClear.intentType,
        preClearOldLength: pendingClear.preClearOldLength,
        clearConfirmationChecks: pendingClear.clearConfirmationChecks,
        windowMs: CLEAR_CONFIRMATION_WINDOW_MS
      });
    }
    pendingClear = null;
  }

  function finishGuard() {
    if (!guard) return;
    clearInterval(guard.timer);
    clearPhaseTimer(guard);
    if (guard.hardTimer) clearTimeout(guard.hardTimer);
    guard.timer = 0;
    guard.hardTimer = 0;
    lastReport = reportFromGuard(guard);
    guard = null;
  }

  function expireGuardIfCurrent(expectedGenerationId, expectedPhase, reason) {
    if (!guard || guard.generationId !== expectedGenerationId) return;
    if (expectedPhase && guard.phase !== expectedPhase) return;
    if (reason === "WAITING_FOR_REMOUNT_TIMEOUT") {
      const snapshot = readComposerSnapshot();
      const matched = snapshot.exists && snapshot.textLength > 0 && matchesOldPayload(snapshot.text, guard);
      if (snapshot.exists && snapshot.textLength === 0 && !matched) {
        markFinalClearStable(snapshot, guard.localClearObserved ? "local_clear_stable" : "native_stayed_empty");
        return;
      }
    }
    guard.expired = true;
    record("stale_recovery_expired", { ...safeGuardEventDetails(guard), reason, phase: guard.phase });
    finishGuard();
  }

  function scheduleWaitingExpiry(activeGuard) {
    if (!activeGuard || activeGuard.phase !== "WAITING_FOR_REMOUNT") return;
    clearPhaseTimer(activeGuard);
    if (activeGuard.localClearObserved) return;
    const remainingMs = Math.max(0, activeGuard.waitExpiresAt - Date.now());
    if (remainingMs <= 0) {
      expireGuardIfCurrent(activeGuard.generationId, "WAITING_FOR_REMOUNT", "WAITING_FOR_REMOUNT_TIMEOUT");
      return;
    }
    activeGuard.phaseTimer = setTimeout(() => expireGuardIfCurrent(activeGuard.generationId, "WAITING_FOR_REMOUNT", "WAITING_FOR_REMOUNT_TIMEOUT"), remainingMs);
  }

  function clearPhaseTimer(activeGuard) {
    if (!activeGuard?.phaseTimer) return;
    clearTimeout(activeGuard.phaseTimer);
    activeGuard.phaseTimer = 0;
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

  function matchesOldPayload(text, activeGuard) {
    if (!activeGuard) return false;
    const canonical = canonicalize(text);
    return canonical.length === activeGuard.oldCanonical.length
      && fingerprintCanonical(canonical) === activeGuard.oldHash
      && canonical === activeGuard.oldCanonical;
  }

  function readComposerSnapshot() {
    const editable = findComposerEditable();
    const root = findComposerRoot(editable);
    const text = readComposerText(editable);
    return {
      exists: !!editable,
      editable,
      root,
      editableId: elementId(editable),
      rootId: elementId(root),
      text,
      textLength: text.length
    };
  }

  function readPendingClearSnapshot(activePending, event = null) {
    let editable = null;
    let targetMatched = false;
    if (event) {
      editable = findComposerEditableFromTarget(event.target);
      targetMatched = !!editable && elementId(editable) === activePending.editableId;
      if (!targetMatched) editable = null;
    } else if (activePending?.editable?.isConnected) {
      editable = activePending.editable;
      targetMatched = true;
    }
    const root = findComposerRoot(editable);
    const text = readComposerText(editable);
    return {
      exists: !!editable,
      editable,
      root,
      editableId: elementId(editable),
      rootId: elementId(root),
      targetMatched,
      text,
      textLength: text.length
    };
  }

  function safeGuardEventDetails(activeGuard) {
    const snapshot = readComposerSnapshot();
    return {
      generationId: activeGuard.generationId,
      oldLength: activeGuard.oldLength,
      newLength: snapshot.textLength,
      fingerprintMatched: activeGuard.fingerprintMatchedEver || activeGuard.lastFingerprintMatched,
      attemptCount: activeGuard.attemptCount,
      maxAttempts: MAX_ATTEMPTS,
      guardDurationMs: GUARD_DURATION_MS
    };
  }

  function reportFromGuard(activeGuard, snapshot = readComposerSnapshot()) {
    if (!activeGuard) return createEmptyReport();
    return {
      enabled,
      listenersAttached,
      generationId: activeGuard.generationId,
      phase: activeGuard.phase,
      armed: !!activeGuard.timer,
      clearAnchorElapsedMs: Math.max(0, Date.now() - activeGuard.armedAt),
      guardDurationMs: GUARD_DURATION_MS,
      hardGuardCapMs: HARD_GUARD_CAP_MS,
      tombstoneHardDeadlineMs: Math.max(0, activeGuard.hardExpiresAt - Date.now()),
      tombstoneActive: !!activeGuard.timer && !activeGuard.finalClearStable && !activeGuard.attemptsExhausted && !activeGuard.cancelledByUserInput,
      maxAttempts: MAX_ATTEMPTS,
      fullClearIntentObserved: activeGuard.fullClearIntentObserved,
      fullClearIntentType: activeGuard.fullClearIntentType,
      fullClearIntentElapsedMs: activeGuard.fullClearIntentElapsedMs,
      preClearOldLength: activeGuard.preClearOldLength,
      clearConfirmationMonitorStarted: true,
      clearConfirmationChecks: activeGuard.clearConfirmationChecks,
      clearConfirmationExpired: false,
      clearConfirmationSource: activeGuard.clearConfirmationSource,
      clearConfirmedTargetMatched: activeGuard.clearConfirmedTargetMatched,
      clearConfirmed: activeGuard.clearConfirmed,
      clearConfirmedElapsedMs: activeGuard.clearConfirmedElapsedMs,
      cancelledByUserInput: activeGuard.cancelledByUserInput,
      remountObserved: activeGuard.remountObserved,
      fingerprintMatched: activeGuard.fingerprintMatchedEver || activeGuard.lastFingerprintMatched,
      localClearObserved: activeGuard.localClearObserved,
      sameStalePayloadReappeared: activeGuard.sameStalePayloadReappeared,
      finalClearStable: activeGuard.finalClearStable,
      successMode: activeGuard.successMode,
      attemptsExhausted: activeGuard.attemptsExhausted,
      oldLength: activeGuard.oldLength,
      newLength: snapshot.textLength,
      attemptCount: activeGuard.attemptCount,
      attempted: activeGuard.attempted,
      succeeded: activeGuard.succeeded,
      exhausted: activeGuard.exhausted,
      expired: activeGuard.expired,
      anchorEditableId: activeGuard.anchorEditableId,
      anchorRootId: activeGuard.anchorRootId,
      currentEditableId: snapshot.editableId,
      currentRootId: snapshot.rootId
    };
  }

  function reportFromPending(activePending, snapshot = readPendingClearSnapshot(activePending)) {
    return {
      enabled,
      listenersAttached,
      generationId: activePending.generationId,
      phase: "WAITING_FOR_CONFIRMED_ZERO",
      armed: false,
      clearAnchorElapsedMs: null,
      guardDurationMs: GUARD_DURATION_MS,
      hardGuardCapMs: HARD_GUARD_CAP_MS,
      tombstoneHardDeadlineMs: null,
      tombstoneActive: false,
      maxAttempts: MAX_ATTEMPTS,
      fullClearIntentObserved: true,
      fullClearIntentType: activePending.intentType,
      fullClearIntentElapsedMs: activePending.fullClearIntentElapsedMs,
      preClearOldLength: activePending.preClearOldLength,
      clearConfirmationMonitorStarted: activePending.clearConfirmationMonitorStarted,
      clearConfirmationChecks: activePending.clearConfirmationChecks,
      clearConfirmationExpired: activePending.clearConfirmationExpired,
      clearConfirmationSource: activePending.clearConfirmationSource,
      clearConfirmedTargetMatched: activePending.clearConfirmedTargetMatched,
      clearConfirmed: false,
      clearConfirmedElapsedMs: null,
      cancelledByUserInput: false,
      remountObserved: false,
      fingerprintMatched: false,
      localClearObserved: false,
      sameStalePayloadReappeared: false,
      finalClearStable: false,
      successMode: null,
      attemptsExhausted: false,
      oldLength: activePending.oldLength,
      newLength: snapshot.textLength,
      attemptCount: 0,
      attempted: false,
      succeeded: false,
      exhausted: false,
      expired: activePending.clearConfirmationExpired,
      anchorEditableId: activePending.editableId,
      anchorRootId: activePending.rootId,
      currentEditableId: snapshot.editableId,
      currentRootId: snapshot.rootId
    };
  }

  function createEmptyReport() {
    return {
      enabled,
      listenersAttached,
      generationId,
      phase: "IDLE",
      armed: false,
      clearAnchorElapsedMs: null,
      guardDurationMs: GUARD_DURATION_MS,
      hardGuardCapMs: HARD_GUARD_CAP_MS,
      tombstoneHardDeadlineMs: null,
      tombstoneActive: false,
      maxAttempts: MAX_ATTEMPTS,
      fullClearIntentObserved: false,
      fullClearIntentType: null,
      fullClearIntentElapsedMs: null,
      preClearOldLength: 0,
      clearConfirmationMonitorStarted: false,
      clearConfirmationChecks: 0,
      clearConfirmationExpired: false,
      clearConfirmationSource: null,
      clearConfirmedTargetMatched: false,
      clearConfirmed: false,
      clearConfirmedElapsedMs: null,
      cancelledByUserInput: false,
      remountObserved: false,
      fingerprintMatched: false,
      localClearObserved: false,
      sameStalePayloadReappeared: false,
      finalClearStable: false,
      successMode: null,
      attemptsExhausted: false,
      oldLength: 0,
      newLength: 0,
      attemptCount: 0,
      attempted: false,
      succeeded: false,
      exhausted: false,
      expired: false,
      anchorEditableId: null,
      anchorRootId: null,
      currentEditableId: null,
      currentRootId: null
    };
  }

  function record(type, details = {}) {
    const api = globalThis.MicaComposerDiagnostics;
    if (!api || typeof api.recordStaleRecoveryEvent !== "function" || api.isActive?.() !== true) return;
    api.recordStaleRecoveryEvent(type, details);
  }

  function shouldObserveEvent(event) {
    return enabled
      && configured
      && !recoveryApplying
      && isTrustedEvent(event)
      && !!findComposerEditableFromTarget(event?.target);
  }

  function isTrustedEvent(event) {
    return event?.isTrusted === true || document.documentElement.dataset.micaFixture === "true";
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

  function isSelectAllShortcut(event) {
    return (event?.ctrlKey === true || event?.metaKey === true)
      && !event.altKey
      && String(event.key || "").toLowerCase() === "a";
  }

  function isDeleteKey(event) {
    return event?.key === "Delete" || event?.key === "Backspace";
  }

  function keyToInputType(event) {
    return event?.key === "Backspace" ? "deleteContentBackward" : "deleteContentForward";
  }

  function keyToIntentType(event) {
    return event?.key === "Backspace" ? "ctrl+a/backspace" : "ctrl+a/delete";
  }

  function getReliableFullClearIntent(editable) {
    const now = Date.now();
    const recent = fullSelectionIntent
      && now - fullSelectionIntent.startedAt <= FULL_SELECTION_INTENT_MS
      && fullSelectionIntent.editableId === elementId(editable);
    if (recent) {
      return {
        type: "recent_select_all",
        elapsedMs: Math.max(0, now - fullSelectionIntent.startedAt)
      };
    }
    if (selectionCoversEditable(editable)) {
      return {
        type: "selection_covers_composer",
        elapsedMs: 0
      };
    }
    return null;
  }

  function selectionCoversEditable(editable) {
    const text = canonicalize(readComposerText(editable));
    if (!text) return false;
    if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
      return editable.selectionStart === 0 && editable.selectionEnd === editable.value.length;
    }
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const selectedText = canonicalize(selection.toString());
    if (selectedText.length < text.length) return false;
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (editable.contains(range.commonAncestorContainer) || range.commonAncestorContainer === editable) return true;
    }
    return false;
  }

  function findComposerEditableFromTarget(target) {
    const element = getEventElement(target);
    if (!element || element.closest("[data-mica-root='true']") || element.closest("[data-mica-composer-diagnostics-root='true']")) return null;
    const editable = element.closest("#prompt-textarea, textarea, [contenteditable][role='textbox'], [contenteditable], [role='textbox']");
    if (editable instanceof HTMLElement) return editable;
    const active = findComposerEditable();
    const root = findComposerRoot(active);
    if (active && root?.contains(element)) return active;
    return null;
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

  function getEventElement(target) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Element) return target.closest("*");
    if (target instanceof CharacterData) return target.parentElement;
    return null;
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

  function fingerprint(value) {
    return fingerprintCanonical(canonicalize(value));
  }

  function fingerprintCanonical(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function elementId(element) {
    if (!(element instanceof Element)) return null;
    if (!ids.has(element)) ids.set(element, nextId++);
    return ids.get(element);
  }

  globalThis[GLOBAL_KEY] = {
    configure,
    setEnabled,
    getState,
    resetForTests,
    forceExpireForTests,
    completeTombstoneForTests
  };
})();
