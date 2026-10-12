import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUILD_LABEL, DEV_DIST_DIR_NAME, MACHINE_VERSION } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const popupPath = path.join(root, "dist", DEV_DIST_DIR_NAME, "popup", "index.html");
const troubleshootingPath = path.join(root, "dist", DEV_DIST_DIR_NAME, "popup", "troubleshooting.html");
const qaPath = path.join(root, "dist", DEV_DIST_DIR_NAME, "popup", "qa.html");
const currentContractHash = createHash("sha256").update(await readFile(path.join(root, "contracts", "chatgpt", "current.json"))).digest("hex");
const evidenceDir = path.join(root, "results", "mica-product-system-rebuild", "foundation-popup");
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(bundledNodeModules, "playwright"));
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

const requiredStates = {
  loading: "Checking this page…",
  exact: "Ready on this page",
  compatible: "Ready with limited support",
  unknown: "Using ChatGPT normally",
  unsupported: "Open a ChatGPT conversation",
  disabled: "Mica is off",
  contentUnavailable: "Couldn’t reach this page"
};
const matrix = [];
const screenshotPlans = [
  { state: "exact", width: 368, scale: 1, colorScheme: "light" },
  { state: "unknown", width: 368, scale: 1, colorScheme: "dark" },
  { state: "compatible", width: 320, scale: 1.5, colorScheme: "light" },
  { state: "contentUnavailable", width: 400, scale: 1.25, colorScheme: "dark" }
];

try {
  for (const [state, expectedTitle] of Object.entries(requiredStates)) {
    const result = await renderPopup({ state, width: 368, scale: 1, colorScheme: "light", screenshot: false });
    assert(result.title === expectedTitle, `${state} title mismatch: ${result.title}`);
    matrix.push(result);
  }

  for (const width of [320, 340, 368, 400]) {
    for (const scale of [1, 1.25, 1.5]) {
      for (const colorScheme of ["light", "dark"]) {
        const result = await renderPopup({ state: "compatible", width, scale, colorScheme, screenshot: false });
        assert(result.horizontalOverflow === 0, `popup overflow at ${width}px/${scale}/${colorScheme}`);
        assert(result.importantActionsVisible, `popup action/footer clipped at ${width}px/${scale}/${colorScheme}`);
        matrix.push(result);
      }
    }
  }

  const screenshots = [];
  for (const plan of screenshotPlans) screenshots.push(await renderPopup({ ...plan, screenshot: true }));
  assert(screenshots[0].screenshotSha256 !== screenshots[1].screenshotSha256, "light/dark screenshots are duplicate artifacts");

  const support = await inspectSecondaryView(troubleshootingPath, ["Troubleshooting", "Run self-check", "Export diagnostic bundle"]);
  const qa = await inspectSecondaryView(qaPath, ["Developer QA", "Refresh compatibility", "Run focused checks", "Export sanitized evidence"]);
  const focusReturn = await inspectFocusReturns();

  const output = {
    passed: true,
    states: Object.keys(requiredStates),
    widthsPx: [320, 340, 368, 400],
    scalesPercent: [100, 125, 150],
    themes: ["light", "dark"],
    keyboard: matrix.find((item) => item.state === "exact")?.keyboard,
    screenshots: screenshots.map(({ state, width, scale, colorScheme, screenshotPath, screenshotSha256 }) => ({ state, width, scale, colorScheme, screenshotPath, screenshotSha256 })),
    secondaryViews: { troubleshooting: support, developerQa: qa },
    focusReturn
  };
  const evidenceOutputDir = path.join(root, "results", "mica-product-system-rebuild", "foundation-evidence");
  await mkdir(evidenceOutputDir, { recursive: true });
  await writeFile(path.join(evidenceOutputDir, "popup-render.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser.close();
}

async function renderPopup({ state, width, scale, colorScheme, screenshot }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: scale, colorScheme });
  await installChromeStub(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  await page.goto(`${pathToFileURL(popupPath).href}?state=${encodeURIComponent(state)}`, { waitUntil: "load" });
  await page.waitForFunction((expected) => document.getElementById("compatibility-title")?.textContent === expected, requiredStates[state]);
  const result = await page.evaluate(({ state, width, scale, colorScheme }) => {
    const interactive = Array.from(document.querySelectorAll("input, a[href], summary, button:not([disabled])")).filter((element) => {
      const closedDetails = element.closest("details:not([open])");
      return !element.hidden && element.getClientRects().length > 0 && (!closedDetails || element.tagName === "SUMMARY");
    });
    const accessibleNames = interactive.every((element) => (element.getAttribute("aria-label") || element.textContent || element.closest("label")?.textContent || "").trim().length > 0);
    const footer = document.querySelector(".product-footer").getBoundingClientRect();
    return {
      state,
      width,
      scale,
      colorScheme,
      title: document.getElementById("compatibility-title").textContent,
      detail: document.getElementById("compatibility-detail").textContent,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      importantActionsVisible: footer.bottom <= window.innerHeight,
      keyboard: { accessibleNames, interactiveCount: interactive.length }
    };
  }, { state, width, scale, colorScheme });
  await page.evaluate(() => document.activeElement?.blur());
  const focusOrder = [];
  for (let index = 0; index < result.keyboard.interactiveCount; index += 1) {
    await page.keyboard.press("Tab");
    focusOrder.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || null));
  }
  result.keyboard.sampledFocus = focusOrder;
  result.keyboard.focusTraversal = new Set(focusOrder).size === result.keyboard.interactiveCount && !focusOrder.includes(null);
  assert(result.keyboard.focusTraversal, `popup keyboard traversal failed for ${state}`);
  assert(result.keyboard.accessibleNames, `popup accessible name check failed for ${state}`);
  assert(errors.length === 0, `popup ${state} produced page errors: ${errors.join(" | ")}`);

  if (screenshot) {
    const filename = `${state}-${colorScheme}-${width}-${Math.round(scale * 100)}.png`;
    const screenshotPath = path.join(evidenceDir, filename);
    await page.locator("main").screenshot({ path: screenshotPath });
    result.screenshotPath = path.relative(root, screenshotPath).replaceAll("\\", "/");
    result.screenshotSha256 = createHash("sha256").update(await readFile(screenshotPath)).digest("hex");
  }
  await context.close();
  return result;
}

