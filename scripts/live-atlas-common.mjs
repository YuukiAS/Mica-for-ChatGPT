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
  /MY_PRIVATE_RANDOM_SENTENCE_93817/,
  /<html[\s>]/i,
  /<body[\s>]/i
];

export const allowedGenericLabels = new Set(["Copy", "Retry", "Stop", "Continue", "Regenerate"]);
export const allowedSurfaceAttrs = new Set([
  "role",
  "aria-expanded",
  "aria-pressed",
  "aria-label",
  "disabled",
  "contenteditable",
  "data-composer-surface",
  "data-message-author-role",
  "data-mica-root",
  "data-inline-selection-pill",
  "data-symbol",
  "data-testid",
  "data-id"
]);
export const allowedSurfaceStyleKeys = new Set([
  "display",
  "position",
  "border-radius",
  "box-shadow",
  "background-color",
  "color",
  "font-size",
  "line-height",
  "opacity",
  "transform"
]);

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
  for (const { value: text, path: textPath } of collectStringsWithPath(value)) {
    for (const pattern of forbiddenPrivacyPatterns) {
      assert(!pattern.test(text), `Privacy validation failed at ${pathLabel}${textPath}: ${pattern}`);
    }
    assert(!/^https?:\/\//i.test(text), `Privacy validation failed at ${pathLabel}${textPath}: arbitrary URL`);
    assert(!/[A-Z]:\\/.test(text), `Privacy validation failed at ${pathLabel}${textPath}: local path`);
  }
  for (const forbiddenKey of findForbiddenKeys(value)) {
    assert(false, `Privacy validation failed at ${pathLabel}: forbidden field ${forbiddenKey}`);
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
  if (value?.contract) validateSurfaceContract(value.contract, `${pathLabel}.contract`);
}

function collectStringsWithPath(value, pathLabel = "$", strings = []) {
  if (typeof value === "string") {
    strings.push({ value, path: pathLabel });
    return strings;
  }
  if (!value || typeof value !== "object") return strings;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) collectStringsWithPath(value[index], `${pathLabel}[${index}]`, strings);
    return strings;
  }
  for (const [key, item] of Object.entries(value)) collectStringsWithPath(item, `${pathLabel}.${key}`, strings);
  return strings;
}

function findForbiddenKeys(value, pathLabel = "$", out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${pathLabel}[${index}]`, out));
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/^(textContent|innerText|innerHTML|outerHTML|nodeValue|prompt|answer|headers|body|cookie|token|url|href|src|repository|fileName|conversationTitle|account|avatar)$/i.test(key)) {
      out.push(`${pathLabel}.${key}`);
    }
    findForbiddenKeys(item, `${pathLabel}.${key}`, out);
  }
  return out;
}

export function validateSurfaceContract(contract, pathLabel = "$.contract") {
  assert(contract && typeof contract === "object", `${pathLabel} must be an object`);
  assert(/^[a-z0-9-]{1,40}$/.test(contract.tag || ""), `${pathLabel}.tag is not a safe tag`);
  assert(contract.rect === null || isRect(contract.rect), `${pathLabel}.rect is invalid`);
  if (contract.attrs) {
    for (const [key, value] of Object.entries(contract.attrs)) {
      assert(allowedSurfaceAttrs.has(key), `${pathLabel}.attrs.${key} is not allowlisted`);
      if (key === "aria-label") assert(allowedGenericLabels.has(value) || /^label-length-\d+$/.test(value), `${pathLabel}.attrs.aria-label is not generic`);
      else assert(typeof value === "string" && !/^https?:|[A-Z]:\\|MY_PRIVATE_RANDOM_SENTENCE_93817/.test(value), `${pathLabel}.attrs.${key} is unsafe`);
    }
  }
  if (contract.styles) {
    for (const [key, value] of Object.entries(contract.styles)) {
      assert(allowedSurfaceStyleKeys.has(key), `${pathLabel}.styles.${key} is not allowlisted`);
      assert(typeof value === "string" && !/url\(|https?:|file:|data:text/i.test(value), `${pathLabel}.styles.${key} contains an unsafe value`);
    }
  }
  if (contract.text) {
    assert(["empty", "short", "medium", "long", "redacted"].includes(contract.text.category), `${pathLabel}.text.category is invalid`);
    assert(Number.isFinite(contract.text.length), `${pathLabel}.text.length is invalid`);
  }
  for (let index = 0; index < (contract.children || []).length; index += 1) {
    validateSurfaceContract(contract.children[index], `${pathLabel}.children[${index}]`);
  }
}

function isRect(rect) {
  return ["x", "y", "width", "height"].every((key) => Number.isFinite(rect[key])) && rect.width >= 0 && rect.height >= 0;
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
