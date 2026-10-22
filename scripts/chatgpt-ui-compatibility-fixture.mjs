import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  MAX_QA_REPORT_BYTES,
  buildBootstrapObservation,
  diffCompatibility,
  normalizeDeveloperQaReport,
  sha256Text,
  validateRepositoryCompatibility
} from "./chatgpt-ui-compatibility.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractText = await readFile(path.join(root, "contracts", "chatgpt", "current.json"), "utf8");
const contract = JSON.parse(contractText);
const contractHash = sha256Text(contractText);
const bootstrapText = await readFile(path.join(root, "results", "mica-product-system-rebuild", "current-chatgpt-surface", "bootstrap-evidence.json"), "utf8");
const bootstrap = JSON.parse(bootstrapText);
const bootstrapHash = sha256Text(bootstrapText);

const verified = validateRepositoryCompatibility(contract, bootstrap, { contractHash, bootstrapHash });
assert.equal(verified.ok, true, verified.errors.join("; "));
const baselineDiff = diffCompatibility(contract, buildBootstrapObservation(contract, bootstrap, { contractHash }), { contractHash });
assert.equal(baselineDiff.ok, true, JSON.stringify(baselineDiff));
assert.equal(baselineDiff.capabilities.filter((item) => item.classification === "CONTRACT_CHANGED").length, 0);

const qa = developerQaFixture(contract, contractHash);
const normalized = normalizeDeveloperQaReport(qa, contract, { contractHash, sourceQaSha256: "a".repeat(64) });
assert.equal(normalized.ok, true, normalized.errors.join("; "));
assert.deepEqual(Object.keys(normalized.observation.privacy).sort(), ["attachmentContentIncluded", "authTokenIncluded", "conversationTextIncluded", "rawDomIncluded", "requestBodyIncluded"]);
assert.equal(JSON.stringify(normalized.observation).includes("secret prompt"), false);
assert.equal(normalized.observation.boundaries.targetCandidateDetailsRetained, false);
assert.equal(normalized.observation.provenance.releaseAuthority, false);

const badPrivacy = structuredClone(qa);
badPrivacy.privacy.conversationTextIncluded = true;
assert.equal(normalizeDeveloperQaReport(badPrivacy, contract, { contractHash }).ok, false);
const badHash = structuredClone(qa);
badHash.candidate.contractHash = "0".repeat(64);
assert.equal(normalizeDeveloperQaReport(badHash, contract, { contractHash }).ok, false);
const duplicate = structuredClone(qa);
duplicate.page.compatibility.capabilities.push(structuredClone(duplicate.page.compatibility.capabilities[0]));
assert.equal(normalizeDeveloperQaReport(duplicate, contract, { contractHash }).ok, false);
const unsupportedExact = structuredClone(qa);
unsupportedExact.page.compatibility.capabilities.find((item) => item.capabilityId === "turns.list").observedInvariants = [];
assert.equal(normalizeDeveloperQaReport(unsupportedExact, contract, { contractHash }).ok, false);

const changedObservation = structuredClone(normalized.observation);
const action = changedObservation.capabilities.find((item) => item.capabilityId === "answer.actionCluster");
action.reportedStatus = "UNKNOWN";
action.invalidationCount = 1;
action.invalidationFingerprints = ["sha256:000000000000000000000000"];
action.failOpen = true;
const changedDiff = diffCompatibility(contract, changedObservation, { contractHash });
assert.equal(changedDiff.ok, true, "an already UNKNOWN contract capability must remain safely isolated");
assert.equal(changedDiff.capabilities.find((item) => item.capabilityId === "answer.actionCluster").classification, "MATCH_FAIL_OPEN");
assert.equal(changedDiff.capabilities.find((item) => item.capabilityId === "turns.list").classification, "MATCH");

const supportedDrift = structuredClone(normalized.observation);
const turns = supportedDrift.capabilities.find((item) => item.capabilityId === "turns.list");
turns.reportedStatus = "UNKNOWN";
turns.invalidationCount = 1;
turns.invalidationFingerprints = ["sha256:111111111111111111111111"];
turns.failOpen = true;
supportedDrift.capabilities.push({ capabilityId: "future.canvas", variantId: "unproven-v1", reportedStatus: "EXACT", observedInvariantCount: 1, observedInvariantFingerprints: ["sha256:222222222222222222222222"], invalidationCount: 0, invalidationFingerprints: [], failOpen: false });
const driftDiff = diffCompatibility(contract, supportedDrift, { contractHash });
assert.equal(driftDiff.ok, false);
assert.deepEqual(driftDiff.changedCapabilities, ["turns.list"]);
assert.equal(driftDiff.capabilities.find((item) => item.capabilityId === "future.canvas").classification, "UNKNOWN_NEW_CLASS");
assert.equal(driftDiff.capabilities.find((item) => item.capabilityId === "future.canvas").effectiveStatus, "UNKNOWN");
assert.equal(driftDiff.capabilities.find((item) => item.capabilityId === "composer.editor").classification, "MATCH");

const missingSupported = structuredClone(normalized.observation);
missingSupported.capabilities = missingSupported.capabilities.filter((item) => item.capabilityId !== "turns.list");
const missingSupportedDiff = diffCompatibility(contract, missingSupported, { contractHash });
assert.equal(missingSupportedDiff.ok, false);
assert.deepEqual(missingSupportedDiff.changedCapabilities, ["turns.list"]);

