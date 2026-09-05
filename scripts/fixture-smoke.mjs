import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "long-thread.html");
const contentPath = path.join(root, "dist", DEV_DIST_DIR_NAME, "content.js");

const html = await readFile(fixturePath, "utf8");
const content = await readFile(contentPath, "utf8");

const requiredSnippets = [
  "data-mica-fixture=\"true\"",
  "data-message-author-role=\"${role}\"",
  "role = index % 2 === 0 ? \"assistant\" : \"user\""
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) {
    throw new Error(`Fixture missing required snippet: ${snippet}`);
  }
}

const requiredContent = [
  "content-visibility",
  "contain-intrinsic-size",
  "MICA_GET_STATUS",
  "MICA_DIAGNOSTICS_COPY_REPORT",
  "Active",
  "Native virtualization",
  "Native only",
  "Degraded",
  "Disabled",
  "mountedTurns"
];

for (const snippet of requiredContent) {
  if (!content.includes(snippet)) {
    throw new Error(`Built content script missing required snippet: ${snippet}`);
  }
}

new Function(content);

if (/active \/.*turns/i.test(content)) {
  throw new Error("Built content script still contains ambiguous active / turns status copy");
}

console.log("Fixture smoke checks passed");
console.log(`Open fixture manually: ${pathToFileURL(fixturePath).href}`);
