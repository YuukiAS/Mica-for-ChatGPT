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
  deriveInstalledExtensionMeasurement,
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
if (!["foundation", "milestone-a", "milestone-b", "release-0.3.0", "functional-convergence"].includes(profile)) throw new Error("--profile must be foundation, milestone-a, milestone-b, release-0.3.0, or functional-convergence");

const bundleKind = profile === "foundation" ? "foundation-candidate"
  : profile === "milestone-a" ? "low-memory-candidate"
    : profile === "milestone-b" ? "highlight-pdf-candidate"
      : profile === "functional-convergence" ? "functional-convergence-candidate"
        : "release-candidate";
const includesLowMemory = profile !== "foundation";
const includesHighlightPdf = profile === "milestone-b" || profile === "release-0.3.0" || profile === "functional-convergence";
const includesFunctionalConvergence = profile === "functional-convergence";
const bundleDir = path.join(repoRoot, "results", "mica-product-system-rebuild", bundleKind, commit);
await mkdir(path.join(bundleDir, "artifacts"), { recursive: true });
const distDir = path.join(repoRoot, "dist", DEV_DIST_DIR_NAME);
const evidenceDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "foundation-evidence");
const popupDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "foundation-popup");
const lowMemoryDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "low-memory-evidence");
const highlighterDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "highlighter-evidence");
const pdfDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "pdf-evidence");
const convergenceDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "convergence-evidence");
const fullExtensionDir = path.join(repoRoot, "results", "mica-product-system-rebuild", "full-extension-evidence");

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
if (includesLowMemory) {
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
if (includesHighlightPdf) {
  copies.push(
    [path.join(highlighterDir, "highlighter-fixture.json"), "highlighter-fixture.json"],
    [path.join(highlighterDir, "highlighter-stress.json"), "highlighter-stress.json"],
    [path.join(highlighterDir, "highlighter-selection-light.png"), "highlighter-selection-light.png"],
    [path.join(highlighterDir, "highlighter-active-light.png"), "highlighter-active-light.png"],
    [path.join(highlighterDir, "highlighter-edit-dark.png"), "highlighter-edit-dark.png"],
    [path.join(repoRoot, "output", "pdf", "mica-answer-export-sample.pdf"), "mica-answer-export-sample.pdf"],
    [path.join(pdfDir, "pdf-export-fixture.json"), "pdf-export-fixture.json"],
    [path.join(pdfDir, "pdf-background.json"), "pdf-background.json"],
    [path.join(pdfDir, "pdf-render-1.png"), "pdf-render-1.png"],
    [path.join(pdfDir, "pdf-render-2.png"), "pdf-render-2.png"],
    [path.join(pdfDir, "pdf-export-preview.png"), "pdf-export-preview.png"],
    [path.join(pdfDir, "pdfjs-pointer-selection.png"), "pdfjs-pointer-selection.png"],
    [path.join(pdfDir, "pdfjs-display-math-selection.png"), "pdfjs-display-math-selection.png"],
    [path.join(fullExtensionDir, "extension-install-smoke.json"), "extension-install-smoke.json"],
    [path.join(fullExtensionDir, "full-extension-e2e.json"), "full-extension-e2e.json"],
    [path.join(lowMemoryDir, "low-memory-extension-lifecycle.json"), "low-memory-extension-lifecycle.json"],
    [path.join(repoRoot, "tests", "mica-extension-visual-baseline.json"), "extension-visual-baseline.json"],
    [path.join(fullExtensionDir, "installed-extension-answer.png"), "installed-extension-answer.png"],
    [path.join(fullExtensionDir, "options-light.png"), "extension-options-light.png"],
    [path.join(fullExtensionDir, "highlights-light.png"), "extension-highlights-light.png"],
    [path.join(fullExtensionDir, "highlights-dark.png"), "extension-highlights-dark.png"],
    [path.join(fullExtensionDir, "popup-320-light.png"), "extension-popup-320-light.png"],
    [path.join(fullExtensionDir, "popup-368-dark.png"), "extension-popup-368-dark.png"],
    [path.join(fullExtensionDir, "popup-400-light.png"), "extension-popup-400-light.png"],
    [path.join(repoRoot, "output", "pdf", "mica-full-extension-export.pdf"), "mica-full-extension-export.pdf"]
  );
}
if (includesFunctionalConvergence) {
  copies.push(
    [path.join(convergenceDir, "conversation-export.json"), "conversation-export.json"],
    [path.join(convergenceDir, "recovery-ledger.json"), "recovery-ledger.json"],
    [path.join(convergenceDir, "recovery-actions.json"), "recovery-actions.json"],
    [path.join(convergenceDir, "target-surface-backend.json"), "target-surface-backend.json"],
    [path.join(convergenceDir, "highlight-record-integrity.json"), "highlight-record-integrity.json"],
    [path.join(convergenceDir, "local-import-integrity.json"), "local-import-integrity.json"],
    [path.join(convergenceDir, "chatgpt-ui-compatibility.json"), "chatgpt-ui-compatibility.json"]
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
if (includesLowMemory) {
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
if (includesHighlightPdf) {
  artifactDefinitions.push(
    ["highlighter-fixture", "highlighter-fixture.json", "application/json"],
    ["highlighter-stress", "highlighter-stress.json", "application/json"],
    ["highlighter-selection-light", "highlighter-selection-light.png", "image/png"],
    ["highlighter-active-light", "highlighter-active-light.png", "image/png"],
    ["highlighter-edit-dark", "highlighter-edit-dark.png", "image/png"],
    ["pdf", "mica-answer-export-sample.pdf", "application/pdf"],
    ["pdf-fixture", "pdf-export-fixture.json", "application/json"],
    ["pdf-background", "pdf-background.json", "application/json"],
    ["pdf-render-1", "pdf-render-1.png", "image/png"],
    ["pdf-render-2", "pdf-render-2.png", "image/png"],
    ["pdf-preview", "pdf-export-preview.png", "image/png"],
    ["pdf-pointer-selection", "pdfjs-pointer-selection.png", "image/png"],
    ["pdf-display-math-selection", "pdfjs-display-math-selection.png", "image/png"],
    ["extension-install-smoke", "extension-install-smoke.json", "application/json"],
    ["full-extension-e2e", "full-extension-e2e.json", "application/json"],
    ["low-memory-extension-lifecycle", "low-memory-extension-lifecycle.json", "application/json"],
    ["extension-visual-baseline", "extension-visual-baseline.json", "application/json"],
    ["installed-extension-answer", "installed-extension-answer.png", "image/png"],
    ["extension-options-light", "extension-options-light.png", "image/png"],
    ["extension-highlights-light", "extension-highlights-light.png", "image/png"],
    ["extension-highlights-dark", "extension-highlights-dark.png", "image/png"],
    ["extension-popup-320-light", "extension-popup-320-light.png", "image/png"],
    ["extension-popup-368-dark", "extension-popup-368-dark.png", "image/png"],
    ["extension-popup-400-light", "extension-popup-400-light.png", "image/png"],
    ["installed-extension-pdf", "mica-full-extension-export.pdf", "application/pdf"]
  );
}
if (includesFunctionalConvergence) {
  artifactDefinitions.push(
    ["conversation-export", "conversation-export.json", "application/json"],
    ["recovery-ledger", "recovery-ledger.json", "application/json"],
    ["recovery-actions", "recovery-actions.json", "application/json"],
    ["target-surface-backend", "target-surface-backend.json", "application/json"],
    ["highlight-record-integrity", "highlight-record-integrity.json", "application/json"],
    ["local-import-integrity", "local-import-integrity.json", "application/json"],
    ["chatgpt-ui-compatibility", "chatgpt-ui-compatibility.json", "application/json"]
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
const lowMemoryPressure = includesLowMemory ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-pressure.json"), "utf8")) : null;
const lowMemoryFixture = includesLowMemory ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-fixture.json"), "utf8")) : null;
const lowMemoryPage = includesLowMemory ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-page.json"), "utf8")) : null;
const lowMemoryStress = includesLowMemory ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-stress.json"), "utf8")) : null;
const lowMemoryRegistration = includesLowMemory ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-registration.json"), "utf8")) : null;
const highlighterFixture = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "highlighter-fixture.json"), "utf8")) : null;
const highlighterStress = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "highlighter-stress.json"), "utf8")) : null;
const pdfFixture = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "pdf-export-fixture.json"), "utf8")) : null;
const pdfBackground = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "pdf-background.json"), "utf8")) : null;
const extensionInstallSmoke = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "extension-install-smoke.json"), "utf8")) : null;
const fullExtensionE2e = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "full-extension-e2e.json"), "utf8")) : null;
const lowMemoryExtensionLifecycle = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "low-memory-extension-lifecycle.json"), "utf8")) : null;
const extensionVisualBaseline = includesHighlightPdf ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "extension-visual-baseline.json"), "utf8")) : null;
const conversationExport = includesFunctionalConvergence ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "conversation-export.json"), "utf8")) : null;
const recoveryLedger = includesFunctionalConvergence ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "recovery-ledger.json"), "utf8")) : null;
const recoveryActions = includesFunctionalConvergence ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "recovery-actions.json"), "utf8")) : null;
const targetSurfaceBackend = includesFunctionalConvergence ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "target-surface-backend.json"), "utf8")) : null;
const highlightRecordIntegrity = includesFunctionalConvergence ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "highlight-record-integrity.json"), "utf8")) : null;
const localImportIntegrity = includesFunctionalConvergence ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "local-import-integrity.json"), "utf8")) : null;
const chatgptUiCompatibility = includesFunctionalConvergence ? JSON.parse(await readFile(path.join(bundleDir, "artifacts", "chatgpt-ui-compatibility.json"), "utf8")) : null;
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
if (includesLowMemory) requiredGates.splice(requiredGates.indexOf("privacy"), 0, "low-memory-benefit");
if (includesHighlightPdf) requiredGates.splice(requiredGates.indexOf("privacy"), 0, "highlight-remount", "pdf-selection", "installed-extension-e2e");
if (includesFunctionalConvergence) requiredGates.splice(requiredGates.indexOf("privacy"), 0, "conversation-export-completeness", "recovery-deduplication", "recovery-action-safety", "target-surface-backend", "highlight-record-integrity", "local-import-integrity", "chatgpt-ui-compatibility");

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
if (includesLowMemory) {
  evidence.splice(evidence.findIndex((item) => item.gateId === "privacy"), 0,
    record("low-memory-benefit", "TARGET_CLASS_ENVIRONMENT", { surface: "local-constrained-target-class-environment" }, ["dist-tree", "low-memory-pressure", "low-memory-fixture", "low-memory-page", "low-memory-stress", "low-memory-registration", "foundation-flows", "popup-low-memory-active", "popup-low-memory-restore-required", "popup-low-memory-full-history-bypass"], {
      A: lowMemoryPressure.A,
      B: lowMemoryPressure.B,
      C: lowMemoryPressure.C,
      recentTurnLimit: lowMemoryPressure.recentTurnLimit,
      threadProfiles: lowMemoryFixture.profiles,
      pressureFixture: lowMemoryPressure.pressureFixture,
      targetEnvironment: lowMemoryPressure.targetEnvironment,
      actualTruncation: lowMemoryPressure.actualTruncation,
      truncatedRepresentation: lowMemoryPressure.truncatedRepresentation,
      reactManagedInteractiveNodesDetached: lowMemoryPressure.reactManagedInteractiveNodesDetached,
      serverMutation: lowMemoryPressure.serverMutation,
      history: deriveLowMemoryHistory(lowMemoryPage),
      actionSecurity: deriveLowMemoryActionSecurity(lowMemoryPage),
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
if (includesHighlightPdf) {
  evidence.splice(evidence.findIndex((item) => item.gateId === "privacy"), 0,
    record("highlight-remount", "LOCAL_REAL_BROWSER", { surface: "local-real-browser" }, ["dist-tree", "highlighter-fixture", "highlighter-stress", "highlighter-selection-light", "highlighter-active-light", "highlighter-edit-dark"], deriveHighlighterMeasurement(highlighterFixture, highlighterStress)),
    record("pdf-selection", "ACTUAL_PDF_VIEWER", { surface: "actual-pdf-viewer" }, ["pdf", "pdf-fixture", "pdf-background", "highlighter-fixture", "pdf-render-1", "pdf-render-2", "pdf-preview", "pdf-pointer-selection", "pdf-display-math-selection"], derivePdfMeasurement(pdfFixture, pdfBackground, highlighterFixture)),
    record("installed-extension-e2e", "LOCAL_REAL_BROWSER", { surface: "actual-installed-extension" }, [
      "dist-tree", "extension-install-smoke", "full-extension-e2e", "low-memory-extension-lifecycle", "extension-visual-baseline",
      "installed-extension-answer", "extension-options-light", "extension-highlights-light", "extension-highlights-dark",
      "extension-popup-320-light", "extension-popup-368-dark", "extension-popup-400-light", "installed-extension-pdf"
    ], deriveInstalledExtensionMeasurement(extensionInstallSmoke, fullExtensionE2e, lowMemoryExtensionLifecycle, extensionVisualBaseline))
  );
}
if (includesFunctionalConvergence) {
  evidence.splice(evidence.findIndex((item) => item.gateId === "privacy"), 0,
    record("conversation-export-completeness", "SYNTHETIC_FIXTURE", { surface: "conversation-export-coordinator" }, ["conversation-export"], conversationExport),
    record("recovery-deduplication", "SYNTHETIC_FIXTURE", { surface: "recovery-service-worker-ledger" }, ["recovery-ledger"], recoveryLedger),
    record("recovery-action-safety", "SYNTHETIC_FIXTURE", { surface: "recovery-action-policy" }, ["recovery-actions"], recoveryActions),
    record("target-surface-backend", "SYNTHETIC_FIXTURE", { surface: "target-surface-backend" }, ["target-surface-backend"], targetSurfaceBackend),
    record("highlight-record-integrity", "SYNTHETIC_FIXTURE", { surface: "highlight-record-integrity" }, ["highlight-record-integrity"], highlightRecordIntegrity),
    record("local-import-integrity", "SYNTHETIC_FIXTURE", { surface: "local-import-integrity" }, ["local-import-integrity"], localImportIntegrity),
    record("chatgpt-ui-compatibility", "SYNTHETIC_FIXTURE", { surface: "chatgpt-ui-compatibility" }, ["chatgpt-ui-compatibility"], chatgptUiCompatibility)
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

function deriveLowMemoryHistory(page) {
  const away = page?.historyControl?.awayFromTop;
  const near = page?.historyControl?.nearTop;
  const fullNodeCount = page?.firstInstall?.status?.totalNodes;
  return {
    scrollUpRestoresOlder: Number.isFinite(away?.scrollY) && away.scrollY >= 96 && away?.nearTopAttribute === false && away?.visible === false
      && Number.isFinite(near?.scrollY) && near.scrollY < 96 && near?.nearTopAttribute === true && near?.visible === true,
    loadFullHistoryPass: page?.historyControl?.userAction === "trusted_pointer" && page?.historyControl?.prepareCalls === 1
      && page?.historyControl?.reloads === 1 && page?.fullHistoryBypass?.mappingNodes === fullNodeCount,
    reloadRestoresFullHistory: page?.fullHistoryBypass?.mappingNodes === fullNodeCount,
    disableRestoresFullHistory: page?.unsafeDisable?.userAction === "trusted_pointer" && page?.unsafeDisable?.prepareCalls === 1
      && page?.unsafeDisable?.reloads === 1 && page?.disabled?.mappingNodes === fullNodeCount,
    closeOrUninstallRestoresFullHistory: page?.disabled?.mappingNodes === fullNodeCount,
    serverHistoryUnchanged: page?.firstInstall?.status?.serverMutation === false
  };
}

function deriveLowMemoryActionSecurity(page) {
  return {
    pageStatusTelemetryTrusted: page?.forgedPageStatus?.telemetryTrust !== "page_untrusted",
    recoveryAuthorization: page?.forgedPageStatus?.recoveryAuthorization,
    forgedStatusAcceptedAsTelemetry: page?.forgedPageStatus?.telemetryAccepted === true,
    syntheticClickPrepareCalls: page?.forgedPageStatus?.prepareCalls,
    syntheticClickReloads: page?.forgedPageStatus?.reloads,
    trustedPointerPrepareCalls: page?.historyControl?.prepareCalls,
    trustedPointerReloads: page?.historyControl?.reloads,
    trustedKeyboardResumeCalls: page?.fullHistoryBypass?.resumeCalls,
    trustedKeyboardReloads: page?.fullHistoryBypass?.reloads
  };
}

function deriveHighlighterMeasurement(fixture, stress) {
  const rendered = (name) => fixture?.[name]?.status?.renderedCount;
  const unresolved = (name) => fixture?.[name]?.status?.unresolvedCount;
  return {
    passed: fixture?.passed === true,
    selectionSequence: fixture?.selection?.sequence || [],
    mathTeX: fixture?.selection?.mathTeX || [],
    rawLatexSources: fixture?.rawLatexSources || [],
    restoredAfterRefresh: rendered("refreshed") === 1 && unresolved("refreshed") === 0,
    restoredAfterRemount: rendered("remounted") === 1 && unresolved("remounted") === 0,
    restoredAfterMathReformat: rendered("mathReformatted") === 1 && unresolved("mathReformatted") === 0,
    attachedToWrongText: rendered("ambiguous") !== 0 || rendered("deletedSource") !== 0,
    ambiguousAnchorStayedUnresolved: rendered("ambiguous") === 0 && unresolved("ambiguous") === 1 && fixture?.ambiguous?.records?.[0]?.unresolvedReason === "ambiguous_anchor",
    deletedSourceStayedUnresolved: rendered("deletedSource") === 0 && unresolved("deletedSource") === 1 && fixture?.deletedSource?.records?.[0]?.unresolvedReason === "source_missing",
    branchMismatchStayedUnresolved: fixture?.branchResolution?.status === "unresolved" && fixture?.branchResolution?.reason === "conversation_mismatch" && fixture?.branchResolution?.range == null,
    invalidSelectionsFailOpen: fixture?.invalidSelections?.composerResult?.ok === false
      && fixture?.invalidSelections?.codeResult?.ok === false
      && fixture?.invalidSelections?.streamingResult?.ok === false
      && fixture?.invalidSelections?.toolbarPresent === false,
    keyboardAccessible: fixture?.keyboard?.result?.ok === true
      && fixture?.keyboard?.activeLabel === "Yellow highlight"
      && fixture?.keyboard?.dismissedWithEscape === true,
    colorOwnership: fixture?.recolored?.records?.[0]?.color === "mint" && rendered("recolored") === 1,
    deleteOwnership: fixture?.removed?.status?.recordCount === 0 && fixture?.removed?.status?.renderedCount === 0,
    localStorageOnly: fixture?.invariants?.localStorageOnly === true,
    noGlobalRangePatch: fixture?.invariants?.noGlobalRangePatch === true,
    noGlobalSelectionPatch: fixture?.invariants?.noGlobalSelectionPatch === true,
    noPermanentToolbar: fixture?.invariants?.noPermanentToolbar === true,
    stress: {
      passed: stress?.passed === true
        && stress?.loops === 8
        && stress?.runs === 8
        && Array.isArray(stress?.results)
        && stress.results.length === 8
        && stress.results.every((item, index) => item?.loop === index + 1 && item?.script === "scripts/highlighter-fixture-smoke.mjs" && item?.passed === true),
      loops: stress?.loops,
      runs: stress?.runs
    },
    screenshotArtifacts: {
      selectionLight: "highlighter-selection-light",
      activeLight: "highlighter-active-light",
      editDark: "highlighter-edit-dark"
    }
  };
}

function derivePdfMeasurement(fixture, background, highlighter) {
  const pointerText = String(fixture?.pdfJs?.pointerSelectionText || "").replace(/\s+/g, " ").trim();
  const displayText = String(fixture?.pdfJs?.displayMathSelection || "").replace(/\s+/g, " ").trim();
  return {
    textExtracted: fixture?.pdfJs?.textExtracted === true,
    pointerSelection: fixture?.pdfJs?.pointerSelection === true && pointerText.includes("Before x+1 after"),
    trustedPointerEvents: fixture?.pdfJs?.trustedPointerEvents === true,
    pointerSequence: fixture?.pdfJs?.pointerSequence || [],
    displayMathSelectable: displayText.includes("E=mc^2"),
    mathCopyResult: fixture?.pdfJs?.mathCopyResult === true && pointerText.includes("x+1"),
    mathSearchable: fixture?.pdfJs?.searchable === true && fixture?.independentExtraction?.searchable === true,
    independentExtraction: fixture?.independentExtraction?.engine === "pdfplumber" && fixture?.independentExtraction?.textExtracted === true,
    localExportBoundary: background?.passed === true
      && background?.trustedSourceOpened === true
      && background?.unsupportedSourceRejected === true
      && background?.oneTimeConsumption === true
      && background?.forgedConsumerRejected === true
      && background?.persistentConversationStorage === false
      && background?.serverUpload === false,
    trustedToolbarHandoff: highlighter?.pdfExportHandoff?.trustedToolbarActionReachedBackground === true
      && highlighter?.pdfExportHandoff?.schemaVersion === 1
      && highlighter?.pdfExportHandoff?.localOnly === true
      && highlighter?.pdfExportHandoff?.containsCrossMathText === true,
    highlightPreserved: fixture?.highlights?.preservedInPrintModel === true && fixture?.highlights?.crossMath === true,
    crossPageHighlight: fixture?.highlights?.crossPage === true && fixture?.pdf?.pageCount >= 2,
    actualViewerEngine: `PDF.js ${fixture?.pdfJs?.version || ""}`.trim(),
    pageCount: fixture?.pdf?.pageCount,
    pdfArtifactId: "pdf",
    visualArtifacts: {
      renderPage1: "pdf-render-1",
      renderPage2: "pdf-render-2",
      preview: "pdf-preview",
      pointerSelection: "pdf-pointer-selection",
      displayMathSelection: "pdf-display-math-selection"
    }
  };
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
