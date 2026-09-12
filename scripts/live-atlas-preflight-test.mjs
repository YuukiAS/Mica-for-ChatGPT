import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { assert } from "./live-atlas-common.mjs";

const threadUrl = "https://chatgpt.com/g/g-p-test/project/mica/c/preflightProject_123?model=gpt-5";
const commands = [];
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

const server = http.createServer((request, response) => {
  if (request.url === "/json/list") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([
      { type: "page", url: "https://chatgpt.com/c/preflightProject_123?model=gpt-5", title: "wrong normalized", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/wrong` },
      { type: "page", url: threadUrl, title: "project exact", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/project` }
    ]));
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

server.on("upgrade", (request, socket) => {
  socket.on("error", () => {});
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
      if (frame.opcode === 10) continue;
      const message = JSON.parse(frame.payload.toString("utf8"));
      commands.push(message.method);
      socket.write(encodeFrame(JSON.stringify({ id: message.id, result: resultFor(message.method, message.params || {}) })));
      if (message.method === "Log.enable") schedulePreflight(socket);
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const temp = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-preflight-"));
const raw = path.join(temp, "raw");
const sanitized = path.join(temp, "sanitized");
await mkdir(temp, { recursive: true });

try {
  const result = await run("node", [
    "scripts/live-atlas-real-edge-preflight.mjs",
    `--port=${server.address().port}`,
    `--thread-url=${threadUrl}`,
    "--session-id=preflight-test",
    `--out=${raw}`,
    `--sanitized=${sanitized}`
  ]);
  assert(result.code === 0, "preflight command failed", result);
  const manifest = JSON.parse(await readFile(path.join(raw, "manifest.json"), "utf8"));
  const performanceJson = JSON.parse(await readFile(path.join(raw, "performance.json"), "utf8"));
  const timeline = (await readFile(path.join(raw, "timeline.ndjson"), "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert(result.stdout.includes('"REAL_EDGE_PREFLIGHT": "PASS"'), "preflight did not print PASS");
  assert(result.stdout.includes("REAL_EDGE_CDP_ATTACHED = YES") && result.stdout.includes("SAFE_TO_START_ATLAS = YES"), "preflight did not expose CDP ready handshake");
  assert(/"screenshotCoordinateEvidenceCount":\s*[1-9]/.test(result.stdout), "preflight did not report screenshot coordinate evidence");
  assert(manifest.targetUrlExactMatch === true && manifest.attached === true, "preflight did not prove exact attachment");
  assert(manifest.terminationReason === "atlas_stopped" && manifest.truncated === false, "preflight did not prove clean termination");
  assert(performanceJson.recorderReportsIngested === 1 && performanceJson.recorderPerformanceIngested === true, "preflight did not prove recorder ingestion");
  assert(timeline.some((event) => event.type === "composer_input" && event.timeBase === "atlas-session-relative"), "preflight raw timeline lacks recorder event");
  assert(commands.includes("Page.captureScreenshot") && !commands.some((method) => /^Input\.|^Network\.|^Fetch\.|^Tracing\./.test(method)), "preflight sent forbidden or missing CDP commands");
  console.log(JSON.stringify({
    passed: true,
    realEdgePreflightAssertions: true,
    projectThreadUrlSupport: manifest.targetUrlExactMatch,
    screenshotCoordinateIntegrity: true,
    recorderReportsIngested: performanceJson.recorderReportsIngested,
    recorderPerformanceIngested: performanceJson.recorderPerformanceIngested,
    automatedSend: false,
    automatedUpload: false,
    automatedConnectorAction: false
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

function schedulePreflight(socket) {
  const report = {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas",
    session: { id: "preflight-recorder" },
    privacy: { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false },
    safety: { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false },
    coverage: {},
    counters: { checkpoints: 2 },
    performance: { eventTiming: [], longAnimationFrame: [], longTask: [], layoutShift: [], memory: null },
    timeline: [{ schemaVersion: 1, type: "composer_input", relativeTimeMs: 25, details: { inputType: "insertText", dataLength: 0 } }]
  };
  const payload = JSON.stringify(report);
  setTimeout(() => writeCheckpoint(socket, "atlas_started", "p:1", { x: 40, y: 700, width: 820, height: 88 }), 2);
  setTimeout(() => writeCheckpoint(socket, "mica_overlay_state", "p:2", { x: 810, y: 732, width: 72, height: 48 }), 4);
  setTimeout(() => {
    socket.write(encodeFrame(JSON.stringify({
      method: "Runtime.consoleAPICalled",
      params: { args: [{ value: `MICA_ATLAS_REPORT_CHUNK ${JSON.stringify({ schemaVersion: 1, sessionId: "preflight-recorder", index: 0, total: 1, data: payload })}` }] }
    })));
  }, 6);
  setTimeout(() => writeCheckpoint(socket, "atlas_stopped", "p:stop", null, true), 8);
}

function writeCheckpoint(socket, stateClass, checkpointId, targetRect, terminal = false) {
  socket.write(encodeFrame(JSON.stringify({
    method: "Runtime.consoleAPICalled",
    params: { args: [{ value: `MICA_ATLAS_CHECKPOINT ${JSON.stringify({ checkpointId, stateClass, monotonicTimestamp: 100, targetRect, terminal })}` }] }
  })));
}

function resultFor(method, params) {
  if (method === "Page.getLayoutMetrics") {
    return {
      cssVisualViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 0, zoom: 1 },
      cssLayoutViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 0 },
      cssContentSize: { x: 0, y: 0, width: 900, height: 900 },
      visualViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 777 },
      layoutViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 888 }
    };
  }
  if (method === "DOMSnapshot.captureSnapshot") return fakeSnapshot(params.computedStyles || []);
  if (method === "Page.captureScreenshot") {
    assert(!!params.clip && params.captureBeyondViewport === true, "preflight screenshot was not clipped from page coordinates");
    return { data: pngBytes.toString("base64") };
  }
  if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
  return {};
}

function fakeSnapshot(styles) {
  const strings = [];
  const intern = (value) => {
    let index = strings.indexOf(value);
    if (index < 0) {
      index = strings.length;
      strings.push(value);
    }
    return index;
  };
  const nodeName = [];
  const nodeValue = [];
  const parentIndex = [];
  const attributes = [];
  const layoutNodeIndex = [];
  const bounds = [];
  const layoutStyles = [];
  const addNode = (name, parent, attrs = {}, rect = null) => {
    const index = nodeName.length;
    nodeName.push(intern(name));
    nodeValue.push("");
    parentIndex.push(parent);
    attributes.push(Object.entries(attrs).flatMap(([key, value]) => [intern(key), intern(value)]));
    if (rect) {
      layoutNodeIndex.push(index);
      bounds.push([rect.x, rect.y, rect.width, rect.height]);
      layoutStyles.push(styles.map((style) => intern(style === "position" ? "fixed" : style === "display" ? "grid" : "")));
    }
    return index;
  };
  const html = addNode("HTML", -1);
  const body = addNode("BODY", html);
  addNode("FORM", body, { "data-composer-surface": "true", "data-testid": "composer" }, { x: 40, y: 700, width: 820, height: 88 });
  addNode("MICA-OVERLAY", body, { "data-mica-root": "true" }, { x: 810, y: 732, width: 72, height: 48 });
  return { strings, documents: [{ nodes: { nodeName, nodeValue, parentIndex, attributes }, layout: { nodeIndex: layoutNodeIndex, bounds, styles: layoutStyles } }] };
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.stack || error}` }));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function encodeFrame(payload) {
  const body = Buffer.from(payload);
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
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
