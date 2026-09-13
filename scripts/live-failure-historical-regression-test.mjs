import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledNodeModules = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = loadPlaywright();

const OLD_REF = "2090bb6";
const started = performance.now();
const oldCopy = await gitShow(`${OLD_REF}:extension/src/copy/markdown-copy.ts`);
const oldResidual = await gitShow(`${OLD_REF}:extension/src/reliability/send-residual-recovery.ts`);
const currentCopy = await readFile(path.join(root, "dist", "mica-dev", "markdown-copy.js"), "utf8");
const currentResidual = await readFile(path.join(root, "dist", "mica-dev", "send-residual-recovery.js"), "utf8");
const virtualClock = await readFile(path.join(root, "tests", "fixtures", "virtual-clock.js"), "utf8");
const actionbarHtml = (await readFile(path.join(root, "tests", "fixtures", "real-actionbar-placement.html"), "utf8"))
  .replace(/<script\s+src=["']\.\.\/\.\.\/dist\/mica-dev\/markdown-copy\.js["']><\/script>/, '<script src="/runtime/markdown-copy.js"></script>');
const residualHtml = (await readFile(path.join(root, "tests", "fixtures", "real-long-residual.html"), "utf8"))
  .replace(/<script\s+src=["']\.\/virtual-clock\.js["']><\/script>/, '<script src="/runtime/virtual-clock.js"></script>')
  .replace(/<script\s+src=["']\.\.\/\.\.\/dist\/mica-dev\/send-residual-recovery\.js["']><\/script>/, '<script src="/runtime/send-residual-recovery.js"></script>');

const results = [];
results.push(await runFixture({
  label: "2090bb6-actionbar",
  html: actionbarHtml,
  scripts: { "/runtime/markdown-copy.js": oldCopy },
  resultId: "actionbar-result",
  expectedPassed: false
}));
results.push(await runFixture({
  label: "current-actionbar",
  html: actionbarHtml,
  scripts: { "/runtime/markdown-copy.js": currentCopy },
  resultId: "actionbar-result",
  expectedPassed: true
}));
results.push(await runFixture({
  label: "2090bb6-long-residual",
  html: residualHtml,
  scripts: {
    "/runtime/virtual-clock.js": virtualClock,
    "/runtime/send-residual-recovery.js": oldResidual
  },
  resultId: "real-residual-result",
  expectedPassed: false,
  query: "clock=virtual",
  timeoutMs: 12000
}));
results.push(await runFixture({
  label: "current-long-residual",
  html: residualHtml,
  scripts: {
    "/runtime/virtual-clock.js": virtualClock,
    "/runtime/send-residual-recovery.js": currentResidual
  },
  resultId: "real-residual-result",
  expectedPassed: true,
  query: "clock=virtual",
  timeoutMs: 12000
}));

console.log(JSON.stringify({
  passed: true,
  historicalRef: OLD_REF,
  "2090bb6ActionbarExactFixture": "EXPECTED_FAIL",
  "2090bb6LongResidualExactFixture": "EXPECTED_FAIL",
  currentRuntimeActionbarExactFixture: "PASS",
  currentRuntimeLongResidualExactFixture: "PASS",
  results,
  totalSeconds: secondsSince(started)
}, null, 2));

async function runFixture({ label, html, scripts, resultId, expectedPassed, query = "", timeoutMs = 8000 }) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/fixture.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(scripts, url.pathname)) {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(scripts[url.pathname]);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error?.stack || error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let payload;
  try {
    const separator = query ? `?${query}&` : "?";
    await page.goto(`http://127.0.0.1:${port}/fixture.html${separator}t=${Date.now()}`, { waitUntil: "load" });
    await page.waitForFunction((id) => {
      const text = document.getElementById(id)?.textContent || "";
      return text.trim().startsWith("{");
    }, resultId, { timeout: timeoutMs });
    payload = JSON.parse(await page.locator(`#${resultId}`).textContent());
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
  const actualPassed = payload?.passed === true && errors.length === 0;
  assert.equal(actualPassed, expectedPassed, `${label} expected passed=${expectedPassed}: ${JSON.stringify({ payload, errors })}`);
  return {
    label,
    expected: expectedPassed ? "PASS" : "EXPECTED_FAIL",
    actualPassed,
    failedChecks: Array.isArray(payload?.checks) ? payload.checks.filter((check) => check && check.passed === false).map((check) => check.name) : [],
    errors
  };
}

async function gitShow(spec) {
  const { stdout } = await execFileAsync("git", ["show", spec], { cwd: root, maxBuffer: 1024 * 1024 * 8 });
  return stdout;
}

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch (_error) {
    return createRequire(path.join(bundledNodeModules, "package.json"))("playwright");
  }
}

function secondsSince(startedAt) {
  return Number(((performance.now() - startedAt) / 1000).toFixed(2));
}
