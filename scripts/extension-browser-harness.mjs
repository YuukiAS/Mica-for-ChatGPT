import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDistDir = path.join(repoRoot, "dist", "mica-dev");

export function loadPlaywright() {
  const candidates = [
    process.env.MICA_PLAYWRIGHT_NODE_MODULES,
    path.join(repoRoot, "node_modules"),
    path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules")
  ].filter(Boolean);
  const errors = [];
  for (const modulesDir of candidates) {
    try { return { ...createRequire(import.meta.url)(path.join(modulesDir, "playwright")), modulesDir }; }
    catch (error) { errors.push(`${modulesDir}: ${String(error?.message || error)}`); }
  }
  throw new Error(`Playwright is unavailable. Checked local, configured and bundled dependency roots. ${errors.join(" | ")}`);
}

export async function launchInstalledExtension(options = {}) {
  const { chromium, modulesDir } = loadPlaywright();
  const distDir = options.distDir || defaultDistDir;
  const profileDir = options.profileDir || await mkdtemp(path.join(os.tmpdir(), options.profilePrefix || "mica-extension-profile-"));
  const ownsProfile = !options.profileDir;
  const viewport = options.viewport || { width: 1280, height: 900 };
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--window-position=-32000,-32000",
      `--window-size=${viewport.width},${viewport.height}`,
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      ...(options.args || [])
    ]
  });
  const worker = await waitForExtensionWorker(context, options.workerTimeoutMs || 10_000);
  const extensionId = new URL(worker.url()).host;
  return {
    chromium,
    modulesDir,
    context,
    worker,
    extensionId,
    profileDir,
    distDir,
    async close({ preserveProfile = false } = {}) {
      try { await context.close(); } catch (_error) { /* cleanup continues */ }
      if (ownsProfile && !preserveProfile) await rm(profileDir, { recursive: true, force: true });
    }
  };
}

export async function waitForExtensionWorker(context, timeoutMs = 10_000) {
  const existing = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
  if (existing) return existing;
  return context.waitForEvent("serviceworker", {
    timeout: timeoutMs,
    predicate: (candidate) => candidate.url().startsWith("chrome-extension://")
  });
}

export async function installNetworkGuard(context, routes = new Map()) {
  const unexpected = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const handler = routes.get(url);
    if (handler) {
      if (typeof handler === "function") await handler(route, request);
      else await route.fulfill(handler);
      return;
    }
    if (/^(?:chrome-extension|data|blob|about):/.test(url)) {
      await route.continue();
      return;
    }
    unexpected.push({ url, method: request.method(), resourceType: request.resourceType() });
    await route.abort("blockedbyclient");
  });
  return unexpected;
}

export async function waitForMicaContentRuntime(worker, pageUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "content runtime unavailable";
  while (Date.now() < deadline) {
    try {
      const proof = await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((candidate) => candidate.url === url);
        if (!tab?.id) throw new Error("fixture tab not found");
        const response = await chrome.tabs.sendMessage(tab.id, { type: "MICA_GET_STATUS" });
        return { tabId: tab.id, response };
      }, pageUrl);
      if (proof?.response?.status) return proof;
    } catch (error) { lastError = String(error?.message || error); }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`installed content runtime did not respond: ${lastError}`);
}

export async function setActiveTab(worker, tabId) {
  return worker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
}

export function repositoryRoot() {
  return repoRoot;
}
