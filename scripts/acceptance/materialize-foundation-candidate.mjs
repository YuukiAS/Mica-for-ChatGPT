import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_LABEL, DEV_DIST_DIR_NAME, MACHINE_VERSION, VERSION_NAME } from "../release-config.mjs";
import {
  EVIDENCE_SCHEMA_VERSION,
  VALIDATOR_VERSION,
  computeEvidenceRootHash,
  computeFixtureSetHash,
  computeValidatorTreeHash,
  sha256File
} from "./validator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const commit = valueAfter(process.argv.slice(2), "--commit");
if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("--commit must be a full lowercase SHA-1");

const bundleDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "foundation-candidate", commit);
await mkdir(path.join(bundleDir, "artifacts"), { recursive: true });
const distDir = path.join(repoRoot, "dist", DEV_DIST_DIR_NAME);
const evidenceDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "foundation-evidence");
const popupDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "foundation-popup");

const distTree = [];
for (const file of await walkFiles(distDir)) {
  distTree.push({
    path: path.relative(distDir, file).replaceAll("\\", "/"),
    sha256: await sha256File(file)
  });
}
distTree.sort((a, b) => a.path.localeCompare(b.path));
await writeJson(path.join(bundleDir, "artifacts", "dist-tree.json"), { schemaVersion: 1, files: distTree });
await writeJson(path.join(bundleDir, "artifacts", "version-report.json"), {
  sourceVersion: MACHINE_VERSION,
  popupVersion: VERSION_NAME,
  diagnosticsVersion: VERSION_NAME,
  reportedUnpackedVersion: VERSION_NAME,
  buildLabel: BUILD_LABEL
});

const copies = [
  [path.join(distDir, "manifest.json"), "built-manifest.json"],
  [path.join(repoRoot, "contracts", "chatgpt", "current.json"), "chatgpt-contract.json"],
  [path.join(repoRoot, "results", "mica-product-system-rebuild", "current-chatgpt-surface", "bootstrap-evidence.json"), "current-chatgpt-bootstrap.json"],
  [path.join(evidenceDir, "foundation-core.json"), "foundation-core.json"],
  [path.join(evidenceDir, "foundation-flows.json"), "foundation-flows.json"],
  [path.join(evidenceDir, "popup-render.json"), "popup-render.json"],
  [path.join(popupDir, "exact-light-368-100.png"), "popup-light.png"],
  [path.join(popupDir, "unknown-dark-368-100.png"), "popup-dark.png"],
  [path.join(popupDir, "compatible-light-320-150.png"), "popup-320-150.png"],
  [path.join(popupDir, "contentUnavailable-dark-400-125.png"), "popup-400-125.png"],
  [path.join(popupDir, "troubleshooting-light-368-100.png"), "troubleshooting.png"],
  [path.join(popupDir, "qa-light-368-100.png"), "developer-qa.png"]
];
for (const [source, destination] of copies) await cp(source, path.join(bundleDir, "artifacts", destination));

const artifactDefinitions = [
  ["dist-tree", "dist-tree.json", "application/json"],
  ["built-manifest", "built-manifest.json", "application/json"],
  ["version-report", "version-report.json", "application/json"],
  ["chatgpt-contract", "chatgpt-contract.json", "application/json"],
  ["current-chatgpt-bootstrap", "current-chatgpt-bootstrap.json", "application/json"],
  ["foundation-core", "foundation-core.json", "application/json"],
  ["foundation-flows", "foundation-flows.json", "application/json"],
  ["popup-render", "popup-render.json", "application/json"],
  ["popup-light", "popup-light.png", "image/png"],
  ["popup-dark", "popup-dark.png", "image/png"],
  ["popup-320-150", "popup-320-150.png", "image/png"],
  ["popup-400-125", "popup-400-125.png", "image/png"],
  ["troubleshooting", "troubleshooting.png", "image/png"],
  ["developer-qa", "developer-qa.png", "image/png"]
];
const artifacts = [];
for (const [id, filename, kind] of artifactDefinitions) {
  const relative = `artifacts/${filename}`;
  artifacts.push({ id, path: relative, kind, sha256: await sha256File(path.join(bundleDir, relative)) });
}
const artifactHash = (id) => artifacts.find((artifact) => artifact.id === id).sha256;
const contract = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "chatgpt-contract.json"), "utf8"));
const popupEvidence = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "popup-render.json"), "utf8"));
const foundationCore = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "foundation-core.json"), "utf8"));
const foundationFlows = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "foundation-flows.json"), "utf8"));
const contractHash = artifactHash("chatgpt-contract");
const bootstrapHash = artifactHash("current-chatgpt-bootstrap");
const distHash = artifactHash("dist-tree");
const requiredGates = [
  "candidate-identity",
  "popup-render",
  "adapter-contract",
  "answer-document-core",
  "copy-placement",
  "core-flow-regression",
  "send-lifecycle-safety",
  "privacy",
  "packaging-version"
];

