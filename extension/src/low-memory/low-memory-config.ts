(() => {
  const CONFIG_KEY = "mica.lowMemory.config.v2";
  const BYPASS_KEY = "mica.lowMemory.bypass.v2";
  const DEFAULTS = Object.freeze({ enabled: true, lowMemory: true, lowMemoryKeepCount: 40, lowMemoryThreshold: 80 });
  let lastConfig = null;

  syncFromExtensionStorage();
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !["enabled", "lowMemory", "lowMemoryKeepCount", "lowMemoryThreshold"].some((key) => key in changes)) return;
    syncFromExtensionStorage();
  });

  async function syncFromExtensionStorage() {
    const settings = await readSettings();
    return configure(settings);
  }

  function configure(settings = {}) {
    const config = {
      enabled: settings.enabled !== false && settings.lowMemory !== false,
      keepCount: clamp(settings.lowMemoryKeepCount || DEFAULTS.lowMemoryKeepCount, 8, 120),
      threshold: clamp(settings.lowMemoryThreshold || DEFAULTS.lowMemoryThreshold, 10, 500),
      updatedAt: Date.now()
    };
    lastConfig = config;
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (_error) { /* main world fails open */ }
    globalThis.dispatchEvent(new CustomEvent("mica-low-memory-config", { detail: JSON.stringify(config) }));
    return config;
  }

  function requestFullHistory() {
    try { sessionStorage.setItem(BYPASS_KEY, `${location.origin}${location.pathname}`); return true; }
    catch (_error) { return false; }
  }

  function clearFullHistoryBypass() {
    try { sessionStorage.removeItem(BYPASS_KEY); return true; }
    catch (_error) { return false; }
  }

  function isFullHistoryBypassed() {
    try { return sessionStorage.getItem(BYPASS_KEY) === `${location.origin}${location.pathname}`; }
    catch (_error) { return false; }
  }

  function readSettings() {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve(DEFAULTS);
      storage.get(DEFAULTS, (items) => resolve(globalThis.chrome?.runtime?.lastError ? DEFAULTS : items));
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
  }

  globalThis.MicaLowMemoryConfig = Object.freeze({
    syncFromExtensionStorage,
    configure,
    requestFullHistory,
    clearFullHistoryBypass,
    isFullHistoryBypassed,
    snapshot: () => lastConfig ? { ...lastConfig } : null
  });
})();
