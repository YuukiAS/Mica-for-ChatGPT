# Goal 025 — One-shot product recovery: exact evidence -> faithful replay -> shippable Mica

Status: **BLOCKING / SINGLE CONVERGENCE GOAL — DO NOT SPLIT INTO MORE GOALS**

Branch: `codex/v020-convergence-pushable`

## Why this goal exists

The project has spent too many iterations in a bad loop:

`synthetic PASS -> user retries real ChatGPT -> same bug still exists -> another speculative patch -> another user retry`.

That loop ends here.

Mica is a product, not a diagnostics project. The release target for this goal is a **small but actually usable ChatGPT enhancement** with two current real blockers closed:

1. `Mica Copy` must live in the real native assistant action cluster, directly adjacent to native Copy, or remain hidden. It must never float, create a separate row, or invent its own fallback toolbar.
2. A connector-backed send, including a long payload and a composer remount, must never leave the already-committed payload stale in the composer, and recovery must never erase genuinely new user input.

Everything in this goal is designed to close those bugs offline before consuming one final user confirmation.

## Non-negotiable process

This is one goal from acquisition through release readiness. **Do not create Goal 026/027 for intermediate failures.** Continue inside this goal until the exit criteria are met.

The only permitted user interventions for these two bugs are:

- at most **one host-side one-shot read-only probe** if Codex cannot reach the existing Edge session itself;
- at most **one final normal live confirmation** after exact real-derived fixtures and all automated gates pass.

Do not ask the user to repeat Atlas Round 1–6, upload ZIPs, inspect DevTools, paste DOM, or run multiple candidate builds.

Follow `AGENTS.md` and `docs/REAL_BUG_CONVERGENCE_WORKFLOW.md`.

## Phase 0 — Freeze product runtime until evidence is exact

At the start:

1. fetch/pull the current branch;
2. record current runtime version and commit;
3. do not change product runtime yet;
4. do not bump version for probe/tests/docs-only work;
5. do not ask the user to reload the extension.

The current `0.2.x` patch version is the only user-visible build identifier. Do not reintroduce `rcN` labels.

## Phase 1 — Make the targeted live probe trustworthy before using the live page

The probe itself must first pass deterministic protocol self-tests.

### 1A. Composer visible-value extraction

The real composer may be a `textarea`, `input`, or contenteditable editor.

Implement a single canonical helper used by the live probe and fixture materializer:

- `textarea` -> property-backed/snapshot `textValue` (or equivalent protocol value field), never `textContent`;
- `input` -> property-backed/snapshot `inputValue`;
- contenteditable -> descendant/node text;
- record `valueSource`, `visibleBodyLength`, and anonymous hash;
- committed contracts must never include the actual prompt text.

Required self-tests:

- textarea with empty DOM text + 2000+ char property value;
- input with empty DOM text + property value;
- contenteditable with nested inline nodes;
- exact payload equality and mismatch cases.

### 1B. Icon-only native Copy resolution

The probe must resolve native Copy without depending on visible text or guessed SVG geometry.

Use a bounded read-only accessibility path:

- `Accessibility.getFullAXTree` or an equivalent bounded AX query;
- match accessible names such as `Copy` / `复制`;
- correlate AX node -> DOMSnapshot node by `backendDOMNodeId`;
- resolve the native Copy button's exact DOM node;
- capture its direct parent chain, sibling order, action-cluster rect, display/flex/grid/alignment/gap, and Mica Copy relationship if present.

Required self-test:

- native Copy has no useful DOM text/aria label;
- AX tree exposes `Copy`;
- backend node identity maps to the correct DOM button;
- true parent/sibling cluster is recovered.

### 1C. Probe safety and privacy

The one-shot probe remains read-only.

It may use only the minimum commands required for exact acquisition, such as target discovery/attach, `Runtime.enable`, `Log.enable`, layout metrics, one bounded DOM snapshot, and bounded accessibility inspection.

It must perform zero:

- Send / Enter / connector action;
- upload;
- navigation/reload;
- Retry/Regenerate;
- account/auth mutation;
- generic page mutation/evaluation.

Raw DOM/text stays only under local gitignored artifacts. Commit-safe contracts may contain only sanitized semantics, geometry, lengths, anonymous hashes, generic accessible names, and parent/sibling relationships.

### Phase-1 gate

Before touching the user's failed page, all must PASS:

