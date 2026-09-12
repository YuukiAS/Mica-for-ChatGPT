import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runReadOnlyCaptureSession } from "./live-atlas-cdp-core.mjs";
import { assert } from "./live-atlas-common.mjs";

const threadUrl = "https://chatgpt.com/c/atlasHandshake_123";
const out = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-handshake-"));
const runtimeEnable = deferred();
const logEnable = deferred();
const commands = [];
let messageHandler = null;
let listenerWasActiveAtReady = false;
let readyCount = 0;
let earlyUnavailable = true;

const sessionPromise = runReadOnlyCaptureSession({
  port: 9222,
  threadUrl,
  out,
  idleMs: 1000,
  drainMs: 1,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ([{
      type: "page",
      url: threadUrl,
      title: "Handshake",
      webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/handshake"
    }])
  }),
  connect: async () => fakeClient(),
  onAttached: (event) => {
    readyCount += 1;
    listenerWasActiveAtReady = event.messageListenerActive === true;
    assert(event.attached === true && event.runtimeEnabled === true && event.logEnabled === true, "ready event did not include complete attach state", event);
    emitCheckpoint("atlas_stopped", "handshake:stop", true);
  }
});

await waitFor(() => messageHandler && commands.length === 1);
assert(messageHandler, "message listener was not installed before enable commands");
assert(commands.join(",") === "Runtime.enable", "Runtime.enable should be the first command");
assert(readyCount === 0, "READY was announced before Runtime.enable completed");
assert(earlyUnavailable === true, "fixture should model pre-Log checkpoint events as unavailable");

runtimeEnable.resolve({});
await tick();
assert(commands.join(",") === "Runtime.enable,Log.enable", "Log.enable was not requested after Runtime.enable");
assert(readyCount === 0, "READY was announced before Log.enable completed");

logEnable.resolve({});
const session = await sessionPromise.finally(() => rm(out, { recursive: true, force: true }));
assert(readyCount === 1, "READY was not announced exactly once");
assert(listenerWasActiveAtReady, "READY was announced before checkpoint listener was active");
assert(session.attached === true && session.terminationReason === "atlas_stopped", "handshake session did not attach and stop cleanly", session);
assert(commands.includes("Performance.getMetrics"), "post-attach performance metric read did not run");

console.log(JSON.stringify({
  passed: true,
  cdpReadyHandshake: true,
  earlyStartRacePrevented: true,
  readyAfter: commands.slice(0, 2),
  listenerWasActiveAtReady,
  automatedSend: false,
  automatedUpload: false,
  automatedConnectorAction: false
}, null, 2));

function fakeClient() {
  return {
    commandsSent: commands,
    onMessage(handler) {
      messageHandler = handler;
    },
    async send(method) {
      commands.push(method);
      if (method === "Runtime.enable") return runtimeEnable.promise;
      if (method === "Log.enable") return logEnable.promise;
      if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
      return {};
    },
    async close() {}
  };
}

function emitCheckpoint(stateClass, checkpointId, terminal = false) {
  messageHandler?.({
    method: "Runtime.consoleAPICalled",
    params: {
      args: [{
        value: `MICA_ATLAS_CHECKPOINT ${JSON.stringify({ checkpointId, stateClass, terminal, monotonicTimestamp: 10 })}`
      }]
    }
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
}
