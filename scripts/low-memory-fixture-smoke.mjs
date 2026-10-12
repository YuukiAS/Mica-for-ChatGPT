import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
const browser = await chromium.launch({ headless: true, args: ["--js-flags=--max-old-space-size=256"] });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  await page.setContent("<!doctype html><html data-mica-fixture='true'><body></body></html>");
  await page.addScriptTag({ path: path.join(distDir, "low-memory-core.js") });
  const result = await page.evaluate(() => {
    const core = globalThis.MicaLowMemoryCore;
    const short = makeConversation(24);
    const medium = makeConversation(72);
    const long = makeConversation(240, { branchAt: 220, dependencies: true, heavyBytes: 8192 });
    const longBefore = JSON.stringify(long).length;
    const shortResult = core.windowJsonPayload(short, { keepCount: 40, threshold: 80 });
    const mediumResult = core.windowJsonPayload(medium, { keepCount: 40, threshold: 80 });
    const longResult = core.windowJsonPayload(long, { keepCount: 40, threshold: 80 });
    const longAfter = JSON.stringify(long).length;

    const malformed = makeConversation(120);
    malformed.mapping[malformed.current_node].parent = malformed.current_node;
    const malformedBefore = JSON.stringify(malformed);
    const malformedResult = core.windowJsonPayload(malformed, { keepCount: 40, threshold: 80 });

    const disconnected = makeConversation(120);
    disconnected.mapping.orphan = { id: "orphan", children: [], message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["orphan"] }, metadata: {} } };
    const disconnectedBefore = JSON.stringify(disconnected);
    const disconnectedResult = core.windowJsonPayload(disconnected, { keepCount: 40, threshold: 80 });
    const unknownRole = makeConversation(120);
    unknownRole.mapping[unknownRole.current_node].message.author.role = "future_agent";
    const unknownRoleBefore = JSON.stringify(unknownRole);
    const unknownRoleResult = core.windowJsonPayload(unknownRole, { keepCount: 40, threshold: 80 });
    const unknownContent = makeConversation(120);
    unknownContent.mapping[unknownContent.current_node].message.content.content_type = "future_content";
    const unknownContentBefore = JSON.stringify(unknownContent);
    const unknownContentResult = core.windowJsonPayload(unknownContent, { keepCount: 40, threshold: 80 });
    const supportedSensitive = makeConversation(120, { dependencies: true });
    supportedSensitive.mapping[supportedSensitive.current_node].message.status = "in_progress";
    supportedSensitive.mapping[supportedSensitive.current_node].message.end_turn = false;
    supportedSensitive.mapping[supportedSensitive.current_node].message.content = { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "fixture" }, "streaming"] };
    supportedSensitive.mapping[supportedSensitive.current_node].message.metadata = { connector_id: "fixture", plugin_ids: ["fixture"], attachments: [{ id: "file-fixture" }], auth: { required: true } };
    const supportedSensitiveResult = core.windowJsonPayload(supportedSensitive, { keepCount: 40, threshold: 80 });
    const turboFailOpen = [disconnectedBefore, unknownRoleBefore, unknownContentBefore].map((serialized) => {
      const input = JSON.stringify(encodeTurbo({ loaderData: { route: { serverResponse: { data: JSON.parse(serialized) } } } }));
      const output = core.windowTurboStreamChunk(input, {}, { keepCount: 40, threshold: 80 });
      return { action: output.action, unchanged: output.chunk === input, reason: output.reason };
    });

    const turboConversation = makeConversation(240, { branchAt: 220, dependencies: true, heavyBytes: 8192 });
    const turbo = encodeTurbo({ loaderData: { route: { serverResponse: { data: turboConversation } } }, trace: "fixture" });
    const promiseKey = encodeString(turbo, "statsigGateEvaluationsPromise");
    const oldPromiseIndex = turbo.length;
    turbo.push(["P", oldPromiseIndex]);
    turbo[0][`_${promiseKey}`] = oldPromiseIndex;
    const streamState = {};
    const turboResult = core.windowTurboStreamChunk(JSON.stringify(turbo), streamState, { keepCount: 40, threshold: 80 });
    const compacted = JSON.parse(turboResult.chunk);
    const continuation = core.windowTurboStreamChunk(`P${oldPromiseIndex}:[{}]\n`, streamState, { keepCount: 40, threshold: 80 });
    const mappedPromiseIndex = streamState.indexMap.get(oldPromiseIndex);
    const nextInitialChunk = JSON.stringify(encodeTurbo({ loaderData: { route: { serverResponse: { data: makeConversation(24) } } } }));
    const nextInitial = core.windowTurboStreamChunk(nextInitialChunk, streamState, { keepCount: 40, threshold: 80 });
    const decoded = decodeTurbo(compacted);
    const windowed = decoded.loaderData.route.serverResponse.data;

    const bypassCopy = makeConversation(120);
    const beforeUnknown = JSON.stringify({ unrelated: bypassCopy.mapping });
    const unknownPayload = { unrelated: bypassCopy.mapping };
    const unknownResult = core.windowJsonPayload(unknownPayload, { keepCount: 40, threshold: 80 });

    return {
      profiles: [
        profile("short", 24, shortResult, short),
        profile("medium", 72, mediumResult, medium),
        profile("long", 240, longResult, long)
      ],
      json: {
        changed: longResult.changed,
        bytesBefore: longResult.meta.bytesBefore,
        bytesAfter: longResult.meta.bytesAfter,
        serializedBefore: longBefore,
        serializedAfter: longAfter,
        currentPreserved: !!long.mapping[long.current_node],
        structuralRootPreserved: Object.values(long.mapping).some((node) => !node.message),
        branchPreserved: !!long.mapping["branch-220"] && !!long.mapping["branch-220-leaf"],
        toolDependencyPreserved: Object.values(long.mapping).some((node) => node.message?.author?.role === "tool"),
        fileAuthMetadataPreserved: Object.values(long.mapping).some((node) => node.message?.metadata?.fileAuth === true)
      },
      turbo: {
        action: turboResult.action,
        inputEntries: turbo.length,
        outputEntries: compacted.length,
        mappingNodes: Object.keys(windowed.mapping).length,
        currentPreserved: !!windowed.mapping[windowed.current_node],
        continuationAction: continuation.action,
        continuationIndex: Number(/^P(\d+):/.exec(continuation.chunk)?.[1]),
        mappedPromiseIndex,
        subsequentInitialAction: nextInitial.action,
        subsequentInitialReason: nextInitial.reason,
        subsequentInitialPreserved: nextInitial.chunk === nextInitialChunk
      },
      failOpen: {
        malformedChanged: malformedResult.changed,
        malformedReason: malformedResult.reason,
        malformedUnchanged: JSON.stringify(malformed) === malformedBefore,
        unknownChanged: unknownResult.changed,
        unknownReason: unknownResult.reason,
        unknownUnchanged: JSON.stringify(unknownPayload) === beforeUnknown,
        disconnectedChanged: disconnectedResult.changed,
        disconnectedUnchanged: JSON.stringify(disconnected) === disconnectedBefore,
        unknownRoleChanged: unknownRoleResult.changed,
        unknownRoleUnchanged: JSON.stringify(unknownRole) === unknownRoleBefore,
        unknownContentChanged: unknownContentResult.changed,
        unknownContentUnchanged: JSON.stringify(unknownContent) === unknownContentBefore
      },
      supportedStructures: {
        changed: supportedSensitiveResult.changed,
        currentPreserved: !!supportedSensitive.mapping[supportedSensitive.current_node],
        streamingInProgress: supportedSensitive.mapping[supportedSensitive.current_node]?.message?.status === "in_progress",
        multimodalFileAuthConnectorPlugin: supportedSensitive.mapping[supportedSensitive.current_node]?.message?.metadata?.auth?.required === true
      },
      turboFailOpen
    };

    function profile(name, totalTurns, profileResult, payload) {
      return {
        name,
        totalTurns,
        modeApplied: profileResult.changed,
        retainedRecentTurns: profileResult.meta.retainedRecentTurns || profileResult.meta.visibleKept || totalTurns,
        mountedBefore: totalTurns,
        mountedAfter: profileResult.changed ? profileResult.meta.visibleKept : totalTurns,
        mappingNodesAfter: Object.keys(payload.mapping).length
      };
    }

    function makeConversation(visibleTurns, options = {}) {
      const mapping = { root: { id: "root", children: [] } };
      let parent = "root";
      let visible = 0;
      let ordinal = 0;
      while (visible < visibleTurns) {
        ordinal += 1;
        if (options.dependencies && ordinal % 19 === 0) addNode(`tool-${ordinal}`, "tool", "text", false);
        if (options.dependencies && ordinal % 23 === 0) addNode(`context-${ordinal}`, "assistant", "model_editable_context", false);
        const role = visible % 2 === 0 ? "user" : "assistant";
        addNode(`turn-${visible + 1}`, role, "text", true);
        visible += 1;
      }
      if (options.branchAt) {
        const branchParent = `turn-${options.branchAt}`;
        const next = mapping[branchParent].children[0];
        mapping[branchParent].children.push(`branch-${options.branchAt}`);
        mapping[`branch-${options.branchAt}`] = node(`branch-${options.branchAt}`, branchParent, "assistant", "text", [`branch-${options.branchAt}-leaf`], options.heavyBytes, true);
        mapping[`branch-${options.branchAt}-leaf`] = node(`branch-${options.branchAt}-leaf`, `branch-${options.branchAt}`, "user", "text", [], options.heavyBytes, true);
        if (next) mapping[next].parent = branchParent;
      }
      return { id: "fixture-conversation", mapping, current_node: parent, root: "root" };

      function addNode(id, role, contentType, countAsVisible) {
        mapping[parent].children.push(id);
        mapping[id] = node(id, parent, role, contentType, [], options.heavyBytes, options.dependencies && countAsVisible && visible > visibleTurns - 12);
        parent = id;
      }
    }

    function node(id, parent, role, contentType, children, heavyBytes = 0, fileAuth = false) {
      return {
        id,
        parent,
        children,
        message: {
          author: { role },
          content: { content_type: contentType, parts: ["x".repeat(heavyBytes)] },
          metadata: fileAuth ? { fileAuth: true, connector: true } : {}
        }
      };
    }

    function encodeTurbo(value) {
      const flat = [];
      const seen = new Map();
      const strings = new Map();
      encode(value, 0);
      return flat;

      function encode(item, forcedIndex = null) {
        if (typeof item === "string") return encodeString(flat, item, strings);
        if (item && typeof item === "object" && seen.has(item)) return seen.get(item);
        const index = forcedIndex == null ? flat.length : forcedIndex;
        if (forcedIndex == null) flat.push(null);
        else while (flat.length <= forcedIndex) flat.push(null);
        if (item && typeof item === "object") seen.set(item, index);
        if (Array.isArray(item)) flat[index] = item.map((entry) => encode(entry));
        else if (item && typeof item === "object") {
          const object = {};
          flat[index] = object;
          for (const [key, entry] of Object.entries(item)) object[`_${encodeString(flat, key, strings)}`] = encode(entry);
        } else flat[index] = item;
        return index;
      }
    }

    function encodeString(flat, value, cache = null) {
      if (cache?.has(value)) return cache.get(value);
      const index = flat.length;
      flat.push(value);
      cache?.set(value, index);
      return index;
    }

    function decodeTurbo(flat) {
      const cache = new Map();
      return decode(0);
      function decode(index) {
        if (cache.has(index)) return cache.get(index);
        const value = flat[index];
        if (Array.isArray(value)) {
          if (value[0] === "P") return { promiseIndex: value[1] };
          const array = [];
          cache.set(index, array);
          for (const item of value) array.push(Number.isInteger(item) && item >= 0 ? decode(item) : item);
          return array;
        }
        if (value && typeof value === "object") {
          const object = {};
          cache.set(index, object);
          for (const [key, item] of Object.entries(value)) object[flat[Number(key.slice(1))]] = Number.isInteger(item) && item >= 0 ? decode(item) : item;
          return object;
        }
        return value;
      }
    }
  });

  assert(errors.length === 0, `low-memory page errors: ${errors.join(" | ")}`);
  const [short, medium, long] = result.profiles;
  assert(!short.modeApplied && !medium.modeApplied, "short or medium conversation was windowed below threshold");
  assert(long.modeApplied && long.retainedRecentTurns >= 40 && long.mountedAfter < long.mountedBefore, "long conversation did not retain the recent window");
  assert(result.json.changed && result.json.bytesAfter < result.json.bytesBefore && result.json.serializedAfter < result.json.serializedBefore, "JSON mapping window did not remove retained payload bytes");
  assert(result.json.currentPreserved && result.json.structuralRootPreserved && result.json.branchPreserved, "current path/root/recent branch was not preserved");
  assert(result.json.toolDependencyPreserved && result.json.fileAuthMetadataPreserved, "tool/file/auth dependencies were not preserved");
  assert(result.turbo.action === "replace" && result.turbo.outputEntries < result.turbo.inputEntries, "turbo-stream graph was not compacted");
  assert(result.turbo.currentPreserved && result.turbo.continuationAction === "replace", "turbo-stream current node or continuation was lost");
  assert(result.turbo.continuationIndex === result.turbo.mappedPromiseIndex, "turbo-stream continuation index was not remapped");
  assert(result.turbo.subsequentInitialAction === "pass" && result.turbo.subsequentInitialReason === "below_threshold" && result.turbo.subsequentInitialPreserved, "subsequent turbo-stream initial payload reused stale continuation state");
  assert(!result.failOpen.malformedChanged && result.failOpen.malformedUnchanged && !result.failOpen.unknownChanged && result.failOpen.unknownUnchanged, "unknown or malformed graph did not fail open");
  assert(!result.failOpen.disconnectedChanged && result.failOpen.disconnectedUnchanged, "disconnected graph did not fail open");
  assert(!result.failOpen.unknownRoleChanged && result.failOpen.unknownRoleUnchanged, "unknown role did not fail open");
  assert(!result.failOpen.unknownContentChanged && result.failOpen.unknownContentUnchanged, "unknown content did not fail open");
  assert(Object.values(result.supportedStructures).every(Boolean), "supported streaming/tool/file/auth/connector/plugin structures were not preserved");
  assert(result.turboFailOpen.every((item) => item.action === "pass" && item.unchanged), "turbo unknown/malformed graph did not fail open byte-for-byte");

  const output = { passed: true, ...result, pressureFixture: { memoryLimitMb: 256, payloadMb: 240 * 8192 / 1024 / 1024, turns: 240 } };
  const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, "low-memory-fixture.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
