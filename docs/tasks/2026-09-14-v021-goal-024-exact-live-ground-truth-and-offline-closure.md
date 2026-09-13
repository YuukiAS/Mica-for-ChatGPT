# Goal 024 — Exact live ground truth, faithful replay, then one confirmation

Status: **BLOCKING — DO NOT ASK USER TO REPRODUCE OR RETRY PRODUCT FLOW YET**

Branch: `codex/v020-convergence-pushable`

Starting point: runtime `0.2.1` from `6365c8e`, plus the hardened real-bug workflow/AGENTS rules on the current branch.

## Why this goal exists

The first host-side `probe:live-failure` successfully connected to the already-failed authenticated Edge page, but its contract is not complete enough to close the two disputed behaviors:

- `actionBar.status = MISSING`, reason `native_copy_missing`;
- stale composer is observed, but `textarea` visible residual text was not read correctly because the probe relied on DOM text rather than the property-backed control value; therefore `samePayloadAsLatestUserTurn = false` is **unproven**, not evidence that the payload differs.

This is now a **probe fidelity problem**, not a reason to ask the user to reproduce the product bug again.

The process for this goal is:

**fix/self-test probe -> rerun one-shot probe against the same already-failed page -> materialize exact real-derived fixtures -> prove old code fails -> verify current 0.2.1 or fix only the proven stage -> one final normal confirmation**.

Do not run Atlas Round 1–6. Do not ask the user to resend the connector prompt during acquisition.

## Canonical process

Follow:

- `AGENTS.md` → `Real-only bug convergence invariant`
- `docs/REAL_BUG_CONVERGENCE_WORKFLOW.md`

Critical fields for this bug must be `EXACT` before another product retry is allowed.

## P0 — Fix probe fidelity before touching runtime

### 1. Property-backed composer extraction

The live composer is a `textarea`. `DOMSnapshot` exposes property-backed form-control data separately from normal node text.

Use the official `DOMSnapshot.NodeTreeSnapshot` fields:

- `textValue` for `textarea` elements;
- `inputValue` for `input` elements;
- descendant/node text for contenteditable editors.

Do not use `textarea.textContent` as the visible composer value.

The probe must produce both:

- `composerVisibleBodyLength`
- a local-only canonical hash / commit-safe anonymous hash for that visible body

and compare that against the latest committed user-turn payload extracted from the same snapshot.

Committed contract output may contain lengths and anonymous hashes only, never prompt text.

Required self-test: a fake protocol snapshot where `textarea` text nodes are empty but `textValue` contains a long string. The probe must recover the long value and match it to the committed user-turn fixture.

### 2. Icon-only native Copy resolution

The real ChatGPT native Copy action may be icon-only and may not expose useful visible DOM text/attributes.

Add a narrow, read-only accessibility-tree path for the one-shot probe:

- `Accessibility.getFullAXTree` or an equivalently bounded accessibility query;
- correlate AX nodes to DOMSnapshot nodes using `backendDOMNodeId`;
- resolve generic/localized accessible names such as `Copy` / `复制`;
- use the resolved native Copy DOM node to capture its true parent chain, sibling order, action-cluster geometry/styles, and the Mica Copy node relationship.

If enabling the accessibility domain is required, enable it only for the bounded probe and disable it before close.

Do not use broad SVG-path guessing as the primary source of truth. SVG/geometry may be fallback evidence only and must be labeled accordingly.

Required self-test: a fake DOMSnapshot + AX tree where the Copy button has no useful text/aria-label in DOM but the AX node has an accessible copy name and matching `backendDOMNodeId`.

### 3. Read-only safety

The probe remains one-shot and read-only.

Allowed additions are limited to narrow accessibility inspection needed for exact semantic identification. It must still perform zero:

- Send / Enter / submit;
- connector selection/execution;
- upload;
- navigation/reload;
- Retry/Regenerate;
- auth/account mutation;
- arbitrary page mutation.

