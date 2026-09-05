import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_LABEL, DIST_DIR_NAME, MACHINE_VERSION, VERSION_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", DIST_DIR_NAME);
const srcDir = path.join(root, "extension", "src");
const popupDir = path.join(root, "extension", "popup");
const iconsDir = path.join(root, "extension", "icons");

const manifest = {
  manifest_version: 3,
  name: "Mica for ChatGPT",
  short_name: "Mica",
  version: MACHINE_VERSION,
  version_name: VERSION_NAME,
  description: "Local diagnostics and low-risk render fallback for long ChatGPT threads.",
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
  permissions: ["storage", "activeTab"],
  host_permissions: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: ["known-interruptions.js", "composer-diagnostics.js", "content.js"],
      run_at: "document_idle"
    }
  ]
};

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "popup"), { recursive: true });

const replacements = {
  __MICA_VERSION__: MACHINE_VERSION,
  __MICA_VERSION_NAME__: VERSION_NAME,
  __MICA_BUILD_LABEL__: BUILD_LABEL
};
const render = (source) => Object.entries(replacements).reduce((value, [key, replacement]) => value.replaceAll(key, replacement), source);

const content = render(await readFile(path.join(srcDir, "content.ts"), "utf8"));
const knownInterruptions = render(await readFile(path.join(srcDir, "reliability", "known-interruptions.ts"), "utf8"));
const composerDiagnostics = render(await readFile(path.join(srcDir, "reliability", "composer-diagnostics.ts"), "utf8"));
const popup = render(await readFile(path.join(popupDir, "popup.ts"), "utf8"));

await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outDir, "known-interruptions.js"), knownInterruptions);
await writeFile(path.join(outDir, "composer-diagnostics.js"), composerDiagnostics);
await writeFile(path.join(outDir, "content.js"), content);
await writeFile(path.join(outDir, "popup", "popup.js"), popup);
await cp(path.join(popupDir, "index.html"), path.join(outDir, "popup", "index.html"));
await cp(path.join(popupDir, "popup.css"), path.join(outDir, "popup", "popup.css"));
await cp(iconsDir, path.join(outDir, "icons"), { recursive: true });

console.log(`Built unpacked extension at ${outDir}`);
