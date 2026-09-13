# Goal 014 — Convert the real Atlas run into durable ChatGPT ground truth

Status: **BLOCKING 0.2.0 FINAL ACCEPTANCE**

Branch: `codex/v020-convergence-pushable`

Starting point: `bf1618d Reduce live atlas heavy capture volume` (`v020-convergence.rc7`).

## Why this goal exists

The point of Live Surface Atlas is not to make the user repeat long manual QA. A real authenticated run should teach Mica enough about ChatGPT's current DOM/UI/lifecycle that most future validation can be replayed locally.

The completed 2026-09-13 Round 1–6 run is therefore a **ground-truth acquisition run**, not just a performance test.

Local raw source (must remain local / gitignored):

`artifacts/live-atlas/capture-1789266647815`

Do **not** commit the raw bundle, raw screenshots, prompt/answer text, conversation IDs, account data, connector payloads, or unsanitized DOM.

## Known facts from the real run

The old capture policy produced 168 heavy visual captures and visibly disturbed the page. `bf1618d` replays the same lifecycle with 30 total heavy captures and only 2 in the Round-6 connector window. That performance fix is necessary but not sufficient.

The same real artifact also exposed **ground-truth quality failures** that must be fixed before Atlas can replace manual QA:

- 145 screenshots were produced; roughly 107 were >98% white.
- `composer`: 66 observed captures, but 63 resolved to a `button` instead of the composer/editor surface; many screenshots were about `116×2` px.
- `longThreadMountedWindow`: 10 observed captures all resolved to a small `div` and screenshots collapsed to about `2×142` px instead of the conversation viewport/window.
- `connectorPill`: 9 observed contracts, but several screenshot clips collapsed to about 1 CSS pixel high.
- `mentionChooser`: recorder observed the lifecycle, but CDP visual resolution missed all 3 instances.
- `micaCopy`: no trustworthy real visual/behavior acceptance was obtained.
- the long-thread optimization path was not actually exercised in this run (`optimizedTurns = 0` / native-only path), so it is not accepted by this artifact.
- connector continuity and send-residual recovery were not accepted as Mica features merely because the native ChatGPT connector flow completed.

These are not reasons to repeat Round 1–6. They are inputs for local convergence.

## Required outcome

Turn this one real run into a **sanitized, committed, replayable ChatGPT Live Contract Pack** that future code changes can test locally.

The committed pack should encode stable structure and behavior, not private content and not brittle full-DOM snapshots.

Target location:

`tests/contracts/chatgpt-live/real-2026-09-13/`

Suggested contents (adjust names if needed):

- `manifest.json` — source provenance without conversation/account identifiers
- `surfaces.json` — sanitized surface contracts + variants
- `lifecycle.json` — composer / generation / connector / copy state-machine evidence
- `timings.json` — event/timing classes; mark the old run as measurement-disturbed, not a product performance baseline
- `selectors.json` — stable candidate selectors / semantic invariants derived from the real DOM
- `feature-matrix.json` — what was actually exercised vs not exercised
- `fixture.html` — sanitized replay fixture

No raw screenshot needs to be committed unless it is demonstrably privacy-safe and specifically required. Prefer sanitized structural contracts.

## P0 — Fix visual ground-truth correctness

### 1. Semantic surface validators

A CDP match must satisfy a surface-specific semantic validator before it can be accepted.

Examples:

- `composer`: must be the composer root/editor region or editable owner; **must not resolve to the Send button**.
- `longThreadMountedWindow`: must represent the main conversation/mounted-turn window, not an arbitrary small `div`.
- `mentionChooser`: must resolve the visible chooser/listbox episode.
- `connectorPill`: must resolve the selected connector pill itself.
- `assistantActionBar`: must resolve the assistant-owned toolbar/action area.
- `micaOverlay`: must resolve the Mica-owned overlay root.

If semantic validation fails, record `MISSING/AMBIGUOUS`; never silently accept the nearest wrong node.

### 2. Coordinate/clip integrity

Fix document/viewport/zoom/captureBeyondViewport handling so valid offscreen document rectangles do not collapse to 1–2 px clips.

Add invariants such as:

- clip width/height must correspond to the resolved document rect after zoom conversion;
- nontrivial surfaces cannot collapse to ~1 px because of content/viewport clamping;
- screenshot dimensions must be plausible for that surface class;
- stored `contract.rect`, `documentRect`, `viewportRect`, and screenshot clip must have an explicit coordinate-space relationship.

Create real-shape regression fixtures reproducing the 0.9 zoom / offscreen-Y cases from this artifact.

### 3. High-priority ephemeral surfaces

`mentionChooser` and meaningful connector state transitions must remain high priority and be captured before low-value backlog. The real lifecycle saw the chooser; the visual resolver must not miss it.

## P0 — Materialize real contracts, not raw data

Add a deterministic command/workflow that takes a **local raw Atlas bundle** and produces a commit-safe contract pack, for example:

`npm run atlas:materialize-contracts -- --input=<raw> --output=tests/contracts/chatgpt-live/real-2026-09-13`

It must:

1. sanitize/privacy-check;
2. validate semantic surfaces and screenshot-coordinate evidence;
3. build lifecycle + feature matrix;
4. build replay fixture;
5. refuse to write commit-ready output if raw/private text or identifiers remain;
6. produce a concise audit report showing observed/missing/ambiguous surfaces and exercised/unexercised features.

