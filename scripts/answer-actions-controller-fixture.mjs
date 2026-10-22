import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(rootPath, "dist", DEV_DIST_DIR_NAME);
const adapterSource = await readFile(path.join(dist, "chatgpt-adapter.js"), "utf8");
const controllerSource = await readFile(path.join(dist, "answer-actions-controller.js"), "utf8");
assert.doesNotMatch(controllerSource, /MutationObserver|setInterval|setTimeout/);
assert.doesNotMatch(controllerSource, /querySelector(?:All)?\s*\(/);
assert.doesNotMatch(controllerSource, /addEventListener\(["'](?:beforeinput|input|keydown|compositionstart|compositionupdate|compositionend)/);

let nextFrame = 1;
const frames = new Map();

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.textContent = "";
    this.className = "";
    this.shadowRoot = null;
  }
  get firstElementChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 ? this.parentElement.children[index + 1] || null : null;
  }
  get isConnected() { return !!this.ownerDocument?.contains(this); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, reference) {
    node.remove();
    node.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index >= 0) this.children.splice(index, 0, node);
    else this.children.push(node);
    return node;
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)) || !!this.shadowRoot?.contains(node); }
  attachShadow() { this.shadowRoot = new FakeShadowRoot(this.ownerDocument, this); return this.shadowRoot; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) this.dataset[dataKey(name)] = String(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, extra = {}) {
    const event = { type, target: this, isTrusted: true, key: "", stopPropagation() {}, preventDefault() {}, ...extra };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return descendants(this).filter((node) => matches(node, selector)); }
}
class FakeHTMLElement extends FakeElement {}
class FakeButton extends FakeHTMLElement { constructor(ownerDocument) { super("button", ownerDocument); this.type = "button"; this.title = ""; } }
class FakeTextArea extends FakeHTMLElement {}
class FakeShadowRoot extends FakeElement {
  constructor(ownerDocument, host) { super("#shadow-root", ownerDocument); this.host = host; }
  get isConnected() { return this.host.isConnected; }
}

class FakeDocument {
  constructor() {
    this.location = { hostname: "fixture.invalid" };
    this.documentElement = new FakeHTMLElement("html", this);
    this.documentElement.dataset.micaFixture = "true";
    this.activeElement = null;
    this.listeners = new Map();
  }
  createElement(tagName) { return String(tagName).toLowerCase() === "button" ? new FakeButton(this) : new FakeHTMLElement(tagName, this); }
  contains(node) { return this.documentElement.contains(node); }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
}

const document = new FakeDocument();
const context = vm.createContext({
  console,
  document,
  Element: FakeElement,
  HTMLElement: FakeHTMLElement,
  HTMLButtonElement: FakeButton,
  HTMLTextAreaElement: FakeTextArea,
  __MICA_TEST_ONLY_TARGET_SURFACE_CONTRACT__: true,
  requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { frames.delete(id); }
});
context.globalThis = context;
vm.runInContext(adapterSource, context, { filename: "chatgpt-adapter.js" });
vm.runInContext(controllerSource, context, { filename: "answer-actions-controller.js" });

let fixture = mountTurn("conversation-turn-1", "SETTLED");
const observation = context.MicaChatGPTAdapter.inspectAnswerActionTargets(document);
assert.equal(observation.evidenceClass, "EXACT");
assert.equal(observation.targetCount, 1);
assert.equal(observation.targets[0].turnId, "conversation-turn-1");

const invoked = [];
const controller = context.MicaAnswerActionsController;
controller.configure({
  adapter: context.MicaChatGPTAdapter,
  enabled: true,
  actions: ["markdown", "notion", "pdf"],
  defaultAction: "pdf",
  onAction(request) { invoked.push(request); return true; }
});
flushFrames();
assert.equal(controller.getStatus().mountedCount, 1);
assert.equal(fixture.cluster.children.length, 2);
const host = fixture.cluster.children[1];
assert.equal(host.dataset.micaUi, "answer-actions");
const [, trigger, menu] = host.shadowRoot.children;
assert.equal(trigger.getAttribute("aria-label"), "Mica actions");
assert.equal(menu.children.length, 3);
assert.equal(menu.children[0].dataset.action, "pdf");
assert.deepEqual(menu.children.map((button) => button.textContent), ["Export PDF", "Copy Markdown", "Copy for Notion"]);

trigger.emit("click", { isTrusted: false });
assert.equal(menu.hidden, true);
trigger.emit("click");
assert.equal(menu.hidden, false);
menu.emit("click", { target: menu.children[0] });
await Promise.resolve();
assert.equal(menu.hidden, true);
assert.equal(JSON.stringify(invoked[0]), JSON.stringify({ turnId: "conversation-turn-1", action: "pdf", evidenceClass: "EXACT" }));

