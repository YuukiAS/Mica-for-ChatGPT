# 2026-09-03 Composer Lifecycle Regression Investigation

## Context

This investigation covers the `v0.1.0-alpha.3` regression reported from real Edge usage. The user provided screenshots showing:

- a sent message already present in the conversation, with the assistant response present after tens of seconds, while the bottom ChatGPT composer still retained the sent text;
- the conversation body still visible while the normally fixed bottom composer temporarily disappeared.

Per `AGENTS.md`, this investigation did not automate the user's normal Edge session and did not access authenticated ChatGPT. Reproduction coverage was built with local synthetic fixtures in an isolated Playwright Chromium instance.

On 2026-09-03, the user additionally confirmed an A/B result: with Mica disabled in `edge://extensions`, cutting/removing the same composer text no longer made the composer disappear. With Mica enabled from `D:\Code\Mica-for-ChatGPT\dist\mica-v0.1.0`, cutting the whole composer text could still trigger a temporary composer disappearance.

Later on 2026-09-03, after the first quiet-window patch, the user provided another real diagnostics report from the latest unpacked build. It still showed the cut/delete disappearance. The report confirmed:

- `optimizedTurns: 0` and `optimizationIntersections: 0`;
- compact overlay was already static: `overlay.staticPlacements: 7`;
- composer-only/lifecycle mutation protection was active: `mutationBatchesIgnored: 4`, `lifecycleMutationBatchesIgnored: 6`;
- but edit-event quieting did not fire: `editScansSkipped: 0`;
- composer still disappeared for a long real interval: `maxMissingDurationMs: 5746`.

## Confirmed In Code

- `extension/src/content.ts` used a broad `article` fallback in turn discovery. This could classify non-message article-like regions as conversation turns if the current DOM shape changed.
- The alpha.3 composer detection was only used for overlay placement. It did not create a hard safety boundary for long-thread optimization.
- `applyOptimization()` could apply `content-visibility` / containment to any offscreen candidate turn that passed turn recognition and viewport checks.
- The previous protection logic only looked at the current DOM frame. If ChatGPT temporarily unmounted or replaced the composer, there was no recent composer root, ancestor, or rect cache to keep related active regions protected during that lifecycle gap.
- A real diagnostics report captured during the cut/delete reproduction showed `Native only`, `optimizedTurns: 0`, `optimizationIntersections: 0`, `submitEvents: 0`, and `sendClickEvents: 0`, while composer lifecycle counters still showed repeated mount/unmount and `maxMissingDurationMs: 1859`.
- The synthetic E2E initially reproduced the remaining risk as observation pressure rather than containment: composer text deletion caused Mica to read composer geometry during the delete window, because global mutation handling still scheduled scan / overlay placement work for composer text mutations and already queued scans could run during active editing.
- The second real report indicated the edit-event guard was still too narrow. The most likely DOM compatibility gap was relying on exact `contenteditable="true"` selectors while current ChatGPT can use another valid `contenteditable` value, such as `plaintext-only`, or dispatch edit events from descendants inside the editable root.

## Inferred From User Evidence

- The stale composer text is consistent with Mica interfering with a ChatGPT-controlled composer lifecycle window rather than Mica directly clearing or setting text. Mica does not intentionally write composer value, text, or contenteditable state.
- The temporary composer disappearance is consistent with ChatGPT unmounting/remounting the composer during editing/send/streaming while Mica simultaneously scans, reads layout, or updates overlay state.
- The exact private ChatGPT React lifecycle was not confirmed, because automated real ChatGPT testing is intentionally out of scope.

## Ruled Out

- Mica does not intentionally clear the composer after send. That remains ChatGPT native React state responsibility.
- Mica does not dispatch `input`, `change`, or `submit` events as part of the fix.
- The remaining cut/delete disappearance was not caused by `.mica-turn-optimized` containment being applied to the composer, because the real report showed `optimizedTurns: 0` and `optimizationIntersections: 0`.
- The known-interruption auto-dismiss rule was not expanded and does not retry, reload, resend, or create network traffic.
- The overlay collision avoidance itself reads geometry only; it does not edit composer DOM. However, the real A/B indicates even this observation path should avoid composer during active editing.

## Fix

- Tightened conversation turn discovery by removing the generic `article` selector fallback. A candidate now needs ChatGPT-like role/testid evidence before it can become a turn.
- Added a composer lifecycle tracker that records only privacy-safe state:
  - existence and visibility;
  - current character length, not text;
  - mount/unmount counts;
  - element identity changes;
  - longest missing duration;
  - whether optimization ever intersected composer ancestry;
  - optimization apply/remove counts during send windows.
