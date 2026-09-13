# Real Bug Convergence Workflow

This document defines the default workflow for bugs that reproduce only on the real authenticated ChatGPT UI.

The goal is to minimize user repetition. The normal loop is:

**acquire the real failing shape once -> reproduce it offline -> fix it locally -> ask for one final normal confirmation**

Atlas/diagnostics are development support tools, not the product and not the default release gate.

## User-effort budget

For one concrete product bug, the target maximum is:

1. **Initial real failure / acquisition** — ideally the failure already happened during normal use; do not ask the user to reproduce it again just for diagnostics.
2. **Local convergence** — Codex/dev work only. No user retry until the old implementation fails a faithful real-derived fixture and the new implementation passes it.
3. **One final normal live confirmation** — no Atlas/CDP unless the bug itself cannot otherwise be verified.

Do not run speculative `fix -> ask user to retry -> fix -> ask user to retry` loops.

If the final confirmation still fails, preserve that failed state and return to acquisition/replay. Do not immediately ship another candidate for the user to try.

## Phase A — Acquire the already-failed state

Prefer a targeted one-shot probe of the page **as it currently exists after the failure**.

For Mica this may use the existing read-only `DevToolsActivePort` probe:

```powershell
npm run probe:live-failure -- --thread-url="$threadUrl" --user-data-dir="$edgeUserData"
```

The probe is allowed to inspect only the exact target and should remain read-only. Typical allowed operations are target discovery/attach, layout metrics, and one bounded DOM snapshot. It must not automate Send, Enter, connector selection, upload, navigation, reload, Retry/Regenerate, auth, or account/conversation mutation.

### Important: Codex sandbox vs host loopback

A Codex sandbox may not be able to reach the user's already-running Edge DevTools WebSocket on `127.0.0.1`, even when the same command works from the user's normal Windows PowerShell. This is an execution-environment/network-isolation limitation, not a product failure and not a reason to ask for another reproduction.

If sandbox loopback access fails:

- do not repeatedly request elevated/unsandboxed access;
- do not reinterpret the failure as a safety defect in Mica;
- prefer running the one-shot probe from the normal host shell where Edge is running;
- keep raw output local/gitignored;
- commit only sanitized contracts/fixtures.

If even the host probe is unavailable, use existing screenshots + committed real contracts as a fallback and mark the resulting ground truth as limited. Limited fallback evidence must not be described as exact live DOM evidence.

## Phase B — Prove the bug offline before changing runtime

Materialize a commit-safe fixture/contract that represents the real failure.

Before modifying runtime code, the current/old implementation must fail the new real-derived test:

```text
OLD_CODE_REAL_FIXTURE = EXPECTED_FAIL
```

If the old implementation passes, the fixture is not faithfully reproducing the bug. Improve the fixture first; do not start speculative runtime changes.

The fixture should preserve only the minimum stable evidence needed for the defect, for example:

- semantic parent/sibling structure;
- anonymous element identity transitions;
- lengths and hashes/fingerprints instead of prompt text;
- lifecycle ordering/timing classes;
- feature state and selector invariants.

Do not commit raw prompt/answer text, conversation/account identifiers, cookies/tokens, headers, request bodies, or raw authenticated DOM.

## Phase C — Fix the proven stage and converge locally

Only after the old code reliably fails the real-derived fixture:

1. identify the precise failing stage;
2. change only the product runtime needed for that stage;
3. make the same fixture pass;
4. run focused regressions and affected integration/E2E tests;
5. preserve safety invariants such as no automatic Send/Enter/connector action unless explicitly part of a separately approved product design.

For race/lifecycle bugs, the report must state which stage failed, such as:

- send intent capture;
- committed user-turn detection;
- composer identity/remount tracking;
- payload fingerprint/canonicalization;
- connector-lifecycle latch lifetime;
- recovery-generation lifetime;
- editor mutation/clear operation;
- action-bar semantic parent resolution.

Do not fix an unknown stage by only increasing timeouts.

## Phase D — One final normal live confirmation

After offline reproduction and all automated gates pass, ask the user to repeat only the exact smallest normal product flow that originally failed.

Default rules:

- no Atlas visual capture;
- no CDP unless the bug specifically requires live structural confirmation;
- no ZIP/log upload for a PASS;
- use the same failing payload/shape when practical;
- report only the user-visible outcomes needed to close the bug.

If it passes, stop iterating and proceed to release/next feature work.

If it fails, keep the page in the failed state if possible and acquire a targeted contract from that state before making another candidate.

## Ground-truth hierarchy

Use the lightest evidence source that is sufficient:

1. committed real-derived contracts/fixtures;
2. targeted one-shot live probe of an already-failed state;
3. one short user confirmation;
4. broad Atlas acquisition only when current UI contract drift or an otherwise unreproducible defect requires new ground truth.

Do not repeat a broad Round 1-6 Atlas campaign for ordinary product regressions.

## Versioning rule

Runtime-changing candidates use patch SemVer so the loaded extension is obvious:

```text
0.2.1 -> 0.2.2 -> 0.2.3
```

Tests/docs-only changes do not increment the runtime version.

Do not require users to compare separate `rcN` labels. The popup-visible extension version is the canonical identifier.

## Release blocker rule

A real-only blocker is not considered ready for another user retry until all of the following hold:

```text
GROUND_TRUTH = PASS (or explicitly LIMITED with justification)
OLD_CODE_REAL_FIXTURE = EXPECTED_FAIL
NEW_CODE_REAL_FIXTURE = PASS
FOCUSED_REGRESSIONS = PASS
AFFECTED_INTEGRATION_E2E = PASS
VERSION_CONSISTENCY = PASS
READY_FOR_SINGLE_FINAL_NORMAL_CONFIRMATION = YES
```

This workflow is intended to keep Mica product-first: real evidence should reduce manual QA, not create more of it.
