# Goal 008 — Harden Live Surface Atlas before the first real capture

## Status

**BLOCKING the first dedicated real Atlas capture.**

The 0.2.0 product candidate is broadly ready for real-site acceptance, but the Live Surface Atlas bootstrap must not consume the user's multi-round capture session until the recorder/CDP/replay pipeline is truly functional rather than synthetic-only.

## Confirmed gaps from repository audit

### 1. `live-atlas-cdp.mjs` is currently a safety/target-resolution stub

The current script resolves the exact `chatgpt.com/c/<id>` target and defines a read-only CDP allowlist, but it does not open `webSocketDebuggerUrl`, attach to the target, execute `DOMSnapshot.captureSnapshot`, capture cropped screenshots, listen to Atlas checkpoint markers, or write real surface contracts.

It currently finishes with `attached: false` and initializes empty timeline/coverage/performance files.

This must become a real read-only companion before user capture.

### 2. Atlas ON can distort the lifecycle it is trying to measure

The current document-wide subtree `MutationObserver` calls `sampleStructuralState("mutation")` for every mutation batch. That path performs document/composer/turn/mention/overlay discovery, including broad queries and geometry reads.

Real ChatGPT streaming and contenteditable typing can generate frequent mutations. Atlas must not create its own jank or materially perturb streaming/timing.

Refactor to event-driven / targeted observation:

- ordinary typing remains O(1)-like;
- streaming mutations are aggregated per active assistant turn;
- structural discovery is coalesced and bounded, not run on every mutation;
- prefer directly inspecting mutation added/removed nodes and targeted observers;
- named visual DOM snapshots remain checkpoint-driven only.

### 3. Continuous multi-round sessions need explicit generations and deduplication

Current checkpoint logic can repeatedly emit `assistant_action_bar_visible`, mention chooser, connector pill, and similar visible-state checkpoints every structural sample.

Add state transition deduplication and a bounded per-round/send generation model.

At minimum distinguish:

- baseline DOM existing when Atlas starts;
- manual send generation N;
- newly mounted user turn for generation N;
- newly mounted assistant turn for generation N;
- first mutation / mutation bursts / settled / action bar for generation N.

Do not interpret pre-existing mounted assistant turns as newly generated turns.

Ensure 4–6 rounds cannot evict the useful beginning of the session from `MAX_EVENTS` merely because streaming produced repetitive events.

### 4. Timing derivation is currently single-session-first-event, not multi-round evidence

`live-atlas-sanitize.mjs` currently builds `firstByState` and computes one difference from the first occurrence of each state in the entire session.

That is invalid for a continuous multi-round capture.

Derive per-generation arrays by pairing transitions within the same generation. Required metrics include, where observed:

- send intent -> new user turn mounted;
- send intent -> composer body zero;
- composer missing -> composer remounted;
- user turn mounted -> assistant turn mounted;
- assistant mounted -> first content mutation;
- streaming mutation-gap distribution;
- last mutation -> action bar visible;
- last mutation -> settled;
- local Mica transition -> overlay update;
- input event delay, processing duration, and interaction duration from `PerformanceEventTiming`.

`atlas:analyze-timings` should then report `n`, min, median, p90/p95 when meaningful, max, and MAD from real repeated observations.

### 5. Generated replay fixture is still hand-designed

`live-atlas-build-fixtures.mjs` currently hard-codes a generic fake composer/turn/action bar in HTML/CSS and only embeds `surfaces` JSON as data.

This defeats the purpose of Live Surface Atlas and must not be used as proof of real UI fidelity.

After real contracts exist, fixture structure/geometry/stable style must be generated from sanitized surface contracts. Dynamic text regions may use safe placeholders, but hierarchy, control roles/states, rectangles and approved styles must come from observed contracts.

If a surface is not observed, mark it `MISSING`; do not synthesize an approximation and claim fidelity.

### 6. Privacy sanitization must be schema-based for real CDP snapshots

