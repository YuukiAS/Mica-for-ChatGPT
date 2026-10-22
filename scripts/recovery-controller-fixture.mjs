import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", DEV_DIST_DIR_NAME);
let now = 1_000;
let reloadCount = 0;
let copiedDraft = "";
let lastNotice = null;
let claimCount = 0;
let claimAvailable = true;
let nextTimerId = 1;
let nextFrameId = 1;
const timers = new Map();
const frames = new Map();
const listeners = new Map();
const sessionValues = {};
const localValues = {};

class FakeDate extends Date {
  static now() { return now; }
}
class FakeTextArea {}
class FakeInput {}
class FakeElement {
  constructor(tagName) { this.tagName = tagName; this.dataset = {}; this.style = {}; this.children = []; this.listeners = {}; this.textContent = ""; }
  setAttribute(name, value) { this[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  remove() { this.removed = true; }
}

const context = vm.createContext({
  console,
  structuredClone,
  Date: FakeDate,
  HTMLTextAreaElement: FakeTextArea,
  HTMLInputElement: FakeInput,
  document: {
    documentElement: { dataset: { micaFixture: "true" }, append(node) { lastNotice = node; } },
    createElement(tagName) { return new FakeElement(tagName); }
  },
  navigator: { clipboard: { async writeText(value) { copiedDraft = value; } } },
  location: { pathname: "/c/conversation-a", reload() { reloadCount += 1; } },
  addEventListener(type, listener) { listeners.set(type, listener); },
  requestAnimationFrame(callback) { const id = nextFrameId++; frames.set(id, callback); return id; },
  setTimeout(callback) { const id = nextTimerId++; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
  __MICA_FIXTURE_RELOAD__() { reloadCount += 1; },
  chrome: {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (message?.type === "MICA_RELIABILITY_CONTEXT") return callback({ ok: true, tabId: 7 });
        if (message?.type === "MICA_RELIABILITY_CLAIM_ACTION") {
          claimCount += 1;
          return callback(claimAvailable
            ? { ok: true, granted: true, actionId: message.claim?.actionId }
            : { ok: false, granted: false, reason: "claim_store_unavailable" });
        }
        if (message?.type === "MICA_RELIABILITY_APPEND_HISTORY") {
          const current = Array.isArray(localValues.micaRecoveryHistoryV1) ? localValues.micaRecoveryHistoryV1 : [];
          if (!current.some((item) => item.eventId === message.entry?.eventId)) localValues.micaRecoveryHistoryV1 = [...current, structuredClone(message.entry)].slice(-50);
          return callback({ ok: true, appended: true });
        }
        callback(null);
      }
    },
    storage: {
      session: storageArea(sessionValues),
      local: storageArea(localValues)
    }
  }
});
context.globalThis = context;

for (const file of ["settings-model.js", "recovery-state-machine.js", "recovery-controller.js"]) {
  vm.runInContext(await readFile(path.join(dist, file), "utf8"), context, { filename: file });
}

const turns = [];
const adapter = {
  listTurns() { return turns; },
  findComposer() { return null; },
  generationStateForTurn(turn) { return turn.generationState; }
};
const controller = context.MicaRecoveryController;
const phases = context.MicaRecoveryStateMachine.phases;

const configured = await controller.configure({
  adapter,
  getConversationKey: () => "conversation-a",
  settings: { enabled: true, noProgressTimeoutSeconds: 30, commitConfirmationTimeoutSeconds: 5, postReloadReconcileTimeoutSeconds: 5 }
});
flushFrames();
assert.equal(configured.ok, true);
assert.equal(controller.snapshot().phase, phases.IDLE);
assert.equal(controller.snapshot().scope.tabId, 7);

controller.recordSendIntent("hello", { toolSafety: "none" });
await flushPromises();
assert.equal(controller.snapshot().phase, phases.AWAITING_USER_COMMIT);
assert.equal(Object.values(sessionValues)[0].draft, "hello");
controller.recordSendIntent("must not replace active recovery", { toolSafety: "none" });
await flushPromises();
assert.equal(Object.values(sessionValues)[0].draft, "hello", "parallel send intent replaced the active recovery draft");

turns.push({ role: "user", turnId: "user-1", roleElement: { textContent: "hello" } });
controller.reconcile();
await flushPromises();
assert.equal(controller.snapshot().phase, phases.USER_COMMITTED);
assert.equal(Object.values(sessionValues)[0].draft, "");

now = 32_000;
flushTimers();
await flushPromises();
assert.equal(controller.snapshot().phase, phases.RELOADING);
assert.equal(reloadCount, 1);
assert.equal(claimCount, 1);
assert.equal(Object.values(sessionValues)[0].state.phase, phases.RELOADING);
assert.equal(Object.values(sessionValues)[0].state.promptTextIncluded, false);

const restored = await controller.configure({
  adapter,
  getConversationKey: () => "conversation-a",
  settings: { enabled: true, noProgressTimeoutSeconds: 30, commitConfirmationTimeoutSeconds: 5, postReloadReconcileTimeoutSeconds: 5 }
});
flushFrames();
assert.equal(restored.snapshot.phase, phases.RECONCILING);

turns.push({
  role: "assistant",
  turnId: "assistant-1",
  generationState: "SETTLED",
  answerRoot: { textContent: "completed answer" },
  element: { querySelectorAll() { return []; } }
});
controller.reconcile();
await flushPromises();
assert.equal(controller.snapshot().phase, phases.SETTLED);
assert.equal(Object.keys(sessionValues).length, 0);
assert.equal(localValues.micaRecoveryHistoryV1.at(-1).conversationTextIncluded, false);
assert.equal("draft" in localValues.micaRecoveryHistoryV1.at(-1), false);
assert.equal("conversationKey" in localValues.micaRecoveryHistoryV1.at(-1), false);
assert.equal(localValues.micaRecoveryHistoryV1.at(-1).rawConversationIdIncluded, false);

controller.recordSendIntent("uncertain draft", { toolSafety: "none" });
await flushPromises();
now = 38_000;
flushTimers();
await flushPromises();
assert.equal(controller.snapshot().phase, phases.MANUAL_REQUIRED);
assert.equal(controller.snapshot().submissionStatus, context.MicaRecoveryStateMachine.submission.UNKNOWN);
assert.equal(Object.values(sessionValues)[0].draft, "uncertain draft");
const copyButton = lastNotice.children.find((child) => child.tagName === "button");
assert.equal(copyButton.textContent, "Copy saved draft");
assert.equal(await copyButton.listeners.click({ isTrusted: true }), true);
await flushPromises();
assert.equal(copiedDraft, "uncertain draft");
assert.equal(Object.keys(sessionValues).length, 0);
assert.equal(controller.snapshot().phase, phases.IDLE);

controller.recordSendIntent("tool prompt", { toolSafety: "none" });
await flushPromises();
turns.push({ role: "user", turnId: "user-2", roleElement: { textContent: "tool prompt" } });
controller.reconcile();
await flushPromises();
turns.push({
  role: "assistant",
  turnId: "assistant-2",
  generationState: "STREAMING",
  answerRoot: { textContent: "" },
  element: {
    querySelectorAll() { return [{}]; },
    querySelector(selector) { return selector.includes("data-testid*='tool'") ? {} : null; }
  }
});
controller.reconcile();
await flushPromises();
assert.equal(controller.snapshot().phase, phases.MANUAL_REQUIRED);
assert.equal(controller.snapshot().reason, "unsafe_tool_state");
assert.equal(reloadCount, 1, "unknown tool state must not add a recovery reload");
controller.updateSettings({ enabled: false });
await flushPromises();
assert.equal(controller.snapshot().phase, phases.CANCELLED);
assert.equal(controller.snapshot().configured, false);
assert.equal(Object.keys(sessionValues).length, 0);

claimAvailable = false;
controller.updateSettings({ enabled: true, noProgressTimeoutSeconds: 30, commitConfirmationTimeoutSeconds: 5, postReloadReconcileTimeoutSeconds: 5 });
controller.recordSendIntent("backend unavailable", { toolSafety: "none" });
await flushPromises();
turns.push({ role: "user", turnId: "user-3", roleElement: { textContent: "backend unavailable" } });
controller.reconcile();
await flushPromises();
now = 100_000;
flushTimers();
await flushPromises();
assert.equal(controller.snapshot().phase, phases.MANUAL_REQUIRED);
assert.equal(controller.snapshot().reason, "recovery_backend_unavailable");
assert.equal(reloadCount, 1, "ledger failure must fail closed without another reload");

console.log(JSON.stringify({
  passed: true,
  configuredIdleScope: true,
  exactCommit: true,
  persistedBeforeReload: true,
  restoredReconciliation: true,
  firstSeenSettledAnswerClosesRecovery: true,
  uncertainDraftPreservedForManualCopy: true,
  unknownToolFailsManualWithoutReload: true,
  disablingGuardCancelsRecovery: true,
  privacySafeHistory: true,
  activeIntentCannotReplaceDraft: true,
  backgroundActionClaimed: claimCount >= 1,
  backgroundUnavailableFailsManual: true,
  reloadCount
}, null, 2));

function storageArea(values) {
  return {
    get(defaults, callback) { callback({ ...(defaults || {}), ...values }); },
    set(next, callback) { Object.assign(values, structuredClone(next)); callback?.(); },
    remove(key, callback) { delete values[key]; callback?.(); }
  };
}

function flushFrames() {
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) callback(now);
}

function flushTimers() {
  const queued = [...timers.values()];
  timers.clear();
  for (const callback of queued) callback();
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
