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
assert.equal(pdfResult.model.pageSize, "A4");
assert.equal(pdfResult.model.includeHighlights, true);
const letterWithoutHighlights = pdf.buildConversationModel(collected.bundle, [highlight], { pageSize: "Letter", includeHighlights: false });
assert.equal(letterWithoutHighlights.ok, true);
assert.equal(letterWithoutHighlights.model.pageSize, "Letter");
assert.equal(letterWithoutHighlights.model.includeHighlights, false);
assert.equal(letterWithoutHighlights.model.highlights.length, 0);
assert.equal(letterWithoutHighlights.model.unresolvedHighlightCount, 0);

const richAnswer = richAnswerDocument();
const parsedTableFixture = await parseRichTableWithAnswerDocument();
const parsedTable = parsedTableFixture.document;
assert.equal(parsedTable.orderedBlocks[0].kind, "table");
assert.equal(parsedTable.orderedBlocks[0].cellInlines[0][0][0].marks[0], "strong");
assert.equal(parsedTable.orderedBlocks[0].cellInlines[1][0][0].rawTeX, "\\beta");
assert.equal(parsedTable.orderedBlocks[0].cellInlines[1][1][0].href, "https://example.com/paper");
const tableSelection = parsedTableFixture.answerDocument.captureHighlightSelection(parsedTableFixture.turn, parsedTable, parsedTableFixture.range);
assert.equal(tableSelection.textQuote, "Estimate\tFormula\n\\beta\tCitation");
const parsedTablePdf = pdf.buildModel(parsedTable, [{
  id: "table-highlight",
  color: "blue",
  anchor: {
    conversationId: parsedTable.conversationId,
    turnId: parsedTable.turnId,
    documentId: parsedTable.documentId,
    sourceVersion: parsedTable.sourceVersion,
    textQuote: tableSelection.textQuote,
    prefix: tableSelection.prefix,
    suffix: tableSelection.suffix,
    sourceSpan: tableSelection.sourceSpan
  }
}]);
assert.equal(parsedTablePdf.ok, true);
assert.equal(parsedTablePdf.model.highlights.length, 1);
assert.equal(parsedTablePdf.model.plainText.slice(parsedTablePdf.model.highlights[0].start, parsedTablePdf.model.highlights[0].end), tableSelection.textQuote);
const richMarkdown = serializer.serializeMarkdown(richAnswer, { flavor: "gfm" });
assert.equal(richMarkdown.ok, true);
assert.match(richMarkdown.markdown, /\| \*\*Estimate\*\* \| Formula \|/);
assert.match(richMarkdown.markdown, /\| \$\\beta\$ \| \[Citation\]\(https:\/\/example\.com\/paper\) \|/);
const richNotion = serializer.serializeNotion(richAnswer);
assert.equal(richNotion.ok, true);
assert.match(richNotion.html, /<td><span data-mica-equation="inline" data-equation-expression="\\beta">/);
const richPdf = pdf.buildModel(richAnswer);
assert.equal(richPdf.ok, true);
const richUnits = richPdf.model.blocks.flatMap(blockUnits);
assert.ok(richUnits.some((unit) => unit.text === "Bold" && unit.marks.includes("strong")));
assert.ok(richUnits.some((unit) => unit.text === "code" && unit.kind === "inline_code"));
assert.ok(richUnits.some((unit) => unit.text === "Citation" && unit.href === "https://example.com/paper"));
assert.ok(richUnits.some((unit) => unit.text === "Unsafe" && unit.href === null));
assert.ok(richPdf.model.blocks.find((block) => block.kind === "table")?.rows[1][0].some((unit) => unit.kind === "inline_math" && unit.rawTeX === "\\beta"));

