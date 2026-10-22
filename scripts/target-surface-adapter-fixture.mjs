import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(rootPath, "dist", DEV_DIST_DIR_NAME, "chatgpt-adapter.js"), "utf8");

class FakeEvent {
  constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.flags = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.clickCount = 0;
    this.dispatched = [];
    this.diagnosticNodes = [];
  }
  append(...children) {
    for (const child of children) { child.parentElement = this; this.children.push(child); }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  closest(selector) {
    let current = this;
    while (current) {
      if (selector === "form" && current.tagName === "FORM") return current;
      current = current.parentElement;
    }
    return null;
  }
  querySelector(selector) {
    if (selector.includes("data-mica-tool-safety='consequential'") || selector.includes("data-mica-consequential='true'")) return this.flags.consequential ? {} : null;
    if (selector.includes("data-mica-tool-safety='read-only'")) return this.flags.readOnly ? {} : null;
    if (selector.includes("data-testid*='attachment'") || selector.includes("data-testid*='connector'")) return this.flags.sensitive ? {} : null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === "button,[role='button']") return this.children.filter((child) => child.tagName === "BUTTON" || child.getAttribute("role") === "button");
    if (selector.startsWith("button,[role='button'],")) return this.diagnosticNodes;
    if (selector.includes("data-mica-tool-stage")) return [];
    return [];
  }
  click() { this.clickCount += 1; }
  dispatchEvent(event) { this.dispatched.push(event); return true; }
}
class FakeHTMLElement extends FakeElement {}
class FakeTextArea extends FakeHTMLElement {
  constructor(ownerDocument) { super("textarea", ownerDocument); this._value = ""; }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
}
class FakeInput extends FakeHTMLElement {
  constructor(ownerDocument) { super("input", ownerDocument); this._value = ""; }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
}

const document = {
  location: { hostname: "fixture.invalid" },
  documentElement: { dataset: { micaFixture: "true" } },
  composer: null,
  suggestedCandidates: [],
  recoveryCandidates: { native_stop: [], assistant_retry: [], confirmed_resend: [] },
  querySelector(selector) {
    if (selector === "textarea#mobile-composer-prompt") return this.composer;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === "[data-mica-suggested-work-surface='true']") return this.suggestedCandidates;
    const action = selector.match(/^\[data-mica-recovery-control='([^']+)'\]$/)?.[1];
    if (action) return this.recoveryCandidates[action] || [];
    return [];
  }
};

const vicinity = new FakeHTMLElement("div", document);
const form = new FakeHTMLElement("form", document);
const composer = new FakeTextArea(document);
vicinity.append(form);
form.append(composer);
document.composer = composer;

const suggestion = new FakeHTMLElement("section", document);
suggestion.setAttribute("data-mica-suggested-work-surface", "true");
suggestion.setAttribute("data-mica-suggested-work-variant", "composer-sibling-v1");
const suggestionAction = new FakeHTMLElement("button", document);
suggestion.append(suggestionAction);
vicinity.append(suggestion);
document.suggestedCandidates = [suggestion];

const stop = recoveryButton("native_stop", "assistant-turn-9", "stop-current-turn");
stop.setAttribute("data-testid", "stop-button");
stop.setAttribute("aria-label", "Stop generating");
vicinity.append(stop);
vicinity.diagnosticNodes = [stop];
document.recoveryCandidates.native_stop = [stop];

const context = vm.createContext({
  console,
  document,
  Element: FakeElement,
  HTMLElement: FakeHTMLElement,
  HTMLTextAreaElement: FakeTextArea,
  HTMLInputElement: FakeInput,
  InputEvent: FakeEvent,
  Event: FakeEvent,
  __MICA_TEST_ONLY_TARGET_SURFACE_CONTRACT__: true
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "chatgpt-adapter.js" });
const adapter = context.MicaChatGPTAdapter;

const suggested = adapter.inspectSuggestedWorkSurface(document);
assert.equal(suggested.evidenceClass, "EXACT");
assert.equal(suggested.surface, suggestion);
assert.equal(suggested.candidateCount, 1);

