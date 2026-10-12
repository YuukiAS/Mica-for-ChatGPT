import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const loops = 8;
const results = [];

for (let index = 0; index < loops; index += 1) {
  for (const script of ["scripts/foundation-core-fixture-smoke.mjs", "scripts/foundation-core-flow-fixture.mjs", "scripts/popup-render-fixture.mjs"]) {
    const startedAt = Date.now();
    const { stdout } = await run(process.execPath, [script], { maxBuffer: 8 * 1024 * 1024 });
    results.push({ loop: index + 1, script, elapsedMs: Date.now() - startedAt, passed: stdout.includes('"passed": true') });
  }
}

if (results.some((result) => !result.passed)) throw new Error("Foundation stress run produced a non-passing result");
console.log(JSON.stringify({ passed: true, loops, runs: results.length, results }, null, 2));
