import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", DEV_DIST_DIR_NAME);
let now = 20_000;
let nextFrameId = 1;
const frames = new Map();
const submitted = [];
const executed = [];

class FakeDate extends Date { static now() { return now; } }

const document = {};
const context = vm.createContext({
  console,
  document,
  Date: FakeDate,
  requestAnimationFrame(callback) { const id = nextFrameId++; frames.set(id, callback); return id; }
});
context.globalThis = context;
for (const file of ["recovery-action-policy.js", "recovery-control-adapter.js"]) {
  vm.runInContext(await readFile(path.join(dist, file), "utf8"), context, { filename: file });
}

const policy = context.MicaRecoveryActionPolicy;
let state = recoveryState();
const controller = {
  snapshot() { return structuredClone(state); },
  submitActionEvidence(evidence) { submitted.push(structuredClone(evidence)); }
};
let available = new Map([["native_stop", exactObservation("native_stop", state, "1111111111111111")]]);
const adapter = {
  inspectRecoveryControl(actionType) { return available.get(actionType) || { actionType, evidenceClass: "MISSING", reason: "current_site_contract_unproven", controlIdHash: null, subjectHash: null, variantId: "unproven-v1" }; },
  executeRecoveryControl(action) {
    executed.push(structuredClone(action));
    const observation = available.get(action.type);
    return observation?.controlIdHash === action.controlIdHash
      ? { ok: true, reason: "exact_native_control_invoked", controlIdHash: action.controlIdHash }
      : { ok: false, reason: "recovery_control_identity_changed" };
  }
};
const controls = context.MicaRecoveryControlAdapter;
const settings = { enabled: true, autoRecoveryEnabled: true, autoStopEnabled: true, maxAutoAssistantRetries: 1, maxAutoNewMessageResends: 1, retryBackoffSeconds: 3, resendPolicy: "confirmed-unsent-once" };

controls.configure({ adapter, controller, settings });
flushFrames();
assert.equal(submitted.length, 1);
assert.equal(submitted[0].actionType, "native_stop");
assert.equal(submitted[0].evidenceClass, "EXACT");
controls.scheduleReconcile();
flushFrames();
assert.equal(submitted.length, 1, "same exact control evidence must be submitted once");

const stopAuthorization = policy.authorize(state, submitted[0], settings, now).authorization;
const stopResult = await controls.execute({ type: "native_stop", ...stopAuthorization });
assert.equal(stopResult.ok, true);
assert.equal(stopResult.actionId, stopAuthorization.actionId);
assert.equal(executed.length, 1);
assert.equal((await controls.execute({ type: "native_stop", ...stopAuthorization, controlIdHash: "2222222222222222" })).ok, false);

state = recoveryState({ sequence: 2, consequentialAction: true });
available = new Map([["native_stop", exactObservation("native_stop", state, "3333333333333333")]]);
controls.scheduleReconcile();
flushFrames();
assert.equal(submitted.length, 1, "consequential state must not submit control evidence");

state = recoveryState({ sequence: 3 });
available = new Map([["assistant_retry", exactObservation("assistant_retry", state, "4444444444444444")]]);
controls.updateSettings({ ...settings, autoStopEnabled: false });
flushFrames();
assert.equal(submitted.at(-1).actionType, "assistant_retry");

state = recoveryState({
  sequence: 4,
  phase: "manual_required",
  submissionStatus: "B_NOT_COMMITTED",
  reason: "commit_confirmed_absent",
  assistantTurnId: null,
  promptFingerprint: "fnv1a:draft:12",
  draftAvailable: true
});
available = new Map([["confirmed_resend", exactObservation("confirmed_resend", state, "5555555555555555")]]);
controls.updateSettings(settings);
flushFrames();
assert.equal(submitted.at(-1).actionType, "confirmed_resend");

state = recoveryState({ sequence: 5 });
available = new Map();
controls.updateSettings(settings);
flushFrames();
assert.equal(controls.getStatus().evidenceClass, "MISSING");
assert.equal(submitted.length, 3);

console.log(JSON.stringify({
  passed: true,
  exactEvidenceSubmittedOnce: true,
  subjectAndControlBoundExecution: true,
  changedControlRejected: true,
  consequentialStateRejected: true,
  retryFallbackSupported: true,
  confirmedUnsentResendSupported: true,
  unknownLiveContractFailsOpen: true
}, null, 2));

function recoveryState(overrides = {}) {
  return {
    phase: "reconciling",
    sequence: 1,
    scope: { tabId: 7, conversationKey: "conversation-a", turnKey: null },
    submissionStatus: "A_COMMITTED",
    intentAt: 1_000,
    promptFingerprint: "fnv1a:prompt:6",
    assistantTurnId: "assistant-turn-9",
    draftAvailable: false,
    sensitiveContext: false,
    consequentialAction: false,
    toolSafety: "none",
    userStopped: false,
    reason: "page_restored_reconciling",
    nativeStopCount: 0,
    resendCount: 0,
    assistantRetryCount: 0,
    ...overrides
  };
}

function exactObservation(actionType, targetState, controlIdHash) {
  return {
    actionType,
    evidenceClass: "EXACT",
    reason: "contract_match",
    controlIdHash,
    subjectHash: policy.identityForState(targetState, actionType).subjectHash,
    variantId: `fixture-${actionType}-control-v1`
  };
}

function flushFrames() {
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) callback(now);
}
