# ChatGPT rate-limit acknowledgement dialog

Date: 2026-09-01

## User-visible symptom

ChatGPT may repeatedly show a blocking acknowledgement dialog with the Chinese title `请求过于频繁` and body text indicating that access to conversation history has been temporarily restricted and the user should retry after a few minutes. The only visible action is `明白了`.

This is a service-side rate-limit / temporary restriction notice. Mica must **not** attempt to bypass the restriction, retry requests automatically, refresh the page, or synthesize traffic. The only acceptable intervention is to dismiss this already-informational acknowledgement dialog so it does not repeatedly block the UI.

## Observed DOM

The real logged-in Edge page exposed a standard dialog root:

```html
<div role="dialog" ... data-state="open" ...>
  <header>
    <h2>请求过于频繁</h2>
  </header>
  <div>
    <p>你的请求过于频繁。为保障数据安全，我们已暂时限制你访问对话记录。</p>
    <p>请稍等几分钟后再重试。</p>
    <button>明白了</button>
  </div>
</div>
```

The real DOM contained dynamic Radix IDs such as `radix-_r_aq_` / `radix-_r_ar_`. These IDs are runtime-generated and must never be used as selectors.

## Safe recognition strategy

Mica should only auto-dismiss when all of the following are true:

1. Current host is `chatgpt.com` or an explicitly supported ChatGPT host.
2. The element is a currently visible `[role="dialog"]` (or equivalent standard dialog root).
3. The dialog heading matches an allowlisted known acknowledgement title, initially Chinese `请求过于频繁`.
4. The body matches an allowlisted semantic signature for this exact temporary rate-limit/history-access notice. Matching should tolerate small punctuation/whitespace changes but remain narrow.
5. The dialog exposes exactly one visible actionable button and that action is an acknowledgement-only label, initially `明白了`.
6. The dialog contains no sensitive or consequential action labels such as authorize/allow/continue/delete/purchase/confirm or their localized equivalents.

Do not use CSS utility classes, dynamic Radix IDs, DOM depth, or button position as primary identity.

## Safety boundaries

Auto-dismiss is deliberately different from auto-retry:

- Allowed: click the single acknowledgement button for this exact known informational notice.
- Not allowed: retry the failed/limited request.
- Not allowed: refresh or navigate automatically.
- Not allowed: suppress future server-side restrictions.
- Not allowed: interact with authentication, OAuth, Drive/file access, deletion, payment, purchase, safety, consent, or tool-authorization dialogs.
- Unknown dialogs always fail open and remain untouched.

## Implementation notes

Prefer a tiny allowlist-driven `knownInterruptions` module rather than a generic "click modal buttons" system. Observe dialog insertion through the existing page mutation lifecycle, debounce handling, and mark a handled dialog so the same DOM node cannot be clicked repeatedly.

Expose a user setting such as `Auto-dismiss known interruptions`, enabled only for exact allowlisted acknowledgement dialogs. Diagnostics may count dismissals by rule ID, but must not record surrounding conversation content.

Initial rule ID suggestion: `chatgpt.rate_limit_history_ack.zh-CN.v1`.

This feature can be implemented during the current alpha because it is narrowly scoped and independently testable, but it must not delay the P0 long-thread diagnostics work.
