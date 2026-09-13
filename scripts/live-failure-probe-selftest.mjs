import assert from "node:assert/strict";
import { buildContract, buildModel } from "./live-failure-probe.mjs";
import { assertReadOnlyCommand } from "./live-atlas-cdp-core.mjs";

const PRIVATE_SENTENCE = "MY_PRIVATE_RANDOM_SENTENCE_93817";
const LONG_PAYLOAD = [
  "GitHub read-only connector payload.",
  PRIVATE_SENTENCE,
  "This text intentionally appears in the fake user turn and property-backed composer value.",
  "It must never be copied into the sanitized committed contract."
].join(" ");

const results = [];

function run(name, fn) {
  fn();
  results.push({ name, passed: true });
}

function testTextareaProperty() {
  const fixture = buildFixture({ composerKind: "textarea", composerValue: LONG_PAYLOAD });
  const model = buildModel(fixture.snapshot);
  const contract = buildContract(fixtureContractInput(fixture, model));
  assert.equal(contract.staleComposer.status, "OBSERVED");
  assert.equal(contract.staleComposer.groundTruth, "EXACT");
  assert.equal(contract.staleComposer.composerControlKind, "textarea");
  assert.equal(contract.staleComposer.composerValueSource, "DOMSNAPSHOT_TEXT_VALUE");
  assert.equal(contract.staleComposer.composerVisibleBodyLength, LONG_PAYLOAD.length);
  assert.equal(contract.staleComposer.bodyLength, LONG_PAYLOAD.length);
  assert.ok(contract.staleComposer.bodyHash);
  assert.ok(contract.staleComposer.latestCommittedUserTurn.textHash);
  assert.equal(contract.staleComposer.bodyHash, contract.staleComposer.latestCommittedUserTurn.textHash);
  assert.equal(contract.staleComposer.samePayloadAsLatestUserTurn, true);
}

function testContenteditable() {
  const fixture = buildFixture({ composerKind: "contenteditable", composerValue: LONG_PAYLOAD });
  const model = buildModel(fixture.snapshot);
  const contract = buildContract(fixtureContractInput(fixture, model));
  assert.equal(contract.staleComposer.status, "OBSERVED");
  assert.equal(contract.staleComposer.groundTruth, "EXACT");
  assert.equal(contract.staleComposer.composerControlKind, "contenteditable");
  assert.equal(contract.staleComposer.composerValueSource, "CONTENTEDITABLE_TEXT");
  assert.equal(contract.staleComposer.bodyLength, LONG_PAYLOAD.length);
  assert.equal(contract.staleComposer.samePayloadAsLatestUserTurn, true);
}

function testAxIconOnlyCopy() {
  const fixture = buildFixture({ composerKind: "textarea", composerValue: LONG_PAYLOAD, copyAccessibleName: "复制" });
  const model = buildModel(fixture.snapshot);
  const contract = buildContract(fixtureContractInput(fixture, model));
  assert.equal(contract.actionBar.status, "OBSERVED");
  assert.equal(contract.actionBar.groundTruth, "EXACT");
  assert.equal(contract.actionBar.nativeCopy.source, "ACCESSIBILITY+BACKEND_NODE");
  assert.equal(contract.actionBar.nativeCopy.accessibleName, "Copy");
  assert.equal(contract.actionBar.nativeCopy.node.tag, "button");
  assert.equal(contract.actionBar.nativeCopy.node.ariaLabel, null);
}

function testParentSibling() {
  const fixture = buildFixture({ composerKind: "textarea", composerValue: LONG_PAYLOAD });
  const model = buildModel(fixture.snapshot);
  const contract = buildContract(fixtureContractInput(fixture, model));
  assert.equal(contract.actionBar.status, "OBSERVED");
  assert.ok(Array.isArray(contract.actionBar.nativeCopyParentChain));
  assert.ok(contract.actionBar.nativeCopyParentChain.length >= 2);
  assert.ok(Array.isArray(contract.actionBar.actionCluster.siblingOrder));
  assert.ok(contract.actionBar.actionCluster.siblingOrder.length >= 3);
  assert.equal(contract.actionBar.micaCopy.sameParentAsNativeCopy, true);
  assert.equal(contract.actionBar.micaCopy.adjacentToNativeCopy, true);
  assert.equal(contract.actionBar.micaCopy.detachedFromNativeCluster, false);
}