```text
PROBE_TEXTAREA_PROPERTY_SELFTEST = PASS
PROBE_INPUT_PROPERTY_SELFTEST = PASS
PROBE_CONTENTEDITABLE_SELFTEST = PASS
PROBE_AX_ICON_ONLY_COPY_SELFTEST = PASS
PROBE_PARENT_SIBLING_SELFTEST = PASS
PROBE_PAYLOAD_HASH_SELFTEST = PASS
PROBE_SANITIZER_SELFTEST = PASS
PROBE_READ_ONLY_ALLOWLIST = PASS
```

If any fail, keep fixing locally. Do not ask the user for anything.

## Phase 2 — Acquire the already-failed real state exactly, once

Use the current already-failed ChatGPT page if it still exists. Do not ask the user to resend the connector prompt.

Preferred path: Codex runs the one-shot probe itself if the environment can reach Edge `DevToolsActivePort`.

If sandbox/host loopback prevents that, this is the **only allowed acquisition handoff**: provide one copy-pasteable PowerShell command for the self-tested probe. The user runs it once against the same failed page and returns the output/contract. Continue this same Goal afterward; do not create another planning task.

Critical evidence must become `EXACT`:

### Action bar

```text
ACTIONBAR_GROUND_TRUTH = EXACT
NATIVE_COPY_RESOLVED = YES
NATIVE_COPY_DOM_NODE = PRESENT
NATIVE_COPY_PARENT_CHAIN = PRESENT
ACTION_CLUSTER_DIRECT_PARENT = PRESENT
ACTION_CLUSTER_SIBLING_ORDER = PRESENT
ACTION_CLUSTER_GEOMETRY = PRESENT
MICA_COPY_RELATIONSHIP = EXACT
```

The contract must distinguish these states:

- correct: Mica Copy is the intended sibling/wrapper sibling in the exact native cluster and adjacent to native Copy;
- wrong: Mica Copy is under a broad answer row, a separate Mica toolbar, a fixed/floating container, or any different parent chain.

### Stale composer

```text
STALE_COMPOSER_GROUND_TRUTH = EXACT
COMPOSER_EDITOR_TYPE = textarea/input/contenteditable
COMPOSER_VALUE_SOURCE = EXACT
COMPOSER_VISIBLE_BODY_LENGTH = PRESENT
COMPOSER_VISIBLE_BODY_HASH = PRESENT
LATEST_COMMITTED_USER_TURN_HASH = PRESENT
SAME_PAYLOAD_AS_LATEST_USER_TURN = TRUE/FALSE
CONNECTOR_PILL_STATE = PRESENT
MOUNTED_USER_TURN_IDENTITIES = PRESENT
```

If any disputed critical field is `PARTIAL`, `LIMITED`, or `MISSING`, fix the probe/materializer and reacquire from the same page if still available. **Do not change runtime and do not ask for a new product reproduction.**

## Phase 3 — Materialize exact real-derived fixtures and prove historical failure

Create commit-safe fixtures/contracts from the exact live evidence.

Required fixtures:

1. `exact-native-actionbar-placement`
2. `exact-long-connector-residual`

They must encode the exact facts that made the real page fail, not a synthetic approximation authored around current code.

### 3A. Action-bar historical failure proof

Check out/run the actual historical bad implementation that produced the detached/floating Mica Copy (discover the exact commit from history if needed; do not guess).

The historical implementation must fail the exact fixture for the same reason seen live:

```text
OLD_BAD_ACTIONBAR_EXACT_FIXTURE = EXPECTED_FAIL
```

Assertions must include:

- correct native Copy node identified;
- Mica Copy parent/wrapper relationship equals the exact live invariant;
- adjacency is exact;
- no broad container;
- no fallback toolbar;
- no fixed/floating Mica Copy;
- no duplicate after remount.

If historical bad code passes, the fixture is not faithful. Fix the fixture first.

### 3B. Residual historical failure proof

Run the historical bad implementation against the exact residual fixture.

It must fail because of the same proven live stage, for example commit detection, composer value source, identity replacement, payload hash, generation lifetime, or editor-clear behavior.

```text
OLD_BAD_LONG_RESIDUAL_EXACT_FIXTURE = EXPECTED_FAIL
```

The fixture must include:

- explicit connector send intent;
- long payload (>= the real failing length class; include >=2000 chars);
- pre-commit composer remount;
- connector pill transition/removal as observed;
- committed user-turn identity/hash evidence;
- mounted-turn count may remain constant because of virtualization;
- returned editor contains exact committed payload;
- new user input after commit cancels any stale clear;
- no resend/Enter/connector automation.