## P1 — Convert UI/lifecycle knowledge into implementation tests

Use the committed real contract pack to test Mica behavior locally.

At minimum cover:

### Composer lifecycle

- focus / blur are event evidence, not visual churn;
- identity/remount is distinguished from ordinary edit events;
- typed text remains continuous across remounts;
- stale-clear recovery only acts when its actual failure condition occurs.

### Assistant generation lifecycle

- one user send maps to one new assistant generation;
- old virtualized/remounted assistants never become the current generation;
- first content, streaming, settled, rich markdown, and action-bar ownership are deterministic.

### Connector lifecycle

- mention chooser episode;
- connector pill selected/configured episode;
- composer continuity through connector UI remounts;
- no old-turn remount is mistaken for a new generation.

### Markdown / Mica Copy

Use the real rich-Markdown structure to verify serialization of headings, nested lists, blockquote, fenced code, table, inline math, and display math (`$$ ... $$`).

A real Mica Copy invocation must be distinguishable from native Copy. If current instrumentation cannot prove this, fix the instrumentation and add a local fixture test.

### Long-thread optimization

The previous real run did **not** accept this feature. Build a fixture from the observed real turn structure that forces the Mica optimization path and verifies:

- protected recent/viewport/composer/special turns remain untouched;
- eligible old turns receive containment only;
- no React DOM deletion;
- composer is never optimized/protected incorrectly;
- native virtualization is detected and respected.

### Reliability features

Build deterministic fixture cases for:

- connector continuity enabled;
- send residual recovery enabled;
- composer recovery enabled;
- feature-off behavior;
- Atlas OFF = zero Atlas observer/timer/CDP overhead.

## Feature acceptance matrix

Do not infer feature PASS merely because native ChatGPT completed a flow.

The final contract pack/report must classify each feature as one of:

- `EXERCISED_AND_PASS`
- `EXERCISED_AND_FAIL`
- `OBSERVED_NATIVE_ONLY`
- `NOT_EXERCISED`

Required entries:

- long-thread optimization
- Mica Markdown Copy
- composer recovery
- connector continuity
- send residual recovery
- auto-dismiss known interruptions
- Atlas recorder OFF overhead
- Atlas recorder ON low-overhead capture

## Manual-QA policy after Goal 014

Do **not** ask the user to repeat Round 1–6.

After the real contract pack, semantic resolver fixes, and replay tests all pass, user involvement should be limited to **one short 60–90 second authenticated acceptance**:

1. Start Atlas.
2. Type a short English + Chinese draft.
3. Manually choose the GitHub connector.
4. Send one short read-only connector request manually.
5. Wait for the answer.
6. Stop Atlas.

This final run is only to confirm that the new low-overhead recorder and the current live ChatGPT UI still agree with the committed contracts. It is not another data-discovery run.

## Required tests

- semantic surface resolver tests using shapes extracted from the 2026-09-13 real artifact
- offscreen/zoom screenshot-coordinate tests
- mention chooser / connector pill priority tests
- sanitizer/privacy test
- real contract-pack replay test
- composer lifecycle replay
- assistant generation replay
- rich Markdown + Mica Copy replay
- long-thread optimization replay
- connector continuity / send residual recovery replay
- `npm run test:atlas`
- `npm test`
- `npm run test:integration`
- full E2E only when extension runtime changes warrant it

## Completion report

Return:

```text
REAL_CONTRACT_PACK = PASS/FAIL
RAW_ARTIFACT_COMMITTED = NO
PRIVACY_CHECK = PASS/FAIL

COMPOSER_SURFACE_VALID = PASS/FAIL
LONG_THREAD_WINDOW_SURFACE_VALID = PASS/FAIL
MENTION_CHOOSER_SURFACE_VALID = PASS/FAIL
CONNECTOR_PILL_SURFACE_VALID = PASS/FAIL
SCREENSHOT_COORDINATE_INTEGRITY = PASS/FAIL
WHITE_OR_COLLAPSED_CAPTURE_REGRESSION = PASS/FAIL

LIFECYCLE_REPLAY = PASS/FAIL
ASSISTANT_GENERATION_REPLAY = PASS/FAIL
RICH_MARKDOWN_REPLAY = PASS/FAIL
MICA_COPY_REPLAY = PASS/FAIL
LONG_THREAD_OPTIMIZATION_REPLAY = PASS/FAIL
CONNECTOR_CONTINUITY_REPLAY = PASS/FAIL
SEND_RESIDUAL_REPLAY = PASS/FAIL
ATLAS_OFF_ZERO_OVERHEAD = PASS/FAIL

FEATURE_MATRIX = <path>
CONTRACT_PACK = <path>
AUDIT_REPORT = <path>

ATLAS_TEST =
FAST_TEST =
INTEGRATION_TEST =
VERSION = 0.2.0
BUILD_LABEL =
PUSHED =
READY_FOR_ONE_SHORT_FINAL_ACCEPTANCE = YES/NO
```

## Principle

The success criterion is not “Atlas captured many things.” It is:

**one real authenticated capture becomes durable, sanitized knowledge about ChatGPT's JS/UI/lifecycle, and future Mica changes are mostly validated against that knowledge without repeatedly asking the user to reproduce the same flows.**
