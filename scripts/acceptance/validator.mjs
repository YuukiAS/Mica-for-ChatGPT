import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const VALIDATOR_VERSION = "1.9.0";
export const EVIDENCE_SCHEMA_VERSION = 1;
const PLACEMENT_PROOF_OBSERVATION_IDS = [
  "copy-inside-assistant-turn",
  "action-cluster-parent",
  "copy-sibling-insertion",
  "visible-size-baseline"
];

const FOUNDATION_GATES = [
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

const ACCEPTANCE_PROFILES = {
  foundation: FOUNDATION_GATES,
  "milestone-a": [...FOUNDATION_GATES, "low-memory-benefit"],
  "milestone-b": [...FOUNDATION_GATES, "low-memory-benefit", "highlight-remount", "pdf-selection"],
  "release-0.3.0": [...FOUNDATION_GATES, "low-memory-benefit", "highlight-remount", "pdf-selection"],
  "functional-convergence": [...FOUNDATION_GATES, "low-memory-benefit", "highlight-remount", "pdf-selection", "conversation-export-completeness", "recovery-deduplication", "recovery-action-safety", "target-surface-backend"],
  "all-controls": [...FOUNDATION_GATES, "copy-serialization", "conversation-export-completeness", "recovery-deduplication", "recovery-action-safety", "target-surface-backend", "low-memory-benefit", "highlight-remount", "pdf-selection"]
};

const EVIDENCE_CLASSES = new Set([
  "SYNTHETIC_FIXTURE",
  "LOCAL_REAL_BROWSER",
  "REAL_DERIVED_CURRENT_CHATGPT",
  "CURRENT_CHATGPT_READ_ONLY",
  "CURRENT_CHATGPT_BOUNDED_ACTION",
  "TARGET_CLASS_ENVIRONMENT",
  "TARGET_LOW_MEMORY_DEVICE",
  "ACTUAL_PDF_VIEWER",
  "REAL_NOTION_TARGET"
]);

export async function validateBundle(repoRoot, bundleDir, requestedGateIds = null, options = {}) {
  const errors = [];
  const manifestPath = path.join(bundleDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return result(false, [`missing or invalid manifest.json: ${error?.message || error}`]);
  }

  const contracts = JSON.parse(await readFile(path.join(repoRoot, "acceptance", "contracts.json"), "utf8"));
  const contractById = new Map(contracts.gates.map((gate) => [gate.id, gate]));
  if (contracts.schemaVersion !== 1) errors.push("acceptance contracts schemaVersion must be 1");
  if (contracts.validatorVersion !== VALIDATOR_VERSION) errors.push("acceptance contracts validator version mismatch");
  if (contracts.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION) errors.push("acceptance contracts evidence schema version mismatch");
  if (contracts.controlsUseProductionValidators !== true) errors.push("acceptance controls must use production validators");
  if (contractById.size !== contracts.gates.length) errors.push("acceptance contracts contain duplicate gate ids");

  if (manifest.schemaVersion !== 1) errors.push("manifest schemaVersion must be 1");
  if (!["candidate", "control"].includes(manifest.bundleKind)) errors.push("bundleKind must be candidate or control");
  if (options.expectedBundleKind && manifest.bundleKind !== options.expectedBundleKind) {
    errors.push(`bundleKind ${manifest.bundleKind || "<missing>"} does not match required ${options.expectedBundleKind}`);
  }
  if (manifest.evidenceSchemaVersion !== EVIDENCE_SCHEMA_VERSION) errors.push("evidence schema version mismatch");
  if (manifest.validator?.version !== VALIDATOR_VERSION) errors.push("validator version mismatch");
  if (!isSha256(manifest.chatgptContractHash)) errors.push("ChatGPT contract hash missing or invalid");

  const currentTreeHash = await computeValidatorTreeHash(repoRoot);
  const currentFixtureSetHash = await computeFixtureSetHash(repoRoot);
  if (manifest.validator?.treeHash !== currentTreeHash) errors.push("validator tree hash mismatch");
  if (manifest.fixtureSetHash !== currentFixtureSetHash) errors.push("fixture set hash mismatch");

  validateCandidateShape(manifest.candidate, errors);

  const artifacts = new Map();
  const artifactPaths = new Set();
  for (const artifact of manifest.artifacts || []) {
    if (!artifact?.id || artifacts.has(artifact.id)) {
      errors.push(`duplicate or missing artifact id: ${artifact?.id || "<missing>"}`);
      continue;
    }
    if (!isSha256(artifact.sha256)) errors.push(`artifact ${artifact.id} has invalid sha256`);
    if (!isSafeRelativePath(artifact.path)) {
      errors.push(`artifact ${artifact.id} has unsafe path`);
      continue;
    }
    const normalizedPath = artifact.path.replaceAll("\\", "/").toLowerCase();
    if (artifactPaths.has(normalizedPath)) errors.push(`artifact ${artifact.id} reuses path ${artifact.path}`);
    artifactPaths.add(normalizedPath);
    const absolute = path.resolve(bundleDir, artifact.path);
    if (!isWithin(bundleDir, absolute)) {
      errors.push(`artifact ${artifact.id} escapes bundle root`);
      continue;
    }
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) {
        errors.push(`artifact ${artifact.id} is not a regular file`);
        continue;
      }
      const actualHash = await sha256File(absolute);
      if (actualHash !== artifact.sha256) errors.push(`artifact ${artifact.id} hash mismatch`);
    } catch (error) {
      errors.push(`artifact ${artifact.id} unavailable: ${error?.message || error}`);
    }
    artifacts.set(artifact.id, artifact);
  }

  const distArtifact = artifacts.get(manifest.candidate?.distArtifactId);
  if (!distArtifact) errors.push("candidate dist artifact is missing");
  if (distArtifact && distArtifact.sha256 !== manifest.candidate?.distHash) errors.push("candidate dist hash mismatch");
  const chatgptContractArtifact = artifacts.get(manifest.chatgptContractArtifactId);
  if (!chatgptContractArtifact) errors.push("ChatGPT contract artifact is missing");
  if (chatgptContractArtifact && chatgptContractArtifact.sha256 !== manifest.chatgptContractHash) {
    errors.push("ChatGPT contract hash mismatch");
  }

  const evidence = Array.isArray(manifest.evidence) ? manifest.evidence : [];
  const evidenceIds = new Set();
  const evidenceGateIds = new Set();
  for (const record of evidence) {
    if (!record?.id || evidenceIds.has(record.id)) errors.push(`duplicate or missing evidence id: ${record?.id || "<missing>"}`);
    evidenceIds.add(record?.id);
    if (!contractById.has(record?.gateId)) errors.push(`evidence ${record?.id || "<missing>"} has unknown gateId ${record?.gateId || "<missing>"}`);
    if (evidenceGateIds.has(record?.gateId)) errors.push(`gate ${record?.gateId || "<missing>"} has duplicate evidence records`);
    evidenceGateIds.add(record?.gateId);
    if (!EVIDENCE_CLASSES.has(record?.evidenceClass)) errors.push(`evidence ${record?.id || "<missing>"} has invalid evidenceClass`);
    if (!record?.subject || typeof record.subject !== "object") errors.push(`evidence ${record?.id || "<missing>"} missing subject`);
    if (!record?.measurement || typeof record.measurement !== "object") errors.push(`evidence ${record?.id || "<missing>"} missing measurement`);
    if (!Array.isArray(record?.artifactIds)) errors.push(`evidence ${record?.id || "<missing>"} artifactIds must be an array`);
    for (const artifactId of record?.artifactIds || []) {
      if (!artifacts.has(artifactId)) errors.push(`evidence ${record.id} references missing artifact ${artifactId}`);
    }
  }

  const expectedEvidenceRoot = computeEvidenceRootHash(manifest.artifacts || [], evidence);
  if (manifest.evidenceRootHash !== expectedEvidenceRoot) errors.push("evidence root hash mismatch");

  if (manifest.reportContext?.candidateCommit !== manifest.candidate?.commit) errors.push("stale prior-candidate report commit");
  if (manifest.reportContext?.distHash !== manifest.candidate?.distHash) errors.push("stale prior-candidate report dist hash");

  const requiredGateIds = requestedGateIds || manifest.requiredGates;
  if (!Array.isArray(requiredGateIds) || requiredGateIds.length === 0) errors.push("requiredGates must be a non-empty array");
  const profileGates = ACCEPTANCE_PROFILES[manifest.acceptanceProfile];
  if (!profileGates) {
    errors.push(`unknown acceptance profile ${manifest.acceptanceProfile || "<missing>"}`);
  } else if (!sameSet(manifest.requiredGates, profileGates)) {
    errors.push(`requiredGates do not match acceptance profile ${manifest.acceptanceProfile}`);
  }
  if (Array.isArray(requiredGateIds) && new Set(requiredGateIds).size !== requiredGateIds.length) errors.push("requiredGates contains duplicates");
  if (requestedGateIds && profileGates && requestedGateIds.some((gateId) => !profileGates.includes(gateId))) {
    errors.push("focused gate is not part of the bundle acceptance profile");
  }

  for (const gateId of requiredGateIds || []) {
    const contract = contractById.get(gateId);
    if (!contract) {
      errors.push(`unknown required gate ${gateId}`);
      continue;
    }
    const records = evidence.filter((record) => record.gateId === gateId);
    if (records.length !== 1) {
      errors.push(`gate ${gateId} requires exactly one evidence record`);
      continue;
    }
    const record = records[0];
    if (manifest.bundleKind === "candidate" && !contract.candidateEvidenceClasses.includes(record.evidenceClass)) {
      errors.push(`gate ${gateId} evidence class ${record.evidenceClass} is below the candidate minimum`);
    }
    await validateMeasurement(contract.validatorKind, record, manifest, artifacts, bundleDir, errors);
  }

  return result(errors.length === 0, errors, {
    validatorVersion: VALIDATOR_VERSION,
    validatorTreeHash: currentTreeHash,
    fixtureSetHash: currentFixtureSetHash,
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    requiredGateIds: requiredGateIds || []
  });
}

