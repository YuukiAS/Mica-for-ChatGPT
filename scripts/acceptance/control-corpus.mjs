import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EVIDENCE_SCHEMA_VERSION,
  VALIDATOR_VERSION,
  computeEvidenceRootHash,
  computeFixtureSetHash,
  computeValidatorTreeHash,
  deriveInstalledExtensionMeasurement,
  sha256File,
  sha256Text,
  validateBundle
} from "./validator.mjs";

const ALL_GATES = [
  "candidate-identity",
  "popup-render",
  "adapter-contract",
  "answer-document-core",
  "copy-serialization",
  "conversation-export-completeness",
  "recovery-deduplication",
  "recovery-action-safety",
  "target-surface-backend",
  "highlight-record-integrity",
  "local-import-integrity",
  "chatgpt-ui-compatibility",
  "copy-placement",
  "core-flow-regression",
  "send-lifecycle-safety",
  "low-memory-benefit",
  "highlight-remount",
  "pdf-selection",
  "installed-extension-e2e",
  "privacy",
  "packaging-version"
];

export async function runControlCorpus(repoRoot) {
  const catalog = JSON.parse(await readFile(path.join(repoRoot, "acceptance", "controls", "catalog.json"), "utf8"));
  const scenarios = new Map([
    ["complete-measured-bundle", async () => {}],
    ["known-good-current-popup", async (context) => { context.requestedGateIds = ["popup-render"]; }],
    ["known-good-conversation-export-completeness", async (context) => { context.requestedGateIds = ["conversation-export-completeness"]; }],
    ["known-good-recovery-deduplication", async (context) => { context.requestedGateIds = ["recovery-deduplication"]; }],
    ["known-good-recovery-action-safety", async (context) => { context.requestedGateIds = ["recovery-action-safety"]; }],
    ["known-good-target-surface-backend", async (context) => { context.requestedGateIds = ["target-surface-backend"]; }],
    ["known-good-highlight-record-integrity", async (context) => { context.requestedGateIds = ["highlight-record-integrity"]; }],
    ["known-good-local-import-integrity", async (context) => { context.requestedGateIds = ["local-import-integrity"]; }],
    ["known-good-chatgpt-ui-compatibility", async (context) => { context.requestedGateIds = ["chatgpt-ui-compatibility"]; }],
    ["known-good-adapter-contract", async (context) => { context.requestedGateIds = ["adapter-contract"]; }],
    ["known-good-low-memory-fixture", async (context) => { context.requestedGateIds = ["low-memory-benefit"]; }],
    ["known-good-highlighter-fixture", async (context) => { context.requestedGateIds = ["highlight-remount"]; }],
    ["known-good-selectable-math-pdf", async (context) => { context.requestedGateIds = ["pdf-selection"]; }],
    ["known-good-installed-extension-e2e", async (context) => { context.requestedGateIds = ["installed-extension-e2e"]; }],
    ["missing-evidence", async ({ manifest }) => { manifest.evidence = manifest.evidence.filter((item) => item.gateId !== "popup-render"); refreshRoot(manifest); }],
    ["tampered-artifact", async ({ bundleDir }) => { await writeFile(path.join(bundleDir, "artifacts", "dist.zip"), "tampered dist"); }],
    ["wrong-validator-version", async ({ manifest }) => { manifest.validator.version = "0.0.0"; }],
    ["wrong-fixture-set-hash", async ({ manifest }) => { manifest.fixtureSetHash = "0".repeat(64); }],
    ["wrong-contract-hash", async ({ manifest }) => { manifest.chatgptContractHash = "0".repeat(64); }],
    ["duplicate-required-gate", async ({ manifest }) => { manifest.requiredGates.push(manifest.requiredGates[0]); }],
    ["wrong-candidate-dist-hash", async ({ manifest }) => { manifest.candidate.distHash = "0".repeat(64); }],
    ["stale-prior-candidate-report", async ({ manifest }) => { manifest.reportContext.candidateCommit = "b".repeat(40); }],
    ["duplicate-popup-screenshots", async ({ manifest }) => { evidence(manifest, "popup-render").measurement.themeArtifacts.dark = "popup-light"; refreshRoot(manifest); }],
    ["wrong-popup-surface", async ({ manifest }) => { evidence(manifest, "popup-render").subject.surface = "static-html-mock"; refreshRoot(manifest); }],
    ["hard-coded-pass-only", async ({ manifest }) => { evidence(manifest, "popup-render").measurement = { pass: true }; refreshRoot(manifest); }],
    ["forged-bound-measurement", async ({ bundleDir, manifest }) => {
      const file = path.join(bundleDir, "artifacts", "foundation-flows.json");
      const value = JSON.parse(await readFile(file, "utf8"));
      value.coreFlows.connector = false;
      await writeFile(file, JSON.stringify(value));
      manifest.artifacts.find((item) => item.id === "foundation-flows").sha256 = await sha256File(file);
      refreshRoot(manifest);
    }],
    ["forced-unknown-settled", async ({ bundleDir, manifest }) => {
      const file = path.join(bundleDir, "artifacts", "foundation-core.json");
      const value = JSON.parse(await readFile(file, "utf8"));
      value.lifecycle.callerCannotForceSettled = false;
      await writeFile(file, JSON.stringify(value));
      manifest.artifacts.find((item) => item.id === "foundation-core").sha256 = await sha256File(file);
      refreshRoot(manifest);
    }],
    ["wrong-bootstrap-capability-binding", async ({ manifest }) => {
      evidence(manifest, "adapter-contract").measurement.capabilities[0].sourceCapabilityId = "missing-current-capability";
      refreshRoot(manifest);
    }],
    ["missing-contract-capability", async ({ manifest }) => {
      evidence(manifest, "adapter-contract").measurement.capabilities = [];
      refreshRoot(manifest);
    }],
    ["duplicate-contract-capability", async ({ manifest }) => {
      const capabilities = evidence(manifest, "adapter-contract").measurement.capabilities;
      capabilities.push({ ...capabilities[0] });
      refreshRoot(manifest);
    }],
    ["bootstrap-invariant-mismatch", async ({ bundleDir, manifest }) => {
      const file = path.join(bundleDir, "artifacts", "current-chatgpt-bootstrap.json");
      const value = JSON.parse(await readFile(file, "utf8"));
      value.surfaces[0].observed.turnContainer.mountedCount = 0;
      await writeFile(file, JSON.stringify(value));
      const artifact = manifest.artifacts.find((item) => item.id === "current-chatgpt-bootstrap");
      artifact.sha256 = await sha256File(file);
      for (const capability of evidence(manifest, "adapter-contract").measurement.capabilities) capability.sourceArtifactHash = artifact.sha256;
      refreshRoot(manifest);
    }],
    ["evidence-root-mismatch", async ({ manifest }) => { manifest.evidenceRootHash = "0".repeat(64); }],
    ["historical-copy-misplacement", async ({ manifest }) => { evidence(manifest, "copy-placement").measurement.actionInjected = true; refreshRoot(manifest); }],
    ["fabricated-copy-placement-proof", async ({ manifest }) => {
      const measurement = evidence(manifest, "copy-placement").measurement;
      measurement.placementProven = true;
      measurement.exactAssistantTurn = true;
      measurement.clusterProven = true;
      measurement.siblingRelationship = true;
      measurement.visibleBaseline = true;
      measurement.failOpen = false;
      refreshRoot(manifest);
    }],
    ["coherent-incomplete-placement-proof", async ({ bundleDir, manifest }) => {
      const contractFile = path.join(bundleDir, "artifacts", "chatgpt-contract.json");
      const contract = JSON.parse(await readFile(contractFile, "utf8"));
      const declared = contract.capabilities.find((item) => item.capabilityId === "answer.actionCluster");
      declared.status = "EXACT";
      declared.variantId = "native-copy-button-parent-v1";
      declared.requiredSourceObservationIds = ["native-copy-action"];
      declared.failOpen = false;
      await writeFile(contractFile, JSON.stringify(contract));
      const contractArtifact = manifest.artifacts.find((item) => item.id === "chatgpt-contract");
      contractArtifact.sha256 = await sha256File(contractFile);
      manifest.chatgptContractHash = contractArtifact.sha256;

      const capabilities = evidence(manifest, "adapter-contract").measurement.capabilities;
      for (const capability of capabilities) capability.contractHash = contractArtifact.sha256;
      const measured = capabilities.find((item) => item.capabilityId === "answer.actionCluster");
      measured.status = "EXACT";
      measured.variantId = "native-copy-button-parent-v1";
      measured.requiredSourceObservationIds = ["native-copy-action"];
      measured.observedInvariants = ["native-copy-action"];
      measured.failOpen = false;

      const placement = evidence(manifest, "copy-placement").measurement;
      placement.capabilityStatus = "EXACT";
      placement.placementProven = true;
      placement.exactAssistantTurn = true;
      placement.clusterProven = true;
      placement.siblingRelationship = true;
      placement.visibleBaseline = true;
      placement.failOpen = false;
      refreshRoot(manifest);
    }],
    ["connector-residual-remount-regression", async ({ manifest }) => { evidence(manifest, "core-flow-regression").measurement.connector = false; refreshRoot(manifest); }],
    ["fake-waiting-send-lifecycle", async ({ manifest }) => { const m = evidence(manifest, "send-lifecycle-safety").measurement; m.progressObserved = true; m.autoResend = true; refreshRoot(manifest); }],
    ["low-memory-no-op", async ({ manifest }) => {
      const m = evidence(manifest, "low-memory-benefit").measurement;
      m.C.processMemoryMb = m.B.processMemoryMb;
      m.C.processMemoryRangeMb = [...m.B.processMemoryRangeMb];
      m.C.heapMb = m.B.heapMb;
      m.C.heapRangeMb = [...m.B.heapRangeMb];
      m.C.retainedContentMb = m.B.retainedContentMb;
      refreshRoot(manifest);
    }],
    ["low-memory-stress-missing", async ({ manifest }) => {
      manifest.artifacts = manifest.artifacts.filter((item) => item.id !== "low-memory-stress");
      refreshRoot(manifest);
    }],
    ["low-memory-stress-failed-rehash", async (context) => mutateStress(context, (value) => { value.passed = false; value.results[0].passed = false; })],
    ["low-memory-stress-short-rehash", async (context) => mutateStress(context, (value) => { value.runs = 39; value.results.pop(); })],
    ["low-memory-stress-duplicate-script-rehash", async (context) => mutateStress(context, (value) => { value.results[1].script = value.results[0].script; })],
    ["low-memory-synthetic-click-authorized-rehash", async (context) => mutateLowMemoryPage(context, (value) => {
      value.forgedPageStatus.prepareCalls = 1;
      value.forgedPageStatus.reloads = 1;
      value.actionSecurity.syntheticClickPrepareCalls = 1;
      value.actionSecurity.syntheticClickReloads = 1;
    })],
    ["low-memory-target-environment-misclassified", async ({ manifest }) => {
      const record = evidence(manifest, "low-memory-benefit");
      record.evidenceClass = "TARGET_LOW_MEMORY_DEVICE";
      record.subject = { surface: "target-low-memory-device" };
      refreshRoot(manifest);
    }],
    ["low-memory-dom-only-rehash", async (context) => {
      await mutateLowMemoryPressure(context, (value) => {
        value.actualTruncation = false;
        value.truncatedRepresentation = "dom-visibility-only";
      });
      const measurement = evidence(context.manifest, "low-memory-benefit").measurement;
      measurement.actualTruncation = false;
      measurement.truncatedRepresentation = "dom-visibility-only";
      refreshRoot(context.manifest);
    }],
    ["low-memory-cherry-picked-sample-rehash", async (context) => {
      await mutateLowMemoryPressure(context, (value) => { value.C.processMemoryMb = value.C.sampleSeries.processMemoryMb[0]; });
      evidence(context.manifest, "low-memory-benefit").measurement.C.processMemoryMb = evidence(context.manifest, "low-memory-benefit").measurement.C.sampleSeries.processMemoryMb[0];
      refreshRoot(context.manifest);
    }],
    ["low-memory-features-disabled-rehash", async (context) => {
      await mutateLowMemoryPressure(context, (value) => { value.C.enabledCapabilities = ["foundation"]; });
      evidence(context.manifest, "low-memory-benefit").measurement.C.enabledCapabilities = ["foundation"];
      refreshRoot(context.manifest);
    }],
    ["lost-highlight-after-remount", async ({ manifest }) => { evidence(manifest, "highlight-remount").measurement.restoredAfterRemount = false; refreshRoot(manifest); }],
    ["highlight-ambiguous-wrong-attachment-rehash", async (context) => mutateHighlighter(context, (value) => { value.ambiguous.status.renderedCount = 1; })],
    ["highlight-prototype-patch-rehash", async (context) => mutateHighlighter(context, (value) => { value.invariants.noGlobalRangePatch = false; })],
    ["highlight-duplicate-screenshots", async ({ manifest }) => {
      evidence(manifest, "highlight-remount").measurement.screenshotArtifacts.editDark = "highlighter-active-light";
      refreshRoot(manifest);
    }],
    ["non-selectable-inline-math-pdf", async ({ manifest }) => { evidence(manifest, "pdf-selection").measurement.pointerSelection = false; refreshRoot(manifest); }],
    ["pdf-pointer-failed-rehash", async (context) => mutatePdfFixture(context, (value) => { value.pdfJs.pointerSelection = false; value.pdfJs.trustedPointerEvents = false; })],
    ["pdf-extraction-only-rehash", async (context) => mutatePdfFixture(context, (value) => { value.pdfJs.pointerSelection = false; value.pdfJs.pointerSelectionText = ""; })],
    ["pdf-duplicate-viewer-screenshots", async ({ manifest }) => {
      evidence(manifest, "pdf-selection").measurement.visualArtifacts.displayMathSelection = "pdf-pointer-selection";
      refreshRoot(manifest);
    }],
    ["pdf-forged-consumer-rehash", async (context) => mutateJsonArtifact(context, "pdf-background", (value) => { value.forgedConsumerRejected = false; })],
    ["installed-extension-service-worker-bypassed", async ({ manifest }) => {
      evidence(manifest, "installed-extension-e2e").measurement.install.actualServiceWorker = false;
      refreshRoot(manifest);
    }],
    ["installed-extension-visual-auto-accepted-rehash", async (context) => {
      await mutateJsonArtifact(context, "full-extension-e2e", (value) => { value.visual.current["popup-320-light"] = "0".repeat(64); });
      await mutateJsonArtifact(context, "extension-visual-baseline", (value) => { value.screenshots["popup-320-light"] = "0".repeat(64); });
    }],
    ["installed-extension-real-network-used-rehash", async (context) => {
      await mutateJsonArtifact(context, "full-extension-e2e", (value) => { value.privacy.realChatGptRequests = 1; });
      evidence(context.manifest, "installed-extension-e2e").measurement.privacy.zeroRealChatGptRequests = false;
      refreshRoot(context.manifest);
    }],
    ["installed-extension-pdf-highlight-dropped-rehash", async (context) => {
      await mutateJsonArtifact(context, "full-extension-e2e", (value) => {
        value.pdf.resolvedHighlightCount = 0;
        value.pdf.renderedHighlightMarks = 0;
        value.pdf.highlightVisibleInExportPage = false;
      });
      evidence(context.manifest, "installed-extension-e2e").measurement.full.pdf = false;
      refreshRoot(context.manifest);
    }],
    ["stale-chatgpt-contract", async ({ manifest }) => { evidence(manifest, "adapter-contract").measurement.capabilities[0].invalidatedBy = ["newer incompatible surface"]; refreshRoot(manifest); }],
    ["control-bundle-presented-as-candidate", async (context) => { context.expectedBundleKind = "candidate"; }],
    ["copy-serialization-output-mismatch", async ({ manifest }) => { evidence(manifest, "copy-serialization").measurement.cases[0].actualArtifactId = "copy-rich-actual"; refreshRoot(manifest); }],
    ["forged-conversation-completeness-rehash", async (context) => {
      await mutateJsonArtifact(context, "conversation-export", (value) => { value.forgedCompletenessRejected = false; });
      evidence(context.manifest, "conversation-export-completeness").measurement.forgedCompletenessRejected = false;
      refreshRoot(context.manifest);
    }],
    ["forged-incomplete-content-accepted-rehash", async (context) => {
      await mutateJsonArtifact(context, "conversation-export", (value) => { value.unknownOrOpaqueContentRejected = false; });
      evidence(context.manifest, "conversation-export-completeness").measurement.unknownOrOpaqueContentRejected = false;
      refreshRoot(context.manifest);
    }],
    ["forged-export-fidelity-rehash", async (context) => {
      await mutateJsonArtifact(context, "conversation-export", (value) => { value.structuredTableMath = false; });
      evidence(context.manifest, "conversation-export-completeness").measurement.structuredTableMath = false;
      refreshRoot(context.manifest);
    }],
    ["forged-semantic-mathml-rehash", async (context) => {
      await mutateJsonArtifact(context, "conversation-export", (value) => { value.semanticMathMlRendered = false; });
      evidence(context.manifest, "conversation-export-completeness").measurement.semanticMathMlRendered = false;
      refreshRoot(context.manifest);
    }],
    ["forged-recovery-deduplication-rehash", async (context) => {
      await mutateJsonArtifact(context, "recovery-ledger", (value) => { value.workerRestartDeduplicated = false; });
      evidence(context.manifest, "recovery-deduplication").measurement.workerRestartDeduplicated = false;
      refreshRoot(context.manifest);
    }],
    ["forged-recovery-action-safety-rehash", async (context) => {
      await mutateJsonArtifact(context, "recovery-actions", (value) => { value.wrongTurnEvidenceRejected = false; });
      evidence(context.manifest, "recovery-action-safety").measurement.wrongTurnEvidenceRejected = false;
      refreshRoot(context.manifest);
    }],
    ["forged-target-surface-backend-rehash", async (context) => {
      await mutateJsonArtifact(context, "target-surface-backend", (value) => { value.unknownLiveContractFailsOpen = false; });
      evidence(context.manifest, "target-surface-backend").measurement.unknownLiveContractFailsOpen = false;
      refreshRoot(context.manifest);
    }],
    ["forged-answer-action-backend-rehash", async (context) => {
      await mutateJsonArtifact(context, "target-surface-backend", (value) => { value.singleAnswerActionEntry = false; });
      evidence(context.manifest, "target-surface-backend").measurement.singleAnswerActionEntry = false;
      refreshRoot(context.manifest);
    }],
    ["forged-highlight-record-sanitization-rehash", async (context) => {
      await mutateJsonArtifact(context, "highlight-record-integrity", (value) => { value.unknownTopLevelFieldsStripped = false; });
      evidence(context.manifest, "highlight-record-integrity").measurement.unknownTopLevelFieldsStripped = false;
      refreshRoot(context.manifest);
    }],
    ["forged-answer-scope-clear-rehash", async (context) => {
      await mutateJsonArtifact(context, "highlight-record-integrity", (value) => { value.answerScopedClearIsolated = false; });
      evidence(context.manifest, "highlight-record-integrity").measurement.answerScopedClearIsolated = false;
      refreshRoot(context.manifest);
    }],
    ["forged-local-import-budget-rehash", async (context) => {
      await mutateJsonArtifact(context, "local-import-integrity", (value) => { value.highlightFileBudgetEnforced = false; });
      evidence(context.manifest, "local-import-integrity").measurement.highlightFileBudgetEnforced = false;
      refreshRoot(context.manifest);
    }],
    ["forged-chatgpt-ui-isolation-rehash", async (context) => {
      await mutateJsonArtifact(context, "chatgpt-ui-compatibility", (value) => { value.capabilityDriftIsolated = false; });
      evidence(context.manifest, "chatgpt-ui-compatibility").measurement.capabilityDriftIsolated = false;
      refreshRoot(context.manifest);
    }],
    ["packaging-version-mismatch", async ({ bundleDir, manifest }) => {
      await writeFile(path.join(bundleDir, "artifacts", "version-report.json"), JSON.stringify({
        sourceVersion: "9.9.9",
        popupVersion: "9.9.9",
        diagnosticsVersion: "9.9.9",
        reportedUnpackedVersion: "9.9.9",
        buildLabel: manifest.candidate.buildLabel
      }));
      const artifact = manifest.artifacts.find((item) => item.id === "version-report");
      artifact.sha256 = await sha256File(path.join(bundleDir, artifact.path));
      refreshRoot(manifest);
    }],
    ["omitted-release-gate", async ({ manifest }) => {
      manifest.requiredGates = manifest.requiredGates.filter((gateId) => gateId !== "low-memory-benefit");
    }]
  ]);

  const declared = [...catalog.knownGood, ...catalog.knownBad];
  const results = [];
  for (const item of declared) {
    const context = await createGoodBundle(repoRoot);
    try {
      const mutate = scenarios.get(item.id);
      if (!mutate) throw new Error(`control scenario implementation missing: ${item.id}`);
      await mutate(context);
      await writeFile(path.join(context.bundleDir, "manifest.json"), `${JSON.stringify(context.manifest, null, 2)}\n`);
      const validation = await validateBundle(
        repoRoot,
        context.bundleDir,
        context.requestedGateIds || null,
        context.expectedBundleKind ? { expectedBundleKind: context.expectedBundleKind } : {}
      );
      const actual = validation.ok ? "ACCEPT" : "REJECT";
      results.push({ id: item.id, expected: item.expected, actual, errors: validation.errors });
    } finally {
      await rm(context.tempRoot, { recursive: true, force: true });
    }
  }

  const failed = results.filter((item) => item.expected !== item.actual);
  return {
    ok: failed.length === 0,
    knownGoodAccepted: results.filter((item) => item.expected === "ACCEPT" && item.actual === "ACCEPT").length,
    knownGoodDeclared: results.filter((item) => item.expected === "ACCEPT").length,
    knownBadRejected: results.filter((item) => item.expected === "REJECT" && item.actual === "REJECT").length,
    knownBadDeclared: results.filter((item) => item.expected === "REJECT").length,
    failed,
    results
  };
}

