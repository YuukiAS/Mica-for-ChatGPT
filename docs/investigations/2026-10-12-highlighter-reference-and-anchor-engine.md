# Highlighter reference and anchor engine investigation

Date: 2026-10-12

Browser surface: isolated Playwright Chromium, using a local ChatGPT-derived fixture at `https://chatgpt.com/c/fixture-highlighter`

Reference: `YuukiAS/Web_Highlighter@546c8c8bb3e2281929a7af77654793c8910289a7`

## Scope and evidence boundary

This investigation covers Mica's built-in ChatGPT-scoped Highlighter. The external repository was inspected as a technical reference for cross-formula selection, KaTeX/MathJax/raw-LaTeX handling, remount recovery, and color/delete ownership. Mica did not copy its bundled/minified runtime. The implementation is a separate Mica-owned engine built on `ChatGPTAdapter`, `AnswerDocument`, local extension storage, and the CSS Custom Highlight API.

The current public ChatGPT sample used by the foundation bootstrap contained no mathematical answer, so it cannot prove current live-site math markup. Current real-site math structure therefore remains `UNKNOWN`; unknown structures fail open. The browser fixture is `LOCAL_REAL_BROWSER` evidence for the deterministic anchor and interaction behavior, not a claim that an authenticated live ChatGPT math answer was exercised.

## Confirmed behavior

- A continuous pointer selection over `prose -> inline_math -> prose` creates one local highlight and preserves the formula's TeX source.
- Supported sources include KaTeX annotations/attributes, MathJax/MathML metadata, and raw `\(...\)`, `\[...\]`, `$...$`, and `$$...$$` delimiters.
- Highlights restore after refresh, exact turn remount, and equivalent math-rendering changes when the logical TeX source remains stable.
- Anchors combine conversation, turn, answer-document version, block identity, quote/context, logical span, structural hints, and TeX source.
- Duplicate candidates, deleted source content, conversation/branch mismatch, streaming answers, composer selection, code selection, and unsupported structures do not attach a highlight by guess.
- The runtime uses `CSS.highlights`; it does not wrap or remove ChatGPT React-managed answer nodes and does not patch `Range.prototype` or `Selection.prototype`.
- The selection toolbar is transient, supports four colors and delete, places itself below a selection near the top viewport edge, receives keyboard focus for Shift-selection, and dismisses with Escape.
- Stored highlight text remains in `chrome.storage.local`. Sanitized QA reports expose counts/status only and do not include highlight quotes, answer text, raw DOM, request data, or authentication material.

## Rejected alternatives

- DOM wrappers around selected text: rejected because they mutate React-managed answer content and are fragile under streaming/remount.
- Absolute DOM paths: rejected because ChatGPT markup and virtualization can change without preserving paths.
- Quote-only restoration: rejected because repeated text can silently attach to the wrong phrase.
- Global Selection/Range prototype patches: rejected because they create page-wide compatibility risk.
- Highlighting provisional streaming output: rejected because its identity and source offsets are not durable.

## Verification

The focused browser fixture writes `results/mica-product-system-rebuild/highlighter-evidence/highlighter-fixture.json` and three bound visual states. It checks creation, refresh, remount, math reformat, ambiguity, deletion, branch mismatch, invalid surfaces, keyboard focus, color ownership, delete ownership, and raw-LaTeX extraction. The separate stress runner repeats the full browser fixture eight times. Acceptance validator 1.4.0 derives the Highlighter gate from the bound raw fixture and stress artifacts and rejects rehashed wrong-attachment/prototype-patch controls.
