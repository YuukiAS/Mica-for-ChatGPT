# Connector lifecycle production finish

Date: 2026-09-08

## Why this task exists

The current 0.1.6 candidate (`connector-draft-recovery.1`) still produces a visibly unfinished user experience and still misclassifies the first connector-selection Enter on the real ChatGPT page. The user should not be asked to continue repeated manual acceptance until the full real sequence is represented locally and the visible UI is production quality.

The latest real report and screenshot are sufficient to continue without another user round.

## Real acceptance facts that must be treated as authoritative

### A. Connector-selection Enter is still misclassified

Real timeline:

- user types the connector mention query;
- at ~4319 ms the composer blurs with text length 8;
- at ~4368 ms the composer unmounts;
- at the same ~4368 ms Mica emits `send_intent source=enter` while `composerPresent=false`, `textLength=0`;
- the composer remounts at ~5332 ms with text length 8;
- the user then continues typing substantial text;
- the actual Send does not occur until ~16484 ms, where a proper pre-send snapshot with length 24 is captured.

Therefore the first Enter is still the connector-selection Enter, not message Send.

The intended `chooserActiveNow` / `selectionWindowActive` split did not work on real ChatGPT:

- `chooserActiveNow=false`
- `selectionWindowActive=false`

throughout the first Enter/remount cycle.

Synthetic tests that claim this is fixed are insufficient unless they reproduce this exact real shape.

### B. Send residual recovery is substantially working, but completion semantics are wrong

Real Send path:

- pre-send length 24 captured;
- user turn commit latched;
- post-send remount occurs;
- exact full stale payload match occurs;
- recovery attempt #1 clears to zero;
- stale payload returns after another remount;
- recovery attempt #2 clears again;
- final composer is empty (`finalTextLength=0`).

However report summary still says:

- `sendResidualRecoverySucceeded=false`
- `cleanupReason=hard_cap`

This is misleading because the user-visible final state is empty. Completion must be evaluated after the bounded remount/quiet-window logic, not simply by hard-cap expiry while the final empty state has already stabilized.

### C. The connector continuity UI is still not acceptable

The current visible continuity treatment still looks like a visibly inserted/unfinished composer layer. Production target is not 'a placeholder that roughly resembles a composer'. It should be visually indistinguishable from the last native composer state, or the feature should fail open and show nothing.

No custom generic white box, custom fake input, simplified shell, or Mica-designed substitute should be shown.

The latest report also says:

- `connectorContinuityActivated=false`
- `sanitizedCloneAvailable=false`

for the recorded session. If the screenshot was taken during a Mica continuity state, diagnostics are inconsistent. If it was not, then continuity still did not activate during the real selection window. Either way, do not ask the user to diagnose this discrepancy; resolve it locally.

### D. Page-level Copy/Stop must not be considered fixed without real hit-testing

The user previously reported the page-level top-right Copy/Stop controls are non-functional while popup controls work.

Tests using direct handler invocation or `element.click()` are not sufficient. Browser tests must use coordinates and `page.mouse.click`, plus `elementFromPoint`, to prove the actual visible buttons receive pointer input.

## Production decision

Stop treating this as three independent tiny patches. Finish the connector lifecycle as one coherent state machine and one polished UX.

The next candidate must not be sent to the user until all acceptance gates below pass locally.

---

## 1. Replace heuristic chooser detection with a connector-selection transaction

Do not rely on `chooserActiveNow` DOM selectors alone.

Introduce a short-lived **connector-selection transaction** that can be recognized from multiple evidence sources and can be confirmed retroactively.

Suggested state:

`idle -> mention_query -> selection_candidate -> selection_confirmed -> connector_context_ready`

### Enter handling

When Enter occurs while a connector mention query is unresolved or connector selection is plausible:

- DO NOT immediately create a real Send generation;
- create a short `selection_candidate` transaction instead;
- delay Send classification for a very short bounded window;
- if the composer unmounts and then remounts with connector context/chip while no new user turn commits, classify this Enter as connector selection;
- if a real user turn commits and the draft was a valid message Send, promote to real Send generation.

This avoids requiring a perfect chooser selector.

### Structural evidence that can confirm selection

Use a combination of:

- recent `@` mention trigger;
- unresolved mention query in the editor;
- absence/presence transition of resolved connector chip;
- composer unmount/remount;
- no user turn commit for that Enter;
- same draft/body survives remount;
- chooser DOM if available.

Do not store connector names or prompt text in diagnostics.

### Required local fixture

Reproduce the exact real sequence:

1. type unresolved `@connector` text (length ~8);
2. press Enter #1;
3. composer unmounts immediately;
4. no user turn commit;
5. composer remounts with connector context;
6. user continues typing to length ~24;
7. click/Enter #2 performs real Send;
8. pre-send snapshot length 24 is captured;
9. user turn commits.

Acceptance:

- Enter #1 creates NO send residual generation;
- Enter #2 creates exactly one real send generation;
- no duplicate send generation;
- connector context remains latched for the real Send.

---

## 2. Make continuity visually native or fail open

Do not design a separate Mica composer UI.

### Preferred implementation

Capture the **entire native composer visual wrapper** immediately before a confirmed connector-selection unmount and reuse it as a short-lived inert snapshot.

The snapshot should include:

