(() => {
  const COLORS = Object.freeze(["yellow", "mint", "blue", "pink"]);
  const BEHAVIORS = Object.freeze(["selection", "shortcut", "both"]);
  const MODIFIER_NAMES = Object.freeze({ alt: "Alt", ctrl: "Ctrl", meta: "Meta", shift: "Shift" });
  const MODIFIER_ORDER = Object.freeze(["ctrl", "alt", "shift", "meta"]);
  const MODIFIER_ALIASES = Object.freeze({
    alt: "alt",
    option: "alt",
    ctrl: "ctrl",
    control: "ctrl",
    cmd: "meta",
    command: "meta",
    meta: "meta",
    shift: "shift"
  });
  const DEFAULTS = Object.freeze({ defaultColor: "yellow", shortcut: "Alt+Shift+H", toolbarBehavior: "both" });

  function fromSettings(value = {}) {
    const shortcut = parseShortcut(value.shortcut ?? DEFAULTS.shortcut);
    const toolbarBehavior = BEHAVIORS.includes(value.toolbarBehavior) ? value.toolbarBehavior : DEFAULTS.toolbarBehavior;
    return Object.freeze({
      defaultColor: COLORS.includes(value.defaultColor) ? value.defaultColor : DEFAULTS.defaultColor,
      toolbarBehavior,
      shortcut,
      selectionToolbar: toolbarBehavior === "selection" || toolbarBehavior === "both",
      shortcutHighlight: !!shortcut && (toolbarBehavior === "shortcut" || toolbarBehavior === "both")
    });
  }

  function parseShortcut(value) {
    const parts = String(value || "").split("+").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 5) return null;
    const modifiers = { alt: false, ctrl: false, meta: false, shift: false };
    let key = null;
    for (const part of parts) {
      const lower = part.toLowerCase();
      const modifier = MODIFIER_ALIASES[lower];
      if (modifier) {
        if (modifiers[modifier]) return null;
        modifiers[modifier] = true;
        continue;
      }
      if (key || !/^[a-z0-9]$/i.test(part)) return null;
      key = lower;
    }
    if (!key || !(modifiers.alt || modifiers.ctrl || modifiers.meta)) return null;
    const label = [...MODIFIER_ORDER.filter((name) => modifiers[name]).map((name) => MODIFIER_NAMES[name]), key.toUpperCase()].join("+");
    return Object.freeze({ key, ...modifiers, label });
  }

  function matchesShortcut(event, config) {
    const shortcut = config?.shortcut;
    if (!config?.shortcutHighlight || !shortcut || event?.defaultPrevented || event?.repeat || event?.isComposing) return false;
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    return key === shortcut.key
      && event.altKey === shortcut.alt
      && event.ctrlKey === shortcut.ctrl
      && event.metaKey === shortcut.meta
      && event.shiftKey === shortcut.shift;
  }

  globalThis.MicaHighlightInteractionPolicy = Object.freeze({
    colors: COLORS,
    behaviors: BEHAVIORS,
    defaults: DEFAULTS,
    fromSettings,
    parseShortcut,
    matchesShortcut
  });
})();
