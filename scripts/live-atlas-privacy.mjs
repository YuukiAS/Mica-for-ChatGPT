import path from "node:path";
import { readFile } from "node:fs/promises";
import { defaultContractDir, readJson, validatePrivacyObject } from "./live-atlas-common.mjs";

const dir = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length)
  || process.argv.find((arg) => arg.startsWith("--dir="))?.slice("--dir=".length)
  || defaultContractDir;
const files = ["manifest.json", "coverage.json", "lifecycle.json", "timings.json", "surfaces.json", "selectors.json", "feature-matrix.json", "audit-report.json"];
const checked = [];
for (const file of files) {
  const fullPath = path.join(dir, file);
  try {
    await readFile(fullPath, "utf8");
  } catch (_error) {
    if (!["selectors.json", "feature-matrix.json", "audit-report.json"].includes(file)) throw _error;
    continue;
  }
  validatePrivacyObject(await readJson(path.join(dir, file)), file);
  const text = await readFile(path.join(dir, file), "utf8");
  if (text.includes("MY_PRIVATE_RANDOM_SENTENCE_93817")) {
    throw new Error(`${file} leaked arbitrary private text`);
  }
  checked.push(file);
}
console.log(JSON.stringify({ passed: true, dir, files: checked }, null, 2));
