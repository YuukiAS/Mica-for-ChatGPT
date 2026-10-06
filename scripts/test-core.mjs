import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/src/reliability/turn-delivery-guard.ts", import.meta.url), "utf8");
const lowMemoryConfigSource = await readFile(new URL("../extension/src/low-memory/low-memory-config.ts", import.meta.url), "utf8");
const sandbox = { globalThis: {}, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "turn-delivery-guard.ts" });
const guard = sandbox.MicaTurnDeliveryGuard;
assert(guard, "turn delivery core was not exported");

let state = { name: guard.STATES.IDLE };
state.name = guard.reduce(state, "send_intent");
assert(state.name === guard.STATES.AWAITING_USER_COMMIT, "send_intent transition failed");
state.name = guard.reduce(state, "user_commit");
assert(state.name === guard.STATES.USER_COMMITTED, "user_commit transition failed");
state.name = guard.reduce(state, "assistant_progress");
assert(state.name === guard.STATES.ASSISTANT_GENERATING, "assistant_progress transition failed");
state.name = guard.reduce(state, "settled");
assert(state.name === guard.STATES.SETTLED, "settled transition failed");
assert(guard.reduce({ name: guard.STATES.AWAITING_USER_COMMIT }, "commit_timeout") === guard.STATES.GHOST_SEND, "ghost send transition failed");
assert(guard.reduce({ name: guard.STATES.USER_COMMITTED }, "progress_timeout") === guard.STATES.FAKE_WAITING, "fake waiting transition failed");
assert(guard.reduce({ name: guard.STATES.ASSISTANT_GENERATING }, "stale_response") === guard.STATES.STALE_RESPONSE, "stale response transition failed");
assert(guard.fingerprint(" alpha\n beta ") === guard.fingerprint("alpha beta"), "fingerprint whitespace normalization failed");
assert(!source.includes('addEventListener("input"') && !source.includes('addEventListener("beforeinput"'), "ordinary typing listeners are forbidden");
assert(!source.includes("setInterval("), "polling is forbidden");

const missingStorageConfig = await loadLowMemoryConfig({});
assert(missingStorageConfig.enabled === false, "missing extension storage must fail open with low-memory disabled");
const failedStorageConfig = await loadLowMemoryConfig({
  chrome: {
    runtime: { lastError: { message: "storage unavailable" } },
    storage: { local: { get(_defaults, callback) { callback({ enabled: true, lowMemory: true, lowMemoryKeepCount: 40 }); } } }
  }
});
assert(failedStorageConfig.enabled === false, "storage runtime error must fail open with low-memory disabled");
const healthyStorageConfig = await loadLowMemoryConfig({
  chrome: {
    runtime: { lastError: null },
    storage: { local: { get(defaults, callback) { callback(defaults); } } }
  }
});
assert(healthyStorageConfig.enabled === true && healthyStorageConfig.keepCount === 40, "healthy fresh install defaults must enable the 40-turn window");

console.log(JSON.stringify({ passed: true, cases: 13, states: Object.values(guard.STATES), lowMemoryConfig: { missingStorage: "disabled", storageError: "disabled", healthyDefaults: "enabled" } }, null, 2));

async function loadLowMemoryConfig(overrides) {
  const configSandbox = { globalThis: {}, ...overrides };
  configSandbox.globalThis = configSandbox;
  vm.runInNewContext(lowMemoryConfigSource, configSandbox, { filename: "low-memory-config.ts" });
  return configSandbox.MicaLowMemoryConfig.syncFromExtensionStorage();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
