# Goal 023 — Live failure forensics, faithful fixtures, and patch-version reset

Status: **BLOCKING — DO NOT ASK USER TO RETRY YET**

Branch: `codex/v020-convergence-pushable`

Starting point: `2090bb6 Fix connector send remount race` plus Goal 022 task commit.

## Why this goal exists

The rc11 ordinary live retry still failed in the same two user-visible areas:

1. A long GitHub-connector request successfully committed as a real user turn, but the already-submitted long payload remained in the composer after the composer disappeared/remounted.
2. The new Mica Copy icon was not placed in the native action cluster; in the real page it appeared detached at the far right of the assistant region.

This means our current deterministic fixtures are still not faithful enough to the real authenticated ChatGPT page. Repeating another user retry before improving the ground truth would be wasteful.

The goal is therefore **not another speculative fix**. First capture the exact currently-failed live shape, turn it into commit-safe fixtures/contracts, make the existing buggy implementation fail those tests, then fix it locally. Only after that may the user be asked for one final normal live retry.

## Hard process rule — max three iterations per real bug

For a concrete live bug:

1. **Acquire / reproduce once** — preserve the real failing shape.
2. **Fix + automated replay** — no user retry until the real-derived fixture fails before and passes after.
3. **One final live confirmation** — normal product usage only.

Do not loop through speculative fix → user retry → speculative fix.

## P0 — Preserve the current failed page before refresh

The current authenticated acceptance thread is already in the failed state: committed long user turn above, stale submitted payload still present in the composer, and a real assistant action bar is mounted.

Use the existing Edge `DevToolsActivePort` read-only path to inspect this page **without asking the user to reproduce anything again**.

Create a one-shot local diagnostic command, for example:

```text
npm run probe:live-failure -- --thread-url=<full-url> --user-data-dir=<edge-user-data-dir>
```

It may use a single bounded `DOMSnapshot.captureSnapshot` / `Page.getLayoutMetrics` because this is a developer ground-truth acquisition step, not product acceptance. No repeated screenshots are required. Prefer zero screenshots unless one tightly-cropped screenshot is necessary for geometry verification.

It must never automate Send, Enter, connector selection, navigation, reload, Retry/Regenerate, upload, auth, or account mutation.

### Capture the following locally

#### A. Assistant action-bar structure

For the current assistant response, record a sanitized structural contract containing:

- owning assistant turn identity (anonymous/stable hint only);
- native Copy button semantic attributes;
- native Copy parent chain up to the real action cluster;
- sibling order and sibling semantic roles within that cluster;
- action-cluster bounding rect;
- native Copy bounding rect;
- whether the cluster uses flex/grid and its alignment/gap relevant to insertion;
- enough sanitized structure to prove where an injected Mica Copy action belongs.

Do not store response text.

The contract must be able to distinguish:

- **PASS**: Mica Copy is a sibling in the native action cluster, immediately adjacent to native Copy;
- **FAIL**: Mica Copy is inserted into a broad row/container and floats to the far right.

#### B. Current stale-composer failure shape

Record a privacy-safe local contract for the already-failed state:

- composer exists / root identity / editable identity;
- composer body length;
- connector pill present/absent;
- latest committed user-turn exists;
- latest committed user-turn text length;
- local-only hashes/fingerprints proving whether composer body equals the just-committed user-turn payload;
- current mounted user-turn count;
- relevant composer/root remount identity evidence if still available;
- semantic DOM shape of the composer and latest user turn.

Raw text may remain local only if absolutely needed for the probe, but **must never be committed**. Commit only lengths, hashes, anonymous structure, selector invariants, and sanitized fixture data.

If the current page has already changed and the exact failed state is no longer available, do **not** ask the user to redo the flow yet. First use the existing screenshot + prior raw Atlas artifacts + committed contract pack to build the closest deterministic fixture, then state exactly what one missing live fact would be needed.

## P0 — Explain why Goal 014 was insufficient

Update docs so we stop overclaiming the existing real contract pack.

`tests/contracts/chatgpt-live/real-2026-09-13/` is canonical for broad semantic surfaces/lifecycle, but it intentionally materialized/reconstructed some surfaces after rejecting bad CDP captures. It is **not** sufficient evidence for every exact native parent/sibling relationship or every connector-send timing race.

Add a short `GROUND_TRUTH_SCOPE.md` or equivalent stating:

- what the pack can prove;
- what it cannot prove;
- when a targeted live probe is warranted;
- that a targeted probe should enrich the pack, not trigger another broad Round 1–6 campaign.

## P0 — Build faithful failing fixtures before changing runtime

### 1. Action-bar placement fixture

Build a real-derived assistant action-bar fixture from the one-shot probe / existing real contract.

Before changing `markdown-copy.ts`, the current implementation must fail at least one assertion equivalent to:

```text
micaCopy.parentElement === nativeCopy.parentElement
abs(micaCopy.index - nativeCopy.index) === 1
micaCopy is not inside a broad justify-between/full-width wrapper
```

Also verify remount does not duplicate the Mica action.

Do not accept a synthetic fixture that was authored to match the current implementation.

### 2. Long-connector residual fixture

Build a real-derived fixture/state machine matching the failed live shape:

