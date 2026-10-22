import { createHash } from "node:crypto";

export const COMPATIBILITY_OBSERVATION_SCHEMA = "mica-chatgpt-compatibility-observation.v1";
export const COMPATIBILITY_DIFF_SCHEMA = "mica-chatgpt-compatibility-diff.v1";
export const MAX_QA_REPORT_BYTES = 1024 * 1024;

const ALLOWED_STATUSES = new Set(["EXACT", "COMPATIBLE", "UNKNOWN"]);
const PRIVACY_FLAGS = [
  "conversationTextIncluded",
  "attachmentContentIncluded",
  "requestBodyIncluded",
  "authTokenIncluded",
  "rawDomIncluded"
];

export function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function validateRepositoryCompatibility(contract, bootstrap, identities = {}) {
  const errors = [];
  const contractCapabilities = validateContract(contract, errors);
  const bootstrapCapabilities = validateBootstrap(bootstrap, errors);

  for (const capability of contractCapabilities) {
    if (capability.status === "UNKNOWN") continue;
    const source = bootstrapCapabilities.get(capability.sourceCapabilityId);
    if (!source) {
      errors.push(`capability ${capability.capabilityId} source evidence is missing`);
      continue;
    }
    if (!statusSupports(source.status, capability.status)) {
      errors.push(`capability ${capability.capabilityId} source status ${source.status} does not support ${capability.status}`);
    }
    for (const observationId of capability.requiredSourceObservationIds) {
      const observation = source.observations?.find((item) => item?.id === observationId);
      if (!observation || !observationPasses(bootstrap, observation)) {
        errors.push(`capability ${capability.capabilityId} observation ${observationId} is missing or contradicted`);
      }
    }
  }

  const observation = buildBootstrapObservation(contract, bootstrap, identities);
  return {
    ok: errors.length === 0,
    schemaVersion: 1,
    command: "verify",
    contractId: contract?.contractId || null,
    contractHash: identities.contractHash || null,
    bootstrapHash: identities.bootstrapHash || null,
    capabilityCount: contractCapabilities.length,
    repositoryBaseline: true,
    currentLiveSurfaceVerified: false,
    browserOpened: false,
    contractMutated: false,
    errors,
    observation
  };
}

