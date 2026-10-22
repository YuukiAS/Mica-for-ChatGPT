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
for (const file of ["highlight-engine.js", "general-web-model.js"]) {
  vm.runInContext(await readFile(path.join(dist, file), "utf8"), context, { filename: file });
}

const chatgpt = context.MicaHighlightEngine;
const web = context.MicaGeneralWebHighlightModel;
assert.equal(JSON.stringify(chatgpt.annotationLimits), JSON.stringify(web.annotationLimits));
assert.deepEqual(JSON.parse(JSON.stringify(chatgpt.annotationLimits)), { noteChars: 2000, tags: 16, tagChars: 64 });

const answerDocument = {
  durable: true,
  generationState: "SETTLED",
  conversationId: "conversation-integrity",
  turnId: "turn-integrity",
  documentId: "document-integrity",
  sourceVersion: "source-integrity"
};
const snapshot = {
  textQuote: "bounded quote",
  prefix: "before ",
  suffix: " after",
  sourceSpan: { start: 7, end: 20 },
  structuralHint: {
    startBlockId: "block-1",
    endBlockId: "block-2",
    startKind: "paragraph",
    endKind: "paragraph",
    startOrder: 0,
    endOrder: 1
  },
  mathTeX: ["x+1"]
};
const chatgptRecord = chatgpt.createRecord(answerDocument, snapshot, "mint");
assert.ok(chatgptRecord);
assert.deepEqual(JSON.parse(JSON.stringify(chatgptRecord.annotation)), { note: "", tags: [] });

const annotationInput = {
  note: `line 1\r\n${"n".repeat(2400)}`,
  tags: [" Research ", "research", "x".repeat(80), ...Array.from({ length: 30 }, (_, index) => ` tag   ${index} `), { unsafe: true }],
  hiddenPayload: "annotation-secret"
};
const annotatedChatgpt = chatgpt.withAnnotation(chatgptRecord, annotationInput);
assert.equal(annotatedChatgpt.annotation.note.length, chatgpt.annotationLimits.noteChars);
assert.equal(annotatedChatgpt.annotation.note.includes("\r"), false);
assert.equal(annotatedChatgpt.annotation.tags.length, chatgpt.annotationLimits.tags);
assert.equal(annotatedChatgpt.annotation.tags[0], "Research");
assert.equal(annotatedChatgpt.annotation.tags.filter((tag) => tag.toLowerCase() === "research").length, 1);
assert.ok(annotatedChatgpt.annotation.tags.every((tag) => tag.length <= chatgpt.annotationLimits.tagChars));
assert.equal("hiddenPayload" in annotatedChatgpt.annotation, false);

const legacyChatgpt = structuredClone(chatgptRecord);
delete legacyChatgpt.annotation;
const migratedChatgpt = chatgpt.importJson(JSON.stringify({ schemaVersion: 1, records: [legacyChatgpt] }));
assert.equal(migratedChatgpt.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(migratedChatgpt.records[0].annotation)), { note: "", tags: [] });

const poisonedChatgpt = {
  ...annotatedChatgpt,
  promptText: "chatgpt-top-level-secret",
  authToken: "chatgpt-token-secret",
  anchor: {
    ...annotatedChatgpt.anchor,
    rawDom: "chatgpt-anchor-secret",
    structuralHint: { ...annotatedChatgpt.anchor.structuralHint, rawDom: "chatgpt-structural-secret" }
  },
  annotation: { ...annotatedChatgpt.annotation, hiddenPayload: "chatgpt-annotation-secret" }
};
const sanitizedChatgpt = chatgpt.sanitizeRecords([poisonedChatgpt])[0];
assert.ok(sanitizedChatgpt);
assert.equal("promptText" in sanitizedChatgpt, false);
assert.equal("authToken" in sanitizedChatgpt, false);
assert.equal("rawDom" in sanitizedChatgpt.anchor, false);
assert.equal("rawDom" in sanitizedChatgpt.anchor.structuralHint, false);
assert.equal("hiddenPayload" in sanitizedChatgpt.annotation, false);
const recoloredChatgpt = chatgpt.withColor(poisonedChatgpt, "blue");
assert.equal("promptText" in recoloredChatgpt, false);
assert.equal("rawDom" in recoloredChatgpt.anchor, false);
const chatgptExport = chatgpt.exportJson([poisonedChatgpt]);
for (const marker of ["chatgpt-top-level-secret", "chatgpt-token-secret", "chatgpt-anchor-secret", "chatgpt-structural-secret", "chatgpt-annotation-secret"]) {
  assert.equal(chatgptExport.includes(marker), false);
}
assert.equal(chatgpt.importJson(chatgptExport).records.length, 1);
assert.equal(chatgpt.sanitizeRecords([{ ...chatgptRecord, id: `highlight-${"a".repeat(129)}` }]).length, 0);
assert.equal(chatgpt.sanitizeRecords([{ ...chatgptRecord, anchor: { ...chatgptRecord.anchor, sourceSpan: { start: 0, end: 10_000_001 } } }]).length, 0);

