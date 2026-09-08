(() => {
  const enabled = new URLSearchParams(location.search).get("clock") === "virtual";
  if (!enabled || window.__MICA_VIRTUAL_CLOCK__) return;

  const NativeDate = Date;
  const nativeSetTimeout = setTimeout.bind(window);
  const nativeClearTimeout = clearTimeout.bind(window);
  const nativeSetInterval = setInterval.bind(window);
  const nativeClearInterval = clearInterval.bind(window);
  const nativeRequestAnimationFrame = window.requestAnimationFrame?.bind(window);
  const nativeCancelAnimationFrame = window.cancelAnimationFrame?.bind(window);

  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function toDelay(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function schedule(kind, callback, delay, args, intervalMs = 0) {
    const id = nextId++;
    timers.set(id, {
      id,
      kind,
      callback,
      args,
      dueAt: now + toDelay(delay),
      intervalMs: toDelay(intervalMs)
    });
    return id;
  }

  function runTimer(timer) {
    timers.delete(timer.id);
    if (timer.kind === "interval") {
      timer.dueAt = now + Math.max(1, timer.intervalMs);
      timers.set(timer.id, timer);
    }
    if (typeof timer.callback === "function") {
      timer.callback(...timer.args);
      return;
    }
    Function(String(timer.callback))();
  }

  function nextDueTimer(limit) {
    let next = null;
    for (const timer of timers.values()) {
      if (timer.dueAt > limit) continue;
      if (!next || timer.dueAt < next.dueAt || (timer.dueAt === next.dueAt && timer.id < next.id)) next = timer;
    }
    return next;
  }

  function advanceBy(ms) {
    const target = now + toDelay(ms);
    for (;;) {
      const timer = nextDueTimer(target);
      if (!timer) break;
      now = timer.dueAt;
      runTimer(timer);
    }
    now = target;
    return now;
  }

  function flushTimers(limit = 1000) {
    let count = 0;
    for (;;) {
      const timer = nextDueTimer(now);
      if (!timer || count >= limit) break;
      count += 1;
      runTimer(timer);
    }
    return count;
  }

  function flushAnimationFrame() {
    advanceBy(16);
  }

  async function flushAsync() {
    await Promise.resolve();
    flushTimers();
    await Promise.resolve();
  }

  function VirtualDate(...args) {
    if (this instanceof VirtualDate) {
      return args.length === 0 ? new NativeDate(now) : new NativeDate(...args);
    }
    return new NativeDate(now).toString();
  }
  VirtualDate.now = () => now;
  VirtualDate.parse = NativeDate.parse;
  VirtualDate.UTC = NativeDate.UTC;
  VirtualDate.prototype = NativeDate.prototype;

  window.Date = VirtualDate;
  window.setTimeout = (callback, delay = 0, ...args) => schedule("timeout", callback, delay, args);
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = (callback, delay = 0, ...args) => schedule("interval", callback, delay, args, delay || 1);
  window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (callback) => schedule("raf", () => callback(now), 16, []);
  window.cancelAnimationFrame = (id) => timers.delete(id);

  window.__MICA_VIRTUAL_CLOCK__ = {
    enabled: true,
    now: () => now,
    pendingTimers: () => timers.size,
    advanceBy,
    flushTimers,
    flushAnimationFrame,
    flushAsync,
    restore: () => {
      window.Date = NativeDate;
      window.setTimeout = nativeSetTimeout;
      window.clearTimeout = nativeClearTimeout;
      window.setInterval = nativeSetInterval;
      window.clearInterval = nativeClearInterval;
      if (nativeRequestAnimationFrame) window.requestAnimationFrame = nativeRequestAnimationFrame;
      if (nativeCancelAnimationFrame) window.cancelAnimationFrame = nativeCancelAnimationFrame;
      timers.clear();
    }
  };
})();
