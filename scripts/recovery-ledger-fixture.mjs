import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "recovery-ledger.js"), "utf8");
const shared = { session: {}, local: {} };
let now = 1_000;

const firstWorker = loadLedger();
const claim = actionClaim("1111111111111111", "aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", 1, 1);
const first = await firstWorker.claimAction(storageArea(shared.session), 7, claim, now);
assert.equal(first.granted, true);

const restartedWorker = loadLedger();
const duplicate = await restartedWorker.claimAction(storageArea(shared.session), 7, claim, now + 1);
assert.equal(duplicate.ok, true);
assert.equal(duplicate.granted, false);
assert.equal(duplicate.reason, "already_claimed");

const secondTab = await restartedWorker.claimAction(storageArea(shared.session), 8, claim, now + 2);
assert.equal(secondTab.granted, true, "same opaque identity in another tab must remain isolated");

const conflict = await restartedWorker.claimAction(storageArea(shared.session), 7, {
  ...claim,
  actionId: "2222222222222222"
}, now + 3);
assert.equal(conflict.ok, false);
assert.equal(conflict.reason, "claim_identity_conflict");

const invalid = await restartedWorker.claimAction(storageArea(shared.session), 7, { ...claim, scopeHash: "raw-conversation-id" }, now + 4);
assert.equal(invalid.ok, false);
assert.equal(invalid.reason, "invalid_action_claim");

const storageFailure = await restartedWorker.claimAction(failingStorageArea(), 7, claim, now + 5);
assert.equal(storageFailure.ok, false);
assert.equal(storageFailure.granted, false);

const nativeStopClaim = {
  ...actionClaim("9999999999999999", "1212121212121212", "3434343434343434", 3, 1),
  type: "native_stop",
  subjectHash: "5656565656565656",
  controlIdHash: "7878787878787878"
};
const nativeStopGranted = await restartedWorker.claimAction(storageArea(shared.session), 9, nativeStopClaim, now + 6);
assert.equal(nativeStopGranted.granted, true);
const nativeStopDuplicate = await restartedWorker.claimAction(storageArea(shared.session), 9, nativeStopClaim, now + 7);
assert.equal(nativeStopDuplicate.reason, "already_claimed");
const nativeStopMalformed = await restartedWorker.claimAction(storageArea(shared.session), 9, { ...nativeStopClaim, controlIdHash: null }, now + 8);
assert.equal(nativeStopMalformed.reason, "invalid_action_claim");
const resendClaim = {
  ...nativeStopClaim,
  actionId: "8989898989898989",
  recoveryId: "1313131313131313",
  type: "confirmed_resend",
  subjectHash: "5757575757575757",
  controlIdHash: "7979797979797979"
};
assert.equal((await restartedWorker.claimAction(storageArea(shared.session), 9, resendClaim, now + 9)).granted, true);

now += restartedWorker.claimTtlMs + 10;
const afterExpiryWorker = loadLedger();
const reclaimed = await afterExpiryWorker.claimAction(storageArea(shared.session), 7, claim, now);
assert.equal(reclaimed.granted, true, "expired action lease should not block a future bounded recovery attempt");

const baseHistory = historyEntry(1, "3333333333333333", "bbbbbbbbbbbbbbbb");
const appended = await afterExpiryWorker.appendHistory(storageArea(shared.local), {
  ...baseHistory,
  promptText: "must be removed",
  draft: "must be removed",
  conversationKey: "/c/private-id"
});
assert.equal(appended.appended, true);
const repeated = await afterExpiryWorker.appendHistory(storageArea(shared.local), baseHistory);
assert.equal(repeated.appended, false);
assert.equal(repeated.reason, "history_duplicate");

await Promise.all([
  afterExpiryWorker.appendHistory(storageArea(shared.local), historyEntry(2, "4444444444444444", "cccccccccccccccc")),
  afterExpiryWorker.appendHistory(storageArea(shared.local), historyEntry(3, "5555555555555555", "dddddddddddddddd"))
]);
assert.equal(shared.local.micaRecoveryHistoryV1.length, 3, "serialized history appends must not overwrite another tab's event");

