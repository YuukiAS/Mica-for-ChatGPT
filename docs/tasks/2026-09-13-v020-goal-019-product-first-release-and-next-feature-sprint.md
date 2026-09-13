# Goal 019 — Product-first 0.2 release closure and next user-facing sprint

Status: **NEXT / FINAL 0.2 CLOSURE**

Branch: `codex/v020-convergence-pushable`

Starting point: `04ecb74 Avoid connector snapshot refresh on pill removal` (`v020-convergence.rc9`).

## Product principle

Mica exists to make ChatGPT easier, smoother, and less frustrating to use. Atlas/diagnostics are supporting development tools, not the product.

The authenticated UI/DOM/lifecycle ground truth is already committed under:

`tests/contracts/chatgpt-live/real-2026-09-13/`

From this goal onward:

- **Do not require Atlas for routine product acceptance.**
- **Do not ask the user to repeat Round 1–6.**
- **Do not spend another iteration tuning visual Atlas unless a concrete UI contract drift or unresolved product bug requires new ground truth.**
- Event-only/visual Atlas remain developer diagnostics only.
- Normal release acceptance should test the extension as the user actually uses it: no Atlas, no CDP, no special recorder.

## P0 — Close rc9 as a product, not a diagnostic harness

The rc9 automated gates already cover:

- Mica Copy native-safe path;
- connector residual persistent-payload path;
- connector continuity pill-removal regression;
- real-derived UI/lifecycle contract replay;
- fast/integration/full E2E/stress/build validation.

Before asking the user for anything, rerun only the **affected** automated tests needed for the current head. Do not rerun expensive full stress unless code changed since `04ecb74` or a focused test fails.

Then ask for exactly one **ordinary, non-instrumented live sanity check** on the loaded rc9 extension. No Atlas, no CDP.

User actions:

1. Build/reload `dist/mica-dev` and refresh ChatGPT.
2. Confirm popup shows `v0.2.0` / `v020-convergence.rc9`.
3. In a normal ChatGPT thread, manually choose `@GitHub`.
4. Send one harmless read-only GitHub request.
5. Verify after send:
   - submitted text is not left stale in the composer;
   - typing remains smooth;
   - connector UI remains usable;
   - `Mica Copy` appears on the resulting assistant answer and works once.
6. Optionally open/close the Mica popup and confirm no intrusive diagnostics UI is visible during normal use.

The user reports only:

```text
NORMAL_LIVE_TYPING = PASS/FAIL
NORMAL_LIVE_CONNECTOR_FLOW = PASS/FAIL
NORMAL_LIVE_SEND_RESIDUAL = PASS/FAIL
NORMAL_LIVE_MICA_COPY = PASS/FAIL
NORMAL_LIVE_UI_INTRUSION = PASS/FAIL
```

No ZIP, screenshot bundle, Atlas report, or CDP trace is required for a PASS.

If this sanity check fails, fix the specific **product runtime** defect only. Do not return to Atlas work unless the defect cannot be understood from existing contracts/tests.

## P0 — Cut 0.2.0 after the ordinary live sanity check passes

After PASS:

1. Run the final affected automated suite and build validation.
2. Run `npm run package:release`.
3. Record:
   - candidate commit SHA;
   - release ZIP path;
   - SHA-256;
   - build label;
   - test summary.
4. Confirm raw Atlas artifacts remain untracked/uncommitted.
5. Prepare a PR from `codex/v020-convergence-pushable` to `main`.
6. Do **not** merge, tag, or publish without explicit user approval.

The PR summary should focus on user-facing value:

- long-thread/native-virtualization-safe behavior;
- Markdown/LaTeX Copy;
- composer/send residual recovery;
- connector continuity;
- safe interruption handling;
- fail-open behavior;
- regression coverage derived from the real ChatGPT contract pack.

Atlas should be mentioned only as internal validation infrastructure.

## P1 — Immediately move to the next user-facing milestone

After the 0.2 PR is ready, stop expanding diagnostics and start a product feature sprint.

Priority order for the next milestone:

### 1. Copy & Export v2

Ship obvious user value beyond the existing single-answer Copy:

- reliable whole-conversation export;
- stable Markdown structure for headings/lists/quotes/tables/code/math;
- export modes such as plain Markdown / GitHub-friendly Markdown;
- exclude ChatGPT chrome/tool UI from copied content;
- clear user-visible Copy/Export affordance without clutter.

### 2. Reliability v2

Reduce repeated manual recovery work:

- surface ghost-send / stale-composer conditions clearly;
- preserve drafts across safe composer remounts;
- keep connector continuity robust;
- handle known safe acknowledgement interruptions;
- provide bounded, visible recovery actions;
- never auto-resend connector/tool actions without high-confidence safety evidence.

### 3. Interface friction reduction

Only add UI that directly improves daily ChatGPT use:

- a compact unified Mica control/status entry;
- quick Copy/Export access;
- clear recovery state when Mica intervenes;
- avoid permanent diagnostic panels or visual clutter.

Do not start broad theming, account systems, external backends, or a replacement chat client.

## Diagnostics policy after 0.2

- `tests/contracts/chatgpt-live/real-2026-09-13/` is the default regression ground truth.
- Atlas is used again only when ChatGPT UI contract drift is detected, or a concrete bug cannot be reproduced from committed contracts.
- Normal feature development runs local replay/fixture/E2E first.
- User manual work should be reserved for final live behavior that cannot be simulated locally.

## Completion report

Before ordinary live sanity check:

```text
RC9_PRODUCT_RUNTIME = PASS/FAIL
AFFECTED_TESTS =
BUILD_VALIDATION = PASS/FAIL
VERSION = 0.2.0
BUILD_LABEL = v020-convergence.rc9
READY_FOR_NORMAL_NON_ATLAS_LIVE_SANITY = YES/NO
```

After ordinary live sanity + packaging:

```text
NORMAL_LIVE_TYPING = PASS/FAIL
NORMAL_LIVE_CONNECTOR_FLOW = PASS/FAIL
NORMAL_LIVE_SEND_RESIDUAL = PASS/FAIL
NORMAL_LIVE_MICA_COPY = PASS/FAIL
NORMAL_LIVE_UI_INTRUSION = PASS/FAIL

RELEASE_READINESS = PASS/FAIL
PACKAGE_RELEASE = PASS/FAIL
RELEASE_ZIP =
RELEASE_SHA256 =
CANDIDATE_SHA =
READY_FOR_PR_TO_MAIN = YES/NO
NEXT_MILESTONE = USER_FACING_FEATURE_SPRINT
```

## Principle

The success criterion is no longer “collect more diagnostics.” It is:

**Mica should materially improve normal ChatGPT use, and the diagnostics infrastructure should stay mostly invisible unless a real bug requires it.**
