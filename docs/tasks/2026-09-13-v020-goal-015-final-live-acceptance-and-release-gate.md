# Goal 015 — One short live acceptance, then cut the 0.2.0 release candidate

Status: **NEXT / BLOCKING 0.2.0 RELEASE**

Branch: `codex/v020-convergence-pushable`

Starting point: `11ea943 Materialize real Atlas contract pack` (`v020-convergence.rc7`).

## Why this goal exists

Goal 014 converted the long authenticated Round 1–6 run into a sanitized replayable contract pack. From this point onward, the user must not be asked to repeat long exploratory QA. The final live run is only a **compatibility and low-overhead smoke gate** against the current authenticated ChatGPT UI.

The committed feature matrix intentionally distinguishes real live exercise from local replay. For example, long-thread optimization and Mica Markdown Copy were not accepted as live-exercised features merely because replay passed. Do not rewrite that history. A replay PASS and a live smoke PASS are different evidence types.

## P0 — Build an acceptance harness before asking the user to do anything

Add a command such as:

```text
npm run atlas:final-acceptance -- --thread-url=<full-url> --user-data-dir=<edge-user-data-dir>
```

The harness may reuse the existing read-only CDP companion, but it must not automate Send, Enter, connector selection, upload, auth, Retry/Regenerate, or account/conversation mutation.

The harness must:

1. attach to exactly one full thread URL using the existing DevToolsActivePort path;
2. print the existing `REAL_EDGE_CDP_ATTACHED = YES` / `SAFE_TO_START_ATLAS = YES` handshake;
3. wait for the user to manually Start/Stop Atlas;
4. after Stop, automatically sanitize/validate the short capture;
5. compare the live surface/lifecycle evidence against `tests/contracts/chatgpt-live/real-2026-09-13/`;
6. emit one concise machine-readable final-acceptance JSON instead of making the user manually inspect files;
7. keep raw acceptance artifacts local/gitignored;
8. optionally emit a privacy-safe sanitized acceptance report suitable for committing.

## P0 — No-invalid-acceptance rules

Do not collapse evidence classes.

Keep the existing `feature-matrix.json` semantics:

- `EXERCISED_AND_PASS`
- `EXERCISED_AND_FAIL`
- `OBSERVED_NATIVE_ONLY`
- `NOT_EXERCISED`

Create a separate release gate, e.g. `final-acceptance-report.json` / `release-readiness.json`, with explicit evidence fields such as:

- `realDerivedReplay`
- `liveCompatibilitySmoke`
- `liveFeatureInvocation`
- `failureConditionExercised`
- `releaseDecision`

Examples:

- long-thread optimization may be release-accepted by real-derived replay + live native-safe compatibility even if the live short run does not force old-turn containment;
- send residual recovery must not become `EXERCISED_AND_PASS` unless its actual failure condition occurs live; deterministic replay may still support release readiness;
- connector continuity live smoke should prove enabling it does not break the real connector flow, not claim the recovery path fired unless instrumentation says it did;
- Mica Copy should have one real Mica Copy invocation in the short run; serializer correctness remains covered by the rich-Markdown real-derived replay.

## P0 — Automated gates before user involvement

Before asking the user for the final live smoke, Codex must run and report:

