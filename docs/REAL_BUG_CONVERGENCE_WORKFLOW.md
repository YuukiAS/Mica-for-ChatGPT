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

The probe is allowed to inspect only the exact target and should remain read-only. Typical allowed operations are target discovery/attach, layout metrics, one bounded DOM snapshot, and narrowly scoped accessibility-tree reads needed to resolve icon-only controls. It must not automate Send, Enter, connector selection, upload, navigation, reload, Retry/Regenerate, auth, or account/conversation mutation.

### Probe capability must be tested before the user runs it

A live probe is itself software and must not be treated as ground truth merely because it connected successfully.

Before asking the user to run a host-side probe, automated probe tests must cover the exact evidence classes needed by the current bug. At minimum, when relevant:

- a `textarea` / `input` whose live value differs from DOM text nodes, proving the probe reads the control value (`DOMSnapshot` input-value/property evidence or an equivalently narrow read-only source) rather than `textContent`;
- a contenteditable composer body;
- an icon-only native control whose accessible name is obtained from the accessibility tree and correlated back to the DOM node using backend-node identity;
- parent-chain / sibling-order extraction for the true native action cluster;
- localized accessible names such as `Copy` / `复制` without relying on English-only text;
- sanitization proving prompt/answer text and identifiers do not enter committed contracts.

If the probe cannot extract a required fact in its synthetic/protocol self-test, fix the probe first. Do not consume a live page state to discover a known probe limitation.

### Important: form controls are property-backed

For real form controls, DOM structure is not enough.

- `textarea.textContent` may be empty while the visible/current value is non-empty.
- A committed residual comparison must use the live form-control value or equivalent property-backed snapshot field, not child text nodes.
- A contract that reports `textarea bodyLength = 0` while the root contains long visible text is **PARTIAL**, not proof of no residual.

Similarly, icon-only action buttons may have no useful visible text. Prefer accessibility-name evidence and backend-node identity over SVG-path guessing or broad container heuristics.

### Ground-truth completeness levels

Every critical fact for the current bug must be classified independently:

- `EXACT` — directly observed from the already-failed live page by a tested read-only probe;
- `PARTIAL` — some live structure was observed, but the critical equality/identity/relationship is unproven;
- `LIMITED` — inferred from screenshot + prior contracts/fixtures, not exact current live DOM evidence;
- `MISSING` — the required fact was not resolved.

Do not collapse these into a generic `PASS`.

For example, a connector residual bug is not exact ground truth until the probe can prove whether the visible composer body equals the just-committed user-turn payload. An action-bar placement bug is not exact ground truth until native Copy and the true parent/sibling cluster are resolved.

### Important: Codex sandbox vs host loopback

A Codex sandbox may not be able to reach the user's already-running Edge DevTools WebSocket on `127.0.0.1`, even when the same command works from the user's normal Windows PowerShell. This is an execution-environment/network-isolation limitation, not a product failure and not a reason to ask for another reproduction.

If sandbox loopback access fails:

- do not repeatedly request elevated/unsandboxed access;
- do not reinterpret the failure as a safety defect in Mica;
- prepare and self-test the one-shot probe locally first;
- then run the one-shot probe from the normal host shell where Edge is running;
- keep raw output local/gitignored;
- commit only sanitized contracts/fixtures.

If even the host probe is unavailable, use existing screenshots + committed real contracts as a fallback and mark the resulting ground truth as `LIMITED`. Limited fallback evidence must not be described as exact live DOM evidence.

If a host probe connects but returns `PARTIAL` / `MISSING` for a critical field because the probe extraction is wrong, **do not ask the user to reproduce the product bug again**. Fix and self-test the probe, then rerun the probe against the same already-failed page if it is still available. This is acquisition repair, not another product acceptance cycle.

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

### Fixture fidelity gate

A fixture is acceptable only if the evidence that made the live behavior wrong is present in the fixture itself.

For UI placement bugs, include the exact semantic parent/sibling relationship that distinguishes correct vs detached placement. For residual/recovery bugs, include the exact property-backed composer value, committed-turn identity/payload evidence, remount ordering, and connector state needed to reproduce the failure.

Do not author a synthetic fixture merely to make the current implementation fail or pass.

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

1. committed exact real-derived contracts/fixtures;
2. targeted one-shot live probe of an already-failed state;
3. one short user confirmation;
4. broad Atlas acquisition only when current UI contract drift or an otherwise unreproducible defect requires new ground truth.

Do not repeat a broad Round 1-6 Atlas campaign for ordinary product regressions.

## Versioning rule

Runtime-changing candidates use patch SemVer so the loaded extension is obvious:

```text
0.2.1 -> 0.2.2 -> 0.2.3
```

Tests/docs/probe-only changes do not increment the runtime version.

Do not require users to compare separate `rcN` labels. The popup-visible extension version is the canonical identifier.

## Release blocker rule

A real-only blocker is not considered ready for another user retry until all critical evidence needed for that bug is exact (or an explicitly noncritical missing field is documented) and all of the following hold:

```text
GROUND_TRUTH_CRITICAL_FIELDS = EXACT
OLD_CODE_REAL_FIXTURE = EXPECTED_FAIL
CURRENT_CODE_REAL_FIXTURE = PASS
FOCUSED_REGRESSIONS = PASS
AFFECTED_INTEGRATION_E2E = PASS
VERSION_CONSISTENCY = PASS
READY_FOR_SINGLE_FINAL_NORMAL_CONFIRMATION = YES
```

`PARTIAL`, `LIMITED`, or `MISSING` evidence for a field that is itself the disputed behavior is not sufficient to ask the user for another product retry.

This workflow is intended to keep Mica product-first: real evidence should reduce manual QA, not create more of it.