fixture.turn.dataset.micaGenerationState = "STREAMING";
controller.reconcile(document);
assert.equal(controller.getStatus().mountedCount, 0);
fixture.turn.dataset.micaGenerationState = "SETTLED";
controller.reconcile(document);
assert.equal(controller.getStatus().mountedCount, 1);

fixture.turn.remove();
fixture = mountTurn("conversation-turn-1", "SETTLED");
controller.reconcile(document);
assert.equal(controller.getStatus().mountedCount, 1);
assert.equal(fixture.cluster.children.filter((node) => node.dataset.micaUi === "answer-actions").length, 1);

fixture.cluster.append(nativeCopy(document));
controller.reconcile(document);
assert.equal(context.MicaChatGPTAdapter.inspectAnswerActionTargets(document).evidenceClass, "MISSING");
assert.equal(controller.getStatus().mountedCount, 0);

fixture.turn.remove();
fixture = mountTurn("conversation-turn-2", "SETTLED");
controller.updateSettings({ enabled: true, actions: ["markdown", "pdf"], defaultAction: "markdown" });
flushFrames();
assert.equal(controller.getStatus().mountedCount, 1);
const remountedHost = fixture.cluster.children[1];
const remountedMenu = remountedHost.shadowRoot.children[2];
assert.deepEqual(remountedMenu.children.map((button) => button.dataset.action), ["markdown", "pdf"]);
controller.updateSettings({ enabled: false, actions: ["markdown", "pdf"], defaultAction: "markdown" });
assert.equal(controller.getStatus().mountedCount, 0);

context.__MICA_TEST_ONLY_TARGET_SURFACE_CONTRACT__ = false;
controller.updateSettings({ enabled: true, actions: ["markdown"], defaultAction: "markdown" });
flushFrames();
assert.equal(controller.getStatus().reason, "fixture_contract_authority_required");
assert.equal(controller.getStatus().mountedCount, 0);

document.documentElement.dataset.micaFixture = "false";
document.location.hostname = "chatgpt.com";
controller.reconcile(document);
assert.equal(controller.getStatus().evidenceClass, "MISSING");
assert.equal(controller.getStatus().reason, "current_site_contract_unproven");
assert.equal(controller.getStatus().mountedCount, 0);

console.log(JSON.stringify({
  passed: true,
  exactAdapterTargetRequired: true,
  singleEntryPerAnswer: true,
  compactMenuActions: true,
  defaultActionOrdering: true,
  untrustedGestureRejected: true,
  streamingAnswerFailsOpen: true,
  ambiguousNativeCopyFailsOpen: true,
  remountReconciled: true,
  toggleRemovesUi: true,
  pageWritableFixtureMarkerRejected: true,
  currentSiteWithoutContractFailsOpen: true,
  noPollingObserverOrTypingListener: true
}, null, 2));

function mountTurn(turnId, state) {
  const turn = new FakeHTMLElement("section", document);
  turn.setAttribute("data-testid", turnId);
  turn.dataset.micaGenerationState = state;
  const role = new FakeHTMLElement("div", document);
  role.setAttribute("data-message-author-role", "assistant");
  const content = new FakeHTMLElement("div", document);
  content.className = "markdown";
  content.textContent = "Fixture answer";
  role.append(content);
  const cluster = new FakeHTMLElement("div", document);
  cluster.append(nativeCopy(document));
  turn.append(role, cluster);
  document.documentElement.append(turn);
  return { turn, role, content, cluster };
}

function nativeCopy(doc) {
  const button = new FakeButton(doc);
  button.setAttribute("data-testid", "copy-turn-action-button");
  return button;
}

function descendants(node) {
  const output = [];
  for (const child of node.children) { output.push(child, ...descendants(child)); }
  return output;
}

function matches(node, selector) {
  if (selector === "[data-testid^='conversation-turn-']") return node.getAttribute("data-testid")?.startsWith("conversation-turn-");
  if (selector === "[data-message-author-role]") return node.hasAttribute("data-message-author-role");
  if (selector === "[data-testid='copy-turn-action-button']") return node.getAttribute("data-testid") === "copy-turn-action-button";
  if (selector.startsWith(":scope > ")) return node.className === "markdown" || node.hasAttribute("data-message-content") || node.className === "prose" || node.className === "whitespace-pre-wrap";
  if (selector.includes("data-is-streaming") || selector.includes("aria-busy") || selector.includes("Stop generating")) return false;
  return false;
}

function dataKey(attribute) {
  return attribute.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function flushFrames() {
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) callback();
}
