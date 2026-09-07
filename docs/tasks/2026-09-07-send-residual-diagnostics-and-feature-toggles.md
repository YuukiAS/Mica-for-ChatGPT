# 2026-09-07 — Send residual diagnostics + per-feature toggles

## Context

`0.1.5` (`stale-composer-recovery.6`) has been pushed and the delete-path workaround has reached a usable acceptance state. Issue #6 remains open because a separate problem still affects normal use:

- after the user manually sends a longer prompt, the new user turn may commit successfully while stale composer content remains or reappears;
- this send-path failure must not be assumed to be identical to the clear/delete-path failure;
- the user will perform any real ChatGPT send manually;
- the user must never be asked to paste JavaScript into DevTools or manually inspect DOM.

The user also requires each workaround/pain-point mitigation to have its own independent toggle. The global `Enabled` control remains a master switch.

## Goal

Prepare one high-value real-site send-path diagnostic pass without wasting repeated user effort, and establish the feature-toggle foundation before implementing any send workaround.

## Phase A — Feature-toggle foundation

Keep the existing global `Enabled` switch as the master switch. Add persistent per-feature settings for implemented runtime behaviors.

Required implemented toggles:

- `Long-thread optimization`
- `Stale clear recovery`

Rules:

- master `Enabled = OFF` disables all runtime features regardless of individual feature values;
- individual feature values are preserved while master is OFF;
- existing users migrate without losing current behavior: implemented features default to their current effective enabled state;
- `Stale clear recovery = OFF` must make the recovery module truly inert while diagnostics may still run when the user explicitly starts a diagnostic session;
- do not expose nonfunctional future toggles in the normal popup;
- reserve clean internal keys for future `Send residual recovery` and `Connector continuity` features, but only show them after implementation exists;
- keep the popup compact; feature toggles belong in a small advanced/features section, not a debug cockpit.

## Phase B — Audit current send diagnostics before asking the user to test

Inspect the existing `composer-diagnostics.ts` and synthetic fixtures. Before any real-site send test, verify that a single `Run composer check -> user manually sends once -> Copy report` can answer all of the following without DevTools:

1. What was the pre-send composer payload length and local-only fingerprint?
2. Did a new user turn commit (`userTurnDelta > 0`)?
3. Did the composer clear before or after the user turn commit?
4. Did the composer unmount/remount one or more times?
5. If nonzero text appeared after the new user turn, did it match the pre-send payload fingerprint?
6. Did stale content appear only briefly or remain stable at the end of the bounded session?
7. Did any Mica runtime callback correlate with reappearance?
8. Was `Stale clear recovery` enabled/disabled, and did it act during the send path? It must not accidentally treat a send as a user clear intent.

If current diagnostics cannot answer these reliably, enhance the built-in diagnostics first. Do not ask the user for a real send until the synthetic surrogate proves the report fields work.

## Phase C — Send-path report schema

The privacy-safe report should include at least:

```text
sendLifecycle: {
  observed,
  preSendLength,
  preSendFingerprintCaptured,
  userTurnCommitted,
  userTurnDelta,
  firstComposerZeroElapsedMs,
  composerUnmountCountAfterSend,
  composerMountCountAfterSend,
  stalePayloadReappeared,
  staleFingerprintMatched,
  staleReappearanceElapsedMs,
  finalTextLength,
  finalComposerPresent,
  classification
}
```

Recommended classifications:

- `SEND_CLEARED_STABLE`
- `SEND_STALE_PAYLOAD_REAPPEARED`
- `SEND_NONMATCHING_TEXT_PRESENT`
- `SEND_NOT_COMMITTED`
- `INSUFFICIENT_SEND_EVIDENCE`

Do not include prompt text, answer text, request bodies, headers, cookies, raw DOM, or clipboard contents.

## Phase D — Synthetic send surrogate

Before the real-site test, add a focused synthetic fixture that models:

1. composer contains a longer payload;
2. manual-submit surrogate occurs;
3. user turn count increments;
4. composer clears/unmounts/remounts;
5. stale old payload may reappear after one or multiple remounts;
6. final report correctly distinguishes stable clear vs stale old payload reappearance;
7. nonmatching new user input after send is never classified as stale old payload;
8. `Stale clear recovery` does not incorrectly activate merely because a send occurred.

Only focused tests are required during iteration. Follow `AGENTS.md` test tiers.

## Phase E — Versioning

`0.1.5` is already committed/pushed. Any runtime/settings/diagnostics changes for this stage must bump to `0.1.6`.

Suggested build label for the diagnostic candidate:

`send-residual-diagnostics.1`

Do not create a release yet.

## Phase F — Real-site acceptance boundary

Only after focused synthetic coverage passes and `dist/mica-dev` is rebuilt, stop and ask the user for exactly one real-site send test:

1. Reload Mica in `edge://extensions`.
2. Refresh the current ChatGPT thread.
3. Keep Mica master `Enabled = ON`.
4. Keep `Stale clear recovery` at its default ON state unless a later A/B is explicitly needed.
5. Click `Run composer check`.
6. Manually send one naturally long prompt that the user was going to send anyway, or a single benign test prompt if preferred.
7. Wait until the new user turn is visibly committed and the composer has settled for several seconds.
8. Click `Copy report` and share the JSON.

Do not ask for a second real send unless the first report is genuinely insufficient and the reason is explicit.

## Phase G — No send workaround yet

Do not implement `Send residual recovery` in this task unless the single real report proves the send-path state machine and root condition clearly enough to make a narrow, safe design.

After the report:

- if the stale text matches the exact pre-send fingerprint after user-turn commit, design a dedicated `Send residual recovery` module with its own toggle;
- if the residual is nonmatching text, do not reuse the clear-path tombstone blindly;
- if the user turn did not commit, treat that as a different delivery/ghost-send problem.

## User-effort constraint

The user is willing to provide copied Mica reports, but real-site testing costs time. Prefer improving built-in diagnostics and deterministic fixtures over repeated manual trials. Never ask the user to paste JS into Console or inspect raw DOM.