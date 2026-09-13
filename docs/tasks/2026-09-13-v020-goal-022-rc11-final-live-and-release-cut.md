# Goal 022 — rc11 final ordinary live retry and 0.2.0 release cut

Status: **FINAL LIVE GATE / THEN RELEASE CUT**

Branch: `codex/v020-convergence-pushable`

Starting point: `2090bb6 Fix connector send remount race` (`v020-convergence.rc11`).

## Scope

This goal exists only to verify the real long-connector race fix discovered in rc10 and, if it passes, cut the 0.2.0 candidate.

Do not reopen Atlas work. Do not run live Atlas/CDP. Do not repeat Round 1–6. Do not add diagnostics infrastructure. The committed real ChatGPT contract pack remains the UI/DOM/lifecycle regression source.

## Known real failure fixed by rc11

The rc10 ordinary live test showed:

- GitHub connector selection/execution worked;
- a long connector payload was committed as a real user turn;
- the composer briefly unmounted/remounted;
- the already-submitted long payload remained stale in the returned composer.

Root cause fixed in `2090bb6`:

`explicit send candidate -> pre-commit composer remount -> connector context still present -> candidate incorrectly discarded as connector_selection -> delayed user-turn commit had no recovery generation`

The fix keeps explicit click/submit/send-key candidates alive across the connector remount while preserving the connector-selection-only guard.

Automated coverage already passed for 100 ms / 700 ms / 2000 ms delayed commit, candidate-window boundary, >=2000-char payload, new-input preservation, pill removal, typing hot path, full E2E, stress E2E, and build validation.

## One final ordinary live retry — no Atlas/CDP

The user should test the extension exactly as it is normally used.

Before testing:

1. `git pull --ff-only origin codex/v020-convergence-pushable`
2. `npm run build`
3. reload unpacked `dist/mica-dev` in Edge
4. refresh the ChatGPT thread
5. verify popup shows `v0.2.0` and `v020-convergence.rc11`

Then manually:

1. Type `@GitHub` and select GitHub normally.
2. Send the **same long harmless read-only connector prompt that reproduced the rc10 failure**. Reusing the exact failing payload is preferred over inventing a new case.
3. After the user turn visibly commits, verify the returned composer does **not** contain the submitted long payload.
4. When the composer returns empty, immediately type a short new draft such as `new draft 新输入123`, wait at least ~2 seconds, and verify Mica does not erase it. Then delete that draft manually without sending it.
5. Wait for the assistant response to settle.
6. Verify the Mica Copy action is the compact native-looking Lucide `copy-check` icon in the native action cluster, native Copy remains available, and Mica Copy works once.
7. Confirm normal typing remains smooth and there is no diagnostic/Atlas UI intrusion.

A single brief composer disappearance/remount is acceptable if it returns normally. Repeated flicker, text loss, or stale committed payload is a failure.

User reports only:

```text
NORMAL_LIVE_TYPING = PASS/FAIL
NORMAL_LIVE_CONNECTOR_FLOW = PASS/FAIL
NORMAL_LIVE_SEND_RESIDUAL = PASS/FAIL
NEW_INPUT_PRESERVED = PASS/FAIL
NORMAL_LIVE_MICA_COPY = PASS/FAIL
NORMAL_LIVE_COPY_UI = PASS/FAIL
NORMAL_LIVE_UI_INTRUSION = PASS/FAIL
COMPOSER_REMOUNT = BRIEF_OK / PROBLEMATIC
```

No ZIP, Atlas report, screenshot bundle, or CDP trace is required for a PASS.

## If the live retry passes

Stop changing 0.2.0 product behavior.

Then Codex should:

1. run only the final affected automated suite/build validation needed after the live result; do not gratuitously repeat expensive stress unless code changed after `2090bb6`;
2. run `npm run package:release`;
3. validate the release package;
4. record candidate commit SHA, release ZIP path, SHA-256, version, build label, and final test summary;
5. confirm raw Atlas/preflight artifacts remain untracked and uncommitted;
6. create a PR from `codex/v020-convergence-pushable` to `main` focused on user-facing 0.2.0 value and the real connector-race fix;
7. do **not** merge, tag, or publish without explicit user approval.

After the PR is ready, 0.2.0 is closed and work moves to the next user-facing milestone (Copy & Export v2 / Reliability v2 / interface friction reduction), not more diagnostics.

## If the live retry fails

Fix only the specific product runtime defect shown by the ordinary live behavior. Do not return to Atlas unless existing contracts cannot explain the defect.

## Completion report after live retry

```text
FINAL_NORMAL_LIVE_RETRY = PASS/FAIL
NORMAL_LIVE_TYPING = PASS/FAIL
NORMAL_LIVE_CONNECTOR_FLOW = PASS/FAIL
NORMAL_LIVE_SEND_RESIDUAL = PASS/FAIL
NEW_INPUT_PRESERVED = PASS/FAIL
NORMAL_LIVE_MICA_COPY = PASS/FAIL
NORMAL_LIVE_COPY_UI = PASS/FAIL
NORMAL_LIVE_UI_INTRUSION = PASS/FAIL
COMPOSER_REMOUNT = BRIEF_OK / PROBLEMATIC

RELEASE_READINESS = PASS/FAIL
PACKAGE_RELEASE = PASS/FAIL/NOT_RUN
RELEASE_ZIP =
RELEASE_SHA256 =
CANDIDATE_SHA =
VERSION = 0.2.0
BUILD_LABEL = v020-convergence.rc11
READY_FOR_PR_TO_MAIN = YES/NO
```

## Principle

The rc11 live retry must reproduce the exact real-world shape that failed in rc10. If that path is fixed and normal usage is clean, stop iterating and release the candidate.