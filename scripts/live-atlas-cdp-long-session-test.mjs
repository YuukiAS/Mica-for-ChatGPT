import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_MAX_CHECKPOINTS,
  runReadOnlyCaptureSession,
  writeRawSessionBundle
} from "./live-atlas-cdp-core.mjs";
import { assert } from "./live-atlas-common.mjs";

const threadUrl = "https://chatgpt.com/c/atlasLongSession_123";
const commands = [];
const sockets = new Set();
const oldFixedIdleEquivalentMs = 30;
const inactivityHardCapMs = 120;
const drainMs = 12;
let checkpointMessagesSent = 0;
let socketClosedAt = 0;

const server = http.createServer((request, response) => {
  if (request.url === "/json/list") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([
      { type: "page", url: "https://chatgpt.com/c/not-this-one", title: "wrong", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/wrong` },
      { type: "page", url: threadUrl, title: "Dedicated Atlas Long Session", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/right` }
    ]));
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

server.on("upgrade", (request, socket) => {
  sockets.add(socket);
  socket.on("error", () => {});
  socket.on("close", () => {
    sockets.delete(socket);
    socketClosedAt = performance.now();
  });
  const key = request.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = decodeFrame(buffer);
      if (!frame) break;
      buffer = frame.rest;
      if (frame.opcode === 8) {
        socket.end();
        continue;
      }
      const message = JSON.parse(frame.payload.toString("utf8"));
      commands.push({ method: message.method, params: message.params || {} });
      socket.write(encodeFrame(JSON.stringify({ id: message.id, result: resultFor(message.method, message.params || {}) })));
      if (message.method === "Log.enable") scheduleLongSession(socket);
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const out = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-long-cdp-"));
const started = performance.now();

try {
  const result = await runReadOnlyCaptureSession({
    port: server.address().port,
    threadUrl,
    out,
    idleMs: inactivityHardCapMs,
    drainMs
  });
  await writeRawSessionBundle({ out, threadUrl, session: result });
  await waitFor(() => socketClosedAt > 0, 80);
  const elapsedMs = performance.now() - started;
  const methods = commands.map((item) => item.method);
  const timeline = (await readFile(path.join(out, "timeline.ndjson"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const generations = new Set(timeline.map((event) => event.details?.generationId).filter((id) => Number.isFinite(id)));
  const surfaceFiles = await readdir(path.join(out, "surfaces"));
  const screenshotFiles = await readdir(path.join(out, "screenshots"));
  const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
  const coverage = JSON.parse(await readFile(path.join(out, "coverage.json"), "utf8"));
  const performanceJson = JSON.parse(await readFile(path.join(out, "performance.json"), "utf8"));

  assert(elapsedMs > oldFixedIdleEquivalentMs * 5, "long session did not exceed the old one-shot idle equivalent");
  assert(result.terminationReason === "atlas_stopped", `unexpected termination reason: ${result.terminationReason}`);
  assert(result.explicitStop === true, "explicit stop marker was not honored");
  assert(result.truncated === false, "long session was truncated");
  assert(result.maxCheckpoints === DEFAULT_MAX_CHECKPOINTS, "default checkpoint retention was not used");
  assert(checkpointMessagesSent > 24, "five-round simulation did not exceed the old 24 checkpoint limit");
  assert(result.checkpointCount === checkpointMessagesSent, "not all checkpoints were retained");
  for (const generation of [1, 2, 3, 4, 5]) assert(generations.has(generation), `generation ${generation} was not retained`);
  assert(socketClosedAt >= started, "CDP socket did not close cleanly");
  assert(surfaceFiles.length > 0, "no surface files were written");
  assert(screenshotFiles.length > 0, "no screenshot files were written");
  assert(manifest.explicitStop === true && manifest.truncated === false, "manifest does not record clean explicit stop");
  assert(performanceJson.explicitStop === true && performanceJson.truncated === false, "performance metadata does not record clean explicit stop");
  assert(Object.values(coverage).some((entry) => entry.status === "OBSERVED"), "coverage has no observed surfaces");
  assert(!methods.some((method) => /^Input\.|^Network\.|^Fetch\.|^Tracing\./.test(method) || ["Page.navigate", "Page.reload", "Runtime.evaluate"].includes(method)), "forbidden CDP command was sent");

  console.log(JSON.stringify({
    passed: true,
    terminationReason: result.terminationReason,
    inactivityHardCapMs: result.inactivityHardCapMs,
    drainMs: result.drainMs,
    maxCheckpoints: result.maxCheckpoints,
    checkpoints: result.checkpointCount,
    capturedCheckpoints: result.capturedCheckpointCount,
    generations: [...generations].sort((a, b) => a - b),
    surfaces: surfaceFiles.length,
    screenshots: screenshotFiles.length,
    elapsedMs: Math.round(elapsedMs),
    automatedSend: false,
    automatedUpload: false,
    automatedConnectorAction: false
  }, null, 2));
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await rm(out, { recursive: true, force: true });
}

function scheduleLongSession(socket) {
  let delay = 2;
  let scheduled = 0;
  const enqueue = (stateClass, generationId = null) => {
    scheduled += 1;
    const payload = {
      checkpointId: `long:${scheduled}`,
      stateClass,
      monotonicTimestamp: scheduled * 100,
      generationId
    };
    setTimeout(() => {
      if (!socket.destroyed) {
        checkpointMessagesSent += 1;
        socket.write(encodeFrame(JSON.stringify({
          method: "Runtime.consoleAPICalled",
          params: { args: [{ value: `MICA_ATLAS_CHECKPOINT ${JSON.stringify(payload)}` }] }
        })));
      }
    }, delay);
    delay += 3;
  };

  enqueue("atlas_started");
  for (let generation = 1; generation <= 5; generation += 1) {
    enqueue("manual_send_intent", generation);
    enqueue("user_turn_mounted", generation);
    enqueue("assistant_turn_mounted", generation);
    enqueue("assistant_first_content_mutation", generation);
    enqueue("assistant_stream_mutation_burst", generation);
    enqueue("assistant_action_bar_visible", generation);
    enqueue("assistant_settled", generation);
    delay += oldFixedIdleEquivalentMs + 10;
  }
  enqueue("atlas_stopped");
}

function waitFor(predicate, timeoutMs) {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate() || performance.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, 2);
    };
    tick();
  });
}

function resultFor(method, params) {
  if (method === "Page.getLayoutMetrics") return { visualViewport: { clientWidth: 980, clientHeight: 840, pageX: 0, pageY: 0 }, layoutViewport: { clientWidth: 980, clientHeight: 840 } };
  if (method === "DOMSnapshot.captureSnapshot") return fakeSnapshot(params.computedStyles || []);
  if (method === "Page.captureScreenshot") {
    assert(!!params.clip && Number(params.clip.width) > 0 && Number(params.clip.height) > 0 && params.captureBeyondViewport !== true, "screenshot was not clipped");
    return { data: Buffer.from("fakepng").toString("base64") };
  }
  if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: performance.now() }] };
  return {};
}

