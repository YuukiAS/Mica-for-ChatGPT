import path from "node:path";
import { defaultContractDir, readJson, surfaceKeys, validatePrivacyObject, assert } from "./live-atlas-common.mjs";

const input = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) || defaultContractDir;
const surfaces = await readJson(path.join(input, "surfaces.json"));
validatePrivacyObject(surfaces, "surfaces");

for (const key of ["userTurn", "assistantStreaming", "assistantSettled", "assistantActionBar", "nativeCopyArea", "richMarkdown", "mentionChooser", "connectorPill", "micaOverlay", "micaCopy"]) {
  assert(surfaceKeys.includes(key), `${key} is not in the canonical surface model`);
  assert(surfaces[key]?.status === "OBSERVED", `${key} was not preserved as OBSERVED`);
  assert(surfaces[key]?.contract, `${key} has no sanitized contract`);
}

assert((surfaces.composer?.variants || []).length >= 2, "composer variants were collapsed");
assert((surfaces.micaOverlay?.variants || []).length >= 2, "mica overlay variants were collapsed");
assert((surfaces.richMarkdown?.variants || []).some((variant) => variant.stateClass === "rich_markdown_settled"), "rich Markdown settled variant missing");

console.log(JSON.stringify({
  passed: true,
  composerVariants: surfaces.composer.variants.length,
  overlayVariants: surfaces.micaOverlay.variants.length,
  richMarkdown: surfaces.richMarkdown.status,
  nativeCopyArea: surfaces.nativeCopyArea.status,
  micaCopy: surfaces.micaCopy.status
}, null, 2));
