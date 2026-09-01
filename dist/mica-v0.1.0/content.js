(() => {
  const VERSION = "0.1.0";
  const DEFAULT_SETTINGS = {
    enabled: true,
    showStatus: true,
    recentTurnKeepCount: 8,
    nativeOnlyTurnThreshold: 14,
    viewportBufferMultiple: 1.75
  };
  const STORAGE_KEYS = Object.keys(DEFAULT_SETTINGS);
  const STATUS = {
    ACTIVE: "Active",
    NATIVE_ONLY: "Native only",
    DEGRADED: "Degraded",
    DISABLED: "Disabled"
  };
  const TURN_SELECTOR = [
    "[data-message-author-role]",
    "[data-testid^='conversation-turn-']",
    "[data-testid*='conversation-turn']",
    "article"
  ].join(",");
  const ROLE_SELECTOR = "[data-message-author-role='user'], [data-message-author-role='assistant'], [data-message-author-role='tool']";
  const SPECIAL_SELECTOR = [
    "textarea",
    "input:not([type='hidden'])",
    "select",
    "form",
    "[contenteditable='true']",
    "[role='dialog']",
    "iframe",
    "[data-testid*='composer']",
    "[data-testid*='tool']",
    "[data-testid*='file']",
    "[data-testid*='attachment']",
    "[data-testid*='drive']",
    "[data-testid*='oauth']",
    "[data-testid*='auth']"
  ].join(",");
  const SUPPORTS_CONTENT_VISIBILITY = typeof CSS !== "undefined" && CSS.supports?.("content-visibility", "auto");
  const bootTime = Date.now();
  const measuredHeights = new WeakMap();
  const observedTurns = new WeakSet();
  const optimizedTurns = new Set();
  let settings = { ...DEFAULT_SETTINGS };
  let currentStatus = {
    name: STATUS.NATIVE_ONLY,
    reason: "Initializing",
    turns: 0,
    activeTurns: 0,
    optimizedTurns: 0,
    protectedTurns: 0,
    updatedAt: new Date().toISOString(),
    version: VERSION
  };
  let badgeHost = null;
  let badgeRoot = null;
  let mutationObserver = null;
  let resizeObserver = null;
  let scheduled = false;
  let lastUrl = location.href;

  if (!isSupportedPage()) {
    return;
  }

  initialize();

  async function initialize() {
    injectStyles();
    settings = { ...DEFAULT_SETTINGS, ...(await readSettings()) };
    setupBadge();
    setupObservers();
    setupMessages();
    scheduleScan("init");
  }

  function isSupportedPage() {
    const host = location.hostname;
    return host === "chatgpt.com" || host === "chat.openai.com" || document.documentElement.dataset.micaFixture === "true";
  }

  function readSettings() {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) {
        resolve({});
        return;
      }
      storage.get(STORAGE_KEYS, (items) => {
        resolve(chrome.runtime?.lastError ? {} : sanitizeSettings(items || {}));
      });
    });
  }

  function writeSettings(next) {
    return new Promise((resolve) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage) {
        settings = { ...settings, ...next };
        resolve();
        return;
      }
      storage.set(next, () => resolve());
    });
  }

  function sanitizeSettings(value) {
    const next = {};
    if (typeof value.enabled === "boolean") next.enabled = value.enabled;
    if (typeof value.showStatus === "boolean") next.showStatus = value.showStatus;
    if (Number.isFinite(value.recentTurnKeepCount)) next.recentTurnKeepCount = clamp(Math.round(value.recentTurnKeepCount), 4, 20);
    if (Number.isFinite(value.nativeOnlyTurnThreshold)) next.nativeOnlyTurnThreshold = clamp(Math.round(value.nativeOnlyTurnThreshold), 6, 40);
    if (Number.isFinite(value.viewportBufferMultiple)) next.viewportBufferMultiple = clamp(Number(value.viewportBufferMultiple), 1, 4);
    return next;
  }

  function setupObservers() {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        if (!(target instanceof HTMLElement)) continue;
        const height = Math.max(80, Math.ceil(entry.borderBoxSize?.[0]?.blockSize || target.getBoundingClientRect().height));
        measuredHeights.set(target, height);
        target.style.setProperty("--mica-intrinsic-height", `${height}px`);
      }
    });

    mutationObserver = new MutationObserver(() => scheduleScan("mutation"));
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    addEventListener("scroll", () => scheduleScan("scroll"), { passive: true, capture: true });
    addEventListener("resize", () => scheduleScan("resize"), { passive: true });
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        clearOptimization();
      }
      scheduleScan("interval");
    }, 1500);
  }

  function setupMessages() {
    globalThis.chrome?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") return false;
      if (message.type === "MICA_GET_STATUS") {
        sendResponse({ status: currentStatus, settings });
        return true;
      }
      if (message.type === "MICA_SET_SETTINGS") {
        const next = sanitizeSettings(message.settings || {});
        settings = { ...settings, ...next };
        writeSettings(next).then(() => {
          scheduleScan("settings");
          sendResponse({ status: currentStatus, settings });
        });
        return true;
      }
      return false;
    });

    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      const next = {};
      for (const key of STORAGE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          next[key] = changes[key].newValue;
        }
      }
      settings = { ...settings, ...sanitizeSettings(next) };
      scheduleScan("storage");
    });
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        scanAndApply();
      } catch (error) {
        clearOptimization();
        setStatus(STATUS.DEGRADED, `Scan failed: ${error?.message || String(error)}`, []);
      }
    });
  }

  function scanAndApply() {
    if (!settings.enabled) {
      clearOptimization();
      setStatus(STATUS.DISABLED, "Disabled by user", []);
      return;
    }
    if (!SUPPORTS_CONTENT_VISIBILITY) {
      clearOptimization();
      setStatus(STATUS.DEGRADED, "Browser lacks content-visibility support", []);
      return;
    }

    const turns = collectConversationTurns();
    if (turns.length === 0) {
      clearOptimization();
      const conversationPath = /^\/(?:c|share)\//.test(location.pathname);
      const hasTimedOut = Date.now() - bootTime > 5000;
      const name = conversationPath && hasTimedOut ? STATUS.DEGRADED : STATUS.NATIVE_ONLY;
      const reason = conversationPath && hasTimedOut ? "No safe conversation turn container found" : "No loaded conversation turns";
      setStatus(name, reason, turns);
      return;
    }

    if (!isSafeTurnSet(turns)) {
      clearOptimization();
      setStatus(STATUS.DEGRADED, "Turn structure is ambiguous", turns);
      return;
    }

    for (const turn of turns) {
      observeTurn(turn);
    }

    if (turns.length <= settings.nativeOnlyTurnThreshold) {
      clearOptimization();
      setStatus(STATUS.NATIVE_ONLY, "Turn count is small enough for native rendering", turns);
      return;
    }

    const protectedIndexes = getProtectedIndexes(turns);
    let optimizedCount = 0;
    let protectedCount = 0;
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      const shouldProtect = protectedIndexes.has(index);
      const shouldOptimize = !shouldProtect && isFarFromViewport(turn);
      if (shouldOptimize) {
        applyOptimization(turn);
        optimizedCount += 1;
      } else {
        removeOptimization(turn);
        if (shouldProtect) protectedCount += 1;
      }
    }

    setStatus(STATUS.ACTIVE, "Render containment applied to offscreen historical turns", turns, optimizedCount, protectedCount);
  }

  function collectConversationTurns() {
    const main = document.querySelector("main") || document.body;
    const raw = Array.from(main.querySelectorAll(TURN_SELECTOR)).filter((node) => node instanceof HTMLElement);
    const unique = new Set();

    for (const node of raw) {
      if (!(node instanceof HTMLElement) || node.closest("[data-mica-root='true']")) continue;
      let turn = null;
      const roleNode = node.matches("[data-message-author-role]") ? node : node.querySelector("[data-message-author-role]");
      if (roleNode instanceof HTMLElement) {
        turn =
          roleNode.closest("[data-testid^='conversation-turn-']") ||
          roleNode.closest("[data-testid*='conversation-turn']") ||
          roleNode.closest("article") ||
          roleNode;
      } else if (node.matches("article") && node.innerText.trim().length > 12) {
        turn = node;
      }

      if (!(turn instanceof HTMLElement)) continue;
      if (!main.contains(turn)) continue;
      if (turn.offsetParent === null && turn.getClientRects().length === 0) continue;
      unique.add(turn);
    }

    return Array.from(unique).sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function isSafeTurnSet(turns) {
    if (turns.length < 2) return true;
    const roleCount = turns.filter((turn) => turn.querySelector(ROLE_SELECTOR) || turn.matches(ROLE_SELECTOR)).length;
    const articleCount = turns.filter((turn) => turn.matches("article") || turn.querySelector("article")).length;
    return roleCount >= 2 || articleCount >= Math.min(3, turns.length);
  }

  function getProtectedIndexes(turns) {
    const protectedIndexes = new Set();
    const recentStart = Math.max(0, turns.length - settings.recentTurnKeepCount);
    const streaming = hasStreamingControl();

    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      if (index >= recentStart) protectedIndexes.add(index);
      if (isNearViewport(turn)) protectedIndexes.add(index);
      if (turn.contains(document.activeElement)) protectedIndexes.add(index);
      if (isSpecialTurn(turn)) protectedIndexes.add(index);
      if (streaming && index >= turns.length - Math.max(4, settings.recentTurnKeepCount)) protectedIndexes.add(index);
    }
    return protectedIndexes;
  }

  function isNearViewport(element) {
    const rect = element.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight || 900;
    const buffer = viewport * settings.viewportBufferMultiple;
    return rect.bottom >= -buffer && rect.top <= viewport + buffer;
  }

  function isFarFromViewport(element) {
    return !isNearViewport(element);
  }

  function isSpecialTurn(turn) {
    if (turn.querySelector(SPECIAL_SELECTOR)) return true;
    const text = turn.innerText || "";
    return /authorize|authorization|allow access|connect (google|drive|github|slack)|sign in to|log in to|授权|允许访问|登录到/i.test(text);
  }

  function hasStreamingControl() {
    const text = document.body?.innerText || "";
    if (/stop (generating|streaming)|停止生成|停止回答/i.test(text)) return true;
    return !!document.querySelector("[aria-label*='Stop'], [data-testid*='stop']");
  }

  function observeTurn(turn) {
    if (observedTurns.has(turn)) return;
    observedTurns.add(turn);
    const height = Math.max(80, Math.ceil(turn.getBoundingClientRect().height));
    measuredHeights.set(turn, height);
    turn.style.setProperty("--mica-intrinsic-height", `${height}px`);
    resizeObserver?.observe(turn);
  }

  function applyOptimization(turn) {
    const height = measuredHeights.get(turn) || Math.max(240, Math.ceil(turn.getBoundingClientRect().height));
    turn.style.setProperty("--mica-intrinsic-height", `${height}px`);
    turn.classList.add("mica-turn-optimized");
    turn.dataset.micaOptimized = "true";
    optimizedTurns.add(turn);
  }

  function removeOptimization(turn) {
    turn.classList.remove("mica-turn-optimized");
    delete turn.dataset.micaOptimized;
    optimizedTurns.delete(turn);
  }

  function clearOptimization() {
    for (const turn of Array.from(optimizedTurns)) {
      removeOptimization(turn);
    }
  }

  function setStatus(name, reason, turns, optimizedCount = 0, protectedCount = 0) {
    currentStatus = {
      name,
      reason,
      turns: turns.length,
      activeTurns: Math.max(0, turns.length - optimizedCount),
      optimizedTurns: optimizedCount,
      protectedTurns: protectedCount,
      updatedAt: new Date().toISOString(),
      version: VERSION,
      url: location.href
    };
    globalThis.__MICA_LONG_THREAD_STATUS__ = currentStatus;
    if (globalThis.window) {
      globalThis.window.__MICA_LONG_THREAD_STATUS__ = currentStatus;
    }
    document.documentElement.dataset.micaStatus = name;
    document.documentElement.dataset.micaTurns = String(turns.length);
    document.documentElement.dataset.micaOptimizedTurns = String(optimizedCount);
    renderBadge();
  }

  function injectStyles() {
    if (document.getElementById("mica-long-thread-style")) return;
    const style = document.createElement("style");
    style.id = "mica-long-thread-style";
    style.textContent = `
.mica-turn-optimized {
  content-visibility: auto !important;
  contain: layout paint style !important;
  contain-intrinsic-size: auto var(--mica-intrinsic-height, 640px) !important;
}
`;
    document.documentElement.appendChild(style);
  }

  function setupBadge() {
    if (badgeHost) return;
    badgeHost = document.createElement("div");
    badgeHost.dataset.micaRoot = "true";
    badgeHost.style.position = "fixed";
    badgeHost.style.right = "12px";
    badgeHost.style.bottom = "12px";
    badgeHost.style.zIndex = "2147483646";
    badgeHost.style.pointerEvents = "auto";
    badgeRoot = badgeHost.attachShadow({ mode: "open" });
    document.documentElement.appendChild(badgeHost);
    renderBadge();
  }

  function renderBadge() {
    if (!badgeRoot) return;
    const hidden = !settings.showStatus;
    const label = `Mica · ${currentStatus.name} · ${currentStatus.activeTurns} active / ${currentStatus.turns} turns`;
    badgeHost.hidden = hidden;
    badgeRoot.innerHTML = `
<style>
  :host { all: initial; }
  .mica-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: min(420px, calc(100vw - 24px));
    min-height: 32px;
    padding: 6px 8px 6px 10px;
    border: 1px solid rgba(23, 23, 23, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.94);
    color: #171717;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
    font: 12px/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .mica-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: ${statusColor(currentStatus.name)};
    flex: 0 0 auto;
  }
  .mica-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.06);
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  button:hover { background: rgba(0, 0, 0, 0.12); }
  @media (prefers-color-scheme: dark) {
    .mica-badge {
      border-color: rgba(255, 255, 255, 0.18);
      background: rgba(32, 33, 35, 0.94);
      color: #f7f7f8;
    }
    button { background: rgba(255, 255, 255, 0.12); }
    button:hover { background: rgba(255, 255, 255, 0.18); }
  }
</style>
<div class="mica-badge" title="${escapeHtml(currentStatus.reason)}">
  <span class="mica-dot" aria-hidden="true"></span>
  <span class="mica-label">${escapeHtml(label)}</span>
  <button type="button" title="Disable Mica" aria-label="Disable Mica">×</button>
</div>`;
    badgeRoot.querySelector("button")?.addEventListener("click", () => {
      settings = { ...settings, enabled: false };
      writeSettings({ enabled: false }).then(() => scheduleScan("badge-disable"));
    });
  }

  function statusColor(name) {
    if (name === STATUS.ACTIVE) return "#16803c";
    if (name === STATUS.NATIVE_ONLY) return "#2563eb";
    if (name === STATUS.DEGRADED) return "#b45309";
    return "#737373";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