function testSanitizer() {
  const fixture = buildFixture({ composerKind: "textarea", composerValue: LONG_PAYLOAD });
  const model = buildModel(fixture.snapshot);
  const contract = buildContract(fixtureContractInput(fixture, model));
  const serialized = JSON.stringify(contract);
  assert.equal(serialized.includes(PRIVATE_SENTENCE), false);
  assert.equal(serialized.includes("private-conv-id"), false);
  assert.equal(serialized.includes("g-p-private-project-slug"), false);
  assert.equal(serialized.includes(LONG_PAYLOAD), false);
  assert.equal(contract.target.pathShape, "/g/<gpt-id>/c/<conversation-id>");
  assert.equal(contract.privacy.promptTextIncluded, false);
  assert.equal(contract.privacy.answerTextIncluded, false);
}

function testReadOnlyAllowlist() {
  for (const allowed of [
    "Runtime.enable",
    "Log.enable",
    "Target.getTargets",
    "Target.attachToTarget",
    "DOMSnapshot.captureSnapshot",
    "Page.getLayoutMetrics",
    "Accessibility.getFullAXTree",
    "Page.captureScreenshot",
    "Performance.getMetrics"
  ]) {
    assert.doesNotThrow(() => assertReadOnlyCommand(allowed), allowed);
  }
  for (const forbidden of [
    "Runtime.evaluate",
    "Input.dispatchKeyEvent",
    "Page.navigate",
    "Page.reload",
    "Network.enable",
    "Fetch.enable",
    "Tracing.start"
  ]) {
    assert.throws(() => assertReadOnlyCommand(forbidden), /Forbidden CDP command|not allowlisted/, forbidden);
  }
}

function fixtureContractInput(fixture, model) {
  return {
    target: {
      type: "page",
      title: "Private live failure title",
      url: "https://chatgpt.com/g/g-p-private-project-slug/c/private-conv-id"
    },
    layout: {
      cssVisualViewport: { clientWidth: 1000, clientHeight: 800, pageX: 0, pageY: 0, zoom: 1 },
      cssLayoutViewport: { clientWidth: 1000, clientHeight: 800, pageX: 0, pageY: 0 },
      cssContentSize: { width: 1000, height: 1200 }
    },
    model,
    axTree: fixture.axTree
  };
}

function buildFixture({ composerKind, composerValue, copyAccessibleName = "Copy" }) {
  const builder = new SnapshotBuilder();
  const doc = builder.node(-1, "#document");
  const body = builder.node(doc, "body");
  const main = builder.node(body, "main");

  const userTurn = builder.node(main, "div", {
    "data-message-author-role": "user",
    "data-testid": "user-turn-final"
  }, { bounds: [120, 100, 620, 160] });
  builder.text(userTurn, LONG_PAYLOAD);

  const assistantTurn = builder.node(main, "div", {
    "data-message-author-role": "assistant",
    "data-testid": "assistant-turn-final"
  }, { bounds: [120, 300, 620, 220] });
  builder.text(assistantTurn, "README result answer text");
  const actionCluster = builder.node(assistantTurn, "div", {
    role: "toolbar",
    "data-testid": "assistant-actions"
  }, { bounds: [120, 520, 260, 40] });
  builder.node(actionCluster, "button", { "aria-label": "Like" }, { bounds: [120, 520, 32, 32] });
  const nativeCopy = builder.node(actionCluster, "button", {}, { bounds: [156, 520, 32, 32], backendNodeId: 501 });
  builder.node(nativeCopy, "svg");
  builder.node(actionCluster, "button", {
    "data-mica-copy-action": "true",
    "aria-label": "Copy as Markdown with Mica"
  }, { bounds: [192, 520, 32, 32], backendNodeId: 502 });
  builder.node(actionCluster, "button", { "aria-label": "Retry" }, { bounds: [228, 520, 32, 32] });

  const form = builder.node(body, "form", { "data-testid": "composer" }, { bounds: [80, 680, 780, 96] });
  builder.node(form, "span", { "data-inline-selection-pill": "true", "data-id": "plugin:github" });
  if (composerKind === "textarea") {
    const textarea = builder.node(form, "textarea", { id: "prompt-textarea", "aria-label": "Message Mica" }, { bounds: [120, 700, 600, 60] });
    builder.textareaValue(textarea, composerValue);
  } else if (composerKind === "input") {
    const input = builder.node(form, "input", { id: "prompt-textarea", "aria-label": "Message Mica" }, { bounds: [120, 700, 600, 40] });
    builder.inputValue(input, composerValue);
  } else {
    const editable = builder.node(form, "div", { id: "prompt-textarea", contenteditable: "true", role: "textbox" }, { bounds: [120, 700, 600, 60] });
    builder.text(editable, composerValue);
  }

  return {
    snapshot: builder.snapshot(),
    axTree: {
      nodes: [
        {
          nodeId: "ax-native-copy",
          backendDOMNodeId: 501,
          role: { type: "role", value: "button" },
          name: { type: "computedString", value: copyAccessibleName }
        }
      ]
    }
  };
}

