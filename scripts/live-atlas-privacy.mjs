import path from "node:path";
import { defaultContractDir, readJson, validatePrivacyObject } from "./live-atlas-common.mjs";

const dir = process.argv.find((arg) => arg.startsWith("--dir="))?.slice("--dir=".length) || defaultContractDir;
const files = ["manifest.json", "coverage.json", "lifecycle.json", "timings.json", "surfaces.json"];
for (const file of files) {
  validatePrivacyObject(await readJson(path.join(dir, file)), file);
}
console.log(JSON.stringify({ passed: true, dir, files }, null, 2));
