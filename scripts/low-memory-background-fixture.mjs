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
  const shared = { registered: false, session: {}, registerCalls: 0, unregisterCalls: 0 };
  const first = createBackgroundInstance(shared);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await new Promise((resolve) => first.chrome.runtime.onMessage.listeners[0]({ type: "MICA_LOW_MEMORY_PREPARE_FULL_HISTORY" }, { tab: { id: 7, url: "https://chatgpt.com/c/fixture" } }, resolve));
  const unregisteredBeforeReload = !shared.registered;
  const second = createBackgroundInstance(shared);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const stayedUnregisteredAfterRestart = !shared.registered;
  second.chrome.tabs.onUpdated.listeners[0](7, { status: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 40));
  return {
    unregisteredBeforeReload,
    stayedUnregisteredAfterRestart,
    registeredAfterComplete: shared.registered,
    mode: shared.session["mica.lowMemory.tabModes.v3"]?.["7"] || null,
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
      local: { get: (defaults, callback) => callback({ ...defaults, enabled: true, lowMemory: true }) },
      session: {
        get: (defaults, callback) => callback({ ...defaults, ...shared.session }),
        set: async (value) => { Object.assign(shared.session, value); }
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

function assert(condition, message) { if (!condition) throw new Error(message); }
