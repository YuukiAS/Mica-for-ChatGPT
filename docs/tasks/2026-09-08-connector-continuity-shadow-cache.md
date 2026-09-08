# Task: Fix real connector-selection disappearance with a pre-captured native-surface shadow cache

## Context

Latest real acceptance on `0.1.6 / connector-computer-use-grounded.1` still shows the original connector-selection disappearance. This is not a visual-style problem anymore; the runtime continuity gate never activates on the real page.

Real report facts:

- `mention_signal_on` at ~2168ms while the native composer is still present.
- Composer remains visible for ~1.8s after the mention signal.
- At ~3927ms, the source has already become `resolved-connector-pill`.
- At ~4000ms, composer unmounts.
- At ~5102ms, composer remounts with the resolved connector context.
- Throughout this real selection flow:
  - `chooserActiveNow=false`
  - `selectionWindowActive=false`
  - `connectorContinuity.activated=false`
  - `sanitizedCloneAvailable=false`

Therefore the current design still depends on a selection-window/chooser signal that does not exist reliably on the real page.

At the same time, the actual Send later is correctly recognized through candidate promotion and user-turn commit. So this task must not disturb the confirmation-driven Send model.

## Primary design change

Stop requiring `chooserActiveNow` / `selectionWindowActive` to pre-arm continuity.

Introduce a **pre-captured native-surface shadow cache**:

1. When connector/mention context first becomes plausible while a real native composer surface exists, capture a sanitized inert snapshot of:
   - `div[data-composer-surface="true"]`
   - exact bounding rect
   - required composer CSS variables / critical computed styles
2. Keep that snapshot only in memory; do not render it yet.
3. Refresh the cached snapshot only on bounded, relevant connector-context transitions while the native surface is still mounted, e.g.:
   - mention signal first observed
   - resolved connector pill appears/changes
   - composer blur immediately preceding connector-selection remount
   - explicit connector-context structural change
4. On a composer unmount, render the cached shadow **only if** all of the following are true:
   - Connector continuity feature is enabled.
   - Recent connector context is latched.
   - Cached native snapshot exists and is fresh (e.g. <= 2.5s old).
   - There is no promoted/active real Send generation for this unmount.
   - There is no active stale-clear recovery generation for this unmount.
   - There is no other explicit non-selection lifecycle reason.
5. Remove the shadow immediately when the real native composer returns, or on a short hard cap (~2s).

This lets the real selection flow be masked without needing to observe the ephemeral chooser DOM.

## Critical distinction

The cached shadow is **not** a long-lived connector shell.

It is only a standby visual snapshot that becomes visible on the specific connector-context unmount where no real Send or stale-clear lifecycle is active.

Actual Send unmounts, stale-clear remounts, residual-recovery remounts, navigation, and unrelated composer churn must not display it.

## Do not regress Send intent / candidate promotion

Keep the current confirmation-driven Send architecture:

- gesture -> transient candidate
- new user turn commit -> promote to real Send generation
- mounted `+1 -> -1` virtualization changes must not undo the commit latch

Do not return to `keydown Enter => immediate real Send`.

## Diagnostics correction: separate body text from connector-pill text

The latest real report ends with `finalTextLength=8`, while the same report shows the resolved connector pill itself is 8-ish characters and no new trusted user input occurred.

Current diagnostics likely count the non-editable connector pill text as composer draft text.

Add canonical text extraction that reports at least:

- `composerRawTextLength`
- `composerEditableBodyLength`
- `connectorPillTextLength`
- `attachmentOrNonEditableTokenLength` if applicable

`Send residual recovery` provenance should compare the editable/canonical body, not blindly include non-editable connector-pill labels.

Do not automatically remove the connector pill in this task. First make diagnostics distinguish:

- stale typed body residual
- resolved connector context pill that remains by design

If `editableBodyLength=0` but only the connector pill remains, classify this separately from stale draft text.

Suggested classification:

- `SEND_BODY_CLEARED_CONNECTOR_CONTEXT_RETAINED`

Do not call it `SEND_NONMATCHING_TEXT_PRESENT` merely because a non-editable pill is still visible.

## Focused fixture requirements

Build the focused fixture directly from the real timeline:

### Case A: real connector selection without chooser state

- native composer present
- mention signal starts
- no chooserActiveNow signal ever becomes true
- no selectionWindowActive signal ever becomes true
- native `data-composer-surface` remains mounted long enough to cache
- resolved connector pill appears
- composer unmounts
- no user-turn commit
- real composer remounts ~1s later with connector pill

Expected:

- pre-captured snapshot available
- continuity activates despite chooserActiveNow=false
- snapshot visually matches native surface
- snapshot removed immediately on remount
- no Send generation created

### Case B: actual Send after connector selection

- same connector context remains latched
- user enters message body
- real Send candidate created
- user turn commit promotes Send generation
- composer unmounts/remounts

Expected:

- continuity shadow does **not** activate during actual Send
- Send residual state machine continues to work

### Case C: stale-clear recovery after connector flow

Expected:

- continuity shadow does not activate during stale-clear recovery remounts

### Case D: stale snapshot

- cached snapshot older than freshness window
- composer unmounts

Expected:

- fail-open, no stale visual shell

### Case E: body-vs-pill diagnostics

- connector pill remains after Send
- editable typed body clears

Expected:

- raw text can be non-zero
- editable body length = 0
- connector pill length > 0
- classification is not stale body residual

## Production-quality visual requirement

Snapshot source remains exactly:

`div[data-composer-surface="true"]`

No generic placeholder. No Mica-designed fake composer.

The snapshot must preserve:

- exact rect
- native background
- 28px radius
- native shadow
- plus/editor/chip/model/send visual positions
- relevant CSS variables

If a faithful snapshot cannot be produced, fail-open and show nothing.

## Testing budget

Before any full E2E:

1. Static impact audit of all affected fixtures/validators.
2. Focused connector continuity test.
3. Focused guided composer diagnostics test for body-vs-pill extraction.
4. Any affected validator test.

Only after those pass, run one final Tier 2 gate:

- `npm test`
- `npm run test:e2e`
- `npm run build`
- `npm run test:build`

Do not run stress unless newly indicated.

## Version

Keep runtime version:

`0.1.6`

Use build label:

`connector-continuity-shadow-cache.1`

## Stop condition

Do not commit or push.

Do not ask the user to test until all of these are proven locally:

- continuity activates on the real-shaped no-chooser selection flow
- continuity does not activate on actual Send
- continuity does not activate on stale-clear recovery
- snapshot freshness/fail-open works
- body-vs-pill diagnostics separate correctly
- focused gates pass
- final Tier 2 pass

The next real acceptance should be a single connector-selection test, not another multi-round debugging loop.
