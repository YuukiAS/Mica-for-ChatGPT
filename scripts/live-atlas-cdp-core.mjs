import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";

export const READ_ONLY_CDP_COMMANDS = new Set([
  "Runtime.enable",
  "Log.enable",
  "DOMSnapshot.captureSnapshot",
  "Page.getLayoutMetrics",
  "Page.captureScreenshot",
  "Performance.getMetrics"
]);

export const FORBIDDEN_CDP_PREFIXES = ["Input.", "Network.", "Tracing.", "Fetch."];
export const FORBIDDEN_CDP_COMMANDS = new Set([
  "Page.navigate",
  "Page.reload",
  "Runtime.evaluate",
  "Network.enable",
  "Network.setRequestInterception",
  "Fetch.enable",
  "Tracing.start"
]);

export const STYLE_WHITELIST = [
  "display",
  "position",
  "border-radius",
  "box-shadow",
  "background-color",
  "color",
  "font-size",
  "line-height",
  "opacity",
  "transform"
];

export const CHECKPOINT_PREFIX = "MICA_ATLAS_CHECKPOINT ";

export function assertReadOnlyCommand(command) {
  if (FORBIDDEN_CDP_COMMANDS.has(command) || FORBIDDEN_CDP_PREFIXES.some((prefix) => command.startsWith(prefix))) {
    throw new Error(`Forbidden CDP command: ${command}`);
  }
  if (!READ_ONLY_CDP_COMMANDS.has(command)) throw new Error(`CDP command is not allowlisted: ${command}`);
}

