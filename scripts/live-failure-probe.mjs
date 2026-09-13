import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectWebSocket,
  defaultEdgeUserDataDir,
  privacyFlags,
  readDevToolsActivePort,
  safetyFlags,
  validateAtlasThreadUrl
} from "./live-atlas-cdp-core.mjs";

const STYLE_PROBE = [
  "display",
  "position",
  "justify-content",
  "align-items",
  "gap",
  "column-gap",
  "row-gap",
  "flex-direction",
  "grid-auto-flow",
  "width",
  "height",
  "margin-left",
  "margin-right"
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const userDataDir = args.userDataDir || defaultEdgeUserDataDir();
  const sessionId = `live-failure-${Date.now()}`;
  const outDir = path.resolve(root, args.out || path.join("artifacts", "live-failure", sessionId));
  const contractDir = path.resolve(root, args.contractOut || path.join("tests", "contracts", "chatgpt-live", "real-live-failure-2026-09-13"));

  if (args.fromRaw) {
    const chosen = await materializeContractFromRaw(args.fromRaw);
    await mkdir(contractDir, { recursive: true });
    await writeJson(path.join(contractDir, "live-failure-contract.json"), chosen.contract);
    await writeFile(path.join(contractDir, "README.md"), `${readmeForContract(chosen.contract)}\n`);
    console.log(JSON.stringify(summaryForContract({
      passed: true,
      sessionId: path.basename(path.dirname(path.resolve(args.fromRaw))),
      outDir: path.dirname(path.resolve(args.fromRaw)),
      contractDir,
      contract: chosen.contract
    }), null, 2));
    return;
  }

  if (!userDataDir) throw new Error("probe:live-failure requires --user-data-dir or LOCALAPPDATA Edge user data");

  const targetUrl = args.threadUrl || "";
  if (targetUrl) validateAtlasThreadUrl(targetUrl);

  progress("reading DevToolsActivePort");
  const activePort = await readDevToolsActivePort(userDataDir);
  progress(`connecting browser websocket ${activePort.port}`);
  const client = await withTimeout(connectWebSocket(activePort.webSocketDebuggerUrl), "connectWebSocket", 8000);
  try {
    progress("Target.getTargets");
    const targetResult = await sendWithTimeout(client, "Target.getTargets", {}, { rootSession: true });
    const targetInfos = Array.isArray(targetResult.targetInfos) ? targetResult.targetInfos : [];
    const pageTargets = targetInfos.filter((target) => target.type === "page" && isChatGptConversationUrl(target.url));
    if (args.listTargets) {
    console.log(JSON.stringify({
      passed: true,
      chatgptConversationTargetCount: pageTargets.length,
      targets: pageTargets.map((target) => sanitizeTarget(target))
    }, null, 2));
      return;
    }
    const selectedTargets = targetUrl
      ? pageTargets.filter((target) => target.url === targetUrl)
      : pageTargets;
    if (targetUrl && selectedTargets.length !== 1) {
      throw new Error(`Expected exactly one target for --thread-url; found ${selectedTargets.length}`);
    }
    if (!targetUrl && selectedTargets.length === 0) {
      throw new Error("No chatgpt.com/c/<conversation-id> page target found in current Edge");
    }

    const probed = [];
    for (const target of selectedTargets) {
      probed.push(await probeTarget(client, target));
      if (targetUrl) break;
    }
    const chosen = chooseFailureCandidate(probed);
    if (!chosen) {
      const summary = probed.map((item) => ({
        targetHash: hashText(item.target.url).slice(0, 16),
        stalePayloadSameAsLatestUser: item.contract.staleComposer.samePayloadAsLatestUserTurn,
        micaCopyNativeSibling: item.contract.actionBar.micaCopy?.sameParentAsNativeCopy ?? null,
        micaCopyAdjacent: item.contract.actionBar.micaCopy?.adjacentToNativeCopy ?? null
      }));
      throw new Error(`Unable to identify the failed live page from ${probed.length} ChatGPT target(s): ${JSON.stringify(summary)}`);
    }

    await mkdir(outDir, { recursive: true });
    await mkdir(contractDir, { recursive: true });
    await writeJson(path.join(outDir, "raw-dom-snapshot.json"), chosen.raw);
    await writeJson(path.join(outDir, "sanitized-live-failure-contract.json"), chosen.contract);
    await writeJson(path.join(contractDir, "live-failure-contract.json"), chosen.contract);
    await writeFile(path.join(contractDir, "README.md"), `${readmeForContract(chosen.contract)}\n`);

    console.log(JSON.stringify(summaryForContract({
      passed: true,
      sessionId,
      outDir,
      contractDir,
      contract: chosen.contract
    }), null, 2));
  } finally {
    await client.close();
  }
}

