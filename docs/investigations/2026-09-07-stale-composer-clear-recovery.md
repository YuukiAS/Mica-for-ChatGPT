# Stale composer clear recovery

Date: 2026-09-07
Browser: Microsoft Edge on the user's authenticated ChatGPT session. The exact Edge build was not captured in the privacy-safe report.
Extension: Mica `0.1.5`, `BUILD_LABEL = stale-composer-recovery.6`
Related: Issue #6

## What was confirmed

The original `@GitHub` connector selection path can cause ChatGPT's own composer to briefly unmount/remount even when Mica runtime is disabled. That visual/native remount is not itself a Mica bug.

The real bug was stale draft restoration after the user explicitly cleared the composer:

- a reliable clear anchor occurred while the composer was still present with `textLength = 0`;
- ChatGPT then unmounted the composer;
- a new composer root could remount with the previous non-zero payload restored;
- Mica runtime OFF reports showed the same class of stale restoration, so the primary root cause is ChatGPT native connector composer lifecycle rather than Mica optimization.

Intermediate 0.1.5 candidates narrowed the implementation bugs:

- `.1` diagnostics proved reliable `present zero -> unmount -> remount nonzero` stale restoration.
- `.2` fixed full-clear arming so `Ctrl+A -> Delete/Backspace` snapshots the complete pre-clear payload instead of an unrelated single-character delete.
- `.3` added intent-scoped clear confirmation checks.
- `.4` confirmed clear synchronously from the same editable's `blur`/`focusout`/`input` events.
- `.5` fixed phase-aware timer handling so settling could finish after a late fingerprint match.
- `.6` added a bounded tombstone so the same stale fingerprint can be cleared again across multiple subsequent native remounts.

The final delete-path real acceptance for `.6` passed:

- `7197ms`: clear confirmed;
- `7298ms`: composer unmounted;
- `8520ms`: composer remounted with `textLength = 0`;
- session stopped with `finalTextLength = 0`;
- `staleTextRestoredAfterClear = false`.

`attemptCount = 0` in that final report is expected because ChatGPT stayed empty and no stale payload reappeared during the bounded observation window.

## Fix

Mica now includes `extension/src/reliability/stale-composer-recovery.ts`, an isolated, fail-open workaround for the delete path.

The guard only arms after a trusted full-clear intent in the composer and a reliable present-zero clear confirmation. It stores a local-only fingerprint of the pre-clear payload, then protects that exact fingerprint for a short bounded tombstone lifetime. If the same stale payload reappears after native remount and no new trusted user input occurred, Mica uses browser-native contenteditable deletion semantics to clear the current composer. The guard is bounded by max attempts and a hard lifetime cap, and any new trusted typing/paste/composition cancels it immediately.

The popup has an independent `Stale clear recovery` toggle under the global `Enabled` master switch. With Mica disabled, recovery remains disabled; diagnostics can still run only after the user explicitly starts `Run composer check`.

Diagnostics now report `currentClearGeneration` separately from whole-session lifecycle summaries, so pre-clear connector remounts do not pollute the current clear result. A clear that remounts empty and stays empty is classified as `finalClearStable = true` with `successMode = native_stayed_empty`, not as a timeout failure.

## Rejected alternatives

- Do not prevent ChatGPT's native composer remount.
- Do not patch React internals or ChatGPT event handlers.
- Do not intercept Enter or Send.
- Do not use synthetic Send/Retry/Regenerate.
- Do not rewrite composer DOM with `innerHTML`/`textContent` as the main recovery path.
- Do not add permanent document polling or a permanent full-document `MutationObserver`.
- Do not require DevTools Console probes for recurring diagnostics.

## Synthetic regression coverage

The focused `guided-composer-diagnostics` fixture covers:

- native connector-like remount with text, classified separately from stale restoration;
- reliable clear-anchor stale restoration detection;
- `Ctrl+A -> Delete/Backspace` and full-selection cut arming;
- same-editable `blur`/`focusout`/`input` clear confirmation;
- stale fragment settling into a full fingerprint match;
- phase-aware timeout behavior;
- persistent multi-remount stale payload recovery;
- user-new-input cancellation;
- fingerprint mismatch fail-open behavior;
- attempt exhaustion without loops;
- Mica Enabled OFF and stale clear recovery feature-toggle OFF behavior;
- native-empty remount reporting as stable without a recovery attempt;
- current clear generation isolation from earlier session remounts.

## Tested

- Focused synthetic browser fixture: `node scripts\run-e2e.mjs --case=guided-composer-diagnostics` passed.
- Build: `npm run build` passed and refreshed `dist/mica-dev`.
- Build validation: `npm run test:build` passed.

Earlier in this same `0.1.5` candidate, the full Tier 2 gate passed once before real-site acceptance. It was not rerun after the final report-semantics cleanup, per `AGENTS.md` focused-iteration policy.

Stress was not run because Tier 3 was not indicated for the final semantics cleanup.

## Remaining

Long-text manual Send residual remains open under Issue #6 and must be diagnosed separately with built-in composer diagnostics.
