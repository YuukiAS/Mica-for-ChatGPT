# Goal 009 — Final real Atlas ground-truth correctness gate

## Status

**BLOCKING the first dedicated real Atlas capture.**

Goal 008 fixed long-session durability, but a deeper repository audit found several places where synthetic tests can pass while the first real Edge capture still yields incorrect or incomplete ground truth. Do not consume the user's multi-round capture session until every gate below passes.

## 1. Parse the real CDP DOMSnapshot schema, not the current fake schema

Official `DOMSnapshot.captureSnapshot` returns:

- `documents: DocumentSnapshot[]`
- one shared top-level `strings: string[]` table

The current parser reads `doc.strings`, and the protocol/long-session fake snapshots incorrectly place `strings` inside `documents[0]`. This means the tests do not model the real protocol response.

Fix all DOMSnapshot parsing to use the actual shared top-level string table. Tests must use the official response shape. Add a regression that would fail if `documents[0].strings` is used.

## 2. Support real WebSocket response sizes

The handwritten CDP WebSocket decoder currently handles only payload lengths below 65536 bytes. Real `DOMSnapshot.captureSnapshot` responses can be much larger.

Implement RFC 6455 64-bit payload length (`127`) decoding and test a response well above 64 KiB. Prefer also handling fragmented continuation frames and ping/pong safely, or explicitly prove the chosen implementation is sufficient for Chromium CDP.

Do not claim real CDP readiness using only tiny fake snapshots.

## 3. Do not silently convert unresolved surfaces into fake OBSERVED ground truth

Current `captureCheckpoint()` falls back to a bottom-viewport clip when a surface lookup fails, then still writes an `OBSERVED` surface with a generic fallback contract.

For ChatGPT-specific surfaces, unresolved target means `MISSING` / capture error evidence, not fake ground truth.

The Atlas exists specifically to prevent hand-waved UI approximations. Never mark a surface `OBSERVED` unless the intended real node was structurally resolved.

## 4. Target the exact checkpoint surface, not the first matching old node

Current `rectForSurface()` / `findSurfaceNodeIndex()` return the first matching assistant turn/action bar in the snapshot. In a multi-turn conversation this can capture an older mounted answer instead of the current generation.

Extend privacy-safe checkpoint markers with enough structural targeting evidence, preferably the already-known target rect plus safe role/state hints. Match the snapshot node closest to the checkpoint target geometry among structurally valid candidates.

At minimum prove with a fixture containing multiple old user/assistant turns that:

- generation N user checkpoint resolves the new user turn;
- generation N assistant checkpoint resolves the new assistant turn;
- action-bar checkpoint resolves that assistant's action bar, not an older one;
- mention/pill resolves the visible current composer surface.

## 5. Fix generation identity before timing capture

Two correctness hazards remain in the in-page recorder:

### Click + submit double generation

A real send gesture may emit both button click and form submit. Both handlers currently call `startGeneration()`.

One logical user send must create exactly one Atlas generation. Coalesce the same pending send intent until a real new user-turn commit or an explicit attempt boundary occurs.

### Existing user turn misclassified as new commit

After a send generation starts, `inspectTurns()` currently iterates all mounted user turns and can mark the first pre-existing user turn as `user_turn_mounted` because baseline user-turn identity is not retained.

Track stable known turn identities/keys across baseline and native remounts. Only a genuinely new user-turn identity may satisfy generation commit.

Use stable ChatGPT structural keys such as safe `data-testid` when available, with a fail-open fallback. Native window remount of an old turn must not become a new commit.

Add tests with several baseline user/assistant turns before the send.

## 6. Preserve the in-page recorder timeline and performance evidence in the raw session

Current CDP raw `timeline.ndjson` contains CDP checkpoint-capture events only. The in-page recorder separately contains the valuable evidence that the timing pipeline needs:

- keydown/input/beforeinput/composition events;
- IME timing;
- assistant mutation bursts;
- exact per-generation lifecycle events;
- `PerformanceEventTiming`;
- Long Animation Frames;
- long tasks/layout shifts;
- memory counters.

`Copy Atlas report` currently places that report on the clipboard, but `atlas:sanitize --input=<raw-session>` does not automatically ingest the clipboard report.

Implement one coherent ingestion bridge before real capture. It must remain read-only and must not expose arbitrary `Runtime.evaluate`.

Acceptable patterns include a bounded/chunked privacy-safe terminal export channel owned by Mica or another narrow local-only mechanism. The result must be that the raw session directory automatically contains recorder lifecycle/performance evidence, and post-processing requires no manual reconstruction or copy/paste into files.

