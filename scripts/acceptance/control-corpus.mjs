import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EVIDENCE_SCHEMA_VERSION,
  VALIDATOR_VERSION,
  computeEvidenceRootHash,
  computeFixtureSetHash,
  computeValidatorTreeHash,
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
  "copy-placement",
  "core-flow-regression",
  "send-lifecycle-safety",
  "low-memory-benefit",
  "highlight-remount",
  "pdf-selection",
  "privacy",
  "packaging-version"
];

export async function runControlCorpus(repoRoot) {
  const catalog = JSON.parse(await readFile(path.join(repoRoot, "acceptance", "controls", "catalog.json"), "utf8"));
  const scenarios = new Map([
    ["complete-measured-bundle", async () => {}],
    ["known-good-current-popup", async (context) => { context.requestedGateIds = ["popup-render"]; }],
    ["known-good-adapter-contract", async (context) => { context.requestedGateIds = ["adapter-contract"]; }],
    ["known-good-low-memory-fixture", async (context) => { context.requestedGateIds = ["low-memory-benefit"]; }],
    ["known-good-selectable-math-pdf", async (context) => { context.requestedGateIds = ["pdf-selection"]; }],
    ["missing-evidence", async ({ manifest }) => { manifest.evidence = manifest.evidence.filter((item) => item.gateId !== "popup-render"); refreshRoot(manifest); }],
    ["tampered-artifact", async ({ bundleDir }) => { await writeFile(path.join(bundleDir, "artifacts", "dist.zip"), "tampered dist"); }],
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
    ["historical-copy-misplacement", async ({ manifest }) => { evidence(manifest, "copy-placement").measurement.clusterProven = false; refreshRoot(manifest); }],
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
    ["lost-highlight-after-remount", async ({ manifest }) => { evidence(manifest, "highlight-remount").measurement.restoredAfterRemount = false; refreshRoot(manifest); }],
    ["non-selectable-inline-math-pdf", async ({ manifest }) => { evidence(manifest, "pdf-selection").measurement.pointerSelection = false; refreshRoot(manifest); }],
    ["stale-chatgpt-contract", async ({ manifest }) => { evidence(manifest, "adapter-contract").measurement.capabilities[0].invalidatedBy = ["newer incompatible surface"]; refreshRoot(manifest); }],
    ["control-bundle-presented-as-candidate", async (context) => { context.expectedBundleKind = "candidate"; }],
    ["copy-serialization-output-mismatch", async ({ manifest }) => { evidence(manifest, "copy-serialization").measurement.cases[0].actualArtifactId = "copy-rich-actual"; refreshRoot(manifest); }],
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

  const artifactSources = [
    ["dist", "artifacts/dist.zip", "application/zip", "known-good-dist"],
    ["popup-light", "artifacts/popup-light.png", "image/png", "known-good-popup-light"],
    ["popup-dark", "artifacts/popup-dark.png", "image/png", "known-good-popup-dark"],
    ["chatgpt-contract", "artifacts/chatgpt-contract.json", "application/json", JSON.stringify({
      capabilities: [{ capabilityId: "turns.list", sourceCapabilityId: "conversation-turn-discovery", sourceEvidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", requiredSourceObservationIds: ["ordered-turn-containers"], variantId: "public-shared-v1", status: "EXACT", requiredInvariants: ["ordered turns", "role ownership"] }]
    })],
    ["current-chatgpt-bootstrap", "artifacts/current-chatgpt-bootstrap.json", "application/json", JSON.stringify({
      surfaces: [{ id: "public-shared-conversation", evidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", observed: { turnContainer: { mountedCount: 7 } } }],
      capabilities: [{ id: "conversation-turn-discovery", status: "EXACT", evidenceClass: "REAL_CHATGPT_PUBLIC_SHARED", observations: [{ id: "ordered-turn-containers", assertions: [{ surfaceId: "public-shared-conversation", path: "observed.turnContainer.mountedCount", equals: 7 }] }] }],
      gate: { bootstrapEvidence: "PASS", oldSurfaceAtlasUsedAsCurrentEvidence: false }
    })],
    ["pdf", "artifacts/output.pdf", "application/pdf", "%PDF-control-selectable-math"],
    ["privacy-report", "artifacts/privacy.json", "application/json", "known-good-privacy-report"],
    ["copy-plain-expected", "artifacts/copy-plain-expected.txt", "text/plain", "plain markdown output"],
    ["copy-plain-actual", "artifacts/copy-plain-actual.txt", "text/plain", "plain markdown output"],
    ["copy-rich-expected", "artifacts/copy-rich-expected.html", "text/html", "<p>rich html output</p>"],
    ["copy-rich-actual", "artifacts/copy-rich-actual.html", "text/html", "<p>rich html output</p>"],
    ["copy-mixed-expected", "artifacts/copy-mixed-expected.txt", "text/plain", "math code table output"],
    ["copy-mixed-actual", "artifacts/copy-mixed-actual.txt", "text/plain", "math code table output"],
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
      coreFlows: { composer: true, send: true, streaming: true, editBranch: true, connector: true, toolFileAuth: true },
      sendLifecycle: { progressObserved: true, autoResendObserved: false, consequentialFlowActive: true, userTurnCommitted: true, duplicateSendObserved: false },
      report: { privacy: { conversationTextIncluded: false, attachmentContentIncluded: false, requestBodyIncluded: false, authTokenIncluded: false, rawDomIncluded: false } }
    })]
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
      capabilities: [{
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
      }]
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
    record("copy-placement", { surface: "assistant-action-cluster" }, ["chatgpt-contract"], {
      actionInjected: true,
      exactAssistantTurn: true,
      clusterProven: true,
      siblingRelationship: true,
      visibleBaseline: true
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
    record("low-memory-benefit", { surface: "target-low-memory-device" }, ["dist"], {
      A: { variant: "mica-absent-or-disabled", processMemoryMb: 1000, processMemoryRangeMb: [970, 1035], heapMb: 500, heapRangeMb: [485, 520], retainedContentMb: 420, mountedTurnCount: 240, mutationCount: 1200, typingP95Ms: 20, typingRangeMs: [18, 22], scrollP95Ms: 24, scrollRangeMs: [22, 27], samples: 5 },
      B: { variant: "mica-installed-low-memory-off", processMemoryMb: 980, processMemoryRangeMb: [955, 1010], heapMb: 490, heapRangeMb: [475, 510], retainedContentMb: 410, mountedTurnCount: 236, mutationCount: 1180, typingP95Ms: 20, typingRangeMs: [18, 22], scrollP95Ms: 24, scrollRangeMs: [22, 27], samples: 5 },
      C: { variant: "mica-installed-low-memory-on", processMemoryMb: 760, processMemoryRangeMb: [735, 790], heapMb: 350, heapRangeMb: [335, 370], retainedContentMb: 250, mountedTurnCount: 40, mutationCount: 680, typingP95Ms: 21, typingRangeMs: [19, 23], scrollP95Ms: 25, scrollRangeMs: [23, 28], samples: 5 },
      recentTurnLimit: 40,
      threadProfiles: [
        { name: "short", totalTurns: 12, retainedRecentTurns: 12, mountedBefore: 12, mountedAfter: 12, modeApplied: false },
        { name: "medium", totalTurns: 36, retainedRecentTurns: 36, mountedBefore: 36, mountedAfter: 36, modeApplied: false },
        { name: "long", totalTurns: 240, retainedRecentTurns: 40, mountedBefore: 236, mountedAfter: 40, modeApplied: true }
      ],
      pressureFixture: { memoryLimitMb: 2048, payloadMb: 420, turns: 240 },
      targetDevice: { class: "2-gb-low-memory-target", browserBuild: "control-browser-1", memoryGb: 2 },
      actualTruncation: true,
      truncatedRepresentation: "client-history-window",
      reactManagedInteractiveNodesDetached: false,
      serverMutation: false,
      history: { scrollUpRestoresOlder: true, loadFullHistoryPass: true, reloadRestoresFullHistory: true, disableRestoresFullHistory: true, closeOrUninstallRestoresFullHistory: true, serverHistoryUnchanged: true },
      coreFlows: { composer: true, send: true, streaming: true, editBranch: true, connector: true, toolFileAuth: true, typingImeHotPath: true },
      unknownStructureBehavior: "FAIL_OPEN"
    }),
    record("highlight-remount", { surface: "local-real-browser" }, ["dist"], {
      restoredAfterRemount: true,
      attachedToWrongText: false,
      ambiguousAnchorStayedUnresolved: true
    }),
    record("pdf-selection", { surface: "actual-pdf-viewer" }, ["pdf"], {
      textExtracted: true,
      pointerSelection: true,
      pointerSequence: ["prose", "inline_math", "prose"],
      displayMathSelectable: true,
      mathCopyResult: true,
      mathSearchable: true,
      highlightPreserved: true
    }),
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
    requiredGates: ALL_GATES,
    artifacts,
    evidence: records
  };
  return { tempRoot, bundleDir, manifest };
}

function record(gateId, subject, artifactIds, measurement) {
  return {
    id: `${gateId}-control-evidence`,
    gateId,
    evidenceClass: "SYNTHETIC_FIXTURE",
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
