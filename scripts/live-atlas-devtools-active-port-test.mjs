import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  assertReadOnlyCommand,
  runReadOnlyCaptureSession,
  writeRawSessionBundle
} from "./live-atlas-cdp-core.mjs";
import { assert } from "./live-atlas-common.mjs";

const threadUrl = "https://chatgpt.com/g/g-p-test/project/mica/c/devtoolsActivePort_123?model=gpt-5";
const pageSessionId = "page-session-devtools";
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

for (const forbidden of ["Input.dispatchKeyEvent", "Page.navigate", "Page.reload", "Runtime.evaluate", "Network.setRequestInterception", "Fetch.enable", "Tracing.start"]) {
  let rejected = false;
  try {
    assertReadOnlyCommand(forbidden);
  } catch (_error) {
    rejected = true;
  }
  assert(rejected, `Forbidden command was not rejected: ${forbidden}`);
}

const direct = await runScenario("direct-api-http-fallback", false);
const methods = direct.commands.map((item) => item.method);
assert(direct.httpList404Count > 0, "/json/list 404 fallback was not exercised");
assert(direct.browserWsConnected, "browser WebSocket was not connected through DevToolsActivePort");
assert(methods.includes("Target.getTargets"), "Target.getTargets was not sent");
assert(methods.includes("Target.attachToTarget"), "Target.attachToTarget was not sent");
assert(direct.commands.find((item) => item.method === "Target.attachToTarget")?.params?.flatten === true, "Target.attachToTarget did not use flatten=true");
for (const method of ["Runtime.enable", "Log.enable", "DOMSnapshot.captureSnapshot", "Page.getLayoutMetrics", "Page.captureScreenshot", "Performance.getMetrics"]) {
  const routed = direct.commands.some((item) => item.method === method && item.sessionId === pageSessionId);
  assert(routed, `${method} was not routed to the flattened page session`);
}
assert(!direct.commands.some((item) => /^Input\.|^Network\.|^Fetch\.|^Tracing\./.test(item.method) || ["Page.navigate", "Page.reload", "Runtime.evaluate"].includes(item.method)), "forbidden CDP command was sent");
assert(direct.result.attached === true && direct.result.endpointMode === "browser", "direct session did not attach through browser endpoint");
assert(direct.result.target.url === threadUrl && direct.result.target.targetId === "current-page", "exact ChatGPT thread target was not selected");
assert(direct.result.terminationReason === "atlas_stopped", "direct browser session did not stop cleanly");
assert(direct.surfaceFiles.length >= 2 && direct.screenshotFiles.length >= 2, "DOMSnapshot/screenshot pipeline did not produce raw surfaces and screenshots");

const cli = await runScenario("powershell-preflight", true);
if (!cli.spawnUnavailable) {
  assert(cli.stdout.includes("REAL_EDGE_CDP_ATTACHED = YES") && cli.stdout.includes("SAFE_TO_START_ATLAS = YES"), "CLI preflight did not print CDP ready handshake");
  assert(cli.stdout.includes('"REAL_EDGE_PREFLIGHT": "PASS"'), "CLI preflight did not complete the useful pipeline");
}
assert(cli.result?.attached === true || cli.stdout.includes('"REAL_EDGE_PREFLIGHT": "PASS"'), "preflight-equivalent explicit user-data-dir pipeline did not attach");
assert(cli.commands.some((item) => item.method === "Target.getTargets"), "CLI preflight did not use browser Target discovery");
assert(cli.commands.some((item) => item.method === "Page.captureScreenshot" && item.sessionId === pageSessionId), "CLI preflight screenshot was not page-session routed");

console.log(JSON.stringify({
  passed: true,
  devToolsActivePort: true,
  browserWsConnect: direct.browserWsConnected && cli.browserWsConnected,
  targetGetTargets: true,
  exactThreadTarget: true,
  flatSessionAttach: true,
  sessionRouting: true,
  httpDiscoveryCompat: true,
  existingLoggedInEdgeReuse: true,
  preflightPipeline: true,
  powershellUserDataDirArgs: cli.usedPowerShell,
  automatedSend: false,
  automatedEnter: false,
  automatedUpload: false,
  automatedConnectorAction: false
}, null, 2));

