# Goal 012 — Final screenshot-coordinate integrity before real preflight

## Status

**BLOCKING the first real Edge no-send preflight.**

Goal 011 fixed exact turn targeting, owning-action-bar matching, viewport-normalized geometry scoring, and an explicit CDP-ready handshake. A final audit found one remaining coordinate-system gap: the code now converts DOMSnapshot document coordinates into viewport coordinates for matching against `getBoundingClientRect()`, but then passes that viewport-relative rect directly to `Page.captureScreenshot({ clip })`.

The matching rect and screenshot clip do not have the same coordinate semantics.

Official CDP evidence:

- `DOMSnapshot.LayoutTreeSnapshot.bounds` is an absolute/document bounding box.
- `DocumentSnapshot.scrollOffsetX/Y` is the document scroll offset.
- `Page.getLayoutMetrics().cssVisualViewport.pageX/pageY` is the viewport offset relative to the document in CSS pixels.
- `Page.Viewport` used by `Page.captureScreenshot` is expressed in device-independent pixels.

Therefore Atlas must keep both coordinate representations explicitly and convert them deliberately.

## Required fixes

### 1. Keep separate document and viewport rectangles

`resolveSurfaceMatch()` should continue using a viewport-normalized rect for comparison with the in-page recorder's `getBoundingClientRect()` checkpoint target.

However the returned match must retain both:

- `viewportRect`: for matching / diagnostics;
- `documentRect`: source DOMSnapshot absolute rectangle.

Do not overwrite one coordinate system with the other.

### 2. Build screenshot clip from document/page coordinates

`captureCheckpoint()` must not pass `viewportRect` directly to `Page.captureScreenshot`.

Create a dedicated helper, e.g. `screenshotClipForDocumentRect(documentRect, layoutMetrics)`.

Prefer modern CSS metrics from `Page.getLayoutMetrics`:

- `cssVisualViewport`
- `cssLayoutViewport`
- `cssContentSize`

Use deprecated `visualViewport/layoutViewport/contentSize` only as a compatibility fallback.

Account for `cssVisualViewport.zoom` when converting CSS pixels to device-independent pixels if needed by `Page.Viewport`.

The screenshot clip must correspond to the same real node selected by exact turn identity + viewport geometry.

### 3. Do not mix deprecated device-pixel metrics with CSS-coordinate DOMSnapshot bounds

Current `viewportOffsetFor()` prefers deprecated `visualViewport/layoutViewport` before document scroll offsets. This is unsafe on Windows display scaling / browser zoom.

Prefer CSS-coordinate sources:

1. `cssVisualViewport.pageX/pageY`
2. `cssLayoutViewport.pageX/pageY`
3. `DocumentSnapshot.scrollOffsetX/Y`
4. deprecated metrics only as last-resort compatibility evidence when coordinate units are explicitly normalized.

Add a test where deprecated `visualViewport.pageY` deliberately differs from `cssVisualViewport.pageY`; the matcher must use the CSS value.

### 4. Add non-zero-scroll screenshot-clip regression

Extend the targeting/protocol test with:

- page scroll Y > 0;
- old and current assistant turns;
- current assistant selected correctly after viewport normalization;
- `Page.captureScreenshot` receives the current assistant's **document/page** clip, not its viewport rect;
- action-bar screenshot likewise uses the current action bar's page clip.

The old Goal 011 implementation should fail this test.

### 5. Add zoom/scaling regression

Simulate a non-1 `cssVisualViewport.zoom` and prove the screenshot clip is converted consistently into the coordinate units expected by `Page.Viewport`.

Do not rely on the user's Edge being permanently at 100% zoom to make the Atlas correct.

### 6. Preflight must assert screenshot-coordinate integrity

The no-send preflight should retain its existing real composer + overlay assertions.

Add metadata/evidence allowing it to verify that each screenshot clip was generated from a resolved document rect rather than the viewport matching rect or a fallback area.

Do not expose private coordinates beyond what Atlas already stores locally/sanitizes.

### 7. Safety boundary remains unchanged

No implementation may add browser actions.

Must remain:

`AUTOMATED_SEND = NO`
`AUTOMATED_ENTER = NO`
`AUTOMATED_UPLOAD = NO`
`AUTOMATED_CONNECTOR_ACTION = NO`

## Completion gate

Do not mark the runbook READY until all are true:

`DOCUMENT_VS_VIEWPORT_RECT_SEPARATION = PASS`
`CSS_VIEWPORT_METRICS_PREFERRED = PASS`
`NONZERO_SCROLL_SCREENSHOT_CLIP = PASS`
`ZOOM_SCREENSHOT_CLIP = PASS`
`CURRENT_TURN_SCREENSHOT_REGION = PASS`
`PREFLIGHT_SCREENSHOT_INTEGRITY = PASS`
`ATLAS_TEST = PASS`
`FAST_TEST = PASS`
`INTEGRATION_TEST = PASS`
`AUTOMATED_SEND = NO`
`AUTOMATED_UPLOAD = NO`
`READY_FOR_REAL_EDGE_NO_SEND_PREFLIGHT = YES`

This is the final synthetic/code gate. After it passes, run the real no-send preflight rather than adding another speculative gate.