export function normalizeDeveloperQaReport(report, contract, identities = {}) {
  const errors = [];
  if (!isRecord(report) || report.schema !== "mica-developer-qa.v1") errors.push("input schema must be mica-developer-qa.v1");
  if (!validTimestamp(report?.generatedAt)) errors.push("generatedAt must be a valid timestamp");
  if (report?.page?.supportedHost !== true) errors.push("Developer QA report must come from a supported ChatGPT host");
  if (!isRecord(report?.page?.compatibility)) errors.push("Developer QA report has no compatibility observation");
  if (report?.runtime?.adapterProducer !== "MicaChatGPTAdapter") errors.push("Developer QA report adapter producer is not MicaChatGPTAdapter");
  for (const flag of PRIVACY_FLAGS) {
    if (report?.privacy?.[flag] !== false) errors.push(`privacy flag ${flag} must be false`);
  }

  const expectedHash = identities.contractHash || null;
  const reportHashes = [report?.candidate?.contractHash, report?.page?.compatibility?.contractHash].filter((value) => value != null);
  if (expectedHash && (reportHashes.length !== 2 || reportHashes.some((value) => value !== expectedHash))) {
    errors.push("Developer QA report contract hash does not match the current repository contract");
  }
  if (report?.page?.compatibility?.contractId !== contract?.contractId) errors.push("Developer QA report contract id mismatch");

  const rawCapabilities = report?.page?.compatibility?.capabilities;
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length === 0 || rawCapabilities.length > 64) {
    errors.push("Developer QA report capabilities must contain 1 to 64 entries");
  }
  const seen = new Set();
  const capabilities = [];
  for (const raw of Array.isArray(rawCapabilities) ? rawCapabilities : []) {
    const capabilityId = boundedToken(raw?.capabilityId, 128);
    const variantId = boundedToken(raw?.variantId, 128);
    if (!capabilityId || !variantId) {
      errors.push("Developer QA capability id or variant id is invalid");
      continue;
    }
    if (seen.has(capabilityId)) {
      errors.push(`Developer QA capability ${capabilityId} is duplicated`);
      continue;
    }
    seen.add(capabilityId);
    if (!ALLOWED_STATUSES.has(raw?.status)) errors.push(`Developer QA capability ${capabilityId} has invalid status`);
    if (raw?.contractHash !== expectedHash) errors.push(`Developer QA capability ${capabilityId} contract hash mismatch`);
    const observedInvariants = boundedStringArray(raw?.observedInvariants, 64, 240);
    const invalidatedBy = boundedStringArray(raw?.invalidatedBy, 16, 240);
    if (!observedInvariants || !invalidatedBy) errors.push(`Developer QA capability ${capabilityId} has invalid bounded evidence`);
    if (raw?.status === "UNKNOWN" && raw?.failOpen !== true) errors.push(`Developer QA capability ${capabilityId} must fail open when UNKNOWN`);
    if (["EXACT", "COMPATIBLE"].includes(raw?.status) && (!observedInvariants?.length || invalidatedBy?.length || raw?.failOpen === true)) {
      errors.push(`Developer QA capability ${capabilityId} does not contain a coherent supported observation`);
    }
    capabilities.push({
      capabilityId,
      variantId,
      reportedStatus: ALLOWED_STATUSES.has(raw?.status) ? raw.status : "UNKNOWN",
      observedInvariantCount: observedInvariants?.length || 0,
      observedInvariantFingerprints: (observedInvariants || []).map(fingerprint),
      invalidationCount: invalidatedBy?.length || 0,
      invalidationFingerprints: (invalidatedBy || []).map(fingerprint),
      failOpen: raw?.status === "UNKNOWN" ? true : raw?.failOpen === true
    });
  }

  if (errors.length > 0) return { ok: false, errors, observation: null };
  const observation = {
    schema: COMPATIBILITY_OBSERVATION_SCHEMA,
    schemaVersion: 1,
    provenance: {
      kind: "developer-qa-export",
      sourceSchema: report.schema,
      sourceQaSha256: identities.sourceQaSha256 || null,
      releaseAuthority: false,
      currentLiveSurfaceClaimedByInput: true,
      browserOpenedByCli: false
    },
    generatedAt: report.generatedAt,
    normalizedAt: identities.normalizedAt || report.generatedAt,
    contract: {
      contractId: contract.contractId,
      contractHash: expectedHash,
      schemaVersion: contract.schemaVersion
    },
    candidate: {
      version: boundedToken(report.candidate?.version, 64),
      buildLabel: boundedToken(report.candidate?.buildLabel, 128)
    },
    page: {
      supportedHost: true,
      state: boundedToken(report.page?.state, 64),
      capabilityCount: capabilities.length
    },
    runtime: {
      adapterProducer: "MicaChatGPTAdapter",
      answerDocumentModelVersion: boundedToken(report.runtime?.answerDocumentModelVersion, 64)
    },
    capabilities,
    privacy: Object.fromEntries(PRIVACY_FLAGS.map((flag) => [flag, false])),
    boundaries: {
      conversationContentRetained: false,
      targetCandidateDetailsRetained: false,
      rawDomRetained: false,
      contractAutoUpdated: false,
      liveAcceptanceSatisfied: false
    }
  };
  return { ok: true, errors: [], observation };
}

