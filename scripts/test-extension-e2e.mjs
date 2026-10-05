import { createServer } from "node:http";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bundled = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
const { chromium } = require(bundled);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mica-e2e-"));
const userDataDir = path.join(tempRoot, "profile");
const extensionDir = path.join(tempRoot, "extension");
const evidenceDir = path.join(root, "results", "mica--product-recovery-current-gpt-ui", "visual-evidence");
await cp(path.join(root, "dist", "mica-dev"), extensionDir, { recursive: true });
const manifestPath = path.join(extensionDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
manifest.content_scripts[0].matches.push("http://127.0.0.1/*");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(evidenceDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const target = path.resolve(root, decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, ""));
    if (!target.startsWith(root)) throw new Error("forbidden");
    const body = await readFile(target);
    response.writeHead(200, { "content-type": target.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    response.end(body);
  } catch (error) {
    response.writeHead(404); response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/tests/fixtures/extension-product-core.html`;
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    executablePath: process.env.MICA_TEST_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const fixture = context.pages()[0] || await context.newPage();
  await fixture.goto(fixtureUrl, { waitUntil: "load" });
  await fixture.waitForSelector("[data-mica-ui='copy-markdown']", { timeout: 10000 });

  const popup = await context.newPage();
  await fixture.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`, { waitUntil: "load" });
  await popup.waitForFunction(() => document.getElementById("copyMarkdown")?.disabled === false);
  const popupLabels = await popup.locator("h1, h2, summary, footer").allTextContents();
  assert(!popupLabels.join(" ").match(/Atlas|Diagnostics|fixture|selector|mounted|optimized/i), "developer wording leaked into popup");
  await popup.locator("#copyMarkdown").click();
  await popup.waitForFunction(() => document.getElementById("feedback")?.textContent === "Copied as Markdown.");
  const clipboard = await popup.evaluate(() => navigator.clipboard.readText());
  assert(clipboard.includes("## Extension answer") && clipboard.includes("$E=mc^2$"), "clipboard MIME text did not contain serialized Markdown/LaTeX");

  const matrix = [];
  const popupCdp = await context.newCDPSession(popup);
  for (const colorScheme of ["light", "dark"]) {
    await popup.emulateMedia({ colorScheme });
    for (const width of [320, 360, 400]) {
      await popup.setViewportSize({ width, height: 620 });
      for (const zoom of [1, 1.25, 1.5]) {
        await popupCdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: zoom });
        const geometry = await popup.evaluate(() => {
          const body = document.body.getBoundingClientRect();
          const controls = Array.from(document.querySelectorAll("button, input, summary"));
          return {
            bodyWidth: body.width,
            viewportWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            clipped: controls.some((node) => { const rect = node.getBoundingClientRect(); return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1; })
          };
        });
        assert(!geometry.clipped && geometry.scrollWidth <= geometry.viewportWidth + 1, `popup overflowed at ${width}px/${zoom}x/${colorScheme}`);
        matrix.push({ width, zoom, colorScheme, ...geometry });
      }
      await popupCdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      if (width === 360) {
        const bodyBox = await popup.locator("body").boundingBox();
        const mainBox = await popup.locator("main").boundingBox();
        await popup.screenshot({
          path: path.join(evidenceDir, `0.3.0-popup-${colorScheme}-360.png`),
          clip: { x: 0, y: 0, width: Math.ceil(bodyBox.width), height: Math.ceil(mainBox.height) }
        });
      }
    }
  }

  await popup.locator("summary").click();
  await popup.locator("#copyExport").uncheck();
  await popup.waitForFunction(() => document.getElementById("copyMarkdown")?.disabled === true);
  const persisted = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(["copyExport"], resolve)));
  assert(persisted.copyExport === false, "popup setting did not persist");
  await popup.locator("#copyExport").check();

  const placement = await fixture.evaluate(() => {
    const nativeCopy = document.querySelector("[data-mica-current-action-cluster] > [aria-label='Copy']");
    const micaCopy = document.querySelector("[data-mica-ui='copy-markdown']");
    return {
      adjacent: micaCopy?.previousElementSibling === nativeCopy,
      sameParent: micaCopy?.parentElement === nativeCopy?.parentElement,
      ariaLabel: micaCopy?.getAttribute("aria-label"),
      count: document.querySelectorAll("[data-mica-ui='copy-markdown']").length
    };
  });
  assert(placement.adjacent && placement.sameParent && placement.count === 1, "extension injection placement failed");
  assert(placement.ariaLabel === "Copy as Markdown", "extension action accessible label failed");
  const lifecycle = await fixture.evaluate(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const form = document.querySelector("form");
    let composer = document.getElementById("mobile-composer-prompt");
    const sent = "Connector result with a deliberately long confirmed payload 1234567890";
    composer.value = sent;
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await delay(10);
    const readState = () => JSON.parse(document.documentElement.dataset.micaDeliveryState || "null");
    const awaiting = readState();
    composer.value = "";
    const replacement = composer.cloneNode(true);
    replacement.value = sent;
    composer.replaceWith(replacement);
    composer = replacement;
    const oldBadResidual = composer.value === sent;
    const userTurn = document.createElement("article");
    userTurn.dataset.testid = "conversation-turn-user-1";
    userTurn.innerHTML = `<div data-message-author-role="user"></div>`;
    userTurn.querySelector("div").textContent = sent;
    document.body.insertBefore(userTurn, form);
    await delay(40);
    const committed = readState();
    const newGoodResidualCleared = composer.value === "";
    composer.value = "new draft that must survive";
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: composer.value }));
    const assistant = document.createElement("article");
    assistant.dataset.testid = "conversation-turn-assistant-2";
    assistant.innerHTML = '<div data-message-author-role="assistant">Fresh response</div>';
    document.body.insertBefore(assistant, form);
    await delay(20);
    const afterAssistant = readState().name;
    await delay(120);
    return {
      awaiting: awaiting.name,
      oldBadResidual,
      committed: committed.name,
      newGoodResidualCleared,
      autoRecoveryCount: committed.autoRecoveryCount,
      nextDraftPreserved: composer.value === "new draft that must survive",
      afterAssistant,
      afterSettled: readState().name
    };
  });
  assert(lifecycle.awaiting === "awaiting_user_commit", "send intent was not recorded");
  assert(lifecycle.oldBadResidual, "OLD_RC10_RC11_LONG_CONNECTOR_RESIDUAL did not reproduce expected failure");
  assert(lifecycle.committed === "user_committed" && lifecycle.newGoodResidualCleared, "confirmed matching residual was not cleared");
  assert(lifecycle.autoRecoveryCount === 1 && lifecycle.nextDraftPreserved, "recovery did not honor one-shot/new-draft guard");
  assert(lifecycle.afterAssistant === "assistant_generating", "assistant progress transition failed");
  assert(lifecycle.afterSettled === "settled", "assistant settled transition failed");
  const anomalies = {
    ghost: await runAnomalyScenario(context, fixtureUrl, "ghost"),
    fakeWaiting: await runAnomalyScenario(context, fixtureUrl, "fake_waiting"),
    generationError: await runAnomalyScenario(context, fixtureUrl, "generation_error"),
    staleResponse: await runAnomalyScenario(context, fixtureUrl, "stale_response")
  };
  assert(anomalies.ghost.state === "ghost_send_suspected" && anomalies.ghost.draftRestored, "ghost-send recovery failed");
  assert(anomalies.fakeWaiting.state === "fake_waiting_suspected", "fake-waiting detection failed");
  assert(anomalies.generationError.state === "generation_error_recovery_available", "generation-error detection failed");
  assert(anomalies.staleResponse.state === "stale_response_suspected", "stale-response detection failed");
  console.log(JSON.stringify({ passed: true, extensionId, clipboardLength: clipboard.length, placement, lifecycle, anomalies, popupMatrix: matrix }, null, 2));
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runAnomalyScenario(context, fixtureUrl, kind) {
  const page = await context.newPage();
  try {
    await page.goto(fixtureUrl, { waitUntil: "load" });
    await page.waitForFunction(() => !!document.documentElement.dataset.micaDeliveryState);
    const prompt = `fixture prompt ${kind}`;
    await page.evaluate(({ kind, prompt }) => {
      const form = document.querySelector("form");
      const composer = document.getElementById("mobile-composer-prompt");
      composer.value = prompt;
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      composer.value = "";
      if (kind === "ghost") return;
      const user = document.createElement("article");
      user.dataset.testid = `conversation-turn-user-${kind}`;
      user.innerHTML = '<div data-message-author-role="user"></div>';
      user.firstElementChild.textContent = prompt;
      document.body.insertBefore(user, form);
      if (kind === "generation_error") {
        const alert = document.createElement("div");
        alert.setAttribute("role", "alert");
        alert.textContent = "Network error: response failed";
        document.body.append(alert);
      }
      if (kind === "stale_response") {
        const baseline = document.querySelector("[data-testid='conversation-turn-extension']");
        const duplicate = baseline.cloneNode(true);
        duplicate.dataset.testid = "conversation-turn-assistant-duplicate";
        document.body.insertBefore(duplicate, form);
      }
    }, { kind, prompt });

    if (kind === "ghost") {
      await waitForDeliveryState(page, "ghost_send_suspected");
      await page.locator(".mica-delivery-notice button").click();
      const draftRestored = await page.locator("#mobile-composer-prompt").inputValue();
      return { state: "ghost_send_suspected", actionCount: 1, draftRestored: draftRestored === prompt };
    }

    if (kind === "fake_waiting") {
      await waitForDeliveryState(page, "fake_waiting_suspected");
      return { state: "fake_waiting_suspected", actionCount: await page.locator(".mica-delivery-notice button").count() };
    }
    if (kind === "generation_error") {
      await waitForDeliveryState(page, "generation_error_recovery_available");
      return { state: "generation_error_recovery_available", actionCount: await page.locator(".mica-delivery-notice button").count() };
    }
    await waitForDeliveryState(page, "stale_response_suspected");
    return { state: "stale_response_suspected", actionCount: await page.locator(".mica-delivery-notice button").count() };
  } finally {
    await page.close();
  }
}

async function waitForDeliveryState(page, name) {
  await page.waitForFunction((expected) => {
    const value = JSON.parse(document.documentElement.dataset.micaDeliveryState || "null");
    return value?.name === expected;
  }, name, { timeout: 3000 });
}