const pageHarness = createPdfPageHarness();
vm.runInNewContext(await readFile(path.join(dist, "pdf", "pdf-export-page.js"), "utf8"), pageHarness.context, { filename: "pdf-export-page.js" });
assert.equal(pageHarness.context.MicaPdfExportPage.renderModel(richPdf.model).ok, true);
const anchors = findElements(pageHarness.root, (node) => node.tagName === "a");
assert.equal(anchors.length, 2);
assert.ok(anchors.every((node) => /^https:\/\//.test(node.attributes.href)));
assert.ok(findElements(pageHarness.root, (node) => node.classList.contains("mark-strong")).length >= 2);
assert.ok(findElements(pageHarness.root, (node) => node.classList.contains("unit-inline_code")).length >= 1);
assert.ok(findElements(pageHarness.root, (node) => node.dataset.micaPdfKind === "inline_math").length >= 1);

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
  pdfSettingsConsumed: true,
  answerDocumentTableCellStructure: true,
  tableHighlightPdfInheritance: true,
  structuredTableMath: true,
  markdownTableFormatting: true,
  notionTableEquationMetadata: true,
  pdfInlineSemanticsModel: true,
  unsafePdfLinksRejected: true,
  pdfRenderSemanticsWired: true,
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

async function parseRichTableWithAnswerDocument() {
  const harness = createAnswerDocumentHarness();
  vm.runInContext(await readFile(path.join(dist, "answer-document.js"), "utf8"), harness.context, { filename: "answer-document.js" });
  const estimateText = harness.text("Estimate");
  const formulaText = harness.text("Formula");
  const betaText = harness.text("β");
  const citationText = harness.text("Citation");
  const betaMath = harness.element("span", { class: "katex", "data-tex": "\\beta" }, [harness.element("span", { class: "katex-html" }, [betaText])]);
  const table = harness.element("table", {}, [
    harness.element("tr", {}, [
      harness.element("th", {}, [harness.element("strong", {}, [estimateText])]),
      harness.element("th", {}, [formulaText])
    ]),
    harness.element("tr", {}, [
      harness.element("td", {}, [betaMath]),
      harness.element("td", {}, [harness.element("a", { href: "https://example.com/paper" }, [citationText])])
    ])
  ]);
  const root = harness.element("div", {}, [table]);
  const turn = {
    role: "assistant",
    turnId: "conversation-turn-table",
    answerRoot: root
  };
  return {
    answerDocument: harness.context.MicaAnswerDocument,
    turn,
    document: harness.context.MicaAnswerDocument.fromAssistantTurn(turn, { conversationId, generationState: "SETTLED" }),
    range: harness.range([estimateText, formulaText, betaMath, citationText], estimateText, citationText)
  };
}

function richAnswerDocument() {
  return {
    modelVersion: 1,
    role: "assistant",
    documentId: "answer-rich-fidelity",
    conversationId,
    turnId: "conversation-turn-rich",
    sourceVersion: "settled-rich-fidelity",
    generationState: "SETTLED",
    durable: true,
    producedBy: "MicaChatGPTAdapter",
    orderedBlocks: [
      {
        blockId: "rich-paragraph",
        kind: "paragraph",
        order: 0,
        inlines: [
          { kind: "text", text: "Bold", marks: ["strong"] },
          { kind: "text", text: " and " },
          { kind: "inline_code", text: "code" },
          { kind: "text", text: " with " },
          { kind: "link", text: "Source", href: "https://example.com/source", marks: ["emphasis"] },
          { kind: "text", text: " and " },
          { kind: "link", text: "Unsafe", href: "javascript:alert(1)" }
        ]
      },
      {
        blockId: "rich-table",
        kind: "table",
        order: 1,
        rows: [["Estimate", "Formula"], ["β", "Citation"]],
        cellInlines: [
          [[{ kind: "text", text: "Estimate", marks: ["strong"] }], [{ kind: "text", text: "Formula" }]],
          [[{ kind: "inline_math", rawTeX: "\\beta", renderedText: "β" }], [{ kind: "citation", text: "Citation", href: "https://example.com/paper" }]]
        ]
      }
    ]
  };
}

function blockUnits(block) {
  if (Array.isArray(block.units)) return block.units;
  if (Array.isArray(block.items)) return block.items.flat();
  if (Array.isArray(block.rows)) return block.rows.flat(2);
  return [];
}

function createPdfPageHarness() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = String(tagName || "").toLowerCase();
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.textContent = "";
      this.disabled = false;
      this._classes = new Set();
      this.classList = {
        add: (...values) => values.forEach((value) => this._classes.add(value)),
        contains: (value) => this._classes.has(value)
      };
    }
    set className(value) { this._classes = new Set(String(value || "").split(/\s+/).filter(Boolean)); }
    get className() { return [...this._classes].join(" "); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener() {}
  }
  const root = new FakeElement("main");
  const status = new FakeElement("p");
  const print = new FakeElement("button");
  const documentElement = new FakeElement("html");
  const nodes = { document: root, status, print };
  const document = {
    documentElement,
    title: "",
    getElementById: (id) => nodes[id] || null,
    createElement: (tagName) => new FakeElement(tagName)
  };
  return {
    root,
    context: vm.createContext({ console, document, window: { print() {} }, location: { hash: "" } })
  };
}