- Added a hard optimization boundary: Mica will not optimize the composer itself, its descendants, its safe root, recent composer ancestors, or the recent composer rect protection zone.
- During a short send/remount lifecycle window, Mica pauses new long-thread optimization changes and only removes unsafe existing optimizations.
- Overlay placement now refreshes the shared composer lifecycle state before placement, keeping overlay and optimization safety aligned.
- Added a composer editing quiet window triggered by `beforeinput`, `input`, `cut`, `paste`, and editing keys. While active, `scanAndApply()` returns without reading composer geometry.
- Composer-only text mutations are now ignored by the global `MutationObserver` path instead of scheduling scan / overlay placement work.
- Compact overlay placement now uses a static top-right position and does not read composer geometry or attach a composer `ResizeObserver`. Composer-aware collision placement is reserved for expanded status/toast cases where it is actually needed.
- Replaced exact `[contenteditable='true']` matching with `[contenteditable]` / `isContentEditable`-aware composer detection, including descendant event targets inside the editable root.
- Added diagnostics `extension.buildLabel`, currently `composer-edit-quiet.3`, so local post-alpha.3 builds can be distinguished even while the release `version_name` remains `0.1.0-alpha.3`.
- During composer edit/send quiet windows, Mica now disconnects the global document `MutationObserver` and reconnects it after the quiet window, reducing observer pressure rather than only returning early inside the callback.

## Synthetic E2E Coverage

The new browser-level fixture `tests/fixtures/composer-lifecycle.html` simulates:

- native baseline without Mica;
- Mica enabled;
- Mica disabled;
- text entry and submit;
- user turn insertion;
- native composer clear;
- composer unmount/remount;
- composer DOM identity replacement;
- stale editable state restoration before native clear;
- assistant streaming mutations;
- send/stop button structure changes;
- composer height changes;
- multi-line input;
- full-text cut/delete inside the composer without send;
- mounted turn churn / native virtualization-like rerenders;
- quick next-turn input;
- scroll and resize interleaving;
- overlay compact/expanded presence.

Core assertions include:

- final composer content is empty after send;
- next input can be typed immediately;
- Mica does not create extra composer missing state compared with baseline tolerance;
- `.mica-turn-optimized` never contains the composer and is never inside composer ancestry;
- no optimization appears near the recent missing composer rect;
- Mica does not trigger input/change/submit;
- cutting/deleting the composer text does not make the composer disappear;
- cutting/deleting composer text does not cause Mica to read composer geometry during the active edit window;
- `contenteditable="plaintext-only"` composer roots and edit events dispatched from editable descendants;
- disabled Mica produces native baseline behavior;
- diagnostics do not include synthetic message text.

## Remaining Manual Validation

The synthetic fixture cannot prove the exact current ChatGPT private React lifecycle. The following still requires user manual Edge validation on real ChatGPT:

- send a normal message in a long thread and confirm the composer clears permanently;
- watch for temporary composer disappearance during streaming;
- copy Mica diagnostics after a real send and confirm composer `textLength` returns to `0`, `optimizationIntersections` remains `0`, and `optimizationChangesPaused` only appears during the send/remount window;
- copy Mica diagnostics after cutting/deleting composer text and confirm `extension.buildLabel` is `composer-edit-quiet.3`, `composer.textLength` returns to `0`, `composer.optimizationIntersections` remains `0`, and either `composer.editEvents` or `composer.mutationObserverPaused` indicates the edit quiet window was active;
- repeat on the 8 GB MacBook Neo before deciding whether P0 is complete.

## Test Results

- `npm test`: passed.
- `npm run test:e2e`: passed with native/Mica/Mica-disabled modes at 1200, 700, and 500 px widths, 24 send lifecycle loops and 24 cut/delete cycles per case.
- `npm run test:e2e:stress`: passed with native/Mica modes at 1200, 900, 700, and 500 px widths, 72 send lifecycle loops and 72 cut/delete cycles per case, plus Mica-disabled at 700 px.
- In the final stress run, Mica reported `optimizationIntersections: 0`, `optimizationApplyDuringSend: 0`, and `optimizationRemoveDuringSend: 0` for all enabled Mica cases. The fixture also reported no stale final composer text, no final composer missing state, no optimized composer ancestry, no overlay/composer collision, no composer geometry reads during cut/delete, and no Mica-triggered input/change/submit events.
