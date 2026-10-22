import { readFile, mkdir, writeFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "low-memory-background.js"), "utf8");
const firstInstall = await runScenario({ settings: {}, delayMs: 25, initiallyRegistered: false, concurrent: true });
const storageFailure = await runScenario({ settings: {}, storageError: true, initiallyRegistered: true });
const disabled = await runScenario({ settings: { enabled: true, lowMemory: false }, initiallyRegistered: true });
const workerRestartRecovery = await runWorkerRestartRecovery();

assert(firstInstall.beforeDelay === false && firstInstall.registered === true && firstInstall.registerCalls === 1, "first-install registration was not serialized before early MAIN injection");
assert(storageFailure.registered === false && storageFailure.unregisterCalls >= 1, "storage failure did not fail open by removing the interceptor");
assert(disabled.registered === false && disabled.unregisterCalls >= 1, "disabled setting left the interceptor registered");
assert(workerRestartRecovery.unregisteredBeforeReload && workerRestartRecovery.stayedUnregisteredAfterRestart && workerRestartRecovery.registeredAfterComplete && workerRestartRecovery.mode === "full_history_bypass", "full-history reload was not durable across service-worker restart");
assert(workerRestartRecovery.completenessProofPreserved, "conversation completeness proof was not durable across service-worker restart");
assert(workerRestartRecovery.recoveryClaimGranted && workerRestartRecovery.recoveryDuplicateRejected, "recovery action claim was not durable across service-worker restart");
assert(workerRestartRecovery.nativeActionClaimGranted && workerRestartRecovery.nativeActionDuplicateRejected, "native recovery action claim was not durable across service-worker restart");
assert(workerRestartRecovery.recoveryInvalidSourceRejected, "recovery ledger accepted an unsupported sender");
assert(workerRestartRecovery.recoveryHistoryDeduplicated && workerRestartRecovery.recoveryHistoryContentExcluded, "privacy-safe recovery history was not deduplicated");

const output = { passed: true, firstInstall, storageFailure, disabled, workerRestartRecovery, controlChannel: "chrome.scripting.registerContentScripts", siteWritableConfigAccepted: false };
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "low-memory-registration.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

async function runScenario({ settings, delayMs = 0, storageError = false, initiallyRegistered, concurrent = false }) {
  const events = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  let registered = initiallyRegistered;
  let registerCalls = 0;
  let unregisterCalls = 0;
  const runtime = { lastError: null, onInstalled: events(), onStartup: events(), onMessage: events() };
  const chrome = {
    runtime,
    storage: {
      onChanged: events(),
      local: {
        get: (defaults, callback) => setTimeout(() => {
          runtime.lastError = storageError ? { message: "fixture storage failure" } : null;
          callback({ ...defaults, ...settings });
          runtime.lastError = null;
        }, delayMs)
      },
      session: { get: (_defaults, callback) => callback({}), set: async () => {} }
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids } = {}) => registered && (!ids || ids.includes("mica-low-memory-main-v3")) ? [{ id: "mica-low-memory-main-v3" }] : [],
      registerContentScripts: async (entries) => { if (entries.some((entry) => entry.id === "mica-low-memory-main-v3")) { registerCalls += 1; registered = true; } },
      unregisterContentScripts: async ({ ids } = {}) => { if (!ids || ids.includes("mica-low-memory-main-v3")) { unregisterCalls += 1; registered = false; } }
    },
    tabs: { onUpdated: events(), onRemoved: events() }
  };
  vm.runInNewContext(source, { chrome, URL, setTimeout, clearTimeout, console });
  const beforeDelay = registered;
  if (concurrent) {
    chrome.storage.onChanged.listeners[0]?.({ enabled: { newValue: true } }, "local");
    void new Promise((resolve) => chrome.runtime.onMessage.listeners[0]?.({ type: "MICA_LOW_MEMORY_SYNC" }, {}, resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs + 40));
  return { beforeDelay, registered, registerCalls, unregisterCalls, storageError, delayMs };
}