export function diffCompatibility(contract, observation, identities = {}) {
  const errors = [];
  if (observation?.schema !== COMPATIBILITY_OBSERVATION_SCHEMA) errors.push(`input schema must be ${COMPATIBILITY_OBSERVATION_SCHEMA}`);
  validateNormalizedObservation(observation, errors);
  const expectedHash = identities.contractHash || observation?.contract?.contractHash || null;
  if (observation?.contract?.contractId !== contract?.contractId) errors.push("observation contract id mismatch");
  if (expectedHash && observation?.contract?.contractHash !== expectedHash) errors.push("observation contract hash mismatch");

  const observedById = new Map();
  for (const item of observation?.capabilities || []) {
    if (!item?.capabilityId || observedById.has(item.capabilityId)) errors.push(`duplicate or missing observed capability ${item?.capabilityId || "<missing>"}`);
    else observedById.set(item.capabilityId, item);
  }

  const capabilities = [];
  for (const declared of contract?.capabilities || []) {
    const observed = observedById.get(declared.capabilityId);
    observedById.delete(declared.capabilityId);
    capabilities.push(classifyCapability(declared, observed));
  }
  for (const observed of observedById.values()) {
    capabilities.push({
      capabilityId: observed.capabilityId,
      declaredStatus: null,
      observedStatus: observed.reportedStatus,
      declaredVariantId: null,
      observedVariantId: observed.variantId,
      classification: "UNKNOWN_NEW_CLASS",
      effectiveStatus: "UNKNOWN",
      failOpen: true,
      isolated: true,
      contractUpdateRequired: false
    });
  }
  capabilities.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
  const counts = Object.fromEntries([...new Set(capabilities.map((item) => item.classification))].sort().map((key) => [key, capabilities.filter((item) => item.classification === key).length]));
  const changed = capabilities.filter((item) => item.classification === "CONTRACT_CHANGED").map((item) => item.capabilityId);
  return {
    ok: errors.length === 0 && changed.length === 0,
    schema: COMPATIBILITY_DIFF_SCHEMA,
    schemaVersion: 1,
    generatedAt: identities.generatedAt || observation?.normalizedAt || observation?.generatedAt || null,
    contractId: contract?.contractId || null,
    contractHash: expectedHash,
    sourceKind: observation?.provenance?.kind || null,
    repositoryBaselineOnly: observation?.provenance?.kind === "committed-bootstrap",
    liveAcceptanceSatisfied: false,
    contractAutoUpdated: false,
    changedCapabilities: changed,
    unaffectedCapabilityCount: capabilities.length - changed.length,
    counts,
    capabilities,
    errors
  };
}

export function buildBootstrapObservation(contract, bootstrap, identities = {}) {
  const sourceById = new Map((bootstrap?.capabilities || []).map((item) => [item.id, item]));
  return {
    schema: COMPATIBILITY_OBSERVATION_SCHEMA,
    schemaVersion: 1,
    provenance: {
      kind: "committed-bootstrap",
      sourceSchema: `bootstrap-v${bootstrap?.schemaVersion || "unknown"}`,
      sourceQaSha256: null,
      releaseAuthority: true,
      currentLiveSurfaceClaimedByInput: false,
      browserOpenedByCli: false
    },
    generatedAt: bootstrap?.capturedAt || null,
    normalizedAt: bootstrap?.capturedAt || null,
    contract: {
      contractId: contract?.contractId || null,
      contractHash: identities.contractHash || null,
      schemaVersion: contract?.schemaVersion || null
    },
    candidate: { version: null, buildLabel: null },
    page: { supportedHost: true, state: "repository-baseline", capabilityCount: contract?.capabilities?.length || 0 },
    runtime: { adapterProducer: "MicaChatGPTAdapter", answerDocumentModelVersion: null },
    capabilities: (contract?.capabilities || []).map((declared) => {
      const source = sourceById.get(declared.sourceCapabilityId);
      const observationsPass = declared.requiredSourceObservationIds?.every((id) => {
        const observation = source?.observations?.find((item) => item?.id === id);
        return observation && observationPasses(bootstrap, observation);
      });
      const supported = declared.status === "UNKNOWN" || (source && statusSupports(source.status, declared.status) && observationsPass);
      return {
        capabilityId: declared.capabilityId,
        variantId: declared.variantId,
        reportedStatus: supported ? declared.status : "UNKNOWN",
        observedInvariantCount: supported && declared.status !== "UNKNOWN" ? declared.requiredInvariants?.length || 0 : 0,
        observedInvariantFingerprints: supported && declared.status !== "UNKNOWN" ? (declared.requiredInvariants || []).map(fingerprint) : [],
        invalidationCount: supported ? 0 : 1,
        invalidationFingerprints: supported ? [] : [fingerprint("committed bootstrap does not prove the declared capability")],
        failOpen: !supported || declared.status === "UNKNOWN"
      };
    }),
    privacy: Object.fromEntries(PRIVACY_FLAGS.map((flag) => [flag, false])),
    boundaries: {
      conversationContentRetained: false,
      targetCandidateDetailsRetained: false,
      rawDomRetained: false,
      contractAutoUpdated: false,
      liveAcceptanceSatisfied: false
    }
  };
}

