# P0 — Connector selection is misclassified as Send; continuity shell is visually wrong; stale draft tombstones end too early

Date: 2026-09-08

Status: design / implementation task for current uncommitted 0.1.6 candidate.

## Real acceptance evidence

Latest real report: `0.1.6 / connector-mention-lifecycle.3`.

The same session shows all of the following:

1. `mention_signal_on` at ~6898 ms.
2. At ~8442 ms, selecting the connector with Enter causes `composer_unmount`, and **the same Enter is recorded as `send_intent` while `composerPresent=false`, `textLength=0`**.
3. Connector continuity then shows a shell. The native composer returns ~1.17 s later.
4. User continues typing the actual message.
5. A real user turn commits at ~21305 ms with `preSendLength=30`.
6. After commit, native composer remounts with stale nonzero content: len 9 -> len 15. The report classifies this as `SEND_NONMATCHING_TEXT_PRESENT` because the restored payload is only a partial/subset form of the pre-send draft, not an exact full fingerprint match.
7. `sendResidualRecovery` ends in `generationId=0 / no_send_generation`: the actual Send was not represented by a live runtime send generation, so no residual recovery can run.
8. User later Ctrl+A/Backspace clears the 15-char stale draft. Stale-clear recovery clears it twice and declares `FINAL_CLEAR_STABLE` at ~34215 ms.
9. **37 ms later**, native composer remounts again with stale text (len 9 -> len 15), and the stale payload continues to recur. Thus the current `finalClearStable` decision is premature and the 5.5 s hard window can terminate immediately before another rehydration.
10. Connector continuity technically activates, but the user-visible result is a generic white/faint textbox. It does not visually preserve the native composer and is perceived as the composer disappearing/replacing itself with a broken white placeholder.
11. Page-overlay `Copy` / `Stop` remain nonfunctional in real use although popup controls work. Prior synthetic tests were insufficient to prove real hit-testing / pointer behavior.

## Root cause conclusions

### A. Connector selection Enter and real Send Enter are conflated

A long-lived connector latch must not be used as a substitute for the ephemeral question “is the chooser active right now?”.

We need two distinct concepts:

- `chooserActiveNow`: short-lived, structural, only while the connector/mention chooser is actually open or a connector selection gesture is in progress.
- `connectorContextLatched`: longer-lived metadata saying the current draft/send is associated with a connector lifecycle.

Rules:

- Enter while `chooserActiveNow=true` is connector selection, **not Send**.
- After chooser closes and the real composer is present, a later Enter/submit is a real Send even though `connectorContextLatched=true`.
- The regression fixture must explicitly contain two Enter presses: first selects connector, user types more, second sends the message.

### B. Send residual matching is too strict

Exact full pre-send fingerprint equality is insufficient for connector/native remounts. The real session restored only a partial/subset stale draft (`preSendLength=30`, stable stale residual len 15).

Recovery may use a stronger provenance rule while remaining safe:

- user turn is definitely committed;
- post-send native unmount/remount occurred;
- no trusted user input happened after Send;
- remounted text is either:
  - exact full pre-send normalized text, or
  - an exact contiguous substring / canonical body match derived from the transient pre-send snapshot after removing recognized connector chip/token representation;
- minimum residual length threshold to avoid tiny accidental matches;
- comparison uses transient local text only; diagnostics log only lengths/hashes/reason codes.

Do not broaden to fuzzy semantic matching.

### C. Stale-clear tombstone stability criterion is wrong

Do not declare final clear success merely because the absolute hard window expires while the composer is currently empty/missing.

Use:

- a bounded absolute cap;
- plus a **quiet window since the last native remount / last stale reappearance**;
- any remount or same-payload reappearance resets the quiet window;
- only declare `finalClearStable=true` after the quiet window completes with no stale return;
- new trusted user input cancels immediately;
- attempts remain bounded, but the fixture must cover at least the full real repeated-remount sequence from this report, including a stale reappearance *after* a prior apparent success.

The exact real fixture should include repeated remounts roughly every 0.85–1.05 s for >6 s.

### D. Connector continuity shell is the wrong visual primitive

Current generic white shell is not acceptable. It technically fills the gap but visibly looks broken.

Preferred implementation:

- capture a **sanitized inert visual clone** of the last native composer wrapper immediately before the connector-selection unmount;
- clone must be `aria-hidden`, non-interactive, `pointer-events:none`, no functional event handlers, no duplicate ids, no active contenteditable/forms/buttons;
- preserve native theme, border, radius, height, connector chip, and visible draft appearance;
- only show during the short connector-selection missing window;
- remove immediately when the real composer returns;
- hard cap ~2 s;
- never show for later Send remounts, stale-clear remounts, or unrelated composer missing events.

If sanitized clone is not robust, a computed-style visual replica is acceptable, but a generic white placeholder is not.

### E. Page overlay controls need true hit-testing tests

Do not use `element.click()` as acceptance because it bypasses hit-testing problems.

Focused browser test must:

- render the actual page overlay;
- assert `document.elementFromPoint(buttonCenter)` resolves to the overlay button (or a child within it);
- use real pointer/mouse click at button coordinates;
- verify `Stop` ends the active session;
- verify `Copy` calls the real copy/report path and produces the same privacy-safe report structure as popup Copy;
- inspect computed `pointer-events`, `z-index`, `inert`, and ancestor hit-testing if this fails.

## Required focused fixtures before any new user acceptance

1. **Two-Enter connector flow**
   - Enter #1 selects connector while chooser is active -> no send generation.
   - Composer remounts.
   - User types additional text.
   - Enter #2 sends -> real send generation created with pre-send snapshot.

2. **Partial stale residual after Send**
   - committed user turn;
   - no new trusted input;
   - native remount returns partial/canonical body substring of pre-send draft;
   - recovery clears it;
   - nonmatching text remains untouched.

3. **Repeated remount after apparent success**
   - clear stale draft;
   - remount stale;
   - clear attempt 1;
   - remount stale;
   - clear attempt 2;
   - a later remount occurs after the previous implementation would have declared success;
   - tombstone remains active until quiet window or bounded exhaustion;
   - final stable empty required.

4. **Connector continuity visual**
   - only during chooser-selection unmount;
   - sanitized clone visually preserves native composer shape/theme;
   - no generic white placeholder;
   - later Send/clear remounts do not activate continuity shell.

5. **Overlay Copy/Stop hit-testing**
   - real pointer click, not direct DOM `.click()`;
   - actual side effect verified.

## Version / test policy

Stay on `0.1.6`; use a new build label such as `connector-draft-recovery.1`.

During iteration run only focused tests. Once all focused fixtures above pass, run a single final Tier 2 gate (`npm test`, `npm run test:e2e`) plus build / `npm run test:build`.

Do not ask the user for another real test until all five focused fixtures pass end-to-end.

Do not commit/push runtime candidate until real acceptance passes.