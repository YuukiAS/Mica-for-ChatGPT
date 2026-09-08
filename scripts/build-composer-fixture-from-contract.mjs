import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const contractArg = process.argv.find((arg) => arg.startsWith("--contract="))?.slice("--contract=".length)
  || "tests/contracts/chatgpt-composer/2026-09-08.synthetic.json";
const outArg = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
  || "tests/fixtures/generated/chatgpt-composer-contract.html";

const contractPath = path.resolve(process.cwd(), contractArg);
const outPath = path.resolve(process.cwd(), outArg);
const contract = JSON.parse(await readFile(contractPath, "utf8"));

assert(contract?.schemaVersion === 1, "contract schemaVersion must be 1");
assert(contract?.privacy?.promptTextIncluded === false, "contract must exclude prompt text");
assert(contract?.privacy?.conversationTextIncluded === false, "contract must exclude conversation text");
assert(contract?.privacy?.authDataIncluded === false, "contract must exclude auth data");

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, renderFixture(contract));
console.log(`Built composer contract fixture at ${outPath}`);

function renderFixture(data) {
  const root = data.composer?.root || {};
  const editable = data.composer?.editable || {};
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const surfaceStyle = nodes.find((node) => node.data?.composerSurface === "true")?.style || {};
  const bodyStyle = nodes.find((node) => node.data?.composerBody === "true")?.style || {};
  return `<!doctype html>
<html lang="en" data-mica-fixture="true">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Mica composer contract fixture</title>
    <style>
      * { box-sizing: border-box; }
      body { min-height: 1000px; margin: 0; background: #f7f7f8; color: #171717; font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(840px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 180px; }
      article { margin: 14px 0; padding: 14px; border: 1px solid #d9d9e3; border-radius: 8px; background: #fff; }
      [data-testid="composer"] { position: fixed; left: 50%; bottom: 14px; width: min(820px, calc(100vw - 24px)); transform: translateX(-50%); }
      [data-composer-surface="true"] { display: ${css(surfaceStyle.display, "grid")}; min-height: ${css(surfaceStyle.minHeight, "52px")}; width: 100%; padding: 8px 10px; overflow: ${css(surfaceStyle.overflow, "clip")}; border-radius: ${css(surfaceStyle.borderRadius, "28px")}; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.12); }
      [data-composer-body="true"] { display: ${css(bodyStyle.display, "grid")}; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 36px; }
      button { min-width: 32px; height: 32px; border: 1px solid rgba(0,0,0,.08); border-radius: 999px; background: #f7f7f8; font: inherit; }
      [data-testid="send-button"] { background: #171717; color: #fff; }
      [role="textbox"] { min-height: 32px; padding: 6px 4px; outline: none; white-space: pre-wrap; }
      #contract-result { position: fixed; left: 8px; top: 8px; max-width: 48vw; white-space: pre-wrap; font-size: 11px; }
    </style>
  </head>
  <body>
    <pre id="contract-result">Idle</pre>
    <main>
      <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">assistant turn</div></article>
    </main>
    <form data-testid="${escapeAttr(root.testId || "composer")}" aria-label="Message composer">
      <div data-composer-surface="true">
        <div data-composer-body="true">
          <button type="button" data-testid="composer-plus-btn" aria-label="Add files">+</button>
          <div role="${escapeAttr(editable.role || "textbox")}" contenteditable="${escapeAttr(editable.contenteditable || "plaintext-only")}" aria-label="Message Mica"></div>
          <button type="submit" data-testid="send-button" aria-label="Send message">Send</button>
        </div>
      </div>
    </form>
    <script src="../../dist/mica-dev/known-interruptions.js"></script>
    <script src="../../dist/mica-dev/connector-lifecycle-signal.js"></script>
    <script src="../../dist/mica-dev/composer-diagnostics.js"></script>
    <script src="../../dist/mica-dev/stale-composer-recovery.js"></script>
    <script src="../../dist/mica-dev/connector-continuity.js"></script>
    <script src="../../dist/mica-dev/send-residual-recovery.js"></script>
    <script src="../../dist/mica-dev/content.js"></script>
    <script>
      const result = {
        passed: !!document.querySelector("[role='textbox']") && !!document.querySelector("[data-composer-surface='true']"),
        contractId: ${JSON.stringify(data.contractId || null)},
        promptTextIncluded: false,
        conversationTextIncluded: false
      };
      document.getElementById("contract-result").textContent = JSON.stringify(result, null, 2);
    </script>
  </body>
</html>
`;
}

function css(value, fallback) {
  const text = String(value || fallback);
  return /^[#(),.%\w\s-]+$/.test(text) ? text : fallback;
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
