# Goal 007 — Live Surface Atlas: real ChatGPT UI + lifecycle corpus

## Objective

Before spending the single remaining authenticated-send acceptance on Mica 0.2.0, build a reusable Live Surface Atlas that turns a small number of manually driven real ChatGPT rounds into durable, privacy-safe test ground truth.

The target loop is:

```text
real dedicated thread
  -> passive in-page lifecycle recorder
  -> read-only Edge/CDP visual+DOM capture
  -> sanitized atlas bundle
  -> generated fixtures + timing corpus
  -> Playwright offline replay/regression
```

The user should not remain the routine QA runner. After the bootstrap capture, most DOM/UI/typing/copy/overlay/remount issues must be reproducible without sending more real prompts.

## Non-negotiable browser safety boundary

This goal does not relax the existing Real Edge Safe Probe policy.

Agents / Computer Use / browser tools / CDP automation must never:

- Send a ChatGPT message;
- press Enter or Ctrl+Enter in the real composer;
- submit a form or call `requestSubmit` / `form.submit`;
- upload or attach a file/image;
- invoke a connector/tool;
- select or execute `@GitHub`, Gmail, Drive, or any external integration;
- retry, regenerate, Stop, delete, edit a real conversation, authorize OAuth, mutate account settings, pay, purchase, or confirm consequential actions;
- navigate/reload a set of authenticated conversations for testing.

The user may manually send in a dedicated harmless capture thread while the recorder is passively armed. The recorder and companion tools must only observe.

If any implementation cannot technically enforce this boundary, fail closed and do not use that path.

## Tooling decision

### 1. Primary recorder: Mica in-page Atlas Recorder

Implement an Advanced/dev-only `Live Atlas capture` mode inside Mica. This is the authoritative source for high-resolution lifecycle timing because it runs continuously in the page without needing external polling.

It must be completely inactive outside an explicit capture session.

When active, record only privacy-safe structural/timing evidence using `performance.now()` as the monotonic time base plus an epoch anchor.

Use event-driven capture, not fixed high-frequency polling.

Capture at least:

- composer focus/blur;
- keydown metadata limited to semantic class, never raw typed characters;
- beforeinput/input inputType and composition lifecycle, never prompt text;
- composer root/editable/surface identity changes;
- composer present/missing/remount transitions;
- connector/mention chooser structural state and resolved pill presence;
- send-intent signal when the user manually sends;
- new user-turn mount;
- composer clear/remount after commit;
- assistant-turn mount;
- first assistant content mutation;
- bounded streaming mutation bursts and gaps;
- assistant settled/action-bar-visible transition;
- Mica overlay state changes;
- Mica Copy action availability/invocation;
- mounted-turn window changes;
- relevant Mica runtime state transitions.

The recorder may observe targeted DOM subtrees with bounded `MutationObserver`s while capture is active. It must not persist raw DOM or conversation text.

### 2. Performance evidence

While Atlas recording is active, collect supported Chromium performance primitives:

- `PerformanceEventTiming` for input delay, event processing duration, and interaction duration;
- `long-animation-frame` entries when available, retaining only a bounded worst-N summary;
- `longtask` fallback/companion summary;
- layout-shift summary if supported and useful;
- JS heap snapshot counters when `performance.memory` is available;
- bounded mutation counts and mounted-turn counts.

Do not run a permanent requestAnimationFrame profiler if native performance entries are sufficient. If a frame-gap fallback is needed, enable it only inside the explicit Atlas session and keep only histograms/worst-N values.

### 3. Read-only local CDP companion

Implement a local Node script such as:

```text
scripts/live-atlas-cdp.mjs
```

It attaches to a user-opened Microsoft Edge tab through local remote debugging/CDP. It must target exactly one explicit `chatgpt.com` capture thread and refuse ambiguous/multiple targets.

Do not use Playwright Trace against the authenticated real site. Raw Playwright traces contain broad DOM/network evidence and are unnecessarily heavy for this use case.

The CDP companion exposes no generic action API. Use an explicit command allowlist only, centered on read-only commands such as:

- target discovery for the exact allowed ChatGPT tab;
- Runtime/console event observation required for Atlas checkpoint markers;
- `DOMSnapshot.captureSnapshot` with a small computed-style whitelist;
- page/layout metrics required for crop coordinates;
- read-only screenshot capture;
- `Performance.getMetrics` if useful.

Never call CDP `Input.*`, `Page.navigate`, reload, form/input automation, mutating Network methods, or arbitrary user-supplied `Runtime.evaluate`.

If fixed `Runtime.evaluate` helpers are unavoidable, hard-code them in source, make them read-only, accept no arbitrary expression parameter, and test the command allowlist.

### 4. Checkpoint bridge

The in-page Atlas Recorder owns exact state-transition timestamps. The external CDP companion only captures visual/structural checkpoints when requested.

Prefer a one-way passive checkpoint signal such as a fixed Mica console marker containing only:

```text
checkpointId
stateClass
monotonicTimestamp
```

