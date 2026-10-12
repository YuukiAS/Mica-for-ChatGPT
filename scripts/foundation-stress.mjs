import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loops = 8;
const results = [];

for (let index = 0; index < loops; index += 1) {
  for (const script of [
    "scripts/foundation-core-fixture-smoke.mjs",
    "scripts/foundation-core-flow-fixture.mjs",
    "scripts/low-memory-fixture-smoke.mjs",
    "scripts/low-memory-page-fixture-smoke.mjs",
    "scripts/popup-render-fixture.mjs"
  ]) {
    const startedAt = Date.now();
    const { stdout } = await run(process.execPath, [script], { maxBuffer: 8 * 1024 * 1024 });
    results.push({ loop: index + 1, script, elapsedMs: Date.now() - startedAt, passed: stdout.includes('"passed": true') });
  }
}

if (results.some((result) => !result.passed)) throw new Error("Foundation and Low Memory stress run produced a non-passing result");
const output = { passed: true, loops, runs: results.length, results };
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "low-memory-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "low-memory-stress.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