- `npm run test:atlas`
- `npm test`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:e2e:stress`
- real contract-pack replay/privacy test
- build validation

If these do not pass, fix locally first. Do not consume the user's one final acceptance run on a known-bad candidate.

If Goal 015 changes only scripts/tests/docs, keep:

- `VERSION = 0.2.0`
- `BUILD_LABEL = v020-convergence.rc7`

If product/runtime code changes are required, bump to `v020-convergence.rc8`, rerun full E2E/stress, and state exactly why.

## The one short authenticated acceptance

Target duration: **60–90 seconds**.

Before starting, the loaded extension must be the current candidate and the following product features must be enabled in Mica:

- Mica enabled
- long-thread optimization enabled
- Mica Markdown Copy enabled
- composer recovery enabled
- connector continuity enabled
- send residual recovery enabled
- auto-dismiss known interruptions enabled

If the current real thread remains on ChatGPT native virtualization, that is acceptable; do not artificially make the user generate a huge conversation just to force Mica containment.

### User actions

After the harness prints `SAFE_TO_START_ATLAS = YES`:

1. Mica → Advanced → `Start Atlas`.
2. Type a short draft containing both English and Chinese; make one small edit/backspace so real composer input remains covered.
3. Manually type `@GitHub` and manually select the GitHub connector.
4. Manually send exactly one short read-only request:

   `@GitHub 仅做只读检查：读取 YuukiAS/Mica-for-ChatGPT 仓库 README.md 第一行，并用一句中文告诉我这一行是什么。禁止任何写操作。`

5. Wait for the assistant response to settle and action bar to appear.
6. Click **Mica Copy** once on that assistant response (not native Copy). Do not paste the clipboard back into ChatGPT.
7. Mica → Advanced → `Stop Atlas`.
8. Let the harness finish automatically; do not Ctrl+C.

The user only needs to report three subjective observations:

```text
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL
```

No screenshots or ZIP upload should be required if the harness completes successfully.

## P0 — Final live gates

The harness must verify at minimum:

### Safety / termination

- exact thread target attached;
- `terminationReason = atlas_stopped`;
- `truncated = false`;
- no `capture_error`;
- automated Send/Enter/upload/connector action all false.

### Atlas overhead

- `maxConcurrentHeavyCapture = 1`;
- total heavy captures remain sparse for the 60–90 second smoke (target `<= 12`; explain any higher count rather than silently accepting it);
- 10-second rolling heavy-capture peak `<= 8`;
- no return of the old white/collapsed screenshot pattern;
- no semantic-surface resolver regression.

### Live contract compatibility

Required current-live evidence:

- valid composer surface;
- mention chooser observed/resolved;
- connector pill observed/resolved;
- one user turn for the manual send;
- one current assistant generation, with first-content/settled lifecycle ownership sane;
- assistant action bar/current assistant ownership sane;
- Mica Copy invocation observed and distinguishable from native Copy;
- Mica overlay/Atlas state sane;
- no old assistant remount promoted to the current generation.

### Product-feature smoke

Record whether each feature was enabled and whether it actually fired. Do not infer firing merely from successful native behavior.

At minimum record:

- long-thread optimization: enabled; runtime result may be `native-safe/no-op` or actual containment;
- Mica Markdown Copy: enabled + one live invocation;
- composer recovery: enabled; record trigger/no-trigger;
- connector continuity: enabled; record trigger/no-trigger;
- send residual recovery: enabled; record trigger/no-trigger;
- auto-dismiss: enabled; record trigger/no-trigger.

## P1 — Release-readiness synthesis

After a passing short live run, combine evidence from:

1. committed real-derived contract replay;
2. current short authenticated live compatibility smoke;
3. deterministic failure-condition fixture tests;
4. full E2E/stress tests.

Produce a concise `release-readiness.json` or Markdown report stating, for each feature:

- evidence source(s);
- live status;
- replay status;
- whether the actual recovery condition was exercised;
- final release decision.

Do not alter the historical Goal-014 feature matrix just to make every row green.

## P1 — Release cut after acceptance

Only after all final gates pass:

1. run `npm run package:release`;
2. run final build/release validation;
3. record candidate commit SHA, ZIP path and SHA-256;
4. ensure raw Atlas artifacts remain untracked/uncommitted;
5. prepare a PR from `codex/v020-convergence-pushable` to `main` summarizing:
   - 0.2 convergence;
   - real Atlas contract pack;
   - final short live acceptance;
   - tests/E2E/stress;
   - remaining explicitly deferred items, if any.

Do **not** merge to `main`, tag, or publish the release unless the user explicitly asks after reviewing the final readiness report.

## Completion report before the user runs the short acceptance

```text
FINAL_ACCEPTANCE_HARNESS = PASS/FAIL
CONTRACT_COMPARE = PASS/FAIL
FEATURE_EVIDENCE_MODEL = PASS/FAIL
ATLAS_TEST =
FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
STRESS_E2E =
BUILD_VALIDATION =
VERSION = 0.2.0
BUILD_LABEL =
PUSHED =
READY_FOR_ONE_SHORT_LIVE_ACCEPTANCE = YES/NO
```

## Completion report after the short acceptance

```text
FINAL_LIVE_ACCEPTANCE = PASS/FAIL
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL

LIVE_CONTRACT_COMPATIBILITY = PASS/FAIL
COMPOSER_LIVE = PASS/FAIL
MENTION_CHOOSER_LIVE = PASS/FAIL
CONNECTOR_PILL_LIVE = PASS/FAIL
ASSISTANT_GENERATION_LIVE = PASS/FAIL
MICA_COPY_LIVE_INVOCATION = PASS/FAIL

MAX_CONCURRENT_HEAVY_CAPTURE =
HEAVY_CAPTURE_COUNT =
HEAVY_CAPTURE_PER_10S_PEAK =
WHITE_OR_COLLAPSED_CAPTURE = YES/NO

LONG_THREAD_RUNTIME_STATE =
COMPOSER_RECOVERY_TRIGGERED = YES/NO
CONNECTOR_CONTINUITY_TRIGGERED = YES/NO
SEND_RESIDUAL_TRIGGERED = YES/NO
AUTO_DISMISS_TRIGGERED = YES/NO

RELEASE_READINESS = PASS/FAIL
PACKAGE_RELEASE = PASS/FAIL/NOT_RUN
RELEASE_ZIP =
RELEASE_SHA256 =
READY_FOR_PR_TO_MAIN = YES/NO
```

## Principle

The final live run is not another exploration campaign. Its purpose is only to confirm that **today's authenticated ChatGPT still matches the real-derived contract pack and that the instrumented candidate is stable in a real connector flow**. All repeatable behavior verification should stay in the repo and run automatically.