async function runWorkerRestartRecovery() {
  const shared = { registered: false, session: {}, local: {}, registerCalls: 0, unregisterCalls: 0 };
  const first = createBackgroundInstance(shared);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const completenessProof = {
    schemaVersion: 1,
    expectedTurnCount: 84,
    roleSequenceHash: "1234abcd",
    source: "validated-conversation-graph",
    conversationId: "conversation-12345678",
    capturedAt: new Date().toISOString()
  };
  await new Promise((resolve) => first.chrome.runtime.onMessage.listeners[0]({ type: "MICA_LOW_MEMORY_PREPARE_FULL_HISTORY", completenessProof }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } }, resolve));
  const unregisteredBeforeReload = !shared.registered;
  const recoveryClaim = {
    schemaVersion: 1,
    actionId: "1111111111111111",
    recoveryId: "2222222222222222",
    scopeHash: "3333333333333333",
    sequence: 1,
    type: "reload",
    ordinal: 1
  };
  const firstClaim = await sendMessage(first, { type: "MICA_RELIABILITY_CLAIM_ACTION", claim: recoveryClaim }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } });
  const nativeActionClaim = {
    schemaVersion: 1,
    actionId: "5555555555555555",
    recoveryId: "6666666666666666",
    scopeHash: "3333333333333333",
    subjectHash: "7777777777777777",
    controlIdHash: "8888888888888888",
    sequence: 2,
    type: "native_stop",
    ordinal: 1
  };
  const nativeFirstClaim = await sendMessage(first, { type: "MICA_RELIABILITY_CLAIM_ACTION", claim: nativeActionClaim }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } });
  const second = createBackgroundInstance(shared);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const stayedUnregisteredAfterRestart = !shared.registered;
  second.chrome.tabs.onUpdated.listeners[0](7, { status: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const tabMode = await new Promise((resolve) => second.chrome.runtime.onMessage.listeners[0]({ type: "MICA_LOW_MEMORY_GET_TAB_MODE" }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } }, resolve));
  const duplicateClaim = await sendMessage(second, { type: "MICA_RELIABILITY_CLAIM_ACTION", claim: recoveryClaim }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } });
  const nativeDuplicateClaim = await sendMessage(second, { type: "MICA_RELIABILITY_CLAIM_ACTION", claim: nativeActionClaim }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } });
  const invalidSource = await sendMessage(second, { type: "MICA_RELIABILITY_CLAIM_ACTION", claim: recoveryClaim }, { tab: { id: 7, url: "https://example.com/" } });
  const historyEntry = {
    schemaVersion: 1,
    eventId: "4444444444444444",
    recoveryId: "2222222222222222",
    scopeHash: "3333333333333333",
    phase: "settled",
    reason: "assistant_settled",
    submissionStatus: "A_COMMITTED",
    reloadCount: 1,
    recoveryCycle: 1,
    sensitiveContext: false,
    consequentialAction: false,
    updatedAt: Date.now(),
    conversationTextIncluded: false,
    promptTextIncluded: false,
    draftIncluded: false,
    rawConversationIdIncluded: false,
    promptText: "must not persist"
  };
  const historyFirst = await sendMessage(second, { type: "MICA_RELIABILITY_APPEND_HISTORY", entry: historyEntry }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } });
  const historyDuplicate = await sendMessage(second, { type: "MICA_RELIABILITY_APPEND_HISTORY", entry: historyEntry }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } });
  const historySerialized = JSON.stringify(shared.local.micaRecoveryHistoryV1 || []);
  return {
    unregisteredBeforeReload,
    stayedUnregisteredAfterRestart,
    registeredAfterComplete: shared.registered,
    mode: shared.session["mica.lowMemory.tabModes.v3"]?.["7"] || null,
    completenessProofPreserved: tabMode?.completenessProof?.conversationId === completenessProof.conversationId
      && tabMode?.completenessProof?.expectedTurnCount === completenessProof.expectedTurnCount,
    recoveryClaimGranted: firstClaim?.ok === true && firstClaim?.granted === true,
    recoveryDuplicateRejected: duplicateClaim?.ok === true && duplicateClaim?.granted === false && duplicateClaim?.reason === "already_claimed",
    nativeActionClaimGranted: nativeFirstClaim?.ok === true && nativeFirstClaim?.granted === true,
    nativeActionDuplicateRejected: nativeDuplicateClaim?.ok === true && nativeDuplicateClaim?.granted === false && nativeDuplicateClaim?.reason === "already_claimed",
    recoveryInvalidSourceRejected: invalidSource?.ok === false && invalidSource?.reason === "invalid_recovery_source",
    recoveryHistoryDeduplicated: historyFirst?.appended === true && historyDuplicate?.appended === false && shared.local.micaRecoveryHistoryV1?.length === 1,
    recoveryHistoryContentExcluded: !historySerialized.includes("must not persist") && !historySerialized.includes("\"promptText\":"),
    registerCalls: shared.registerCalls,
    unregisterCalls: shared.unregisterCalls
  };
}

function createBackgroundInstance(shared) {
  const events = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  const runtime = { lastError: null, onInstalled: events(), onStartup: events(), onMessage: events() };
  const chrome = {
    runtime,
    storage: {
      onChanged: events(),
      local: storageArea(shared.local, { enabled: true, lowMemory: true }),
      session: {
        ...storageArea(shared.session),
        async remove(key, callback) { delete shared.session[key]; callback?.(); }
      }
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids } = {}) => shared.registered && (!ids || ids.includes("mica-low-memory-main-v3")) ? [{ id: "mica-low-memory-main-v3" }] : [],
      registerContentScripts: async (entries) => { if (entries.some((entry) => entry.id === "mica-low-memory-main-v3")) { shared.registerCalls += 1; shared.registered = true; } },
      unregisterContentScripts: async ({ ids } = {}) => { if (!ids || ids.includes("mica-low-memory-main-v3")) { shared.unregisterCalls += 1; shared.registered = false; } }
    },
    tabs: { onUpdated: events(), onRemoved: events() }
  };
  vm.runInNewContext(source, { chrome, URL, setTimeout, clearTimeout, console });
  return { chrome };
}

function storageArea(values, fixed = {}) {
  return {
    get(defaults, callback) {
      const result = { ...(defaults || {}), ...fixed, ...values };
      if (callback) { callback(result); return undefined; }
      return Promise.resolve(result);
    },
    set(next, callback) {
      Object.assign(values, structuredClone(next));
      callback?.();
      return Promise.resolve();
    },
    remove(key, callback) {
      delete values[key];
      callback?.();
      return Promise.resolve();
    }
  };
}

function sendMessage(instance, message, sender) {
  return new Promise((resolve) => instance.chrome.runtime.onMessage.listeners[0](message, sender, resolve));
}

function assert(condition, message) { if (!condition) throw new Error(message); }