If historical bad code passes, improve the fixture before runtime work.

## Phase 4 — Fix the product, not the tests

Only now may product runtime change.

### 4A. Mica Copy placement — fail closed by construction

The implementation must follow the exact native action-bar contract.

Hard rules:

- no `createActionBar()` fallback in normal ChatGPT runtime;
- no broad `closest(..., div)` placement heuristic;
- no fixed/floating placement;
- no answer-bottom separate row;
- if the exact native Copy/action cluster cannot be resolved, **show no Mica Copy**;
- Mica Copy may only be inserted according to the exact observed parent/wrapper relationship;
- preserve native Copy;
- use the compact icon-only action;
- reuse neighboring native presentation classes/styles only in a sanitized way; do not clone identity/data-testid/event semantics;
- every sync removes any detached/orphan/duplicate Mica Copy before deciding whether a valid one can exist;
- remount/action-bar-late-appearance must converge to exactly one valid button.

The user-visible rule is simple: **correct place or absent**. Never a random place.

### 4B. Send residual recovery — simplify around exact send/commit evidence

Do not keep stacking heuristics if the exact fixture shows a simpler invariant.

Canonical recovery model should be:

1. on explicit send gesture, capture the editor's actual visible value, canonical body hash, editor identity, connector state, and a user-edit epoch;
2. observe commit using user-turn identity/hash, not mounted count alone;
3. virtualization/remount must not discard the candidate;
4. after commit, if the returned composer contains **exactly the sent payload** and the user-edit epoch has not advanced, clear it once;
5. if the user typed anything genuinely new after send, cancel recovery and never delete it;
6. clear the real editor using the correct editor-type mutation path:
   - textarea/input: native value setter + the minimum native-like input/change notification needed by ChatGPT/React;
   - contenteditable: bounded native editing path;
7. verify the editor actually became empty;
8. bounded attempts only; no resend, Enter, connector action, Retry, or Regenerate.

Do not use timeout increases as the root fix.

### 4C. Normal-use product cleanliness

For the shippable baseline:

- Atlas/diagnostics remain developer/Advanced-only and create no normal UI clutter;
- normal typing hot path remains lightweight;
- long-thread/native-virtualization path remains fail-open;
- known safe interruption handling remains bounded and does not bypass auth/security;
- popup shows only canonical SemVer.

If a feature cannot be proven safe/reliable in this goal, disable it by default rather than shipping unreliable behavior.

## Phase 5 — Local convergence: no user retries during implementation

Run focused tests first. Do not use the user as the next test layer.

Required focused gates:

### Mica Copy

- exact real-derived actionbar fixture;
- late action-bar appearance;
- assistant remount;
- native Copy icon-only;
- localized Copy name;
- duplicate/orphan cleanup;
- unresolved native cluster => Mica Copy absent;
- rich Markdown serializer regression.

### Residual recovery

- exact real-derived long residual fixture;
- short/medium/long payloads;
- textarea property value;
- contenteditable variant;
- count-unchanged virtualization commit;
- identity replacement;
- pill removed before/after commit;
- delayed commit;
- user begins new input immediately after commit;
- mismatched/partial text must not be erased;
- clear operation verification/failure path;
- no automated resend/Enter/connector action.

### Performance / safety

- typing hotpath including IME and connector-latched typing;
- Atlas OFF zero overhead invariant;
- no diagnostic UI in ordinary runtime;
- version consistency.

Only after focused tests are all PASS run:

1. `npm test`
2. `npm run test:integration`
3. `npm run test:e2e`
4. `npm run test:e2e:stress` because this goal closes real connector/remount races
5. `npm run test:build`

Run full/stress once on the stable candidate, not as an edit loop.

## Phase 6 — Versioning

Current runtime is `0.2.3` at goal start unless branch state proves otherwise.

- probe/tests/docs-only work does not bump version;
- when the final runtime fix is ready, bump exactly once to the next patch version (`0.2.4` if `0.2.3` is still current);
- version is single-source-of-truth from `scripts/release-config.mjs`;
- manifest, popup, runtime, dist, package basename all agree;
- no user-visible `rcN` label.

Do not bump multiple times during internal edits.

## Phase 7 — One final normal live confirmation only

