import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "overlay-placement.html");
const matrixPath = path.join(root, "tests", "fixtures", "overlay-placement-matrix.html");
const sourcePath = path.join(root, "extension", "src", "content.ts");
const distPath = path.join(root, "dist", DEV_DIST_DIR_NAME, "content.js");

const fixture = await readFile(fixturePath, "utf8");
const matrix = await readFile(matrixPath, "utf8");
const source = await readFile(sourcePath, "utf8");
const dist = await readFile(distPath, "utf8");

for (const snippet of [
  "data-mica-fixture=\"true\"",
  "data-testid=\"composer\"",
  "addKnownRateLimitDialog",
  "addUnknownDialog",
  "setComposerTall"
]) {
  assert(fixture.includes(snippet), `overlay fixture missing ${snippet}`);
}

for (const snippet of ["1600", "1200", "900", "700", "500", "overlay-placement.html?run=", "matrix-result"]) {
  assert(matrix.includes(snippet), `overlay matrix fixture missing ${snippet}`);
}

for (const snippet of [
  "__MICA_OVERLAY_DEBUG__",
  "__MICA_TEST_CONTROLS__",
  "bottom-right-static",
  "intersectsComposer",
  "Mica 已自动关闭一个已知提示",
  "Mica 已自动关闭 ${overlayState.toastCount} 个已知提示",
  "getStaticOverlayPlacement"
]) {
  assert(source.includes(snippet), `content source missing overlay token ${snippet}`);
  assert(dist.includes(snippet), `built content missing overlay token ${snippet}`);
}

for (const text of [source, dist]) {
  assert(!/active\s*\/.*turns/i.test(text), "old active / turns wording must not exist");
  assert(!/right\s*=\s*["']12px["']/.test(text), "status overlay must not use fixed right 12px placement");
  assert(!/bottom\s*=\s*["']12px["']/.test(text), "status overlay must not use fixed bottom 12px placement");
  assert(!/findComposerArea|right-above-composer|chooseOverlayPlacement/.test(text), "status overlay must not use composer-aware placement");
}

new Function(dist);

console.log("Overlay fixture smoke checks passed");
console.log(`Open overlay fixture manually: ${pathToFileURL(fixturePath).href}`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
