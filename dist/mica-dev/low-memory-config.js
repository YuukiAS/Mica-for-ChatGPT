(() => {
  function send(type, payload = {}) {
    return new Promise((resolve) => {
      const runtime = globalThis.chrome?.runtime;
      if (!runtime?.sendMessage) return resolve({ ok: false, reason: "runtime_unavailable" });
      runtime.sendMessage({ type, ...payload }, (response) => {
        if (runtime.lastError) return resolve({ ok: false, reason: "runtime_error" });
        resolve(response || { ok: false, reason: "empty_response" });
      });
    });
  }

  globalThis.MicaLowMemoryConfig = Object.freeze({
    syncRegistration: () => send("MICA_LOW_MEMORY_SYNC"),
    getTabMode: () => send("MICA_LOW_MEMORY_GET_TAB_MODE"),
    prepareFullHistory: () => send("MICA_LOW_MEMORY_PREPARE_FULL_HISTORY"),
    resumeWindowing: () => send("MICA_LOW_MEMORY_RESUME_WINDOWING")
  });
})();
