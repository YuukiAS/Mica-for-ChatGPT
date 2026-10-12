import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_LABEL, DEV_BUILD, DEV_DIST_DIR_NAME, MACHINE_VERSION, VERSION_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const srcDir = path.join(root, "extension", "src");
const popupDir = path.join(root, "extension", "popup");
const iconsDir = path.join(root, "extension", "icons");
const contractPath = path.join(root, "contracts", "chatgpt", "current.json");
const contractSource = await readFile(contractPath);
const contractHash = createHash("sha256").update(contractSource).digest("hex");

const manifest = {
  manifest_version: 3,
  name: "Mica for ChatGPT",
  short_name: "Mica",
  version: MACHINE_VERSION,
  version_name: VERSION_NAME,
  description: "Local controls for a calmer, more capable ChatGPT workspace.",
  icons: {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png"
  },
  action: {
    default_title: "Mica",
    default_popup: "popup/index.html",
    default_icon: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png"
    }
  },
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  background: { service_worker: "low-memory-background.js" },
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: ["low-memory-config.js"],
      run_at: "document_start"
    },
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: [
        "chatgpt-adapter.js",
        "answer-document.js",
        "content.js"
      ],
      run_at: "document_idle"
    }
  ]
};

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "popup"), { recursive: true });

const replacements = {
  __MICA_VERSION__: MACHINE_VERSION,
  __MICA_VERSION_NAME__: VERSION_NAME,
  __MICA_BUILD_LABEL__: BUILD_LABEL,
  __MICA_CHATGPT_CONTRACT_HASH__: contractHash,
  __MICA_DEV_BUILD__: String(DEV_BUILD)
};
const render = (source) => Object.entries(replacements).reduce((value, [key, replacement]) => value.replaceAll(key, replacement), source);

const content = render(await readFile(path.join(srcDir, "content.ts"), "utf8"));
const chatgptAdapter = render(await readFile(path.join(srcDir, "core", "chatgpt-adapter.ts"), "utf8"));
const answerDocument = render(await readFile(path.join(srcDir, "core", "answer-document.ts"), "utf8"));
const lowMemoryCore = render(await readFile(path.join(srcDir, "low-memory", "low-memory-core.ts"), "utf8"));
const lowMemoryPage = render(await readFile(path.join(srcDir, "low-memory", "low-memory-page.ts"), "utf8"));
const lowMemoryConfig = render(await readFile(path.join(srcDir, "low-memory", "low-memory-config.ts"), "utf8"));
const lowMemoryBackground = render(await readFile(path.join(srcDir, "low-memory", "low-memory-background.ts"), "utf8"));
const popup = render(await readFile(path.join(popupDir, "popup.ts"), "utf8"));
const troubleshooting = render(await readFile(path.join(popupDir, "troubleshooting.ts"), "utf8"));
const qa = render(await readFile(path.join(popupDir, "qa.ts"), "utf8"));

await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outDir, "chatgpt-adapter.js"), chatgptAdapter);
await writeFile(path.join(outDir, "answer-document.js"), answerDocument);
await writeFile(path.join(outDir, "low-memory-core.js"), lowMemoryCore);
await writeFile(path.join(outDir, "low-memory-page.js"), lowMemoryPage);
await writeFile(path.join(outDir, "low-memory-config.js"), lowMemoryConfig);
await writeFile(path.join(outDir, "low-memory-background.js"), lowMemoryBackground);
await writeFile(path.join(outDir, "content.js"), content);
await writeFile(path.join(outDir, "popup", "popup.js"), popup);
await writeFile(path.join(outDir, "popup", "troubleshooting.js"), troubleshooting);
await writeFile(path.join(outDir, "popup", "qa.js"), qa);
await cp(path.join(popupDir, "index.html"), path.join(outDir, "popup", "index.html"));
await cp(path.join(popupDir, "troubleshooting.html"), path.join(outDir, "popup", "troubleshooting.html"));
await cp(path.join(popupDir, "qa.html"), path.join(outDir, "popup", "qa.html"));
await cp(path.join(popupDir, "popup.css"), path.join(outDir, "popup", "popup.css"));
await cp(iconsDir, path.join(outDir, "icons"), { recursive: true });

console.log(`Built unpacked extension at ${outDir}`);
