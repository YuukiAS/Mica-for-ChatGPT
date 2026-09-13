# Goal 017 — Product-first 0.2 closure

Status: **FINAL 0.2.0 CLOSURE GATE**

Branch: `codex/v020-convergence-pushable`

Starting point: `4cf66bc Decouple final Atlas acceptance from visual capture` (`v020-convergence.rc7`).

## Purpose

Stop expanding Atlas as a project of its own. Atlas has already fulfilled its primary role for 0.2.0: the authenticated Round 1–6 run produced durable, sanitized UI/DOM/lifecycle ground truth at:

`tests/contracts/chatgpt-live/real-2026-09-13/`

That pack now contains the current ChatGPT surface/lifecycle knowledge required for local replay, including composer, assistant generation, mention chooser, connector pill, long-thread window, rich Markdown, selectors, lifecycle, timings, and feature evidence.

From this point, engineering time is spent on **Mica product completion and release**, not further visual-Atlas refinement unless a concrete future ChatGPT UI drift requires new ground truth.

## What is considered understood for 0.2.0

The current real-derived contract pack is the canonical ground truth for the current ChatGPT UI generation. It is sufficient for 0.2.0 implementation and regression work.

Do not claim it is permanent knowledge of all future ChatGPT UI versions. If future contract drift is detected, run a targeted Atlas ground-truth acquisition then; do not repeat long manual QA by default.

The historical Goal-014 feature matrix remains truthful: some recovery features were replay-validated rather than live failure-triggered. Release readiness may combine real-derived replay, deterministic failure-condition fixtures, E2E/stress, and one live event-only smoke without rewriting that history.

## P0 — One final live event-only product smoke

Use only:

`npm run atlas:final-acceptance -- --thread-url=<full-thread-url> --user-data-dir=<edge-user-data-dir> --capture-mode=event-only`

Required during the interactive window:

- `DOMSnapshot.captureSnapshot = 0`
- `Page.captureScreenshot = 0`
- heavy visual capture = 0
- no automated Send / Enter / upload / connector action

All product features should be enabled before the run:

- Mica enabled
- long-thread optimization enabled
- Mica Markdown Copy enabled
- composer recovery enabled
- connector continuity enabled
- send residual recovery enabled
- auto-dismiss known interruptions enabled

User actions are only:

1. Start Atlas recorder.
2. Type a short English + Chinese draft and make one small edit.
3. Manually type `@GitHub` and select GitHub.
4. Manually send one short read-only request:

   `@GitHub 仅做只读检查：读取 YuukiAS/Mica-for-ChatGPT 仓库 README.md 第一行，并用一句中文告诉我这一行是什么。禁止任何写操作。`

5. Wait for the response to settle.
6. Click **Mica Copy** once on the current assistant response.
7. Stop Atlas.
8. Let the harness finish automatically.

User reports only:

- `LIVE_VISUAL_STABILITY = PASS/FAIL`
- `LIVE_TYPING_SMOOTHNESS = PASS/FAIL`
- `LIVE_CONNECTOR_STABILITY = PASS/FAIL`

No ZIP or screenshot upload is required when the harness completes.

## P0 — Interpretation

### If the event-only smoke is stable

Treat the previous live instability as visual-CDP measurement interference. Do not spend another cycle tuning Atlas visual capture for 0.2.0.

Immediately synthesize final release readiness from:

1. committed real-derived contract pack;
2. event-only live compatibility smoke;
3. deterministic recovery/feature replay tests;
4. full E2E;
5. stress E2E.

Then proceed to release packaging and PR preparation.

### If the event-only smoke is still unstable

Investigate **Mica product/runtime behavior**, not Atlas visual capture.

Prioritize, in order:

1. in-page Atlas recorder overhead while recording;
2. connector-continuity runtime hot path;
3. composer recovery / send-residual interaction;
4. long-thread optimization interaction with native virtualization;
5. ChatGPT-native instability independent of Mica.

Use the event-only report/timeline first. Request one focused extra artifact only if it is necessary to distinguish a concrete product bug. Do not reopen broad Round 1–6 manual QA.

If runtime code must be changed, bump `BUILD_LABEL` to `v020-convergence.rc8`, rerun full E2E/stress, and repeat only the same short event-only smoke.

## P0 — Release cut after PASS

After final event-only acceptance passes:

1. create/update `release-readiness.json` or equivalent final report;
2. run all final automated gates;
3. run `npm run package:release`;
4. validate release ZIP;
5. record candidate commit SHA, ZIP path, ZIP SHA-256;
6. confirm raw Atlas artifacts remain untracked/uncommitted;
7. prepare a PR from `codex/v020-convergence-pushable` to `main`.

The PR should summarize:

- 0.2.0 product changes;
- long-thread/render behavior;
- Markdown/LaTeX Copy;
- composer / connector / send reliability;
- real ChatGPT contract pack and replay architecture;
- final event-only live acceptance;
- full E2E/stress results;
- any explicit deferred items.

Do **not** merge, tag, or publish without explicit user approval.

## Scope guard

For the remainder of 0.2.0:

- do not add new Atlas visual features;
- do not repeat full Round 1–6;
- do not require more visual ground-truth work unless current contracts demonstrably fail to represent a concrete live UI state;
- do not treat test-harness polish as a release blocker unless it affects product correctness or the one final acceptance;
- prefer shipping a well-tested 0.2.0 over further instrumentation refinement.

## Completion report after final live smoke

```text
FINAL_LIVE_ACCEPTANCE = PASS/FAIL
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL

EVENT_ONLY_DOMSNAPSHOT_COUNT = 0
EVENT_ONLY_SCREENSHOT_COUNT = 0
LIVE_CONTRACT_LIFECYCLE_COMPATIBILITY = PASS/FAIL
MICA_COPY_LIVE_INVOCATION = PASS/FAIL
LONG_THREAD_RUNTIME_STATE =
COMPOSER_RECOVERY_TRIGGERED = YES/NO
CONNECTOR_CONTINUITY_TRIGGERED = YES/NO
SEND_RESIDUAL_TRIGGERED = YES/NO
AUTO_DISMISS_TRIGGERED = YES/NO

MEASUREMENT_INTERFERENCE_DIAGNOSIS = VISUAL_CDP / IN_PAGE_RECORDER / PRODUCT_RUNTIME / INCONCLUSIVE
RELEASE_READINESS = PASS/FAIL
VERSION = 0.2.0
BUILD_LABEL =
PACKAGE_RELEASE = PASS/FAIL/NOT_RUN
RELEASE_ZIP =
RELEASE_SHA256 =
RAW_ATLAS_ARTIFACT_COMMITTED = NO
READY_FOR_PR_TO_MAIN = YES/NO
```

## Success criterion

0.2.0 is done when Mica itself is stable in the short authenticated flow, the committed real contracts + deterministic tests cover repeatable behavior, full E2E/stress pass, and a validated release ZIP/PR is ready for user review.

Atlas is not the product. It is now infrastructure for occasional future UI drift acquisition.