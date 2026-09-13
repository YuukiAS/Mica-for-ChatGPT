# Goal 020 — Native action-bar Mica Copy + long connector residual closure

Status: **NEXT / LAST UI + RELIABILITY POLISH BEFORE 0.2.0 RELEASE CUT**

Branch: `codex/v020-convergence-pushable`

Starting point: `ef9bae9 Define product-first release and next feature sprint`, with rc9 runtime from `04ecb74 Avoid connector snapshot refresh on pill removal`.

## Why this goal exists

The latest ordinary, non-Atlas live sanity check is broadly healthy:

- normal typing is smooth;
- GitHub connector can be selected and executed;
- this short request left no stale composer residual;
- no obvious Mica UI intrusion was observed;
- the composer briefly disappeared/remounted during the connector send transition;
- `Mica Copy` works, but the current textual `Mica Copy` button appended at the end of the action bar is visually out of place.

There is one unresolved reliability concern from prior real use: **long connector prompts are more likely to leave the committed text stale in the composer**. The short live request not reproducing it is useful, but is not enough to declare that path closed.

This goal is product-first. Do not reopen Atlas work. Do not add diagnostics unless a concrete product defect requires them.

## UI decision — Mica Copy must look native

Current implementation in `extension/src/copy/markdown-copy.ts` creates a text button and appends it to the end of the action bar. Replace that presentation.

### Icon source

Use an existing open-source icon. Do not generate artwork.

Preferred source: **Lucide**.

Preferred icon: `copy-check` (24×24 grid, 2px stroke, ISC license). It visually matches the lightweight outline style of the existing ChatGPT action icons while remaining distinguishable from ChatGPT's native Copy icon.

Official reference:

- https://lucide.dev/icons/copy-check

Acceptable fallback if the visual comparison is clearly better in the fixture: Lucide `clipboard-copy`.

Alternative library considered: Tabler Icons (24×24, 2px stroke, MIT). Do not add a whole icon package dependency for one icon; embed only the selected SVG path(s) as inline SVG and preserve the icon source/license attribution in code comments/docs.

### Placement and behavior

1. `Mica Copy` must be an **icon-only action button** in the same action-bar cluster as ChatGPT's existing buttons.
2. Prefer inserting it **immediately adjacent to the native Copy action (prefer before native Copy)**. Never append a textual button at the far right of the action row.
3. Keep ChatGPT's native Copy action available in v0.2.0. Do **not** intercept/delete/replace the native handler in this release; native Copy is a useful fail-open fallback and replacement would create unnecessary coupling to ChatGPT internals.
4. No permanent text label in the action bar.
5. Add accessible `aria-label` / tooltip: `Copy as Markdown with Mica` (or concise equivalent).
6. On successful click, provide compact transient feedback without changing action-bar width (for example switch to a check icon briefly). On failure, do not leave a stale success state.
7. Match neighboring action buttons for icon size, hit target, color, hover/focus treatment, border/background, and spacing. Do not introduce a pill/button visual style.
8. The action must survive assistant/action-bar remounts without duplicates.
9. Native-safe short threads and full-scan/long-thread paths must both get the same Mica Copy affordance.
10. If a native action bar truly does not exist, the current fallback may remain, but fallback UI should also be compact/icon-based rather than a textual `Mica Copy` pill.

## Composer brief disappearance — classification

The ordinary connector send caused a brief composer disappearance/remount, but the composer returned and the short submitted payload did not remain stale.

Treat this as **acceptable native/remount behavior unless Mica is proven to cause extra remounts, repeated flicker, text loss, or stale residual**.

Do not attempt to keep a cloned/fake composer visible over ChatGPT's native remount. That would be a risky product change.

Instead, assert locally that:

- connector continuity does not cause an extra snapshot refresh/remount after connector-pill removal;
- stale-composer/send-residual modules preserve/cancel correctly across a single native remount;
- no ordinary input event enters a heavy DOM path;
- after remount, active draft state is either the intended current draft or empty after a committed send — never an old committed payload.

## P0 — Close long connector residual without more Atlas

Build deterministic product-runtime coverage for long connector prompts. Use the committed real ChatGPT contract pack and existing connector lifecycle fixtures; do not use live Atlas.

Required cases:

1. **Short connector payload** — current successful path.
2. **Medium payload** — at least ~500 characters.
3. **Long payload** — at least ~2000 characters.
4. Same-composer committed residual: user turn is committed, exact payload remains in same editable composer.
5. Clear/remount path: composer clears and remounts after connector send.
6. Connector pill removal immediately after commit.
7. User begins genuinely new input after send: recovery must cancel and must never erase new input.
8. Partial/mismatched residual: only recover when existing provenance/fingerprint rules prove it belongs to the just-committed payload.
9. No automatic re-send, Enter, connector action, retry, or regenerate.