async function createGoodBundle(repoRoot) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mica-acceptance-control-"));
  const bundleDir = path.join(tempRoot, "bundle");
  const artifactDir = path.join(bundleDir, "artifacts");
  await mkdir(artifactDir, { recursive: true });

  const extensionVisualContents = {
    "options-light": "control-extension-options-light",
    "highlights-light": "control-extension-highlights-light",
    "highlights-dark": "control-extension-highlights-dark",
    "popup-320-light": "control-extension-popup-320-light",
    "popup-368-dark": "control-extension-popup-368-dark",
    "popup-400-light": "control-extension-popup-400-light"
  };
  const extensionVisualHashes = Object.fromEntries(Object.entries(extensionVisualContents).map(([name, content]) => [name, sha256Text(content)]));

  const artifactSources = [
    ["dist", "artifacts/dist.zip", "application/zip", "known-good-dist"],
    ["popup-light", "artifacts/popup-light.png", "image/png", "known-good-popup-light"],
    ["popup-dark", "artifacts/popup-dark.png", "image/png", "known-good-popup-dark"],
    ["chatgpt-contract", "artifacts/chatgpt-contract.json", "application/json", JSON.stringify({
      capabilities: [
        { capabilityId: "turns.list", sourceCapabilityId: "conversation-turn-discovery", sourceEvidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", requiredSourceObservationIds: ["ordered-turn-containers"], variantId: "public-shared-v1", status: "EXACT", requiredInvariants: ["ordered turns", "role ownership"] },
        { capabilityId: "answer.actionCluster", sourceCapabilityId: "answer-document-static-block-extraction", sourceEvidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", requiredSourceObservationIds: [], variantId: "unproven-v1", status: "UNKNOWN", requiredInvariants: ["native copy button", "same assistant turn", "sibling cluster parent"], failOpen: true },
        { capabilityId: "recovery.nativeControls", sourceCapabilityId: "native-stop-retry-resend-controls", sourceEvidenceClass: "NONE", requiredSourceObservationIds: [], variantId: "unproven-v1", status: "UNKNOWN", requiredInvariants: ["current recovery identity", "unique native control identity"], failOpen: true }
      ]
    })],
    ["current-chatgpt-bootstrap", "artifacts/current-chatgpt-bootstrap.json", "application/json", JSON.stringify({
      surfaces: [{ id: "public-shared-conversation", evidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", observed: { turnContainer: { mountedCount: 7 }, assistantContent: { copyActionTestId: "copy-turn-action-button" } } }],
      capabilities: [
        { id: "conversation-turn-discovery", status: "EXACT", evidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", observations: [{ id: "ordered-turn-containers", assertions: [{ surfaceId: "public-shared-conversation", path: "observed.turnContainer.mountedCount", equals: 7 }] }] },
        { id: "answer-document-static-block-extraction", status: "EXACT_FOR_OBSERVED_BLOCKS", evidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", observations: [{ id: "native-copy-action", assertions: [{ surfaceId: "public-shared-conversation", path: "observed.assistantContent.copyActionTestId", equals: "copy-turn-action-button" }] }] }
      ],
      gate: { bootstrapEvidence: "PASS", oldSurfaceAtlasUsedAsCurrentEvidence: false }
    })],
    ["pdf", "artifacts/output.pdf", "application/pdf", "%PDF-control-selectable-math"],
    ["pdf-fixture", "artifacts/pdf-fixture.json", "application/json", JSON.stringify(controlPdfFixture())],
    ["pdf-background", "artifacts/pdf-background.json", "application/json", JSON.stringify(controlPdfBackground())],
    ["pdf-render-1", "artifacts/pdf-render-1.png", "image/png", "known-good-pdf-render-page-1"],
    ["pdf-render-2", "artifacts/pdf-render-2.png", "image/png", "known-good-pdf-render-page-2"],
    ["pdf-preview", "artifacts/pdf-preview.png", "image/png", "known-good-pdf-preview"],
    ["pdf-pointer-selection", "artifacts/pdf-pointer-selection.png", "image/png", "known-good-pdf-pointer-selection"],
    ["pdf-display-math-selection", "artifacts/pdf-display-math-selection.png", "image/png", "known-good-pdf-display-math-selection"],
    ["privacy-report", "artifacts/privacy.json", "application/json", "known-good-privacy-report"],
    ["copy-plain-expected", "artifacts/copy-plain-expected.txt", "text/plain", "plain markdown output"],
    ["copy-plain-actual", "artifacts/copy-plain-actual.txt", "text/plain", "plain markdown output"],
    ["copy-rich-expected", "artifacts/copy-rich-expected.html", "text/html", "<p>rich html output</p>"],
    ["copy-rich-actual", "artifacts/copy-rich-actual.html", "text/html", "<p>rich html output</p>"],
    ["copy-mixed-expected", "artifacts/copy-mixed-expected.txt", "text/plain", "math code table output"],
    ["copy-mixed-actual", "artifacts/copy-mixed-actual.txt", "text/plain", "math code table output"],
    ["conversation-export", "artifacts/conversation-export.json", "application/json", JSON.stringify(controlConversationExport())],
    ["recovery-ledger", "artifacts/recovery-ledger.json", "application/json", JSON.stringify(controlRecoveryLedger())],
    ["recovery-actions", "artifacts/recovery-actions.json", "application/json", JSON.stringify(controlRecoveryActions())],
    ["target-surface-backend", "artifacts/target-surface-backend.json", "application/json", JSON.stringify(controlTargetSurfaceBackend())],
    ["highlight-record-integrity", "artifacts/highlight-record-integrity.json", "application/json", JSON.stringify(controlHighlightRecordIntegrity())],
    ["local-import-integrity", "artifacts/local-import-integrity.json", "application/json", JSON.stringify(controlLocalImportIntegrity())],
    ["chatgpt-ui-compatibility", "artifacts/chatgpt-ui-compatibility.json", "application/json", JSON.stringify(controlChatgptUiCompatibility())],
    ["built-manifest", "artifacts/built-manifest.json", "application/json", JSON.stringify({ version: "0.0.0" })],
    ["version-report", "artifacts/version-report.json", "application/json", JSON.stringify({
      sourceVersion: "0.0.0",
      popupVersion: "0.0.0",
      diagnosticsVersion: "0.0.0",
      reportedUnpackedVersion: "0.0.0",
      buildLabel: "acceptance-control"
    })],
    ["popup-render", "artifacts/popup-render.json", "application/json", JSON.stringify({
      passed: true,
      states: ["loading", "exact", "compatible", "unknown", "unsupported", "disabled", "contentUnavailable"],
      widthsPx: [320, 340, 368, 400],
      scalesPercent: [100, 125, 150],
      keyboard: { focusTraversal: true, accessibleNames: true },
      focusReturn: { troubleshootingToIndex: true, qaToTroubleshooting: true }
    })],
    ["foundation-core", "artifacts/foundation-core.json", "application/json", JSON.stringify({
      passed: true,
      blockKinds: ["heading", "paragraph", "list", "quote", "table", "code", "display_math", "opaque_interactive", "unknown_block"],
      inlineKinds: ["inline_math", "link", "image", "citation"],
      mixedStructureStatus: "UNKNOWN",
      toolStructureStatus: "UNKNOWN",
      lifecycle: { streamingDurable: false, settledDurable: true, unknownModelRejected: true, callerCannotForceSettled: true, singleAdapterProducer: true },
      privacy: { conversationTextIncluded: false, attachmentContentIncluded: false, requestBodyIncluded: false, authTokenIncluded: false, rawDomIncluded: false }
    })],
    ["foundation-flows", "artifacts/foundation-flows.json", "application/json", JSON.stringify({
      passed: true,
      coreFlows: { composer: true, send: true, streaming: true, editBranch: true, connector: true, toolFileAuth: true, typingImeHotPath: true },
      sendLifecycle: { progressObserved: true, autoResendObserved: false, consequentialFlowActive: true, userTurnCommitted: true, duplicateSendObserved: false },
      report: { privacy: { conversationTextIncluded: false, attachmentContentIncluded: false, requestBodyIncluded: false, authTokenIncluded: false, rawDomIncluded: false } }
    })],
    ["low-memory-pressure", "artifacts/low-memory-pressure.json", "application/json", JSON.stringify({
      passed: true,
      A: controlPressureState("mica-absent-or-disabled", 1000, 500, 420, 241, false),
      B: controlPressureState("mica-installed-low-memory-off", 980, 490, 410, 241, true),
      C: controlPressureState("mica-installed-low-memory-on", 760, 350, 250, 41, true),
      pressureFixture: { memoryLimitMb: 2048, payloadMb: 420, turns: 240, workload: "current-chatgpt-derived-react-router-flat-graph-and-virtualized-turn-renderer", sourceArtifact: "current-chatgpt-surface/low-memory-data-plane-evidence.json" },
      targetEnvironment: { class: "local-playwright-chromium-v8-old-space-pressure", executionSurface: "local-isolated-playwright-chromium", browserBuild: "control-browser-1", playwrightModules: "control-playwright-modules", rendererOldSpaceLimitMb: 256, physicalMemoryGb: null, normalEdgeProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequests: 0 },
      actualTruncation: true,
      truncatedRepresentation: "client-history-window",
      reactManagedInteractiveNodesDetached: false,
      serverMutation: false,
      checks: [{ id: "control", passed: true, message: "control" }]
    })],
    ["low-memory-fixture", "artifacts/low-memory-fixture.json", "application/json", JSON.stringify({
      passed: true,
      profiles: [
        { name: "short", totalTurns: 12, retainedRecentTurns: 12, mountedBefore: 12, mountedAfter: 12, modeApplied: false },
        { name: "medium", totalTurns: 36, retainedRecentTurns: 36, mountedBefore: 36, mountedAfter: 36, modeApplied: false },
        { name: "long", totalTurns: 240, retainedRecentTurns: 40, mountedBefore: 236, mountedAfter: 40, modeApplied: true }
      ],
      failOpen: { malformedChanged: false, malformedUnchanged: true, unknownChanged: false, unknownUnchanged: true },
      coreFlows: { typingImeHotPath: true }
    })],
    ["low-memory-page", "artifacts/low-memory-page.json", "application/json", JSON.stringify({
      passed: true,
      firstInstall: { mappingNodes: 41, status: { totalNodes: 241, serverMutation: false } },
      forgedPageConfig: { mappingNodes: 41 },
      forgedPageStatus: { telemetryAccepted: true, telemetryTrust: "page_untrusted", recoveryAuthorization: "extension_ui_or_trusted_user_gesture", prepareCalls: 0, reloads: 0 },
      historyControl: { awayFromTop: { scrollY: 1200, nearTopAttribute: false, visible: false }, nearTop: { scrollY: 0, nearTopAttribute: true, visible: true }, userAction: "trusted_pointer", prepareCalls: 1, reloads: 1 },
      fullHistoryBypass: { mappingNodes: 241, userAction: "trusted_keyboard", resumeCalls: 1, reloads: 1 },
      unsafeDisable: { userAction: "trusted_pointer", prepareCalls: 1, reloads: 1 },
      disabled: { mappingNodes: 241 },
      history: controlHistory(),
      actionSecurity: controlActionSecurity()
    })],
    ["low-memory-stress", "artifacts/low-memory-stress.json", "application/json", JSON.stringify(controlStress())],
    ["low-memory-registration", "artifacts/low-memory-registration.json", "application/json", JSON.stringify({
      passed: true, firstInstall: { registered: true }, storageFailure: { registered: false }, siteWritableConfigAccepted: false
    })],
    ["highlighter-fixture", "artifacts/highlighter-fixture.json", "application/json", JSON.stringify(controlHighlighterFixture())],
    ["highlighter-stress", "artifacts/highlighter-stress.json", "application/json", JSON.stringify(controlHighlighterStress())],
    ["highlighter-selection-light", "artifacts/highlighter-selection-light.png", "image/png", "known-good-highlighter-selection-light"],
    ["highlighter-active-light", "artifacts/highlighter-active-light.png", "image/png", "known-good-highlighter-active-light"],
    ["highlighter-edit-dark", "artifacts/highlighter-edit-dark.png", "image/png", "known-good-highlighter-edit-dark"],
    ["extension-install-smoke", "artifacts/extension-install-smoke.json", "application/json", JSON.stringify(controlExtensionInstallSmoke())],
    ["full-extension-e2e", "artifacts/full-extension-e2e.json", "application/json", JSON.stringify(controlFullExtensionE2e(extensionVisualHashes))],
    ["low-memory-extension-lifecycle", "artifacts/low-memory-extension-lifecycle.json", "application/json", JSON.stringify(controlLowMemoryExtensionLifecycle())],
    ["extension-visual-baseline", "artifacts/extension-visual-baseline.json", "application/json", JSON.stringify({ approvedVersion: "0.0.0", screenshots: extensionVisualHashes })],
    ["installed-extension-answer", "artifacts/installed-extension-answer.png", "image/png", "control-installed-extension-answer"],
    ["extension-options-light", "artifacts/extension-options-light.png", "image/png", extensionVisualContents["options-light"]],
    ["extension-highlights-light", "artifacts/extension-highlights-light.png", "image/png", extensionVisualContents["highlights-light"]],
    ["extension-highlights-dark", "artifacts/extension-highlights-dark.png", "image/png", extensionVisualContents["highlights-dark"]],
    ["extension-popup-320-light", "artifacts/extension-popup-320-light.png", "image/png", extensionVisualContents["popup-320-light"]],
    ["extension-popup-368-dark", "artifacts/extension-popup-368-dark.png", "image/png", extensionVisualContents["popup-368-dark"]],
    ["extension-popup-400-light", "artifacts/extension-popup-400-light.png", "image/png", extensionVisualContents["popup-400-light"]],
    ["installed-extension-pdf", "artifacts/mica-full-extension-export.pdf", "application/pdf", "%PDF-control-installed-extension"]
  ];
  for (const [, relative, , content] of artifactSources) {
    await writeFile(path.join(bundleDir, relative), content);
  }
  const artifacts = [];
  for (const [id, relative, kind] of artifactSources) {
    artifacts.push({ id, path: relative.replaceAll("\\", "/"), kind, sha256: await sha256File(path.join(bundleDir, relative)) });
  }
  const artifactHash = (id) => artifacts.find((artifact) => artifact.id === id).sha256;
  const commit = "a".repeat(40);
  const distHash = artifactHash("dist");
  const contractHash = artifactHash("chatgpt-contract");
  const bootstrapHash = artifactHash("current-chatgpt-bootstrap");

  const records = [
    record("candidate-identity", { surface: "candidate" }, ["dist"], { commit, distHash }),
    record("popup-render", { surface: "actual-extension-popup" }, ["popup-render", "popup-light", "popup-dark"], {
      states: ["loading", "exact", "compatible", "unknown", "unsupported", "disabled", "contentUnavailable"],
      widthsPx: [320, 340, 368, 400],
      scalesPercent: [100, 125, 150],
      keyboard: { focusTraversal: true, accessibleNames: true },
      secondaryFocus: { troubleshootingToIndex: true, qaToTroubleshooting: true },
      themeArtifacts: { light: "popup-light", dark: "popup-dark" }
    }),
    record("adapter-contract", { surface: "current-chatgpt" }, ["chatgpt-contract", "current-chatgpt-bootstrap", "foundation-core"], {
      capabilities: [
        {
          capabilityId: "turns.list",
          sourceCapabilityId: "conversation-turn-discovery",
          sourceEvidenceClass: "REAL_CHATGPT_PUBLIC_SHARED",
          requiredSourceObservationIds: ["ordered-turn-containers"],
          variantId: "public-shared-v1",
          status: "EXACT",
          requiredInvariants: ["ordered turns", "role ownership"],
          observedInvariants: ["ordered-turn-containers"],
          contractHash,
          sourceArtifactHash: bootstrapHash,
          invalidatedBy: []
        },
        {
          capabilityId: "answer.actionCluster",
          sourceCapabilityId: "answer-document-static-block-extraction",
          sourceEvidenceClass: "REAL_CHATGPT_PUBLIC_SHARED",
          requiredSourceObservationIds: [],
          variantId: "unproven-v1",
          status: "UNKNOWN",
          requiredInvariants: ["native copy button", "same assistant turn", "sibling cluster parent"],
          observedInvariants: [],
          contractHash,
          sourceArtifactHash: bootstrapHash,
          invalidatedBy: [],
          failOpen: true
        },
        {
          capabilityId: "recovery.nativeControls",
          sourceCapabilityId: "native-stop-retry-resend-controls",
          sourceEvidenceClass: "NONE",
          requiredSourceObservationIds: [],
          variantId: "unproven-v1",
          status: "UNKNOWN",
          requiredInvariants: ["current recovery identity", "unique native control identity"],
          observedInvariants: [],
          contractHash,
          sourceArtifactHash: bootstrapHash,
          invalidatedBy: [],
          failOpen: true
        }
      ]
    }),
    record("answer-document-core", { surface: "answer-document" }, ["foundation-core", "chatgpt-contract"], {
      documentFields: ["documentId", "conversationId", "turnId", "sourceVersion", "generationState", "orderedBlocks"],
      blockKinds: ["heading", "paragraph", "list", "quote", "table", "code", "inline_math", "display_math", "link", "image", "citation", "opaque_interactive", "unknown_block"],
      streamingIsProvisional: true,
      settledIsDurable: true,
      unknownLifecycleRejected: true,
      opaqueInteractive: true,
      singleAdapterProducer: true
    }),
    record("copy-serialization", { surface: "answer-document-serializer" }, [
      "copy-plain-expected", "copy-plain-actual",
      "copy-rich-expected", "copy-rich-actual",
      "copy-mixed-expected", "copy-mixed-actual"
    ], {
      cases: [
        { id: "plain-markdown", expectedArtifactId: "copy-plain-expected", actualArtifactId: "copy-plain-actual" },
        { id: "rich-html", expectedArtifactId: "copy-rich-expected", actualArtifactId: "copy-rich-actual" },
        { id: "mixed-math-code-table", expectedArtifactId: "copy-mixed-expected", actualArtifactId: "copy-mixed-actual" }
      ]
    }),
    record("conversation-export-completeness", { surface: "conversation-export-coordinator" }, ["conversation-export"], controlConversationExport()),
    record("recovery-deduplication", { surface: "recovery-service-worker-ledger" }, ["recovery-ledger"], controlRecoveryLedger()),
    record("recovery-action-safety", { surface: "recovery-action-policy" }, ["recovery-actions"], controlRecoveryActions()),
    record("target-surface-backend", { surface: "target-surface-backend" }, ["target-surface-backend"], controlTargetSurfaceBackend()),
    record("highlight-record-integrity", { surface: "highlight-record-integrity" }, ["highlight-record-integrity"], controlHighlightRecordIntegrity()),
    record("local-import-integrity", { surface: "local-import-integrity" }, ["local-import-integrity"], controlLocalImportIntegrity()),
    record("chatgpt-ui-compatibility", { surface: "chatgpt-ui-compatibility" }, ["chatgpt-ui-compatibility"], controlChatgptUiCompatibility()),
    record("copy-placement", { surface: "assistant-action-cluster" }, ["chatgpt-contract", "current-chatgpt-bootstrap"], {
      actionInjected: false,
      capabilityStatus: "UNKNOWN",
      placementProven: false,
      exactAssistantTurn: false,
      clusterProven: false,
      siblingRelationship: false,
      visibleBaseline: false,
      failOpen: true
    }),
    record("core-flow-regression", { surface: "local-real-browser" }, ["foundation-flows", "dist"], {
      composer: true,
      send: true,
      streaming: true,
      editBranch: true,
      connector: true,
      toolFileAuth: true
    }),
    record("send-lifecycle-safety", { surface: "local-real-browser" }, ["foundation-flows", "dist"], {
      progressObserved: true,
      autoResend: false,
      consequentialFlowActive: true,
      userTurnCommitted: true,
      duplicateSend: false
    }),
    record("low-memory-benefit", { surface: "local-constrained-target-class-environment" }, ["dist", "low-memory-pressure", "low-memory-fixture", "low-memory-page", "low-memory-stress", "low-memory-registration", "foundation-flows"], {
      A: controlPressureState("mica-absent-or-disabled", 1000, 500, 420, 241, false),
      B: controlPressureState("mica-installed-low-memory-off", 980, 490, 410, 241, true),
      C: controlPressureState("mica-installed-low-memory-on", 760, 350, 250, 41, true),
      recentTurnLimit: 40,
      threadProfiles: [
        { name: "short", totalTurns: 12, retainedRecentTurns: 12, mountedBefore: 12, mountedAfter: 12, modeApplied: false },
        { name: "medium", totalTurns: 36, retainedRecentTurns: 36, mountedBefore: 36, mountedAfter: 36, modeApplied: false },
        { name: "long", totalTurns: 240, retainedRecentTurns: 40, mountedBefore: 236, mountedAfter: 40, modeApplied: true }
      ],
      pressureFixture: { memoryLimitMb: 2048, payloadMb: 420, turns: 240, workload: "current-chatgpt-derived-react-router-flat-graph-and-virtualized-turn-renderer", sourceArtifact: "current-chatgpt-surface/low-memory-data-plane-evidence.json" },
      targetEnvironment: { class: "local-playwright-chromium-v8-old-space-pressure", executionSurface: "local-isolated-playwright-chromium", browserBuild: "control-browser-1", playwrightModules: "control-playwright-modules", rendererOldSpaceLimitMb: 256, physicalMemoryGb: null, normalEdgeProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequests: 0 },
      actualTruncation: true,
      truncatedRepresentation: "client-history-window",
      reactManagedInteractiveNodesDetached: false,
      serverMutation: false,
      history: controlHistory(),
      actionSecurity: controlActionSecurity(),
      registration: { firstInstall: true, storageFailureFailOpen: true, siteWritableConfigAccepted: false, forgedPageEventIgnored: true },
      stress: controlStress(),
      coreFlows: { composer: true, send: true, streaming: true, editBranch: true, connector: true, toolFileAuth: true, typingImeHotPath: true },
      unknownStructureBehavior: "FAIL_OPEN"
    }, "TARGET_CLASS_ENVIRONMENT"),
    record("highlight-remount", { surface: "local-real-browser" }, ["dist", "highlighter-fixture", "highlighter-stress", "highlighter-selection-light", "highlighter-active-light", "highlighter-edit-dark"], controlHighlighterMeasurement()),
    record("pdf-selection", { surface: "actual-pdf-viewer" }, ["pdf", "pdf-fixture", "pdf-background", "highlighter-fixture", "pdf-render-1", "pdf-render-2", "pdf-preview", "pdf-pointer-selection", "pdf-display-math-selection"], controlPdfMeasurement()),
    record("installed-extension-e2e", { surface: "actual-installed-extension" }, [
      "dist", "extension-install-smoke", "full-extension-e2e", "low-memory-extension-lifecycle", "extension-visual-baseline",
      "installed-extension-answer", "extension-options-light", "extension-highlights-light", "extension-highlights-dark",
      "extension-popup-320-light", "extension-popup-368-dark", "extension-popup-400-light", "installed-extension-pdf"
    ], deriveInstalledExtensionMeasurement(controlExtensionInstallSmoke(), controlFullExtensionE2e(extensionVisualHashes), controlLowMemoryExtensionLifecycle(), { approvedVersion: "0.0.0", screenshots: extensionVisualHashes }), "LOCAL_REAL_BROWSER"),
    record("privacy", { surface: "diagnostic-bundle" }, ["foundation-core", "foundation-flows", "privacy-report"], {
      conversationTextIncluded: false,
      attachmentContentIncluded: false,
      requestBodyIncluded: false,
      authTokenIncluded: false,
      rawDomIncluded: false,
      flowPrivacyMatches: true
    }),
    record("packaging-version", { surface: "built-extension" }, ["built-manifest", "version-report"], {
      builtManifestArtifactId: "built-manifest",
      versionReportArtifactId: "version-report"
    })
  ];

  const manifest = {
    schemaVersion: 1,
    bundleKind: "control",
    acceptanceProfile: "all-controls",
    candidate: { commit, version: "0.0.0", buildLabel: "acceptance-control", distArtifactId: "dist", distHash },
    validator: { version: VALIDATOR_VERSION, treeHash: await computeValidatorTreeHash(repoRoot) },
    chatgptContractArtifactId: "chatgpt-contract",
    chatgptContractHash: artifactHash("chatgpt-contract"),
    fixtureSetHash: await computeFixtureSetHash(repoRoot),
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceRootHash: computeEvidenceRootHash(artifacts, records),
    reportContext: { candidateCommit: commit, distHash },
    requiredGates: [...ALL_GATES],
    artifacts,
    evidence: records
  };
  return { tempRoot, bundleDir, manifest };
}

function record(gateId, subject, artifactIds, measurement, evidenceClass = "SYNTHETIC_FIXTURE") {
  return {
    id: `${gateId}-control-evidence`,
    gateId,
    evidenceClass,
    subject,
    artifactIds,
    measurement
  };
}

function evidence(manifest, gateId) {
  return manifest.evidence.find((item) => item.gateId === gateId);
}

function refreshRoot(manifest) {
  manifest.evidenceRootHash = computeEvidenceRootHash(manifest.artifacts, manifest.evidence);
}

function controlPressureState(variant, processMemoryMb, heapMb, retainedContentMb, mappingNodes, installed) {
  const samples = (value, delta = 2) => [value - delta, value - (delta / 2), value, value + (delta / 2), value + delta];
  const processSamples = samples(processMemoryMb, 20);
  const heapSamples = samples(heapMb, 15);
  const retainedSamples = samples(retainedContentMb, 10);
  const mountedSamples = [12, 12, 12, 12, 12];
  const mutationSamples = [60, 61, 62, 63, 64];
  const typingP95Ms = variant.endsWith("-on") ? 21 : 20;
  const scrollP95Ms = variant.endsWith("-on") ? 25 : 24;
  const typingSamples = samples(typingP95Ms, 2);
  const scrollSamples = samples(scrollP95Ms, 2);
  return {
    variant,
    processMemoryMb, processMemoryRangeMb: [processSamples[0], processSamples.at(-1)],
    heapMb, heapRangeMb: [heapSamples[0], heapSamples.at(-1)], retainedContentMb,
    mountedTurnCount: 12, mutationCount: 62,
    typingP95Ms, typingRangeMs: [typingSamples[0], typingSamples.at(-1)],
    scrollP95Ms, scrollRangeMs: [scrollSamples[0], scrollSamples.at(-1)],
    frameP95Ms: 17, longTaskCount: 0, longTaskTotalMs: 0, longTaskMaxMs: 0,
    bootstrapLongTaskCount: 1, bootstrapLongTaskTotalMs: 120, bootstrapLongTaskMaxMs: 120,
    layoutCount: 12, recalcStyleCount: 18, mappingNodes, samples: 5,
    fullExtensionRuntimeLoaded: installed,
    runtimeVersion: installed ? "0.3.0" : null,
    lowMemoryEnabled: variant.endsWith("-on"),
    enabledCapabilities: installed ? ["foundation", "highlighter", "pdf", "copy-export", "reliability-backend"] : [],
    nonLowMemoryFeatureFlagsHash: installed ? "f".repeat(64) : null,
    sampleSeries: {
      processMemoryMb: processSamples,
      heapMb: heapSamples,
      retainedContentMb: retainedSamples,
      mountedTurnCount: mountedSamples,
      mutationCount: mutationSamples,
      typingP95Ms: typingSamples,
      scrollP95Ms: scrollSamples
    }
  };
}

function controlStress() {
  const scripts = [
    "scripts/foundation-core-fixture-smoke.mjs",
    "scripts/foundation-core-flow-fixture.mjs",
    "scripts/low-memory-fixture-smoke.mjs",
    "scripts/low-memory-page-fixture-smoke.mjs",
    "scripts/popup-render-fixture.mjs"
  ];
  const results = [];
  for (let loop = 1; loop <= 8; loop += 1) for (const script of scripts) results.push({ loop, script, elapsedMs: 100, passed: true });
  return { passed: true, loops: 8, runs: 40, results };
}

function controlHistory() {
  return {
    scrollUpRestoresOlder: true,
    loadFullHistoryPass: true,
    reloadRestoresFullHistory: true,
    disableRestoresFullHistory: true,
    closeOrUninstallRestoresFullHistory: true,
    serverHistoryUnchanged: true
  };
}

function controlConversationExport() {
  return {
    passed: true,
    exactCompletenessProof: true,
    roleAndTurnIdentityBound: true,
    markdownConversation: true,
    pdfConversation: true,
    highlightsShifted: true,
    pdfSettingsConsumed: true,
    answerDocumentTableCellStructure: true,
    tableHighlightPdfInheritance: true,
    structuredTableMath: true,
    markdownTableFormatting: true,
    notionTableEquationMetadata: true,
    pdfInlineSemanticsModel: true,
    unsafePdfLinksRejected: true,
    pdfRenderSemanticsWired: true,
    semanticMathMlCaptured: true,
    nativeMathMlCaptured: true,
    semanticMathMlPdfModel: true,
    semanticMathMlRendered: true,
    unsafeMathMlRejected: true,
    partialMathHighlightFallback: true,
    pdfPageMathMlBudgetEnforced: true,
    lowMemoryRequiresFullHistory: true,
    forgedCompletenessRejected: true,
    streamingAssistantRejected: true,
    duplicateTurnRejected: true,
    duplicateDocumentRejected: true,
    unknownOrOpaqueContentRejected: true,
    unprovenProducerRejected: true,
    unsupportedRoleRejected: true
  };
}

function controlRecoveryLedger() {
  return {
    passed: true,
    firstClaimGranted: true,
    duplicateClaimRejected: true,
    workerRestartDeduplicated: true,
    tabIsolation: true,
    expiredClaimReclaimed: true,
    identityConflictRejected: true,
    invalidClaimRejected: true,
    storageFailureFailClosed: true,
    nativeActionClaimed: true,
    nativeActionDeduplicated: true,
    malformedNativeActionRejected: true,
    confirmedResendClaimed: true,
    historyAppended: true,
    historyDeduplicated: true,
    concurrentHistoryPreserved: true,
    historyBounded: true,
    historyContentExcluded: true,
    tabRemovalCleanup: true
  };
}

function controlRecoveryActions() {
  return {
    schemaVersion: 1,
    subject: "recovery-action-policy",
    passed: true,
    exactEvidenceRequired: true,
    evidenceFreshnessBounded: true,
    recoveryIdentityBound: true,
    scopeIdentityBound: true,
    subjectIdentityBound: true,
    controlIdentityBound: true,
    nativeStopAuthorizedOnce: true,
    assistantRetryAuthorizedOnce: true,
    confirmedUnsentResendAuthorizedOnce: true,
    retryBackoffApplied: true,
    backoffPendingActionRetained: true,
    insufficientBackoffEvidenceRejected: true,
    sensitiveContextRejected: true,
    unknownToolRejected: true,
    nonExactEvidenceRejected: true,
    staleEvidenceRejected: true,
    wrongTurnEvidenceRejected: true,
    wrongScopeEvidenceRejected: true,
    contentExcludedFromClaim: true,
    realControlAdapterIncluded: false
  };
}

function controlTargetSurfaceBackend() {
  return {
    schemaVersion: 1,
    subject: "target-surface-backend",
    passed: true,
    suggestedWorkExactFixtureContract: true,
    ambiguousSuggestedWorkFailsOpen: true,
    recoveryControlSubjectBound: true,
    recoveryControlRevalidatedBeforeClick: true,
    confirmedResendRequiresEmptyComposer: true,
    targetDiagnosticsExcludeVisibleText: true,
    pageWritableFixtureMarkerRejected: true,
    toggleOnHidesExactSurface: true,
    toggleOffRestoresOriginalState: true,
    unrelatedCardsPreserved: true,
    remountReconciled: true,
    noPollingOrOwnObserver: true,
    exactEvidenceSubmittedOnce: true,
    subjectAndControlBoundExecution: true,
    changedControlRejected: true,
    consequentialStateRejected: true,
    retryFallbackSupported: true,
    confirmedUnsentResendSupported: true,
    unknownLiveContractFailsOpen: true,
    answerActionExactAdapterTarget: true,
    singleAnswerActionEntry: true,
    compactAnswerActionMenu: true,
    answerActionDefaultOrdering: true,
    untrustedAnswerActionRejected: true,
    streamingAnswerActionFailsOpen: true,
    ambiguousAnswerActionFailsOpen: true,
    answerActionRemountReconciled: true,
    answerActionToggleRemovesUi: true,
    pageWritableAnswerActionMarkerRejected: true,
    answerActionNoPollingOrTypingListener: true,
    currentSiteAnswerActionContractFailsOpen: true,
    realSuggestedWorkContractIncluded: false,
    realRecoveryControlContractIncluded: false,
    realAnswerActionContractIncluded: false
  };
}

function controlHighlightRecordIntegrity() {
  return {
    schemaVersion: 1,
    subject: "highlight-record-integrity",
    passed: true,
    unifiedAnnotationContract: true,
    legacyRecordsMigrated: true,
    notesBounded: true,
    tagsBounded: true,
    tagsNormalizedAndDeduplicated: true,
    unknownTopLevelFieldsStripped: true,
    unknownAnchorFieldsStripped: true,
    unknownAnnotationFieldsStripped: true,
    mutationHelpersResanitize: true,
    exactAnswerScopedClear: true,
    answerScopeRequiresConversationAndTurn: true,
    answerScopedClearIsolated: true,
    answerScopedClearResanitizes: true,
    oversizedIdentityRejected: true,
    oversizedSourceOffsetsRejected: true,
    chatgptImportExportRoundTrip: true,
    generalWebImportExportRoundTrip: true,
    unknownSensitiveFieldsExcluded: true,
    localOnlyPureModel: true,
    backendInterfaceOnly: true,
    externalServiceAdded: false,
    fullDocumentContentPersisted: false
  };
}

function controlLocalImportIntegrity() {
  return {
    schemaVersion: 1,
    subject: "local-import-integrity",
    passed: true,
    settingsTextBudgetEnforced: true,
    settingsFileBudgetEnforced: true,
    futureSettingsSchemaRejected: true,
    legacySettingsAccepted: true,
    highlightFileBudgetEnforced: true,
    perFamilyRecordBudgetsEnforced: true,
    exactCombinedEnvelopeRequired: true,
    futureHighlightSchemaRejected: true,
    combinedRoundTrip: true,
    legacyFamilyImportsPreserved: true,
    mixedLegacyFamiliesRejected: true,
    deterministicConflictRule: "incoming_over_current_first_incoming_duplicate_wins",
    readBeforeBudgetCheck: false,
    unknownEnvelopeFieldsAccepted: false,
    externalServiceAdded: false,
    unboundedConversationContentImported: false
  };
}

function controlChatgptUiCompatibility() {
  return {
    schemaVersion: 1,
    subject: "chatgpt-ui-compatibility",
    passed: true,
    repositoryVerifyPasses: true,
    committedBootstrapDiffPasses: true,
    formalVerifyCommand: true,
    formalRefreshCommand: true,
    formalDiffCommand: true,
    refreshRequiresExplicitInput: true,
    inputSizeBounded: true,
    privacyViolationsRejected: true,
    contractHashMismatchRejected: true,
    duplicateCapabilitiesRejected: true,
    missingOrUnsupportedExactRejected: true,
    supportedCapabilityDriftDetected: true,
    capabilityDriftIsolated: true,
    unknownNewCapabilityFailsOpen: true,
    compatibleNewVariantReportedWithoutPromotion: true,
    normalizedReportAllowlisted: true,
    browserOpened: false,
    contractAutoUpdated: false,
    liveAcceptanceSatisfied: false
  };
}

function controlActionSecurity() {
  return {
    pageStatusTelemetryTrusted: false,
    recoveryAuthorization: "extension_ui_or_trusted_user_gesture",
    forgedStatusAcceptedAsTelemetry: true,
    syntheticClickPrepareCalls: 0,
    syntheticClickReloads: 0,
    trustedPointerPrepareCalls: 1,
    trustedPointerReloads: 1,
    trustedKeyboardResumeCalls: 1,
    trustedKeyboardReloads: 1
  };
}

async function mutateStress({ bundleDir, manifest }, mutate) {
  const file = path.join(bundleDir, "artifacts", "low-memory-stress.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, JSON.stringify(value));
  manifest.artifacts.find((item) => item.id === "low-memory-stress").sha256 = await sha256File(file);
  evidence(manifest, "low-memory-benefit").measurement.stress = value;
  refreshRoot(manifest);
}

async function mutateLowMemoryPressure({ bundleDir, manifest }, mutate) {
  const file = path.join(bundleDir, "artifacts", "low-memory-pressure.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, JSON.stringify(value));
  manifest.artifacts.find((item) => item.id === "low-memory-pressure").sha256 = await sha256File(file);
  refreshRoot(manifest);
}

async function mutateLowMemoryPage({ bundleDir, manifest }, mutate) {
  const file = path.join(bundleDir, "artifacts", "low-memory-page.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, JSON.stringify(value));
  manifest.artifacts.find((item) => item.id === "low-memory-page").sha256 = await sha256File(file);
  evidence(manifest, "low-memory-benefit").measurement.actionSecurity = value.actionSecurity;
  refreshRoot(manifest);
}

async function mutateHighlighter({ bundleDir, manifest }, mutate) {
  const file = path.join(bundleDir, "artifacts", "highlighter-fixture.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, JSON.stringify(value));
  manifest.artifacts.find((item) => item.id === "highlighter-fixture").sha256 = await sha256File(file);
  refreshRoot(manifest);
}

async function mutatePdfFixture({ bundleDir, manifest }, mutate) {
  const file = path.join(bundleDir, "artifacts", "pdf-fixture.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, JSON.stringify(value));
  manifest.artifacts.find((item) => item.id === "pdf-fixture").sha256 = await sha256File(file);
  refreshRoot(manifest);
}

async function mutateJsonArtifact({ bundleDir, manifest }, artifactId, mutate) {
  const artifact = manifest.artifacts.find((item) => item.id === artifactId);
  const file = path.join(bundleDir, artifact.path);
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, JSON.stringify(value));
  artifact.sha256 = await sha256File(file);
  refreshRoot(manifest);
}

function controlHighlighterFixture() {
  const status = (renderedCount, unresolvedCount, recordCount = 1) => ({ supported: true, localOnly: true, recordCount, renderedCount, unresolvedCount, permanentToolbar: false });
  return {
    passed: true,
    selection: { sequence: ["prose", "inline_math", "prose"], mathTeX: ["x+1"] },
    invalidSelections: {
      composerResult: { ok: false, reason: "unsupported_selection" },
      codeResult: { ok: false, reason: "unsupported_selection" },
      streamingResult: { ok: false, reason: "answer_not_settled" },
      toolbarPresent: false
    },
    keyboard: { result: { ok: true }, activeLabel: "Yellow highlight", dismissedWithEscape: true },
    pdfExportHandoff: { trustedToolbarActionReachedBackground: true, schemaVersion: 1, blockCount: 2, resolvedHighlights: 1, localOnly: true, containsCrossMathText: true },
    refreshed: { status: status(1, 0) },
    remounted: { status: status(1, 0) },
    mathReformatted: { status: status(1, 0) },
    ambiguous: { status: status(0, 1), records: [{ unresolvedReason: "ambiguous_anchor" }] },
    deletedSource: { status: status(0, 1), records: [{ unresolvedReason: "source_missing" }] },
    recolored: { status: status(1, 0), records: [{ color: "mint" }] },
    removed: { status: status(0, 0, 0), records: [] },
    branchResolution: { status: "unresolved", reason: "conversation_mismatch", range: null },
    rawLatexSources: ["a+b", "c=d"],
    invariants: {
      noGlobalRangePatch: true,
      noGlobalSelectionPatch: true,
      noPermanentToolbar: true,
      localStorageOnly: true
    }
  };
}

function controlHighlighterMeasurement() {
  return {
    passed: true,
    selectionSequence: ["prose", "inline_math", "prose"],
    mathTeX: ["x+1"],
    rawLatexSources: ["a+b", "c=d"],
    restoredAfterRefresh: true,
    restoredAfterRemount: true,
    restoredAfterMathReformat: true,
    attachedToWrongText: false,
    ambiguousAnchorStayedUnresolved: true,
    deletedSourceStayedUnresolved: true,
    branchMismatchStayedUnresolved: true,
    invalidSelectionsFailOpen: true,
    keyboardAccessible: true,
    colorOwnership: true,
    deleteOwnership: true,
    localStorageOnly: true,
    noGlobalRangePatch: true,
    noGlobalSelectionPatch: true,
    noPermanentToolbar: true,
    stress: { passed: true, loops: 8, runs: 8 },
    screenshotArtifacts: {
      selectionLight: "highlighter-selection-light",
      activeLight: "highlighter-active-light",
      editDark: "highlighter-edit-dark"
    }
  };
}

function controlHighlighterStress() {
  return {
    passed: true,
    loops: 8,
    runs: 8,
    results: Array.from({ length: 8 }, (_, index) => ({
      loop: index + 1,
      script: "scripts/highlighter-fixture-smoke.mjs",
      elapsedMs: 100,
      passed: true
    }))
  };
}

function controlPdfFixture() {
  return {
    passed: true,
    pdf: { sha256: sha256Text("%PDF-control-selectable-math"), pageCount: 2 },
    pdfJs: {
      version: "5.6.205",
      textExtracted: true,
      searchable: true,
      pointerSelection: true,
      pointerSelectionText: "Before x+1 after",
      trustedPointerEvents: true,
      pointerSequence: ["prose", "inline_math", "prose"],
      displayMathSelection: "E=mc^2",
      mathCopyResult: true
    },
    independentExtraction: { engine: "pdfplumber", textExtracted: true, searchable: true },
    highlights: { preservedInPrintModel: true, crossMath: true, crossPage: true }
  };
}

function controlPdfMeasurement() {
  return {
    textExtracted: true,
    pointerSelection: true,
    trustedPointerEvents: true,
    pointerSequence: ["prose", "inline_math", "prose"],
    displayMathSelectable: true,
    mathCopyResult: true,
    mathSearchable: true,
    independentExtraction: true,
    localExportBoundary: true,
    trustedToolbarHandoff: true,
    highlightPreserved: true,
    crossPageHighlight: true,
    actualViewerEngine: "PDF.js 5.6.205",
    pageCount: 2,
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

function controlPdfBackground() {
  return {
    passed: true,
    trustedSourceOpened: true,
    unsupportedSourceRejected: true,
    oneTimeConsumption: true,
    forgedConsumerRejected: true,
    persistentConversationStorage: false,
    serverUpload: false
  };
}

function controlExtensionInstallSmoke() {
  return {
    passed: true,
    candidate: { version: "0.0.0", buildLabel: "acceptance-control" },
    extension: { actualContentScript: true, actualServiceWorker: true, actualStorage: true, contextMenusReady: true },
    userPath: { trustedRightClickReachedWorker: true, trustedSelectionToolbarCopy: true, realClipboardReadback: true },
    privacy: { normalBrowserProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequestCount: 0, conversationTextIncludedInBackgroundContext: false },
    pageErrors: []
  };
}

function controlFullExtensionE2e(visualHashes) {
  return {
    passed: true,
    candidate: { version: "0.0.0", buildLabel: "acceptance-control" },
    execution: { actualManifest: true, actualContentScripts: true, actualServiceWorker: true, actualStorage: true, networkGuard: "deny-unmatched", unexpectedRequestCount: 0 },
    copy: { realPointerSelection: true, realClipboardReadback: true, targetAnswerOnly: true, richStructurePreserved: true },
    highlighter: {
      actualPointerSelection: true, visibleCssHighlights: true, fourColors: true, recolor: true, deleteOne: true, clearExactAnswer: true,
      refreshRestore: true, hostRemountRestore: true, equivalentMathReformatRestore: true, duplicateTextFailOpen: true,
      sourceDeletionFailOpen: true, branchIsolation: true, conversationIsolation: true, persistedShortcutDefaultColor: true
    },
    pdf: {
      actualUserExportClick: true, actualServiceWorkerHandoff: true, actualSessionStorage: true, temporaryModelConsumed: true,
      actualExtensionPage: true, actualPdfFile: "output/pdf/mica-full-extension-export.pdf", pageCount: 3,
      independentTextExtraction: true, semanticMathMl: true, tableCodeChinese: true,
      installedHighlightRecordCountBeforeExport: 2, resolvedHighlightCount: 1, renderedHighlightMarks: 1,
      highlightVisibleInExportPage: true, currentVersionHighlightResolved: true, sourceMutationFailOpen: true
    },
    popupAndSettings: {
      actualChromeExtensionPage: true, actualActiveTabMessaging: true, settingsPersistence: true, settingsNavigation: true,
      widths: [320, 368, 400], lightDark: true, noHorizontalOverflow: true, accessibleControls: true, unsupportedPageFailOpen: true
    },
    lifecycle: {
      stateDrivenHost: true, fullDomRemounts: true, streamingLifecycle: true, composerVariantRemount: true,
      staleDraftNotRestored: true, readOnlyToolStage: true, virtualizedUnmountRemount: true, routeAndConversationSwitch: true
    },
    workerRestart: { actualWorkerStopped: true, actualWorkerRestarted: true, settingsRecovered: true },
    visual: { status: "MATCH", mismatches: [], current: visualHashes },
    privacy: { normalEdgeProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequests: 0, backgroundConversationTextIncluded: false },
    pageErrors: []
  };
}

function controlLowMemoryExtensionLifecycle() {
  return {
    passed: true,
    candidate: { version: "0.0.0", buildLabel: "acceptance-control" },
    execution: { actualMainWorldRegistration: true, actualPopupAction: true, unexpectedRequestCount: 0 },
    lifecycle: {
      dynamicDisableBeforeNavigation: true, dynamicEnableBeforeNavigation: true, registeredAtDocumentStart: true,
      reactRouterStreamWindowed: true, originalMappingNodes: 121, windowedMappingNodes: 41, fullHistoryMappingNodes: 121,
      actualClientHistoryTruncation: true, completenessProofPreserved: true, realPopupFullHistoryAction: true,
      realPopupResumeAction: true, conversationNavigation: true, serviceWorkerRestart: true,
      persistentRegistrationRecovered: true, dynamicDisableAfterNavigation: true, failOpenAfterDisable: true
    },
    privacy: { normalEdgeProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequests: 0, conversationTextStoredByBackground: false },
    pageErrors: []
  };
}
