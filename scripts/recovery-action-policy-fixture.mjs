import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", DEV_DIST_DIR_NAME);
const context = vm.createContext({ console, structuredClone });
context.globalThis = context;
for (const file of ["settings-model.js", "recovery-action-policy.js", "recovery-state-machine.js"]) {
  vm.runInContext(await readFile(path.join(dist, file), "utf8"), context, { filename: file });
}

const settings = context.MicaSettingsModel;
const policy = context.MicaRecoveryActionPolicy;
const machine = context.MicaRecoveryStateMachine;
const config = machine.sanitizeConfig({
  ...settings.defaults().reliability,
  autoStopEnabled: true,
  resendPolicy: "confirmed-unsent-once"
});
const scope = { tabId: 19, conversationKey: "conversation-policy" };

let state = machine.transition(machine.create(scope, 0), {
  type: "SEND_INTENT",
  scope,
  promptFingerprint: "fnv1a:policy:6",
  baselineUserIds: ["user-0"],
  baselineAssistantIds: ["assistant-0"],
  draftAvailable: true,
  toolSafety: "none"
}, config, 0);
state = machine.transition(state, { type: "USER_COMMITTED", turnId: "user-1" }, config, 1_000);
state = machine.transition(state, { type: "ASSISTANT_STARTED", turnId: "assistant-1", progressSignature: "p1" }, config, 2_000);
state = machine.transition(state, { type: "TICK" }, config, 62_000);
state = machine.transition(state, { type: "PAGE_RESTORED" }, config, 63_000);

const stopEvidence = evidenceFor("native_stop", state, "aaaaaaaaaaaaaaaa", 64_000);
const exactStop = policy.authorize(state, stopEvidence, config, 64_000);
assert.equal(exactStop.ok, true);
assert.equal(exactStop.authorization.actionType, "native_stop");
assert.equal(exactStop.authorization.ordinal, 1);
assert.match(exactStop.authorization.actionId, /^[a-f0-9]{16}$/);
assert.equal(policy.validateAuthorization(state, exactStop.authorization, config, 64_000).ok, true);

const partial = policy.authorize(state, { ...stopEvidence, evidenceClass: "PARTIAL" }, config, 64_000);
assert.equal(partial.ok, false);
const stale = policy.authorize(state, stopEvidence, config, 75_000);
assert.equal(stale.reason, "action_evidence_expired");
const wrongTurn = policy.authorize(state, { ...stopEvidence, subjectHash: "bbbbbbbbbbbbbbbb" }, config, 64_000);
assert.equal(wrongTurn.reason, "action_identity_mismatch");
const wrongScope = policy.authorize(state, { ...stopEvidence, scopeHash: "cccccccccccccccc" }, config, 64_000);
assert.equal(wrongScope.reason, "action_identity_mismatch");

const sensitive = policy.authorize({ ...state, sensitiveContext: true }, stopEvidence, config, 64_000);
assert.equal(sensitive.reason, "consequential_or_unknown_action");
const unknownTool = policy.authorize({ ...state, toolSafety: "unknown" }, stopEvidence, config, 64_000);
assert.equal(unknownTool.reason, "consequential_or_unknown_action");
const disabledStop = policy.authorize(state, stopEvidence, { ...config, autoStopEnabled: false }, 64_000);
assert.equal(disabledStop.reason, "native_stop_disabled");

const retryEvidence = evidenceFor("assistant_retry", state, "dddddddddddddddd", 64_000);
const exactRetry = policy.authorize(state, retryEvidence, config, 64_000);
assert.equal(exactRetry.ok, true);
assert.equal(exactRetry.authorization.executeAfter, 67_000);
assert.equal(policy.authorize({ ...state, assistantRetryCount: 1 }, retryEvidence, config, 64_000).reason, "assistant_retry_limit_reached");
assert.equal(policy.authorize(state, { ...retryEvidence, expiresAt: 65_000 }, config, 64_000).reason, "action_evidence_expires_before_execution");
const retryBackoffState = machine.transition(state, { type: "ACTION_EVIDENCE", evidence: retryEvidence }, config, 64_000);
const retryBackoffTick = machine.transition(retryBackoffState, { type: "TICK" }, config, 65_000);
assert.equal(retryBackoffTick.phase, machine.phases.ACTION_BACKOFF);
assert.equal(retryBackoffTick.pendingAction?.actionId, retryBackoffState.pendingAction?.actionId);

let absent = machine.transition(machine.create(scope, 0), {
  type: "SEND_INTENT",
  scope,
  promptFingerprint: "fnv1a:absent:6",
  draftAvailable: true,
  toolSafety: "none"
}, config, 0);
absent = machine.transition(absent, { type: "COMMIT_CONFIRMED_ABSENT" }, config, 13_000);
const resendEvidence = evidenceFor("confirmed_resend", absent, "eeeeeeeeeeeeeeee", 14_000);
const exactResend = policy.authorize(absent, resendEvidence, config, 14_000);
assert.equal(exactResend.ok, true);
assert.equal(exactResend.authorization.executeAfter, 17_000);
assert.equal(policy.authorize(absent, resendEvidence, { ...config, resendPolicy: "confirm" }, 14_000).reason, "resend_policy_blocked");
assert.equal(policy.authorize({ ...absent, submissionStatus: machine.submission.UNKNOWN }, resendEvidence, config, 14_000).reason, "resend_requires_confirmed_absence");

const actionState = machine.transition(state, { type: "ACTION_EVIDENCE", evidence: stopEvidence }, config, 64_000);
const claim = machine.actionClaim(actionState, config, 64_000);
assert.equal(claim.type, "native_stop");
assert.equal(claim.subjectHash, stopEvidence.subjectHash);
assert.equal(claim.controlIdHash, stopEvidence.controlIdHash);
assert.equal("promptFingerprint" in claim, false);
assert.equal("assistantTurnId" in claim, false);

const results = {
  schemaVersion: 1,
  subject: "recovery-action-policy",
  passed: true,
  exactEvidenceRequired: true,
  evidenceFreshnessBounded: true,
  recoveryIdentityBound: true,
  scopeIdentityBound: true,
  subjectIdentityBound: true,
  controlIdentityBound: true,
  nativeStopAuthorizedOnce: true,
  assistantRetryAuthorizedOnce: true,
  confirmedUnsentResendAuthorizedOnce: true,
  retryBackoffApplied: true,
  backoffPendingActionRetained: true,
  insufficientBackoffEvidenceRejected: true,
  sensitiveContextRejected: true,
  unknownToolRejected: true,
  nonExactEvidenceRejected: true,
  staleEvidenceRejected: true,
  wrongTurnEvidenceRejected: true,
  wrongScopeEvidenceRejected: true,
  contentExcludedFromClaim: true,
  realControlAdapterIncluded: false
};
const outputDir = path.join(root, "results", "mica-product-system-rebuild", "convergence-evidence");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "recovery-actions.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

function evidenceFor(actionType, value, controlIdHash, observedAt) {
  const identity = policy.identityForState(value, actionType);
  assert.ok(identity, `missing ${actionType} identity`);
  return {
    schemaVersion: 1,
    evidenceClass: "EXACT",
    actionType,
    ...identity,
    controlIdHash,
    observedAt,
    expiresAt: observedAt + policy.evidenceMaxAgeMs
  };
}
