(() => {
  const STORAGE_KEY = "mica.lowMemory.config.v1";
  const DEFAULTS = { enabled: true, keepCount: 40 };

  syncFromExtensionStorage();
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !["enabled", "lowMemory", "lowMemoryKeepCount"].some((key) => key in changes)) return;
    syncFromExtensionStorage();
  });

  async function syncFromExtensionStorage() {
    const settings = await readSettings();
    const config = {
      enabled: settings.enabled !== false && settings.lowMemory !== false,
      keepCount: clamp(Number(settings.lowMemoryKeepCount) || DEFAULTS.keepCount, 20, 80),
      updatedAt: Date.now()
    };
    publish(config);
    return config;
  }

  function readSettings() {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) return resolve(DEFAULTS);
      storage.get({ enabled: true, lowMemory: true, lowMemoryKeepCount: DEFAULTS.keepCount }, (items) => {
        resolve(globalThis.chrome?.runtime?.lastError ? DEFAULTS : items);
      });
    });
  }

  function publish(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (_error) {
      // The MAIN-world interceptor will fail open if origin storage is unavailable.
    }
    globalThis.dispatchEvent?.(new CustomEvent("mica-low-memory-config", { detail: JSON.stringify(config) }));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  globalThis.MicaLowMemoryConfig = { syncFromExtensionStorage };
})();