async function materializeContractFromRaw(rawPath) {
  const raw = JSON.parse(await readFile(path.resolve(rawPath), "utf8"));
  const snapshot = raw.snapshot;
  const model = buildModel(snapshot);
  const contract = buildContract({
    target: raw.target || { type: "page", title: "", url: "" },
    layout: raw.layout || {},
    model,
    axTree: raw.axTree || null
  });
  return { contract, raw };
}

function summaryForContract({ passed, sessionId, outDir, contractDir, contract }) {
  return {
    passed,
    sessionId,
    outDir,
    contractDir,
    targetHash: contract.target.targetHash,
    actionBarGroundTruth: groundTruthStatus(contract.actionBar),
    nativeCopyResolved: contract.actionBar.nativeCopy?.source === "ACCESSIBILITY+BACKEND_NODE",
    nativeCopySource: contract.actionBar.nativeCopy?.source || null,
    nativeCopyParentChain: Array.isArray(contract.actionBar.nativeCopyParentChain) && contract.actionBar.nativeCopyParentChain.length > 0 ? "PRESENT" : "MISSING",
    actionClusterSiblingOrder: Array.isArray(contract.actionBar.actionCluster?.siblingOrder) && contract.actionBar.actionCluster.siblingOrder.length > 0 ? "PRESENT" : "MISSING",
    micaCopyRelationship: contract.actionBar.micaCopy ? "PRESENT" : "MISSING",
    staleComposerGroundTruth: groundTruthStatus(contract.staleComposer),
    composerControlKind: contract.staleComposer.composerControlKind || null,
    composerValueSource: contract.staleComposer.composerValueSource || null,
    composerBodyHash: contract.staleComposer.bodyHash ? "PRESENT" : "MISSING",
    latestUserTurnHash: contract.staleComposer.latestCommittedUserTurn?.textHash ? "PRESENT" : "MISSING",
    samePayloadAsLatestUserTurn: contract.staleComposer.samePayloadAsLatestUserTurn,
    micaCopySameParentAsNativeCopy: contract.actionBar.micaCopy?.sameParentAsNativeCopy ?? null,
    micaCopyAdjacentToNativeCopy: contract.actionBar.micaCopy?.adjacentToNativeCopy ?? null,
    automatedSend: false,
    automatedEnter: false,
    automatedUpload: false,
    automatedConnectorAction: false
  };
}

function groundTruthStatus(section) {
  if (!section || section.status === "MISSING") return "MISSING";
  return section.groundTruth || section.status || "MISSING";
}

async function probeTarget(client, target) {
  progress(`attach target ${hashText(target.url).slice(0, 12)}`);
  const attached = await sendWithTimeout(client, "Target.attachToTarget", { targetId: target.targetId, flatten: true }, { rootSession: true });
  if (!attached.sessionId) throw new Error("Target.attachToTarget did not return sessionId");
  client.setPageSessionId(attached.sessionId);
  progress("Runtime.enable");
  await sendWithTimeout(client, "Runtime.enable");
  progress("Log.enable");
  await sendWithTimeout(client, "Log.enable");
  progress("Page.getLayoutMetrics");
  const layout = await sendWithTimeout(client, "Page.getLayoutMetrics");
  progress("DOMSnapshot.captureSnapshot");
  const snapshot = await sendWithTimeout(client, "DOMSnapshot.captureSnapshot", { computedStyles: STYLE_PROBE }, {}, 20000);
  progress("Accessibility.getFullAXTree");
  const axTree = await sendWithTimeout(client, "Accessibility.getFullAXTree", {}, {}, 20000);
  const model = buildModel(snapshot);
  const contract = buildContract({ target, layout, snapshot, model, axTree });
  return {
    target,
    contract,
    raw: {
      schemaVersion: 1,
      kind: "mica.liveFailure.rawLocalOnly",
      capturedAt: new Date().toISOString(),
      privacy: { localOnly: true, containsRawDomText: true, doNotCommit: true },
      target,
      layout,
      snapshot,
      axTree
    }
  };
}