async function validateMeasurement(kind, record, manifest, artifacts, bundleDir, errors) {
  const m = record.measurement || {};
  const fail = (message) => errors.push(`${record.gateId}: ${message}`);
  const readBoundJson = async (artifactId) => {
    if (!(record.artifactIds || []).includes(artifactId)) {
      fail(`measurement is not bound to ${artifactId}`);
      return null;
    }
    const artifact = artifacts.get(artifactId);
    if (!artifact) {
      fail(`artifact ${artifactId} is missing`);
      return null;
    }
    try {
      return JSON.parse(await readArtifactText(bundleDir, artifact));
    } catch (_error) {
      fail(`artifact ${artifactId} is not valid JSON`);
      return null;
    }
  };

  if (kind === "candidate-identity") {
    if (m.commit !== manifest.candidate?.commit) fail("measurement commit does not match candidate");
    if (m.distHash !== manifest.candidate?.distHash) fail("measurement dist hash does not match candidate");
    return;
  }

  if (kind === "popup-render") {
    const measured = await readBoundJson("popup-render");
    if (record.subject?.surface !== "actual-extension-popup") fail("wrong page/surface target");
    const requiredStates = ["loading", "exact", "compatible", "unknown", "unsupported", "disabled", "contentUnavailable"];
    if (!includesAll(m.states, requiredStates)) fail("required popup states were not rendered");
    if (!includesAll(m.widthsPx, [320, 340, 368, 400])) fail("required popup widths were not rendered");
    if (!includesAll(m.scalesPercent, [100, 125, 150])) fail("required popup scales were not rendered");
    if (!m.keyboard?.focusTraversal || !m.keyboard?.accessibleNames) fail("keyboard/accessibility evidence missing");
    if (!m.secondaryFocus?.troubleshootingToIndex || !m.secondaryFocus?.qaToTroubleshooting) fail("secondary-view focus return evidence missing");
    if (!measured?.passed || !sameJson(m.states, measured.states) || !sameJson(m.widthsPx, measured.widthsPx) || !sameJson(m.scalesPercent, measured.scalesPercent) || !sameJson(m.keyboard, measured.keyboard) || !sameJson(m.secondaryFocus, measured.focusReturn)) {
      fail("popup measurement does not match the bound browser evidence");
    }
    const light = artifacts.get(m.themeArtifacts?.light);
    const dark = artifacts.get(m.themeArtifacts?.dark);
    if (!light || !dark) fail("light/dark screenshot artifacts missing");
    if (light && dark && light.sha256 === dark.sha256) fail("duplicate screenshot/crop used for distinct popup surfaces");
    return;
  }

  if (kind === "adapter-contract") {
    const contract = await readBoundJson("chatgpt-contract");
    const bootstrap = await readBoundJson("current-chatgpt-bootstrap");
    const foundationCore = await readBoundJson("foundation-core");
    if (record.subject?.surface !== "current-chatgpt") fail("wrong ChatGPT contract surface");
    if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) fail("capability measurements missing");
    const declaredCapabilities = Array.isArray(contract?.capabilities) ? contract.capabilities : [];
    const measuredCapabilityIds = (m.capabilities || []).map((item) => item?.capabilityId);
    const declaredCapabilityIds = declaredCapabilities.map((item) => item?.capabilityId);
    const bootstrapCapabilityIds = (bootstrap?.capabilities || []).map((item) => item?.id);
    if (!uniqueStrings(declaredCapabilityIds)) fail("bound contract capability IDs must be present and unique");
    if (!uniqueStrings(measuredCapabilityIds)) fail("measured capability IDs must be present and unique");
    if (!uniqueStrings(bootstrapCapabilityIds)) fail("bootstrap capability IDs must be present and unique");
    if (!sameSet(measuredCapabilityIds, declaredCapabilityIds)) fail("measured capability set does not match the bound contract capability set");
    for (const capability of m.capabilities || []) {
      if (!capability.capabilityId || !capability.variantId) fail("capability identity missing");
      if (!["EXACT", "COMPATIBLE", "UNKNOWN"].includes(capability.status)) fail(`capability ${capability.capabilityId} has invalid status`);
      if (!isSha256(capability.contractHash) || !isSha256(capability.sourceArtifactHash)) fail(`capability ${capability.capabilityId} hash identity missing`);
      if (["EXACT", "COMPATIBLE"].includes(capability.status)) {
        if (!Array.isArray(capability.requiredInvariants) || capability.requiredInvariants.length === 0) fail(`capability ${capability.capabilityId} required invariant contract is empty`);
        if (!Array.isArray(capability.requiredSourceObservationIds) || capability.requiredSourceObservationIds.length === 0) fail(`capability ${capability.capabilityId} source observation contract is empty`);
        if ((capability.invalidatedBy || []).length > 0) fail(`capability ${capability.capabilityId} is stale or invalidated`);
      } else if (capability.failOpen !== true) {
        fail(`unknown capability ${capability.capabilityId} must fail open`);
      }
      const source = (record.artifactIds || []).map((id) => artifacts.get(id)).find((artifact) => artifact?.sha256 === capability.sourceArtifactHash);
      if (!source) fail(`capability ${capability.capabilityId} source artifact hash is not bound to evidence`);
      if (source?.id !== "current-chatgpt-bootstrap") fail(`capability ${capability.capabilityId} is not bound to current bootstrap evidence`);
      const declared = declaredCapabilities.find((item) => item.capabilityId === capability.capabilityId);
      if (!declared || declared.sourceCapabilityId !== capability.sourceCapabilityId || declared.sourceEvidenceClass !== capability.sourceEvidenceClass || declared.variantId !== capability.variantId || declared.status !== capability.status || !sameJson(declared.requiredInvariants || [], capability.requiredInvariants || []) || !sameJson(declared.requiredSourceObservationIds || [], capability.requiredSourceObservationIds || [])) {
        fail(`capability ${capability.capabilityId} differs from the bound contract artifact`);
      }
      const sourceCapability = bootstrap?.capabilities?.find((item) => item.id === capability.sourceCapabilityId);
      if (!sourceCapability || !bootstrapStatusSupportsContract(sourceCapability.status, capability.status)) {
        fail(`capability ${capability.capabilityId} is not supported by its current bootstrap capability`);
      }
      if (sourceCapability?.evidenceClass !== capability.sourceEvidenceClass) fail(`capability ${capability.capabilityId} evidence class differs from current bootstrap`);
      const sourceObservationIds = (sourceCapability?.observations || []).map((item) => item?.id);
      if (!uniqueStrings(sourceObservationIds)) fail(`capability ${capability.capabilityId} bootstrap observation IDs must be present and unique`);
      const requiredObservationIds = capability.requiredSourceObservationIds || [];
      if (!uniqueStrings(requiredObservationIds)) fail(`capability ${capability.capabilityId} required source observation IDs must be unique`);
      if (!includesAll(sourceObservationIds, requiredObservationIds)) fail(`capability ${capability.capabilityId} references a missing bootstrap observation`);
      const provenObservationIds = requiredObservationIds.filter((id) => {
        const observation = sourceCapability?.observations?.find((item) => item.id === id);
        return observation && bootstrapObservationPasses(bootstrap, observation);
      });
      if (!sameJson(capability.observedInvariants || [], provenObservationIds) || !sameJson(requiredObservationIds, provenObservationIds)) {
        fail(`capability ${capability.capabilityId} observed invariants are not mechanically proven by current bootstrap surfaces`);
      }
    }
    if (manifest.chatgptContractHash !== artifacts.get("chatgpt-contract")?.sha256) fail("manifest contract hash is not the bound contract artifact hash");
    if (bootstrap?.gate?.bootstrapEvidence !== "PASS" || bootstrap?.gate?.oldSurfaceAtlasUsedAsCurrentEvidence !== false) fail("current bootstrap evidence identity is invalid");
    if (foundationCore?.mixedStructureStatus !== "UNKNOWN" || foundationCore?.toolStructureStatus !== "UNKNOWN") fail("adapter partial/mixed turn fail-open evidence is missing");
    return;
  }

  if (kind === "answer-document-core") {
    const measured = await readBoundJson("foundation-core");
    const requiredFields = ["documentId", "conversationId", "turnId", "sourceVersion", "generationState", "orderedBlocks"];
    if (!includesAll(m.documentFields, requiredFields)) fail("AnswerDocument fields missing");
    const requiredKinds = ["heading", "paragraph", "list", "quote", "table", "code", "inline_math", "display_math", "link", "image", "citation", "opaque_interactive", "unknown_block"];
    if (!includesAll(m.blockKinds, requiredKinds)) fail("AnswerDocument block-kind coverage missing");
    if (!m.streamingIsProvisional || !m.settledIsDurable || !m.unknownLifecycleRejected || !m.opaqueInteractive || !m.singleAdapterProducer) fail("AnswerDocument lifecycle/ownership invariant missing");
    const measuredKinds = [...(measured?.blockKinds || []), ...(measured?.inlineKinds || [])];
    if (!measured?.passed || !includesAll(measuredKinds, requiredKinds)) fail("bound AnswerDocument evidence lacks required block coverage");
    if (measured?.lifecycle?.streamingDurable !== false || measured?.lifecycle?.settledDurable !== true || measured?.lifecycle?.unknownModelRejected !== true || measured?.lifecycle?.callerCannotForceSettled !== true || measured?.lifecycle?.singleAdapterProducer !== true) {
      fail("bound AnswerDocument evidence does not prove lifecycle/ownership safety");
    }
    if (!sameJson([...new Set(m.blockKinds)].sort(), [...new Set(measuredKinds)].sort())) fail("AnswerDocument measurement differs from bound browser evidence");
    return;
  }

  if (kind === "copy-serialization") {
    if (record.subject?.surface !== "answer-document-serializer") fail("wrong serializer surface target");
    const requiredCases = ["plain-markdown", "rich-html", "mixed-math-code-table"];
    const cases = Array.isArray(m.cases) ? m.cases : [];
    if (!includesAll(cases.map((item) => item?.id), requiredCases)) fail("required serialization cases missing");
    for (const item of cases) {
      const expected = artifacts.get(item?.expectedArtifactId);
      const actual = artifacts.get(item?.actualArtifactId);
      if (item?.expectedArtifactId === item?.actualArtifactId) fail(`serialization case ${item?.id || "<missing>"} reuses one artifact as expected and actual`);
      if (!expected || !actual) {
        fail(`serialization case ${item?.id || "<missing>"} artifact pair missing`);
      } else if (expected.path === actual.path) {
        fail(`serialization case ${item.id} reuses one path as expected and actual`);
      } else if (expected.sha256 !== actual.sha256) {
        fail(`serialization case ${item.id} output differs from expected artifact`);
      }
    }
    return;
  }

  if (kind === "conversation-export-completeness") {
    const measured = await readBoundJson("conversation-export");
    if (record.subject?.surface !== "conversation-export-coordinator") fail("wrong conversation export surface target");
    if (!sameJson(m, measured)) fail("conversation export measurement differs from the bound fixture evidence");
    for (const field of [
      "passed",
      "exactCompletenessProof",
      "roleAndTurnIdentityBound",
      "markdownConversation",
      "pdfConversation",
      "highlightsShifted",
      "lowMemoryRequiresFullHistory",
      "forgedCompletenessRejected",
      "streamingAssistantRejected"
    ]) {
      if (m[field] !== true) fail(`conversation export invariant ${field} failed`);
    }
    return;
  }

  if (kind === "recovery-deduplication") {
    const measured = await readBoundJson("recovery-ledger");
    if (record.subject?.surface !== "recovery-service-worker-ledger") fail("wrong recovery ledger surface target");
    if (!sameJson(m, measured)) fail("recovery ledger measurement differs from the bound fixture evidence");
    for (const field of [
      "passed",
      "firstClaimGranted",
      "duplicateClaimRejected",
      "workerRestartDeduplicated",
      "tabIsolation",
      "expiredClaimReclaimed",
      "identityConflictRejected",
      "invalidClaimRejected",
      "storageFailureFailClosed",
      "nativeActionClaimed",
      "nativeActionDeduplicated",
      "malformedNativeActionRejected",
      "confirmedResendClaimed",
      "historyAppended",
      "historyDeduplicated",
      "concurrentHistoryPreserved",
      "historyBounded",
      "historyContentExcluded",
      "tabRemovalCleanup"
    ]) {
      if (m[field] !== true) fail(`recovery ledger invariant ${field} failed`);
    }
    return;
  }

  if (kind === "recovery-action-safety") {
    const measured = await readBoundJson("recovery-actions");
    if (record.subject?.surface !== "recovery-action-policy") fail("wrong recovery action policy surface target");
    if (!sameJson(m, measured)) fail("recovery action measurement differs from the bound fixture evidence");
    for (const field of [
      "passed",
      "exactEvidenceRequired",
      "evidenceFreshnessBounded",
      "recoveryIdentityBound",
      "scopeIdentityBound",
      "subjectIdentityBound",
      "controlIdentityBound",
      "nativeStopAuthorizedOnce",
      "assistantRetryAuthorizedOnce",
      "confirmedUnsentResendAuthorizedOnce",
      "retryBackoffApplied",
      "backoffPendingActionRetained",
      "insufficientBackoffEvidenceRejected",
      "sensitiveContextRejected",
      "unknownToolRejected",
      "nonExactEvidenceRejected",
      "staleEvidenceRejected",
      "wrongTurnEvidenceRejected",
      "wrongScopeEvidenceRejected",
      "contentExcludedFromClaim"
    ]) {
      if (m[field] !== true) fail(`recovery action invariant ${field} failed`);
    }
    if (m.realControlAdapterIncluded !== false) fail("synthetic recovery action evidence overclaimed a real control adapter");
    return;
  }

  if (kind === "target-surface-backend") {
    const measured = await readBoundJson("target-surface-backend");
    if (record.subject?.surface !== "target-surface-backend") fail("wrong target-surface backend target");
    if (!sameJson(m, measured)) fail("target-surface backend measurement differs from the bound fixture evidence");
    for (const field of [
      "passed",
      "suggestedWorkExactFixtureContract",
      "ambiguousSuggestedWorkFailsOpen",
      "recoveryControlSubjectBound",
      "recoveryControlRevalidatedBeforeClick",
      "confirmedResendRequiresEmptyComposer",
      "targetDiagnosticsExcludeVisibleText",
      "pageWritableFixtureMarkerRejected",
      "toggleOnHidesExactSurface",
      "toggleOffRestoresOriginalState",
      "unrelatedCardsPreserved",
      "remountReconciled",
      "noPollingOrOwnObserver",
      "exactEvidenceSubmittedOnce",
      "subjectAndControlBoundExecution",
      "changedControlRejected",
      "consequentialStateRejected",
      "retryFallbackSupported",
      "confirmedUnsentResendSupported",
      "unknownLiveContractFailsOpen"
    ]) {
      if (m[field] !== true) fail(`target-surface backend invariant ${field} failed`);
    }
    if (m.realSuggestedWorkContractIncluded !== false || m.realRecoveryControlContractIncluded !== false) {
      fail("synthetic target-surface evidence overclaimed a real current-site contract");
    }
    return;
  }

  if (kind === "copy-placement") {
    const contract = await readBoundJson("chatgpt-contract");
    const bootstrap = await readBoundJson("current-chatgpt-bootstrap");
    const declared = contract?.capabilities?.find((item) => item.capabilityId === "answer.actionCluster");
    const sourceCapability = bootstrap?.capabilities?.find((item) => item.id === declared?.sourceCapabilityId);
    const observationIds = declared?.requiredSourceObservationIds || [];
    const placementProven = declared?.status === "EXACT" && sameSet(observationIds, PLACEMENT_PROOF_OBSERVATION_IDS) && observationIds.every((id) => {
      const observation = sourceCapability?.observations?.find((item) => item.id === id);
      return observation && bootstrapObservationPasses(bootstrap, observation);
    });
    const expected = {
      actionInjected: false,
      capabilityStatus: declared?.status || "UNKNOWN",
      placementProven,
      exactAssistantTurn: placementProven,
      clusterProven: placementProven,
      siblingRelationship: placementProven,
      visibleBaseline: placementProven,
      failOpen: !placementProven
    };
    if (!sameJson(m, expected)) fail("copy placement measurement is not mechanically derived from the bound contract/bootstrap evidence");
    if (m.actionInjected && !placementProven) fail("historical Copy/Mica action misplacement was not rejected");
    return;
  }

  if (kind === "core-flow-regression") {
    const measured = await readBoundJson("foundation-flows");
    for (const flow of ["composer", "send", "streaming", "editBranch", "connector", "toolFileAuth"]) {
      if (m[flow] !== true) fail(`${flow} regression evidence failed`);
      if (measured?.coreFlows?.[flow] !== m[flow]) fail(`${flow} measurement differs from bound browser evidence`);
    }
    if (!measured?.passed) fail("bound core-flow evidence did not pass");
    return;
  }

  if (kind === "send-lifecycle-safety") {
    const measured = await readBoundJson("foundation-flows");
    if (m.progressObserved && m.autoResend) fail("fake-waiting lifecycle would resend while progress exists");
    if (m.consequentialFlowActive && m.autoResend) fail("consequential flow would be auto-resent");
    if (m.userTurnCommitted && m.duplicateSend) fail("committed turn would be duplicated");
    const expected = {
      progressObserved: measured?.sendLifecycle?.progressObserved === true,
      autoResend: measured?.sendLifecycle?.autoResendObserved === true,
      consequentialFlowActive: measured?.sendLifecycle?.consequentialFlowActive === true,
      userTurnCommitted: measured?.sendLifecycle?.userTurnCommitted === true,
      duplicateSend: measured?.sendLifecycle?.duplicateSendObserved === true
    };
    if (!measured?.passed || !sameJson(m, expected)) fail("send-lifecycle measurement differs from bound browser evidence");
    return;
  }

  if (kind === "low-memory-benefit") {
    const pressure = await readBoundJson("low-memory-pressure");
    const fixture = await readBoundJson("low-memory-fixture");
    const page = await readBoundJson("low-memory-page");
    const stress = await readBoundJson("low-memory-stress");
    const registration = await readBoundJson("low-memory-registration");
    const flows = await readBoundJson("foundation-flows");
    for (const state of ["A", "B", "C"]) {
      if (!sameJson(m[state], pressure?.[state])) fail(`low-memory state ${state} differs from bound pressure evidence`);
    }
    if (!sameJson(m.threadProfiles, fixture?.profiles)) fail("low-memory thread profiles differ from bound fixture evidence");
    const targetIdentityMatches = record.evidenceClass === "TARGET_CLASS_ENVIRONMENT"
      ? sameJson(m.targetEnvironment, pressure?.targetEnvironment) && m.targetDevice == null && pressure?.targetDevice == null
      : record.evidenceClass === "TARGET_LOW_MEMORY_DEVICE"
        ? sameJson(m.targetDevice, pressure?.targetDevice) && m.targetEnvironment == null && pressure?.targetEnvironment == null
        : false;
    if (!sameJson(m.pressureFixture, pressure?.pressureFixture) || !targetIdentityMatches) {
      fail("low-memory target identity differs from bound pressure evidence");
    }
    const expectedHistory = deriveLowMemoryHistory(page);
    if (!sameJson(page?.history, expectedHistory)) fail("low-memory page artifact contains non-derived history claims");
    if (!sameJson(m.history, expectedHistory)) fail("low-memory history measurement differs from bound page/pressure evidence");
    const expectedActionSecurity = deriveLowMemoryActionSecurity(page);
    if (!sameJson(page?.actionSecurity, expectedActionSecurity)) fail("low-memory page artifact contains non-derived action-security claims");
    if (!sameJson(m.actionSecurity, expectedActionSecurity)) fail("low-memory action-security measurement differs from bound browser evidence");
    const expectedRegistration = {
      firstInstall: registration?.firstInstall?.registered === true,
      storageFailureFailOpen: registration?.storageFailure?.registered === false,
      siteWritableConfigAccepted: registration?.siteWritableConfigAccepted === true,
      forgedPageEventIgnored: page?.forgedPageConfig?.mappingNodes === page?.firstInstall?.mappingNodes
    };
    if (!sameJson(m.registration, expectedRegistration)) fail("low-memory registration measurement differs from bound extension-control evidence");
    const expectedStress = { passed: stress?.passed, loops: stress?.loops, runs: stress?.runs, results: stress?.results };
    if (!sameJson(m.stress, expectedStress)) fail("low-memory stress measurement differs from bound stress evidence");
    const expectedFlows = {
      composer: flows?.coreFlows?.composer === true,
      send: flows?.coreFlows?.send === true,
      streaming: flows?.coreFlows?.streaming === true,
      editBranch: flows?.coreFlows?.editBranch === true,
      connector: flows?.coreFlows?.connector === true,
      toolFileAuth: flows?.coreFlows?.toolFileAuth === true,
      typingImeHotPath: flows?.coreFlows?.typingImeHotPath === true
    };
    if (!sameJson(m.coreFlows, expectedFlows)) fail("low-memory core-flow measurement differs from bound active-window evidence");
    const expectedFailOpen = Object.entries(fixture?.failOpen || {}).every(([key, value]) => key.endsWith("Changed") ? value === false : key.endsWith("Unchanged") ? value === true : true);
    if (m.unknownStructureBehavior !== (expectedFailOpen ? "FAIL_OPEN" : "FAILED")) fail("low-memory fail-open measurement differs from bound fixture evidence");
    if (m.actualTruncation !== pressure?.actualTruncation || m.truncatedRepresentation !== pressure?.truncatedRepresentation || m.reactManagedInteractiveNodesDetached !== pressure?.reactManagedInteractiveNodesDetached || m.serverMutation !== pressure?.serverMutation) {
      fail("low-memory truncation measurement differs from bound pressure evidence");
    }
    const expectedVariants = { A: "mica-absent-or-disabled", B: "mica-installed-low-memory-off", C: "mica-installed-low-memory-on" };
    for (const state of ["A", "B", "C"]) {
      const metrics = m[state];
      if (!metrics || metrics.variant !== expectedVariants[state]) fail(`low-memory state ${state} variant identity missing`);
      if (!metrics || !finitePositive(metrics.processMemoryMb) || !finitePositive(metrics.heapMb) || !finitePositive(metrics.retainedContentMb)) {
        fail(`low-memory state ${state} resource metrics missing`);
      }
      if (!metrics || !finitePositive(metrics.mountedTurnCount) || !finiteNonNegative(metrics.mutationCount) || !finitePositive(metrics.typingP95Ms) || !finitePositive(metrics.scrollP95Ms)) {
        fail(`low-memory state ${state} DOM/mutation/latency metrics missing`);
      }
      if (!metrics || !finitePositive(metrics.frameP95Ms) || !finiteNonNegative(metrics.longTaskCount) || !finiteNonNegative(metrics.longTaskTotalMs) || !finiteNonNegative(metrics.longTaskMaxMs) || !finiteNonNegative(metrics.bootstrapLongTaskCount) || !finiteNonNegative(metrics.bootstrapLongTaskTotalMs) || !finiteNonNegative(metrics.bootstrapLongTaskMaxMs) || !finiteNonNegative(metrics.layoutCount) || !finiteNonNegative(metrics.recalcStyleCount)) {
        fail(`low-memory state ${state} frame/long-task/layout metrics missing`);
      }
      if (!metrics || !Number.isInteger(metrics.samples) || metrics.samples < 3) fail(`low-memory state ${state} requires at least three repeated samples`);
      for (const [rangeKey, valueKey] of [["processMemoryRangeMb", "processMemoryMb"], ["heapRangeMb", "heapMb"], ["typingRangeMs", "typingP95Ms"], ["scrollRangeMs", "scrollP95Ms"]]) {
        if (!validRange(metrics?.[rangeKey], metrics?.[valueKey])) fail(`low-memory state ${state} ${rangeKey} missing or inconsistent`);
      }
    }
    if (!m.A || !m.B || !m.C) return;
    const baselineProcess = Math.min(m.A.processMemoryMb, m.B.processMemoryMb);
    const baselineHeap = Math.min(m.A.heapMb, m.B.heapMb);
    const processGain = ratioGain(baselineProcess, m.C.processMemoryMb);
    const heapGain = ratioGain(baselineHeap, m.C.heapMb);
    const retainedGain = ratioGain(m.B.retainedContentMb, m.C.retainedContentMb);
    const mountedRegression = regression(m.B.mountedTurnCount, m.C.mountedTurnCount);
    const mutationRegression = regression(m.B.mutationCount, m.C.mutationCount);
    if (processGain < 0.1 && heapGain < 0.15) fail("no measured additional memory benefit over native/off baselines");
    if (!Number.isFinite(retainedGain) || retainedGain < 0.15) fail("heavy retained content did not decrease materially");
    if (!Number.isFinite(mountedRegression) || mountedRegression > 0.1) fail("mounted turn load materially regressed over the native/off baseline");
    if (!Number.isFinite(mutationRegression) || mutationRegression > 0.1) fail("mutation work materially regressed over the native/off baseline");
    if (!latencyWithinBudget(m.B.typingP95Ms, m.C.typingP95Ms)) fail("typing latency materially regressed");
    if (!latencyWithinBudget(m.B.scrollP95Ms, m.C.scrollP95Ms)) fail("scroll latency materially regressed");
    if (!m.B.fullExtensionRuntimeLoaded || !m.C.fullExtensionRuntimeLoaded || !m.B.runtimeVersion || m.B.runtimeVersion !== m.C.runtimeVersion) fail("B/C did not execute the same complete installed extension runtime");
    if (m.C.longTaskTotalMs > Math.max(m.B.longTaskTotalMs * 1.2, m.B.longTaskTotalMs + 5)) fail("long-task time materially regressed");
    if (m.C.frameP95Ms > Math.max(m.B.frameP95Ms * 1.2, m.B.frameP95Ms + 2)) fail("frame latency materially regressed");
    if (m.C.bootstrapLongTaskMaxMs > 500) fail("Low Memory bootstrap produced an excessive long task");
    if (!Number.isInteger(m.recentTurnLimit) || m.recentTurnLimit < 8) fail("recent-turn retention policy missing or unsafe");
    const profiles = Array.isArray(m.threadProfiles) ? m.threadProfiles : [];
    for (const name of ["short", "medium", "long"]) {
      const profile = profiles.find((item) => item?.name === name);
      if (!profile) {
        fail(`${name} thread profile missing`);
        continue;
      }
      if (!Number.isInteger(profile.totalTurns) || profile.totalTurns < 1 || !Number.isInteger(profile.mountedBefore) || !Number.isInteger(profile.mountedAfter)) {
        fail(`${name} thread profile metrics invalid`);
      }
      if (name === "long") {
        if (!profile.modeApplied || profile.totalTurns <= m.recentTurnLimit || profile.retainedRecentTurns !== m.recentTurnLimit || profile.mountedAfter >= profile.mountedBefore) {
          fail("long thread did not apply the frozen recent-turn window");
        }
      } else if (profile.modeApplied || profile.mountedAfter !== profile.mountedBefore) {
        fail(`${name} thread was truncated below the long-thread threshold`);
      }
    }
    if (!finitePositive(m.pressureFixture?.memoryLimitMb) || !finitePositive(m.pressureFixture?.payloadMb) || !finitePositive(m.pressureFixture?.turns) || m.pressureFixture?.workload !== "current-chatgpt-derived-react-router-flat-graph-and-virtualized-turn-renderer" || !m.pressureFixture?.sourceArtifact) {
      fail("low-memory pressure fixture identity missing");
    }
    if (record.evidenceClass === "TARGET_CLASS_ENVIRONMENT") {
      if (record.subject?.surface !== "local-constrained-target-class-environment"
        || m.targetEnvironment?.class !== "local-edge-v8-old-space-pressure"
        || m.targetEnvironment?.executionSurface !== "local-isolated-edge"
        || !m.targetEnvironment?.browserBuild
        || !finitePositive(m.targetEnvironment?.rendererOldSpaceLimitMb)
        || m.targetEnvironment?.physicalMemoryGb != null) {
        fail("target-class environment identity is missing or misclassified");
      }
    } else if (record.evidenceClass === "TARGET_LOW_MEMORY_DEVICE") {
      if (record.subject?.surface !== "target-low-memory-device" || m.targetDevice?.physicalDevice !== true || !finitePositive(m.targetDevice?.physicalMemoryGb)) {
        fail("physical target low-memory device identity missing");
      }
    } else {
      fail("low-memory benefit evidence must use a target-class environment or physical target device");
    }
    if (!m.actualTruncation || m.truncatedRepresentation !== "client-history-window" || m.reactManagedInteractiveNodesDetached !== false || m.serverMutation !== false) {
      fail("low-memory implementation is not a safe client-only history window");
    }
    if (!m.history?.scrollUpRestoresOlder || !m.history?.loadFullHistoryPass || !m.history?.reloadRestoresFullHistory || !m.history?.disableRestoresFullHistory || !m.history?.closeOrUninstallRestoresFullHistory || !m.history?.serverHistoryUnchanged) {
      fail("low-memory truncation/history restoration invariant missing");
    }
    if (m.actionSecurity?.pageStatusTelemetryTrusted !== false
      || m.actionSecurity?.recoveryAuthorization !== "extension_ui_or_trusted_user_gesture"
      || m.actionSecurity?.forgedStatusAcceptedAsTelemetry !== true
      || m.actionSecurity?.syntheticClickPrepareCalls !== 0
      || m.actionSecurity?.syntheticClickReloads !== 0
      || m.actionSecurity?.trustedPointerPrepareCalls !== 1
      || m.actionSecurity?.trustedPointerReloads !== 1
      || m.actionSecurity?.trustedKeyboardResumeCalls !== 1
      || m.actionSecurity?.trustedKeyboardReloads !== 1) {
      fail("page-writable telemetry crossed the trusted recovery-action boundary");
    }
    for (const flow of ["composer", "send", "streaming", "editBranch", "connector", "toolFileAuth", "typingImeHotPath"]) {
      if (m.coreFlows?.[flow] !== true) fail(`low-memory ${flow} regression evidence failed`);
    }
    if (m.unknownStructureBehavior !== "FAIL_OPEN") fail("unknown low-memory structures do not fail open");
    if (!m.registration?.firstInstall || !m.registration?.storageFailureFailOpen || m.registration?.siteWritableConfigAccepted || !m.registration?.forgedPageEventIgnored) fail("Low Memory registration is not extension-controlled and fail-open");
    const expectedScripts = [
      "scripts/foundation-core-fixture-smoke.mjs",
      "scripts/foundation-core-flow-fixture.mjs",
      "scripts/low-memory-fixture-smoke.mjs",
      "scripts/low-memory-page-fixture-smoke.mjs",
      "scripts/popup-render-fixture.mjs"
    ];
    if (!m.stress?.passed || m.stress?.loops !== 8 || m.stress?.runs !== 40 || !Array.isArray(m.stress?.results) || m.stress.results.length !== 40) {
      fail("Low Memory stress must pass exactly 8 loops and 40 runs");
    } else {
      for (let loop = 1; loop <= 8; loop += 1) {
        const loopResults = m.stress.results.filter((item) => item?.loop === loop);
        if (loopResults.length !== 5 || loopResults.some((item) => item?.passed !== true) || !sameSet(loopResults.map((item) => item.script), expectedScripts)) {
          fail(`Low Memory stress loop ${loop} does not contain one PASS for each required script`);
        }
      }
    }
    return;
  }

  if (kind === "highlight-remount") {
    const fixture = await readBoundJson("highlighter-fixture");
    const stress = await readBoundJson("highlighter-stress");
    if (record.subject?.surface !== "local-real-browser") fail("wrong Highlighter surface target");
    const expected = deriveHighlighterMeasurement(fixture, stress);
    if (!sameJson(m, expected)) fail("Highlighter measurement differs from bound browser evidence");
    if (!expected.passed
      || !expected.restoredAfterRefresh
      || !expected.restoredAfterRemount
      || !expected.restoredAfterMathReformat
      || expected.attachedToWrongText
      || !expected.ambiguousAnchorStayedUnresolved
      || !expected.deletedSourceStayedUnresolved
      || !expected.branchMismatchStayedUnresolved
      || !expected.invalidSelectionsFailOpen
      || !expected.keyboardAccessible
      || !expected.colorOwnership
      || !expected.deleteOwnership
      || !expected.localStorageOnly
      || !expected.noGlobalRangePatch
      || !expected.noGlobalSelectionPatch
      || !expected.noPermanentToolbar
      || !expected.stress?.passed) {
      fail("highlight remount, ownership, privacy, or ambiguity behavior failed");
    }
    if (!sameJson(expected.selectionSequence, ["prose", "inline_math", "prose"]) || !includesAll(expected.mathTeX, ["x+1"]) || !includesAll(expected.rawLatexSources, ["a+b", "c=d"])) {
      fail("Highlighter prose/math mapping coverage is incomplete");
    }
    const screenshotIds = Object.values(m.screenshotArtifacts || {});
    if (screenshotIds.length !== 3 || !screenshotIds.every((id) => (record.artifactIds || []).includes(id) && artifacts.has(id))) {
      fail("Highlighter visual artifacts are missing or unbound");
    } else if (new Set(screenshotIds.map((id) => artifacts.get(id).sha256)).size !== screenshotIds.length) {
      fail("Highlighter visual states reuse duplicate screenshots");
    }
    return;
  }

  if (kind === "pdf-selection") {
    const fixture = await readBoundJson("pdf-fixture");
    const background = await readBoundJson("pdf-background");
    const highlighter = await readBoundJson("highlighter-fixture");
    if (record.subject?.surface !== "actual-pdf-viewer") fail("wrong PDF surface target");
    const expected = derivePdfMeasurement(fixture, background, highlighter);
    if (!sameJson(m, expected)) fail("PDF measurement differs from bound actual-viewer evidence");
    if (!m.textExtracted || !m.pointerSelection || !m.trustedPointerEvents || !m.displayMathSelectable || !m.mathCopyResult || !m.mathSearchable || !m.highlightPreserved || !m.crossPageHighlight || !m.independentExtraction || !m.localExportBoundary || !m.trustedToolbarHandoff) fail("PDF selection/text/highlight measurement incomplete");
    if (!sameJson(m.pointerSequence, ["prose", "inline_math", "prose"])) fail("continuous prose-math-prose pointer selection missing");
    const pdfArtifact = artifacts.get(m.pdfArtifactId);
    if (!pdfArtifact || !(record.artifactIds || []).includes(m.pdfArtifactId) || fixture?.pdf?.sha256 !== pdfArtifact?.sha256) fail("generated PDF identity is missing or differs from viewer evidence");
    const visualIds = Object.values(m.visualArtifacts || {});
    if (visualIds.length !== 5 || !visualIds.every((id) => (record.artifactIds || []).includes(id) && artifacts.has(id))) {
      fail("PDF render/viewer visual artifacts are missing or unbound");
    } else if (new Set(visualIds.map((id) => artifacts.get(id).sha256)).size !== visualIds.length) {
      fail("PDF render/viewer states reuse duplicate screenshots");
    }
    return;
  }

  if (kind === "privacy") {
    const core = await readBoundJson("foundation-core");
    const flows = await readBoundJson("foundation-flows");
    for (const key of ["conversationTextIncluded", "attachmentContentIncluded", "requestBodyIncluded", "authTokenIncluded", "rawDomIncluded"]) {
      if (m[key] !== false) fail(`privacy flag ${key} must be false`);
      if (core?.privacy?.[key] !== m[key] || flows?.report?.privacy?.[key] !== m[key]) fail(`privacy flag ${key} differs from bound browser evidence`);
    }
    if (m.flowPrivacyMatches !== true) fail("privacy evidence sources do not agree");
    return;
  }

  if (kind === "packaging-version") {
    if (record.subject?.surface !== "built-extension") fail("wrong packaging surface target");
    const manifestArtifact = artifacts.get(m.builtManifestArtifactId);
    const reportArtifact = artifacts.get(m.versionReportArtifactId);
    if (!manifestArtifact || !reportArtifact) {
      fail("built manifest or version report artifact missing");
      return;
    }
    try {
      const builtManifest = JSON.parse(await readArtifactText(bundleDir, manifestArtifact));
      const versionReport = JSON.parse(await readArtifactText(bundleDir, reportArtifact));
      const expectedVersion = manifest.candidate?.version;
      if (builtManifest.version !== expectedVersion) fail("built manifest version differs from candidate");
      for (const field of ["sourceVersion", "popupVersion", "diagnosticsVersion", "reportedUnpackedVersion"]) {
        if (versionReport[field] !== expectedVersion) fail(`${field} differs from candidate version`);
      }
      if (versionReport.buildLabel !== manifest.candidate?.buildLabel) fail("reported build label differs from candidate");
    } catch (error) {
      fail(`packaging version artifacts are invalid: ${error?.message || error}`);
    }
    return;
  }

  fail(`unknown validator kind ${kind}`);
}

