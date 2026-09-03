# 2026-09-03 Composer native-safe inert follow-up

## Context

Browser: user-reported Microsoft Edge with Mica for ChatGPT loaded from `dist/mica-v0.1.0`.

Observed build before this change:

- Manifest version: `0.1.0`
- Version name: `0.1.0-alpha.3`
- Build label: `composer-edit-quiet.3`

The user provided real-page screenshots and diagnostics showing two composer regressions after earlier alpha.3 fixes:

- Cutting all text from the ChatGPT composer now clears the text, but the composer still briefly disappears.
- The disappearance can last several seconds in diagnostics.

## Confirmed From User Diagnostics

- The page is in a small mounted-turn state: 5 to 6 mounted conversation turns.
- Mica status is `Native only`, with `optimizedTurns: 0`.
- There are no recorded optimization/composer intersections:
  - `optimizationIntersections: 0`
  - `optimizationApplyDuringSend: 0`
  - `optimizationRemoveDuringSend: 0`
- Composer lifecycle still changes on the real page:
  - `mountCount: 3`
  - `unmountCount: 2`
  - `identityChanges: 2` in one report
  - `maxMissingDurationMs` observed around 4.4s to 6.3s

This rules out the most direct failure mode where `.mica-turn-optimized` is applied to the composer, one of its ancestors, or a nearby active region.

## Inferred Risk

Before this change, even when Mica reported `Native only` and had zero optimized turns, the content script still kept several live integration surfaces active:

- a document-wide `MutationObserver`;
- capture-phase composer lifecycle listeners for `beforeinput`, `input`, `cut`, `paste`, `keydown`, `submit`, and `click`;
- overlay/composer placement logic that could read composer geometry when expanded or showing toast;
- turn `ResizeObserver` setup before the Native-only threshold check.

The real ChatGPT composer appears to unmount/remount or replace DOM identity during edit/send state changes. The remaining Mica observers/listeners were read-only, but they still ran synchronously in the same event/mutation windows as ChatGPT React state updates. The suspected remaining risk is observer/listener timing interaction rather than incorrect containment.

## Fix Path

This iteration changes the small mounted-turn path to an explicit native-safe inert mode:

- If Mica sees no turns, ambiguous turns, unsupported browser state, disabled state, or `turns.length <= nativeOnlyTurnThreshold`, it enters native-safe mode.
- Native-safe mode disconnects document `MutationObserver`.
- Native-safe mode detaches composer lifecycle listeners.
- Native-safe mode disconnects overlay composer `ResizeObserver`.
- Native-safe mode disconnects turn `ResizeObserver` observations.
- The small mounted-turn path returns before updating composer state or observing turns.
- The interval in native-safe mode only performs low-contact known-interruption scanning and URL-change handling.
- Diagnostics now include runtime state:
  - `runtime.nativeSafeMode`
  - `runtime.nativeSafeReason`
  - `runtime.documentMutationObserverActive`
  - `runtime.composerLifecycleListenersAttached`
  - `runtime.nativeSafeModeEntries`

Build label was changed to `native-safe-inert.1` so real-page reports can distinguish this candidate from earlier alpha.3 experiments.

## Synthetic E2E Coverage

The local Playwright fixture was extended with a small-mounted window mode that renders 6 mounted turns, matching the real ChatGPT native virtualization shape reported by the user.

The suite covers:

- native baseline without Mica;
- Mica enabled;
- Mica disabled;
- 1200px, 900px, 700px, and 500px widths in stress mode;
- composer text input, full cut/delete, send, native clearing, unmount/remount, DOM identity replacement, streaming mutations, resize/scroll interleaving, and native virtualization;
- small-mounted Mica mode entering native-safe mode;
- no optimized composer ancestry;
- no optimized nodes near the missing composer area;
- no external input/change/submit events from Mica;
- no composer geometry reads during delete in the small-mounted native-safe path.

## Stress Result

`npm run test:e2e:stress` passed after this change.

In the small-mounted Mica stress case:

- `nativeSafeMode: true`
- `documentMutationObserverActive: false`
- `composerLifecycleListenersAttached: false`
- `composerGeometryReadsDuringDelete: 0`
- `optimizedClassChanges: 0`

## Remaining Manual Acceptance

Codex did not automate the user's real Edge profile or authenticated ChatGPT. The following remains manual:

- Reload the unpacked extension in Edge.
- Refresh the affected ChatGPT conversation.
- Confirm diagnostics show `buildLabel: "native-safe-inert.1"`.
- Confirm diagnostics show `runtime.nativeSafeMode: true` on the real small-mounted conversation.
- Repeat the full-text cut/delete action in the composer and observe whether the composer still disappears.

If the composer still disappears with `nativeSafeMode: true`, `documentMutationObserverActive: false`, and `composerLifecycleListenersAttached: false`, the remaining evidence would point strongly toward ChatGPT native composer lifecycle behavior or another extension/page factor rather than Mica's containment/observer path.
