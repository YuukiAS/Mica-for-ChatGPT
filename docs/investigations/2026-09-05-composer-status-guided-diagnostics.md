# 2026-09-05 Composer status + guided diagnostics follow-up

## Context

Baseline was synced from remote `main` on 2026-09-05 before implementation. The previous real Lenovo report for `native-safe-inert.1` showed an inconsistent mounted-turn state:

- `status.mountedTurns: 0`
- `mountedTurns.current: 5`
- `mountedTurnComplexity.count: 5`
- `runtime.nativeSafeMode: true`
- `runtime.documentMutationObserverActive: false`
- `runtime.composerLifecycleListenersAttached: false`

The likely failure was a timing deadlock: Mica's first scan could run before ChatGPT mounted conversation turns, enter native-safe mode with `0 mounted`, and then never refresh `currentStatus` because native-safe interval work only processed known interruptions while ordinary scans were intentionally blocked.

## Confirmed In Code

- `enterNativeSafeMode("no mounted turns")` disconnected the document `MutationObserver`, composer lifecycle listeners, overlay composer `ResizeObserver`, and turn resize observations.
- `scheduleScan()` refused most automatic scans while `runtimeState.nativeSafeMode` was true.
- The native-safe interval branch returned after `processKnownInterruptions()`, so later mounted turns could be present in the DOM while `currentStatus.mountedTurns` remained stale.
- Overlay placement still retained a composer-aware expanded/toast path, including composer geometry reads and an overlay composer `ResizeObserver`, even though compact status had been made top-right static.

## Fix

- Added `collectMountedTurnStatusProbe()` for native-safe status refresh. It only counts mounted conversation turns from role/testid evidence and does not call composer protection, composer lifecycle, composer geometry, or optimization paths.
- Added `refreshNativeSafeMountedStatus()`, called from the native-safe interval and diagnostics report generation. It updates `currentStatus`, `turnWindow.lastMountedCount`, and diagnostics counters while keeping native-safe mode active for small mounted windows.
- `nativeSafeReason` is synchronized to the latest native-safe condition, so a page that moves from `0` to a small mounted window no longer keeps reporting `no mounted turns`.
- If the mounted turn count grows beyond `nativeOnlyTurnThreshold`, native-safe exits through an explicit `native-safe-mounted-probe:*` scan handoff instead of silently enabling observers.
- Stopped refreshing composer state from `snapshotComposerState()` while native-safe is active, so ordinary diagnostics reports no longer touch composer just to export runtime state.
- Replaced composer-aware overlay placement with viewport-only static placement:
  - compact status uses `bottom-right-static`;
  - expanded status and known-interruption toast use `top-right-static`;
  - the overlay path no longer attaches a composer `ResizeObserver` or reads composer geometry.
- Added `extension/src/reliability/composer-diagnostics.ts` as a separate guided composer diagnostic module loaded before `content.js`.
- Popup now exposes `Run composer check`, `Next step`, `Stop check`, and `Copy report` for guided composer diagnostics.

## Guided Diagnostics Privacy And Safety

The guided composer diagnostic session runs only after the user explicitly starts it from the popup or fixture test hook. When idle, it has no composer sampler.

During a session it uses a 150 ms timer to record privacy-safe structural data:

- composer/editable existence;
- session-local editable/root identity ids;
- tag, role, contenteditable, and testid metadata;
- text length only, never prompt or answer text;
- mounted turn count and user turn count;
- Mica runtime flags, including native-safe and observer/listener state.

It does not use a document-wide `MutationObserver`, does not modify composer DOM, does not dispatch input/change/submit, does not click send or connector UI, does not select GitHub, does not reload/retry/regenerate, and does not read request bodies, headers, or tokens.

The page overlay is a static top-right guide card and is separate from the bottom-right compact status dot.

## Synthetic Coverage Added

`tests/fixtures/composer-guided-diagnostics.html` covers:

- Mica starts with 0 turns, enters native-safe, then delayed turns mount to 6 and status updates automatically.
- Mounted turn churn 6 -> 7 -> 6 updates `status.mountedTurns`, `mountedTurns.current`, and `mountedTurns.lastObserved`.
- Native-safe remains true and keeps `documentMutationObserverActive: false` and `composerLifecycleListenersAttached: false`.
- Compact status reaches the viewport bottom-right static placement.
- Guided normal delete observes non-zero then zero text length.
- Mention-like GitHub chip replacement records mention signal and editable identity change without Mica clicking or modifying connector UI.
- Manual-send surrogate observes a new user turn and stale text length after the native remount surrogate.
- Guided diagnostics report excludes fixture prompt and answer text.
- Guided sampler is inactive before the session starts.

## Test Results

- `npm test`: passed after the stable dev-path change; build output was `dist/mica-dev`.
- `npm run test:e2e`: passed after fixture paths were moved to `dist/mica-dev`.
- `npm run test:e2e:stress`: passed earlier in this `0.1.4` lifecycle candidate; not rerun after build-path-only changes.

All browser E2E runs used isolated Playwright Chromium against local fixtures only. Codex did not automate the user's Edge profile, did not log into ChatGPT, and did not send a real ChatGPT message.

## Remaining Manual Acceptance

Reload the unpacked extension from:

```text
C:\Code\Mica-for-ChatGPT\dist\mica-dev
```

Then refresh the target ChatGPT conversation manually and run the popup `Run composer check` flow:

1. Type `abc test`, press Ctrl+A then Delete, and do not send.
2. Type `@GitHub`, select GitHub from ChatGPT's own candidates, press Ctrl+A then Delete, and do not send.
3. Type one very short test message and click Send yourself.
4. Copy the generated report.

No Console JavaScript step is required for this build.
