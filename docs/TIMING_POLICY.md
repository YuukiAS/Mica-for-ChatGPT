# Timing Policy

Mica 0.2.0 treats timing constants as fallback safety bounds, not as the primary
way to infer ChatGPT state. The primary path should be event-driven whenever the
page exposes a reliable transition: DOM mount/remount, composer input events,
user-turn insertion, assistant content mutation, action-bar availability, Mica
copy invocation, or explicit diagnostic session lifecycle.

## Atlas Evidence Rule

Live Surface Atlas records timing on one monotonic page timeline. Raw capture
artifacts stay in `artifacts/live-atlas/` and are gitignored. Repository fixtures
may only use sanitized contracts that pass the Atlas privacy validator.

For every production timing constant that remains after Atlas capture exists,
the expected evidence path is:

1. Atlas observes the real transition envelope.
2. `npm run atlas:analyze-timings` writes the current timing ledger.
3. The retained constant is either removed in favor of a real transition, or
   documented as a hard safety cap with an explicit margin over the observed
   envelope.

Until real Atlas evidence exists for a surface, Mica must fail open: avoid
guessing synthetic UI behavior, avoid stronger intervention, and keep native
ChatGPT behavior intact.

## Current Constants

The generated ledger in
`tests/contracts/chatgpt-live/synthetic-smoke/timing-ledger.json` is the
machine-readable inventory. This policy explains the current semantic groups.

### Page Runtime And Overlay

`FRAME_STALL_MS` is a diagnostics threshold for classifying frame delay. It does
not drive intervention. Atlas records `PerformanceEventTiming`,
`long-animation-frame`, `longtask`, and bounded counters so this threshold can be
rechecked against real sessions.

`OVERLAY_EXPAND_MS`, `TOAST_MS`, and `TOAST_MERGE_MS` are UI presentation
durations. They are not lifecycle inference. They may remain as bounded visual
caps as long as the overlay has zero persistent polling and stays compact by
default.

`COMPOSER_PROTECTION_MS`, `COMPOSER_SEND_ACTIVITY_MS`, and
`COMPOSER_EDIT_ACTIVITY_MS` are composer mutation-safety windows. The primary
path is composer identity, input, send-intent, user-turn commit, composer clear,
and remount events. Atlas should eventually justify or shrink these windows;
they must remain fail-open and cannot trigger automated send, Enter, retry, or
upload.

### Connector Lifecycle

`LATCH_TTL_MS`, `CHOOSER_ACTIVE_GRACE_MS`, `SELECTION_WINDOW_MS`, and
`MENTION_QUERY_MS` bound connector/mention state freshness. The primary path is
observed mention chooser visibility, connector pill identity, and composer
surface changes. The TTL is only state validity; ordinary typing must never use
the TTL as a reason to rediscover the page, clone DOM, enumerate turns, or read
layout/style.

`WATCH_WINDOW_MS`, `SHELL_HARD_CAP_MS`, and `SNAPSHOT_FRESHNESS_MS` bound the
connector continuity shell. The preferred path is observed shell mount/remount
and connector pill continuity. The hard cap prevents stale visual shells from
remaining when the real surface does not confirm continuity.

### Composer Reliability

`SAMPLE_INTERVAL_MS` in recovery modules is temporary diagnostic/recovery
polling. It may only be active inside a bounded generation and must stop after
completion or hard-cap expiry. Atlas should replace these where real
transitions can be observed directly.

`HARD_LIFETIME_MS`, `HARD_GUARD_CAP_MS`, `GUARD_DURATION_MS`, and related
timeout constants are hard safety caps. They exist to ensure recovery logic
terminates and fails native when the expected real transition is missing.

`SETTLE_MS`, `VERIFY_MS`, `NONMATCHING_GRACE_MS`, `QUIET_WINDOW_MS`,
`USER_TURN_STALE_GRACE_MS`, `CORRELATION_WINDOW_MS`, and
`SEND_CANDIDATE_WINDOW_MS` are lifecycle heuristics. Their primary replacement
targets are Atlas-confirmed user-turn commit, composer clear/remount, assistant
mount, first content mutation, streaming cadence, settled state, and action-bar
availability.

`FULL_SELECTION_INTENT_MS`, `CLEAR_CONFIRMATION_WINDOW_MS`, and
`CLEAR_CONFIRMATION_TIMEOUTS_MS` are bounded clear/delete confirmation aids.
They must remain tied to explicit user input and must not synthesize submit
paths.

### Atlas Recorder

`MUTATION_FLUSH_MS` coalesces active Atlas structural observation. It is active
only during an explicit Atlas session.

`SETTLED_IDLE_MS` detects assistant stream quietness after real content
mutation. The primary signal is mutation cadence; the timeout is a bounded
settle classifier until action-bar/stream-state evidence is stronger.

`ASSISTANT_SETTLED_HARD_CAP_MS` prevents Atlas from waiting indefinitely for a
settled signal. It records a hard-cap checkpoint rather than changing page
behavior.

When Atlas is off, it must leave zero Atlas `MutationObserver`, zero Atlas
polling/timers, zero Atlas typing-listener runtime cost, and zero CDP
connection.