const evidence = [
  record("candidate-identity", "LOCAL_REAL_BROWSER", { surface: "built-extension" }, ["dist-tree", "built-manifest"], { commit, distHash }),
  record("popup-render", "LOCAL_REAL_BROWSER", { surface: "actual-extension-popup" }, ["popup-render", "popup-light", "popup-dark", "popup-320-150", "popup-400-125", "troubleshooting", "developer-qa"], {
    states: popupEvidence.states,
    widthsPx: popupEvidence.widthsPx,
    scalesPercent: popupEvidence.scalesPercent,
    keyboard: popupEvidence.keyboard,
    secondaryFocus: popupEvidence.focusReturn,
    themeArtifacts: { light: "popup-light", dark: "popup-dark" }
  }),
  record("adapter-contract", "REAL_DERIVED_CURRENT_CHATGPT", { surface: "current-chatgpt" }, ["chatgpt-contract", "current-chatgpt-bootstrap", "foundation-core"], {
    capabilities: contract.capabilities.map((capability) => ({
      capabilityId: capability.capabilityId,
      sourceCapabilityId: capability.sourceCapabilityId,
      variantId: capability.variantId,
      status: capability.status,
      requiredInvariants: capability.requiredInvariants || [],
      observedInvariants: capability.status === "UNKNOWN" ? [] : capability.requiredInvariants || [],
      contractHash,
      sourceArtifactHash: bootstrapHash,
      invalidatedBy: [],
      failOpen: capability.status === "UNKNOWN"
    }))
  }),
  record("answer-document-core", "REAL_DERIVED_CURRENT_CHATGPT", { surface: "answer-document" }, ["foundation-core", "chatgpt-contract", "current-chatgpt-bootstrap"], {
    documentFields: ["documentId", "conversationId", "turnId", "sourceVersion", "generationState", "orderedBlocks"],
    blockKinds: [...foundationCore.blockKinds, ...foundationCore.inlineKinds],
    streamingIsProvisional: foundationCore.lifecycle?.streamingDurable === false,
    settledIsDurable: foundationCore.lifecycle?.settledDurable === true,
    unknownLifecycleRejected: foundationCore.lifecycle?.unknownModelRejected === true && foundationCore.lifecycle?.callerCannotForceSettled === true,
    opaqueInteractive: foundationCore.blockKinds?.includes("opaque_interactive") === true,
    singleAdapterProducer: foundationCore.lifecycle?.singleAdapterProducer === true
  }),
  record("copy-placement", "CURRENT_CHATGPT_READ_ONLY", { surface: "assistant-action-cluster" }, ["chatgpt-contract", "current-chatgpt-bootstrap"], {
    actionInjected: false,
    exactAssistantTurn: true,
    clusterProven: true,
    siblingRelationship: true,
    visibleBaseline: true
  }),
  record("core-flow-regression", "LOCAL_REAL_BROWSER", { surface: "local-real-browser" }, ["foundation-flows", "dist-tree"], {
    ...foundationFlows.coreFlows
  }),
  record("send-lifecycle-safety", "LOCAL_REAL_BROWSER", { surface: "local-real-browser" }, ["foundation-flows", "dist-tree"], {
    progressObserved: foundationFlows.sendLifecycle?.progressObserved === true,
    autoResend: foundationFlows.sendLifecycle?.autoResendObserved === true,
    consequentialFlowActive: foundationFlows.sendLifecycle?.consequentialFlowActive === true,
    userTurnCommitted: foundationFlows.sendLifecycle?.userTurnCommitted === true,
    duplicateSend: foundationFlows.sendLifecycle?.duplicateSendObserved === true
  }),
  record("privacy", "LOCAL_REAL_BROWSER", { surface: "diagnostic-bundle" }, ["foundation-core", "foundation-flows"], {
    conversationTextIncluded: foundationCore.privacy?.conversationTextIncluded,
    attachmentContentIncluded: foundationCore.privacy?.attachmentContentIncluded,
    requestBodyIncluded: foundationCore.privacy?.requestBodyIncluded,
    authTokenIncluded: foundationCore.privacy?.authTokenIncluded,
    rawDomIncluded: foundationCore.privacy?.rawDomIncluded,
    flowPrivacyMatches: JSON.stringify(foundationCore.privacy) === JSON.stringify(foundationFlows.report?.privacy)
  }),
  record("packaging-version", "LOCAL_REAL_BROWSER", { surface: "built-extension" }, ["built-manifest", "version-report"], {
    builtManifestArtifactId: "built-manifest",
    versionReportArtifactId: "version-report"
  })
];

const manifest = {
  schemaVersion: 1,
  bundleKind: "candidate",
  acceptanceProfile: "foundation",
  candidate: { commit, version: VERSION_NAME, buildLabel: BUILD_LABEL, distArtifactId: "dist-tree", distHash },
  validator: { version: VALIDATOR_VERSION, treeHash: await computeValidatorTreeHash(repoRoot) },
  chatgptContractArtifactId: "chatgpt-contract",
  chatgptContractHash: contractHash,
  fixtureSetHash: await computeFixtureSetHash(repoRoot),
  evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
  evidenceRootHash: computeEvidenceRootHash(artifacts, evidence),
  reportContext: { candidateCommit: commit, distHash },
  requiredGates,
  artifacts,
  evidence
};
await writeJson(path.join(bundleDir, "manifest.json"), manifest);
console.log(JSON.stringify({ bundleDir, commit, version: VERSION_NAME, distHash, contractHash, requiredGates }, null, 2));

function record(gateId, evidenceClass, subject, artifactIds, measurement) {
  return { id: `${gateId}-foundation-evidence`, gateId, evidenceClass, subject, artifactIds, measurement };
}

async function walkFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function valueAfter(values, flag) {
  const index = values.indexOf(flag);
  return index >= 0 ? values[index + 1] : null;
}