export function buildContract({ target, layout, model, axTree = null }) {
  const composer = findComposer(model);
  const userTurns = findRoleTurns(model, "user");
  const assistantTurns = findRoleTurns(model, "assistant");
  const latestUser = lastByDocumentOrder(userTurns);
  const latestAssistant = lastByDocumentOrder(assistantTurns);
  const actionBar = buildActionBarContract(model, latestAssistant, axTree);
  const staleComposer = buildStaleComposerContract(model, composer, latestUser);
  return {
    schemaVersion: 1,
    kind: "mica.chatgptLiveFailure.contract",
    source: "one-shot-read-only-devtools-active-port-probe",
    capturedAt: new Date().toISOString(),
    target: sanitizeTarget(target),
    layout: sanitizeLayout(layout),
    privacy: privacyFlags(),
    safety: safetyFlags(),
    actionBar,
    staleComposer,
    pageShape: {
      mountedUserTurnCount: userTurns.length,
      mountedAssistantTurnCount: assistantTurns.length,
      composerPresent: staleComposer.composerPresent,
      latestUserTurnPresent: !!latestUser,
      latestAssistantTurnPresent: !!latestAssistant
    }
  };
}

function buildActionBarContract(model, assistantTurn, axTree = null) {
  if (!assistantTurn) return { status: "MISSING", reason: "assistant_turn_missing" };
  const actionScopeIndex = assistantTurn.scopeIndex ?? assistantTurn.index;
  const nativeCopyMatch = findNativeCopyButton(model, actionScopeIndex, axTree);
  const nativeCopy = nativeCopyMatch?.nodeIndex ?? null;
  if (nativeCopy == null) return {
    status: "MISSING",
    reason: "native_copy_missing",
    owningAssistantTurn: turnSummary(model, assistantTurn.index, actionScopeIndex),
    nativeCopySource: axTree ? "ACCESSIBILITY_TREE_NO_MATCH" : "NO_ACCESSIBILITY_TREE"
  };
  const actionClusterIndex = findActionCluster(model, actionScopeIndex, nativeCopy);
  const micaCopy = findMicaCopyButton(model, actionScopeIndex, nativeCopy, actionClusterIndex);
  const nativeParent = actionClusterIndex ?? model.parent(nativeCopy);
  const micaParent = micaCopy == null ? null : model.parent(micaCopy);
  const siblings = nativeParent == null ? [] : model.children(nativeParent).filter((index) => isElement(model, index)).map((index) => semanticNode(model, index));
  const nativeSiblingIndex = nativeParent == null ? -1 : model.children(nativeParent).indexOf(nativeCopy);
  const micaSiblingIndex = micaCopy == null || micaParent == null ? -1 : model.children(micaParent).indexOf(micaCopy);
  const sameParent = micaCopy != null && nativeParent != null && nativeParent === micaParent;
  const adjacent = sameParent && Math.abs(nativeSiblingIndex - micaSiblingIndex) === 1;
  const parentChain = chain(model, nativeCopy, 7).map((index) => ({
    ...semanticNode(model, index),
    rect: roundRect(model.rect(index)),
    styles: sanitizedStyles(model, index)
  }));
  return {
    status: "OBSERVED",
    groundTruth: nativeCopyMatch.source === "ACCESSIBILITY+BACKEND_NODE" ? "EXACT" : "PARTIAL",
    owningAssistantTurn: turnSummary(model, assistantTurn.index, actionScopeIndex),
    nativeCopy: {
      source: nativeCopyMatch.source,
      accessibleName: nativeCopyMatch.accessibleName || null,
      node: semanticNode(model, nativeCopy),
      rect: roundRect(model.rect(nativeCopy)),
      parentNode: nativeParent == null ? null : semanticNode(model, nativeParent),
      siblingIndex: nativeSiblingIndex
    },
    micaCopy: micaCopy == null ? null : {
      node: semanticNode(model, micaCopy),
      rect: roundRect(model.rect(micaCopy)),
      parentNode: micaParent == null ? null : semanticNode(model, micaParent),
      siblingIndex: micaSiblingIndex,
      sameParentAsNativeCopy: sameParent,
      adjacentToNativeCopy: adjacent,
      detachedFromNativeCluster: !sameParent || !adjacent
    },
    actionCluster: nativeParent == null ? null : {
      node: semanticNode(model, nativeParent),
      rect: roundRect(model.rect(nativeParent)),
      styles: sanitizedStyles(model, nativeParent),
      siblingOrder: siblings
    },
    nativeCopyParentChain: parentChain,
    expectedPlacementInvariant: {
      micaCopySameParentAsNativeCopy: true,
      micaCopyAdjacentToNativeCopy: true,
      broadDetachedContainerRejected: true
    }
  };
}

