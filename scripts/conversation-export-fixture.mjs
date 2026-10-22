import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", DEV_DIST_DIR_NAME);
const context = vm.createContext({ console, structuredClone, Date });
context.globalThis = context;

for (const file of ["conversation-export.js", "answer-serializer.js", "pdf-export-model.js"]) {
  vm.runInContext(await readFile(path.join(dist, file), "utf8"), context, { filename: file });
}

const coordinator = context.MicaConversationExport;
const serializer = context.MicaAnswerSerializer;
const pdf = context.MicaPdfExport;
const conversationId = "conversation-12345678";
const turns = [
  { turnId: "conversation-turn-1", order: 0, role: "user" },
  { turnId: "conversation-turn-2", order: 1, role: "assistant" },
  { turnId: "conversation-turn-3", order: 2, role: "user" },
  { turnId: "conversation-turn-4", order: 3, role: "assistant" }
];
const inspection = {
  turns,
  capabilities: [{ capabilityId: "turns.list", status: "EXACT" }]
};
const proof = {
  schemaVersion: 1,
  expectedTurnCount: turns.length,
  roleSequenceHash: coordinator.roleSequenceHash(turns),
  source: "validated-conversation-graph",
  conversationId,
  capturedAt: "2026-10-22T00:00:00.000Z"
};

const collected = coordinator.collect({ inspection, completenessProof: proof, conversationId, createDocument });
assert.equal(collected.ok, true);
assert.equal(collected.bundle.completeSelection, true);
assert.equal(collected.bundle.completionProof.status, "EXACT");
assert.equal(collected.bundle.entries.length, 4);

const markdown = serializer.serializeConversation(collected.bundle, { flavor: "gfm" });
assert.equal(markdown.ok, true);
assert.equal(markdown.turnCount, 4);
assert.equal(markdown.answerCount, 2);
assert.match(markdown.markdown, /^## User 1/m);
assert.match(markdown.markdown, /^## Assistant 2/m);
assert.ok(markdown.markdown.indexOf("User 1") < markdown.markdown.indexOf("Assistant 1"));
assert.equal(markdown.completionProof.turnSequenceHash, collected.bundle.completionProof.turnSequenceHash);

const firstAssistant = collected.bundle.entries[1].document;
const highlight = {
  id: "highlight-1",
  color: "mint",
  anchor: {
    conversationId,
    turnId: firstAssistant.turnId,
    documentId: firstAssistant.documentId,
    sourceVersion: firstAssistant.sourceVersion,
    textQuote: "Answer",
    prefix: "",
    suffix: "",
    sourceSpan: { start: 0, end: 6 }
  }
};
const pdfResult = pdf.buildConversationModel(collected.bundle, [highlight]);
assert.equal(pdfResult.ok, true);
assert.equal(pdfResult.model.turnCount, 4);
assert.equal(pdfResult.model.answerCount, 2);
assert.match(pdfResult.model.plainText, /^User 1\nPrompt 1/);
assert.match(pdfResult.model.plainText, /Assistant 1\nAnswer 1/);
assert.equal(pdfResult.model.highlights.length, 1);
assert.ok(pdfResult.model.highlights[0].start > 6, "conversation highlight must be shifted past the role heading");
assert.equal(pdfResult.model.completionProof.status, "EXACT");

assert.equal(coordinator.readiness({ enabled: true, lowMemoryActive: true, inspection, completenessProof: proof, conversationId }).reason, "load_full_history_required");
assert.equal(coordinator.collect({ inspection: { ...inspection, turns: turns.slice(0, 3) }, completenessProof: proof, conversationId, createDocument }).reason, "turn_count_mismatch");
assert.equal(coordinator.collect({ inspection, completenessProof: { ...proof, roleSequenceHash: "00000000" }, conversationId, createDocument }).reason, "turn_role_sequence_mismatch");
assert.equal(coordinator.collect({ inspection, completenessProof: proof, conversationId: "conversation-87654321", createDocument }).reason, "conversation_identity_mismatch");
assert.equal(coordinator.collect({ inspection, completenessProof: proof, conversationId, createDocument: (turn) => ({ ...createDocument(turn), generationState: turn.role === "assistant" ? "STREAMING" : "SETTLED", durable: turn.role !== "assistant" }) }).reason, "assistant_not_settled");
assert.equal(serializer.serializeConversation([firstAssistant], { completeSelection: true }).reason, "conversation_bundle_invalid");
assert.equal(coordinator.validateBundle({ ...collected.bundle, completionProof: { ...collected.bundle.completionProof, turnSequenceHash: "00000000" } }).reason, "conversation_sequence_unproven");

const output = {
  passed: true,
  exactCompletenessProof: true,
  roleAndTurnIdentityBound: true,
  markdownConversation: true,
  pdfConversation: true,
  highlightsShifted: true,
  lowMemoryRequiresFullHistory: true,
  forgedCompletenessRejected: true,
  streamingAssistantRejected: true
};
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "convergence-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "conversation-export.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

function createDocument(turn) {
  const text = turn.role === "user" ? `Prompt ${(turn.order / 2) + 1}` : `Answer ${((turn.order - 1) / 2) + 1}`;
  const documentId = `${turn.role}-${turn.order + 1}`;
  return {
    modelVersion: 1,
    role: turn.role,
    documentId,
    conversationId,
    turnId: turn.turnId,
    sourceVersion: `settled-${turn.order + 1}`,
    generationState: "SETTLED",
    durable: true,
    producedBy: "MicaChatGPTAdapter",
    orderedBlocks: [{
      blockId: `${documentId}-block-1`,
      kind: "paragraph",
      order: 0,
      inlines: [{ kind: "text", text, start: 0, end: text.length }]
    }]
  };
}