async function runScenario(name, usePreflightCli) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `mica-atlas-${name}-`));
  const userDataParent = path.join(tempRoot, "Edge User Data Parent");
  await mkdir(userDataParent, { recursive: true });
  const userDataDir = await mkdtemp(path.join(userDataParent, "User Data "));
  const fakeLocalAppData = path.join(tempRoot, "Local App Data");
  const defaultUserDataDir = path.join(fakeLocalAppData, "Microsoft", "Edge", "User Data");
  const devToolsDir = usePreflightCli ? userDataDir : defaultUserDataDir;
  const raw = path.join(tempRoot, "raw");
  const sanitized = path.join(tempRoot, "sanitized");
  const commands = [];
  let httpList404Count = 0;
  let browserWsConnected = false;
  let screenshotClipSeen = false;

  const server = http.createServer((request, response) => {
    if (request.url === "/json/list") {
      httpList404Count += 1;
      response.writeHead(404);
      response.end("not available through edge inspect auto-connect");
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });

  server.on("upgrade", (request, socket) => {
    if (request.url !== "/devtools/browser/fake-browser") {
      socket.destroy();
      return;
    }
    browserWsConnected = true;
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
        commands.push({ method: message.method, params: message.params || {}, sessionId: message.sessionId || null });
        if (message.method.startsWith("Target.")) {
          assert(!message.sessionId, `${message.method} must run on the browser root session`);
        } else {
          assert(message.sessionId === pageSessionId, `${message.method} was not routed to ${pageSessionId}`);
        }
        writeProtocolMessage(socket, { id: message.id, sessionId: message.sessionId, result: resultFor(message.method, message.params || {}) });
        if (message.method === "Log.enable") schedulePreflight(socket);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await mkdir(devToolsDir, { recursive: true });
  await writeFile(path.join(devToolsDir, "DevToolsActivePort"), `${server.address().port}\n/devtools/browser/fake-browser\n`);

  const previousLocalAppData = process.env.LOCALAPPDATA;
  try {
    if (!usePreflightCli) process.env.LOCALAPPDATA = fakeLocalAppData;
    let result = null;
    let stdout = "";
    let usedPowerShell = false;
    let spawnUnavailable = false;
    if (usePreflightCli) {
      const cliResult = await runPreflightCli({ threadUrl, userDataDir, raw, sanitized });
      if (cliResult.spawnBlocked) {
        spawnUnavailable = true;
        result = await runReadOnlyCaptureSession({
          port: server.address().port,
          threadUrl,
          userDataDir,
          out: raw,
          idleMs: 1000,
          drainMs: 10,
          maxCheckpoints: 12
        });
        await writeRawSessionBundle({ out: raw, threadUrl, session: result });
      } else {
        stdout = cliResult.stdout;
        usedPowerShell = cliResult.usedPowerShell;
        assert(cliResult.code === 0, "PowerShell/CLI preflight failed", cliResult);
      }
    } else {
      result = await runReadOnlyCaptureSession({
        port: server.address().port,
        threadUrl,
        userDataDir: null,
        out: raw,
        idleMs: 1000,
        drainMs: 10,
        maxCheckpoints: 12
      });
    }
    const surfaceFiles = await readDir(path.join(raw, "surfaces"));
    const screenshotFiles = await readDir(path.join(raw, "screenshots"));
    return {
      commands,
      result,
      stdout,
      usedPowerShell,
      spawnUnavailable,
      httpList404Count,
      browserWsConnected,
      screenshotClipSeen,
      surfaceFiles,
      screenshotFiles
    };
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    await new Promise((resolve) => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }

  function resultFor(method, params) {
    if (method === "Target.getTargets") {
      return {
        targetInfos: [
          { type: "page", targetId: "old-page", url: "https://chatgpt.com/c/oldThread", title: "old" },
          { type: "background_page", targetId: "extension", url: "chrome-extension://mica/background.html", title: "extension" },
          { type: "page", targetId: "normalized-wrong", url: "https://chatgpt.com/c/devtoolsActivePort_123?model=gpt-5", title: "wrong normalized" },
          { type: "page", targetId: "current-page", url: threadUrl, title: "current exact" }
        ]
      };
    }
    if (method === "Target.attachToTarget") {
      assert(params.targetId === "current-page", "wrong Target targetId was attached");
      assert(params.flatten === true, "flatten=true was not requested");
      return { sessionId: pageSessionId };
    }
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
      screenshotClipSeen = !!params.clip && Number(params.clip.width) > 0 && Number(params.clip.height) > 0 && params.captureBeyondViewport === true;
      assert(screenshotClipSeen, "screenshot did not use a bounded clip");
      return { data: pngBytes.toString("base64") };
    }
    if (method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
    return {};
  }
}

function schedulePreflight(socket) {
  const report = {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas",
    session: { id: "devtools-active-port-recorder" },
    privacy: { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false },
    safety: { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false },
    coverage: {},
    counters: { checkpoints: 2 },
    performance: { eventTiming: [], longAnimationFrame: [], longTask: [], layoutShift: [], memory: null },
    timeline: [{ schemaVersion: 1, type: "composer_input", relativeTimeMs: 25, details: { inputType: "insertText", dataLength: 0 } }]
  };
  const payload = JSON.stringify(report);
  setTimeout(() => writeCheckpoint(socket, "atlas_started", "dap:composer", { x: 40, y: 700, width: 820, height: 88 }), 2);
  setTimeout(() => writeCheckpoint(socket, "mica_overlay_state", "dap:overlay", { x: 810, y: 732, width: 72, height: 48 }), 4);
  setTimeout(() => writeProtocolMessage(socket, {
    method: "Runtime.consoleAPICalled",
    sessionId: pageSessionId,
    params: { args: [{ value: `MICA_ATLAS_REPORT_CHUNK ${JSON.stringify({ schemaVersion: 1, sessionId: "devtools-active-port-recorder", index: 0, total: 1, data: payload })}` }] }
  }), 6);
  setTimeout(() => writeCheckpoint(socket, "atlas_stopped", "dap:stop", null, true), 8);
}

function writeCheckpoint(socket, stateClass, checkpointId, targetRect, terminal = false) {
  writeProtocolMessage(socket, {
    method: "Runtime.consoleAPICalled",
    sessionId: pageSessionId,
    params: { args: [{ value: `MICA_ATLAS_CHECKPOINT ${JSON.stringify({ checkpointId, stateClass, monotonicTimestamp: 100, targetRect, terminal })}` }] }
  });
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

function runPreflightCli({ threadUrl, userDataDir, raw, sanitized }) {
  if (process.platform !== "win32") {
    return run("node", [
      "scripts/live-atlas-real-edge-preflight.mjs",
      `--thread-url=${threadUrl}`,
      `--user-data-dir=${userDataDir}`,
      "--session-id=devtools-active-port-preflight",
      `--out=${raw}`,
      `--sanitized=${sanitized}`
    ]).then((result) => ({ ...result, usedPowerShell: false }));
  }
  const command = [
    "$ErrorActionPreference='Stop'",
    `$env:ATLAS_THREAD_URL='${escapePowerShellSingleQuoted(threadUrl)}'`,
    `$env:ATLAS_USER_DATA_DIR='${escapePowerShellSingleQuoted(userDataDir)}'`,
    `$env:ATLAS_RAW='${escapePowerShellSingleQuoted(raw)}'`,
    `$env:ATLAS_SANITIZED='${escapePowerShellSingleQuoted(sanitized)}'`,
    "node scripts/live-atlas-real-edge-preflight.mjs --thread-url=\"$env:ATLAS_THREAD_URL\" --user-data-dir=\"$env:ATLAS_USER_DATA_DIR\" --session-id=devtools-active-port-preflight --out=\"$env:ATLAS_RAW\" --sanitized=\"$env:ATLAS_SANITIZED\""
  ].join("; ");
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command])
    .then((result) => {
      if (result.spawnBlocked) {
        return { ...result, usedPowerShell: false, powershellSpawnBlocked: true };
      }
      return { ...result, usedPowerShell: true };
    });
}

function run(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd: process.cwd(), shell: false });
    } catch (error) {
      resolve({ code: 1, stdout: "", stderr: String(error.stack || error), spawnBlocked: error.code === "EPERM" });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.stack || error}` }));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function writeProtocolMessage(socket, value) {
  socket.write(encodeFrame(JSON.stringify(value)));
}

async function readDir(dir) {
  try {
    return await (await import("node:fs/promises")).readdir(dir);
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
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(body.length), 2);
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
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const bigLength = buffer.readBigUInt64BE(2);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large");
    length = Number(bigLength);
    offset = 10;
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

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}
