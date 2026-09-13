# Goal 016 — Decouple Atlas ground-truth capture from product acceptance

Status: **NEXT / BLOCKING 0.2.0 FINAL ACCEPTANCE**

Branch: `codex/v020-convergence-pushable`

Starting point: `3e4254e Add final Atlas acceptance harness` (`v020-convergence.rc7`).

## Context

The Live Surface Atlas has already achieved its primary purpose: the 2026-09-13 authenticated Round 1–6 run was converted into a sanitized committed real contract pack at:

`tests/contracts/chatgpt-live/real-2026-09-13/`

That pack now preserves UI/lifecycle knowledge for local replay and future regression testing. Atlas must not become a permanent source of product instability or consume disproportionate engineering effort.

A subsequent short real run using `npm run atlas:capture` produced only 7 heavy visual captures (37 checkpoints total, max concurrent heavy capture = 1) but the user still observed noticeable page instability. This is sufficient evidence that even sparse live `DOMSnapshot.captureSnapshot` + `Page.captureScreenshot` can perturb the authenticated ChatGPT page on this environment.

Do not ask the user to upload this short raw artifact unless a concrete unresolved product bug later requires it. Keep it local/gitignored:

`artifacts/live-atlas/capture-1789282148024`

Also note: the user ran the generic `atlas:capture`, not the new `atlas:final-acceptance` harness. That explains why no automatic final comparison/report was produced, but it does not invalidate the instability observation.

## Product principle

Atlas is a **ground-truth acquisition/debugging tool**, not the product under test.

From this point:

- committed real contracts are the default UI/DOM/lifecycle ground truth;
- heavy live visual capture is developer-only and optional;
- final product acceptance must not require `DOMSnapshot` or screenshots during the interactive connector flow;
- the release decision must primarily test Mica itself, not Mica while a disruptive measurement tool is running.

Do not spend another iteration trying to make live screenshot capture perfectly invisible before releasing 0.2.0.

## P0 — Add EVENT_ONLY final acceptance mode

Extend `atlas:final-acceptance` with a canonical event-only live mode, for example:

`--capture-mode=event-only`

In this mode:

1. Keep the exact-target DevToolsActivePort attach and read-only safety model.
2. Keep `Runtime.enable`, `Log.enable`, and lightweight recorder/report ingestion needed to receive `MICA_ATLAS_CHECKPOINT` and report chunks.
3. `Performance.getMetrics` may be used sparingly if needed.
4. During the user interaction window, send **zero**:
   - `DOMSnapshot.captureSnapshot`
   - `Page.captureScreenshot`
5. Do not require live screenshots or live CDP structural contracts for PASS.
6. Compare lifecycle/state evidence against the committed real contract pack instead.
7. Use recorder semantic markers for:
   - composer lifecycle
   - mention chooser episode
   - connector pill episode
   - user send
   - current assistant generation / first content / settled
   - action bar ownership
   - Mica Copy invocation
   - Mica overlay / Atlas state
8. Produce the same concise final-acceptance and release-readiness JSON.

Expected acceptance telemetry in event-only mode:

- `heavyCaptureCount = 0`
- `DOMSnapshot.captureSnapshot = 0`
- `Page.captureScreenshot = 0`
- exact target attached
- lifecycle/report ingestion complete
- raw artifacts remain local/gitignored

## P0 — Do not regress the visual Atlas tool

Keep the existing visual capture path available for future UI drift acquisition and diagnostics.

It is allowed to remain a developer-only mode with known potential page perturbation. Document that it is not the canonical product acceptance mode.

Do not remove:

- semantic surface resolver
- screenshot coordinate fixes
- sparse capture policy
- materializer
- real contract pack
- visual capture tests

## P0 — Final product smoke must exercise Mica, not Atlas

Before the user's one final short run, confirm the extension/runtime candidate has these enabled:

- Mica enabled
- long-thread optimization enabled
- Mica Markdown Copy enabled
- composer recovery enabled
- connector continuity enabled
- send residual recovery enabled
- auto-dismiss known interruptions enabled

The final 60–90 second live run should use **event-only acceptance**.

User actions remain:

