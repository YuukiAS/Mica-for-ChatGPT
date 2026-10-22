import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapter = run("scripts/target-surface-adapter-fixture.mjs");
const suggestedWork = run("scripts/suggested-work-controller-fixture.mjs");
const recoveryControls = run("scripts/recovery-control-adapter-fixture.mjs");

for (const result of [adapter, suggestedWork, recoveryControls]) assert.equal(result.passed, true);

const output = {
  schemaVersion: 1,
  subject: "target-surface-backend",
  passed: true,
  suggestedWorkExactFixtureContract: adapter.suggestedWorkExactFixtureContract,
  ambiguousSuggestedWorkFailsOpen: adapter.ambiguousSuggestedWorkFailsOpen,
  recoveryControlSubjectBound: adapter.recoveryControlSubjectBound,
  recoveryControlRevalidatedBeforeClick: adapter.recoveryControlRevalidatedBeforeClick,
  confirmedResendRequiresEmptyComposer: adapter.confirmedResendRequiresEmptyComposer,
  targetDiagnosticsExcludeVisibleText: adapter.targetDiagnosticsExcludeVisibleText,
  pageWritableFixtureMarkerRejected: adapter.pageWritableFixtureMarkerRejected,
  toggleOnHidesExactSurface: suggestedWork.toggleOnHidesExactSurface,
  toggleOffRestoresOriginalState: suggestedWork.toggleOffRestoresOriginalState,
  unrelatedCardsPreserved: suggestedWork.unrelatedCardsPreserved,
  remountReconciled: suggestedWork.remountReconciled,
  noPollingOrOwnObserver: suggestedWork.noPollingOrOwnObserver,
  exactEvidenceSubmittedOnce: recoveryControls.exactEvidenceSubmittedOnce,
  subjectAndControlBoundExecution: recoveryControls.subjectAndControlBoundExecution,
  changedControlRejected: recoveryControls.changedControlRejected,
  consequentialStateRejected: recoveryControls.consequentialStateRejected,
  retryFallbackSupported: recoveryControls.retryFallbackSupported,
  confirmedUnsentResendSupported: recoveryControls.confirmedUnsentResendSupported,
  unknownLiveContractFailsOpen: recoveryControls.unknownLiveContractFailsOpen,
  realSuggestedWorkContractIncluded: false,
  realRecoveryControlContractIncluded: false
};

const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "convergence-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "target-surface-backend.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

function run(relative) {
  const result = spawnSync(process.execPath, [path.join(root, relative)], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${relative} failed\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