The current privacy validator mostly rejects known secret/raw-HTML patterns. That is insufficient once real DOMSnapshot data exists because arbitrary conversation strings may not match those patterns.

For any real CDP snapshot:

- raw snapshot stays only under gitignored `artifacts/live-atlas/`;
- committed/derived contracts must be built by an allowlist schema;
- drop all text node contents by default;
- only explicitly allow generic UI labels (`Copy`, etc.) from a fixed allowlist;
- drop conversation title/sidebar/account/navigation data entirely;
- drop arbitrary URLs, IDs, repository/file names, connector payload text, headers/cookies/bodies;
- use anonymous node IDs, text category/length only where necessary.

Privacy validation must verify absence of disallowed fields, not only regex-match a few secret strings.

### 7. Recorder report and CDP checkpoint bundle need a real ingestion bridge

The first capture must yield one coherent raw session containing lifecycle/performance evidence plus structural/visual checkpoints.

Implement a safe bridge. Preferred options include a narrowly hard-coded read-only CDP helper for retrieving the Mica recorder report from its isolated execution context, or another equally constrained local-only export/ingest path. Do not expose generic arbitrary `Runtime.evaluate`.

The final raw session must be processable directly by:

```text
atlas:sanitize
atlas:build-fixtures
atlas:analyze-timings
```

without manually reconstructing empty placeholder files.

### 8. Continuous-session timer correctness

Audit Atlas settle timers for multiple assistant rounds. Per-turn/per-generation hard caps and settle timers must be cleared/reset correctly. A timer created for round 1 must not prevent round 2+ from receiving its own bounded safety cap.

The primary settled path should increasingly use observed real state (stream mutation cessation/action-bar state) rather than one global magic timeout.

### 9. Tests must prove behavior, not source-token presence

`live-atlas-check.mjs` currently proves that allowlist/denylist token strings exist, but cannot prove the CDP companion actually attaches and captures.

Add an integration harness with a fake/local CDP endpoint or equivalent deterministic protocol fixture proving:

- exactly one target is resolved;
- WebSocket attaches;
- only allowlisted commands are sent;
- checkpoint markers trigger the expected read-only captures;
- no `Input.*`, navigation, reload, generic evaluate, upload, network mutation or connector action exists;
- clipped screenshots are used, never full-page screenshots;
- real-style surface contract generation works;
- Atlas stop/export produces a coherent raw session.

## User capture runbook

The fixed manual script is now stored at:

```text
docs/live-atlas/CAPTURE_THREAD_RUNBOOK.md
```

Do not ask the user to begin it until this Goal passes.

## Pre-capture acceptance gate

The first real multi-round capture may start only when:

```text
CANDIDATE_BRANCH = codex/v020-convergence-pushable
CANDIDATE_RUNTIME = 0.2.0
REAL_CDP_WEBSOCKET_ATTACH_IMPLEMENTED = YES
REAL_DOMSNAPSHOT_CAPTURE_IMPLEMENTED = YES
CROPPED_SURFACE_SCREENSHOT_IMPLEMENTED = YES
RAW_SESSION_INGESTION = PASS
ATLAS_MUTATION_PATH_COALESCED = PASS
ATLAS_ON_TYPING_HOTPATH = PASS
MULTI_ROUND_GENERATIONS = PASS
CHECKPOINT_DEDUPLICATION = PASS
MULTI_ROUND_TIMING_PAIRING = PASS
REAL_DERIVED_FIXTURE_BUILDER = PASS
SCHEMA_PRIVACY_SANITIZER = PASS
CONTINUOUS_SESSION_TIMERS = PASS
READ_ONLY_CDP_PROTOCOL_TEST = PASS
AUTOMATED_SEND = NO
AUTOMATED_ENTER = NO
AUTOMATED_UPLOAD = NO
AUTOMATED_CONNECTOR_ACTION = NO
READY_FOR_DEDICATED_CAPTURE_THREAD = YES
```

Only after these gates pass should the user run the dedicated capture script. The real Atlas results may then drive further implementation/timer cleanup before the final Mica 0.2.0 acceptance.
