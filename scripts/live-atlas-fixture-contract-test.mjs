import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assert, surfaceKeys, writeJson } from "./live-atlas-common.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "mica-atlas-contract-"));
const out = path.join(dir, "fixture.html");
try {
  const privacy = privacyFlags();
  const safety = safetyFlags();
  const surfaces = Object.fromEntries(surfaceKeys.map((key) => [key, { schemaVersion: 1, name: key, status: "MISSING", source: "contract-test", privacy, contract: null }]));
  surfaces.composer = {
    schemaVersion: 1,
    name: "composer",
    status: "OBSERVED",
    source: "contract-test",
    privacy,
    contract: {
      tag: "form",
      role: null,
      attrs: { "data-composer-surface": "true" },
      rect: { x: 123, y: 456, width: 321, height: 77 },
      state: { disabled: false, expanded: null, pressed: null, contenteditable: null },
      text: { category: "medium", length: 48 },
      styles: { "border-radius": "17px", "background-color": "rgb(1, 2, 3)" },
      children: [{ tag: "button", role: null, attrs: { "aria-label": "Copy" }, rect: null, state: { disabled: false, expanded: null, pressed: null, contenteditable: null }, text: { category: "short", length: 4 }, styles: {}, children: [] }]
    }
  };
  await writeJson(path.join(dir, "lifecycle.json"), { schemaVersion: 1, kind: "mica.liveSurfaceAtlas.lifecycle", source: "contract-test", privacy, safety, generations: [], timeline: Array.from({ length: 8 }, (_, index) => ({ schemaVersion: 1, type: "checkpoint", relativeTimeMs: index, details: { stateClass: "atlas_started" } })) });
  await writeJson(path.join(dir, "coverage.json"), Object.fromEntries(surfaceKeys.map((key) => [key, { status: key === "composer" ? "OBSERVED" : "MISSING", count: key === "composer" ? 1 : 0 }])));
  await writeJson(path.join(dir, "surfaces.json"), surfaces);
  await run("node", ["scripts/live-atlas-build-fixtures.mjs", `--input=${dir}`, `--output=${out}`]);
  const html = await readFile(out, "utf8");
  assert(html.includes("left:123px"), "fixture did not use contract x geometry");
  assert(html.includes("top:456px"), "fixture did not use contract y geometry");
  assert(html.includes("width:321px"), "fixture did not use contract width");
  assert(html.includes("height:77px"), "fixture did not use contract height");
  assert(html.includes("border-radius:17px"), "fixture did not use contract style");
  assert(html.includes('data-atlas-missing="mentionChooser"'), "missing surfaces were not explicit");
  console.log(JSON.stringify({ passed: true, contractDrivenFixture: true, output: out }, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed with ${code}`)));
  });
}

function privacyFlags() {
  return { localOnly: true, telemetryUploaded: false, promptTextIncluded: false, answerTextIncluded: false, rawDomIncluded: false, fullPageScreenshotIncluded: false, headersIncluded: false, cookiesIncluded: false, requestBodiesIncluded: false };
}

function safetyFlags() {
  return { automatedSend: false, automatedEnter: false, automatedUpload: false, automatedConnectorAction: false, playwrightRealSiteTraceUsed: false, computerUseRequired: false };
}