No prompt/answer content.

The CDP companion listens for these markers and immediately captures the relevant surface contract/crop. Exact lifecycle timing comes from the in-page recorder; visual capture latency is not treated as the UI transition latency.

### 5. Offline replay: Playwright

Use Playwright only after sanitization, against local generated fixtures.

Generated fixtures should reproduce the observed surface structure and lifecycle sequence with deterministic/virtual time. Playwright then handles:

- functional regression;
- visual regression;
- viewport/theme variants;
- Copy/action-bar placement;
- overlay collision/geometry;
- lifecycle replay.

## Atlas data model

Raw capture artifacts must remain local and gitignored, for example:

```text
artifacts/live-atlas/<session-id>/
```

Do not commit raw DOMSnapshot output, full-page screenshots, cookies, headers, request bodies, or arbitrary network traces to the public repository.

A capture session should produce a local bundle such as:

```text
manifest.json
timeline.ndjson
performance.json
timing-summary.json
coverage.json
surfaces/*.json
screenshots/*.png
```

Only sanitized derived contracts that pass privacy validation may enter the repository, for example:

```text
tests/contracts/chatgpt-live/<date>/<surface>.json
tests/contracts/chatgpt-live/<date>/lifecycle.json
tests/contracts/chatgpt-live/<date>/timings.json
```

## Privacy rules

Never persist:

- raw prompt/answer text;
- conversation titles;
- sidebar history;
- account name/avatar identifiers;
- attachment names/URLs;
- connector payloads;
- repository/file names from real connector content;
- cookies/tokens;
- request/response bodies;
- raw headers;
- full raw HTML/DOM dumps.

Structural contract fields may include:

- tag;
- role;
- approved stable `data-*` / aria attributes;
- contenteditable/disabled/expanded/pressed states;
- parent-child/containment relationships;
- child count/role skeleton;
- bounding rectangles;
- selected computed styles;
- anonymized stable node identities;
- text category and length only where necessary.

Generic product UI labels such as Copy/Retry/Stop may be retained only through an explicit allowlist if needed for selector ground truth.

Screenshot policy:

- default to cropped surface screenshots, not full viewport;
- never capture sidebar/history/account chrome;
- dedicated capture thread must contain harmless content only;
- keep live screenshot crops local by default;
- committed visual baselines, if any, must be explicitly redacted/sanitized first.

## Surface coverage map

Do not claim to capture literally every possible ChatGPT component. Maintain an explicit coverage map and mark observed/missing variants.

Initial Atlas should attempt to cover the surfaces Mica touches or can interfere with:

- conversation turn container;
- user turn and action area;
- assistant turn during streaming and settled;
- assistant action bar / native Copy area;
- heading/list/blockquote/table/code/math rendering;
- inline and display math;
- citations/source chips when available;
- composer idle/focused/typing/composition states;
- send-button idle/busy states;
- mention chooser and selected connector pill without agent-side connector execution;
- transient composer missing/remount state;
- Mica overlay compact/expanded/recording/toast states;
- tool/file/attachment/authorization cards only from already-existing user-opened safe examples, read-only;
- light/dark theme and representative viewport sizes when obtainable without mutating account settings.

Unknown/unobserved surfaces remain `MISSING`, not approximated by hand.

## Dedicated real capture thread

Use one dedicated harmless ChatGPT thread as the dynamic bootstrap corpus.

The recorder should run continuously across several user-manual rounds rather than start/stop for every prompt. The user manually drives all send actions.

A recommended capture script is 4–6 rounds:

1. Baseline/typing round: English + Chinese IME typing, correction/delete/paste, then a simple manual send.
2. Rich-answer round: request one answer containing heading, paragraph, nested list, blockquote, inline math, display math, fenced code, and a two-column Markdown table; let it stream to completion; invoke Copy after settled.
3. Streaming/longer-answer round: request a moderately longer structured answer so streaming mutation cadence, action-bar appearance, turn window changes, and post-settle behavior are captured.
4. Composer lifecycle round: exercise select-all/delete/cut and ordinary remount-prone interactions; no agent sends anything.
5. Mention/connector UI round: the user may manually open/select `@GitHub` to capture chooser/pill/remount UI, then clear it without sending if external connector execution is not desired.
6. Optional final connector-send acceptance round: only the user may choose and send, and only if desired after all pre-send Atlas gates pass. This can simultaneously become the final Mica 0.2.0 acceptance evidence.

The prompts themselves live only in the harmless dedicated test conversation; the Atlas does not save their text.

## Timing Atlas — replace magic milliseconds with evidence

Inventory every production timing constant (`*_MS`, timeout, grace, TTL, settle, debounce, polling interval) and classify it:

- visual animation only;
- sampling/diagnostic cadence;
- lifecycle heuristic;
- safety hard cap;
- retry/recovery timing.

For each lifecycle heuristic, first ask whether the transition can become event-driven. If yes, remove the timer dependency instead of tuning the number.

