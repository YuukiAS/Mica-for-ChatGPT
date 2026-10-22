import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", DEV_DIST_DIR_NAME);
const context = vm.createContext({ console, structuredClone, setTimeout, clearTimeout });
context.globalThis = context;

for (const file of ["settings-model.js", "answer-serializer.js", "highlight-engine.js", "recovery-state-machine.js"]) {
  vm.runInContext(await readFile(path.join(dist, file), "utf8"), context, { filename: file });
}

const settingsModel = context.MicaSettingsModel;
const serializer = context.MicaAnswerSerializer;
const highlighter = context.MicaHighlightEngine;
const recovery = context.MicaRecoveryStateMachine;

const migrated = settingsModel.fromStorage({
  enabled: false,
  lowMemory: true,
  lowMemoryKeepCount: 999,
  lowMemoryThreshold: 1,
  reliability: true,
  micaSettings: {
    schemaVersion: 2,
    reliability: { noProgressTimeoutSeconds: 2, autoStopEnabled: true, maxAutoReloadsPerTurn: 99, maxRecoveryCyclesPerTurn: 99, nativeStopSettleSeconds: 99, maxAutoNewMessageResends: 99, maxAutoAssistantRetries: 99, safeReadOnlyToolRecovery: false, consequentialActionAutoReplay: true }
  }
});
assert.equal(migrated.schemaVersion, settingsModel.schemaVersion);
assert.equal(migrated.enabled, false);
assert.equal(migrated.lowMemory.keepRecentTurns, 120);
assert.equal(migrated.lowMemory.activationThreshold, 10);
assert.equal(migrated.reliability.noProgressTimeoutSeconds, 30);
assert.equal(migrated.reliability.maxAutoReloadsPerTurn, 2);
assert.equal(migrated.reliability.autoStopEnabled, true);
assert.equal(migrated.reliability.maxRecoveryCyclesPerTurn, 3);
assert.equal(migrated.reliability.nativeStopSettleSeconds, 10);
assert.equal(migrated.reliability.maxAutoNewMessageResends, 1);
assert.equal(migrated.reliability.maxAutoAssistantRetries, 1);
assert.equal(migrated.reliability.safeReadOnlyToolRecovery, false);
assert.equal(migrated.reliability.consequentialActionAutoReplay, false);
assert.equal(settingsModel.toStorageRecord(migrated).enabled, false);
assert.equal(settingsModel.importJson(settingsModel.exportJson(migrated)).ok, true);
assert.equal(settingsModel.importJson("not-json").ok, false);

const answer = {
  durable: true,
  generationState: "SETTLED",
  documentId: "answer-fixture",
  conversationId: "conversation-fixture",
  turnId: "turn-fixture",
  sourceVersion: "settled-fixture",
  orderedBlocks: [
    { kind: "heading", level: 2, inlines: [{ kind: "text", text: "Research result", marks: ["strong"] }] },
    {
      kind: "paragraph",
      inlines: [
        { kind: "text", text: "在真实模型里，" },
        { kind: "inline_math", rawTeX: "\\varepsilon_i", renderedText: "εᵢ" },
        { kind: "text", text: " 是随机的，因此 " },
        { kind: "inline_math", rawTeX: "M_\\beta", renderedText: "Mβ" },
        { kind: "text", text: " 也是随机的。不同的环境响应系数 " },
        { kind: "inline_math", rawTeX: "\\beta", renderedText: "β" },
        { kind: "text", text: "，也会改变 " },
        { kind: "inline_math", rawTeX: "M_\\beta", renderedText: "Mβ" },
        { kind: "text", text: "。所以我们还不能仅凭上一个公式得到最终的 " },
        { kind: "inline_math", rawTeX: "I_g(\\eta)", renderedText: "Ig(η)" },
        { kind: "text", text: "。价格 $5 和代码字面量保持原样。" }
      ]
    },
    { kind: "display_math", rawTeX: "E=mc^2", renderedText: "E=mc²" },
    { kind: "list", ordered: false, items: [{ inlines: [{ kind: "text", text: "first" }] }, { inlines: [{ kind: "inline_code", text: "$literal" }] }] },
    { kind: "table", rows: [["A", "B"], ["x", "y"]] },
    { kind: "code", language: "js", text: "const price = '$5';" },
    { kind: "opaque_interactive", label: "tool" }
  ]
};

const markdown = serializer.serializeMarkdown(answer, { flavor: "gfm", inlineMathDelimiter: "parentheses", displayMathDelimiter: "brackets" });
assert.equal(markdown.ok, true);
assert.match(markdown.markdown, /\\\(\\varepsilon_i\\\)/);
assert.match(markdown.markdown, /\\\[\nE=mc\^2\n\\\]/);
assert.match(markdown.markdown, /价格 \$5/);
assert.match(markdown.markdown, /```js\nconst price = '\$5';\n```/);
assert.match(markdown.markdown, /\| A \| B \|/);
assert.ok(markdown.warnings.includes("opaque_interactive_omitted"));

