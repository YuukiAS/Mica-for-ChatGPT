import path from "node:path";
import { defaultContractDir, defaultGeneratedFixture, readJson, writeText } from "./live-atlas-common.mjs";

const input = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) || defaultContractDir;
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length) || defaultGeneratedFixture;
const lifecycle = await readJson(path.join(input, "lifecycle.json"));
const coverage = await readJson(path.join(input, "coverage.json"));
const surfaces = await readJson(path.join(input, "surfaces.json"));
const fixture = `<!doctype html>
<html lang="en" data-mica-fixture="true" data-live-atlas-replay="true">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Mica Live Atlas replay fixture</title>
    <style>
      body { margin: 0; background: #f7f7f8; color: #171717; font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(840px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 160px; }
      article { margin: 14px 0; padding: 14px; border: 1px solid #d9d9e3; border-radius: 8px; background: #fff; }
      [data-composer-surface="true"] { position: fixed; left: 50%; bottom: 14px; display: grid; grid-template-columns: 1fr auto; gap: 8px; width: min(820px, calc(100vw - 24px)); min-height: 64px; padding: 12px; border-radius: 28px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.12); transform: translateX(-50%); }
      [role="textbox"] { min-height: 36px; outline: none; white-space: pre-wrap; }
      .action-bar { display: flex; justify-content: flex-end; gap: 8px; }
      #atlas-result { position: fixed; left: 8px; top: 8px; z-index: 3; max-width: 48vw; white-space: pre-wrap; font-size: 11px; }
    </style>
  </head>
  <body>
    <pre id="atlas-result">Idle</pre>
    <main id="conversation">
      <article data-testid="conversation-turn-1"><div data-message-author-role="user"></div></article>
      <article data-testid="conversation-turn-2"><div data-message-author-role="assistant" class="markdown"><h2></h2><p></p><ul><li></li></ul><pre><code></code></pre><table><tbody><tr><td></td><td></td></tr></tbody></table></div><div class="action-bar" role="toolbar"><button type="button" aria-label="Copy">Copy</button></div></article>
    </main>
    <form data-testid="composer" data-composer-surface="true"><div role="textbox" contenteditable="plaintext-only" aria-label="Message ChatGPT"></div><button type="submit" data-testid="send-button" aria-label="Send message">Send</button></form>
    <script id="atlas-contract" type="application/json">${escapeHtml(JSON.stringify({ lifecycle, coverage, surfaces }))}</script>
    <script>
      const data = JSON.parse(document.getElementById("atlas-contract").textContent);
      const checks = [
        ["lifecycle events", data.lifecycle.timeline.length >= 8],
        ["composer observed", data.coverage.composer.status === "OBSERVED"],
        ["assistant action bar observed", data.coverage.assistantActionBar.status === "OBSERVED"],
        ["native copy area observed", data.coverage.nativeCopyArea.status === "OBSERVED"],
        ["no raw text", !JSON.stringify(data).includes("fixture answer")]
      ].map(([name, passed]) => ({ name, passed: !!passed }));
      document.getElementById("atlas-result").textContent = JSON.stringify({ passed: checks.every((check) => check.passed), checks }, null, 2);
    </script>
  </body>
</html>`;
await writeText(output, fixture);
console.log(JSON.stringify({ passed: true, input, output }, null, 2));

function escapeHtml(value) {
  return value.replace(/[<>&]/g, (char) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" }[char]));
}