class SnapshotBuilder {
  constructor() {
    this.strings = [];
    this.stringIndexes = new Map();
    this.parentIndex = [];
    this.nodeName = [];
    this.nodeValue = [];
    this.backendNodeId = [];
    this.attributes = [];
    this.layoutNodeIndex = [];
    this.layoutBounds = [];
    this.layoutStyles = [];
    this.textValueIndex = [];
    this.textValueValue = [];
    this.inputValueIndex = [];
    this.inputValueValue = [];
  }

  node(parent, name, attrs = {}, options = {}) {
    const index = this.nodeName.length;
    this.parentIndex[index] = parent;
    this.nodeName[index] = this.string(name);
    this.nodeValue[index] = this.string("");
    this.backendNodeId[index] = options.backendNodeId ?? (1000 + index);
    this.attributes[index] = Object.entries(attrs).flatMap(([key, value]) => [this.string(key), this.string(value)]);
    if (options.bounds) {
      this.layoutNodeIndex.push(index);
      this.layoutBounds.push(options.bounds);
      this.layoutStyles.push([]);
    }
    return index;
  }

  text(parent, value) {
    const index = this.node(parent, "#text");
    this.nodeValue[index] = this.string(value);
    return index;
  }

  textareaValue(index, value) {
    this.textValueIndex.push(index);
    this.textValueValue.push(this.string(value));
  }

  inputValue(index, value) {
    this.inputValueIndex.push(index);
    this.inputValueValue.push(this.string(value));
  }

  snapshot() {
    return {
      documents: [
        {
          nodes: {
            parentIndex: this.parentIndex,
            nodeName: this.nodeName,
            nodeValue: this.nodeValue,
            backendNodeId: this.backendNodeId,
            attributes: this.attributes,
            textValue: { index: this.textValueIndex, value: this.textValueValue },
            inputValue: { index: this.inputValueIndex, value: this.inputValueValue }
          },
          layout: {
            nodeIndex: this.layoutNodeIndex,
            bounds: this.layoutBounds,
            styles: this.layoutStyles
          },
          scrollOffsetX: 0,
          scrollOffsetY: 0
        }
      ],
      strings: this.strings
    };
  }

  string(value) {
    const key = String(value);
    if (!this.stringIndexes.has(key)) {
      this.stringIndexes.set(key, this.strings.length);
      this.strings.push(key);
    }
    return this.stringIndexes.get(key);
  }
}

run("PROBE_TEXTAREA_PROPERTY_SELFTEST", testTextareaProperty);
run("PROBE_CONTENTEDITABLE_SELFTEST", testContenteditable);
run("PROBE_AX_ICON_ONLY_COPY_SELFTEST", testAxIconOnlyCopy);
run("PROBE_PARENT_SIBLING_SELFTEST", testParentSibling);
run("PROBE_SANITIZER_SELFTEST", testSanitizer);
run("PROBE_READ_ONLY_ALLOWLIST", testReadOnlyAllowlist);

console.log(JSON.stringify({ passed: true, results }, null, 2));