1. Start Atlas recorder from Mica (event recording only; no live visual CDP capture).
2. Type a short English + Chinese draft and make one small edit.
3. Manually type `@GitHub` and manually select GitHub.
4. Manually send one short read-only request:

   `@GitHub 仅做只读检查：读取 YuukiAS/Mica-for-ChatGPT 仓库 README.md 第一行，并用一句中文告诉我这一行是什么。禁止任何写操作。`

5. Wait for the answer to settle.
6. Click **Mica Copy** once on the current assistant response.
7. Stop Atlas.
8. Let the event-only harness finish.

The user only reports:

```text
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL
```

No ZIP or screenshots should be requested when the event-only harness completes.

## P0 — Interpretation of the next result

If event-only live acceptance is stable:

- classify the previous instability as measurement-tool interference;
- do not block 0.2.0 on further Atlas visual optimization;
- synthesize release readiness from committed contracts + deterministic feature replays + live event-only smoke + E2E/stress.

If event-only live acceptance is still unstable:

- then investigate the actual Mica runtime / in-page Atlas recorder / ChatGPT interaction;
- do not assume CDP screenshots are the cause;
- only then request one focused artifact/log if a concrete issue needs it.

## P1 — Preserve evidence-class discipline

Do not rewrite Goal-014 historical `feature-matrix.json`.

The final release readiness must distinguish:

- real-derived replay
- current live event-only compatibility smoke
- live feature invocation
- failure-condition replay
- release decision

A recovery feature can be release-ready via deterministic failure-condition replay without falsely claiming that its rare failure condition fired live.

## P1 — Automated gates

Before asking the user to run event-only acceptance, run:

- `npm run test:atlas`
- `npm test`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:e2e:stress`
- real contract-pack replay/privacy test
- build validation
- focused event-only final-acceptance test proving no DOMSnapshot/screenshot commands are sent

If only scripts/tests/docs change:

- `VERSION = 0.2.0`
- `BUILD_LABEL = v020-convergence.rc7`

If extension runtime must change, bump to rc8 and explain why.

## Completion report before user involvement

```text
EVENT_ONLY_FINAL_ACCEPTANCE = PASS/FAIL
EVENT_ONLY_DOMSNAPSHOT_COUNT =
EVENT_ONLY_SCREENSHOT_COUNT =
EVENT_ONLY_HEAVY_CAPTURE_COUNT =
CONTRACT_COMPARE = PASS/FAIL
LIFECYCLE_EVIDENCE_MODEL = PASS/FAIL
FEATURE_EVIDENCE_MODEL = PASS/FAIL
ATLAS_VISUAL_MODE_PRESERVED = PASS/FAIL
ATLAS_TEST =
FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
STRESS_E2E =
BUILD_VALIDATION =
VERSION = 0.2.0
BUILD_LABEL =
PUSHED =
READY_FOR_ONE_SHORT_EVENT_ONLY_LIVE_ACCEPTANCE = YES/NO
```

## Completion report after user live run

```text
FINAL_LIVE_ACCEPTANCE = PASS/FAIL
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL

EVENT_ONLY_DOMSNAPSHOT_COUNT = 0
EVENT_ONLY_SCREENSHOT_COUNT = 0
LIVE_CONTRACT_LIFECYCLE_COMPATIBILITY = PASS/FAIL
COMPOSER_LIVE = PASS/FAIL
MENTION_CHOOSER_LIVE = PASS/FAIL
CONNECTOR_PILL_LIVE = PASS/FAIL
ASSISTANT_GENERATION_LIVE = PASS/FAIL
MICA_COPY_LIVE_INVOCATION = PASS/FAIL

LONG_THREAD_RUNTIME_STATE =
COMPOSER_RECOVERY_TRIGGERED = YES/NO
CONNECTOR_CONTINUITY_TRIGGERED = YES/NO
SEND_RESIDUAL_TRIGGERED = YES/NO
AUTO_DISMISS_TRIGGERED = YES/NO

MEASUREMENT_INTERFERENCE_DIAGNOSIS = VISUAL_CDP / IN_PAGE_RECORDER / PRODUCT_RUNTIME / INCONCLUSIVE
RELEASE_READINESS = PASS/FAIL
READY_FOR_PR_TO_MAIN = YES/NO
```

## Principle

The success criterion is no longer “make Atlas visual capture perfectly invisible.”

The success criterion is:

**Atlas has already taught the repo what the real ChatGPT UI/lifecycle looks like; now final acceptance should validate Mica itself with the lightest possible live instrumentation.**
