import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { assert, readJson, validatePrivacyObject } from "./live-atlas-common.mjs";

const threadUrl = "https://chatgpt.com/g/g-p-test/project/mica/c/finalAcceptance_123?model=gpt-5";
const pageSessionId = "final-page-session";
const currentUserTurnId = safeTurnHint("user:user-turn-final");
const currentAssistantTurnId = safeTurnHint("assistant:assistant-turn-final");
const commands = [];
const pngBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(1024, 7)
]);

const server = http.createServer((request, response) => {
  if (request.url === "/json/list" || request.url === "/json/version") {
    response.writeHead(404);
    response.end("not found");
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
      if (frame.opcode !== 1) continue;
      const message = JSON.parse(frame.payload.toString("utf8"));
      commands.push({ method: message.method, sessionId: message.sessionId || null, params: message.params || {} });
      const result = resultFor(message);
      socket.write(encodeFrame(JSON.stringify({ id: message.id, result })));
      if (message.method === "Log.enable") scheduleFinalAcceptance(socket);
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const temp = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-final-acceptance-"));
const userDataDir = path.join(temp, "edge-user-data");
const raw = path.join(temp, "raw");
const sanitized = path.join(temp, "sanitized");
await mkdir(userDataDir, { recursive: true });
await writeFile(path.join(userDataDir, "DevToolsActivePort"), `${server.address().port}\n/devtools/browser/final\n`);

try {
  const result = await run("node", [
    "scripts/live-atlas-final-acceptance.mjs",
    `--thread-url=${threadUrl}`,
    `--user-data-dir=${userDataDir}`,
    "--session-id=final-acceptance-test",
    `--out=${raw}`,
    `--sanitized=${sanitized}`
  ]);
  assert(result.code === 0, "final acceptance command failed", result);
  assert(result.stdout.includes("REAL_EDGE_CDP_ATTACHED = YES") && result.stdout.includes("SAFE_TO_START_ATLAS = YES"), "final acceptance did not expose CDP ready handshake");
  assert(result.stdout.includes('"FINAL_LIVE_ACCEPTANCE": "PASS"'), "final acceptance did not print PASS");
  assert(commands.some((item) => item.method === "Target.getTargets"), "browser Target.getTargets was not used");
  assert(commands.some((item) => item.method === "Target.attachToTarget" && item.params.flatten === true), "flatten session attach was not used");
  assert(commands.some((item) => item.method === "DOMSnapshot.captureSnapshot" && item.sessionId === pageSessionId), "DOMSnapshot was not routed through the page session");
  assert(commands.some((item) => item.method === "Page.captureScreenshot" && item.sessionId === pageSessionId), "screenshot was not routed through the page session");
  assert(!commands.some((item) => /^Input\.|^Network\.|^Fetch\.|^Tracing\./.test(item.method) || item.method === "Page.navigate" || item.method === "Page.reload"), "forbidden CDP command was sent");

  const report = await readJson(path.join(sanitized, "final-acceptance-report.json"));
  const readiness = await readJson(path.join(sanitized, "release-readiness.json"));
  validatePrivacyObject(report, "final-acceptance-report");
  validatePrivacyObject(readiness, "release-readiness");
  assert(report.finalLiveAcceptance === "PASS", "report did not pass final live acceptance");
  assert(report.contractCompare.passed === true, "contract comparison failed");
  assert(report.featureEvidence.historicalFeatureMatrixPreserved === true, "historical feature matrix preservation was not recorded");
  assert(report.featureEvidence.micaMarkdownCopy.liveFeatureInvocation === true, "Mica Copy live invocation was not classified");
  assert(readiness.releaseDecision === "PASS", "release readiness did not pass");
  console.log(JSON.stringify({
    passed: true,
    finalAcceptanceHarness: true,
    contractCompare: report.contractCompare.passed,
    featureEvidenceModel: report.featureEvidence.historicalFeatureMatrixPreserved,
    releaseReadiness: readiness.releaseDecision,
    maxConcurrentHeavyCapture: report.atlasOverhead.maxConcurrentHeavyCapture,
    heavyCaptureCount: report.atlasOverhead.heavyCaptureCount,
    heavyCapturePer10sPeak: report.atlasOverhead.heavyCapturePer10sPeak,
    automatedSend: false,
    automatedEnter: false,
    automatedUpload: false,
    automatedConnectorAction: false
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

function scheduleFinalAcceptance(socket) {
  const events = recorderTimeline();
  const report = {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas",
    session: { id: "final-acceptance-test" },
    privacy: privacyFlags(),
    safety: { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false },
    coverage: {},
    counters: { checkpoints: events.length, optimizedTurns: 0 },
    performance: {
      eventTiming: [{ startTime: 100, processingStart: 100.4, processingEnd: 101.6, duration: 2.2 }],
      longAnimationFrame: [],
      longTask: [],
      layoutShift: [],
      memory: { category: "available" }
    },
    timeline: events
  };
  const checkpoints = [
    ["atlas_started", "fa:composer", { x: 40, y: 700, width: 820, height: 88 }],
    ["mica_overlay_state", "fa:overlay", { x: 812, y: 735, width: 72, height: 48 }],
    ["mention_chooser_visible", "fa:mention", { x: 120, y: 584, width: 260, height: 120 }],
    ["connector_pill_visible", "fa:pill", { x: 140, y: 710, width: 110, height: 28 }],
    ["manual_send_intent", "fa:send", null, { generationId: 1 }],
    ["mounted_turn_window_changed", "fa:window", { x: 20, y: 40, width: 860, height: 640 }, { generationId: 1 }],
    ["user_turn_mounted", "fa:user", { x: 80, y: 300, width: 760, height: 70 }, { generationId: 1, turnId: currentUserTurnId, role: "user" }],
    ["assistant_turn_mounted", "fa:assistant-mounted", { x: 80, y: 400, width: 760, height: 220 }, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant" }],
    ["assistant_first_content_mutation", "fa:assistant-first", { x: 80, y: 400, width: 760, height: 220 }, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant" }],
    ["assistant_settled", "fa:assistant-settled", { x: 80, y: 400, width: 760, height: 220 }, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant" }],
    ["rich_markdown_settled", "fa:rich", { x: 80, y: 400, width: 760, height: 220 }, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant" }],
    ["assistant_action_bar_visible", "fa:action", { x: 600, y: 590, width: 180, height: 40 }, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant", surfaceRole: "toolbar" }],
    ["mica_copy_invoked", "fa:mica-copy", { x: 650, y: 588, width: 120, height: 42 }, { generationId: 1, turnId: currentAssistantTurnId }]
  ];
  checkpoints.forEach(([stateClass, checkpointId, targetRect, extra], index) => {
    setTimeout(() => writeCheckpoint(socket, stateClass, checkpointId, targetRect, { monotonicTimestamp: 1000 + index * 6000, ...(extra || {}) }), 2 + index * 2);
  });
  setTimeout(() => writeReportChunk(socket, report), 34);
  setTimeout(() => writeCheckpoint(socket, "atlas_stopped", "fa:stop", null, { terminal: true }), 38);
}

function recorderTimeline() {
  const item = (stateClass, relativeTimeMs, details = {}) => ({
    schemaVersion: 1,
    type: stateClass === "assistant_stream_mutation_burst" ? "assistant_stream_mutation_burst" : "checkpoint",
    relativeTimeMs,
    details: { stateClass, ...details }
  });
  return [
    item("atlas_started", 1, { rect: { x: 40, y: 700, width: 820, height: 88 } }),
    item("mica_overlay_state", 2, { rect: { x: 812, y: 735, width: 72, height: 48 } }),
    item("mention_chooser_visible", 10, { rect: { x: 120, y: 584, width: 260, height: 120 } }),
    item("connector_pill_visible", 20, { rect: { x: 140, y: 710, width: 110, height: 28 } }),
    item("manual_send_intent", 100, { generationId: 1 }),
    item("mounted_turn_window_changed", 140, { generationId: 1, rect: { x: 20, y: 40, width: 860, height: 640 } }),
    item("user_turn_mounted", 150, { generationId: 1, turnId: currentUserTurnId, role: "user", rect: { x: 80, y: 300, width: 760, height: 70 } }),
    item("assistant_turn_mounted", 220, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant", rect: { x: 80, y: 400, width: 760, height: 220 } }),
    item("assistant_stream_mutation_burst", 260, { generationId: 1, mutationCount: 3 }),
    item("assistant_first_content_mutation", 280, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant", rect: { x: 80, y: 400, width: 760, height: 220 } }),
    item("assistant_settled", 1200, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant", rect: { x: 80, y: 400, width: 760, height: 220 } }),
    item("rich_markdown_settled", 1220, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant", rect: { x: 80, y: 400, width: 760, height: 220 } }),
    item("assistant_action_bar_visible", 1260, { generationId: 1, turnId: currentAssistantTurnId, role: "assistant", surfaceRole: "toolbar", rect: { x: 600, y: 590, width: 180, height: 40 } }),
    item("mica_copy_invoked", 1300, { generationId: 1, turnId: currentAssistantTurnId, rect: { x: 650, y: 588, width: 120, height: 42 } })
  ];
}

function writeReportChunk(socket, report) {
  const payload = JSON.stringify(report);
  socket.write(encodeFrame(JSON.stringify({
    sessionId: pageSessionId,
    method: "Runtime.consoleAPICalled",
    params: {
      args: [{ value: `MICA_ATLAS_REPORT_CHUNK ${JSON.stringify({ schemaVersion: 1, sessionId: "final-acceptance-test", index: 0, total: 1, data: payload })}` }]
    }
  })));
}

function writeCheckpoint(socket, stateClass, checkpointId, targetRect, extra = {}) {
  socket.write(encodeFrame(JSON.stringify({
    sessionId: pageSessionId,
    method: "Runtime.consoleAPICalled",
    params: {
      args: [{ value: `MICA_ATLAS_CHECKPOINT ${JSON.stringify({ checkpointId, stateClass, monotonicTimestamp: extra.monotonicTimestamp ?? Date.now(), targetRect, ...extra })}` }]
    }
  })));
}

function resultFor(message) {
  if (message.method === "Target.getTargets") {
    return {
      targetInfos: [
        { type: "page", targetId: "old-page", url: "https://chatgpt.com/c/oldFinalAcceptance_123", title: "old" },
        { type: "page", targetId: "final-page", url: threadUrl, title: "final" }
      ]
    };
  }
  if (message.method === "Target.attachToTarget") {
    assert(message.params?.targetId === "final-page" && message.params?.flatten === true, "wrong Target.attachToTarget params");
    return { sessionId: pageSessionId };
  }
  if (!["Runtime.enable", "Log.enable", "Performance.getMetrics", "Page.getLayoutMetrics", "DOMSnapshot.captureSnapshot", "Page.captureScreenshot"].includes(message.method)) return {};
  assert(message.sessionId === pageSessionId, `${message.method} was not routed to page session`);
  if (message.method === "Page.getLayoutMetrics") {
    return {
      cssVisualViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 0, zoom: 1 },
      cssLayoutViewport: { clientWidth: 900, clientHeight: 820, pageX: 0, pageY: 0 },
      cssContentSize: { x: 0, y: 0, width: 900, height: 1200 }
    };
  }
  if (message.method === "DOMSnapshot.captureSnapshot") return fakeSnapshot(message.params?.computedStyles || []);
  if (message.method === "Page.captureScreenshot") {
    assert(message.params?.captureBeyondViewport === true && message.params?.clip?.width > 1 && message.params?.clip?.height > 1, "invalid screenshot clip");
    return { data: pngBytes.toString("base64") };
  }
  if (message.method === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
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
      layoutStyles.push(styles.map((style) => intern(style === "position" ? "relative" : style === "display" ? "block" : "")));
    }
    return index;
  };
  const html = addNode("HTML", -1);
  const body = addNode("BODY", html);
  const main = addNode("MAIN", body, { role: "main", "data-testid": "conversation-window" }, { x: 20, y: 40, width: 860, height: 640 });
  const form = addNode("FORM", body, { "data-composer-surface": "true", "data-testid": "composer" }, { x: 40, y: 700, width: 820, height: 88 });
  addNode("TEXTAREA", form, { contenteditable: "true" }, { x: 56, y: 716, width: 760, height: 48 });
  addNode("MICA-OVERLAY", body, { "data-mica-root": "true" }, { x: 812, y: 735, width: 72, height: 48 });
  addNode("DIV", body, { role: "menu", "data-testid": "composer-intelligence-picker" }, { x: 120, y: 584, width: 260, height: 120 });
  addNode("SPAN", form, { "data-inline-selection-pill": "true", "data-id": "plugin:github" }, { x: 140, y: 710, width: 110, height: 28 });
  addNode("DIV", main, { "data-message-author-role": "user", "data-testid": "user-turn-final" }, { x: 80, y: 300, width: 760, height: 70 });
  const assistant = addNode("DIV", main, { "data-message-author-role": "assistant", "data-testid": "assistant-turn-final" }, { x: 80, y: 400, width: 760, height: 220 });
  addNode("H2", assistant, {}, null);
  addNode("P", assistant, {}, null);
  addNode("UL", assistant, {}, null);
  addNode("BLOCKQUOTE", assistant, {}, null);
  addNode("PRE", assistant, {}, null);
  addNode("SPAN", assistant, { role: "math" }, null);
  addNode("DIV", assistant, { role: "toolbar", "data-testid": "assistant-action-bar" }, { x: 600, y: 590, width: 180, height: 40 });
  addNode("BUTTON", assistant, { "data-testid": "mica-copy", "aria-label": "Copy" }, { x: 650, y: 588, width: 120, height: 42 });
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
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
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

function safeTurnHint(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `turn:${(hash >>> 0).toString(36)}`;
}

function privacyFlags() {
  return {
    localOnly: true,
    telemetryUploaded: false,
    promptTextIncluded: false,
    answerTextIncluded: false,
    rawDomIncluded: false,
    fullPageScreenshotIncluded: false,
    headersIncluded: false,
    cookiesIncluded: false,
    requestBodiesIncluded: false
  };
}