for (let index = 4; index <= 58; index += 1) {
  await afterExpiryWorker.appendHistory(storageArea(shared.local), historyEntry(index, identity(index + 100), identity(index + 200)));
}
assert.equal(shared.local.micaRecoveryHistoryV1.length, afterExpiryWorker.maxHistoryEntries);
const serializedHistory = JSON.stringify(shared.local.micaRecoveryHistoryV1);
for (const forbidden of ["must be removed", "private-id", "\"promptText\":", "\"conversationKey\":", "\"draft\":"]) {
  assert.equal(serializedHistory.includes(forbidden), false, `history leaked forbidden field ${forbidden}`);
}
assert.equal(shared.local.micaRecoveryHistoryV1.every((entry) => entry.conversationTextIncluded === false && entry.promptTextIncluded === false && entry.draftIncluded === false && entry.rawConversationIdIncluded === false), true);

const tabEightClaim = actionClaim("6666666666666666", "7777777777777777", "8888888888888888", 2, 1);
assert.equal((await afterExpiryWorker.claimAction(storageArea(shared.session), 8, tabEightClaim, now + 1)).granted, true);
await afterExpiryWorker.clearTabClaims(storageArea(shared.session), 7, now + 2);
assert.equal(shared.session.micaRecoveryActionClaimsV1?.["7"], undefined);
assert.equal(shared.session.micaRecoveryActionClaimsV1?.["8"]?.length, 1);

const output = {
  passed: true,
  firstClaimGranted: first.granted === true,
  duplicateClaimRejected: duplicate.granted === false,
  workerRestartDeduplicated: duplicate.reason === "already_claimed",
  tabIsolation: secondTab.granted === true,
  expiredClaimReclaimed: reclaimed.granted === true,
  identityConflictRejected: conflict.reason === "claim_identity_conflict",
  invalidClaimRejected: invalid.reason === "invalid_action_claim",
  storageFailureFailClosed: storageFailure.ok === false && storageFailure.granted === false,
  nativeActionClaimed: nativeStopGranted.granted === true,
  nativeActionDeduplicated: nativeStopDuplicate.reason === "already_claimed",
  malformedNativeActionRejected: nativeStopMalformed.reason === "invalid_action_claim",
  confirmedResendClaimed: true,
  historyAppended: appended.appended === true,
  historyDeduplicated: repeated.reason === "history_duplicate",
  concurrentHistoryPreserved: true,
  historyBounded: shared.local.micaRecoveryHistoryV1.length === afterExpiryWorker.maxHistoryEntries,
  historyContentExcluded: true,
  tabRemovalCleanup: shared.session.micaRecoveryActionClaimsV1?.["7"] === undefined && shared.session.micaRecoveryActionClaimsV1?.["8"]?.length === 1
};

const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "convergence-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "recovery-ledger.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

function loadLedger() {
  class FakeDate extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({ console, Date: FakeDate, Promise, Object, Array, Number, String, Set, RegExp });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "recovery-ledger.js" });
  return context.MicaRecoveryLedger;
}

function storageArea(values) {
  return {
    async get(defaults) { return { ...(defaults || {}), ...structuredClone(values) }; },
    async set(next) { Object.assign(values, structuredClone(next)); },
    async remove(key) { delete values[key]; }
  };
}

function failingStorageArea() {
  return {
    async get() { throw new Error("fixture storage unavailable"); },
    async set() { throw new Error("fixture storage unavailable"); }
  };
}

function actionClaim(actionId, recoveryId, scopeHash, sequence, ordinal) {
  return { schemaVersion: 1, actionId, recoveryId, scopeHash, sequence, type: "reload", ordinal };
}

function historyEntry(index, recoveryId, scopeHash) {
  return {
    schemaVersion: 1,
    eventId: identity(index),
    recoveryId,
    scopeHash,
    phase: index % 2 ? "settled" : "manual_required",
    reason: index % 2 ? "assistant_settled" : "reload_limit_reached",
    submissionStatus: "A_COMMITTED",
    reloadCount: index % 3,
    recoveryCycle: 1,
    sensitiveContext: false,
    consequentialAction: false,
    updatedAt: now + index,
    conversationTextIncluded: false,
    promptTextIncluded: false,
    draftIncluded: false,
    rawConversationIdIncluded: false
  };
}

function identity(value) {
  return Math.abs(Number(value)).toString(16).padStart(16, "0").slice(-16);
}