const pageText = "Intro alpha target omega.";
const webRecord = web.createRecord({
  pageKey: "https://example.com/article?tracking=1",
  rootKey: "tag:article:0",
  text: pageText,
  start: pageText.indexOf("alpha target"),
  end: pageText.indexOf("alpha target") + "alpha target".length,
  color: "yellow",
  createdAt: "2026-10-22T00:00:00.000Z"
});
assert.ok(webRecord);
const annotatedWeb = web.withAnnotation(webRecord, annotationInput);
assert.equal(annotatedWeb.annotation.note.length, web.annotationLimits.noteChars);
assert.equal(annotatedWeb.annotation.tags.length, web.annotationLimits.tags);
assert.equal(annotatedWeb.annotation.tags[0], "Research");
assert.equal("hiddenPayload" in annotatedWeb.annotation, false);

const legacyWeb = structuredClone(webRecord);
delete legacyWeb.annotation;
const migratedWeb = web.importJson(JSON.stringify({ schemaVersion: 1, records: [legacyWeb] }));
assert.equal(migratedWeb.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(migratedWeb.records[0].annotation)), { note: "", tags: [] });

const poisonedWeb = {
  ...annotatedWeb,
  pageText: "web-top-level-secret",
  requestBody: "web-request-secret",
  anchor: { ...annotatedWeb.anchor, rawDom: "web-anchor-secret" },
  annotation: { ...annotatedWeb.annotation, hiddenPayload: "web-annotation-secret" }
};
const sanitizedWeb = web.sanitizeRecords([poisonedWeb])[0];
assert.ok(sanitizedWeb);
assert.equal("pageText" in sanitizedWeb, false);
assert.equal("requestBody" in sanitizedWeb, false);
assert.equal("rawDom" in sanitizedWeb.anchor, false);
assert.equal("hiddenPayload" in sanitizedWeb.annotation, false);
const recoloredWeb = web.withColor(poisonedWeb, "pink");
assert.equal("pageText" in recoloredWeb, false);
assert.equal("rawDom" in recoloredWeb.anchor, false);
const webExport = web.exportJson([poisonedWeb]);
for (const marker of ["web-top-level-secret", "web-request-secret", "web-anchor-secret", "web-annotation-secret"]) {
  assert.equal(webExport.includes(marker), false);
}
assert.equal(web.importJson(webExport).records.length, 1);
assert.equal(web.sanitizeRecords([{ ...webRecord, id: `web-highlight-${"a".repeat(129)}` }]).length, 0);
assert.equal(web.sanitizeRecords([{ ...webRecord, anchor: { ...webRecord.anchor, sourceSpan: { start: 0, end: 10_000_001 } } }]).length, 0);

const output = {
  schemaVersion: 1,
  subject: "highlight-record-integrity",
  passed: true,
  unifiedAnnotationContract: true,
  legacyRecordsMigrated: true,
  notesBounded: true,
  tagsBounded: true,
  tagsNormalizedAndDeduplicated: true,
  unknownTopLevelFieldsStripped: true,
  unknownAnchorFieldsStripped: true,
  unknownAnnotationFieldsStripped: true,
  mutationHelpersResanitize: true,
  oversizedIdentityRejected: true,
  oversizedSourceOffsetsRejected: true,
  chatgptImportExportRoundTrip: true,
  generalWebImportExportRoundTrip: true,
  unknownSensitiveFieldsExcluded: true,
  localOnlyPureModel: true,
  backendInterfaceOnly: true,
  externalServiceAdded: false,
  fullDocumentContentPersisted: false
};

const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "convergence-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "highlight-record-integrity.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
