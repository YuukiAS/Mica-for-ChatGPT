import {
  contractForSurface,
  resolveSurfaceMatch
} from "./live-atlas-cdp-core.mjs";
import { assert } from "./live-atlas-common.mjs";

const SCROLL_Y = 1000;
const currentAssistantHint = safeTurnHint("assistant:conversation-turn-assistant-c");
const currentUserHint = safeTurnHint("user:msg-current-user");
const { snapshot, indexes } = fixtureSnapshot();
const layoutMetrics = {
  visualViewport: { clientWidth: 900, clientHeight: 700, pageX: 0, pageY: SCROLL_Y },
  layoutViewport: { clientWidth: 900, clientHeight: 700, pageX: 0, pageY: SCROLL_Y }
};

const oldDirectGeometryPick = oldGeometryOnlyAssistantPick(snapshot, { x: 40, y: 320, width: 820, height: 180 });
assert(oldDirectGeometryPick === indexes.oldAssistantB, "regression fixture no longer proves old geometry-only code would fail");

const assistant = resolveSurfaceMatch(snapshot, "assistantSettled", {
  stateClass: "assistant_settled",
  role: "assistant",
  turnId: currentAssistantHint,
  targetRect: { x: 40, y: 320, width: 820, height: 180 }
}, { layoutMetrics });
assert(assistant?.nodeIndex === indexes.currentAssistant, "current assistant was not selected by exact turn hint", assistant);
assert(assistant.rect.y === 320, "assistant rect was not normalized to viewport coordinates", assistant);
assert(assistant.turnId === currentAssistantHint, "assistant match did not expose privacy-safe turn hint");

const actionBar = resolveSurfaceMatch(snapshot, "assistantActionBar", {
  stateClass: "assistant_action_bar_visible",
  role: "assistant",
  turnId: currentAssistantHint,
  targetRect: { x: 640, y: 475, width: 180, height: 36 }
}, { layoutMetrics });
assert(actionBar?.nodeIndex === indexes.currentActionBar, "current assistant action bar was not selected by owning turn", actionBar);
assert(actionBar.owningTurnNodeIndex === indexes.currentAssistant, "action bar owning assistant turn was not recorded");

const nativeCopy = resolveSurfaceMatch(snapshot, "nativeCopyArea", {
  stateClass: "assistant_copy_action_visible_or_invoked",
  role: "assistant",
  turnId: currentAssistantHint,
  targetRect: { x: 646, y: 480, width: 30, height: 28 }
}, { layoutMetrics });
assert(nativeCopy?.nodeIndex === indexes.currentActionBar || nativeCopy?.nodeIndex === indexes.currentCopyButton, "native copy area was not constrained to current owning turn", nativeCopy);
assert(nativeCopy?.owningTurnNodeIndex === indexes.currentAssistant, "native copy owner is not current assistant");

const user = resolveSurfaceMatch(snapshot, "userTurn", {
  stateClass: "user_turn_mounted",
  role: "user",
  turnId: currentUserHint,
  targetRect: { x: 80, y: 250, width: 760, height: 52 }
}, { layoutMetrics });
assert(user?.nodeIndex === indexes.currentUser, "user turn data-message-id hint did not select current user", user);
const userContract = contractForSurface(snapshot, "userTurn", user.rect, user.nodeIndex);
assert(!JSON.stringify(userContract).includes("msg-current-user"), "raw data-message-id leaked into sanitized contract");

const unresolved = resolveSurfaceMatch(snapshot, "assistantSettled", {
  stateClass: "assistant_settled",
  role: "assistant",
  turnId: currentAssistantHint,
  targetRect: { x: 20, y: 30, width: 400, height: 120 }
}, { layoutMetrics: { visualViewport: { pageX: 0, pageY: 0, clientWidth: 900, clientHeight: 700 } } });
assert(unresolved?.nodeIndex === indexes.currentAssistant, "identity should remain primary even when geometry is misleading");

const missing = resolveSurfaceMatch(snapshot, "assistantActionBar", {
  stateClass: "assistant_action_bar_visible",
  role: "assistant",
  turnId: safeTurnHint("assistant:missing-current-turn"),
  targetRect: { x: 640, y: 475, width: 180, height: 36 }
}, { layoutMetrics });
assert(missing === null, "unmatched turn hint must fail open to MISSING");

console.log(JSON.stringify({
  passed: true,
  turnHintExactMatch: true,
  actionBarOwningTurnMatch: true,
  scrollCoordinateNormalization: true,
  oldGeometryOnlyWouldPick: "oldAssistantB",
  selectedAssistant: "currentAssistantC",
  selectedActionBar: "currentActionBarC",
  automatedSend: false,
  automatedUpload: false,
  automatedConnectorAction: false
}, null, 2));

