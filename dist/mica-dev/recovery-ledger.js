(() => {
  const SCHEMA_VERSION = 1;
  const ACTION_CLAIMS_KEY = "micaRecoveryActionClaimsV1";
  const HISTORY_KEY = "micaRecoveryHistoryV1";
  const CLAIM_TTL_MS = 5 * 60 * 1000;
  const MAX_CLAIMS_PER_TAB = 8;
  const MAX_HISTORY_ENTRIES = 50;
  const PHASES = new Set([
    "idle",
    "awaiting_user_commit",
    "user_committed",
    "assistant_generating",
    "stalled",
    "action_backoff",
    "native_stop_settling",
    "reloading",
    "reconciling",
    "manual_required",
    "settled",
    "cancelled"
  ]);
  const SUBMISSION = new Set(["A_COMMITTED", "B_NOT_COMMITTED", "C_UNKNOWN"]);
  const ACTION_TYPES = new Set(["reload", "native_stop", "assistant_retry", "confirmed_resend"]);
  let queue = Promise.resolve();

  function claimAction(sessionArea, tabId, rawClaim, now = Date.now()) {
    return exclusive(async () => {
      const claim = sanitizeActionClaim(rawClaim);
      if (!sessionArea || !Number.isInteger(tabId) || tabId < 1 || !claim) {
        return { ok: false, granted: false, reason: "invalid_action_claim" };
      }
      const read = await readStorage(sessionArea, { [ACTION_CLAIMS_KEY]: {} });
      if (!read.ok) return { ok: false, granted: false, reason: "claim_store_unavailable" };
      const allClaims = sanitizeClaims(read.value?.[ACTION_CLAIMS_KEY], now);
      const tabKey = String(tabId);
      const current = allClaims[tabKey] || [];
      const duplicate = current.find((item) => item.actionId === claim.actionId);
      if (duplicate) {
        await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
        return { ok: true, granted: false, reason: "already_claimed", actionId: claim.actionId, expiresAt: duplicate.expiresAt };
      }
      const conflictingIdentity = current.find((item) => item.recoveryId === claim.recoveryId && item.type === claim.type && item.ordinal === claim.ordinal);
      if (conflictingIdentity) {
        await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
        return { ok: false, granted: false, reason: "claim_identity_conflict" };
      }
      const stored = {
        ...claim,
        tabId,
        claimedAt: now,
        expiresAt: now + CLAIM_TTL_MS
      };
      allClaims[tabKey] = [...current, stored].slice(-MAX_CLAIMS_PER_TAB);
      const wrote = await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
      return wrote
        ? { ok: true, granted: true, reason: "claim_granted", actionId: claim.actionId, expiresAt: stored.expiresAt }
        : { ok: false, granted: false, reason: "claim_store_unavailable" };
    });
  }

  function appendHistory(localArea, rawEntry) {
    return exclusive(async () => {
      const entry = sanitizeHistoryEntry(rawEntry);
      if (!localArea || !entry) return { ok: false, appended: false, reason: "invalid_history_entry" };
      const read = await readStorage(localArea, { [HISTORY_KEY]: [] });
      if (!read.ok) return { ok: false, appended: false, reason: "history_store_unavailable" };
      const current = (Array.isArray(read.value?.[HISTORY_KEY]) ? read.value[HISTORY_KEY] : [])
        .map(sanitizeHistoryEntry)
        .filter(Boolean);
      if (current.some((item) => item.eventId === entry.eventId)) {
        return { ok: true, appended: false, reason: "history_duplicate", size: current.length };
      }
      const next = [...current, entry].slice(-MAX_HISTORY_ENTRIES);
      const wrote = await writeStorage(localArea, { [HISTORY_KEY]: next });
      return wrote
        ? { ok: true, appended: true, reason: "history_appended", size: next.length }
        : { ok: false, appended: false, reason: "history_store_unavailable" };
    });
  }

  function clearTabClaims(sessionArea, tabId, now = Date.now()) {
    return exclusive(async () => {
      if (!sessionArea || !Number.isInteger(tabId) || tabId < 1) return { ok: false, reason: "invalid_tab" };
      const read = await readStorage(sessionArea, { [ACTION_CLAIMS_KEY]: {} });
      if (!read.ok) return { ok: false, reason: "claim_store_unavailable" };
      const allClaims = sanitizeClaims(read.value?.[ACTION_CLAIMS_KEY], now);
      delete allClaims[String(tabId)];
      const wrote = await writeStorage(sessionArea, { [ACTION_CLAIMS_KEY]: allClaims });
      return { ok: wrote, reason: wrote ? "tab_claims_cleared" : "claim_store_unavailable" };
    });
  }

  function sanitizeActionClaim(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION) return null;
    if (!isIdentity(value.actionId) || !isIdentity(value.recoveryId) || !isIdentity(value.scopeHash)) return null;
    if (!ACTION_TYPES.has(value.type) || !Number.isInteger(value.ordinal) || value.ordinal < 1 || value.ordinal > (value.type === "reload" ? 2 : 1)) return null;
    if (!Number.isInteger(value.sequence) || value.sequence < 1 || value.sequence > 1_000_000) return null;
    const actionSpecific = value.type === "reload" ? {} : {
      subjectHash: isIdentity(value.subjectHash) ? value.subjectHash : null,
      controlIdHash: isIdentity(value.controlIdHash) ? value.controlIdHash : null
    };
    if (value.type !== "reload" && (!actionSpecific.subjectHash || !actionSpecific.controlIdHash)) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      actionId: value.actionId,
      recoveryId: value.recoveryId,
      scopeHash: value.scopeHash,
      sequence: value.sequence,
      type: value.type,
      ordinal: value.ordinal,
      ...actionSpecific
    };
  }

  function sanitizeHistoryEntry(value) {
    if (!value || value.schemaVersion !== SCHEMA_VERSION) return null;
    if (!isIdentity(value.eventId) || !isIdentity(value.recoveryId) || !isIdentity(value.scopeHash)) return null;
    if (!PHASES.has(value.phase) || !SUBMISSION.has(value.submissionStatus)) return null;
    const reason = boundedToken(value.reason, 120);
    const updatedAt = Number(value.updatedAt);
    if (!reason || !Number.isFinite(updatedAt) || updatedAt < 0) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      eventId: value.eventId,
      recoveryId: value.recoveryId,
      scopeHash: value.scopeHash,
      phase: value.phase,
      reason,
      submissionStatus: value.submissionStatus,
      reloadCount: integer(value.reloadCount, 0, 2, 0),
      recoveryCycle: integer(value.recoveryCycle, 0, 3, 0),
      nativeStopCount: integer(value.nativeStopCount, 0, 1, 0),
      resendCount: integer(value.resendCount, 0, 1, 0),
      assistantRetryCount: integer(value.assistantRetryCount, 0, 1, 0),
      sensitiveContext: value.sensitiveContext === true,
      consequentialAction: value.consequentialAction === true,
      updatedAt,
      conversationTextIncluded: false,
      promptTextIncluded: false,
      draftIncluded: false,
      rawConversationIdIncluded: false
    };
  }

  function sanitizeClaims(value, now) {
    const output = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return output;
    for (const [tabKey, entries] of Object.entries(value)) {
      const tabId = Number(tabKey);
      if (!Number.isInteger(tabId) || tabId < 1 || !Array.isArray(entries)) continue;
      const retained = entries.map((item) => sanitizeStoredClaim(item, tabId)).filter((item) => item && item.expiresAt > now);
      if (retained.length) output[tabKey] = retained.slice(-MAX_CLAIMS_PER_TAB);
    }
    return output;
  }

  function sanitizeStoredClaim(value, tabId) {
    const claim = sanitizeActionClaim(value);
    const claimedAt = Number(value?.claimedAt);
    const expiresAt = Number(value?.expiresAt);
    if (!claim || value?.tabId !== tabId || !Number.isFinite(claimedAt) || !Number.isFinite(expiresAt) || expiresAt <= claimedAt) return null;
    return { ...claim, tabId, claimedAt, expiresAt };
  }

  function exclusive(task) {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function readStorage(area, defaults) {
    try {
      const value = await area.get(defaults);
      return { ok: true, value: value || defaults };
    } catch (_error) {
      return { ok: false, value: defaults };
    }
  }

  async function writeStorage(area, value) {
    try {
      await area.set(value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function isIdentity(value) {
    return typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
  }

  function boundedToken(value, max) {
    return typeof value === "string" && /^[a-z0-9_:-]+$/.test(value) ? value.slice(0, max) : null;
  }

  function integer(value, min, max, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
  }

  globalThis.MicaRecoveryLedger = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    actionClaimsKey: ACTION_CLAIMS_KEY,
    historyKey: HISTORY_KEY,
    claimTtlMs: CLAIM_TTL_MS,
    maxHistoryEntries: MAX_HISTORY_ENTRIES,
    claimAction,
    appendHistory,
    clearTabClaims,
    sanitizeActionClaim,
    sanitizeHistoryEntry
  });
})();
