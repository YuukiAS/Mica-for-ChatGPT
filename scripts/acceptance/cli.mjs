import path from "node:path";
import { fileURLToPath } from "node:url";
import { runControlCorpus } from "./control-corpus.mjs";
import {
  EVIDENCE_SCHEMA_VERSION,
  VALIDATOR_VERSION,
  computeFixtureSetHash,
  computeValidatorTreeHash,
  validateBundle
} from "./validator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [command = "preflight", ...args] = process.argv.slice(2);

if (command === "preflight") {
  const controls = await runControlCorpus(repoRoot);
  const output = {
    ok: controls.ok,
    command,
    validatorVersion: VALIDATOR_VERSION,
    validatorTreeHash: await computeValidatorTreeHash(repoRoot),
    fixtureSetHash: await computeFixtureSetHash(repoRoot),
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    knownGoodControl: controls.knownGoodAccepted === controls.knownGoodDeclared ? "ACCEPTED" : "NOT_ALL_ACCEPTED",
    knownBadControls: controls.knownBadRejected === controls.knownBadDeclared ? "REJECTED" : "NOT_ALL_REJECTED",
    controls
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
} else if (command === "focused" || command === "candidate") {
  const bundleArg = valueAfter(args, "--bundle");
  if (!bundleArg) throw new Error(`${command} requires --bundle <directory>`);
  const bundleDir = path.resolve(repoRoot, bundleArg);
  const gates = command === "focused" ? valuesAfter(args, "--gate") : null;
  if (command === "focused" && gates.length === 0) throw new Error("focused requires at least one --gate <gate-id>");
  const validation = await validateBundle(repoRoot, bundleDir, gates.length > 0 ? gates : null, { expectedBundleKind: "candidate" });
  console.log(JSON.stringify({ command, bundleDir, ...validation }, null, 2));
  if (!validation.ok) process.exitCode = 1;
} else {
  throw new Error(`unknown acceptance command: ${command}`);
}

function valueAfter(values, flag) {
  const index = values.indexOf(flag);
  return index >= 0 ? values[index + 1] : null;
}

function valuesAfter(values, flag) {
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === flag && values[index + 1]) output.push(values[index + 1]);
  }
  return output;
}