No generic `Runtime.evaluate` fallback just to read values. Prefer protocol-native DOMSnapshot/Accessibility data.

## P0 — Probe completeness gate

Before asking the user to rerun the one-shot host probe, automated tests must report:

```text
PROBE_TEXTAREA_PROPERTY_SELFTEST = PASS
PROBE_CONTENTEDITABLE_SELFTEST = PASS
PROBE_AX_ICON_ONLY_COPY_SELFTEST = PASS
PROBE_PARENT_SIBLING_SELFTEST = PASS
PROBE_SANITIZER_SELFTEST = PASS
PROBE_READ_ONLY_ALLOWLIST = PASS
```

Only then ask the user to run the probe command once against the same already-failed page, if that page is still available.

This one command is **not** another product reproduction. The user must not resend anything.

Recommended host command:

```powershell
cd C:\Code\Mica-for-ChatGPT
git pull --ff-only origin codex/v020-convergence-pushable
$edgeUserData = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
npm run probe:live-failure -- --thread-url="$threadUrl" --user-data-dir="$edgeUserData"
```

If the failed page is no longer available, do not ask the user to reproduce it yet. Report that exact acquisition is no longer possible and continue only with clearly labeled limited evidence.

## P0 — Exact contract requirements

The rerun is accepted as exact ground truth only if it produces all of the following:

### Action bar

```text
ACTIONBAR_GROUND_TRUTH = EXACT
NATIVE_COPY_RESOLVED = YES
NATIVE_COPY_SOURCE = ACCESSIBILITY+BACKEND_NODE
NATIVE_COPY_PARENT_CHAIN = PRESENT
ACTION_CLUSTER_SIBLING_ORDER = PRESENT
MICA_COPY_RELATIONSHIP = PRESENT
```

The contract must be able to prove whether:

- Mica Copy and native Copy have the same parent;
- they are adjacent siblings;
- Mica Copy is detached into a broad row/container.

### Stale composer

```text
STALE_COMPOSER_GROUND_TRUTH = EXACT
COMPOSER_CONTROL_KIND = textarea/contenteditable/input
COMPOSER_VALUE_SOURCE = DOMSNAPSHOT_TEXT_VALUE / DOMSNAPSHOT_INPUT_VALUE / CONTENTEDITABLE_TEXT
LATEST_USER_TURN = PRESENT
COMPOSER_BODY_HASH = PRESENT
LATEST_USER_TURN_HASH = PRESENT
SAME_PAYLOAD_AS_LATEST_USER_TURN = TRUE/FALSE
```

For the known failed page, if the residual is still present, `SAME_PAYLOAD_AS_LATEST_USER_TURN` is expected to be `TRUE`. If it is `FALSE`, the report must explain the exact canonical lengths/hashes and why, rather than assuming the product bug disappeared.

Raw text remains local/gitignored.

## P0 — Rebuild fixtures from exact evidence

Once exact contract exists:

1. regenerate the action-bar placement fixture from the exact native parent/sibling contract;
2. regenerate the long connector residual fixture from the exact property-backed composer + committed user-turn contract;
3. preserve sanitized lengths/hashes/semantic structure only.

Required historical proof:

```text
2090BB6_ACTIONBAR_EXACT_FIXTURE = EXPECTED_FAIL
2090BB6_LONG_RESIDUAL_EXACT_FIXTURE = EXPECTED_FAIL
```

If either historical buggy implementation passes, the fixture is still not faithful enough; improve the fixture before touching runtime.

## P0 — Evaluate current 0.2.1 before changing it

Do **not** assume `0.2.1` needs another runtime patch.

Run the exact fixtures against current `0.2.1` first.

If both pass:

```text
CURRENT_021_ACTIONBAR_EXACT_FIXTURE = PASS
CURRENT_021_LONG_RESIDUAL_EXACT_FIXTURE = PASS
```

then do not modify runtime and do not bump version. Proceed to automated regression gates and then one final normal live confirmation.

If either fails:

