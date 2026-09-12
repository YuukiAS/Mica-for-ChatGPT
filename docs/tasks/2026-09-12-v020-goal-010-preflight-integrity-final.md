# Goal 010 — Final Atlas preflight integrity gate

## Status

**BLOCKING Round 1.** Goal 009 fixed the major ground-truth issues, but final code audit found a small set of preflight-integrity gaps that can still produce a false PASS or corrupt a later multi-round capture. Fix these before asking the user to spend time on the dedicated capture thread.

## 1. Stable turn identity must fail open

`turnKey()` currently falls back to Atlas-local DOM `nodeId(turn)` when ChatGPT exposes no stable `data-testid` / message id. A native virtualization remount then gets a fresh node id and can be misclassified as a genuinely new committed turn.

Requirements:

- stable structural id (`data-testid`, message id, or another proven stable privacy-safe key) may identify a turn;
- if no stable key exists, do **not** satisfy `user_turn_mounted` / commit evidence from ephemeral DOM identity;
- record an explicit `turn_identity_unresolved` / fail-open diagnostic instead;
- tests must cover old-turn unmount/remount without stable ids and prove it cannot commit the current send generation.

## 2. Recorder report must be delivered before terminal close

Current `AtlasRecorder.stop()` emits the terminal `atlas_stopped` checkpoint before `MICA_ATLAS_REPORT_CHUNK` output. The CDP companion begins its drain window on the terminal marker. A large report or busy page could therefore close before the last report chunks arrive.

Requirements:

- emit the complete bounded recorder report chunks before the terminal marker, or implement an explicit report-complete acknowledgement/state that terminal close waits for;
- terminal marker must mean all recorder evidence has already been emitted;
- protocol test must use a large multi-chunk report and a deliberately short drain window and still prove 100% ingestion.

## 3. Unknown checkpoints must not trigger heavy visual capture

`surfaceKeyForCheckpoint()` currently defaults unknown states to `composer`. This makes future/unrecognized lifecycle checkpoints silently perform full DOMSnapshot/layout/screenshot work.

Requirements:

- unknown state => `null` / timing-only;
- only an explicit allowlist of visual state classes may trigger structural capture;
- `baseline_existing` and other bookkeeping states should be timing-only unless visual evidence is specifically required;
- test a novel unknown checkpoint and assert DOMSnapshot count does not increase.

## 4. Real Edge preflight must prove the whole useful pipeline

Current `live-atlas-real-edge-preflight.mjs` checks mainly that sanitized `composer` is OBSERVED and has a variant. That is insufficient for a trustworthy PASS.

Before printing `REAL_EDGE_PREFLIGHT = PASS`, assert at minimum:

- exact target attached and normal termination occurred (`atlas_stopped` or explicit operator stop as designed);
- no truncation / capture_error / checkpoint-capacity exit;
- at least one real composer surface contract from `real-cdp-companion`;
- composer contract is structurally non-empty and was not fallback-generated;
- at least one cropped screenshot file exists, is non-empty, and has a PNG signature;
- recorder report was ingested (`recorderReportsIngested >= 1`);
- recorder performance object was ingested (the object may contain zero observed entries on an idle page, but the ingestion path must be present);
- combined raw timeline contains in-page recorder events, not only `cdp_checkpoint_*` entries;
- sanitizer/privacy validator passes;
- generated fixture is derived successfully from the real contract;
- Mica overlay is OBSERVED if the loaded candidate is configured to show it; if not observable, fail with a specific reason rather than ignoring it;
- safety flags remain automatedSend/Enter/Upload/ConnectorAction = false.

The preflight should print a compact evidence summary: raw directory, checkpoint count, captured visual count, recorder event count, screenshot count, observed surfaces, and safety flags.

## 5. Accept dedicated Project conversation URLs safely

The user intends to place the dedicated capture thread in the current ChatGPT Project. Do not hard-code only `https://chatgpt.com/c/<id>` if Project conversation URLs can contain additional path segments.

Use one shared URL validator for `atlas:capture` and `atlas:preflight`:

- protocol must be `https:`;
- hostname exactly `chatgpt.com` (optionally retain explicit legacy `chat.openai.com` only if intentionally supported);
- URL must contain a recognizable `/c/<conversation-id>` conversation segment;
- use the **exact full URL supplied by the user** for target matching so no other tab can be selected;
- reject homepage/project-list/non-conversation URLs;
- do not navigate or normalize to another real URL.

Add tests for a normal `/c/<id>` URL, a Project-scoped conversation URL containing `/c/<id>`, and unsafe/non-conversation URLs.

## 6. Time bases in the combined raw timeline

Recorder events use Atlas-relative `relativeTimeMs`, while CDP checkpoint markers carry a page monotonic timestamp. Do not merge incomparable clocks and then sort them as if they share the same zero point.

Requirements:

- preserve an explicit clock/time-base field, or convert checkpoint marker times to the Atlas session-relative basis before merging;
- timing derivation must use the authoritative in-page recorder lifecycle timeline;
- CDP visual checkpoint timestamps are linkage/observation evidence, not a second lifecycle timing source;
- avoid duplicate timing samples from recorder + mirrored CDP checkpoint events.

## Completion gate

Run focused tests first, then `npm run test:atlas`, `npm test`, `npm run test:integration`. Run full E2E only if the in-page recorder/runtime changed materially.

Do not start a real user capture during this goal.

Required final report:

```text
STABLE_TURN_ID_FAIL_OPEN = PASS/FAIL
REPORT_BEFORE_TERMINAL = PASS/FAIL
UNKNOWN_CHECKPOINT_NO_CAPTURE = PASS/FAIL
PREFLIGHT_FULL_PIPELINE_ASSERTIONS = PASS/FAIL
PROJECT_THREAD_URL_SUPPORT = PASS/FAIL
TIMELINE_CLOCK_ALIGNMENT = PASS/FAIL
AUTOMATED_SEND = NO
AUTOMATED_ENTER = NO
AUTOMATED_UPLOAD = NO
AUTOMATED_CONNECTOR_ACTION = NO
READY_FOR_REAL_EDGE_NO_SEND_PREFLIGHT = YES/NO
```

If runtime changes, keep VERSION `0.2.0` and bump BUILD_LABEL from `v020-convergence.rc4` to `v020-convergence.rc5`. After all gates pass, update the Runbook status to **READY FOR REAL EDGE NO-SEND PREFLIGHT**, not yet Round 1.