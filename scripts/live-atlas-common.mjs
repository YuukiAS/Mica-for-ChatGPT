import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const rawRoot = path.join(root, "artifacts", "live-atlas");
export const defaultRawSession = path.join(rawRoot, "synthetic-smoke");
export const defaultContractDir = path.join(root, "tests", "contracts", "chatgpt-live", "synthetic-smoke");
export const defaultGeneratedFixture = path.join(root, "tests", "fixtures", "generated", "live-atlas-replay.html");

export const surfaceKeys = [
  "composer",
  "userTurn",
  "assistantStreaming",
  "assistantSettled",
  "assistantActionBar",
  "nativeCopyArea",
  "richMarkdown",
  "mentionChooser",
  "connectorPill",
  "micaOverlay",
  "longThreadMountedWindow",
  "toolFileAuthSurface",
  "micaCopy"
];

export const forbiddenPrivacyPatterns = [
  /cookie/i,
  /authorization/i,
  /bearer\s+[a-z0-9._-]+/i,
  /sk-[a-z0-9]/i,
  /-----BEGIN\s+(?:OPENSSH|RSA|EC|PRIVATE)/i,
  /<html[\s>]/i,
  /<body[\s>]/i
];

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeText(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
}

export function assert(condition, message, details = null) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

export function validatePrivacyObject(value, pathLabel = "$") {
  for (const text of collectStrings(value)) {
    for (const pattern of forbiddenPrivacyPatterns) {
      assert(!pattern.test(text), `Privacy validation failed at ${pathLabel}: ${pattern}`);
    }
  }
  if (value?.privacy) {
    assert(value.privacy.promptTextIncluded === false, "privacy.promptTextIncluded must be false");
    assert(value.privacy.answerTextIncluded === false, "privacy.answerTextIncluded must be false");
    assert(value.privacy.rawDomIncluded === false, "privacy.rawDomIncluded must be false");
    assert(value.privacy.fullPageScreenshotIncluded === false, "privacy.fullPageScreenshotIncluded must be false");
  }
  if (value?.safety) {
    assert(value.safety.automatedSend === false, "automatedSend must be false");
    assert(value.safety.automatedEnter === false, "automatedEnter must be false");
    assert(value.safety.automatedUpload === false, "automatedUpload must be false");
    assert(value.safety.automatedConnectorAction === false, "automatedConnectorAction must be false");
    assert(value.safety.playwrightRealSiteTraceUsed === false, "playwrightRealSiteTraceUsed must be false");
  }
}

function collectStrings(value, strings = []) {
  if (typeof value === "string") {
    strings.push(value);
    return strings;
  }
  if (!value || typeof value !== "object") return strings;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
    return strings;
  }
  for (const item of Object.values(value)) collectStrings(item, strings);
  return strings;
}

export function summarizeNumbers(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, min: null, median: null, p90: null, p95: null, max: null, mad: null };
  const median = percentile(sorted, 0.5);
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    median,
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    mad: percentile(deviations, 0.5)
  };
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[index] * 10) / 10;
}
