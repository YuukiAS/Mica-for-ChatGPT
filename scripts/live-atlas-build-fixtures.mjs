import path from "node:path";
import { defaultContractDir, defaultGeneratedFixture, readJson, surfaceKeys, validatePrivacyObject, writeText } from "./live-atlas-common.mjs";

const input = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) || defaultContractDir;
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length) || defaultGeneratedFixture;
const lifecycle = await readJson(path.join(input, "lifecycle.json"));
const coverage = await readJson(path.join(input, "coverage.json"));
const surfaces = await readJson(path.join(input, "surfaces.json"));
validatePrivacyObject({ lifecycle, coverage, surfaces }, "fixture-input");

const surfaceHtml = surfaceKeys.map((key) => renderSurfaceSlot(key, surfaces[key])).join("\n");
const fixture = `<!doctype html>
<html lang="en" data-mica-fixture="true" data-live-atlas-replay="true">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Mica Live Atlas replay fixture</title>
    <style>
      * { box-sizing: border-box; }
      body { min-height: 900px; margin: 0; background: #f7f7f8; color: #171717; font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #atlas-stage { position: relative; min-height: 900px; }
      [data-atlas-surface-slot] { position: absolute; outline: 1px dashed rgba(0,0,0,.18); overflow: hidden; }
      [data-atlas-missing] { position: relative; margin: 8px; padding: 6px 8px; border: 1px solid #999; background: #eee; color: #333; font-size: 12px; }
      [data-atlas-placeholder-text] { display: inline-block; min-width: 3ch; min-height: 1em; border-radius: 3px; background: currentColor; opacity: .18; }
      #atlas-result { position: fixed; left: 8px; top: 8px; z-index: 9999; max-width: 52vw; white-space: pre-wrap; font-size: 11px; background: rgba(255,255,255,.9); }
    </style>
  </head>
  <body>
    <pre id="atlas-result">Idle</pre>
    <div id="atlas-stage">
${surfaceHtml}
    </div>
    <script id="atlas-contract" type="application/json">${escapeHtml(JSON.stringify({ lifecycle, coverage, surfaces }))}</script>
    <script>
      const data = JSON.parse(document.getElementById("atlas-contract").textContent);
      const observed = Object.values(data.surfaces).filter((surface) => surface.status === "OBSERVED");
      const composer = data.surfaces.composer;
      const composerEl = document.querySelector('[data-atlas-surface-slot="composer"]');
      const checks = [
        ["lifecycle events", data.lifecycle.timeline.length >= 8],
        ["schema surfaces present", Object.keys(data.surfaces).length >= 8],
        ["missing surfaces explicit", Object.values(data.surfaces).filter((surface) => surface.status === "MISSING").every((surface) => document.querySelector('[data-atlas-missing="' + surface.name + '"]'))],
        ["composer contract rendered", composer.status !== "OBSERVED" || !!composerEl],
        ["composer geometry from contract", composer.status !== "OBSERVED" || Math.round(composerEl.getBoundingClientRect().width) === Math.round(composer.contract.rect.width)],
        ["no private random text", !JSON.stringify(data).includes(["MY_PRIVATE", "RANDOM_SENTENCE_93817"].join("_"))]
      ].map(([name, passed]) => ({ name, passed: !!passed }));
      document.getElementById("atlas-result").textContent = JSON.stringify({ passed: checks.every((check) => check.passed), observedSurfaces: observed.length, checks }, null, 2);
    </script>
  </body>
</html>`;
await writeText(output, fixture);
console.log(JSON.stringify({ passed: true, input, output, observedSurfaces: Object.values(surfaces).filter((surface) => surface.status === "OBSERVED").length }, null, 2));

function renderSurfaceSlot(key, surface) {
  if (!surface || surface.status !== "OBSERVED" || !surface.contract) {
    return `      <div data-atlas-missing="${escapeAttr(key)}">MISSING ${escapeHtml(key)}</div>`;
  }
  const rect = surface.contract.rect || { x: 0, y: 0, width: 1, height: 1 };
  const style = [
    `left:${cssPx(rect.x)}`,
    `top:${cssPx(rect.y)}`,
    `width:${cssPx(rect.width)}`,
    `height:${cssPx(rect.height)}`,
    ...Object.entries(surface.contract.styles || {}).map(([name, value]) => `${name}:${String(value).replace(/[;"<>]/g, "")}`)
  ].join(";");
  return `      <div data-atlas-surface-slot="${escapeAttr(key)}" style="${escapeAttr(style)}">${renderNode(surface.contract, 0)}</div>`;
}

function renderNode(contract, depth) {
  const tag = safeTag(contract.tag);
  const attrs = Object.entries(contract.attrs || {})
    .filter(([key]) => !/^data-atlas/.test(key))
    .map(([key, value]) => `${escapeAttr(key)}="${escapeAttr(value)}"`)
    .join(" ");
  const role = contract.role && !attrs.includes("role=") ? ` role="${escapeAttr(contract.role)}"` : "";
  const text = renderPlaceholderText(contract.text);
  const children = depth >= 4 ? "" : (contract.children || []).map((child) => renderNode(child, depth + 1)).join("");
  return `<${tag}${role}${attrs ? ` ${attrs}` : ""}>${text}${children}</${tag}>`;
}

function renderPlaceholderText(text) {
  if (!text || text.length === 0) return "";
  const width = Math.max(3, Math.min(32, Math.ceil(text.length / 3)));
  return `<span data-atlas-placeholder-text style="width:${width}ch"></span>`;
}

function safeTag(tag) {
  return /^[a-z0-9-]{1,40}$/.test(String(tag || "")) ? tag : "div";
}

function cssPx(value) {
  return `${Math.max(0, Math.round(Number(value || 0) * 10) / 10)}px`;
}

function escapeHtml(value) {
  return String(value).replace(/[<>&]/g, (char) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
