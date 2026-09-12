import path from "node:path";
import { readFile } from "node:fs/promises";
import { defaultContractDir, readJson, validatePrivacyObject } from "./live-atlas-common.mjs";

const dir = process.argv.find((arg) => arg.startsWith("--dir="))?.slice("--dir=".length) || defaultContractDir;
const files = ["manifest.json", "coverage.json", "lifecycle.json", "timings.json", "surfaces.json"];
for (const file of files) {
  validatePrivacyObject(await readJson(path.join(dir, file)), file);
  const text = await readFile(path.join(dir, file), "utf8");
  if (text.includes("MY_PRIVATE_RANDOM_SENTENCE_93817")) {
    throw new Error(`${file} leaked arbitrary private text`);
  }
}
console.log(JSON.stringify({ passed: true, dir, files }, null, 2));
