# Task: Fix connector send residual recovery without requiring observed composer clear

## Evidence from real acceptance (`0.1.6`, `connector-mention-lifecycle.2`)

The latest real report is now sufficient to isolate the remaining failure.

What is working:

- `mentionSignalObserved=true`
- `connectorLifecycleDetected=true`
- `connectorLifecycleLatched=true`
- send intent captured with `preSendLength=36`
- pre-send fingerprint captured
- user turn commit observed and latched
- commit latch survives mounted turn count `+1 -> -1`
- diagnostics classify `SEND_STALE_PAYLOAD_REAPPEARED`
- diagnostics observe `staleFingerprintMatched=true`

What is still failing:

- final composer remains non-empty: `finalTextLength=36`
- `sendResidualRecoveryArmed=true`
- but runtime recovery stays at `attemptCount=0`
- runtime reports `skippedReason="waiting_for_composer_clear"`
- recovery generation reaches hard cap without acting

This means the runtime is still requiring an explicit observed `composer == empty` transition before allowing residual recovery.

The real connector send path does not guarantee that an empty composer is observable. A valid sequence can be:

`pre-send payload -> user turn committed -> composer unmount -> remount with partial stale payload -> settle to exact pre-send fingerprint`

No stable/observable zero state is required.

## Required runtime change

For send residual recovery, treat either of the following as sufficient post-send invalidation evidence:

1. existing observed composer-clear path; OR
2. `userTurnCommittedLatched=true` + at least one post-send native composer unmount/remount + exact pre-send fingerprint reappears + no new trusted user input.

When case 2 occurs, exact pre-send fingerprint match is enough to identify stale send residual even if no zero state was observed.

Do not weaken safety rules:

- exact fingerprint match only;
- new trusted typing/paste/composition cancels the generation immediately;
- different payload is preserved;
- attempts remain bounded;
- hard lifetime remains bounded;
- feature toggle OFF remains inert;
- master Enabled OFF remains inert;
- no React/private-state patching.

The runtime should wait for a short settle window if a remount initially contains only a partial payload, then act only if the complete pre-send fingerprint matches.

## Connector continuity remains unresolved

The same report shows:

- connector lifecycle detected and latched;
- composer unmounted/remounted;
- max missing duration ~1.8 s;
- `connectorContinuity.activated=false`.

Therefore the visual continuity feature still does not activate on the real page.

Fix this separately from send recovery. Once connector lifecycle is latched and the real composer becomes missing, the non-interactive shell should activate until the real composer remounts or the hard cap expires.

Add explicit diagnostics for why a real missing-composer interval did or did not activate the shell. `skippedReason=null` is not sufficient when activation is false.

## Diagnostics event-buffer problem

The latest report hit `eventLimit=180`. Repetitive `turn_optimization_update` / `scan` / `status_update` events evicted the earlier reliability timeline from the event list.

Do not increase the event limit blindly.

Instead, protect high-value reliability events by one of these bounded approaches:

- coalesce repeated optimizer events;
- rate-limit identical optimizer callbacks;
- reserve capacity for composer/send/connector/recovery events;
- or maintain separate bounded low-priority and high-priority buffers.

The report must retain enough causal events for:

- connector detection/latch;
- send intent;
- user turn commit;
- composer unmount/remount;
- stale fingerprint match;
- recovery attempt/success/failure;
- connector continuity activation/cleanup.

## Focused regression fixture

Add a deterministic fixture matching the real path:

1. connector lifecycle latched;
2. pre-send payload length 36 and fingerprint captured;
3. send intent;
4. user turn commit latched;
5. mounted turn count later drops again (commit remains latched);
6. composer unmounts before any observed zero;
7. composer remounts with a partial stale payload;
8. payload settles to exact pre-send fingerprint;
9. send residual recovery attempts;
10. final composer becomes empty and remains empty.

Assertions:

- `attemptCount >= 1`;
- `succeeded=true`;
- final text length 0;
- no dependency on observed zero;
- nonmatching payload preserved;
- new trusted input cancels;
- retries bounded.

Also add a focused real-shape connector-continuity fixture where the composer is missing ~1 second and the continuity shell must activate.

## Version / build

Keep runtime version `0.1.6` because the candidate is still uncommitted.

Use build label:

`connector-mention-lifecycle.3`

Do not bump to `0.1.7`.

## Test policy

During iteration run focused tests only.

After focused connector/send/overlay/continuity fixtures all pass, run one final Tier 2 gate only:

- `npm test`
- `npm run test:e2e`
- `npm run build`
- `npm run test:build`

Stress: not indicated.

Do not commit or push runtime changes before final real acceptance.

Do not ask the user to retest until the full no-clear-anchor residual fixture and connector-continuity fixture pass locally.