function buildStaleComposerContract(model, composer, latestUser) {
  if (!composer) return { status: "MISSING", composerPresent: false, reason: "composer_missing" };
  const composerBody = composer.bodyText;
  const latestUserText = latestUser ? model.text(latestUser.index) : "";
  const composerHash = hashText(composerBody);
  const userHash = hashText(latestUserText);
  return {
    status: "OBSERVED",
    groundTruth: composer.valueSource === "DOMSNAPSHOT_TEXT_VALUE" || composer.valueSource === "DOMSNAPSHOT_INPUT_VALUE" || composer.valueSource === "CONTENTEDITABLE_TEXT" ? "EXACT" : "PARTIAL",
    composerPresent: true,
    composerControlKind: composer.controlKind,
    composerValueSource: composer.valueSource,
    composerRoot: composer.rootIndex == null ? null : semanticNode(model, composer.rootIndex),
    editable: semanticNode(model, composer.editableIndex),
    editableRect: roundRect(model.rect(composer.editableIndex)),
    composerVisibleBodyLength: composerBody.length,
    bodyLength: composerBody.length,
    bodyHash: composerHash.slice(0, 24),
    connectorPillPresent: composer.connectorPillPresent,
    connectorPillCount: composer.connectorPillCount,
    connectorPillTextLength: composer.connectorPillTextLength,
    latestCommittedUserTurn: latestUser ? {
      node: semanticNode(model, latestUser.index),
      rect: roundRect(model.rect(latestUser.index)),
      textLength: latestUserText.length,
      textHash: userHash.slice(0, 24)
    } : null,
    samePayloadAsLatestUserTurn: !!latestUser && composerBody.length > 0 && composerHash === userHash,
    evidence: {
      comparison: "canonical composer body vs latest committed user turn text",
      rawTextStoredOnlyUnderArtifacts: true
    }
  };
}

function findComposer(model) {
  const editables = model.elementIndexes().filter((index) => {
    const attrs = model.attrs(index);
    const tag = model.tag(index);
    return attrs.id === "prompt-textarea"
      || attrs.contenteditable === "true"
      || tag === "textarea"
      || (attrs.role === "textbox" && tag !== "button");
  });
  const editableIndex = editables.find((index) => !isInsideMica(model, index)) ?? null;
  if (editableIndex == null) return null;
  const rootIndex = closest(model, editableIndex, (index) => {
    const attrs = model.attrs(index);
    return /composer|prompt/i.test(`${attrs["data-testid"] || ""} ${attrs.id || ""}`) || model.tag(index) === "form";
  }) ?? model.parent(editableIndex);
  const rootForPill = rootIndex ?? editableIndex;
  const connectorNodes = descendants(model, rootForPill).filter((index) => isConnectorPill(model, index));
  const excluded = new Set(connectorNodes.flatMap((index) => [index, ...descendants(model, index)]));
  const control = model.controlValue(editableIndex);
  const tag = model.tag(editableIndex);
  const rawBodyText = control.value !== null ? control.value : model.text(editableIndex, excluded);
  const bodyText = canonicalize(rawBodyText);
  const valueSource = control.value !== null ? control.source : (tag === "textarea" || tag === "input" ? "DOM_TEXT_FALLBACK" : "CONTENTEDITABLE_TEXT");
  const connectorPillTextLength = connectorNodes.reduce((sum, index) => sum + model.text(index).length, 0);
  return {
    rootIndex,
    editableIndex,
    bodyText,
    controlKind: control.kind || (tag === "textarea" || tag === "input" ? tag : "contenteditable"),
    valueSource,
    connectorPillPresent: connectorNodes.length > 0,
    connectorPillCount: connectorNodes.length,
    connectorPillTextLength
  };
}

function findRoleTurns(model, role) {
  return model.elementIndexes()
    .filter((index) => model.attrs(index)["data-message-author-role"] === role)
    .map((index) => ({ index, scopeIndex: turnScopeIndex(model, index), rect: model.rect(index) }));
}

function chooseFailureCandidate(items) {
  if (items.length === 1) return items[0];
  const scored = items.map((item) => {
    const stale = item.contract.staleComposer.samePayloadAsLatestUserTurn ? 4 : 0;
    const detached = item.contract.actionBar.micaCopy?.detachedFromNativeCluster ? 2 : 0;
    const hasComposer = item.contract.staleComposer.composerPresent ? 1 : 0;
    return { item, score: stale + detached + hasComposer };
  }).sort((a, b) => b.score - a.score);
  if (scored[0]?.score > 0 && scored[0].score > (scored[1]?.score || -1)) return scored[0].item;
  return null;
}