export async function resolveExactTarget({ port, threadUrl, fetchImpl = fetch }) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, fetchImpl);
  const matches = targets.filter((target) => target.type === "page" && target.url === threadUrl);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one dedicated ChatGPT capture tab for ${threadUrl}; found ${matches.length}`);
  }
  const target = matches[0];
  if (!target.webSocketDebuggerUrl) throw new Error("Resolved target does not expose webSocketDebuggerUrl");
  return target;
}

export async function runReadOnlyCaptureSession(options) {
  const {
    port,
    threadUrl,
    out,
    maxCheckpoints = 24,
    idleMs = 5000,
    fetchImpl = fetch,
    connect = connectWebSocket
  } = options;
  const target = await resolveExactTarget({ port, threadUrl, fetchImpl });
  const client = await connect(target.webSocketDebuggerUrl);
  const timeline = [];
  const surfaces = new Map();
  const screenshotsDir = path.join(out, "screenshots");
  const surfacesDir = path.join(out, "surfaces");
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(surfacesDir, { recursive: true });

  let attached = false;
  let checkpointCount = 0;
  let stopped = false;
  let idleTimer = null;
  let finishIdle = null;

  const stopAfterIdle = () => new Promise((resolve) => {
    finishIdle = resolve;
    idleTimer = setTimeout(resolve, idleMs);
  });

  client.onMessage(async (message) => {
    if (stopped) return;
    const checkpoint = parseCheckpointMessage(message);
    if (!checkpoint) return;
    checkpointCount += 1;
    const captured = await captureCheckpoint(client, checkpoint, { screenshotsDir, surfacesDir });
    timeline.push({
      schemaVersion: 1,
      type: "cdp_checkpoint_capture",
      relativeTimeMs: checkpoint.monotonicTimestamp ?? null,
      details: {
        checkpointId: checkpoint.checkpointId,
        stateClass: checkpoint.stateClass,
        surfaceKey: captured.surfaceKey,
        screenshot: captured.screenshotFile ? path.basename(captured.screenshotFile) : null,
        clipped: true
      }
    });
    surfaces.set(captured.surfaceKey, captured.surfaceFile);
    if (checkpointCount >= maxCheckpoints) {
      stopped = true;
      if (idleTimer) clearTimeout(idleTimer);
      await client.close();
      if (finishIdle) finishIdle();
    }
  });

  await client.send("Runtime.enable");
  await client.send("Log.enable");
  attached = true;
  await client.send("Performance.getMetrics");
  await stopAfterIdle();
  stopped = true;
  await client.close();
  return { attached, target, timeline, surfaces: [...surfaces.keys()], checkpointCount, commandsSent: client.commandsSent };
}

export async function captureCheckpoint(client, checkpoint, paths) {
  const surfaceKey = surfaceKeyForCheckpoint(checkpoint.stateClass);
  const layout = await client.send("Page.getLayoutMetrics");
  const snapshot = await client.send("DOMSnapshot.captureSnapshot", { computedStyles: STYLE_WHITELIST });
  const metrics = await client.send("Performance.getMetrics");
  const rect = rectForSurface(snapshot, surfaceKey) || fallbackClip(layout);
  const clip = sanitizeClip(rect, layout);
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", clip, fromSurface: true });
  const surface = {
    schemaVersion: 1,
    name: surfaceKey,
    status: "OBSERVED",
    source: "real-cdp-companion",
    checkpointId: checkpoint.checkpointId,
    stateClass: checkpoint.stateClass,
    privacy: privacyFlags(),
    contract: contractForSurface(snapshot, surfaceKey, clip),
    performanceMetricCount: Array.isArray(metrics?.metrics) ? metrics.metrics.length : 0
  };
  const surfaceFile = path.join(paths.surfacesDir, `${surfaceKey}-${safeFilePart(checkpoint.checkpointId)}.json`);
  const screenshotFile = path.join(paths.screenshotsDir, `${surfaceKey}-${safeFilePart(checkpoint.checkpointId)}.png`);
  await writeJson(surfaceFile, surface);
  await writeFile(screenshotFile, Buffer.from(String(screenshot?.data || ""), "base64"));
  return { surfaceKey, surfaceFile, screenshotFile, clip };
}

export function parseCheckpointMessage(message) {
  const text = message?.params?.entry?.text
    || message?.params?.args?.map((arg) => arg.value).join(" ")
    || message?.params?.message?.text
    || "";
  if (!String(text).startsWith(CHECKPOINT_PREFIX)) return null;
  try {
    return JSON.parse(String(text).slice(CHECKPOINT_PREFIX.length));
  } catch (_error) {
    return null;
  }
}

export function surfaceKeyForCheckpoint(stateClass) {
  if (/^composer_|manual_send|atlas_started/.test(stateClass)) return "composer";
  if (/^mention_/.test(stateClass)) return "mentionChooser";
  if (/^connector_/.test(stateClass)) return "connectorPill";
  if (/assistant_action_bar|copy/.test(stateClass)) return "assistantActionBar";
  if (/assistant_|user_turn/.test(stateClass)) return "assistantStreaming";
  if (/mica_overlay/.test(stateClass)) return "micaOverlay";
  if (/mounted_turn/.test(stateClass)) return "longThreadMountedWindow";
  return "composer";
}

export function rectForSurface(snapshot, surfaceKey) {
  const doc = snapshot?.documents?.[0];
  const layout = doc?.layout;
  const nodes = doc?.nodes;
  if (!layout || !nodes) return null;
  const layoutNodeIndexes = layout.nodeIndex || [];
  const bounds = layout.bounds || [];
  for (let index = 0; index < layoutNodeIndexes.length; index += 1) {
    const nodeIndex = layoutNodeIndexes[index];
    if (nodeMatchesSurface(doc, nodeIndex, surfaceKey)) {
      const rect = bounds[index];
      if (Array.isArray(rect) && rect.length >= 4) return { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
    }
  }
  return null;
}

export function contractForSurface(snapshot, surfaceKey, clip) {
  const doc = snapshot?.documents?.[0];
  if (!doc) return observedContract(surfaceKey, clip);
  const nodeIndex = findSurfaceNodeIndex(doc, surfaceKey);
  if (nodeIndex === null) return observedContract(surfaceKey, clip);
  return sanitizeNodeContract(doc, nodeIndex, clip, 0);
}

export function sanitizeNodeContract(doc, nodeIndex, clip, depth) {
  const nodes = doc.nodes || {};
  const strings = doc.strings || [];
  const tag = stringAt(strings, nodes.nodeName?.[nodeIndex] || "").toLowerCase() || "div";
  const attrs = sanitizedAttributes(doc, nodeIndex);
  const role = attrs.role || null;
  const children = depth >= 3 ? [] : childIndexesOf(doc, nodeIndex).slice(0, 12).map((child) => sanitizeNodeContract(doc, child, null, depth + 1));
  return {
    tag: normalizeTag(tag),
    role,
    attrs,
    rect: depth === 0 ? clipToRect(clip) : null,
    state: controlState(attrs),
    text: textContract(doc, nodeIndex),
    styles: sanitizedStyles(doc, nodeIndex),
    children
  };
}

export function createManifest({ threadUrl, target, commandsSent }) {
  return {
    schemaVersion: 1,
    kind: "mica.liveSurfaceAtlas.raw",
    sessionId: `atlas-cdp-${Date.now()}`,
    createdAt: new Date().toISOString(),
    source: "real-cdp-companion",
    threadUrlAllowed: /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9_-]+/.test(threadUrl),
    targetTitleLength: String(target?.title || "").length,
    styleWhitelist: STYLE_WHITELIST,
    readOnlyCommands: [...READ_ONLY_CDP_COMMANDS],
    commandsSent,
    privacy: privacyFlags(),
    safety: safetyFlags()
  };
}

export function privacyFlags() {
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

export function safetyFlags() {
  return {
    automatedSend: false,
    automatedEnter: false,
    automatedUpload: false,
    automatedConnectorAction: false,
    playwrightRealSiteTraceUsed: false,
    computerUseRequired: false,
    cdpConnection: true
  };
}

export async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Failed to query CDP endpoint ${url}: ${response.status}`);
  return response.json();
}