function fixtureSnapshot() {
  const strings = [];
  const intern = (value) => {
    let index = strings.indexOf(value);
    if (index < 0) {
      index = strings.length;
      strings.push(value);
    }
    return index;
  };
  const nodeName = [];
  const nodeValue = [];
  const parentIndex = [];
  const attributes = [];
  const layoutNodeIndex = [];
  const bounds = [];
  const addNode = (name, parent, attrs = {}, rect = null) => {
    const index = nodeName.length;
    nodeName.push(intern(name));
    nodeValue.push("");
    parentIndex.push(parent);
    attributes.push(Object.entries(attrs).flatMap(([key, value]) => [intern(key), intern(value)]));
    if (rect) {
      layoutNodeIndex.push(index);
      bounds.push([rect.x, rect.y, rect.width, rect.height]);
    }
    return index;
  };
  const html = addNode("HTML", -1);
  const body = addNode("BODY", html);
  const oldUser = addNode("ARTICLE", body, { "data-testid": "conversation-turn-old-user", "data-message-author-role": "user" }, { x: 40, y: 100, width: 820, height: 70 });
  const oldAssistantA = addNode("ARTICLE", body, { "data-testid": "conversation-turn-assistant-a", "data-message-author-role": "assistant" }, { x: 40, y: 210, width: 820, height: 150 });
  const oldActionBarA = addNode("DIV", oldAssistantA, { role: "toolbar", "data-testid": "assistant-action-bar-a" }, { x: 640, y: 325, width: 180, height: 36 });
  addNode("BUTTON", oldActionBarA, { "aria-label": "Copy", "data-testid": "copy-a" }, { x: 646, y: 330, width: 30, height: 28 });
  const oldAssistantB = addNode("ARTICLE", body, { "data-testid": "conversation-turn-assistant-b", "data-message-author-role": "assistant" }, { x: 40, y: 320, width: 820, height: 180 });
  const oldActionBarB = addNode("DIV", oldAssistantB, { role: "toolbar", "data-testid": "assistant-action-bar-b" }, { x: 640, y: 475, width: 180, height: 36 });
  addNode("BUTTON", oldActionBarB, { "aria-label": "Copy", "data-testid": "copy-b" }, { x: 646, y: 480, width: 30, height: 28 });
  const currentUser = addNode("ARTICLE", body, { "data-message-id": "msg-current-user", "data-message-author-role": "user" }, { x: 80, y: 1250, width: 760, height: 52 });
  const currentAssistant = addNode("ARTICLE", body, { "data-testid": "conversation-turn-assistant-c", "data-message-author-role": "assistant" }, { x: 40, y: 1320, width: 820, height: 180 });
  const currentActionBar = addNode("DIV", currentAssistant, { role: "toolbar", "data-testid": "assistant-action-bar-c" }, { x: 640, y: 1475, width: 180, height: 36 });
  const currentCopyButton = addNode("BUTTON", currentActionBar, { "aria-label": "Copy", "data-testid": "copy-c" }, { x: 646, y: 1480, width: 30, height: 28 });
  return {
    snapshot: {
      strings,
      documents: [{
        scrollOffsetX: 0,
        scrollOffsetY: SCROLL_Y,
        nodes: { nodeName, nodeValue, parentIndex, attributes },
        layout: { nodeIndex: layoutNodeIndex, bounds, styles: layoutNodeIndex.map(() => []) }
      }]
    },
    indexes: { oldUser, oldAssistantA, oldActionBarA, oldAssistantB, oldActionBarB, currentUser, currentAssistant, currentActionBar, currentCopyButton }
  };
}

function oldGeometryOnlyAssistantPick(snapshot, targetRect) {
  const doc = snapshot.documents[0];
  const nodeIndexes = doc.layout.nodeIndex;
  const bounds = doc.layout.bounds;
  let best = null;
  for (let index = 0; index < nodeIndexes.length; index += 1) {
    const nodeIndex = nodeIndexes[index];
    const attrs = attrsFor(snapshot, doc, nodeIndex);
    if (attrs["data-message-author-role"] !== "assistant") continue;
    const rect = { x: bounds[index][0], y: bounds[index][1], width: bounds[index][2], height: bounds[index][3] };
    const score = rectDistance(rect, targetRect);
    if (!best || score < best.score) best = { nodeIndex, score };
  }
  return best?.nodeIndex ?? null;
}

function attrsFor(snapshot, doc, nodeIndex) {
  const attrs = {};
  const raw = doc.nodes.attributes[nodeIndex] || [];
  for (let index = 0; index < raw.length; index += 2) attrs[snapshot.strings[raw[index]]] = snapshot.strings[raw[index + 1]];
  return attrs;
}

function rectDistance(rect, target) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  return Math.hypot(cx - tx, cy - ty);
}

function safeTurnHint(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `turn:${(hash >>> 0).toString(36)}`;
}
