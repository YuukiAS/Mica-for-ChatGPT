import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bundled = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
const { chromium } = require(bundled);
const server = createServer(async (request, response) => {
  try {
    const target = path.resolve(root, decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, ""));
    if (!target.startsWith(root)) throw new Error("forbidden");
    const body = await readFile(target);
    response.writeHead(200, { "content-type": contentType(target) });
    response.end(body);
  } catch (error) {
    response.writeHead(404); response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MICA_TEST_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.goto(`${baseUrl}/tests/fixtures/product-core.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__MICA_TEST_CONTROLS__ && !!document.querySelector("[data-mica-ui='copy-markdown']"));
  const result = await page.evaluate(() => {
    const serialized = window.__MICA_TEST_CONTROLS__.serializeLatestAnswer();
    const nativeCopy = document.querySelector("[data-mica-current-action-cluster] > [aria-label='Copy']");
    const micaCopy = document.querySelector("[data-mica-ui='copy-markdown']");
    const legacy = document.getElementById("legacy-copy");
    const hotpathCounters = { querySelectorAll: 0, cloneNode: 0, geometry: 0, computedStyle: 0 };
    const originals = {
      querySelectorAll: Document.prototype.querySelectorAll,
      cloneNode: Node.prototype.cloneNode,
      rect: Element.prototype.getBoundingClientRect,
      computed: window.getComputedStyle
    };
    Document.prototype.querySelectorAll = function (...args) { hotpathCounters.querySelectorAll += 1; return originals.querySelectorAll.apply(this, args); };
    Node.prototype.cloneNode = function (...args) { hotpathCounters.cloneNode += 1; return originals.cloneNode.apply(this, args); };
    Element.prototype.getBoundingClientRect = function (...args) { hotpathCounters.geometry += 1; return originals.rect.apply(this, args); };
    window.getComputedStyle = function (...args) { hotpathCounters.computedStyle += 1; return originals.computed.apply(this, args); };
    const composer = document.getElementById("mobile-composer-prompt");
    for (const value of ["a", "ab", "中文", "中文输入", "paste value"]) {
      composer.value = value;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    }
    Document.prototype.querySelectorAll = originals.querySelectorAll;
    Node.prototype.cloneNode = originals.cloneNode;
    Element.prototype.getBoundingClientRect = originals.rect;
    window.getComputedStyle = originals.computed;
    return {
      serialized,
      oldPlacementExpectedFail: legacy.parentElement !== nativeCopy.parentElement,
      newPlacementPass: micaCopy?.previousElementSibling === nativeCopy && micaCopy?.parentElement === nativeCopy.parentElement,
      tooltip: micaCopy?.getAttribute("title"),
      ariaLabel: micaCopy?.getAttribute("aria-label"),
      hotpathCounters,
      status: window.__MICA_TEST_CONTROLS__.getStatus()
    };
  });
  assert(result.serialized.ok, "serializer did not produce output");
  for (const token of ["## Result", "**bold**", "[source](https://example.com)", "$x^2 + y^2$", "$$", "| Item | Value |", "```js", "  - Nested"]) {
    assert(result.serialized.markdown.includes(token), `Markdown missing ${token}`);
  }
  assert(!result.serialized.markdown.includes("Retry"), "answer action leaked into Markdown");
  assert(result.oldPlacementExpectedFail, "OLD_0_2_4_OR_RC11_COPY_PLACEMENT did not reproduce expected failure");
  assert(result.newPlacementPass, "new copy control is not directly adjacent to native Copy");
  assert(result.tooltip === "Copy as Markdown" && result.ariaLabel === "Copy as Markdown", "copy control accessible label drifted");
  assert(Object.values(result.hotpathCounters).every((count) => count === 0), `ordinary input hot path performed heavy work: ${JSON.stringify(result.hotpathCounters)}`);
  assert(result.status.copy.placementContract === "exact-v1", "fixture contract was not recognized");
  console.log(JSON.stringify({ passed: true, oldBad: "EXPECTED_FAIL", newGood: "PASS", result }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".ts")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