function createAnswerDocumentHarness() {
  const NODE = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  class FakeRange {
    constructor(selected = [], startContainer = null, endContainer = null) {
      this.selected = new Set(selected);
      this.startContainer = startContainer;
      this.endContainer = endContainer;
      this.startOffset = 0;
      this.endOffset = endContainer?.nodeValue?.length || 0;
      this.collapsed = false;
    }
    intersectsNode(node) { return this.selected.has(node); }
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }
    setStartBefore(node) { this.startContainer = node; this.startOffset = 0; }
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
    setEndAfter(node) { this.endContainer = node; this.endOffset = node.textContent?.length || 0; }
  }
  class FakeText {
    constructor(value) {
      this.nodeType = NODE.TEXT_NODE;
      this.nodeValue = value;
      this.parentElement = null;
      this.ownerDocument = fakeDocument;
    }
    get textContent() { return this.nodeValue; }
  }
  class FakeElement {
    constructor(tagName, attributes = {}, children = []) {
      this.nodeType = NODE.ELEMENT_NODE;
      this.tagName = String(tagName).toUpperCase();
      this.attributes = { ...attributes };
      this.className = attributes.class || "";
      this.childNodes = [];
      this.parentElement = null;
      this.ownerDocument = fakeDocument;
      for (const child of children) this.append(child);
    }
    append(child) { child.parentElement = this; this.childNodes.push(child); }
    get children() { return this.childNodes.filter((child) => child instanceof FakeElement); }
    get textContent() { return this.childNodes.map((child) => child.textContent || "").join(""); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    matches(selector) { return selector.split(",").some((part) => matchesSelector(this, part.trim())); }
    querySelectorAll(selector) {
      const output = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (child.matches(selector)) output.push(child);
          visit(child);
        }
      };
      visit(this);
      return output;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    contains(target) {
      return target === this || this.childNodes.some((child) => child === target || child.contains?.(target));
    }
  }
  const fakeDocument = { createRange: () => new FakeRange() };
  const context = vm.createContext({ console, HTMLElement: FakeElement, Node: NODE, Range: FakeRange, document: fakeDocument });
  context.globalThis = context;
  context.MicaChatGPTAdapter = { contractHash: "fixture-contract" };
  return {
    context,
    element: (tagName, attributes, children) => new FakeElement(tagName, attributes, children),
    text: (value) => new FakeText(value),
    range: (selected, startContainer, endContainer) => new FakeRange(selected, startContainer, endContainer)
  };

  function matchesSelector(node, selector) {
    if (!selector) return false;
    const classMatch = selector.match(/^\.([a-z0-9_-]+)$/i);
    if (classMatch) return String(node.className || "").split(/\s+/).includes(classMatch[1]);
    const attributeMatch = selector.match(/^([a-z0-9_-]+)?\[([^=\]]+)(?:=['\"]?([^'\"]+)['\"]?)?\]$/i);
    if (attributeMatch) {
      const [, tag, name, expected] = attributeMatch;
      if (tag && node.tagName !== tag.toUpperCase()) return false;
      const actual = node.getAttribute(name);
      return actual !== null && (expected === undefined || actual === expected);
    }
    return /^[a-z0-9]+$/i.test(selector) && node.tagName === selector.toUpperCase();
  }
}

function findElements(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return matches;
}
