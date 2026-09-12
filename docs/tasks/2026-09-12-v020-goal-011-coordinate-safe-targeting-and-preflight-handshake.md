# Goal 011 — Coordinate-safe exact targeting + real preflight handshake

## Status

**BLOCKING the first real Edge no-send preflight.**

Goals 009–010 fixed the major Atlas protocol, ingestion, privacy, lifecycle, and preflight-integrity gaps. A final code audit found two ground-truth targeting issues and one operator-race issue that should be fixed before spending any user time on the real preflight.

## 1. Use turn identity, not geometry alone, for current-generation turn targeting

The in-page recorder already emits a privacy-safe `turnId` derived from a stable turn key. However, the CDP surface matcher currently does not use `checkpoint.turnId` to constrain candidates. In a page with multiple mounted user/assistant turns, role + nearest geometry is not strong enough.

Implement the same privacy-safe turn-key hashing in the CDP snapshot parser. For user/assistant surfaces, resolve the stable candidate turn identity from allowlisted structural attributes and require it to match `checkpoint.turnId` when a turn hint is available.

For assistant action bar / native Copy area, walk snapshot parent ancestry to the owning assistant turn and require that ancestor turn identity to match `checkpoint.turnId`.

If the intended turn identity cannot be resolved, fail open to `MISSING`; do not silently capture another old turn.

Tests must contain at least two old assistant turns/action bars plus one current generation and prove only the current generation is selected.

## 2. Normalize viewport vs document coordinates

The recorder checkpoint `targetRect` comes from `getBoundingClientRect()` and is viewport-relative. CDP `DOMSnapshot.layout.bounds` is an absolute/document bounding box. Direct distance comparison is invalid when the page/document is scrolled.

Normalize both to the same coordinate system before geometric scoring. Use `DocumentSnapshot.scrollOffsetX/scrollOffsetY` and/or the appropriate layout/visual viewport page offsets from `Page.getLayoutMetrics`. Keep the conversion explicit and tested.

Geometry should be secondary to exact structural/turn identity for turn-bound surfaces; it remains useful for composer/chooser/pill/overlay candidates.

Add tests with a non-zero page scroll offset that would select the wrong old node under the previous direct comparison.

## 3. Add an explicit CDP-ready handshake before the user starts Atlas

The real preflight command currently prints its safety banner before target resolution/WebSocket attach completes. If the user starts Atlas immediately, early `atlas_started` / overlay checkpoints can be missed.

Add a clear operator-facing readiness signal only after:

- exact target resolved;
- WebSocket connected;
- `Runtime.enable` completed;
- `Log.enable` completed;
- checkpoint listener is active.

For example:

```text
REAL_EDGE_CDP_ATTACHED = YES
SAFE_TO_START_ATLAS = YES
```

The no-send preflight instructions must tell the user not to click `Start Atlas` until this signal appears.

Prefer an `onAttached` callback/event from `runReadOnlyCaptureSession` rather than arbitrary sleeps.

Add a regression where Atlas checkpoint events emitted before `Log.enable` are intentionally unavailable, and prove the documented handshake prevents the operator from starting too early.

## 4. Keep Goal 010 assertions intact

Do not weaken any existing checks:

- recorder report ingestion;
- recorder performance ingestion;
- PNG signature/non-empty crop;
- real composer + overlay contracts;
- exact target URL;
- no truncation/capture error;
- Project conversation URL support;
- authoritative Atlas-session-relative timing;
- unknown checkpoint no visual capture;
- all no-send/no-upload/no-connector safety rules.

## Completion gate

Only after all pass may the runbook return to `READY FOR REAL EDGE NO-SEND PREFLIGHT`:

```text
TURN_HINT_EXACT_MATCH = PASS
ACTION_BAR_OWNING_TURN_MATCH = PASS
SCROLL_COORDINATE_NORMALIZATION = PASS
NONZERO_SCROLL_TARGET_TEST = PASS
CDP_READY_HANDSHAKE = PASS
EARLY_START_RACE_PREVENTED = PASS
ATLAS_TEST = PASS
FAST_TEST = PASS
INTEGRATION_TEST = PASS
AUTOMATED_SEND = NO
AUTOMATED_ENTER = NO
AUTOMATED_UPLOAD = NO
AUTOMATED_CONNECTOR_ACTION = NO
READY_FOR_REAL_EDGE_NO_SEND_PREFLIGHT = YES
```

If extension runtime does not change, keep `VERSION = 0.2.0` and `BUILD_LABEL = v020-convergence.rc5`. If the in-page recorder runtime must change materially, bump only the build label to `rc6`.
