import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_BASENAME, REQUIRED_EXTENSION_FILES } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const zipPath = path.join(releaseDir, `${RELEASE_BASENAME}.zip`);
const shaPath = path.join(releaseDir, `${RELEASE_BASENAME}.sha256`);

await assertFile(zipPath);
await assertFile(shaPath);

const zip = await readFile(zipPath);
const shaText = await readFile(shaPath, "utf8");
const sha = createHash("sha256").update(zip).digest("hex");
assert(shaText.trim() === `${sha}  ${path.basename(zipPath)}`, "SHA-256 file does not match ZIP");

const entries = readZipEntries(zip);
const entrySet = new Set(entries);
assert(entrySet.has("manifest.json"), "ZIP manifest must be at root");
for (const relative of REQUIRED_EXTENSION_FILES) {
  assert(entrySet.has(relative), `ZIP missing ${relative}`);
}
for (const entry of entries) {
  assert(!entry.includes("node_modules/"), "ZIP must not include node_modules");
  assert(!entry.startsWith("extension/"), "ZIP must not include source wrapper");
  assert(!entry.startsWith("dist/"), "ZIP must not include dist wrapper");
  assert(!entry.startsWith("release/"), "ZIP must not include release wrapper");
  assert(!/diagnostic|telemetry|\.log$/i.test(entry), `ZIP contains disallowed artifact ${entry}`);
}

console.log("Release package validation passed");
console.log(sha);

async function assertFile(file) {
  const info = await stat(file);
  assert(info.isFile(), `${file} is not a file`);
}

function readZipEntries(buffer) {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(eocdOffset >= 0, "ZIP end of central directory missing");
  const count = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert(buffer.readUInt32LE(offset) === 0x02014b50, "invalid central directory entry");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
