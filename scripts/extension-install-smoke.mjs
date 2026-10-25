import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_LABEL, MACHINE_VERSION } from "./release-config.mjs";
import { installNetworkGuard, launchInstalledExtension, repositoryRoot, waitForMicaContentRuntime } from "./extension-browser-harness.mjs";

const root = repositoryRoot();
const hostHtml = await readFile(path.join(root, "tests", "fixtures", "mica-product-host.html"), "utf8");
const fixtureUrl = "https://chatgpt.com/c/simulated-a";
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "full-extension-evidence");
await mkdir(evidenceDir, { recursive: true });
const launched = await launchInstalledExtension({ viewport: { width: 1280, height: 900 }, profilePrefix: "mica-install-smoke-" });
const unexpectedRequests = await installNetworkGuard(launched.context, new Map([[fixtureUrl, { status: 200, contentType: "text/html", body: hostHtml }]]));

try {
  await launched.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://chatgpt.com" });
  const background = await launched.worker.evaluate(async () => {
    await chrome.storage.local.set({ enabled: true, lowMemory: false, highlighter: true, copyExport: true });
    await globalThis.MicaAnswerContextMenuBackground.rebuildMenus();
    return {
      manifest: chrome.runtime.getManifest(),
      registered: await chrome.scripting.getRegisteredContentScripts(),
      contextMenu: globalThis.MicaAnswerContextMenuBackground.getStatus(),
      stored: await chrome.storage.local.get(null)
    };
  });
  const page = await launched.context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error)));
  await page.goto(fixtureUrl, { waitUntil: "load" });
  const runtime = await waitForMicaContentRuntime(launched.worker, fixtureUrl);
  assert(runtime.response.status.version === MACHINE_VERSION, "installed content runtime version drifted");
  assert(background.manifest.version === MACHINE_VERSION && background.manifest.version_name === MACHINE_VERSION, "installed manifest version drifted");
  assert(background.manifest.permissions.includes("contextMenus"), "installed manifest lacks contextMenus");
  assert(background.contextMenu.menusReady && background.contextMenu.pendingContextCount === 0, "answer context menus were not initialized");

  await page.locator("#primary-answer").click({ button: "right" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const rightClickState = await launched.worker.evaluate(() => globalThis.MicaAnswerContextMenuBackground.getStatus());
  assert(rightClickState.pendingContextCount === 1 && rightClickState.textIncluded === false, "trusted right-click did not reach the real service worker");

  const paragraph = page.locator("#primary-answer");
  const box = await paragraph.boundingBox();
  assert(box, "target answer paragraph is not visible");
  await page.mouse.move(box.x + 3, box.y + Math.min(12, box.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height - 4, { steps: 18 });
  await page.mouse.up();
  const toolbar = page.locator("[data-mica-ui='highlight-toolbar']");
  await toolbar.waitFor({ state: "visible" });
  await toolbar.locator("button[data-action='markdown']").click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert(clipboard.includes("Reliable local export") && clipboard.includes("x+1") && clipboard.includes("const localOnly = true;"), "trusted installed-extension copy did not preserve answer structure");
  assert(!clipboard.includes("Copy response") && !clipboard.includes("Deterministic host lifecycle"), "copy included page chrome outside the target answer");

  const screenshot = path.join(evidenceDir, "installed-extension-answer.png");
  await page.screenshot({ path: screenshot, fullPage: false });
  const output = {
    schema: "mica.full-extension-install.v1",
    passed: true,
    generatedAt: new Date().toISOString(),
    candidate: { version: MACHINE_VERSION, buildLabel: BUILD_LABEL },
    browser: { userAgent: await page.evaluate(() => navigator.userAgent), playwrightModules: launched.modulesDir },
    extension: {
      id: launched.extensionId,
      manifestVersion: background.manifest.manifest_version,
      serviceWorker: launched.worker.url(),
      actualContentScript: true,
      actualServiceWorker: true,
      actualStorage: Object.keys(background.stored).length > 0,
      contextMenusReady: background.contextMenu.menusReady,
      dynamicRegistrations: background.registered.map((entry) => ({ id: entry.id, world: entry.world, persistAcrossSessions: entry.persistAcrossSessions }))
    },
    userPath: { trustedRightClickReachedWorker: true, trustedSelectionToolbarCopy: true, realClipboardReadback: true },
    privacy: { normalBrowserProfileUsed: false, authenticatedChatGptUsed: false, realChatGptRequestCount: unexpectedRequests.length, conversationTextIncludedInBackgroundContext: false },
    screenshot: path.relative(root, screenshot).replaceAll("\\", "/"),
    pageErrors
  };
  assert(unexpectedRequests.length === 0, `unexpected network requests escaped the fixture: ${JSON.stringify(unexpectedRequests)}`);
  assert(pageErrors.length === 0, `installed extension page errors: ${pageErrors.join(" | ")}`);
  await writeFile(path.join(evidenceDir, "extension-install-smoke.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await launched.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
