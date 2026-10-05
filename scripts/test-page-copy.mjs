import { createServer } from "node:http";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bundled = path.join(process.env.USERPROFILE || "C:\\Users\\humc2", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
const { chromium } = require(bundled);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mica-copy-"));
const extensionDir = path.join(tempRoot, "extension");
await cp(path.join(root, "dist", "mica-dev"), extensionDir, { recursive: true });
const manifestPath = path.join(extensionDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
manifest.content_scripts[0].matches.push("http://127.0.0.1/*");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const server = createServer(async (request, response) => {
  try {
    const target = path.resolve(root, decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, ""));
    const body = await readFile(target);
    response.writeHead(200, { "content-type": target.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    response.end(body);
  } catch (error) { response.writeHead(404); response.end(String(error)); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let context;
try {
  context = await chromium.launchPersistentContext(path.join(tempRoot, "profile"), {
    headless: true,
    executablePath: process.env.MICA_TEST_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = context.pages()[0] || await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/extension-product-core.html`, { waitUntil: "load" });
  const button = page.locator("[data-mica-ui='copy-markdown']");
  await button.waitFor();
  await button.click();
  await page.waitForTimeout(100);
  const evidence = await page.evaluate(async () => ({
    feedback: document.querySelector("[data-mica-ui='feedback']")?.textContent || null,
    clipboard: await navigator.clipboard.readText().catch((error) => `READ_ERROR:${error.name}`),
    answerCount: document.querySelectorAll("[data-message-author-role='assistant']").length
  }));
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.feedback !== "Copied as Markdown" || !evidence.clipboard.includes("## Extension answer")) process.exitCode = 1;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}
