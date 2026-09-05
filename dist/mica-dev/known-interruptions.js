(() => {
  const RULE_ID = "chatgpt.rate_limit_history_ack.zh-CN.v1";
  const RULE_COOLDOWN_MS = 3000;
  const handledDialogs = new WeakSet();
  const lastDismissAtByRule = new Map();

  const consequentialActionPattern = normalizePattern([
    "OAuth",
    "Google Drive",
    "file access",
    "login",
    "account",
    "permission",
    "allow",
    "authorize",
    "continue",
    "consent",
    "delete",
    "remove",
    "purchase",
    "payment",
    "subscription",
    "confirm",
    "tool authorization",
    "external action",
    "允许",
    "授权",
    "继续",
    "确认",
    "删除",
    "移除",
    "购买",
    "支付",
    "订阅",
    "同意",
    "登录"
  ]);

  const api = {
    scan,
    resetForTests,
    rules: [RULE_ID]
  };

  globalThis.MicaKnownInterruptions = api;

  function scan(options = {}) {
    if (options.enabled === false) return { dismissed: 0, matches: [] };
    if (!isSupportedHost()) return { dismissed: 0, matches: [] };

    const matches = [];
    let dismissed = 0;
    for (const dialog of getVisibleDialogs()) {
      const result = matchRateLimitHistoryAck(dialog);
      if (!result.matched) continue;
      matches.push({ ruleId: RULE_ID });
      if (dismissDialog(dialog, result.button)) {
        dismissed += 1;
        options.onDismiss?.({ ruleId: RULE_ID });
      }
    }
    return { dismissed, matches };
  }

  function getVisibleDialogs() {
    return Array.from(document.querySelectorAll('[role="dialog"], dialog')).filter((node) => node instanceof HTMLElement && isVisible(node));
  }

  function matchRateLimitHistoryAck(dialog) {
    if (!(dialog instanceof HTMLElement)) return { matched: false };
    if (handledDialogs.has(dialog)) return { matched: false };
    if (hasConsequentialMarkers(dialog)) return { matched: false };

    const heading = findHeadingText(dialog);
    if (normalizeText(heading) !== "请求过于频繁") return { matched: false };

    const dialogText = normalizeText(getText(dialog));
    const hasRateLimit = dialogText.includes("请求过于频繁") && (dialogText.includes("暂时限制") || dialogText.includes("临时限制"));
    const hasHistoryAccess = dialogText.includes("访问对话记录");
    if (!hasRateLimit || !hasHistoryAccess) return { matched: false };

    const buttons = getVisibleActionButtons(dialog);
    if (buttons.length !== 1) return { matched: false };
    const button = buttons[0];
    if (normalizeText(getText(button)) !== "明白了") return { matched: false };

    return { matched: true, button };
  }

  function hasConsequentialMarkers(dialog) {
    const buttons = getVisibleActionButtons(dialog);
    for (const button of buttons) {
      const label = normalizeText(getText(button) || button.getAttribute("aria-label") || "");
      if (label !== "明白了" && consequentialActionPattern.test(label)) return true;
    }

    const interactive = Array.from(dialog.querySelectorAll("a[href], input:not([type='hidden']), select, textarea, [role='switch'], [role='checkbox']"))
      .filter((node) => node instanceof HTMLElement && isVisible(node));
    if (interactive.length > 0) return true;

    const text = normalizeText(getText(dialog)).replace("明白了", "");
    return consequentialActionPattern.test(text);
  }

  function dismissDialog(dialog, button) {
    if (handledDialogs.has(dialog)) return false;
    const lastDismissAt = lastDismissAtByRule.get(RULE_ID) || 0;
    if (Date.now() - lastDismissAt < RULE_COOLDOWN_MS) return false;
    handledDialogs.add(dialog);
    lastDismissAtByRule.set(RULE_ID, Date.now());
    button.click();
    return true;
  }

  function findHeadingText(dialog) {
    const labelledBy = dialog.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = document.getElementById(labelledBy);
      if (label && dialog.contains(label)) return getText(label);
    }
    const heading = dialog.querySelector("h1, h2, h3, [role='heading']");
    return heading ? getText(heading) : "";
  }

  function getVisibleActionButtons(root) {
    return Array.from(root.querySelectorAll("button, [role='button']"))
      .filter((node) => node instanceof HTMLElement && isVisible(node) && !isDisabled(node));
  }

  function isVisible(element) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (element.getClientRects().length > 0) return true;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabled(element) {
    return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  }

  function isSupportedHost() {
    const host = location.hostname;
    return host === "chatgpt.com" || host === "chat.openai.com" || document.documentElement.dataset.micaFixture === "true";
  }

  function getText(node) {
    return node.textContent || "";
  }

  function normalizeText(value) {
    return String(value)
      .replace(/[\s\u00a0]+/g, "")
      .replace(/[。．.，,、:：;；!！?？"'“”‘’（）()[\]{}<>《》]/g, "")
      .toLowerCase();
  }

  function normalizePattern(terms) {
    return new RegExp(terms.map((term) => escapeRegExp(normalizeText(term))).join("|"), "i");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function resetForTests() {
    lastDismissAtByRule.clear();
  }
})();
