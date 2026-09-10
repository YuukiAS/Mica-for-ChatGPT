import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { defaultContractDir, readJson, root, summarizeNumbers, writeJson } from "./live-atlas-common.mjs";

const input = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) || defaultContractDir;
const timings = await readJson(path.join(input, "timings.json"));
const constants = await inventoryTimingConstants();
const ledger = {};
for (const [key, value] of Object.entries(timings.metrics || {})) {
  ledger[key] = Array.isArray(value) ? summarizeNumbers(value) : summarizeNumbers(Number.isFinite(value) ? [value] : []);
}
const result = { passed: true, input, ledger, constants };
await writeJson(path.join(input, "timing-ledger.json"), result);
console.log(JSON.stringify(result, null, 2));

async function inventoryTimingConstants() {
  const files = await listFiles(path.join(root, "extension", "src"));
  const constants = [];
  const pattern = /\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*(?:_MS|_TTL|_TIMEOUT|_GRACE|_SETTLE|_INTERVAL|_CAP|_WINDOW|_DEBOUNCE|_POLL|_LIFETIME)[A-Z0-9_]*)\s*=\s*([^;\n]+)/g;
  for (const file of files.filter((item) => /\.(?:ts|js)$/.test(item))) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      constants.push({ file: path.relative(root, file).replace(/\\/g, "/"), name: match[1], value: match[2].trim(), classification: classify(match[1]) });
    }
  }
  return constants.sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`));
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else out.push(full);
  }
  return out;
}

function classify(name) {
  if (/ANIMATION|TOAST|EXPAND/.test(name)) return "visual animation only";
  if (/FRAME_STALL/.test(name)) return "performance diagnostic threshold";
  if (/MUTATION_FLUSH/.test(name)) return "active capture coalescing";
  if (/COMPOSER_(?:PROTECTION|SEND_ACTIVITY|EDIT_ACTIVITY)/.test(name)) return "composer mutation safety window";
  if (/SNAPSHOT_FRESHNESS|MENTION_QUERY/.test(name)) return "state freshness window";
  if (/RULE_COOLDOWN/.test(name)) return "known interruption cooldown";
  if (/VERIFY/.test(name)) return "post-action verification delay";
  if (/FULL_SELECTION_INTENT/.test(name)) return "user selection intent window";
  if (/SAMPLE|INTERVAL|POLL/.test(name)) return "sampling/diagnostic cadence";
  if (/GUARD|CAP|LIFETIME|TIMEOUT/.test(name)) return "safety hard cap";
  if (/TTL|GRACE|SETTLE|WINDOW/.test(name)) return "lifecycle heuristic";
  return "timing constant requiring Atlas review";
}