Acceptance for long-payload tests:

- committed connector payload is removed/cleared exactly once when safe recovery evidence exists;
- new user input is never deleted;
- recovery is bounded;
- no snapshot refresh on ordinary input or connector-pill removal;
- typing-hotpath invariants remain intact.

If these deterministic tests pass, do not require another Atlas capture. The final live check below is ordinary product usage only.

## Tests

At minimum:

- focused action-bar Mica Copy placement/duplicate/remount test;
- native-safe Mica Copy regression;
- rich Markdown serialization regression;
- short/medium/long connector residual tests;
- connector pill-removal continuity regression;
- new-user-input-cancels-recovery regression;
- typing hotpath test;
- `npm test`;
- `npm run test:integration`;
- `npm run test:e2e` because runtime UI changes;
- `npm run test:build`.

Run stress E2E only if connector lifecycle/recovery logic changes beyond tests/fixtures/UI placement, or if any lifecycle test is flaky.

If runtime code changes, bump build label from `v020-convergence.rc9` to `v020-convergence.rc10`; version remains `0.2.0`.

## One final ordinary live sanity — no Atlas/CDP

Only after all automated gates pass.

Use normal ChatGPT with the loaded current candidate. No Atlas, no CDP, no special diagnostics.

User checks:

1. Mica Copy appears as a native-looking icon in the action cluster, not a textual pill at the far right.
2. Native Copy remains available.
3. Normal typing remains smooth.
4. Manually select GitHub connector.
5. Send one **moderately long** harmless read-only connector prompt (longer than the previous one, enough to exercise the residual path; no need for thousands of characters manually).
6. After commit, old submitted text must not remain in the composer.
7. A brief single composer remount/disappearance is acceptable if it returns normally with no stale text, no repeated flicker, and no text loss.
8. Click Mica Copy once and confirm the copied Markdown is sane.
9. Confirm there is no diagnostic/Atlas UI intrusion in normal use.

User reports only:

```text
NORMAL_LIVE_TYPING = PASS/FAIL
NORMAL_LIVE_CONNECTOR_FLOW = PASS/FAIL
NORMAL_LIVE_SEND_RESIDUAL = PASS/FAIL
NORMAL_LIVE_MICA_COPY = PASS/FAIL
NORMAL_LIVE_COPY_UI = PASS/FAIL
NORMAL_LIVE_UI_INTRUSION = PASS/FAIL
COMPOSER_REMOUNT = BRIEF_OK / PROBLEMATIC
```

No ZIP, screenshot bundle, Atlas report, or CDP trace is required for PASS.

## Release cut

If the automated gates and this ordinary sanity check pass:

1. Stop iterating on 0.2.0 product behavior.
2. Run `npm run package:release`.
3. Validate package.
4. Record candidate SHA, ZIP path, SHA-256, build label, and test summary.
5. Ensure raw Atlas artifacts remain local/untracked.
6. Prepare the PR from `codex/v020-convergence-pushable` to `main`.
7. Do not merge, tag, or publish until explicit user approval.

After the PR is ready, move immediately to the next user-facing milestone (Copy & Export v2 / Reliability v2), not more diagnostics infrastructure.

## Completion report before final ordinary sanity

```text
MICA_COPY_ACTIONBAR_UI = PASS/FAIL
MICA_COPY_ICON =
NATIVE_COPY_PRESERVED = YES/NO
MICA_COPY_NATIVE_SAFE = PASS/FAIL
CONNECTOR_RESIDUAL_SHORT = PASS/FAIL
CONNECTOR_RESIDUAL_MEDIUM = PASS/FAIL
CONNECTOR_RESIDUAL_LONG = PASS/FAIL
NEW_INPUT_PRESERVED = PASS/FAIL
PILL_REMOVAL_CONTINUITY = PASS/FAIL
TYPING_HOTPATH = PASS/FAIL
FAST_TEST =
INTEGRATION_TEST =
FULL_E2E =
BUILD_VALIDATION =
VERSION = 0.2.0
BUILD_LABEL =
PUSHED =
READY_FOR_ONE_FINAL_NORMAL_SANITY = YES/NO
```

## Principle

The 0.2.0 release should end with a product that feels like a small, native-quality improvement to ChatGPT: smoother reliability, better Markdown copy, and no diagnostic clutter. Atlas remains background development infrastructure.