import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loops = 8;
const script = "scripts/highlighter-fixture-smoke.mjs";
const results = [];

for (let loop = 1; loop <= loops; loop += 1) {
  const startedAt = Date.now();
  const { stdout } = await run(process.execPath, [script], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  results.push({ loop, script, elapsedMs: Date.now() - startedAt, passed: stdout.includes('"passed": true') });
}

if (results.some((result) => !result.passed)) throw new Error("Highlighter stress run produced a non-passing result");
const output = { passed: true, loops, runs: results.length, results };
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "highlighter-evidence");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "highlighter-stress.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
