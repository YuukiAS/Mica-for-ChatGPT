import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assert, readJson, validatePrivacyObject } from "./live-atlas-common.mjs";

const raw = path.join("artifacts", "live-atlas", "capture-1789266647815");
const temp = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-real-pack-"));

try {
  await run("node", ["scripts/live-atlas-materialize-contracts.mjs", `--input=${raw}`, `--output=${temp}`]);
  await run("node", ["scripts/live-atlas-real-contract-pack-test.mjs", `--input=${temp}`]);
  await run("node", ["scripts/live-atlas-privacy.mjs", `--input=${temp}`]);
  const audit = await readJson(path.join(temp, "audit-report.json"));
  const surfaces = await readJson(path.join(temp, "surfaces.json"));
  const fixture = await readFile(path.join(temp, "fixture.html"), "utf8");
  validatePrivacyObject({ audit, surfaces }, "materialized-pack");
  assert(audit.rejectedCdpCaptures > 0, "materializer did not reject known bad real CDP captures");
  assert(surfaces.composer.status === "OBSERVED" && surfaces.composer.contract.tag !== "button", "materializer did not repair composer contract source");
  assert(surfaces.mentionChooser.status === "OBSERVED", "materializer did not preserve recorder-observed mention chooser");
  assert(surfaces.connectorPill.status === "OBSERVED", "materializer did not preserve connector pill");
  assert(!fixture.includes("artifacts/live-atlas") && !fixture.includes("C:\\Code"), "fixture leaked raw artifact path");
  console.log(JSON.stringify({
    passed: true,
    materializeContracts: true,
    privacyCheck: true,
    realContractPackReplay: true,
    output: temp
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed with ${code}`)));
  });
}
