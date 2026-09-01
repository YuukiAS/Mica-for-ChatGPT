import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "long-thread.html");
const contentPath = path.join(root, "dist", "mica-v0.1.0", "content.js");

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
  "Active",
  "Native only",
  "Degraded",
  "Disabled"
];

for (const snippet of requiredContent) {
  if (!content.includes(snippet)) {
    throw new Error(`Built content script missing required snippet: ${snippet}`);
  }
}

new Function(content);

console.log("Fixture smoke checks passed");
console.log(`Open fixture manually: ${pathToFileURL(fixturePath).href}`);
