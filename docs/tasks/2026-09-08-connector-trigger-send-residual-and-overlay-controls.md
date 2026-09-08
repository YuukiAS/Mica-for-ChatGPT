# Task: fix connector-triggered send residual recovery and page diagnostic controls

Date: 2026-09-08

## Confirmed real-site evidence

From the latest real ChatGPT report using `0.1.6 / connector-mention-lifecycle.1`:

- `sendLifecycle.userTurnCommitted = true`
- `sendLifecycle.userTurnCommittedLatched = true`
- `sendLifecycle.preSendLength = 34`
- `sendLifecycle.preSendFingerprintCaptured = true`
- `sendLifecycle.stalePayloadReappeared = true`
- `sendLifecycle.staleFingerprintMatched = true`
- `sendLifecycle.finalTextLength = 34`
- `sendLifecycle.classification = SEND_STALE_PAYLOAD_REAPPEARED`

The user also observed the composer disappear during an `@GitHub` connector test. `@GitHub` is only a generic connector lifecycle test; no GitHub action is requested.

The same report shows:

- `runtime.connectorContinuityEnabled = true`
- `runtime.sendResidualRecoveryEnabled = true`
- but `connectorContinuity.activated = false`
- and `sendResidualRecovery.generationId = 0`, `phase = IDLE`, `attemptCount = 0`
- while `mentionSignalObserved = false`

Therefore the runtime mitigations did not start even though the diagnostics independently proved a committed send followed by reappearance of the exact pre-send payload.

## Root problem to fix

Do not revisit message-length hypotheses. The current failure is connector/mention lifecycle handling.

The runtime connector detector / arming path is too narrow or incorrectly wired. Diagnostics can prove the stale send payload reappeared, but the actual `Send residual recovery` and `Connector continuity` features remain idle because the connector signal was not latched.

Fix the runtime signal/arming path so a real connector selection/send lifecycle can activate the corresponding features without hard-coding GitHub.

## Required behavior

### 1. Generic connector lifecycle signal

Implement one small shared connector-lifecycle signal source that can be consumed by diagnostics, connector continuity, and send residual recovery.

It must be generic for `@` connector flows, not GitHub-specific.

Use stable structural evidence where possible, such as chooser/chip/semantic markers. Do not record connector text, prompt text, raw DOM, or private request data.

The signal should be latched for the bounded lifecycle so a chip/chooser disappearing during native remount does not erase the fact that the current composer/send generation came from a connector flow.

Do not require the connector chip to still be present after send in order to arm recovery.

### 2. Send residual recovery must arm from real send evidence

For a send generation, capture:

- manual send intent
- pre-send fingerprint
- whether connector lifecycle was latched for that generation
- monotonic `userTurnCommittedLatched`

If the user turn commits and the exact pre-send fingerprint later reappears, the independent `Send residual recovery` feature must activate when its toggle is ON.

Do not depend on session-wide mention detection that can become false after remount.

Safety invariants remain:

- only delete exact matching pre-send stale payload
- any new trusted user input cancels the generation
- nonmatching text is preserved
- attempts are bounded
- hard lifetime is bounded
- master Enabled OFF or Send residual recovery OFF means inert

### 3. Connector continuity must use the same latched lifecycle

When connector selection triggers native composer disappearance, the independent `Connector continuity` feature should activate its non-interactive visual continuity shell for the missing interval and remove it as soon as the real composer returns.

Do not block or replace native connector behavior.

### 4. Diagnostics must expose the arming chain

Add concise fields/events sufficient to distinguish:

- connector lifecycle detected
- connector lifecycle latched for current generation
- send residual recovery armed or skipped, including skip reason
- connector continuity activated or skipped, including skip reason

No raw text/DOM.

### 5. Page overlay Copy / Stop controls

The user reports that after `Run composer check`, the page-level top-right `Copy` and `Stop` controls do nothing, while the corresponding popup buttons work.

Fix this in the same candidate.

Requirements:

- page `Stop` must stop the active diagnostic session
- page `Copy` must copy the same privacy-safe report as the popup `Copy report`
- controls must work after composer remounts
- do not create a second diagnostic state machine; reuse existing messaging/session APIs
- keep overlay compact
- if an overlay control is unavailable, do not render a dead button

Add a focused synthetic test that clicks both page controls and asserts the same underlying stop/copy behavior as the popup path.

## Toggles

Keep independent toggles:

- Long-thread optimization
- Stale clear recovery
- Connector continuity
- Send residual recovery

`Enabled` remains the master switch.

## Version

Current local candidate is still uncommitted `0.1.6`.

Keep formal version `0.1.6`.

Use build label `connector-mention-lifecycle.2` for the next real-site candidate.

## Tests

During iteration, run only focused connector/send/overlay tests.

Before the next real-site candidate, run at most one final Tier 2 gate if runtime DOM/lifecycle code materially changed:

- `npm test`
- `npm run test:e2e`

Then:

- `npm run build`
- `npm run test:build`

Do not run stress unless AGENTS.md Tier 3 criteria are actually met.

## Stop point

Do not commit or push the runtime candidate yet.

Only ask the user for one real-site acceptance after all focused tests pass.

The user must not be asked to use DevTools, paste JS into Console, or inspect DOM manually.

Real acceptance should use built-in `Run composer check` and `Copy report` only.