function classifyCapability(declared, observed) {
  const base = {
    capabilityId: declared.capabilityId,
    declaredStatus: declared.status,
    observedStatus: observed?.reportedStatus || null,
    declaredVariantId: declared.variantId,
    observedVariantId: observed?.variantId || null,
    isolated: true,
    contractUpdateRequired: false
  };
  if (!observed) {
    return declared.status === "UNKNOWN"
      ? { ...base, classification: "NOT_OBSERVED", effectiveStatus: "UNKNOWN", failOpen: true }
      : { ...base, classification: "CONTRACT_CHANGED", effectiveStatus: "UNKNOWN", failOpen: true, contractUpdateRequired: true };
  }
  if (declared.status === "UNKNOWN" && observed.reportedStatus === "UNKNOWN") {
    return { ...base, classification: "MATCH_FAIL_OPEN", effectiveStatus: "UNKNOWN", failOpen: true };
  }
  if (declared.status === "UNKNOWN") {
    return { ...base, classification: "CANDIDATE_OBSERVATION_ONLY", effectiveStatus: "UNKNOWN", failOpen: true, contractUpdateRequired: true };
  }
  if (observed.reportedStatus === "UNKNOWN" || observed.invalidationCount > 0) {
    return { ...base, classification: "CONTRACT_CHANGED", effectiveStatus: "UNKNOWN", failOpen: true, contractUpdateRequired: true };
  }
  if (observed.variantId === declared.variantId && observed.reportedStatus === declared.status) {
    return { ...base, classification: "MATCH", effectiveStatus: observed.reportedStatus, failOpen: observed.failOpen === true };
  }
  if (["EXACT", "COMPATIBLE"].includes(observed.reportedStatus)) {
    return { ...base, classification: "COMPATIBLE_NEW_VARIANT", effectiveStatus: "COMPATIBLE", failOpen: observed.failOpen === true, contractUpdateRequired: true };
  }
  return { ...base, classification: "CONTRACT_CHANGED", effectiveStatus: "UNKNOWN", failOpen: true, contractUpdateRequired: true };
}

function validateContract(contract, errors) {
  if (!isRecord(contract) || contract.schemaVersion !== 1 || !boundedToken(contract.contractId, 160)) errors.push("current ChatGPT contract header is invalid");
  if (!Array.isArray(contract?.capabilities) || contract.capabilities.length === 0) errors.push("current ChatGPT contract has no capabilities");
  const seen = new Set();
  for (const capability of contract?.capabilities || []) {
    if (!boundedToken(capability?.capabilityId, 128) || seen.has(capability.capabilityId)) errors.push(`duplicate or invalid contract capability ${capability?.capabilityId || "<missing>"}`);
    seen.add(capability?.capabilityId);
    if (!ALLOWED_STATUSES.has(capability?.status)) errors.push(`contract capability ${capability?.capabilityId} has invalid status`);
    if (!boundedToken(capability?.variantId, 128)) errors.push(`contract capability ${capability?.capabilityId} has invalid variant`);
    if (!boundedStringArray(capability?.requiredInvariants, 64, 240)) errors.push(`contract capability ${capability?.capabilityId} has invalid invariants`);
    if (!Array.isArray(capability?.requiredSourceObservationIds)) errors.push(`contract capability ${capability?.capabilityId} has invalid source observations`);
    if (capability?.status === "UNKNOWN" && capability?.failOpen !== true) errors.push(`contract capability ${capability?.capabilityId} must fail open when UNKNOWN`);
  }
  return contract?.capabilities || [];
}

function validateBootstrap(bootstrap, errors) {
  if (!isRecord(bootstrap) || bootstrap.schemaVersion !== 1 || !validTimestamp(bootstrap.capturedAt)) errors.push("committed bootstrap evidence header is invalid");
  const policy = bootstrap?.capturePolicy;
  if (policy?.readOnly !== true || policy?.messagesSent !== 0 || policy?.filesUploaded !== 0 || policy?.privateConversationAccessed !== false || policy?.contentCaptured !== false) {
    errors.push("committed bootstrap evidence violates the read-only privacy boundary");
  }
  if (bootstrap?.gate?.bootstrapEvidence !== "PASS" || bootstrap?.gate?.oldSurfaceAtlasUsedAsCurrentEvidence !== false) errors.push("committed bootstrap gate is invalid");
  const seen = new Map();
  for (const capability of bootstrap?.capabilities || []) {
    if (!boundedToken(capability?.id, 160) || seen.has(capability.id)) errors.push(`duplicate or invalid bootstrap capability ${capability?.id || "<missing>"}`);
    else seen.set(capability.id, capability);
  }
  return seen;
}

