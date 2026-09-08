# Connector / mention lifecycle recovery

Date: 2026-09-08

## Revised diagnosis

The current evidence no longer supports message length as the primary trigger for composer residuals.

Confirmed observations:

1. Selecting a connector via `@...` causes the ChatGPT composer to briefly unmount/remount even with Mica runtime disabled. This is native ChatGPT connector/mention lifecycle behavior, not a Mica-only remount.
2. The existing stale-clear recovery addresses the separate case where a user explicitly clears the composer and ChatGPT later rehydrates the old payload.
3. A long non-mention message (~1625 chars) can send and remain cleared, while the user observes residuals after `@GitHub` / mention flows. Treat mention/connector lifecycle as the primary trigger hypothesis for send residuals until disproved.
4. The current send diagnostics can false-negative a successful send: in a real report it observed `user_turn_count_change +1` and then later `-1` as the mounted turn window changed, producing `SEND_NOT_COMMITTED` even though the message was actually committed. `userTurnCommitted` must therefore be a monotonic latch once a post-send +1 commit signal is observed; later virtualization/window-count changes must not erase it.

## Product requirement: independent toggles

`Enabled` remains the master switch. Each mitigation must also have its own independent toggle.

Implemented / required toggles:

- Long-thread optimization
- Stale clear recovery
- Send residual recovery
- Connector continuity

The last two must not be exposed as UI toggles until their runtime behavior exists. Turning one mitigation off must make that module inert without disabling unrelated Mica features.

## Goal A — Connector continuity

The native connector selection remount should not be confused with a Mica bug, and Mica should not attempt to prevent ChatGPT's native state transition.

Implement an optional, independently toggleable **Connector continuity** mitigation whose purpose is only to avoid the visible composer disappearance/flicker during a short native connector remount.

Constraints:

- Do not block Enter/click selection.
- Do not prevent native unmount/remount.
- Do not clone or replace ChatGPT's functional editor.
- Do not monkey-patch React or connector handlers.
- Prefer a short-lived visual continuity shell/snapshot anchored to the composer geometry while the native composer is absent.
- The shell is non-interactive and must disappear immediately when the real composer returns.
- Bound the lifetime tightly (roughly the observed sub-second to ~1.5s remount window, with a hard cap).
- Cancel immediately on navigation, feature disable, or if the real composer never returns.
- No permanent high-frequency polling or full-document observer.

Acceptance: selecting a connector may still remount internally, but the composer area should not visibly collapse/disappear.

## Goal B — Send residual recovery

Implement a separate, independently toggleable **Send residual recovery** mitigation for connector/mention sends.

Do not copy the stale-clear feature blindly; use send-specific evidence.

Arm only when all of the following are available:

- manual send intent observed from normal page UI;
- pre-send payload fingerprint captured locally;
- mention/connector structural signal was observed for that composer lifecycle;
- post-send user-turn commit becomes latched true.

### Commit latch

Once diagnostics/runtime observes a post-send user-turn increment consistent with the submitted message, set `userTurnCommitted=true` for that send generation and never revert it because the currently mounted turn count later falls again.

A later decrement caused by virtualization/remount must not convert the send back to `SEND_NOT_COMMITTED`.

### Residual tombstone

After commit is latched:

- If composer stays empty, finish as stable without action.
- If the exact pre-send fingerprint reappears after composer remount, treat it as stale residual for this send generation.
- Clear only the matching stale payload using the already validated minimal editor-delete primitive.
- Keep a short bounded tombstone because ChatGPT may rehydrate the same payload across more than one remount.
- Max attempts must be bounded (e.g. 2–3) with a hard lifetime cap.
- Any new trusted user typing/paste/composition cancels the send tombstone immediately.
- A nonmatching payload must never be auto-cleared.

## Diagnostics

Keep all real-site diagnostics inside Mica. Do not ask the user to paste JS into DevTools.

`Copy report` should expose privacy-safe, generation-scoped fields:

- mention/connector signal observed + structural source
- preSendLength
- preSendFingerprintCaptured
- userTurnCommitSignalObserved
- userTurnCommittedLatched
- mountedUserTurnDelta history or compact commit evidence
- composer unmount/remount counts after send
- stalePayloadReappeared
- staleFingerprintMatched
- sendResidualRecoveryAttemptCount
- sendResidualRecoverySucceeded
- connectorContinuityActivated
- connectorContinuityDurationMs
- finalTextLength
- finalComposerPresent
- classification

Do not include prompt text, answer text, raw DOM, request bodies, headers, cookies, or tokens.

## Synthetic regression requirements

Before asking for another real-site test, local focused fixtures must cover:

1. Normal long send without mention: commit + stable empty; no connector mitigation should activate.
2. Connector selection: native composer unmount/remount; continuity shell activates and disappears when the real composer returns.
3. Connector send: pre-send fingerprint captured, commit latch becomes true, mounted turn count later decreases, but commit latch stays true.
4. Connector send residual: commit + composer empty + same pre-send payload reappears; send residual recovery clears it and final state is empty.
5. Multiple stale rehydrates: bounded retry succeeds or stops at max attempts; never infinite-loop.
6. New user input after send: tombstone cancels and new text is preserved.
7. Nonmatching post-send text: never auto-clear.
8. Each feature toggle independently makes its module inert; master Enabled disables all normal runtime features while preserving settings.

## Testing policy

During development use focused tests only. After the combined connector-continuity + send-residual candidate is stable, run one final Tier 2 gate because this is DOM/lifecycle-sensitive runtime behavior. Do not rerun full E2E after every small edit. Stress is not indicated unless focused or normal E2E reveals an actual race/flakiness problem.

## Versioning

The current uncommitted candidate is `0.1.6`. Continue using `0.1.6` until this combined candidate is accepted; update `BUILD_LABEL` to a connector/mention-specific candidate label. Do not bump `0.1.7` merely for candidate iterations before `0.1.6` is committed.

## Real-site boundary

The user performs the authenticated ChatGPT interaction manually. Codex must not automate Send, connector selection, DevTools, Browser Use, or Console JS on the user's real ChatGPT session.

Do not ask for real-site testing until the local fixture reproduces the full connector selection + connector send residual lifecycle and both mitigations pass locally. The user should only need a final minimal acceptance and `Copy report`.
