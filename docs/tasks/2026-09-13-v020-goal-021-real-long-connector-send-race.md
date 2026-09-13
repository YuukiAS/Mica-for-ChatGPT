# Goal 021 — Fix the real long-connector send/remount race

Status: **BLOCKING 0.2.0 RELEASE**

Branch: `codex/v020-convergence-pushable`

Starting point: `ade5928 Polish Mica Copy action bar and residual coverage` (`v020-convergence.rc10`).

## Real failure

The final ordinary, non-Atlas rc10 live sanity still fails on a genuinely long connector payload.

Observed on real ChatGPT:

- GitHub connector selection succeeds.
- The send is committed; the user turn appears in conversation.
- The composer briefly disappears/remounts during the connector send transition.
- After it returns, the entire already-submitted long payload is still present in the composer.
- This is not an Atlas artifact: no Atlas/CDP was running.

Therefore rc10 is **not release-ready**.

The brief single composer remount is not independently a blocker. The blocker is that the committed payload survives/reappears after the remount.

## Likely race to investigate first

Current `send-residual-recovery.ts` has a pre-commit `sendCandidate` state.

`tickCandidate()` currently contains logic equivalent to:

```js
if ((sendCandidate.remountSeen || sendCandidate.unmountSeen) && hasResolvedConnectorContext(snapshot.root, snapshot.editable)) {
  finishCandidate("connector_selection", snapshot);
  return;
}
```

That is a plausible real-race bug for long connector sends:

1. user explicitly clicks the Send button / submits;
2. send candidate is correctly created;
3. ChatGPT native connector send temporarily unmounts/remounts composer while the resolved connector pill/context is still present;
4. long payload/user-turn commit takes slightly longer to mount;
5. before `countUserTurns()` observes the committed user turn, `tickCandidate()` mistakes the send transition for connector selection and discards the candidate;
6. user turn later commits, but there is no active send-residual generation left to clear the stale long payload.

This hypothesis fits the real symptom and explains why synthetic short/medium/long post-commit residual fixtures could pass while the real long flow still fails: the missing case is likely **pre-commit timing/order**, not payload hashing itself.

Do not assume this hypothesis is correct without reproducing it deterministically, but investigate it before changing thresholds or adding broader recovery behavior.

## P0 — Add the missing race fixture

Build a deterministic fixture that reproduces the real ordering, without Atlas and without real ChatGPT automation.

At minimum simulate:

1. connector pill is selected/resolved;
2. composer contains a long payload (use >= 2000 chars); 
3. explicit actual send gesture occurs (`click` on a recognized send button or real submit path);
4. `sendCandidate` is created;
5. before user-turn count increments, composer disappears;
6. composer remounts while connector context/pill is still resolved;
7. wait a realistic delay before commit: test at least ~100 ms, ~700 ms, ~2000 ms, and near/over the existing candidate-window boundary;
8. then committed user turn appears / count increments;
9. same submitted payload remains in the remounted composer;
10. Mica must promote the original send candidate and clear only that committed residual exactly once.

This exact ordering must fail against the pre-fix logic and pass after the fix.

## P0 — Distinguish real send intent from connector selection

Do not classify an explicit Send-button / submit candidate as `CONNECTOR_SELECTION` merely because the composer remounted with connector context still present.

A candidate that came from an explicit send gesture should remain eligible long enough to observe commit unless there is strong contradictory evidence.

Requirements:

- `click` on a positively identified Send button = explicit send intent;
- `submit` from the composer form = explicit send intent;
- Enter while chooser/connector selection is active must still be excluded by the existing connector-selection guard;
- selection-only interaction must not create/promote a false send generation;
- remount/pill presence alone is insufficient to downgrade an explicit send candidate to connector selection.

If useful, persist an explicit `intentClass` / `explicitSendIntent` on the candidate rather than inferring later from transient DOM state.

## P0 — Candidate lifetime / delayed commit

Do not blindly increase `SEND_CANDIDATE_WINDOW_MS` just to make the test pass.

First determine whether the real failure is candidate misclassification or expiry.

Add timing-sweep regressions around the current 3200 ms boundary. If an actual committed send can legitimately arrive after the current window in the real connector lifecycle, extend the bound conservatively and document why. Keep it bounded.