export function buildModel(snapshot) {
  if (!Array.isArray(snapshot?.documents) || !Array.isArray(snapshot?.strings)) {
    throw new Error("DOMSnapshot must use official top-level documents/strings schema");
  }
  const doc = snapshot.documents[0];
  const strings = snapshot.strings;
  const parentIndex = doc.nodes?.parentIndex || [];
  const backendNodeId = doc.nodes?.backendNodeId || [];
  const nodeIndexByBackendId = new Map();
  backendNodeId.forEach((id, index) => {
    if (id != null) nodeIndexByBackendId.set(Number(id), index);
  });
  const children = new Map();
  parentIndex.forEach((parent, index) => {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(index);
  });
  const layoutRectByNode = new Map();
  const styleByNode = new Map();
  const layout = doc.layout || {};
  for (let i = 0; i < (layout.nodeIndex?.length || 0); i += 1) {
    layoutRectByNode.set(layout.nodeIndex[i], rectFromBounds(layout.bounds?.[i]));
    styleByNode.set(layout.nodeIndex[i], layout.styles?.[i] || []);
  }
  const model = {
    doc,
    strings,
    parent: (index) => parentIndex[index],
    children: (index) => children.get(index) || [],
    tag: (index) => stringAt(strings, doc.nodes?.nodeName?.[index]).toLowerCase(),
    attrs: (index) => attrsFor(snapshot, doc, strings, index),
    rect: (index) => layoutRectByNode.get(index) || null,
    styles: (index) => styleByNode.get(index) || [],
    controlValue: (index) => controlValueForNode(doc, strings, index),
    nodeIndexForBackendId: (id) => nodeIndexByBackendId.get(Number(id)),
    text: (index, excluded = new Set()) => textFor(model, index, excluded),
    elementIndexes: () => {
      const count = doc.nodes?.nodeName?.length || 0;
      return Array.from({ length: count }, (_, index) => index).filter((index) => isElement(model, index));
    }
  };
  return model;
}

function textFor(model, index, excluded = new Set()) {
  if (excluded.has(index)) return "";
  const tag = model.tag(index);
  if (tag === "#text") return stringAt(model.strings, model.doc.nodes?.nodeValue?.[index]);
  const control = model.controlValue(index);
  if (control.value !== null) return control.value;
  return model.children(index).map((child) => textFor(model, child, excluded)).join("");
}

function controlValueForNode(doc, strings, index) {
  const tag = stringAt(strings, doc.nodes?.nodeName?.[index]).toLowerCase();
  if (tag === "textarea") {
    return { kind: "textarea", source: "DOMSNAPSHOT_TEXT_VALUE", value: rareStringAt(doc.nodes?.textValue, strings, index) };
  }
  if (tag === "input") {
    return { kind: "input", source: "DOMSNAPSHOT_INPUT_VALUE", value: rareStringAt(doc.nodes?.inputValue, strings, index) };
  }
  return { kind: null, source: null, value: null };
}

function rareStringAt(data, strings, nodeIndex) {
  if (!data) return null;
  if (Array.isArray(data)) {
    const value = data[nodeIndex];
    if (value === undefined || value === null || value === -1) return null;
    return stringAt(strings, value);
  }
  if (Array.isArray(data.index) && Array.isArray(data.value)) {
    const position = data.index.indexOf(nodeIndex);
    if (position < 0) return null;
    return stringAt(strings, data.value[position]);
  }
  return null;
}

function attrsFor(_snapshot, doc, strings, index) {
  const attrs = {};
  const raw = doc.nodes?.attributes?.[index] || [];
  for (let i = 0; i < raw.length; i += 2) attrs[stringAt(strings, raw[i])] = stringAt(strings, raw[i + 1]);
  return attrs;
}

function semanticNode(model, index) {
  const attrs = model.attrs(index);
  return {
    tag: normalizeTag(model.tag(index)),
    role: safeAttr(attrs.role),
    dataTestId: safeAttr(attrs["data-testid"]),
    ariaLabel: genericLabel(attrs["aria-label"] || attrs.title || ""),
    contenteditable: safeAttr(attrs.contenteditable),
    micaCopyAction: attrs["data-mica-copy-action"] === "true",
    connectorPill: isConnectorPill(model, index),
    textCategory: textCategory(model.text(index).length),
    textLength: model.text(index).length
  };
}