- native wrapper/background/gradient;
- exact native dimensions and position;
- plus button;
- connector chip;
- current draft visual;
- model selector;
- send button;
- native border/radius/shadow/theme.

It must be a visual snapshot only:

- `aria-hidden=true`;
- `inert`;
- `pointer-events:none`;
- contenteditable disabled;
- controls disabled;
- duplicate ids stripped;
- no event listeners copied;
- no network actions.

Do not add custom labels or Mica styling.

### Important fallback rule

If a visually faithful snapshot cannot be created safely for the current native structure:

**show nothing**.

A visible rough placeholder is worse than a brief native disappearance.

### Scope

Continuity may activate only for the confirmed connector-selection transaction.

It must never activate for:

- actual Send remount;
- stale residual recovery;
- Ctrl+A/Delete recovery;
- ordinary composer remounts after the selection transaction ended.

### Visual regression test

Build a realistic local fixture with the same composer controls and theme.

Compare the continuity snapshot against the native pre-unmount composer using screenshot diff / bounding-box assertions.

Acceptance target:

- no Mica-specific shape change;
- same position/size;
- same visible controls;
- no generic white placeholder;
- no layout jump larger than a few pixels.

---

## 3. Finish send residual success semantics

The runtime recovery already demonstrates useful behavior on the real page.

Keep the existing bounded retries and exact/partial provenance safety.

Fix completion semantics so that the report can distinguish:

- `local_clear_observed`
- `same_payload_reappeared`
- `retry_clear_observed`
- `final_empty_stable`
- `hard_cap_with_empty_final_state`
- `hard_cap_with_stale_remaining`

Do not report `succeeded=false` simply because the hard cap timer fired if:

- final composer is empty;
- no stale payload returns during the final quiet window;
- no new trusted input occurred.

For the latest real sequence, the intended final result is a successful recovery if the final empty state survives the required quiet window.

---

## 4. Use a transaction-level quiet window

Unify the end condition for connector-related draft recovery.

A success state requires:

- last recovery clear observed;
- all later native remounts observed within bounded lifetime;
- no matching stale provenance reappears during the final quiet window;
- final composer empty or absent;
- no new trusted user input.

Any remount or stale provenance reappearance resets the quiet window.

Keep an absolute bounded lifetime so the feature remains fail-open and cannot loop forever.

---

## 5. Page Copy/Stop: prove real pointer behavior

Do not modify the diagnostic state machine.

Fix only the visible page controls and their message wiring.

Browser acceptance must:

1. start diagnostics;
2. render the page overlay;
3. obtain the visible center coordinates for Stop;
4. assert `document.elementFromPoint` hits the button or child;
5. use `page.mouse.click`;
6. verify session stops;
7. repeat for Copy;
8. verify copied report has the same schema/privacy fields as popup Copy.

Check z-index, stacking context, `pointer-events`, ancestor overlays, and inert state.

No direct handler calls count as acceptance.

---

## 6. Do not rely on synthetic DOM that differs from ChatGPT

The previous focused fixtures repeatedly passed while the real site still failed.

Before adding more behavior, update the fixture so it reproduces the observed real invariants:

- first selection Enter occurs around composer unmount;
- no user turn commit on selection Enter;
- composer remount preserves the connector draft/context;
- second real Send occurs much later;
- post-send stale payload can reappear after multiple remounts;
- native mounted turn count can +1 then -1;
- no new trusted user input during recovery.

The fixture should be derived from structural facts in diagnostics, not invented UI assumptions.

---

## 7. Per-feature toggles remain mandatory

Keep independent toggles:

- Long-thread optimization
- Stale clear recovery
- Connector continuity
- Send residual recovery

Master Enabled remains the global switch.

Do not couple feature settings.

---

## 8. Version/build label

Keep formal version:

`0.1.6`

Use next candidate label:

`connector-lifecycle-production.1`

Do not bump to 0.1.7 during this uncommitted acceptance cycle.

---

## 9. Test gates before any user retest

During development, run focused tests only.

Before asking the user to test, all of the following must pass:

### Connector transaction

- [ ] Enter #1 selection candidate -> no Send generation
- [ ] selection confirmed by remount/context evidence
- [ ] Enter/click #2 -> exactly one real Send generation
- [ ] connector context latched for real Send

### Continuity visual quality

- [ ] no generic/custom placeholder UI
- [ ] snapshot is visually faithful to native composer
- [ ] selection-only activation
- [ ] no activation during Send/clear recovery
- [ ] safe fallback is no snapshot, not rough UI

### Send residual

- [ ] exact full residual recovery
- [ ] safe partial provenance recovery
- [ ] multi-remount retry
- [ ] final empty stable -> success semantics
- [ ] nonmatching text preserved
- [ ] new trusted input preserved

### Diagnostic page controls

- [ ] Stop passes real pointer hit-test
- [ ] Copy passes real pointer hit-test
- [ ] popup controls still pass

### Full gate

Then exactly once:

- `npm test`
- `npm run test:e2e`
- `npm run build`
- `npm run test:build`

Stress test: not indicated unless new race/flakiness evidence appears.

---

## 10. Stop condition

Do not commit or push runtime candidate before real acceptance.

Do not ask the user to retest until the local report explicitly shows all gates above passing.

The user should receive at most one next real acceptance round for this connector lifecycle candidate.