For remaining timing-dependent behavior, derive a named timing ledger from real Atlas sessions.

Measure at least:

```text
composer input event -> handler processing start/end
mention selection -> composer identity stable
manual send intent -> new user turn mounted
manual send intent -> composer body zero
composer missing -> composer remounted
new user turn -> assistant turn mounted
assistant turn mounted -> first content mutation
stream mutation gap distribution
last assistant mutation -> action bar visible
last assistant mutation -> settled classification
Mica runtime transition -> overlay update
```

For each metric report `n`, min, median, p90/p95 when meaningful, max, and robust spread (for example MAD). Do not treat 4–6 rounds as a universal production latency distribution; use them to understand ordering, reject bad assumptions, and establish a conservative observed envelope.

Do not tune UI lifecycle constants to server generation latency. Separate local/browser transitions from network/model latency.

Where a fallback safety cap remains necessary, document:

- semantic purpose;
- event-driven primary path;
- observed Atlas envelope;
- chosen margin;
- fail-open behavior.

Create/update a timing policy document such as:

```text
docs/TIMING_POLICY.md
```

The long-term objective is fewer timing constants, not merely better-looking numbers.

## Visual fidelity goal

The Atlas exists partly to prevent crude synthetic UI approximations.

For surfaces that Mica must visually stabilize or interact beside, generated fixtures should be derived from real contracts: hierarchy, geometry, style whitelist, control states, and local screenshot crops.

Do not hand-design a fake ChatGPT composer/dialog when a live contract exists.

For visual regression, mask dynamic text/content regions and compare stable geometry/component chrome. Do not require pixel equality for model-generated content.

Mica's own popup remains a branded Mica surface rather than a clone of ChatGPT, but its collision/placement behavior against ChatGPT surfaces should use live Atlas contracts.

## Performance budget of Atlas itself

Recording must not recreate the typing-lag incident.

When Atlas mode is OFF:

- zero Atlas observers;
- zero Atlas timers;
- zero Atlas event listeners beyond any existing minimal toggle plumbing;
- zero CDP companion connection.

When Atlas mode is ON:

- typing handlers remain lightweight;
- raw mutation traffic is coalesced into bounded structural summaries;
- no full-document snapshot per keystroke/mutation;
- screenshot/DOMSnapshot only on named structural checkpoints;
- bounded buffers with explicit caps;
- no permanent network tracing.

Add a focused regression proving Atlas OFF has no typing/runtime cost and Atlas ON does not trigger heavy DOM/style capture per input character.

## Build outputs / commands

Provide a simple local workflow, preferably commands like:

```text
npm run atlas:check
npm run atlas:capture
npm run atlas:sanitize
npm run atlas:build-fixtures
npm run atlas:analyze-timings
npm run test:atlas
```

`atlas:capture` must refuse to start unless:

- exactly one allowed ChatGPT capture tab is resolved;
- explicit local capture/session configuration exists;
- the target URL matches the dedicated thread allowlist;
- no generic browser action surface is enabled by the recorder.

The capture tool should print a clear read-only safety summary before attaching.

## Completion gate before Mica 0.2.0 manual acceptance

Do not ask the user to spend the final 0.2.0 acceptance send until:

- Atlas recorder implemented and tested;
- local read-only CDP companion implemented or a documented equally-safe fallback exists;
- privacy sanitizer/validator passes;
- at least one real composer/action-bar contract can be captured from the dedicated thread without sending;
- timing recorder can survive a continuous multi-round session;
- offline fixture generation/replay works;
- Atlas OFF typing performance regression passes;
- no automated Send/Enter/upload/connector action exists in the capture path.

Then run the dedicated user-manual capture rounds. The final round may double as the single Mica 0.2.0 manual acceptance if all prior Atlas gates are green.

## Final report

```text
LIVE_SURFACE_ATLAS = PASS/FAIL
ATLAS_RECORDER =
READ_ONLY_CDP_COMPANION =
PLAYWRIGHT_REAL_SITE_TRACE_USED = NO
COMPUTER_USE_REQUIRED = NO/ONLY_WINDOW_SETUP
AUTOMATED_SEND = NO
AUTOMATED_ENTER = NO
AUTOMATED_UPLOAD = NO
AUTOMATED_CONNECTOR_ACTION = NO

REAL_CONTRACT_CAPTURE =
SURFACE_COVERAGE =
DYNAMIC_TIMELINE =
PERFORMANCE_EVENT_TIMING =
LONG_ANIMATION_FRAMES =
TIMING_LEDGER =
MAGIC_MS_INVENTORY =
TIMERS_REMOVED_OR_EVENT_DRIVEN =

ATLAS_OFF_HOTPATH =
ATLAS_ON_HOTPATH =
PRIVACY_VALIDATION =
OFFLINE_FIXTURE_REPLAY =

READY_FOR_DEDICATED_CAPTURE_THREAD = YES/NO
READY_FOR_FINAL_020_ACCEPTANCE = YES/NO
```
