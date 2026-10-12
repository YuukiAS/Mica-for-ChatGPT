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

const PLACEMENT_PROOF_OBSERVATION_IDS = [
  "copy-inside-assistant-turn",
  "action-cluster-parent",
  "copy-sibling-insertion",
  "visible-size-baseline"
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const commit = valueAfter(process.argv.slice(2), "--commit");
const profile = valueAfter(process.argv.slice(2), "--profile") || "foundation";
if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("--commit must be a full lowercase SHA-1");
if (!["foundation", "milestone-a"].includes(profile)) throw new Error("--profile must be foundation or milestone-a");

const bundleDir = path.join(repoRoot, "results", "mica-product-system-rebuild", profile === "foundation" ? "foundation-candidate" : "low-memory-candidate", commit);
await mkdir(path.join(bundleDir, "artifacts"), { recursive: true });
const distDir = path.join(repoRoot, "dist", DEV_DIST_DIR_NAME);
const evidenceDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "foundation-evidence");
const popupDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "foundation-popup");
const lowMemoryDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "low-memory-evidence");

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
if (profile === "milestone-a") {
  copies.push(
    [path.join(lowMemoryDir, "low-memory-pressure.json"), "low-memory-pressure.json"],
    [path.join(lowMemoryDir, "low-memory-fixture.json"), "low-memory-fixture.json"],
    [path.join(lowMemoryDir, "low-memory-page-interception.json"), "low-memory-page.json"],
    [path.join(lowMemoryDir, "low-memory-stress.json"), "low-memory-stress.json"],
    [path.join(lowMemoryDir, "low-memory-registration.json"), "low-memory-registration.json"],
    [path.join(popupDir, "exact-low-memory-active-light-368-100.png"), "popup-low-memory-active.png"],
    [path.join(popupDir, "exact-low-memory-restore-required-light-368-100.png"), "popup-low-memory-restore-required.png"],
    [path.join(popupDir, "exact-low-memory-full-history-bypass-dark-368-100.png"), "popup-low-memory-full-history-bypass.png"]
  );
}
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
if (profile === "milestone-a") {
  artifactDefinitions.push(
    ["low-memory-pressure", "low-memory-pressure.json", "application/json"],
    ["low-memory-fixture", "low-memory-fixture.json", "application/json"],
    ["low-memory-page", "low-memory-page.json", "application/json"],
    ["low-memory-stress", "low-memory-stress.json", "application/json"],
    ["low-memory-registration", "low-memory-registration.json", "application/json"],
    ["popup-low-memory-active", "popup-low-memory-active.png", "image/png"],
    ["popup-low-memory-restore-required", "popup-low-memory-restore-required.png", "image/png"],
    ["popup-low-memory-full-history-bypass", "popup-low-memory-full-history-bypass.png", "image/png"]
  );
}
const artifacts = [];
for (const [id, filename, kind] of artifactDefinitions) {
  const relative = `artifacts/${filename}`;
  artifacts.push({ id, path: relative, kind, sha256: await sha256File(path.join(bundleDir, relative)) });
}
const artifactHash = (id) => artifacts.find((artifact) => artifact.id === id).sha256;
const contract = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "chatgpt-contract.json"), "utf8"));
const bootstrap = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "current-chatgpt-bootstrap.json"), "utf8"));
const popupEvidence = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "popup-render.json"), "utf8"));
const foundationCore = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "foundation-core.json"), "utf8"));
const foundationFlows = JSON.parse(await readFile(path.join(bundleDir, "artifacts", "foundation-flows.json"), "utf8"));
const lowMemoryPressure = profile === "milestone-a" ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-pressure.json"), "utf8")) : null;
const lowMemoryFixture = profile === "milestone-a" ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-fixture.json"), "utf8")) : null;
const lowMemoryPage = profile === "milestone-a" ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-page.json"), "utf8")) : null;
const lowMemoryStress = profile === "milestone-a" ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-stress.json"), "utf8")) : null;
const lowMemoryRegistration = profile === "milestone-a" ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-registration.json"), "utf8")) : null;
const contractHash = artifactHash("chatgpt-contract");
const bootstrapHash = artifactHash("current-chatgpt-bootstrap");
const distHash = artifactHash("dist-tree");
const actionClusterContract = contract.capabilities?.find((item) => item.capabilityId === "answer.actionCluster");
const actionClusterSource = bootstrap.capabilities?.find((item) => item.id === actionClusterContract?.sourceCapabilityId);
const actionClusterObservationIds = actionClusterContract?.requiredSourceObservationIds || [];
const placementProven = actionClusterContract?.status === "EXACT" && sameSet(actionClusterObservationIds, PLACEMENT_PROOF_OBSERVATION_IDS) && actionClusterObservationIds.every((id) => {
  const observation = actionClusterSource?.observations?.find((item) => item.id === id);
  return observation && bootstrapObservationPasses(bootstrap, observation);
});
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
if (profile === "milestone-a") requiredGates.splice(requiredGates.indexOf("privacy"), 0, "low-memory-benefit");

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
    capabilities: contract.capabilities.map((capability) => {
      const sourceCapability = bootstrap.capabilities?.find((item) => item.id === capability.sourceCapabilityId);
      const requiredSourceObservationIds = capability.requiredSourceObservationIds || [];
      const observedInvariants = requiredSourceObservationIds.filter((id) => {
        const observation = sourceCapability?.observations?.find((item) => item.id === id);
        return observation && bootstrapObservationPasses(bootstrap, observation);
      });
      return {
        capabilityId: capability.capabilityId,
        sourceCapabilityId: capability.sourceCapabilityId,
        sourceEvidenceClass: capability.sourceEvidenceClass,
        requiredSourceObservationIds,
        variantId: capability.variantId,
        status: capability.status,
        requiredInvariants: capability.requiredInvariants || [],
        observedInvariants,
        contractHash,
        sourceArtifactHash: bootstrapHash,
        invalidatedBy: [],
        failOpen: capability.status === "UNKNOWN"
      };
    })
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
    capabilityStatus: actionClusterContract?.status || "UNKNOWN",
    placementProven,
    exactAssistantTurn: placementProven,
    clusterProven: placementProven,
    siblingRelationship: placementProven,
    visibleBaseline: placementProven,
    failOpen: !placementProven
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
if (profile === "milestone-a") {
  evidence.splice(evidence.findIndex((item) => item.gateId === "privacy"), 0,
    record("low-memory-benefit", "TARGET_LOW_MEMORY_DEVICE", { surface: "target-low-memory-device" }, ["dist-tree", "low-memory-pressure", "low-memory-fixture", "low-memory-page", "low-memory-stress", "low-memory-registration", "foundation-flows", "popup-low-memory-active", "popup-low-memory-restore-required", "popup-low-memory-full-history-bypass"], {
      A: lowMemoryPressure.A,
      B: lowMemoryPressure.B,
      C: lowMemoryPressure.C,
      recentTurnLimit: lowMemoryPressure.recentTurnLimit,
      threadProfiles: lowMemoryFixture.profiles,
      pressureFixture: lowMemoryPressure.pressureFixture,
      targetDevice: lowMemoryPressure.targetDevice,
      actualTruncation: lowMemoryPressure.actualTruncation,
      truncatedRepresentation: lowMemoryPressure.truncatedRepresentation,
      reactManagedInteractiveNodesDetached: lowMemoryPressure.reactManagedInteractiveNodesDetached,
      serverMutation: lowMemoryPressure.serverMutation,
      history: lowMemoryPage.history,
      registration: {
        firstInstall: lowMemoryRegistration.firstInstall?.registered === true,
        storageFailureFailOpen: lowMemoryRegistration.storageFailure?.registered === false,
        siteWritableConfigAccepted: lowMemoryRegistration.siteWritableConfigAccepted === true,
        forgedPageEventIgnored: lowMemoryPage.forgedPageConfig?.mappingNodes === lowMemoryPage.firstInstall?.mappingNodes
      },
      stress: {
        passed: lowMemoryStress.passed,
        loops: lowMemoryStress.loops,
        runs: lowMemoryStress.runs,
        results: lowMemoryStress.results
      },
      coreFlows: {
        composer: foundationFlows.coreFlows?.composer === true,
        send: foundationFlows.coreFlows?.send === true,
        streaming: foundationFlows.coreFlows?.streaming === true,
        editBranch: foundationFlows.coreFlows?.editBranch === true,
        connector: foundationFlows.coreFlows?.connector === true,
        toolFileAuth: foundationFlows.coreFlows?.toolFileAuth === true,
        typingImeHotPath: foundationFlows.coreFlows?.typingImeHotPath === true
      },
      unknownStructureBehavior: Object.entries(lowMemoryFixture.failOpen || {}).every(([key, value]) => key.endsWith("Changed") ? value === false : key.endsWith("Unchanged") ? value === true : true) ? "FAIL_OPEN" : "FAILED"
    })
  );
}

const manifest = {
  schemaVersion: 1,
  bundleKind: "candidate",
  acceptanceProfile: profile,
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

function bootstrapObservationPasses(bootstrap, observation) {
  return Array.isArray(observation?.assertions) && observation.assertions.length > 0 && observation.assertions.every((assertion) => {
    const surface = bootstrap.surfaces?.find((item) => item.id === assertion.surfaceId);
    return surface && surface.evidenceClass && surface.evidenceClass !== "NONE" && sameJson(readPath(surface, assertion.path), assertion.equals);
  });
}

function readPath(value, dottedPath) {
  return String(dottedPath || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((value) => actual.includes(value));
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
