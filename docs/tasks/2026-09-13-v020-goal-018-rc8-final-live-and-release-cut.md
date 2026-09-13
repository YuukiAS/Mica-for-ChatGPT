# Goal 018 — Validate rc8 live fixes, then cut the 0.2.0 candidate

Status: **NEXT / BLOCKING 0.2.0 RELEASE**

Branch: `codex/v020-convergence-pushable`

Starting point: `815050e Fix live acceptance copy and connector residual` (`v020-convergence.rc8`).

## Why this goal exists

The first short event-only live acceptance found two actual product defects, not Atlas defects:

1. `Mica Copy` was not visible on the native-safe short-thread path because Markdown Copy sync only ran on the full-scan path.
2. After a connector-backed send, the committed payload could remain in the same composer without a clear/remount, while send-residual recovery only accepted clear/remount as recovery evidence.

`815050e` fixes both issues and adds regressions. The previous live connector stability result must remain classified as **FAIL**; do not rewrite history.

This goal is intentionally narrow. Do not expand Atlas, do not repeat Round 1–6, and do not redesign the extension.

## P0 — Automated gates before consuming the user's retry

Because rc8 changes extension runtime code, run all of the following before asking for another live acceptance:

- focused Mica Copy native-safe regression
- focused connector residual persistent-payload regression
- `npm run test:atlas`
- `npm test`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:e2e:stress`
- `npm run test:build`
- real contract-pack replay/privacy test
- event-only final-acceptance harness test proving:
  - `DOMSnapshot.captureSnapshot = 0`
  - `Page.captureScreenshot = 0`
  - `heavyCaptureCount = 0`

Do not ask the user to retry until every gate passes.

## P0 — Prepare the rc8 extension correctly

The user must be testing the runtime fix itself, not an old loaded extension.

Before the live retry:

1. `git pull --ff-only origin codex/v020-convergence-pushable`
2. `npm run build`
3. reload the unpacked extension from `dist/mica-dev`
4. refresh the ChatGPT acceptance thread
5. verify popup shows:
   - `v0.2.0`
   - `v020-convergence.rc8`

## P0 — One short event-only live retry

Use only:

```powershell
npm run atlas:final-acceptance -- --thread-url="$threadUrl" --user-data-dir="$edgeUserData" --capture-mode=event-only
```

After `REAL_EDGE_CDP_ATTACHED = YES` and `SAFE_TO_START_ATLAS = YES`, the user manually:

1. starts Atlas;
2. types a short English + Chinese draft and makes one edit;
3. types `@GitHub` and manually selects GitHub;
4. manually sends exactly one short read-only request:

   `@GitHub 仅做只读检查：读取 YuukiAS/Mica-for-ChatGPT 仓库 README.md 第一行，并用一句中文告诉我这一行是什么。禁止任何写操作。`

5. waits for the assistant response to settle;
6. verifies the old sent payload is **not** left in the composer;
7. verifies `Mica Copy` is visible on the current assistant response;
8. clicks `Mica Copy` exactly once;
9. stops Atlas and lets the harness finish.

The user reports only:

```text
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL
MICA_COPY_VISIBLE = YES/NO
CONNECTOR_RESIDUAL_AFTER_SEND = YES/NO
```

Interpretation:

- `LIVE_CONNECTOR_STABILITY = PASS` requires both normal connector selection/execution **and** no stale submitted payload left in the composer.
- `MICA_COPY_VISIBLE = YES` is required.
- `CONNECTOR_RESIDUAL_AFTER_SEND = NO` is required.

No ZIP/screenshots should be requested if the harness finishes normally.

## P0 — Final live gates

The event-only report must show:

- exact target attached;
- `terminationReason = atlas_stopped`;
- `truncated = false`;
- no capture error;
- automated Send/Enter/upload/connector action all false;
- `EVENT_ONLY_DOMSNAPSHOT_COUNT = 0`;
- `EVENT_ONLY_SCREENSHOT_COUNT = 0`;
- `EVENT_ONLY_HEAVY_CAPTURE_COUNT = 0`;
- composer lifecycle compatible with committed real contracts;
- mention chooser episode observed;
- connector pill episode observed;
- exactly one manual user-send generation for the request;
- current assistant generation ownership sane;
- one live Mica Copy invocation observed;
- send-residual recovery reports either successful real recovery or clean no-residual state, never persistent stale payload.

## P1 — Release readiness and packaging

If and only if the retry passes:

1. synthesize `release-readiness.json` from:
   - committed real-derived contract replay;
   - deterministic recovery failure-condition tests;
   - full E2E + stress;
   - current rc8 event-only live smoke;
2. preserve historical evidence classes; do not rewrite prior native-only/not-exercised entries into fake live PASS;
3. run `npm run package:release`;
4. validate the release ZIP;
5. record candidate commit SHA, ZIP path, and SHA-256;
6. confirm raw Atlas artifacts remain untracked/uncommitted;
7. create a PR from `codex/v020-convergence-pushable` to `main` summarizing the 0.2.0 convergence and the two rc8 live fixes.

Do **not** merge, tag, or publish without explicit user approval.

## If the live retry fails

Do not return to visual Atlas work.

Classify the failure as a specific product-runtime defect and fix only that defect. The next user retry must remain short and event-only.

## Completion report before user retry

```text
RC8_RUNTIME = PASS/FAIL
MICA_COPY_NATIVE_SAFE_REGRESSION = PASS/FAIL
PERSISTENT_CONNECTOR_RESIDUAL_REGRESSION = PASS/FAIL
EVENT_ONLY_FINAL_ACCEPTANCE_TEST = PASS/FAIL
EVENT_ONLY_DOMSNAPSHOT_COUNT = 0/other
EVENT_ONLY_SCREENSHOT_COUNT = 0/other
EVENT_ONLY_HEAVY_CAPTURE_COUNT = 0/other
ATLAS_TEST =
FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
STRESS_E2E =
BUILD_VALIDATION =
CONTRACT_REPLAY =
VERSION = 0.2.0
BUILD_LABEL = v020-convergence.rc8
PUSHED =
READY_FOR_RC8_SHORT_LIVE_RETRY = YES/NO
```

## Completion report after user retry

```text
FINAL_LIVE_ACCEPTANCE = PASS/FAIL
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL
MICA_COPY_VISIBLE = YES/NO
CONNECTOR_RESIDUAL_AFTER_SEND = YES/NO
MICA_COPY_LIVE_INVOCATION = PASS/FAIL
SEND_RESIDUAL_LIVE_RESULT = PASS/FAIL
EVENT_ONLY_DOMSNAPSHOT_COUNT = 0/other
EVENT_ONLY_SCREENSHOT_COUNT = 0/other
EVENT_ONLY_HEAVY_CAPTURE_COUNT = 0/other
RELEASE_READINESS = PASS/FAIL
PACKAGE_RELEASE = PASS/FAIL/NOT_RUN
RELEASE_ZIP =
RELEASE_SHA256 =
READY_FOR_PR_TO_MAIN = YES/NO
```

## Principle

The rc8 retry exists to validate the **two real product defects discovered by the first live smoke**. If those are fixed and the event-only smoke is stable, stop iterating and cut the 0.2.0 candidate.