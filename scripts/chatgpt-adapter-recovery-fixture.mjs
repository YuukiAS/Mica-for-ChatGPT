import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "chatgpt-adapter.js"), "utf8");

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.textContent = "";
    this.dataset = {};
    this.flags = {};
  }
  closest(selector) { return selector === "form" ? this.form || null : null; }
  querySelector(selector) {
    if (selector.includes("data-mica-tool-safety='consequential'") || selector.includes("data-mica-consequential='true'")) return this.flags.consequential ? {} : null;
    if (selector.includes("data-mica-tool-safety='read-only'")) return this.flags.readOnly ? {} : null;
    if (selector.includes("data-testid*='attachment'") || selector.includes("data-testid*='connector'")) return this.flags.sensitive ? {} : null;
    return null;
  }
  querySelectorAll(selector) { return selector.includes("data-mica-tool-stage") ? Array.from({ length: this.flags.toolStages || 0 }, () => ({})) : []; }
  contains(node) { return node === this; }
}
class FakeHTMLElement extends FakeElement {}
class FakeTextArea extends FakeHTMLElement { constructor(ownerDocument) { super(ownerDocument); this.value = ""; } }
class FakeInput extends FakeHTMLElement { constructor(ownerDocument) { super(ownerDocument); this.value = ""; } }

const document = {
  location: { hostname: "fixture.invalid" },
  documentElement: { dataset: { micaFixture: "true" } },
  activeLifecycle: false,
  composer: null,
  querySelector(selector) {
    if (selector === "textarea#mobile-composer-prompt") return this.composer;
    if (selector.includes("data-is-streaming='true'") || selector.includes("role='dialog'")) return this.activeLifecycle ? {} : null;
    return null;
  },
  querySelectorAll() { return []; }
};
const form = new FakeHTMLElement(document);
const composer = new FakeTextArea(document);
composer.form = form;
composer.parentElement = form;
document.composer = composer;

const context = vm.createContext({
  console,
  document,
  Element: FakeElement,
  HTMLElement: FakeHTMLElement,
  HTMLTextAreaElement: FakeTextArea,
  HTMLInputElement: FakeInput
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "chatgpt-adapter.js" });
const adapter = context.MicaChatGPTAdapter;

composer.value = "draft value";
let composerObservation = adapter.inspectComposerRecovery(document);
assert.equal(composerObservation.value, "draft value");
assert.equal(composerObservation.evidenceClass, "EXACT");
assert.equal(composerObservation.sensitiveContext, false);

form.flags.sensitive = true;
composerObservation = adapter.inspectComposerRecovery(document);
assert.equal(composerObservation.sensitiveContext, true);
assert.equal(composerObservation.toolSafety, "unknown");
form.flags.consequential = true;
composerObservation = adapter.inspectComposerRecovery(document);
assert.equal(composerObservation.consequentialAction, true);
assert.equal(composerObservation.toolSafety, "consequential");
form.flags = {};

const turnElement = new FakeHTMLElement(document);
const answerRoot = new FakeHTMLElement(document);
answerRoot.textContent = "private answer content";
turnElement.dataset.micaGenerationState = "STREAMING";
const turn = { role: "assistant", element: turnElement, answerRoot };

let turnObservation = adapter.inspectTurnRecovery(turn);
assert.equal(turnObservation.generationState, "STREAMING");
assert.equal(turnObservation.toolSafety, "none");
assert.equal(turnObservation.evidenceClass, "EXACT");
assert.match(turnObservation.progressSignature, /^fnv1a:[a-f0-9]{8}:22:stages=0$/);
assert.equal(turnObservation.progressSignature.includes("private"), false);

turnElement.flags.toolStages = 1;
turnObservation = adapter.inspectTurnRecovery(turn);
assert.equal(turnObservation.toolSafety, "unknown");
turnElement.flags.readOnly = true;
assert.equal(adapter.inspectTurnRecovery(turn).toolSafety, "read_only");
turnElement.flags.consequential = true;
assert.equal(adapter.inspectTurnRecovery(turn).toolSafety, "consequential");

composer.value = "still drafting";
assert.equal(adapter.inspectReloadSafety(document).reason, "composer_not_empty");
composer.value = "";
document.activeLifecycle = true;
assert.equal(adapter.inspectReloadSafety(document).reason, "active_dialog_or_stream");
document.activeLifecycle = false;
assert.equal(adapter.inspectReloadSafety(document).safe, true);
document.composer = null;
assert.equal(adapter.inspectReloadSafety(document).reason, "composer_unavailable");

console.log(JSON.stringify({
  passed: true,
  composerPropertyRead: true,
  sensitiveAndConsequentialContext: true,
  progressSignatureContentExcluded: true,
  toolSafetyRouting: true,
  reloadSafetyFailClosed: true
}, null, 2));