async function readArtifactText(bundleDir, artifact) {
  const absolute = path.resolve(bundleDir, artifact.path);
  if (!isWithin(bundleDir, absolute)) throw new Error("artifact path escapes bundle root");
  return readFile(absolute, "utf8");
}

export function computeEvidenceRootHash(artifacts, evidence) {
  const normalizedArtifacts = [...artifacts]
    .map(({ id, path: artifactPath, sha256, kind }) => ({ id, path: artifactPath, sha256, kind }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const normalizedEvidence = [...evidence].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return sha256Text(stableStringify({ artifacts: normalizedArtifacts, evidence: normalizedEvidence }));
}

export async function computeValidatorTreeHash(repoRoot) {
  return hashFileSet(repoRoot, ["scripts/acceptance", "scripts/conversation-export-fixture.mjs", "scripts/recovery-action-policy-fixture.mjs", "scripts/recovery-ledger-fixture.mjs", "acceptance/schema", "acceptance/contracts.json"]);
}

export async function computeFixtureSetHash(repoRoot) {
  return hashFileSet(repoRoot, ["acceptance/controls"]);
}

async function hashFileSet(repoRoot, entries) {
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(repoRoot, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) files.push(...await walkFiles(absolute));
    else files.push(absolute);
  }
  const rows = [];
  for (const file of files.sort()) {
    rows.push({ path: path.relative(repoRoot, file).replaceAll(path.sep, "/"), sha256: await sha256File(file) });
  }
  return sha256Text(stableStringify(rows));
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

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateCandidateShape(candidate, errors) {
  if (!candidate || typeof candidate !== "object") {
    errors.push("candidate identity missing");
    return;
  }
  if (!/^[0-9a-f]{40}$/.test(candidate.commit || "")) errors.push("candidate commit must be a full lowercase SHA-1");
  if (!/^\d+\.\d+\.\d+$/.test(candidate.version || "")) errors.push("candidate version must be three-part SemVer");
  if (!candidate.buildLabel) errors.push("candidate buildLabel missing");
  if (!candidate.distArtifactId) errors.push("candidate distArtifactId missing");
  if (!isSha256(candidate.distHash)) errors.push("candidate distHash invalid");
}

function includesAll(actual, required) {
  return Array.isArray(actual) && required.every((value) => actual.includes(value));
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && includesAll(actual, expected);
}

function sameJson(actual, expected) {
  return stableStringify(actual) === stableStringify(expected);
}

function uniqueStrings(values) {
  return Array.isArray(values) && values.every((value) => typeof value === "string" && value.length > 0) && new Set(values).size === values.length;
}

function bootstrapObservationPasses(bootstrap, observation) {
  return Array.isArray(observation?.assertions) && observation.assertions.length > 0 && observation.assertions.every((assertion) => {
    const surface = bootstrap?.surfaces?.find((item) => item.id === assertion.surfaceId);
    return surface && surface.evidenceClass && surface.evidenceClass !== "NONE" && sameJson(readPath(surface, assertion.path), assertion.equals);
  });
}

function readPath(value, dottedPath) {
  return String(dottedPath || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

function bootstrapStatusSupportsContract(bootstrapStatus, contractStatus) {
  if (contractStatus === "EXACT") return bootstrapStatus === "EXACT" || bootstrapStatus === "EXACT_FOR_OBSERVED_BLOCKS";
  if (contractStatus === "COMPATIBLE") return bootstrapStatus === "COMPATIBLE" || bootstrapStatus === "EXACT";
  if (contractStatus === "UNKNOWN") return ["EXACT", "EXACT_FOR_OBSERVED_BLOCKS", "COMPATIBLE", "UNOBSERVED", "UNKNOWN_FAIL_OPEN"].includes(bootstrapStatus);
  return false;
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

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function validRange(range, selectedValue) {
  return Array.isArray(range) && range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] <= range[1] && selectedValue >= range[0] && selectedValue <= range[1];
}

function ratioGain(baseline, candidate) {
  if (!finitePositive(baseline) || !Number.isFinite(candidate)) return Number.NaN;
  return (baseline - candidate) / baseline;
}

function regression(baseline, candidate) {
  if (!finitePositive(baseline) || !Number.isFinite(candidate)) return Number.POSITIVE_INFINITY;
  return (candidate - baseline) / baseline;
}

function latencyWithinBudget(baseline, candidate) {
  if (!finitePositive(baseline) || !Number.isFinite(candidate)) return false;
  return candidate <= Math.max(baseline * 1.1, baseline + 0.1);
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(value || "");
}

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes("..");
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function result(ok, errors, identity = {}) {
  return { ok, errors, identity };
}
