import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(root, "tests", "contracts", "chatgpt-live", "real-live-failure-2026-09-13", "live-failure-contract.json");
const contract = JSON.parse(await readFile(contractPath, "utf8"));
const serialized = JSON.stringify(contract);

assert.equal(contract.kind, "mica.chatgptLiveFailure.contract");
assert.equal(contract.actionBar?.groundTruth, "EXACT");
assert.equal(contract.actionBar?.nativeCopy?.source, "ACCESSIBILITY+BACKEND_NODE");
assert.ok(Array.isArray(contract.actionBar?.nativeCopyParentChain) && contract.actionBar.nativeCopyParentChain.length > 0);
assert.ok(Array.isArray(contract.actionBar?.actionCluster?.siblingOrder) && contract.actionBar.actionCluster.siblingOrder.length > 0);
assert.equal(contract.actionBar?.micaCopy?.sameParentAsNativeCopy, false);
assert.equal(contract.actionBar?.micaCopy?.adjacentToNativeCopy, false);
assert.equal(contract.actionBar?.micaCopy?.detachedFromNativeCluster, true);
assert.equal(contract.actionBar?.expectedPlacementInvariant?.micaCopySameParentAsNativeCopy, true);
assert.equal(contract.actionBar?.expectedPlacementInvariant?.micaCopyAdjacentToNativeCopy, true);
assert.equal(contract.staleComposer?.groundTruth, "EXACT");
assert.equal(contract.staleComposer?.composerControlKind, "textarea");
assert.equal(contract.staleComposer?.composerValueSource, "DOMSNAPSHOT_TEXT_VALUE");
assert.equal(contract.staleComposer?.samePayloadAsLatestUserTurn, false);
assert.equal(contract.staleComposer?.bodyLength, 0);
assert.ok((contract.staleComposer?.latestCommittedUserTurn?.textLength || 0) > 0);
assert.equal(contract.privacy?.rawDomIncluded, false);
assert.equal(contract.privacy?.promptTextIncluded, false);
assert.equal(contract.privacy?.answerTextIncluded, false);
assert.equal(contract.safety?.automatedSend, false);
assert.equal(contract.safety?.automatedEnter, false);
assert.equal(contract.safety?.automatedUpload, false);
assert.equal(contract.safety?.automatedConnectorAction, false);
assert.equal(serialized.includes("https://chatgpt.com"), false);
assert.equal(serialized.includes("/devtools/"), false);

console.log(JSON.stringify({
  passed: true,
  actionBarGroundTruth: contract.actionBar.groundTruth,
  nativeCopySource: contract.actionBar.nativeCopy.source,
  micaCopyDetached: contract.actionBar.micaCopy.detachedFromNativeCluster,
  staleComposerGroundTruth: contract.staleComposer.groundTruth,
  composerValueSource: contract.staleComposer.composerValueSource,
  samePayloadAsLatestUserTurn: contract.staleComposer.samePayloadAsLatestUserTurn,
  automatedSend: false,
  automatedEnter: false,
  automatedUpload: false,
  automatedConnectorAction: false
}, null, 2));