async function inspectSecondaryView(file, expectedText) {
  const context = await browser.newContext({ viewport: { width: 368, height: 900 }, colorScheme: "light" });
  await installChromeStub(context);
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.waitForTimeout(50);
  const result = await page.evaluate((labels) => ({
    labelsPresent: labels.every((label) => document.body.textContent.includes(label)),
    headingFocused: document.activeElement?.id === "view-title",
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  }), expectedText);
  assert(result.labelsPresent, `${path.basename(file)} missing required labels`);
  assert(result.headingFocused, `${path.basename(file)} did not focus the view heading`);
  assert(result.horizontalOverflow === 0, `${path.basename(file)} overflowed horizontally`);
  const filename = `${path.basename(file, ".html")}-light-368-100.png`;
  const screenshotPath = path.join(evidenceDir, filename);
  await page.locator("main").screenshot({ path: screenshotPath });
  result.screenshotPath = path.relative(root, screenshotPath).replaceAll("\\", "/");
  result.screenshotSha256 = createHash("sha256").update(await readFile(screenshotPath)).digest("hex");
  await context.close();
  return result;
}

async function inspectFocusReturns() {
  const context = await browser.newContext({ viewport: { width: 368, height: 900 }, colorScheme: "light" });
  await installChromeStub(context);
  const page = await context.newPage();
  await page.goto(pathToFileURL(popupPath).href, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("compatibility-title")?.textContent === "Ready on this page");
  await page.locator("#troubleshooting-link").click();
  await page.waitForFunction(() => document.activeElement?.id === "view-title");
  await page.locator("#back-link").click();
  await page.waitForFunction(() => document.activeElement?.id === "troubleshooting-link");
  const troubleshootingToIndex = await page.evaluate(() => document.activeElement?.id === "troubleshooting-link");

  await page.locator("#troubleshooting-link").click();
  await page.waitForFunction(() => document.activeElement?.id === "view-title");
  await page.locator("#troubleshooting-qa-link").click();
  await page.waitForFunction(() => document.activeElement?.id === "view-title");
  await page.locator("#back-link").click();
  await page.waitForFunction(() => document.activeElement?.id === "troubleshooting-qa-link");
  const qaToTroubleshooting = await page.evaluate(() => document.activeElement?.id === "troubleshooting-qa-link");
  await context.close();
  assert(troubleshootingToIndex && qaToTroubleshooting, "secondary view did not restore focus to its originating link");
  return { troubleshootingToIndex, qaToTroubleshooting };
}

async function installChromeStub(context) {
  await context.addInitScript(({ version, buildLabel, contractHash }) => {
    const params = new URLSearchParams(location.search);
    const requestedState = params.get("state") || "exact";
    const runtimeState = requestedState === "contentUnavailable" ? "content_unavailable" : requestedState;
    const report = {
      candidate: { version, versionName: version, buildLabel, contractHash },
      page: {
        state: runtimeState,
        compatibility: {
          status: runtimeState.toUpperCase(),
          contractId: "fixture-contract",
          contractHash,
          capabilities: [
            { capabilityId: "turns.list", variantId: "fixture-v1", status: requestedState === "unknown" ? "UNKNOWN" : "EXACT", observedInvariants: [], invalidatedBy: [], failOpen: requestedState === "unknown" },
            { capabilityId: "conversation.scrollRoot", variantId: "unproven-v1", status: "UNKNOWN", observedInvariants: [], invalidatedBy: ["not proven"], failOpen: true }
          ]
        }
      },
      runtime: { enabled: requestedState !== "disabled", adapterProducer: "MicaChatGPTAdapter", answerDocumentModelVersion: 1, observerActive: true },
      privacy: { conversationTextIncluded: false, attachmentContentIncluded: false, requestBodyIncluded: false, authTokenIncluded: false, rawDomIncluded: false }
    };
    globalThis.chrome = {
      runtime: { getManifest: () => ({ version, version_name: version }), lastError: null },
      storage: { local: { get: (_defaults, callback) => callback({ enabled: requestedState !== "disabled" }), set: (_value, callback) => callback?.() } },
      tabs: {
        query: (_query, callback) => callback([{ id: 1 }]),
        sendMessage: (_id, message, callback) => {
          if (message.type === "MICA_QA_EXPORT") callback({ report });
          else callback({ settings: { enabled: requestedState !== "disabled" }, status: { state: runtimeState } });
        }
      }
    };
  }, { version: MACHINE_VERSION, buildLabel: BUILD_LABEL, contractHash: currentContractHash });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
