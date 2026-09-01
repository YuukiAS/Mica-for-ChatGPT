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
const entrySet = new Set(entries.map((entry) => entry.name));
assert(entrySet.has("manifest.json"), "ZIP manifest must be at root");
for (const relative of REQUIRED_EXTENSION_FILES) {
  assert(entrySet.has(relative), `ZIP missing ${relative}`);
}
for (const entry of entries) {
  assert(!entry.name.includes("node_modules/"), "ZIP must not include node_modules");
  assert(!entry.name.startsWith("extension/"), "ZIP must not include source wrapper");
  assert(!entry.name.startsWith("dist/"), "ZIP must not include dist wrapper");
  assert(!entry.name.startsWith("release/"), "ZIP must not include release wrapper");
  assert(!/diagnostic|telemetry|\.log$/i.test(entry.name), `ZIP contains disallowed artifact ${entry.name}`);
  if (/\.(js|html|json|css)$/i.test(entry.name)) {
    const text = entry.data.toString("utf8");
    assert(!/active\s*\/.*turns/i.test(text), `ZIP ${entry.name} contains old active / turns wording`);
  }
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
    const localOffset = buffer.readUInt32LE(offset + 42);
    assert(buffer.readUInt32LE(localOffset) === 0x04034b50, "invalid local file header");
    const method = buffer.readUInt16LE(localOffset + 8);
    assert(method === 0, `unsupported ZIP compression method for ${name}`);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, data: buffer.subarray(dataOffset, dataOffset + compressedSize) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
