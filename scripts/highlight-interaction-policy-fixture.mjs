import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "dist", DEV_DIST_DIR_NAME, "highlight-interaction-policy.js"), "utf8");
const context = vm.createContext({ console });
context.globalThis = context;
vm.runInContext(source, context, { filename: "highlight-interaction-policy.js" });

const policy = context.MicaHighlightInteractionPolicy;
assert.ok(policy, "interaction policy was not exported");

const canonical = policy.parseShortcut(" control + SHIFT + k ");
assert.equal(canonical.label, "Ctrl+Shift+K");
assert.equal(canonical.key, "k");
assert.equal(canonical.ctrl, true);
assert.equal(canonical.shift, true);
assert.equal(canonical.alt, false);
assert.equal(canonical.meta, false);

for (const invalid of ["H", "Shift+H", "Alt+Enter", "Alt+Space", "Alt+Shift", "Alt+Alt+H", "Alt+Shift+HH", "Alt+Shift+H+Q"]) {
  assert.equal(policy.parseShortcut(invalid), null, `unsafe shortcut was accepted: ${invalid}`);
}

const both = policy.fromSettings({ defaultColor: "blue", shortcut: "Alt+Shift+H", toolbarBehavior: "both" });
assert.equal(both.defaultColor, "blue");
assert.equal(both.selectionToolbar, true);
assert.equal(both.shortcutHighlight, true);
assert.equal(policy.matchesShortcut(keyEvent(), both), true);
assert.equal(policy.matchesShortcut(keyEvent({ repeat: true }), both), false);
assert.equal(policy.matchesShortcut(keyEvent({ isComposing: true }), both), false);
assert.equal(policy.matchesShortcut(keyEvent({ key: "j" }), both), false);
assert.equal(policy.matchesShortcut(keyEvent({ shiftKey: false }), both), false);

const selection = policy.fromSettings({ defaultColor: "pink", shortcut: "Ctrl+K", toolbarBehavior: "selection" });
assert.equal(selection.selectionToolbar, true);
assert.equal(selection.shortcutHighlight, false);
assert.equal(policy.matchesShortcut({ ...keyEvent(), key: "k", altKey: false, ctrlKey: true, shiftKey: false }, selection), false);

const shortcut = policy.fromSettings({ defaultColor: "mint", shortcut: "Meta+7", toolbarBehavior: "shortcut" });
assert.equal(shortcut.selectionToolbar, false);
assert.equal(shortcut.shortcutHighlight, true);
assert.equal(policy.matchesShortcut({ ...keyEvent(), key: "7", altKey: false, metaKey: true, shiftKey: false }, shortcut), true);

const fallback = policy.fromSettings({ defaultColor: "orange", shortcut: "plain", toolbarBehavior: "unknown" });
assert.equal(fallback.defaultColor, "yellow");
assert.equal(fallback.toolbarBehavior, "both");
assert.equal(fallback.shortcut, null);
assert.equal(fallback.shortcutHighlight, false);

console.log(JSON.stringify({
  passed: true,
  shortcutCanonicalization: true,
  unsafeShortcutRejection: true,
  behaviorModes: true,
  defaultColorRouting: true,
  repeatAndCompositionGuards: true
}, null, 2));

function keyEvent(patch = {}) {
  return {
    key: "h",
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    ...patch
  };
}