const duplicate = new FakeHTMLElement("section", document);
duplicate.setAttribute("data-mica-suggested-work-surface", "true");
duplicate.setAttribute("data-mica-suggested-work-variant", "composer-sibling-v1");
duplicate.append(new FakeHTMLElement("button", document));
vicinity.append(duplicate);
document.suggestedCandidates = [suggestion, duplicate];
assert.equal(adapter.inspectSuggestedWorkSurface(document).evidenceClass, "AMBIGUOUS");
document.suggestedCandidates = [suggestion];

const state = { assistantTurnId: "assistant-turn-9", promptFingerprint: "draft-fingerprint" };
const stopObservation = adapter.inspectRecoveryControl("native_stop", state, document);
assert.equal(stopObservation.evidenceClass, "EXACT");
assert.match(stopObservation.controlIdHash, /^[a-f0-9]{16}$/);
assert.equal(adapter.inspectRecoveryControl("native_stop", { ...state, assistantTurnId: "wrong-turn" }, document).evidenceClass, "MISSING");
assert.equal(adapter.executeRecoveryControl({ type: "native_stop", controlIdHash: stopObservation.controlIdHash }, state, document).ok, true);
assert.equal(stop.clickCount, 1);
assert.equal(adapter.executeRecoveryControl({ type: "native_stop", controlIdHash: "0000000000000000" }, state, document).reason, "recovery_control_identity_changed");

const resend = recoveryButton("confirmed_resend", state.promptFingerprint, "send-confirmed-unsent");
document.recoveryCandidates.confirmed_resend = [resend];
const resendObservation = adapter.inspectRecoveryControl("confirmed_resend", state, document);
composer.value = "";
const resent = adapter.executeRecoveryControl({ type: "confirmed_resend", controlIdHash: resendObservation.controlIdHash, draft: "restore once" }, state, document);
assert.equal(resent.ok, true);
assert.equal(composer.value, "restore once");
assert.equal(resend.clickCount, 1);
assert.equal(composer.dispatched.at(-1)?.type, "input");

const diagnostics = adapter.inspectTargetSurfaceDiagnostics(document);
assert.equal(diagnostics.candidateCount, 1);
assert.equal(diagnostics.candidates[0].testId, "stop-button");
assert.equal(diagnostics.candidates[0].ariaSemantic, "stop");
assert.match(diagnostics.candidates[0].ariaLabelFingerprint, /^fnv1a:/);
assert.equal(JSON.stringify(diagnostics).includes("Stop generating"), false);
assert.equal(diagnostics.suggestionTextIncluded, false);
assert.equal(diagnostics.conversationTextIncluded, false);
assert.equal(diagnostics.rawDomIncluded, false);

context.__MICA_TEST_ONLY_TARGET_SURFACE_CONTRACT__ = false;
const clicksBeforeUntrustedFixture = stop.clickCount;
assert.equal(adapter.inspectSuggestedWorkSurface(document).evidenceClass, "MISSING");
const untrustedControl = adapter.inspectRecoveryControl("native_stop", state, document);
assert.equal(untrustedControl.evidenceClass, "MISSING");
assert.equal(adapter.executeRecoveryControl({ type: "native_stop", controlIdHash: stopObservation.controlIdHash }, state, document).ok, false);
assert.equal(stop.clickCount, clicksBeforeUntrustedFixture);

console.log(JSON.stringify({
  passed: true,
  suggestedWorkExactFixtureContract: true,
  ambiguousSuggestedWorkFailsOpen: true,
  recoveryControlSubjectBound: true,
  recoveryControlRevalidatedBeforeClick: true,
  confirmedResendRequiresEmptyComposer: true,
  targetDiagnosticsExcludeVisibleText: true,
  pageWritableFixtureMarkerRejected: true
}, null, 2));

function recoveryButton(actionType, subject, id) {
  const button = new FakeHTMLElement("button", document);
  button.setAttribute("data-mica-recovery-control", actionType);
  button.setAttribute("data-mica-recovery-subject", subject);
  button.setAttribute("data-mica-recovery-control-id", id);
  return button;
}