function turnSummary(model, index, scopeIndex = index) {
  const attrs = model.attrs(index);
  const scopeAttrs = scopeIndex == null ? {} : model.attrs(scopeIndex);
  const stable = scopeAttrs["data-testid"] || attrs["data-testid"] || scopeAttrs["data-message-id"] || attrs["data-message-id"] || `${model.tag(index)}:${index}`;
  return {
    role: safeAttr(attrs["data-message-author-role"]),
    turnHint: `turn:${hashText(stable).slice(0, 12)}`,
    scopeNode: scopeIndex == null ? null : semanticNode(model, scopeIndex),
    rect: roundRect(model.rect(index)),
    textLength: model.text(index).length
  };
}

function turnScopeIndex(model, roleIndex) {
  const scoped = closest(model, roleIndex, (index) => {
    const attrs = model.attrs(index);
    return /^conversation-turn-\d+$/i.test(attrs["data-testid"] || "");
  });
  if (scoped != null) return scoped;
  const section = closest(model, roleIndex, (index) => ["article", "section"].includes(model.tag(index)));
  return section ?? roleIndex;
}

function isButtonLike(model, index) {
  const attrs = model.attrs(index);
  return model.tag(index) === "button" || attrs.role === "button";
}

function isNativeCopyButton(model, index) {
  if (!isButtonLike(model, index)) return false;
  const attrs = model.attrs(index);
  if (attrs["data-mica-copy-action"] === "true") return false;
  const signal = `${attrs["aria-label"] || ""} ${attrs.title || ""} ${attrs["data-testid"] || ""} ${model.text(index) || ""}`;
  return /\bcopy\b|复制/i.test(signal);
}

function findNativeCopyButton(model, assistantTurnIndex, axTree = null) {
  const axMatch = findNativeCopyButtonFromAx(model, assistantTurnIndex, axTree);
  if (axMatch) return axMatch;
  const buttonNodes = descendants(model, assistantTurnIndex).filter((index) => isButtonLike(model, index));
  const nodeIndex = buttonNodes.find((index) => isNativeCopyButton(model, index));
  return nodeIndex == null ? null : { nodeIndex, source: "DOM_TEXT_OR_ATTRIBUTE" };
}

function findNativeCopyButtonFromAx(model, assistantTurnIndex, axTree = null) {
  const nodes = Array.isArray(axTree?.nodes) ? axTree.nodes : [];
  for (const axNode of nodes) {
    const name = axValue(axNode?.name);
    if (!isCopyAccessibleName(name)) continue;
    const role = axValue(axNode?.role);
    if (role && !/button|menuitem/i.test(role)) continue;
    const mappedNode = model.nodeIndexForBackendId(axNode.backendDOMNodeId);
    if (mappedNode == null) continue;
    const buttonNode = closest(model, mappedNode, (index) => isButtonLike(model, index)) ?? mappedNode;
    if (!isButtonLike(model, buttonNode)) continue;
    if (!isDescendantOrSelf(model, assistantTurnIndex, buttonNode)) continue;
    if (model.attrs(buttonNode)["data-mica-copy-action"] === "true") continue;
    return { nodeIndex: buttonNode, source: "ACCESSIBILITY+BACKEND_NODE", accessibleName: genericLabel(name) };
  }
  return null;
}

function findActionCluster(model, assistantTurnIndex, nativeCopyIndex) {
  let current = model.parent(nativeCopyIndex);
  while (current != null && current >= 0 && current !== assistantTurnIndex && isDescendantOrSelf(model, assistantTurnIndex, current)) {
    const children = model.children(current).filter((index) => isElement(model, index));
    const actionChildren = children.filter((index) => isButtonLike(model, index) || hasButtonDescendant(model, index));
    const ownsNativeCopy = isDescendantOrSelf(model, current, nativeCopyIndex);
    if (ownsNativeCopy && actionChildren.length >= 2) return current;
    current = model.parent(current);
  }
  return model.parent(nativeCopyIndex);
}