const notion = serializer.serializeNotion(answer);
assert.equal(notion.ok, true);
assert.equal(notion.nativeEquationStatus, "UNVERIFIED");
assert.equal((notion.html.match(/data-mica-equation="inline"/g) || []).length, 5);
assert.match(notion.html, /data-equation-expression="I_g\(\\eta\)"/);
assert.ok(notion.plainText.indexOf("$\\varepsilon_i$") < notion.plainText.indexOf("$M_\\beta$"));
assert.equal(serializer.serializeConversation([answer], {}).reason, "conversation_completeness_unproven");
assert.equal(serializer.serializeConversation([answer], { completeSelection: true }).reason, "conversation_completeness_unproven", "caller boolean must not bypass conversation proof");
const notionImport = serializer.serializeNotionImport(answer);
assert.equal(notionImport.ok, true);
assert.match(notionImport.fileName, /^mica-answer-fixture\.md$/);
assert.equal(notionImport.nativeEquationStatus, "IMPORT_REQUIRES_REAL_TARGET_VALIDATION");

const highlightRecord = {
  schemaVersion: 1,
  id: "highlight-fixture",
  color: "yellow",
  status: "active",
  unresolvedReason: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  anchor: { conversationId: "conversation-fixture", turnId: "turn-fixture", documentId: "answer-fixture", sourceVersion: "settled-fixture", blockId: "block-1", textQuote: "selected", prefix: "", suffix: "", sourceSpan: { start: 0, end: 8 }, structuralHint: {}, mathTeX: [] }
};
const highlightExport = highlighter.exportJson([highlightRecord]);
assert.equal(highlighter.importJson(highlightExport).records.length, 1);
assert.equal(highlighter.importJson("not-json").ok, false);
assert.equal(highlighter.mergeRecords([highlightRecord], [{ ...highlightRecord, color: "blue" }])[0].color, "blue");
assert.equal(highlighter.recordsForScope([highlightRecord], { conversationId: "conversation-fixture" }).length, 1);

const config = settingsModel.defaults().reliability;
const scope = { tabId: 7, conversationKey: "conversation-a" };
const sent = (time = 0, extra = {}) => recovery.transition(recovery.create(scope, time), {
  type: "SEND_INTENT", scope, promptFingerprint: "fnv1a:test:4", baselineUserIds: ["u0"], baselineAssistantIds: ["a0"], draftAvailable: true, ...extra
}, config, time);
const committed = (time = 1_000, extra = {}) => recovery.transition(sent(0, extra), { type: "USER_COMMITTED", turnId: "u1" }, config, time);

let normalLong = recovery.transition(committed(), { type: "ASSISTANT_STARTED", turnId: "a1", progressSignature: "p1" }, config, 2_000);
normalLong = recovery.transition(normalLong, { type: "MEANINGFUL_PROGRESS", turnId: "a1", progressSignature: "p2" }, config, 50_000);
normalLong = recovery.transition(normalLong, { type: "TICK" }, config, 100_000);
assert.equal(normalLong.phase, recovery.phases.ASSISTANT_GENERATING, "real progress must reset the watchdog");

const firstReload = recovery.transition(committed(), { type: "TICK" }, config, 62_000);
assert.equal(firstReload.pendingAction.type, "reload");
assert.equal(firstReload.reloadCount, 1);

let explicitInterruption = recovery.transition(firstReload, { type: "PAGE_RESTORED" }, config, 63_000);
explicitInterruption = recovery.transition(explicitInterruption, { type: "EXPLICIT_INTERRUPTION" }, config, 64_000);
assert.equal(explicitInterruption.pendingAction.ordinal, 2);

let resumed = recovery.transition(firstReload, { type: "PAGE_RESTORED" }, config, 63_000);
resumed = recovery.transition(resumed, { type: "MEANINGFUL_PROGRESS", turnId: "a1", progressSignature: "continued" }, config, 64_000);
assert.equal(resumed.phase, recovery.phases.ASSISTANT_GENERATING);
assert.equal(resumed.pendingAction, null);

const confirmedAbsent = recovery.transition(sent(), { type: "COMMIT_CONFIRMED_ABSENT" }, config, 13_000);
assert.equal(confirmedAbsent.submissionStatus, recovery.submission.NOT_COMMITTED);
assert.equal(confirmedAbsent.pendingAction.type, "offer_restore_draft");