const unsupportedPromotion = structuredClone(normalized.observation);
const math = unsupportedPromotion.capabilities.find((item) => item.capabilityId === "answer.math");
math.reportedStatus = "EXACT";
math.variantId = "candidate-math-v2";
math.invalidationCount = 0;
math.invalidationFingerprints = [];
math.failOpen = false;
const promotionDiff = diffCompatibility(contract, unsupportedPromotion, { contractHash });
assert.equal(promotionDiff.capabilities.find((item) => item.capabilityId === "answer.math").classification, "CANDIDATE_OBSERVATION_ONLY");
assert.equal(promotionDiff.capabilities.find((item) => item.capabilityId === "answer.math").effectiveStatus, "UNKNOWN");

const compatibleVariant = structuredClone(normalized.observation);
const composer = compatibleVariant.capabilities.find((item) => item.capabilityId === "composer.editor");
composer.variantId = "prompt-editor-future-v2";
composer.reportedStatus = "COMPATIBLE";
const variantDiff = diffCompatibility(contract, compatibleVariant, { contractHash });
assert.equal(variantDiff.capabilities.find((item) => item.capabilityId === "composer.editor").classification, "COMPATIBLE_NEW_VARIANT");
assert.equal(variantDiff.liveAcceptanceSatisfied, false);
assert.equal(variantDiff.contractAutoUpdated, false);

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["chatgpt-ui:verify"], "node scripts/chatgpt-ui.mjs verify");
assert.equal(packageJson.scripts["chatgpt-ui:refresh"], "node scripts/chatgpt-ui.mjs refresh");
assert.equal(packageJson.scripts["chatgpt-ui:diff"], "node scripts/chatgpt-ui.mjs diff");
const verifyCli = JSON.parse((await execFileAsync(process.execPath, [path.join(root, "scripts", "chatgpt-ui.mjs"), "verify"], { cwd: root })).stdout);
assert.equal(verifyCli.ok, true);
const diffCli = JSON.parse((await execFileAsync(process.execPath, [path.join(root, "scripts", "chatgpt-ui.mjs"), "diff"], { cwd: root })).stdout);
assert.equal(diffCli.ok, true);
const refreshTemp = await mkdtemp(path.join(os.tmpdir(), "mica-chatgpt-ui-"));
const refreshInput = path.join(refreshTemp, "qa.json");
const refreshOutputRelative = path.join("results", "mica-product-system-rebuild", "compatibility-refresh", ".fixture-output.json");
const refreshOutput = path.join(root, refreshOutputRelative);
let oversizedInputRejected = false;
try {
  await writeFile(refreshInput, JSON.stringify(qa));
  const refreshCli = JSON.parse((await execFileAsync(process.execPath, [path.join(root, "scripts", "chatgpt-ui.mjs"), "refresh", "--input", refreshInput, "--output", refreshOutputRelative], { cwd: root })).stdout);
  assert.equal(refreshCli.ok, true);
  assert.equal(JSON.parse(await readFile(refreshOutput, "utf8")).schema, normalized.observation.schema);
  await writeFile(refreshInput, " ".repeat(MAX_QA_REPORT_BYTES + 1));
  try {
    await execFileAsync(process.execPath, [path.join(root, "scripts", "chatgpt-ui.mjs"), "refresh", "--input", refreshInput, "--output", refreshOutputRelative], { cwd: root });
  } catch (error) {
    const parsed = JSON.parse(error.stdout);
    oversizedInputRejected = parsed.ok === false && parsed.errors[0].includes("no larger than") && parsed.browserOpened === false;
  }
} finally {
  await rm(refreshTemp, { recursive: true, force: true });
  await rm(refreshOutput, { force: true });
}
assert.equal(oversizedInputRejected, true);
let missingInputRejected = false;
try {
  await execFileAsync(process.execPath, [path.join(root, "scripts", "chatgpt-ui.mjs"), "refresh"], { cwd: root });
} catch (error) {
  const parsed = JSON.parse(error.stdout);
  missingInputRejected = parsed.ok === false && parsed.errors[0].includes("requires --input") && parsed.browserOpened === false;
}
assert.equal(missingInputRejected, true);

const output = {
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

const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "convergence-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "chatgpt-ui-compatibility.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

function developerQaFixture(currentContract, hash) {
  return {
    schema: "mica-developer-qa.v1",
    generatedAt: "2026-10-22T00:00:00.000Z",
    candidate: { version: "0.5.13", versionName: "0.5.13", buildLabel: "functional-convergence.14", contractHash: hash },
    page: {
      supportedHost: true,
      state: "compatible",
      compatibility: {
        status: "COMPATIBLE",
        contractId: currentContract.contractId,
        contractHash: hash,
        contractVersion: currentContract.schemaVersion,
        observedAt: "2026-10-22T00:00:00.000Z",
        capabilities: currentContract.capabilities.map((item) => ({
          capabilityId: item.capabilityId,
          variantId: item.variantId,
          status: item.status,
          observedInvariants: item.capabilityId === "turns.list" ? [...item.requiredInvariants, "secret prompt"] : (item.status === "UNKNOWN" ? [] : [...item.requiredInvariants]),
          invalidatedBy: item.status === "UNKNOWN" ? ["not proven by current report"] : [],
          failOpen: item.status === "UNKNOWN",
          contractHash: hash
        }))
      },
      targetSurfaces: { candidates: [{ label: "secret prompt" }] }
    },
    runtime: { adapterProducer: "MicaChatGPTAdapter", answerDocumentModelVersion: "1", debugText: "secret prompt" },
    privacy: Object.fromEntries(["conversationTextIncluded", "attachmentContentIncluded", "requestBodyIncluded", "authTokenIncluded", "rawDomIncluded"].map((key) => [key, false]))
  };
}
