import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  assertReadOnlyCommand,
  runReadOnlyCaptureSession
} from "./live-atlas-cdp-core.mjs";
import { assert } from "./live-atlas-common.mjs";

const threadUrl = "https://chatgpt.com/c/atlasFakeThread_123";
const commands = [];
let screenshotClipSeen = false;
let socketAttached = false;

const server = http.createServer((request, response) => {
  if (request.url === "/json/list") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([
      { type: "page", url: "https://chatgpt.com/", title: "wrong", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/wrong` },
      { type: "page", url: threadUrl, title: "Dedicated Atlas", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/right` }
    ]));
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

server.on("upgrade", (request, socket) => {
  socketAttached = true;
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
      const message = JSON.parse(frame.payload.toString("utf8"));
      commands.push({ method: message.method, params: message.params || {} });
      socket.write(encodeFrame(JSON.stringify({ id: message.id, result: resultFor(message.method, message.params || {}) })));
      if (message.method === "Log.enable") {
        socket.write(encodeFrame(JSON.stringify({
          method: "Runtime.consoleAPICalled",
          params: { args: [{ value: "MICA_ATLAS_CHECKPOINT {\"checkpointId\":\"fake:1\",\"stateClass\":\"composer_present\",\"monotonicTimestamp\":120}" }] }
        })));
      }
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const out = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-cdp-"));

try {
  for (const forbidden of ["Input.dispatchKeyEvent", "Page.navigate", "Page.reload", "Runtime.evaluate", "Network.setRequestInterception", "Fetch.enable", "Tracing.start"]) {
    let rejected = false;
    try {
      assertReadOnlyCommand(forbidden);
    } catch (_error) {
      rejected = true;
    }
    assert(rejected, `Forbidden command was not rejected: ${forbidden}`);
  }
  const result = await runReadOnlyCaptureSession({ port: server.address().port, threadUrl, out, idleMs: 180, maxCheckpoints: 1 });
  const methods = commands.map((item) => item.method);
  assert(socketAttached, "fake WebSocket was not attached");
  assert(result.attached === true, "capture session did not report attached");
  for (const method of ["Runtime.enable", "Log.enable", "DOMSnapshot.captureSnapshot", "Page.getLayoutMetrics", "Page.captureScreenshot", "Performance.getMetrics"]) {
    assert(methods.includes(method), `${method} was not sent`);
  }
  assert(!methods.some((method) => /^Input\.|^Network\.|^Fetch\.|^Tracing\./.test(method) || ["Page.navigate", "Page.reload", "Runtime.evaluate"].includes(method)), "forbidden CDP command was sent");
  assert(screenshotClipSeen, "Page.captureScreenshot was not clipped");
  const surfaceFiles = await readDir(path.join(out, "surfaces"));
  const screenshotFiles = await readDir(path.join(out, "screenshots"));
  assert(surfaceFiles.length > 0, "no surface contract was written");
  assert(screenshotFiles.length > 0, "no cropped screenshot was written");
  console.log(JSON.stringify({ passed: true, attached: result.attached, commands: methods, surfaces: surfaceFiles.length, screenshots: screenshotFiles.length, automatedSend: false, automatedUpload: false, automatedConnectorAction: false }, null, 2));
  process.exitCode = 0;
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(out, { recursive: true, force: true });
}

function resultFor(method, params) {
  if (method === "Page.getLayoutMetrics") return { visualViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 0 }, layoutViewport: { clientWidth: 900, clientHeight: 820 } };
  if (method === "DOMSnapshot.captureSnapshot") return fakeSnapshot(params.computedStyles || []);
  if (method === "Page.captureScreenshot") {
    screenshotClipSeen = !!params.clip && Number(params.clip.width) > 0 && Number(params.clip.height) > 0 && params.captureBeyondViewport !== true;
    return { data: Buffer.from("fakepng").toString("base64") };
  }
  if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
  return {};
}

function fakeSnapshot(styles) {
  const strings = ["HTML", "BODY", "FORM", "DIV", "#text", "data-composer-surface", "true", "role", "textbox", "PRIVATE_SHOULD_NOT_SURVIVE", "display", "grid", "border-radius", "28px"];
  return {
    documents: [{
      strings,
      nodes: {
        nodeName: [0, 1, 2, 3, 4],
        nodeValue: ["", "", "", "", 9],
        parentIndex: [-1, 0, 1, 2, 3],
        attributes: [[], [], [5, 6], [7, 8], []]
      },
      layout: {
        nodeIndex: [2, 3],
        bounds: [[44, 700, 812, 80], [72, 715, 700, 36]],
        styles: [[styles.indexOf("display") >= 0 ? 11 : "", styles.indexOf("border-radius") >= 0 ? 13 : ""], []]
      }
    }]
  };
}

async function readDir(dir) {
  try {
    return (await import("node:fs/promises")).readdir(dir);
  } catch (_error) {
    return [];
  }
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