const uncertain = recovery.transition(sent(), { type: "TICK" }, config, 13_000);
assert.equal(uncertain.submissionStatus, recovery.submission.UNKNOWN);
assert.equal(uncertain.phase, recovery.phases.MANUAL_REQUIRED);

let exhausted = recovery.transition(explicitInterruption, { type: "PAGE_RESTORED" }, config, 65_000);
exhausted = recovery.transition(exhausted, { type: "TICK" }, config, 81_000);
assert.equal(exhausted.phase, recovery.phases.MANUAL_REQUIRED);
assert.equal(exhausted.reason, "reload_limit_reached");

const readOnlyProgress = recovery.transition(committed(), { type: "TOOL_PROGRESS", toolSafety: "read_only", progressSignature: "search-stage-2" }, config, 20_000);
assert.equal(readOnlyProgress.phase, recovery.phases.ASSISTANT_GENERATING);
assert.equal(readOnlyProgress.toolSafety, "read_only");
const readOnlyDisabled = recovery.transition(committed(), { type: "TOOL_PROGRESS", toolSafety: "read_only", progressSignature: "search-stage-2" }, { ...config, safeReadOnlyToolRecovery: false }, 20_000);
assert.equal(readOnlyDisabled.phase, recovery.phases.MANUAL_REQUIRED);
assert.equal(readOnlyDisabled.reason, "read_only_tool_recovery_disabled");

const consequential = recovery.transition(committed(), { type: "TOOL_PROGRESS", toolSafety: "consequential" }, config, 20_000);
assert.equal(consequential.phase, recovery.phases.MANUAL_REQUIRED);
assert.equal(consequential.reason, "unsafe_tool_state");

const sensitiveStall = recovery.transition(committed(1_000, { sensitiveContext: true, toolSafety: "unknown" }), { type: "TICK" }, config, 62_000);
assert.equal(sensitiveStall.phase, recovery.phases.MANUAL_REQUIRED);
assert.equal(sensitiveStall.reloadCount, 0);

const noParallel = recovery.transition(firstReload, { type: "TICK" }, config, 63_000);
assert.equal(noParallel.reloadCount, 1, "pending reload must not fork a parallel recovery");

const contextChanged = recovery.transition(committed(), { type: "CONTEXT_CHANGED" }, config, 10_000);
assert.equal(contextChanged.phase, recovery.phases.CANCELLED);

const userStopped = recovery.transition(committed(), { type: "USER_STOPPED" }, config, 10_000);
assert.equal(userStopped.phase, recovery.phases.CANCELLED);
assert.equal(userStopped.userStopped, true);

assert.equal(recovery.sanitizeSnapshot(JSON.parse(JSON.stringify(firstReload))).reloadCount, 1);
assert.notEqual(recovery.makeScopeKey(scope), recovery.makeScopeKey({ ...scope, tabId: 8 }));
const recoveryHistory = recovery.historyEntry(firstReload);
assert.equal(recoveryHistory.conversationTextIncluded, false);
assert.equal(recoveryHistory.rawConversationIdIncluded, false);
assert.equal("conversationKey" in recoveryHistory, false);
assert.match(recoveryHistory.eventId, /^[a-f0-9]{16}$/);
assert.match(recoveryHistory.recoveryId, /^[a-f0-9]{16}$/);
const reloadClaim = recovery.actionClaim(firstReload);
assert.equal(reloadClaim.type, "reload");
assert.equal(reloadClaim.ordinal, 1);
assert.match(reloadClaim.actionId, /^[a-f0-9]{16}$/);
assert.equal(recovery.actionClaim(resumed), null);
const backendUnavailable = recovery.transition(firstReload, { type: "RECOVERY_BACKEND_UNAVAILABLE" }, config, 63_000);
assert.equal(backendUnavailable.phase, recovery.phases.MANUAL_REQUIRED);
assert.equal(backendUnavailable.reason, "recovery_backend_unavailable");
assert.equal("promptText" in recovery.snapshotForStorage(firstReload), false);

console.log(JSON.stringify({
  passed: true,
  settings: { schemaVersion: migrated.schemaVersion, bounded: true, consequentialReplayLocked: true },
  export: { markdown: true, notionEquationCount: 5, notionNativeStatus: notion.nativeEquationStatus, notionImportFallback: true, conversationCompletenessGate: true },
  highlighterRecords: { exportImport: true, merge: true, scopedFiltering: true },
  reliability: { normalProgressPreserved: true, firstReload: true, secondReload: true, reloadLimit: true, submissionABC: true, consequentialReplayBlocked: true, tabIsolation: true, privacySafeSnapshot: true, actionClaimIdentity: true, backendFailureFailsManual: true }
}, null, 2));
