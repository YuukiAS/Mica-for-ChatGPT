# Computer Use grounded connector continuity / overlay controls

Date: 2026-09-08

## Evidence source

Read-only inspection of the real ChatGPT page through Computer Use / DevTools. No page interaction, no message send, no repository inspection during the observation.

## High-confidence findings

### 1. Native composer visual root is known

Use:

`div[data-composer-surface="true"]`

as the continuity visual snapshot root.

Why:

- it owns the complete native composer surface;
- it contains the plus button, editor, resolved connector pill, model/reasoning selector, send/voice control;
- it carries the visible background, 28px radius, shadow, min-height and overflow behavior;
- inner editor roots are incomplete;
- outer form/layout containers are mostly transparent positioning/layout wrappers.

Observed real-site geometry/styles:

- rect about `348.7, 622.9, 768 x 52`;
- background `rgb(255,255,255)`;
- border-radius `28px`;
- min-height `52px`;
- overflow `clip`;
- box-shadow includes the native thin ring and two soft shadows;
- relevant CSS variables include `--composer-surface-primary`, `--composer-container-height`, `--composer-blue-bg`.

Stable layout reference is under `#thread-bottom-container` / the surrounding width container. Preserve the native surface's original rect and inherited composer CSS variables.

### 2. Resolved connector pill structure is known

Resolved connector context is represented inside the composer subtree, not a portal.

Useful structural signal:

`span[data-inline-selection-pill][data-symbol="ecosystemMention"][data-id^="plugin:"]`

It is `contenteditable=false` and contains the plugin-connector anchor/icon/label.

Do not depend on the business name (GitHub is only one test connector).

### 3. Overlay Copy / Stop are not blocked by CSS hit-testing

Real-site read-only hit test:

- Copy center hits `button[data-action="copy"]`;
- Stop center hits `button[data-action="stop"]`;
- overlay root `div[data-mica-composer-diagnostics-root="true"]` is fixed, very high z-index, pointer-events auto;
- no ancestor inert/disabled/blocking layer was observed.

Therefore the remaining overlay bug is most likely event-handler / message-session wiring, not z-index or pointer-events.

### 4. Current continuity UI should not be a generic placeholder

Previous white/simplified continuity UI is not acceptable. If a faithful native snapshot cannot be created, fail open and show nothing rather than a visibly fake composer.

## Architecture changes required

### A. Send intent must become confirmation-driven

Real diagnostics already proved that the first Enter used to select a connector can coincide with composer unmount and be misclassified as `send_intent`.

Do not decide `Enter == Send` synchronously.

Create a short-lived `sendCandidate` instead:

1. On possible Send gesture (Enter or send-button click), capture an ephemeral local pre-action snapshot/fingerprint and connector-context state.
2. Do **not** create the real Send generation yet for ambiguous Enter.
3. Promote the candidate to a real Send generation only when a new user turn commit is observed.
4. If instead composer unmount/remount occurs with no user-turn commit and resolved connector context appears, classify the candidate as connector selection and discard it as a Send.
5. For explicit send-button click, candidate promotion may still be confirmation-driven so user-turn commit remains the source of truth.

This removes dependence on perfect chooser DOM detection and directly matches the real lifecycle.

The candidate must stay privacy-safe: raw prompt text may exist only as ephemeral local runtime state needed for recovery; diagnostics record only lengths/hashes/reasons.

### B. Connector continuity snapshot must use the real native surface

Only during the confirmed/strongly suspected connector-selection transaction:

- capture `div[data-composer-surface="true"]` before native unmount;
- clone the full surface subtree as a sanitized inert visual snapshot;
- keep it in the same document and same visual rect;
- preserve or explicitly copy inherited composer CSS variables needed by the clone;
- if necessary recursively copy a bounded set of computed visual styles for the surface/body grid/editor/pill/controls;
- `aria-hidden=true`;
- `inert`;
- `pointer-events:none`;
- all interactive descendants disabled/non-editable;
- strip duplicate ids;
- no event handlers/network behavior.

Cleanup immediately when the real `data-composer-surface` returns. Hard cap about 2 seconds.

Continuity is **selection-window only**. Do not activate during actual Send, send-residual recovery, Ctrl+A/Delete, stale-clear recovery, or later native remounts.

If a faithful snapshot cannot be prepared before unmount, fail open and do not show a custom placeholder.

### C. Overlay controls need delegated, session-aware handling

Because hit testing is already correct, fix wiring instead of CSS.

Use a handler that survives overlay subtree rerenders/remounts, for example delegated handling on a stable diagnostics root or content-script-level listener scoped to:

- `[data-mica-composer-diagnostics-root] [data-action="copy"]`
- `[data-mica-composer-diagnostics-root] [data-action="stop"]`

Both actions must operate on the same active diagnostics session used by the popup.

Add diagnostics fields:

- `overlayHandlerAttached`
- `lastOverlayActionReceived`
- `lastOverlayActionSessionId`
- `lastOverlayActionResult`

Real browser test must use `document.elementFromPoint(...)` plus `page.mouse.click(...)`; `element.click()` is insufficient.

## Required focused fixtures before any new user acceptance

1. **Ambiguous Enter / connector selection**
   - unresolved connector context;
   - Enter candidate;
   - composer unmount;
   - no user-turn commit;
   - remount with resolved connector pill;
   - assert: no real Send generation.

2. **Real Send after connector selection**
   - resolved connector pill exists;
   - user continues editing;
   - actual Send gesture;
   - user turn +1 then mounted count may later -1;
   - assert: exactly one real Send generation and commit latch remains true.

3. **Faithful continuity snapshot**
   - native `data-composer-surface` clone captured before selection unmount;
   - screenshot / bounding-box comparison against pre-unmount native surface;
   - same position/size/theme/radius/shadow/visible controls within a small tolerance;
   - no generic white placeholder;
   - no activation during later Send/clear remounts.

4. **Send residual recovery regression**
   - exact and safe partial provenance paths remain working;
   - multi-remount bounded retries;
   - final empty + quiet window => success semantics true;
   - nonmatching/new trusted input preserved.

5. **Overlay real pointer actions**
   - `elementFromPoint` hits Copy/Stop;
   - `page.mouse.click` triggers the delegated handler;
   - Stop ends the active session;
   - Copy returns/copies the same privacy-safe report structure as popup Copy report.

## Release / testing

Keep version `0.1.6` while candidate remains uncommitted.

Suggested build label:

`connector-computer-use-grounded.1`

During iteration run focused tests only. When the full connector lifecycle is stable, run one final Tier 2 gate:

- `npm test`
- `npm run test:e2e`
- `npm run build`
- `npm run test:build`

Stress not indicated.

Do not ask the user for another real-site acceptance until all focused fixtures above pass, including screenshot regression and real mouse clicks.