function validateNormalizedObservation(observation, errors) {
  if (!Array.isArray(observation?.capabilities) || observation.capabilities.length === 0 || observation.capabilities.length > 64) {
    errors.push("normalized observation capabilities must contain 1 to 64 entries");
    return;
  }
  for (const flag of PRIVACY_FLAGS) {
    if (observation?.privacy?.[flag] !== false) errors.push(`normalized observation privacy flag ${flag} must be false`);
  }
  if (observation?.boundaries?.conversationContentRetained !== false || observation?.boundaries?.rawDomRetained !== false || observation?.boundaries?.contractAutoUpdated !== false || observation?.boundaries?.liveAcceptanceSatisfied !== false) {
    errors.push("normalized observation overclaims its privacy or authority boundary");
  }
  for (const item of observation.capabilities) {
    if (!boundedToken(item?.capabilityId, 128) || !boundedToken(item?.variantId, 128) || !ALLOWED_STATUSES.has(item?.reportedStatus)) {
      errors.push(`normalized capability ${item?.capabilityId || "<missing>"} is invalid`);
    }
    if (!Number.isInteger(item?.observedInvariantCount) || item.observedInvariantCount < 0 || item.observedInvariantCount > 64) errors.push(`normalized capability ${item?.capabilityId} invariant count is invalid`);
    if (!validFingerprints(item?.observedInvariantFingerprints, item?.observedInvariantCount)) errors.push(`normalized capability ${item?.capabilityId} invariant fingerprints are invalid`);
    if (!Number.isInteger(item?.invalidationCount) || item.invalidationCount < 0 || item.invalidationCount > 16) errors.push(`normalized capability ${item?.capabilityId} invalidation count is invalid`);
    if (!validFingerprints(item?.invalidationFingerprints, item?.invalidationCount)) errors.push(`normalized capability ${item?.capabilityId} invalidation fingerprints are invalid`);
    if (item?.reportedStatus === "UNKNOWN" && item?.failOpen !== true) errors.push(`normalized capability ${item?.capabilityId} must fail open when UNKNOWN`);
    if (["EXACT", "COMPATIBLE"].includes(item?.reportedStatus) && (item?.observedInvariantCount < 1 || item?.invalidationCount !== 0 || item?.failOpen === true)) {
      errors.push(`normalized capability ${item?.capabilityId} does not contain a coherent supported observation`);
    }
  }
}

function observationPasses(bootstrap, observation) {
  return Array.isArray(observation?.assertions) && observation.assertions.length > 0 && observation.assertions.every((assertion) => {
    const surface = bootstrap?.surfaces?.find((item) => item?.id === assertion?.surfaceId);
    return surface && surface.evidenceClass && surface.evidenceClass !== "NONE" && sameJson(readPath(surface, assertion.path), assertion.equals);
  });
}

function statusSupports(sourceStatus, contractStatus) {
  if (contractStatus === "EXACT") return sourceStatus === "EXACT" || sourceStatus === "EXACT_FOR_OBSERVED_BLOCKS";
  if (contractStatus === "COMPATIBLE") return ["EXACT", "EXACT_FOR_OBSERVED_BLOCKS", "COMPATIBLE"].includes(sourceStatus);
  return contractStatus === "UNKNOWN";
}

function boundedStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const output = [];
  for (const item of value) {
    const text = boundedText(item, maxLength);
    if (!text) return null;
    output.push(text);
  }
  return [...new Set(output)];
}

function boundedToken(value, maxLength) {
  const text = boundedText(value, maxLength);
  return text && /^[a-z0-9._:-]+$/i.test(text) ? text : null;
}

function boundedText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\r\n\u0000-\u001f]/.test(value) ? value : null;
}

function fingerprint(value) {
  return `sha256:${sha256Text(value).slice(0, 24)}`;
}

function validFingerprints(values, expectedCount) {
  return Array.isArray(values) && values.length === expectedCount && values.every((value) => /^sha256:[a-f0-9]{24}$/.test(value));
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function readPath(value, dottedPath) {
  return String(dottedPath || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

function sameJson(first, second) {
  return stableStringify(first) === stableStringify(second);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