The candidate must terminate when there is strong evidence of:

- true connector-selection-only interaction;
- navigation;
- contradictory/new user input;
- bounded expiry with no commit evidence.

## P0 — Long residual recovery after remount

Once commit is latched, preserve the current safety rules:

- only clear text that provenance/fingerprint proves belongs to the just-committed payload;
- exact long payload and safe subsets may be recovered;
- new user input after commit cancels recovery and must never be deleted;
- no auto resend;
- no Enter;
- no connector/tool execution;
- no Retry/Regenerate.

Add a real-shape regression where the long payload includes:

- an inline connector pill outside editable body text;
- a long editable body;
- composer remount;
- pill removal around commit;
- same body text persists after remount.

## P0 — Composer remount classification

A single brief native composer disappearance/remount is acceptable if:

- it is caused by ChatGPT native connector transition;
- Mica does not cause an extra remount/refresh;
- no draft is lost;
- committed payload does not survive after send;
- new input after the transition is preserved.

Do not build a fake/cloned composer or attempt to mask ChatGPT's native remount visually.

## Required regressions

At minimum:

- explicit-send + pre-commit remount + resolved connector context + delayed commit;
- same ordering with long >=2000-char payload;
- timing sweep around candidate window;
- selection-only Enter still does not become send;
- send-button click survives remount and promotes on commit;
- form submit survives remount and promotes on commit;
- new input after commit cancels recovery;
- partial/mismatched payload remains protected;
- pill removal continuity regression;
- typing hotpath regression;
- Mica Copy action-bar regression must remain green.

Then run:

- focused send-residual race tests;
- focused connector lifecycle tests;
- `npm test`;
- `npm run test:integration`;
- `npm run test:e2e`;
- `npm run test:build`.

Because runtime reliability code will likely change, bump build label to `v020-convergence.rc11`; version remains `0.2.0`.

Run stress E2E if candidate lifecycle/state-machine logic changes materially or if any related test is flaky.

## Final ordinary live retry

Only after all automated gates pass.

No Atlas. No CDP. No diagnostic harness.

Use the same long connector payload shape that failed rc10.

User checks only:

```text
NORMAL_LIVE_TYPING = PASS/FAIL
NORMAL_LIVE_CONNECTOR_FLOW = PASS/FAIL
NORMAL_LIVE_SEND_RESIDUAL = PASS/FAIL
NORMAL_LIVE_MICA_COPY = PASS/FAIL
NORMAL_LIVE_COPY_UI = PASS/FAIL
NORMAL_LIVE_UI_INTRUSION = PASS/FAIL
COMPOSER_REMOUNT = BRIEF_OK / PROBLEMATIC
```

`NORMAL_LIVE_SEND_RESIDUAL = PASS` requires the committed long payload to be absent after the composer returns.

If this passes, stop iterating on 0.2.0 and cut the release candidate.

## Completion report before live retry

```text
REAL_RACE_ROOT_CAUSE =
EXPLICIT_SEND_CANDIDATE_SURVIVES_REMOUNT = PASS/FAIL
CONNECTOR_SELECTION_ONLY_GUARD = PASS/FAIL
DELAYED_COMMIT_100MS = PASS/FAIL
DELAYED_COMMIT_700MS = PASS/FAIL
DELAYED_COMMIT_2000MS = PASS/FAIL
CANDIDATE_WINDOW_BOUNDARY = PASS/FAIL
LONG_2000_CHAR_REMOUNT_RESIDUAL = PASS/FAIL
NEW_INPUT_PRESERVED = PASS/FAIL
PILL_REMOVAL_CONTINUITY = PASS/FAIL
TYPING_HOTPATH = PASS/FAIL
MICA_COPY_ACTIONBAR_UI = PASS/FAIL
FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
STRESS_E2E = PASS/NOT_RUN
BUILD_VALIDATION =
VERSION = 0.2.0
BUILD_LABEL =
PUSHED =
READY_FOR_FINAL_LONG_LIVE_RETRY = YES/NO
```

## Principle

This is not another generic robustness pass. The task is to close one real product race that synthetic tests missed: **an explicit connector send can remount before commit is observed, causing the send candidate to be discarded and leaving a long committed payload stale in the composer.**
