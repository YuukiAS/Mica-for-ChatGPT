import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist", DEV_DIST_DIR_NAME);
const context = vm.createContext({ URL, Date, console });
context.globalThis = context;
vm.runInContext(await readFile(path.join(dist, "highlight-interaction-policy.js"), "utf8"), context);
vm.runInContext(await readFile(path.join(dist, "settings-model.js"), "utf8"), context);
vm.runInContext(await readFile(path.join(dist, "general-web-model.js"), "utf8"), context);

const settings = context.MicaSettingsModel;
const model = context.MicaGeneralWebHighlightModel;
const migrated = settings.fromStorage({
  micaSettings: {
    ...settings.defaults(),
    highlighter: { ...settings.defaults().highlighter, generalWebOrigins: ["https://example.com/path?q=1", "https://example.com/other", "javascript:alert(1)", "https://chatgpt.com/c/nope"] }
  }
});
assert.equal(migrated.schemaVersion, 6);
assert.deepEqual([...migrated.highlighter.generalWebOrigins], ["https://example.com"]);
assert.equal(settings.normalizeWebOrigin("http://localhost:8080/article"), "http://localhost:8080");
assert.equal(settings.normalizeWebOrigin("https://chatgpt.com/c/blocked"), null);
assert.equal(settings.toMatchPattern("https://example.com/page"), "https://example.com/*");

const text = "Intro alpha target omega. Later alpha target gamma.";
const start = text.indexOf("alpha target");
const record = model.createRecord({
  pageKey: "https://example.com/article?tracking=1#section",
  rootKey: "tag:article:0",
  text,
  start,
  end: start + "alpha target".length,
  color: "mint",
  createdAt: "2026-10-22T00:00:00.000Z"
});
assert.ok(record);
assert.equal(record.anchor.pageKey, "https://example.com/article");
assert.equal(record.anchor.origin, "https://example.com");
assert.equal(record.anchor.textQuote, "alpha target");
assert.equal(record.color, "mint");
assert.deepEqual(JSON.parse(JSON.stringify(record.annotation)), { note: "", tags: [] });
assert.equal("text" in record.anchor, false, "full page text must not be persisted");

const exact = model.resolveRecord(record, { pageKey: "https://example.com/article?new=1", rootKey: "tag:article:0", text });
assert.equal(exact.status, "resolved");
assert.equal(exact.method, "quote_context");
assert.equal(exact.start, start);

const moved = model.resolveRecord(record, { pageKey: "https://example.com/article", rootKey: "tag:article:0", text: `Banner ${text}` });
assert.equal(moved.status, "resolved");
assert.equal(moved.start, start + 7);

const ambiguousRecord = JSON.parse(JSON.stringify(record));
ambiguousRecord.anchor.prefix = "";
ambiguousRecord.anchor.suffix = "";
const ambiguous = model.resolveRecord(ambiguousRecord, { pageKey: "https://example.com/article", rootKey: "tag:article:0", text });
assert.equal(ambiguous.status, "unresolved");
assert.equal(ambiguous.reason, "quote_ambiguous");
assert.equal(ambiguous.candidateCount, 2);
assert.equal(model.resolveRecord(record, { pageKey: "https://example.com/other", rootKey: "tag:article:0", text }).reason, "page_mismatch");
assert.equal(model.resolveRecord(record, { pageKey: "https://example.com/article", rootKey: "body", text }).reason, "root_mismatch");
assert.equal(model.createRecord({ pageKey: "https://example.com", rootKey: "html>body>main", text, start: 0, end: 5 }), null, "absolute DOM paths must be rejected");

const recolored = model.withColor(record, "pink");
assert.equal(recolored.color, "pink");
const secondStart = text.lastIndexOf("alpha target");
const secondRecord = model.createRecord({ pageKey: "https://example.com/article", rootKey: "tag:article:0", text, start: secondStart, end: secondStart + "alpha target".length, color: "blue", createdAt: "2026-10-22T00:00:01.000Z" });
const exported = model.exportJson([record, secondRecord]);
const imported = model.importJson(exported);
assert.equal(imported.ok, true);
assert.equal(imported.records.length, 2);
assert.equal(model.recordsForPage(imported.records, "https://example.com/article?ignored=yes").length, 2);
assert.equal(model.mergeRecords([record], [recolored, secondRecord]).length, 2);
assert.equal(model.importJson("{broken").ok, false);

console.log(JSON.stringify({
  passed: true,
  settings: { schemaVersion: migrated.schemaVersion, exactOriginPermissionModel: true, chatgptExcluded: true },
  anchors: { contextualResolution: true, movedResolution: true, ambiguousFailsOpen: true, absoluteDomPathRejected: true },
  storage: { localOnlyRecord: true, importExport: true, maxRecords: model.maxRecords }
}, null, 2));
