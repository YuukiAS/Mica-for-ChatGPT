# Native stale composer recovery guard

Date: 2026-09-06

## Why this task exists

Real-site diagnostics now show that ChatGPT can restore stale composer content across its own connector/composer remount lifecycle even when Mica runtime is disabled.

Confirmed OFF-path evidence from the 0.1.5 diagnostics candidate:

- `micaEnabled = false`
- `documentMutationObserverActive = false`
- `composerLifecycleListenersAttached = false`
- `optimizedTurns = 0`
- a reliable clear anchor occurred while the composer was still present: `textLength = 0`
- the composer then unmounted
- a new root mounted with non-zero text
- the stale content then grew back to the previous non-zero length
- `micaCallbacksWithin250ms = []` at the restoration point
- the connector signal was detected from the GitHub chip

Therefore the working conclusion is:

> The stale restoration is primarily a ChatGPT native / connector composer lifecycle bug, not a Mica optimization-only regression.

Mica still needs to protect the user from this because it materially breaks normal use.

## Product requirement

Do not try to prevent ChatGPT's native composer remount itself. Instead, add a very narrow recovery guard that preserves the user's explicit clear intent across a native remount.

The guard must be safe enough that it cannot erase newly typed text.

## Phase A — clear-after-remount recovery

Implement a small isolated module, not a new diagnostics framework and not more logic piled into `content.ts`.

Suggested responsibility:

`extension/src/reliability/stale-composer-recovery.ts`

The exact file name may differ if there is a better existing reliability module boundary.

### Arm condition

Only arm recovery after a reliable, user-originated clear sequence.

The preferred evidence is:

1. a trusted delete/cut/delete-like input occurs in the active ChatGPT composer;
2. the same composer is still present and reaches `textLength = 0`;
3. capture a private local fingerprint/signature of the pre-clear stale payload before it is removed;
4. start a short bounded guard window, approximately 1.5–2.5 seconds.

A `composerPresent = false` sample with synthetic `textLength = 0` is never a clear anchor.

### Payload fingerprint

The guard may compare content internally to avoid deleting new user text, but the fingerprint must never be exported in diagnostics as raw content.

Prefer a local-only fingerprint/signature that is sufficient to distinguish:

- the old pre-clear payload returning;
- genuinely new text typed by the user after the clear.

The report may expose only safe metadata such as lengths, booleans, hash equality, timing, and identity changes.

### Recovery condition

During the bounded guard window, if ChatGPT remounts the composer with non-empty content:

- do not immediately delete the first non-zero sample;
- allow a very short settling period because the stale payload can return incrementally;
- recover only when the remounted content strongly matches the pre-clear stale payload/signature;
- cancel recovery immediately if any new trusted user input is observed after the clear anchor;
- never recover after the guard expires;
- bound attempts to at most one or two per clear intent.

This must handle the observed pattern where a remount first returns a short fragment and then returns the full stale payload.

### Recovery primitive

Prefer browser-native contenteditable editing semantics over raw DOM replacement.

A reasonable implementation to evaluate is Selection-based full selection plus the browser's native editing delete command, followed by verification that the controlled editor remains empty.

Do not:

- patch React internals;
- monkey-patch ChatGPT handlers;
- intercept or block Enter;
- synthesize Send;
- modify request bodies;
- restore or rewrite arbitrary user text;
- use broad permanent MutationObservers;
- use an unbounded polling loop.

If a safe clear primitive cannot be made to stick, fail open and keep diagnostics rather than escalating into invasive editor surgery.

## Runtime simplicity

The recovery guard should be near-zero cost while idle.

- No permanent 100/150ms document sampler.
- No permanent full-document MutationObserver.
- Lightweight event observation may exist only while Mica is enabled and should be scoped to composer-relevant trusted events.
- Any fast sampling/observation used after a clear intent must be short-lived and cleaned up when the guard resolves/expires.
- Mica Enabled=OFF must remain semantically inert except for an explicitly started diagnostics session.

Audit `known_interruption_check`: if normal runtime polling still performs page work while Mica is disabled, make the disabled path truly inert. Diagnostics may keep its own bounded session-only observation.

## Diagnostics integration

Extend the existing built-in `Run composer check -> reproduce -> Copy report` path rather than creating DevTools probes.

Add safe fields such as:

- `staleRecoveryArmed`
- `staleRecoveryCancelledByUserInput`
- `staleRecoveryMatch`
- `staleRecoveryAttempted`
- `staleRecoverySucceeded`
- `staleRecoveryAttemptCount`
- `staleRecoveryGuardDurationMs`

Never include prompt text, connector text, raw DOM, clipboard data, request bodies, headers, cookies, or tokens.

## Synthetic regression cases

At minimum cover:

1. clear -> remount with the same stale payload -> recovery succeeds and final composer is empty;
2. clear -> remount with a partial stale fragment -> wait -> full stale payload returns -> recover once;
3. clear -> user immediately types new text -> guard cancels and new text is never deleted;
4. clear -> remount with unrelated text -> no recovery;
5. clear -> remount stays empty -> no recovery action;
6. Mica disabled -> recovery never runs;
7. diagnostics active while Mica disabled -> diagnostics works but recovery/optimization/runtime remain disabled;
8. repeated native remounts remain bounded and do not create loops.

## Real-site acceptance

Do not automate the authenticated ChatGPT page and do not ask the user to paste JS into DevTools.

After the local candidate passes Tier 2 and `dist/mica-dev` is rebuilt, stop and ask the user only to:

1. Reload Mica in `edge://extensions`;
2. refresh the current ChatGPT thread;
3. keep Mica Enabled=ON;
4. click `Run composer check`;
5. manually do `@GitHub -> select GitHub -> Ctrl+A/Delete`;
6. wait about 2 seconds;
7. click `Copy report` and provide the report.

Acceptance for Phase A:

- ChatGPT may still briefly remount the composer;
- stale content must not remain after the remount;
- final composer length must be zero;
- diagnostics should show a bounded recovery only when the stale payload actually returned;
- newly typed text must never be deleted.

## Phase B — sent-text residue

Do not implement the send-path workaround until a real report confirms the exact sequence for the user's second symptom: successful manual send / user-turn commit followed by stale old composer content.

The same built-in diagnostics should be used for one manual send report. No Console JS.

After Phase A is accepted, capture one long-text/manual-send report and decide whether the same guarded mechanism can safely extend to `userTurnCount + 1 -> stale pre-send payload remount`.

## Versioning and tests

The existing local 0.1.5 candidate has not yet been committed/pushed. Continue the same candidate while implementing this Phase A fix unless the repository's versioning rules require otherwise.

Before real-site acceptance:

- run focused tests while iterating;
- final gate: `npm test` and `npm run test:e2e`;
- stress is not required unless a genuine timing race cannot be covered by normal E2E;
- rebuild `dist/mica-dev`;
- do not commit/push until the user completes the real-site acceptance pass.