function fakeSnapshot(styles) {
  const strings = ["HTML", "BODY", "FORM", "ARTICLE", "DIV", "#text", "data-composer-surface", "true", "data-message-author-role", "assistant", "role", "toolbar", "aria-label", "Copy", "display", "grid", "border-radius", "18px"];
  return {
    documents: [{
      strings,
      nodes: {
        nodeName: [0, 1, 2, 3, 4, 5],
        nodeValue: ["", "", "", "", "", 5],
        parentIndex: [-1, 0, 1, 1, 3, 3],
        attributes: [[], [], [6, 7], [8, 9], [10, 11, 12, 13], []]
      },
      layout: {
        nodeIndex: [2, 3, 4],
        bounds: [[48, 720, 884, 80], [64, 180, 820, 360], [690, 548, 170, 44]],
        styles: [
          [styles.indexOf("display") >= 0 ? 15 : "", styles.indexOf("border-radius") >= 0 ? 17 : ""],
          [styles.indexOf("display") >= 0 ? 15 : "", ""],
          [styles.indexOf("display") >= 0 ? 15 : "", styles.indexOf("border-radius") >= 0 ? 17 : ""]
        ]
      }
    }]
  };
}

function encodeFrame(payload) {
  const body = Buffer.from(payload);
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  if (body.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  throw new Error("test frame too large");
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  }
  const masked = (buffer[1] & 0x80) !== 0;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload, rest: buffer.subarray(offset + length) };
}