After capture, these commands must consume the same raw session directly:

`atlas:sanitize -> atlas:build-fixtures -> atlas:analyze-timings`

## 7. Preserve real UI variants instead of collapsing each surface to the first sample

The sanitized Atlas currently merges repeated surface files down to one contract per surface key and keeps the first observed value. This loses the dynamic UI variants the user explicitly wants to capture.

Preserve named variants/checkpoint states, for example:

- composer idle / focused / after-remount / connector-selected;
- assistant streaming / settled;
- assistant action bar;
- rich Markdown settled answer;
- mention chooser;
- connector pill;
- Mica overlay compact / recording.

Do not let an early empty `assistant_turn_mounted` contract overwrite or hide the later settled rich answer.

Fixture generation should consume these variants explicitly.

## 8. Capture the surfaces needed by the runbook

The surface coverage model contains keys such as:

- `userTurn`
- `assistantSettled`
- `nativeCopyArea`
- `richMarkdown`
- `micaCopy`

but the current checkpoint-to-surface map does not produce all of them distinctly.

Make Round 2 capable of producing real contracts for the settled rich answer and Copy/action area. Add a privacy-safe rich-content structural checkpoint after settlement when heading/list/blockquote/table/code/math structure is present.

If a surface truly cannot be observed, leave it `MISSING`; do not map it to a generic assistant surface and call it observed.

## 9. Heavy CDP capture must not perturb every timing checkpoint

Current `handleCheckpoint()` executes layout metrics + full DOMSnapshot + performance metrics + screenshot for every checkpoint.

Separate:

- timing-only lifecycle checkpoints;
- visual/structural capture checkpoints.

Do not run full DOMSnapshot/screenshot at latency-sensitive events such as every send intent, user-turn commit, composer clear or first streaming mutation unless the visual evidence is specifically needed.

Capture full structure only at named surface checkpoints (for example stable composer, mention chooser, connector pill, assistant settled/rich content, action bar, overlay). Keep exact lifecycle time from the in-page recorder.

Add counters and tests proving full DOMSnapshot count is bounded by visual checkpoints rather than total lifecycle checkpoints.

## 10. Add a no-send real Edge preflight before Round 1

After all code gates pass, provide a preflight that requires no message Send:

1. user opens the dedicated empty capture thread;
2. CDP companion attaches;
3. Atlas starts;
4. real composer surface is captured and parsed using the official DOMSnapshot schema;
5. one cropped screenshot and one sanitized real contract are produced;
6. Atlas stops;
7. sanitizer + fixture builder succeeds.

Only after this no-send preflight prints `REAL_EDGE_PREFLIGHT = PASS` should the user begin Runbook Round 1.

This preflight is intended to catch environment/protocol drift before consuming the multi-round capture session.

## Test requirements

Add focused tests for all above cases, including:

- official top-level `strings` DOMSnapshot schema;
- >64 KiB WebSocket response;
- multiple old turns + one new generation;
- click + submit = one generation;
- exact current-turn/action-bar targeting;
- unresolved target remains `MISSING`;
- raw session contains recorder timeline + performance evidence;
- multiple surface variants survive sanitize/build-fixture;
- heavy CDP snapshot count stays bounded;
- forbidden CDP actions remain impossible.

Then run:

- focused Atlas correctness/protocol tests;
- `npm run test:atlas`;
- `npm test`;
- `npm run test:integration`;
- one final `npm run test:e2e` if runtime/Atlas recorder changed materially.

## Completion gate

Do not mark the runbook READY again until all are true:

`REAL_DOMSNAPSHOT_SCHEMA = PASS`
`WEBSOCKET_LARGE_FRAME = PASS`
`EXACT_SURFACE_TARGETING = PASS`
`NO_FAKE_OBSERVED_FALLBACK = PASS`
`ONE_SEND_ONE_GENERATION = PASS`
`NEW_USER_TURN_IDENTITY = PASS`
`RECORDER_REPORT_INGESTION = PASS`
`RECORDER_PERFORMANCE_INGESTION = PASS`
`SURFACE_VARIANTS_PRESERVED = PASS`
`RICH_MARKDOWN_REAL_SURFACE = PASS`
`HEAVY_CDP_CAPTURE_BOUNDED = PASS`
`REAL_EDGE_NO_SEND_PREFLIGHT_READY = YES`
`AUTOMATED_SEND = NO`
`AUTOMATED_UPLOAD = NO`
`AUTOMATED_CONNECTOR_ACTION = NO`
`READY_FOR_DEDICATED_CAPTURE_THREAD = YES`
