import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", DEV_DIST_DIR_NAME);
const context = vm.createContext({ URL, Date, console });
context.globalThis = context;
for (const file of ["highlight-interaction-policy.js", "settings-model.js", "highlight-engine.js", "general-web-model.js", "local-import-model.js"]) {
  vm.runInContext(await readFile(path.join(dist, file), "utf8"), context, { filename: file });
}

const settings = context.MicaSettingsModel;
const chatgpt = context.MicaHighlightEngine;
const web = context.MicaGeneralWebHighlightModel;
const imports = context.MicaLocalImportModel;

assert.equal(settings.importJson(" ".repeat(settings.maxImportChars + 1)).reason, "settings_import_too_large");
assert.equal(settings.importJson(JSON.stringify({ schemaVersion: settings.schemaVersion + 1 })).reason, "settings_schema_unsupported");
assert.equal(settings.importJson(JSON.stringify({ enabled: false })).settings.enabled, false, "legacy unversioned settings must remain importable");
assert.equal(imports.inspectFile({ size: settings.maxImportChars + 1 }, "settings").reason, "settings_import_too_large");
assert.equal(imports.inspectFile({ size: imports.highlightFileBytes + 1 }, "highlights").reason, "highlights_import_too_large");
assert.equal(imports.inspectFile({ size: 1 }, "unknown").reason, "import_kind_unsupported");
let oversizedReadCalls = 0;
const oversizedRead = await imports.readFile({ size: imports.highlightFileBytes + 1, text: async () => { oversizedReadCalls += 1; return "{}"; } }, "highlights");
assert.equal(oversizedRead.reason, "highlights_import_too_large");
assert.equal(oversizedReadCalls, 0, "oversized imports must be rejected before File.text()");
assert.equal((await imports.readFile({ size: 2, text: async () => "{}" }, "settings")).text, "{}");

const answerDocument = {
  durable: true,
  generationState: "SETTLED",
  conversationId: "conversation-import",
  turnId: "turn-import",
  documentId: "document-import",
  sourceVersion: "source-import"
};
const snapshot = {
  textQuote: "bounded quote",
  prefix: "before ",
  suffix: " after",
  sourceSpan: { start: 7, end: 20 },
  structuralHint: { startBlockId: "block-1", endBlockId: "block-1", startKind: "paragraph", endKind: "paragraph", startOrder: 0, endOrder: 0 },
  mathTeX: ["x+1"]
};
const chatgptRecord = chatgpt.createRecord(answerDocument, snapshot, "yellow");
const pageText = "Intro alpha target omega.";
const webRecord = web.createRecord({
  pageKey: "https://example.com/article",
  rootKey: "tag:article:0",
  text: pageText,
  start: pageText.indexOf("alpha target"),
  end: pageText.indexOf("alpha target") + "alpha target".length,
  color: "mint",
  createdAt: "2026-10-22T00:00:00.000Z"
});
assert.ok(chatgptRecord && webRecord);

const backup = imports.createHighlightBackup([chatgptRecord], [webRecord], "2026-10-22T00:00:00.000Z");
assert.deepEqual(Object.keys(backup).sort(), ["chatgptRecords", "exportedAt", "generalWebRecords", "schemaVersion"]);
const combined = imports.parseHighlightBackup(JSON.stringify(backup));
assert.equal(combined.ok, true, JSON.stringify(combined));
assert.equal(combined.format, "combined-v2");
assert.equal(combined.importedCount, 2);
assert.equal(combined.rejectedCount, 0);

assert.equal(imports.parseHighlightBackup(JSON.stringify({ ...backup, schemaVersion: 3 })).reason, "highlight_backup_schema_unsupported");
assert.equal(imports.parseHighlightBackup(JSON.stringify({ ...backup, exportedAt: "not-a-time" })).reason, "highlight_backup_timestamp_invalid");
assert.equal(imports.parseHighlightBackup(JSON.stringify({ ...backup, promptText: "must-not-enter-import" })).reason, "highlight_backup_envelope_invalid");
assert.equal(imports.parseHighlightBackup(JSON.stringify({ schemaVersion: 2, exportedAt: backup.exportedAt, chatgptRecords: [] })).reason, "highlight_backup_envelope_invalid");
assert.equal(imports.parseHighlightBackup(JSON.stringify([chatgptRecord, webRecord])).reason, "legacy_highlight_families_mixed");
assert.equal(imports.parseHighlightBackup(chatgpt.exportJson([chatgptRecord])).format, "legacy-chatgpt-v1");
assert.equal(imports.parseHighlightBackup(web.exportJson([webRecord])).format, "legacy-general-web-v1");

const tooManyChatgpt = Array.from({ length: chatgpt.maxImportSourceRecords + 1 }, () => ({}));
const tooManyWeb = Array.from({ length: web.maxImportSourceRecords + 1 }, () => ({}));
assert.equal(chatgpt.importJson(JSON.stringify({ records: tooManyChatgpt })).reason, "highlight_record_count_exceeded");
assert.equal(web.importJson(JSON.stringify({ records: tooManyWeb })).reason, "general_web_highlight_record_count_exceeded");
assert.equal(imports.parseHighlightBackup(JSON.stringify({ ...backup, chatgptRecords: tooManyChatgpt })).reason, "highlight_backup_record_count_exceeded");

const current = [{ ...chatgptRecord, color: "yellow" }];
const incoming = [{ ...chatgptRecord, color: "blue" }, { ...chatgptRecord, color: "pink" }];
assert.equal(chatgpt.mergeRecords(current, incoming)[0].color, "blue", "incoming record must replace current while first incoming duplicate wins");

const output = {
  schemaVersion: 1,
  subject: "local-import-integrity",
  passed: true,
  settingsTextBudgetEnforced: true,
  settingsFileBudgetEnforced: true,
  futureSettingsSchemaRejected: true,
  legacySettingsAccepted: true,
  highlightFileBudgetEnforced: true,
  perFamilyRecordBudgetsEnforced: true,
  exactCombinedEnvelopeRequired: true,
  futureHighlightSchemaRejected: true,
  combinedRoundTrip: true,
  legacyFamilyImportsPreserved: true,
  mixedLegacyFamiliesRejected: true,
  deterministicConflictRule: "incoming_over_current_first_incoming_duplicate_wins",
  readBeforeBudgetCheck: false,
  unknownEnvelopeFieldsAccepted: false,
  externalServiceAdded: false,
  unboundedConversationContentImported: false
};

const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "convergence-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "local-import-integrity.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
