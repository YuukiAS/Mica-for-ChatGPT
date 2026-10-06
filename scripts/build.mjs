import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_LABEL, DEV_DIST_DIR_NAME, MACHINE_VERSION, VERSION_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const srcDir = path.join(root, "extension", "src");
const popupDir = path.join(root, "extension", "popup");
const exportDir = path.join(root, "extension", "export");
const optionsDir = path.join(root, "extension", "options");
const iconsDir = path.join(root, "extension", "icons");
const katexDistDir = path.join(root, "node_modules", "katex", "dist");

const manifest = {
  manifest_version: 3,
  name: "Mica for ChatGPT",
  short_name: "Mica",
  version: MACHINE_VERSION,
  version_name: VERSION_NAME,
  description: "Local copy, delivery recovery, and research export for ChatGPT.",
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
  background: {
    service_worker: "service-worker.js"
  },
  options_ui: { page: "options/index.html", open_in_tab: true },
  permissions: ["storage", "activeTab", "clipboardWrite"],
  host_permissions: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: ["low-memory-page.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: ["low-memory-config.js"],
      run_at: "document_start"
    },
    {
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      js: [
        "current-ui-check.js",
        "markdown-copy.js",
        "research-export.js",
        "highlighter.js",
        "low-memory-windowing.js",
        "turn-delivery-guard.js",
        "content.js"
      ],
      run_at: "document_idle"
    }
  ]
};

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "popup"), { recursive: true });
await mkdir(path.join(outDir, "export"), { recursive: true });
await mkdir(path.join(outDir, "options"), { recursive: true });
await mkdir(path.join(outDir, "vendor", "katex"), { recursive: true });

const replacements = {
  __MICA_VERSION__: MACHINE_VERSION,
  __MICA_VERSION_NAME__: VERSION_NAME,
  __MICA_BUILD_LABEL__: BUILD_LABEL
};
const render = (source) => Object.entries(replacements).reduce((value, [key, replacement]) => value.replaceAll(key, replacement), source);

const content = render(await readFile(path.join(srcDir, "content.ts"), "utf8"));
const currentUiCheck = render(await readFile(path.join(srcDir, "diagnostics", "current-ui-check.ts"), "utf8"));
const serviceWorker = render(await readFile(path.join(srcDir, "service-worker.ts"), "utf8"));
const markdownCopy = render(await readFile(path.join(srcDir, "copy", "markdown-copy.ts"), "utf8"));
const researchExport = render(await readFile(path.join(srcDir, "export", "research-export.ts"), "utf8"));
const highlighter = render(await readFile(path.join(srcDir, "highlight", "highlighter.ts"), "utf8"));
const lowMemoryConfig = render(await readFile(path.join(srcDir, "low-memory", "low-memory-config.ts"), "utf8"));
const lowMemoryPage = render(await readFile(path.join(srcDir, "low-memory", "low-memory-page.ts"), "utf8"));
const lowMemoryWindowing = render(await readFile(path.join(srcDir, "low-memory", "low-memory-windowing.ts"), "utf8"));
const turnDeliveryGuard = render(await readFile(path.join(srcDir, "reliability", "turn-delivery-guard.ts"), "utf8"));
const popup = render(await readFile(path.join(popupDir, "popup.ts"), "utf8"));

await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outDir, "service-worker.js"), serviceWorker);
await writeFile(path.join(outDir, "markdown-copy.js"), markdownCopy);
await writeFile(path.join(outDir, "research-export.js"), researchExport);
await writeFile(path.join(outDir, "highlighter.js"), highlighter);
await writeFile(path.join(outDir, "low-memory-config.js"), lowMemoryConfig);
await writeFile(path.join(outDir, "low-memory-page.js"), lowMemoryPage);
await writeFile(path.join(outDir, "low-memory-windowing.js"), lowMemoryWindowing);
await writeFile(path.join(outDir, "turn-delivery-guard.js"), turnDeliveryGuard);
await writeFile(path.join(outDir, "content.js"), content);
await writeFile(path.join(outDir, "current-ui-check.js"), currentUiCheck);
await writeFile(path.join(outDir, "popup", "popup.js"), popup);
await cp(path.join(popupDir, "index.html"), path.join(outDir, "popup", "index.html"));
await cp(path.join(popupDir, "popup.css"), path.join(outDir, "popup", "popup.css"));
await cp(path.join(exportDir, "index.html"), path.join(outDir, "export", "index.html"));
await cp(path.join(exportDir, "export.css"), path.join(outDir, "export", "export.css"));
await writeFile(path.join(outDir, "export", "export.js"), render(await readFile(path.join(exportDir, "export.ts"), "utf8")));
await cp(path.join(optionsDir, "index.html"), path.join(outDir, "options", "index.html"));
await cp(path.join(optionsDir, "options.css"), path.join(outDir, "options", "options.css"));
await writeFile(path.join(outDir, "options", "options.js"), render(await readFile(path.join(optionsDir, "options.ts"), "utf8")));
await cp(path.join(katexDistDir, "katex.min.js"), path.join(outDir, "vendor", "katex", "katex.min.js"));
await cp(path.join(katexDistDir, "katex.min.css"), path.join(outDir, "vendor", "katex", "katex.min.css"));
await cp(path.join(katexDistDir, "fonts"), path.join(outDir, "vendor", "katex", "fonts"), { recursive: true });
await cp(iconsDir, path.join(outDir, "icons"), { recursive: true });

console.log(`Built unpacked extension at ${outDir}`);
