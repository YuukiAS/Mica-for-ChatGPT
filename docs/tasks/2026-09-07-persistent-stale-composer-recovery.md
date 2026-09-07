# Persistent stale composer recovery after native remounts

Date: 2026-09-07
Status: implementation task, not yet committed in the local 0.1.5 candidate
Related: Issue #6

## Confirmed real-site behavior

The `0.1.5 / stale-composer-recovery.5` candidate has now passed every detection stage and has executed the recovery primitive once on the real ChatGPT page.

Confirmed sequence from the real report:

1. User performs trusted `Ctrl+A -> Backspace/Delete` on the composer.
2. Mica captures the full-clear intent and pre-clear payload (`oldLength=8`).
3. The old editable reaches a real `textLength=0` state and Mica confirms the clear via the same editable's `blur` event.
4. ChatGPT unmounts/remounts the composer.
5. The old payload returns (`2 -> 8`).
6. Mica matches the stale fingerprint, settles, and performs one recovery attempt.
7. The recovery primitive does clear the current mounted composer to `textLength=0` and produces a delete-like input event.
8. ChatGPT then unmounts/remounts again and restores the same stale payload again (`2 -> 8`, then later another mount with `8`).

Therefore the current failure is no longer detection, arming, timing, or the ability to clear the current DOM once.

## Current root cause layer

The workaround is single-shot, while ChatGPT's connector/draft lifecycle can rehydrate the same stale payload across multiple subsequent native remounts after the first successful Mica clear.

The recovery primitive is therefore transiently successful, but the stale source of truth survives elsewhere in ChatGPT state and can repopulate later mounts.

Do not regress or redesign the already-confirmed stages:

- full-clear intent detection
- pre-clear fingerprint capture
- event-target clear confirmation
- remount detection
- fingerprint matching
- settle timing
- first recovery attempt

## Required design: bounded clear-intent tombstone

Treat the user's trusted full clear as a short-lived local tombstone for the specific pre-clear stale payload.

After the first successful recovery attempt, Mica must continue protecting that same clear intent for a bounded period / bounded number of stale remounts.

If the same stale fingerprint reappears on a later remounted composer and there has been no new trusted user input, Mica may re-apply the same safe recovery primitive.

Requirements:

- same generation only;
- same pre-clear fingerprint only;
- new trusted user input cancels immediately;
- unrelated content or fingerprint mismatch is never deleted;
- max recovery attempts must be small and explicit (for example 2-3 total);
- one hard lifetime cap for the tombstone, long enough to cover the real multi-remount sequence but never indefinite;
- no permanent polling / permanent full-document observer;
- no React/private-state monkey patching;
- no synthetic Send / Retry / Regenerate;
- no Console or DevTools work required from the user.

## Verification semantics

A recovery attempt should not be marked failed merely because the composer unmounted immediately after Mica cleared it.

For this ChatGPT lifecycle, unmount after a successful local clear is expected.

Verification should distinguish:

- `local_clear_observed`: current mounted composer reached empty after recovery;
- `same_stale_payload_reappeared`: same fingerprint returned on a later remount;
- `final_clear_stable`: no same stale payload returned before tombstone completion / observation window ended;
- `cancelled_by_new_user_input`;
- `attempts_exhausted`.

Do not collapse these into a single immediate success/failure bit.

## Deterministic focused regression based on the real report

The focused fixture must reproduce the full real sequence, not stop after the first recovery:

- clear confirmed;
- native remount fragment `len2`;
- native remount full stale payload `len8`;
- fingerprint match;
- recovery attempt #1;
- current composer reaches `len0`;
- immediate unmount;
- later remount fragment `len2`;
- later remount full stale payload `len8` again;
- recovery attempt #2;
- final composer remains empty / same stale fingerprint does not return within the bounded verification window.

Additional safety cases:

- after attempt #1, user types new trusted content before the next stale remount -> tombstone cancels and new content is preserved;
- later remount has different content/fingerprint -> do nothing;
- repeated stale remounts beyond max attempts -> stop and report exhaustion, never loop forever;
- Mica Enabled=OFF -> no recovery/tombstone runtime, diagnostics only when explicitly started.

## Testing policy

Follow AGENTS.md test tiers.

For this iteration:

- run only stale-recovery focused regression(s) while iterating;
- build;
- run `npm run test:build`;
- do not rerun the full E2E suite solely for small tombstone-state changes;
- do not run stress unless Tier 3 becomes explicitly justified.

Before asking the user to retest, the local focused fixture must prove the full multi-remount sequence reaches the intended bounded terminal state.

## Version

This remains the same uncommitted `0.1.5` candidate. Use a new build label for the next real acceptance candidate, e.g. `stale-composer-recovery.6`, without bumping the formal version.

## Real-site acceptance

Only after the deterministic multi-remount focused regression passes, ask the user for one more real-site acceptance:

`Reload -> Run composer check -> @GitHub -> select -> Ctrl+A/Delete -> wait -> Copy report`

No Console JS, DevTools, Browser Use, or Computer Use.

Acceptance is not merely `attempted=true`. The report must show that the same stale fingerprint, if it reappears across later remounts, is handled within the bounded tombstone and does not remain as the final composer payload.
