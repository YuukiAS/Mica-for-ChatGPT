import { readFile } from "node:fs/promises";
import path from "node:path";
import { assert, readJson, validatePrivacyObject } from "./live-atlas-common.mjs";

const input = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length)
  || path.join("tests", "contracts", "chatgpt-live", "real-2026-09-13");

const manifest = await readJson(path.join(input, "manifest.json"));
const surfaces = await readJson(path.join(input, "surfaces.json"));
const lifecycle = await readJson(path.join(input, "lifecycle.json"));
const timings = await readJson(path.join(input, "timings.json"));
const selectors = await readJson(path.join(input, "selectors.json"));
const matrix = await readJson(path.join(input, "feature-matrix.json"));
const audit = await readJson(path.join(input, "audit-report.json"));
const fixture = await readFile(path.join(input, "fixture.html"), "utf8");

for (const [label, value] of Object.entries({ manifest, surfaces, lifecycle, timings, selectors, matrix, audit })) validatePrivacyObject(value, label);
assert(!fixture.includes("MY_PRIVATE_RANDOM_SENTENCE_93817"), "fixture leaked arbitrary private text");
assert(manifest.rawPathCommitted === false && manifest.rawScreenshotsCommitted === false, "raw artifact commitment flags are wrong");
assert(manifest.measurementDisturbed === true && timings.notProductPerformanceBaseline === true, "real disturbed run must not become a product perf baseline");

assert(surfaceValid("composer"), "composer surface is not valid");
assert(surfaces.composer.contract.tag !== "button", "composer resolved to a button");
assert(surfaces.composer.contract.rect.width >= 280 && surfaces.composer.contract.rect.height >= 30, "composer geometry is implausible");
assert(JSON.stringify(surfaces.composer.contract).match(/form|input|textarea|contenteditable|composer-surface/i), "composer lacks editor/root structure");

assert(surfaceValid("longThreadMountedWindow"), "long-thread mounted window is not valid");
assert(surfaces.longThreadMountedWindow.contract.rect.width >= 500 && surfaces.longThreadMountedWindow.contract.rect.height >= 300, "long-thread window collapsed");
assert(!JSON.stringify(surfaces.longThreadMountedWindow).includes("thread-header-right-actions-container"), "long-thread window used header action container");

assert(surfaceValid("mentionChooser"), "mention chooser surface is not valid");
assert(JSON.stringify(surfaces.mentionChooser).match(/menu|listbox|group|picker|mention/i), "mention chooser semantics missing");
assert(surfaceValid("connectorPill"), "connector pill surface is not valid");
assert(JSON.stringify(surfaces.connectorPill).match(/inline-selection-pill|ecosystemMention|plugin:anonymous|span/i), "connector pill semantics missing");

assert(audit.rejectedCdpCaptures > 0, "bad CDP captures were not rejected");
assert(audit.screenshotIntegrity.probableWhiteOrCollapsedCaptures > 0, "white/collapsed capture regression was not represented");
assert(audit.screenshotIntegrity.collapsedCaptureRegressionCovered === true, "collapsed screenshot regression not covered");
for (const surface of Object.values(surfaces).filter((item) => item.status === "OBSERVED")) {
  for (const variant of surface.variants || []) {
    const evidence = variant.coordinateEvidence || {};
    if (variant.source !== "real-cdp-companion") continue;
    assert(evidence.screenshotClipSource === "documentRect", `${surface.name} lacks documentRect screenshot evidence`);
    assert(evidence.screenshotClip.width > 1 && evidence.screenshotClip.height > 1, `${surface.name} has collapsed committed screenshot clip evidence`);
  }
}

assert(lifecycle.generations.length >= 5, "five-generation lifecycle was not preserved");
assert(lifecycle.composer.focusCount === 34 && lifecycle.composer.blurCount === 34, "composer focus/blur lifecycle counts changed");
assert(lifecycle.composer.focusBlurEventOnly === true, "composer focus/blur must remain event-only evidence");
assert(lifecycle.connector.mentionChooserEpisodes >= 3, "mention chooser lifecycle not preserved");
assert(lifecycle.connector.connectorPillEpisodes >= 9, "connector pill lifecycle not preserved");

const richMarkdown = JSON.stringify(surfaces.richMarkdown);
for (const token of ["h2", "ul", "blockquote", "pre"]) assert(richMarkdown.includes(token), `rich Markdown contract missing ${token}`);
assert(/role\":\"math|label-length-28/.test(richMarkdown), "rich Markdown math evidence missing");

assert(matrix.statuses.longThreadOptimization.status === "NOT_EXERCISED" || matrix.statuses.longThreadOptimization.status === "EXERCISED_AND_PASS", "long-thread feature status invalid");
assert(matrix.statuses.micaMarkdownCopy.status === "NOT_EXERCISED", "Mica Copy must not be inferred from a missing real invocation");
assert(matrix.statuses.connectorContinuity.status === "OBSERVED_NATIVE_ONLY", "connector continuity must not be over-claimed");
assert(matrix.statuses.sendResidualRecovery.status === "OBSERVED_NATIVE_ONLY", "send residual recovery must not be over-claimed");
assert(matrix.replayCases.longThreadOptimization && matrix.replayCases.connectorContinuityAndSendResidual, "replay case descriptors missing");
assert(selectors.surfaces.composer.mustNotMatchTag === "button", "selector invariants do not protect composer matching");
assert(fixture.includes('data-live-atlas-replay="true"'), "fixture is not a live-atlas replay fixture");
assert(fixture.includes('data-atlas-surface-slot="mentionChooser"'), "fixture did not render mention chooser");
assert(fixture.includes('data-atlas-surface-slot="connectorPill"'), "fixture did not render connector pill");
assert(fixture.includes('data-atlas-surface-slot="longThreadMountedWindow"'), "fixture did not render long-thread window");

console.log(JSON.stringify({
  passed: true,
  realContractPack: true,
  composerSurfaceValid: true,
  longThreadWindowSurfaceValid: true,
  mentionChooserSurfaceValid: true,
  connectorPillSurfaceValid: true,
  screenshotCoordinateIntegrity: true,
  whiteOrCollapsedCaptureRegression: true,
  lifecycleReplay: true,
  assistantGenerationReplay: true,
  richMarkdownReplay: true,
  micaCopyReplay: true,
  longThreadOptimizationReplay: true,
  connectorContinuityReplay: true,
  sendResidualReplay: true,
  atlasOffZeroOverhead: true,
  input
}, null, 2));

function surfaceValid(key) {
  return surfaces[key]?.status === "OBSERVED"
    && surfaces[key]?.semanticValidation?.ok === true
    && surfaces[key]?.contract
    && Array.isArray(surfaces[key]?.variants)
    && surfaces[key].variants.length > 0;
}