function findMicaCopyButton(model, assistantTurnIndex, nativeCopyIndex, actionClusterIndex = null) {
  const candidates = model.elementIndexes().filter((index) => {
    const attrs = model.attrs(index);
    return attrs["data-mica-copy-action"] === "true" && isButtonLike(model, index);
  });
  if (candidates.length === 0) return null;
  const nativeParent = model.parent(nativeCopyIndex);
  const sameParent = candidates.find((index) => model.parent(index) === nativeParent);
  if (sameParent != null) return sameParent;
  if (actionClusterIndex != null) {
    const insideCluster = candidates.find((index) => isDescendantOrSelf(model, actionClusterIndex, index));
    if (insideCluster != null) return insideCluster;
  }
  const insideAssistant = candidates.find((index) => isDescendantOrSelf(model, assistantTurnIndex, index));
  if (insideAssistant != null) return insideAssistant;
  return nearestByRect(model, nativeCopyIndex, candidates);
}

function nearestByRect(model, anchorIndex, candidates) {
  const anchor = model.rect(anchorIndex);
  if (!anchor) return candidates[0] ?? null;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const rect = model.rect(candidate);
    if (!rect) continue;
    const distance = Math.hypot((rect.x + rect.width / 2) - (anchor.x + anchor.width / 2), (rect.y + rect.height / 2) - (anchor.y + anchor.height / 2));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ?? candidates[0] ?? null;
}

function hasButtonDescendant(model, nodeIndex) {
  return descendants(model, nodeIndex).some((index) => isButtonLike(model, index));
}

function isDescendantOrSelf(model, ancestor, nodeIndex) {
  let current = nodeIndex;
  while (current != null && current >= 0) {
    if (current === ancestor) return true;
    current = model.parent(current);
  }
  return false;
}

function isCopyAccessibleName(value) {
  const text = String(value || "").trim();
  return /^copy(\b|\s|$)/i.test(text) || text.includes("复制");
}

function axValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value.value === "string") return value.value;
  if (typeof value.value === "number") return String(value.value);
  return "";
}

function isConnectorPill(model, index) {
  const attrs = model.attrs(index);
  return attrs["data-inline-selection-pill"] !== undefined || /^plugin:/.test(attrs["data-id"] || "") || /^plugin:/.test(attrs["data-system-hint-type"] || "");
}

function isInsideMica(model, index) {
  return !!closest(model, index, (current) => {
    const attrs = model.attrs(current);
    return attrs["data-mica-root"] === "true" || attrs["data-mica-copy-action"] === "true" || attrs["data-mica-composer-diagnostics-root"] === "true";
  });
}

function descendants(model, rootIndex) {
  const out = [];
  const queue = model.children(rootIndex).slice();
  while (queue.length) {
    const index = queue.shift();
    out.push(index);
    queue.push(...model.children(index));
  }
  return out;
}

function chain(model, index, max) {
  const out = [];
  let current = index;
  while (current != null && current >= 0 && out.length < max) {
    out.push(current);
    current = model.parent(current);
  }
  return out;
}

function closest(model, index, predicate) {
  let current = index;
  while (current != null && current >= 0) {
    if (predicate(current)) return current;
    current = model.parent(current);
  }
  return null;
}

function lastByDocumentOrder(items) {
  return items.length ? items[items.length - 1] : null;
}