export async function connectWebSocket(url) {
  const socket = await openWebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  const commandsSent = [];
  socket.onFrame = (payload) => {
    const message = JSON.parse(payload);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || "CDP command failed"));
      else resolve(message.result || {});
      return;
    }
    for (const listener of listeners) listener(message);
  };
  return {
    commandsSent,
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(method, params = {}) {
      assertReadOnlyCommand(method);
      commandsSent.push(method);
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      return socket.close();
    }
  };
}

async function openWebSocket(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "ws:") throw new Error("Only ws:// CDP endpoints are supported");
  const key = randomBytes(16).toString("base64");
  const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port || 80) });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write([
    `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "\r\n"
  ].join("\r\n"));
  await readHandshake(socket, key);
  let buffer = Buffer.alloc(0);
  const wrapper = {
    onFrame: null,
    send(payload) {
      socket.write(encodeFrame(Buffer.from(payload)));
    },
    close() {
      socket.destroy();
      return Promise.resolve();
    }
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const decoded = decodeFrame(buffer);
      if (!decoded) break;
      buffer = decoded.rest;
      if (decoded.opcode === 1 && wrapper.onFrame) wrapper.onFrame(decoded.payload.toString("utf8"));
    }
  });
  return wrapper;
}

function readHandshake(socket, key) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("latin1");
      if (!data.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      if (!/^HTTP\/1\.1 101/m.test(data)) {
        reject(new Error(`WebSocket handshake failed: ${data.split(/\r?\n/)[0]}`));
        return;
      }
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      if (!data.toLowerCase().includes(`sec-websocket-accept: ${accept}`.toLowerCase())) {
        reject(new Error("WebSocket accept header mismatch"));
        return;
      }
      resolve();
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function encodeFrame(payload) {
  const header = [];
  header.push(0x81);
  const mask = randomBytes(4);
  if (payload.length < 126) header.push(0x80 | payload.length);
  else if (payload.length < 65536) header.push(0x80 | 126, payload.length >> 8, payload.length & 0xff);
  else throw new Error("CDP frame too large");
  const out = Buffer.concat([Buffer.from(header), mask, payload]);
  for (let index = 0; index < payload.length; index += 1) out[header.length + 4 + index] = payload[index] ^ mask[index % 4];
  return out;
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload, rest: buffer.subarray(offset + length) };
}

function nodeMatchesSurface(doc, nodeIndex, surfaceKey) {
  const attrs = sanitizedAttributes(doc, nodeIndex);
  const tag = stringAt(doc.strings || [], doc.nodes?.nodeName?.[nodeIndex] || "").toLowerCase();
  if (surfaceKey === "composer") return attrs["data-composer-surface"] === "true" || /composer/i.test(attrs["data-testid"] || "");
  if (surfaceKey === "mentionChooser") return attrs.role === "listbox" || /mention|composer-menu/i.test(attrs["data-testid"] || "");
  if (surfaceKey === "connectorPill") return attrs["data-inline-selection-pill"] !== undefined || /plugin:/.test(attrs["data-id"] || "");
  if (surfaceKey === "assistantActionBar") return attrs.role === "toolbar" || /action|copy/i.test(attrs["data-testid"] || attrs["aria-label"] || "");
  if (surfaceKey === "micaOverlay") return attrs["data-mica-root"] === "true" || tag === "mica-overlay";
  return attrs["data-message-author-role"] === "assistant" || /conversation-turn/i.test(attrs["data-testid"] || "");
}

function findSurfaceNodeIndex(doc, surfaceKey) {
  const nodes = doc.nodes || {};
  for (let index = 0; index < (nodes.nodeName?.length || 0); index += 1) {
    if (nodeMatchesSurface(doc, index, surfaceKey)) return index;
  }
  return null;
}

function sanitizedAttributes(doc, nodeIndex) {
  const attrs = {};
  const strings = doc.strings || [];
  const raw = doc.nodes?.attributes?.[nodeIndex] || [];
  const allow = new Set(["role", "aria-expanded", "aria-pressed", "disabled", "contenteditable", "data-composer-surface", "data-message-author-role", "data-mica-root", "data-inline-selection-pill", "data-symbol", "data-testid", "data-id", "aria-label"]);
  for (let index = 0; index < raw.length; index += 2) {
    const key = stringAt(strings, raw[index]);
    const value = stringAt(strings, raw[index + 1]);
    if (!allow.has(key)) continue;
    if (key === "aria-label" && !["Copy", "Stop", "Retry", "Continue", "Regenerate"].includes(value)) {
      attrs[key] = `label-length-${value.length}`;
    } else if (key === "data-id" && /^plugin:/.test(value)) {
      attrs[key] = "plugin:anonymous";
    } else if (/^(data-testid|data-symbol|data-message-author-role|role|contenteditable|aria-expanded|aria-pressed|disabled|data-composer-surface|data-mica-root|data-inline-selection-pill)$/.test(key)) {
      attrs[key] = stableAttr(value);
    }
  }
  return attrs;
}

function sanitizedStyles(doc, nodeIndex) {
  const styles = {};
  const strings = doc.strings || [];
  const layout = doc.layout || {};
  const layoutIndex = (layout.nodeIndex || []).indexOf(nodeIndex);
  const styleIndexes = layoutIndex >= 0 ? layout.styles?.[layoutIndex] || [] : [];
  for (let index = 0; index < Math.min(styleIndexes.length, STYLE_WHITELIST.length); index += 1) {
    const value = stringAt(strings, styleIndexes[index]);
    if (value && value.length <= 120 && !/url\(|https?:|file:|data:text/i.test(value)) styles[STYLE_WHITELIST[index]] = value;
  }
  return styles;
}

function textContract(doc, nodeIndex) {
  const children = childIndexesOf(doc, nodeIndex);
  let textLength = 0;
  for (const child of children) {
    const name = stringAt(doc.strings || [], doc.nodes?.nodeName?.[child] || "");
    if (name === "#text") {
      const value = stringAt(doc.strings || [], doc.nodes?.nodeValue?.[child] || "");
      textLength += value.length;
    }
  }
  return { category: textLength === 0 ? "empty" : textLength <= 24 ? "short" : textLength <= 240 ? "medium" : "long", length: textLength };
}

function childIndexesOf(doc, nodeIndex) {
  const parentIndex = doc.nodes?.parentIndex || [];
  const children = [];
  for (let index = 0; index < parentIndex.length; index += 1) {
    if (parentIndex[index] === nodeIndex) children.push(index);
  }
  return children;
}

function controlState(attrs) {
  return {
    disabled: attrs.disabled !== undefined,
    expanded: attrs["aria-expanded"] ?? null,
    pressed: attrs["aria-pressed"] ?? null,
    contenteditable: attrs.contenteditable ?? null
  };
}

function observedContract(surfaceKey, clip) {
  return {
    tag: surfaceKey === "composer" ? "form" : "div",
    role: surfaceKey === "assistantActionBar" ? "toolbar" : surfaceKey === "mentionChooser" ? "listbox" : null,
    attrs: {},
    rect: clipToRect(clip),
    state: {},
    text: { category: "redacted", length: 0 },
    styles: {},
    children: []
  };
}

function sanitizeClip(rect, layout) {
  const viewport = layout?.visualViewport || layout?.layoutViewport || { clientWidth: 1200, clientHeight: 900, pageX: 0, pageY: 0 };
  const x = Math.max(0, Number(rect.x || 0));
  const y = Math.max(0, Number(rect.y || 0));
  const width = Math.max(1, Math.min(Number(rect.width || 1), Number(viewport.clientWidth || 1200)));
  const height = Math.max(1, Math.min(Number(rect.height || 1), Number(viewport.clientHeight || 900)));
  return { x, y, width, height, scale: 1 };
}

function fallbackClip(layout) {
  const viewport = layout?.visualViewport || layout?.layoutViewport || { clientWidth: 1200, clientHeight: 900 };
  return { x: 0, y: Math.max(0, Number(viewport.clientHeight || 900) - 220), width: Math.min(900, Number(viewport.clientWidth || 1200)), height: 220 };
}

function clipToRect(clip) {
  return { x: round(clip.x), y: round(clip.y), width: round(clip.width), height: round(clip.height) };
}

function stableAttr(value) {
  if (value === "") return "";
  if (/^[a-zA-Z0-9:_ -]{1,80}$/.test(value)) return value;
  return `attr-length-${String(value).length}`;
}

function normalizeTag(tag) {
  return /^[a-z0-9-]{1,40}$/.test(tag) ? tag : "div";
}

function safeFilePart(value) {
  return String(value || "checkpoint").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

function stringAt(strings, index) {
  return typeof index === "number" ? String(strings[index] || "") : String(index || "");
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