- identify the precise failing stage from the exact evidence;
- fix only that stage;
- bump runtime once to `0.2.2`;
- rebuild `dist/mica-dev`;
- rerun the same exact fixture until it passes.

Do not tune timeouts as a substitute for identifying the stage.

## P0 — Automated gates before final user confirmation

Required after exact fixtures are green:

- focused exact action-bar fixture;
- focused exact long-residual fixture;
- Mica Copy remount/no-duplicate;
- native Copy preserved;
- new-input preservation;
- pill-removal continuity;
- typing hotpath;
- `npm test`;
- `npm run test:integration`;
- `npm run test:e2e`;
- `npm run test:e2e:stress` if recovery/lifecycle runtime changes after `0.2.1`;
- `npm run test:build`;
- version consistency.

Do not ask the user for another normal product retry before these gates pass.

## P0 — One final normal product confirmation

Only after all critical ground truth is `EXACT` and current runtime passes the exact fixtures.

No Atlas. No CDP. No ZIP.

Ask the user to repeat only the smallest normal flow that previously failed:

- same long harmless GitHub connector payload;
- confirm committed payload is absent from returned composer;
- type a short new draft and confirm it is preserved;
- visually confirm Mica Copy is adjacent to native Copy inside the native action cluster and works;
- confirm normal typing/UI remain clean.

If this final confirmation fails, **do not immediately make another runtime candidate**. Preserve the failed page and return to the exact one-shot acquisition phase.

## Completion report — before host probe

```text
PROBE_TEXTAREA_PROPERTY_SELFTEST = PASS/FAIL
PROBE_CONTENTEDITABLE_SELFTEST = PASS/FAIL
PROBE_AX_ICON_ONLY_COPY_SELFTEST = PASS/FAIL
PROBE_PARENT_SIBLING_SELFTEST = PASS/FAIL
PROBE_SANITIZER_SELFTEST = PASS/FAIL
PROBE_READ_ONLY_ALLOWLIST = PASS/FAIL
VERSION = 0.2.1
RUNTIME_CHANGED = NO
READY_FOR_ONE_SHOT_HOST_PROBE = YES/NO
```

## Completion report — after exact contract + local convergence

```text
LIVE_FAILURE_STATE_ACQUIRED = PASS/FAIL
GROUND_TRUTH_CRITICAL_FIELDS = EXACT/PARTIAL/LIMITED/MISSING
ACTIONBAR_GROUND_TRUTH = EXACT/PARTIAL/LIMITED/MISSING
STALE_COMPOSER_GROUND_TRUTH = EXACT/PARTIAL/LIMITED/MISSING
NATIVE_COPY_RESOLVED = YES/NO
COMPOSER_VALUE_SOURCE =
SAME_PAYLOAD_AS_LATEST_USER_TURN = TRUE/FALSE/UNPROVEN

2090BB6_ACTIONBAR_EXACT_FIXTURE = EXPECTED_FAIL/PASS_UNEXPECTEDLY
2090BB6_LONG_RESIDUAL_EXACT_FIXTURE = EXPECTED_FAIL/PASS_UNEXPECTEDLY
CURRENT_RUNTIME_ACTIONBAR_EXACT_FIXTURE = PASS/FAIL
CURRENT_RUNTIME_LONG_RESIDUAL_EXACT_FIXTURE = PASS/FAIL

ROOT_CAUSE_ACTIONBAR =
ROOT_CAUSE_RESIDUAL =

FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
STRESS_E2E =
BUILD_VALIDATION =
VERSION_CONSISTENCY = PASS/FAIL
VERSION =
RUNTIME_CHANGED = YES/NO
PUSHED =

READY_FOR_SINGLE_FINAL_NORMAL_LIVE_CONFIRMATION = YES/NO
```

## Principle

A probe that connects but cannot read the disputed property is not ground truth. A fixture that passes the known-bad implementation is not a reproduction. The user should only be asked to confirm the product after both of those problems are solved locally.
