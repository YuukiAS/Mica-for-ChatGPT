import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPATIBILITY_OBSERVATION_SCHEMA,
  MAX_QA_REPORT_BYTES,
  buildBootstrapObservation,
  diffCompatibility,
  normalizeDeveloperQaReport,
  sha256Text,
  validateRepositoryCompatibility
} from "./chatgpt-ui-compatibility.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(repoRoot, "contracts", "chatgpt", "current.json");
const bootstrapPath = path.join(repoRoot, "results", "mica-product-system-rebuild", "current-chatgpt-surface", "bootstrap-evidence.json");
const defaultRefreshOutput = path.join(repoRoot, "results", "mica-product-system-rebuild", "compatibility-refresh", "latest-developer-qa.json");

const [command = "verify", ...args] = process.argv.slice(2);

try {
  const contractText = await readFile(contractPath, "utf8");
  const contract = JSON.parse(contractText);
  const contractHash = sha256Text(contractText);
  const bootstrapText = await readFile(bootstrapPath, "utf8");
  const bootstrap = JSON.parse(bootstrapText);
  const bootstrapHash = sha256Text(bootstrapText);

  if (command === "verify") {
    const result = validateRepositoryCompatibility(contract, bootstrap, { contractHash, bootstrapHash });
    print(result);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "refresh") {
    const inputArg = valueAfter(args, "--input");
    if (!inputArg) throw new Error("refresh requires --input <mica-developer-qa.v1.json>; this command never opens a browser");
    const inputPath = path.resolve(repoRoot, inputArg);
    const inputText = await readBoundJsonText(inputPath);
    const normalized = normalizeDeveloperQaReport(JSON.parse(inputText), contract, {
      contractHash,
      sourceQaSha256: sha256Text(inputText)
    });
    if (!normalized.ok) {
      print({ command, ok: false, inputPath, browserOpened: false, contractMutated: false, errors: normalized.errors });
      process.exitCode = 1;
    } else {
      const outputPath = resolveRepoOutput(valueAfter(args, "--output") || defaultRefreshOutput);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await assertSafeOutput(outputPath);
      await writeFile(outputPath, `${JSON.stringify(normalized.observation, null, 2)}\n`);
      print({ command, ok: true, inputPath, outputPath, schema: COMPATIBILITY_OBSERVATION_SCHEMA, browserOpened: false, contractMutated: false });
    }
  } else if (command === "diff") {
    const inputArg = valueAfter(args, "--input");
    let observation;
    let inputKind;
    if (inputArg) {
      const inputPath = path.resolve(repoRoot, inputArg);
      const inputText = await readBoundJsonText(inputPath);
      const parsed = JSON.parse(inputText);
      if (parsed?.schema === COMPATIBILITY_OBSERVATION_SCHEMA) {
        observation = parsed;
        inputKind = "normalized-observation";
      } else {
        const normalized = normalizeDeveloperQaReport(parsed, contract, { contractHash, sourceQaSha256: sha256Text(inputText) });
        if (!normalized.ok) throw new Error(normalized.errors.join("; "));
        observation = normalized.observation;
        inputKind = "developer-qa-export";
      }
    } else {
      observation = buildBootstrapObservation(contract, bootstrap, { contractHash });
      inputKind = "committed-bootstrap";
    }
    const result = diffCompatibility(contract, observation, { contractHash });
    print({ command, inputKind, browserOpened: false, contractMutated: false, ...result });
    if (!result.ok) process.exitCode = 1;
  } else {
    throw new Error(`unknown chatgpt-ui command: ${command}`);
  }
} catch (error) {
  print({ command, ok: false, browserOpened: false, contractMutated: false, errors: [error?.message || String(error)] });
  process.exitCode = 1;
}

async function readBoundJsonText(filePath) {
  const lstatInfo = await lstat(filePath);
  if (lstatInfo.isSymbolicLink()) throw new Error("input must not be a symbolic link");
  const info = await stat(filePath);
  if (!info.isFile() || info.size > MAX_QA_REPORT_BYTES) throw new Error(`input must be a regular JSON file no larger than ${MAX_QA_REPORT_BYTES} bytes`);
  return readFile(filePath, "utf8");
}

async function assertSafeOutput(outputPath) {
  const realRepoRoot = await realpath(repoRoot);
  const realParent = await realpath(path.dirname(outputPath));
  const relativeParent = path.relative(realRepoRoot, realParent);
  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) throw new Error("refresh output parent resolves outside the repository");
  try {
    if ((await lstat(outputPath)).isSymbolicLink()) throw new Error("refresh output must not be a symbolic link");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function resolveRepoOutput(value) {
  const output = path.resolve(repoRoot, value);
  const relative = path.relative(repoRoot, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("refresh output must stay inside the repository");
  if (!output.toLowerCase().endsWith(".json")) throw new Error("refresh output must be a .json file");
  return output;
}

function valueAfter(values, flag) {
  const index = values.indexOf(flag);
  return index >= 0 ? values[index + 1] : null;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}
