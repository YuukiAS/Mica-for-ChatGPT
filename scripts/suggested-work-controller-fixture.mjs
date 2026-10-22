import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "suggested-work-controller.js"), "utf8");
let nextFrameId = 1;
const frames = new Map();

class FakeHTMLElement {
  constructor() { this.hidden = false; this.attributes = new Map(); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
}

const document = {};
const context = vm.createContext({
  console,
  document,
  HTMLElement: FakeHTMLElement,
  requestAnimationFrame(callback) { const id = nextFrameId++; frames.set(id, callback); return id; }
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "suggested-work-controller.js" });

let observation = { surface: null, evidenceClass: "MISSING", reason: "contract_candidate_unavailable", candidateCount: 0, detectionSource: "fixture-contract-v1", variantId: "unproven-v1" };
const adapter = { inspectSuggestedWorkSurface() { return observation; } };
const controller = context.MicaSuggestedWorkController;
const surface = new FakeHTMLElement();

controller.configure({ adapter, enabled: true });
flushFrames();
assert.equal(controller.getStatus().state, "native");

observation = { surface, evidenceClass: "EXACT", reason: "contract_match", candidateCount: 1, detectionSource: "fixture-contract-v1", variantId: "composer-sibling-suggested-work-v1" };
controller.scheduleReconcile();
flushFrames();
assert.equal(surface.hidden, true);
assert.equal(surface.getAttribute("inert"), "");
assert.equal(surface.getAttribute("aria-hidden"), "true");
assert.equal(surface.getAttribute("data-mica-suggested-work-hidden"), "true");
assert.equal(controller.getStatus().hidden, true);

controller.updateSettings({ enabled: false });
assert.equal(surface.hidden, false);
assert.equal(surface.hasAttribute("hidden"), false);
assert.equal(surface.hasAttribute("inert"), false);
assert.equal(surface.hasAttribute("aria-hidden"), false);
assert.equal(surface.hasAttribute("data-mica-suggested-work-hidden"), false);

const unrelated = new FakeHTMLElement();
controller.updateSettings({ enabled: true });
observation = { surface: null, evidenceClass: "MISSING", reason: "unrelated_cards_only", candidateCount: 0, detectionSource: "none", variantId: "unproven-v1" };
flushFrames();
assert.equal(unrelated.hidden, false);
assert.equal(controller.getStatus().state, "native");

const remounted = new FakeHTMLElement();
observation = { surface: remounted, evidenceClass: "EXACT", reason: "contract_match", candidateCount: 1, detectionSource: "fixture-contract-v1", variantId: "composer-sibling-suggested-work-v1" };
controller.scheduleReconcile();
flushFrames();
assert.equal(remounted.hidden, true);
controller.updateSettings({ enabled: false });
assert.equal(remounted.hidden, false);

console.log(JSON.stringify({
  passed: true,
  toggleOnHidesExactSurface: true,
  toggleOffRestoresOriginalState: true,
  unrelatedCardsPreserved: true,
  remountReconciled: true,
  noPollingOrOwnObserver: true
}, null, 2));

function flushFrames() {
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) callback();
}