```text
explicit connector send
→ composer unmount/remount
→ user turn visibly committed
→ returned composer still contains the exact committed payload
```

Critically, model the actual committed-user-turn DOM/timing shape found in the live probe instead of only incrementing an abstract `countUserTurns()` fixture counter.

The current `2090bb6` implementation must fail this fixture before the next fix.

Include:

- short / medium / >=2000-char payloads;
- actual long payload equality/fingerprint path;
- delayed commit and remount;
- connector pill removed before/after commit variants;
- user starts new text after commit;
- new input must never be erased;
- no resend/Enter/connector action automation.

## P0 — Only then fix the two product bugs

### A. Mica Copy placement

Do not use generic `closest(..., div)` as the deciding action-cluster resolver when it can select a broad container.

Resolve the real native action cluster from the new ground-truth contract. Prefer semantic parent/sibling invariants over class names. Keep native Copy intact. Mica Copy should look and behave like one sibling action, not a floating detached control.

### B. Long connector residual

Do not tune timeouts first.

Use the live-derived failure fixture to determine whether the remaining bug is:

- committed user-turn detection;
- composer identity selection after remount;
- payload canonicalization/fingerprint mismatch;
- recovery generation lifetime;
- connector lifecycle latch lifetime;
- `execCommand('delete')` failure on the real editor shape;
- or another concrete cause.

The code change must correspond to the proven failing stage.

Add an explicit before/after state-machine assertion showing why the real-derived case now closes.

## P0 — Versioning reset: stop using rc labels

The user must be able to identify the loaded build by the normal extension version.

Starting with the next runtime-changing candidate:

- stop exposing `v020-convergence.rcN` as the user-facing build identifier;
- use semantic patch versions: `0.2.1`, `0.2.2`, `0.2.3`, ...;
- the next runtime candidate produced by this goal is **0.2.1**;
- every subsequent runtime-changing candidate increments the patch version once;
- tests/docs-only commits do not increment it.

Make versioning single-source-of-truth. Prefer deriving manifest `version`, `version_name`, popup version display, package/release basename, and runtime version constant from one canonical version value. Add a validation test that fails on divergence.

The popup should show only the canonical version (e.g. `v0.2.1`) rather than requiring a separate rc/build-label comparison. A commit SHA may remain in diagnostics/release metadata, but not as the normal user-visible version check.

## P0 — Automated gates before any user retry

Do not ask the user to reload/test until all of the following are true:

- real live failure probe/materialization = PASS;
- action-bar real-derived fixture fails on old implementation and passes after fix;
- long connector real-derived fixture fails on old implementation and passes after fix;
- native Copy preserved;
- Mica Copy placement + remount/duplicate tests pass;
- long residual short/medium/long pass;
- new input preservation pass;
- pill-removal continuity pass;
- typing-hotpath pass;
- `npm test` pass;
- `npm run test:integration` pass;
- `npm run test:e2e` pass;
- `npm run test:e2e:stress` pass because connector lifecycle/recovery runtime changes are involved;
- `npm run test:build` pass;
- version consistency validation pass.

The final automated report must include **proof that the old code fails the newly added real-derived tests**, not only that the new code passes.

## No user retry until completion report

Return:

```text
LIVE_FAILURE_STATE_ACQUIRED = PASS/FAIL
ACTIONBAR_GROUND_TRUTH = PASS/FAIL
STALE_COMPOSER_GROUND_TRUTH = PASS/FAIL
GROUND_TRUTH_SCOPE_DOCUMENTED = PASS/FAIL

OLD_CODE_ACTIONBAR_REAL_FIXTURE = EXPECTED_FAIL/PASS_UNEXPECTEDLY
OLD_CODE_LONG_RESIDUAL_REAL_FIXTURE = EXPECTED_FAIL/PASS_UNEXPECTEDLY

MICA_COPY_NATIVE_CLUSTER = PASS/FAIL
MICA_COPY_ADJACENT_TO_NATIVE_COPY = PASS/FAIL
MICA_COPY_REMOUNT_NO_DUPLICATE = PASS/FAIL
LONG_CONNECTOR_REAL_DERIVED_REPLAY = PASS/FAIL
NEW_INPUT_PRESERVED = PASS/FAIL

VERSION_SCHEME = PATCH_SEMVER
VERSION = 0.2.1
VERSION_CONSISTENCY = PASS/FAIL
RC_LABEL_REMOVED = YES/NO

FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
STRESS_E2E =
BUILD_VALIDATION =
PUSHED =

READY_FOR_SINGLE_FINAL_NORMAL_LIVE_CONFIRMATION = YES/NO
```

If either old-code real-derived fixture does not fail, the fixture is not proving the real bug and must be improved **before** modifying runtime again.

## Final live confirmation policy

Only after the above report is fully PASS may the user be asked for one normal, non-Atlas live check. Reuse the exact long connector payload that failed and visually confirm the action-bar placement once.

If that final check still fails, stop and perform root-cause analysis from the new targeted ground-truth evidence; do not immediately ask the user to run another candidate.

## Principle

Atlas/ground-truth tooling exists to reduce user repetition. The workflow must be:

**capture the real shape once → make the bug reproducible offline → fix it locally → ask the user once to confirm.**