The user is not asked to test until all previous phases are PASS.

At that point, provide **one** normal non-Atlas/non-CDP confirmation flow using the same real failure shape:

1. reload the single final version;
2. verify one assistant answer has Mica Copy exactly in the native action cluster next to native Copy;
3. select GitHub connector normally;
4. send the same long harmless read-only payload class that previously failed;
5. verify committed payload is not left in composer;
6. immediately type a short new draft and wait; verify it is not erased;
7. verify typing remains smooth and there is no diagnostic UI intrusion;
8. click Mica Copy once and verify copied Markdown is sane.

The user reports only:

```text
FINAL_COPY_PLACEMENT = PASS/FAIL
FINAL_LONG_CONNECTOR_RESIDUAL = PASS/FAIL
FINAL_NEW_INPUT_PRESERVED = PASS/FAIL
FINAL_TYPING = PASS/FAIL
FINAL_MICA_COPY = PASS/FAIL
FINAL_UI_INTRUSION = PASS/FAIL
```

No ZIP, Atlas run, CDP trace, or additional reproduction is required for PASS.

If this final confirmation fails, do **not** immediately create another runtime candidate. Preserve the failed state and continue this same Goal from exact acquisition. Do not split into another Goal.

## Phase 8 — Package and PR without another planning cycle

If the one final confirmation passes, continue this same Goal automatically:

1. run final affected gates/build validation if runtime changed after the last automated gate;
2. `npm run package:release`;
3. validate ZIP structure;
4. record ZIP path and SHA-256;
5. ensure raw live/Atlas artifacts remain untracked/uncommitted;
6. create a PR from `codex/v020-convergence-pushable` to `main` summarizing user-facing value and the exact real-derived regressions;
7. do not merge/tag/publish without explicit user approval.

Do not ask for another planning prompt between final confirmation and packaging/PR.

## Final completion report

Return one report for the whole goal:

```text
GOAL_025 = PASS/FAIL

GROUND_TRUTH_CRITICAL_FIELDS = EXACT/PARTIAL/LIMITED/MISSING
ACTIONBAR_GROUND_TRUTH =
STALE_COMPOSER_GROUND_TRUTH =

OLD_BAD_ACTIONBAR_EXACT_FIXTURE = EXPECTED_FAIL/PASS_UNEXPECTEDLY
OLD_BAD_LONG_RESIDUAL_EXACT_FIXTURE = EXPECTED_FAIL/PASS_UNEXPECTEDLY
CURRENT_ACTIONBAR_EXACT_FIXTURE = PASS/FAIL
CURRENT_LONG_RESIDUAL_EXACT_FIXTURE = PASS/FAIL

MICA_COPY_FAIL_CLOSED = PASS/FAIL
MICA_COPY_NATIVE_CLUSTER = PASS/FAIL
MICA_COPY_NO_DUPLICATE = PASS/FAIL
LONG_CONNECTOR_RESIDUAL = PASS/FAIL
NEW_INPUT_PRESERVED = PASS/FAIL
TYPING_HOTPATH = PASS/FAIL
NORMAL_UI_CLEAN = PASS/FAIL

FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
STRESS_E2E =
BUILD_VALIDATION =
VERSION_CONSISTENCY =
VERSION =

FINAL_COPY_PLACEMENT = PASS/FAIL/NOT_RUN
FINAL_LONG_CONNECTOR_RESIDUAL = PASS/FAIL/NOT_RUN
FINAL_NEW_INPUT_PRESERVED = PASS/FAIL/NOT_RUN
FINAL_TYPING = PASS/FAIL/NOT_RUN
FINAL_MICA_COPY = PASS/FAIL/NOT_RUN
FINAL_UI_INTRUSION = PASS/FAIL/NOT_RUN

PACKAGE_RELEASE = PASS/FAIL/NOT_RUN
RELEASE_ZIP =
RELEASE_SHA256 =
PR_TO_MAIN = <number/url or NOT_RUN>

RAW_PRIVATE_ARTIFACTS_COMMITTED = NO
READY_TO_MERGE = YES/NO
```

## Exit criterion

This goal is complete only when the product is actually boring to use:

- Mica Copy is correctly placed or absent, never random;
- long connector sends do not leave stale committed text;
- genuine new input survives;
- normal typing is unaffected;
- diagnostics stay out of the way;
- exact real failures are locked into offline regressions so the user does not have to keep rediscovering them.
