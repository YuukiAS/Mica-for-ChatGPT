import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "mica-v0.1.0");
const srcDir = path.join(root, "extension", "src");
const popupDir = path.join(root, "extension", "popup");

const manifest = {
  manifest_version: 3,
  name: "Mica for ChatGPT",
  short_name: "Mica",
  version: "0.1.0",
  description: "Low-risk render containment for very long ChatGPT threads.",
  action: {
    default_title: "Mica",
    default_popup: "popup/index.html"
  },
  permissions: ["storage", "activeTab"],
  host_permissions: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: ["content.js"],
      run_at: "document_idle"
    }
  ]
};

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "popup"), { recursive: true });

const content = await readFile(path.join(srcDir, "content.ts"), "utf8");
const popup = await readFile(path.join(popupDir, "popup.ts"), "utf8");

await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outDir, "content.js"), content);
await writeFile(path.join(outDir, "popup", "popup.js"), popup);
await cp(path.join(popupDir, "index.html"), path.join(outDir, "popup", "index.html"));
await cp(path.join(popupDir, "popup.css"), path.join(outDir, "popup", "popup.css"));

console.log(`Built unpacked extension at ${outDir}`);