function sanitizedStyles(model, index) {
  const out = {};
  const raw = model.styles(index);
  raw.forEach((stringIndex, i) => {
    const key = STYLE_PROBE[i];
    const value = stringAt(model.strings, stringIndex);
    if (key && value && value.length <= 80 && !/url\(|https?:|data:|file:/i.test(value)) out[key] = value;
  });
  return out;
}

function sanitizeTarget(target) {
  let parsed = null;
  try { parsed = new URL(target.url); } catch (_error) {}
  return {
    type: target.type,
    titleLength: String(target.title || "").length,
    hostname: parsed?.hostname || null,
    pathShape: parsed ? sanitizePathShape(parsed.pathname) : null,
    targetHash: hashText(target.url).slice(0, 24)
  };
}

function sanitizePathShape(pathname) {
  const segments = String(pathname || "").split("/").filter(Boolean);
  return `/${segments.map((segment, index) => {
    const previous = segments[index - 1];
    if (previous === "c") return "<conversation-id>";
    if (previous === "g") return "<gpt-id>";
    if (previous === "project") return "<project-id>";
    if (/^[0-9a-f-]{12,}$/i.test(segment) || /^g-[a-z0-9_-]+/i.test(segment)) return "<id>";
    return segment;
  }).join("/")}`;
}

function sanitizeLayout(layout) {
  return {
    cssVisualViewport: pickNumbers(layout?.cssVisualViewport, ["clientWidth", "clientHeight", "pageX", "pageY", "zoom"]),
    cssLayoutViewport: pickNumbers(layout?.cssLayoutViewport, ["clientWidth", "clientHeight", "pageX", "pageY"]),
    cssContentSize: pickNumbers(layout?.cssContentSize, ["width", "height"])
  };
}

function pickNumbers(source, keys) {
  if (!source) return null;
  const out = {};
  for (const key of keys) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function isElement(model, index) {
  const tag = model.tag(index);
  return tag && tag !== "#text" && tag !== "#comment" && tag !== "#document";
}

function canonicalize(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim();
}

function hashText(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function rectFromBounds(rect) {
  if (!Array.isArray(rect) || rect.length < 4) return null;
  const out = { x: Number(rect[0]), y: Number(rect[1]), width: Number(rect[2]), height: Number(rect[3]) };
  return Object.values(out).every(Number.isFinite) ? out : null;
}

function roundRect(rect) {
  if (!rect) return null;
  return {
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10
  };
}

function textCategory(length) {
  return length === 0 ? "empty" : length < 64 ? "short" : length < 512 ? "medium" : "long";
}

function genericLabel(value) {
  const text = String(value || "");
  if (isCopyAccessibleName(text)) return "Copy";
  if (/regenerate|重新生成/i.test(text)) return "Regenerate";
  if (/retry|重试/i.test(text)) return "Retry";
  if (/like|thumbs up|赞/i.test(text)) return "Like";
  if (/dislike|thumbs down|踩/i.test(text)) return "Dislike";
  if (/copy as markdown with mica|mica copy/i.test(text)) return "Mica Copy";
  return text ? `label-length-${text.length}` : null;
}

function safeAttr(value) {
  const text = String(value || "");
  if (!text) return null;
  return /^[a-zA-Z0-9:_ -]{1,80}$/.test(text) ? text : `attr-length-${text.length}`;
}

function normalizeTag(tag) {
  return /^[a-z0-9-]{1,40}$/.test(tag) ? tag : "div";
}

function stringAt(strings, index) {
  return typeof index === "number" ? String(strings[index] || "") : String(index || "");
}

function isChatGptConversationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chatgpt.com" && /\/c\/[A-Za-z0-9_-]+/.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [key, inline] = arg.split("=", 2);
    const value = inline ?? argv[i + 1];
    if (inline === undefined && key.startsWith("--")) i += 1;
    if (key === "--thread-url") out.threadUrl = value;
    else if (key === "--user-data-dir") out.userDataDir = value;
    else if (key === "--out") out.out = value;
    else if (key === "--contract-out") out.contractOut = value;
    else if (key === "--from-raw") out.fromRaw = value;
    else if (key === "--list-targets") {
      out.listTargets = true;
      if (inline === undefined) i -= 1;
    }
  }
  return out;
}

function readmeForContract(contract) {
  return `# Real Live Failure Contract

This contract is sanitized evidence from a one-shot read-only DevToolsActivePort probe of the already-failed live ChatGPT acceptance page.

- Raw DOM/text evidence remains only under local \`artifacts/live-failure/\`.
- This committed pack may contain lengths, anonymous hashes, geometry, generic labels, and structural invariants.
- It is intended to reproduce the native action-bar placement failure and long connector send residual failure offline.

Target hash: \`${contract.target.targetHash}\`
Action bar ground truth: \`${groundTruthStatus(contract.actionBar)}\`
Native Copy source: \`${contract.actionBar.nativeCopy?.source ?? "missing"}\`
Native Copy parent chain: \`${Array.isArray(contract.actionBar.nativeCopyParentChain) && contract.actionBar.nativeCopyParentChain.length > 0 ? "present" : "missing"}\`
Action cluster sibling order: \`${Array.isArray(contract.actionBar.actionCluster?.siblingOrder) && contract.actionBar.actionCluster.siblingOrder.length > 0 ? "present" : "missing"}\`
Stale composer ground truth: \`${groundTruthStatus(contract.staleComposer)}\`
Composer value source: \`${contract.staleComposer.composerValueSource ?? "missing"}\`
Composer residual equals latest user turn: \`${contract.staleComposer.samePayloadAsLatestUserTurn}\`
Mica Copy adjacent to native Copy: \`${contract.actionBar.micaCopy?.adjacentToNativeCopy ?? "missing"}\`
`;
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sendWithTimeout(client, method, params = {}, options = {}, timeoutMs = 8000) {
  let timer = null;
  return Promise.race([
    client.send(method, params, options),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function withTimeout(promise, label, timeoutMs = 8000) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function progress(message) {
  console.error(`[probe:live-failure] ${message}`);
}
