import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
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
const outputArg = valueAfter(args, "--output");

if (command === "preflight") {
  const controls = await runControlCorpus(repoRoot);
  const output = {
    resultSchema: "mica.acceptance-run.v1",
    ok: controls.ok,
    command,
    invocation: invocationRecord(command, args),
    standard: { source: "acceptance/contracts.json", schemaVersion: 1, validatorVersion: VALIDATOR_VERSION },
    validatorVersion: VALIDATOR_VERSION,
    validatorTreeHash: await computeValidatorTreeHash(repoRoot),
    fixtureSetHash: await computeFixtureSetHash(repoRoot),
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    knownGoodControl: controls.knownGoodAccepted === controls.knownGoodDeclared ? "ACCEPTED" : "NOT_ALL_ACCEPTED",
    knownBadControls: controls.knownBadRejected === controls.knownBadDeclared ? "REJECTED" : "NOT_ALL_REJECTED",
    controls
  };
  await saveOutput(outputArg, output);
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
} else if (command === "focused" || command === "candidate") {
  const bundleArg = valueAfter(args, "--bundle");
  if (!bundleArg) throw new Error(`${command} requires --bundle <directory>`);
  const bundleDir = path.resolve(repoRoot, bundleArg);
  const gates = command === "focused" ? valuesAfter(args, "--gate") : null;
  if (command === "focused" && gates.length === 0) throw new Error("focused requires at least one --gate <gate-id>");
  const validation = await validateBundle(repoRoot, bundleDir, gates?.length ? gates : null, { expectedBundleKind: "candidate" });
  const output = {
    resultSchema: "mica.acceptance-run.v1",
    command,
    bundleDir,
    invocation: invocationRecord(command, args),
    standard: { source: "acceptance/contracts.json", schemaVersion: 1, validatorVersion: VALIDATOR_VERSION },
    ...validation
  };
  await saveOutput(outputArg, output);
  console.log(JSON.stringify(output, null, 2));
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

function invocationRecord(commandName, values) {
  return {
    entrypoint: "scripts/acceptance/cli.mjs",
    packageCommand: commandName === "preflight" ? "acceptance:preflight" : commandName === "focused" ? "acceptance:focused" : "acceptance:candidate",
    argv: [commandName, ...values.filter((value, index) => values[index - 1] !== "--output" && value !== "--output")]
  };
}

async function saveOutput(outputPath, output) {
  if (!outputPath) return;
  if (path.isAbsolute(outputPath)) throw new Error("--output must be a repository-relative path");
  const absolute = path.resolve(repoRoot, outputPath);
  const relative = path.relative(repoRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("--output must stay inside the repository");
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(output, null, 2)}\n`);
}
