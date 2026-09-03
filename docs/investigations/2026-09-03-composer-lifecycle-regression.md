# 2026-09-03 Composer Lifecycle Regression Investigation

## Context

This investigation covers the `v0.1.0-alpha.3` regression reported from real Edge usage. The user provided screenshots showing:

- a sent message already present in the conversation, with the assistant response present after tens of seconds, while the bottom ChatGPT composer still retained the sent text;
- the conversation body still visible while the normally fixed bottom composer temporarily disappeared.

Per `AGENTS.md`, this investigation did not automate the user's normal Edge session and did not access authenticated ChatGPT. Reproduction coverage was built with local synthetic fixtures in an isolated Playwright Chromium instance.

## Confirmed In Code

- `extension/src/content.ts` used a broad `article` fallback in turn discovery. This could classify non-message article-like regions as conversation turns if the current DOM shape changed.
- The alpha.3 composer detection was only used for overlay placement. It did not create a hard safety boundary for long-thread optimization.
- `applyOptimization()` could apply `content-visibility` / containment to any offscreen candidate turn that passed turn recognition and viewport checks.
- The previous protection logic only looked at the current DOM frame. If ChatGPT temporarily unmounted or replaced the composer, there was no recent composer root, ancestor, or rect cache to keep related active regions protected during that lifecycle gap.

## Inferred From User Evidence

- The stale composer text is consistent with Mica interfering with a ChatGPT-controlled composer lifecycle window rather than Mica directly clearing or setting text. Mica does not intentionally write composer value, text, or contenteditable state.
- The temporary composer disappearance is consistent with ChatGPT unmounting/remounting the composer during send/streaming while Mica simultaneously scans and applies layout containment.
- The exact private ChatGPT React lifecycle was not confirmed, because automated real ChatGPT testing is intentionally out of scope.

## Ruled Out

- Mica does not intentionally clear the composer after send. That remains ChatGPT native React state responsibility.
- Mica does not dispatch `input`, `change`, or `submit` events as part of the fix.
- The known-interruption auto-dismiss rule was not expanded and does not retry, reload, resend, or create network traffic.
- The overlay collision avoidance itself reads geometry only; it does not edit composer DOM.

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
- disabled Mica produces native baseline behavior;
- diagnostics do not include synthetic message text.

## Remaining Manual Validation

The synthetic fixture cannot prove the exact current ChatGPT private React lifecycle. The following still requires user manual Edge validation on real ChatGPT:

- send a normal message in a long thread and confirm the composer clears permanently;
- watch for temporary composer disappearance during streaming;
- copy Mica diagnostics after a real send and confirm composer `textLength` returns to `0`, `optimizationIntersections` remains `0`, and `optimizationChangesPaused` only appears during the send/remount window;
- repeat on the 8 GB MacBook Neo before deciding whether P0 is complete.

## Test Results

- `npm test`: passed.
- `npm run test:e2e`: passed with native/Mica/Mica-disabled modes at 1200, 700, and 500 px widths, 24 send lifecycle loops per case.
- `npm run test:e2e:stress`: passed with native/Mica modes at 1200, 900, 700, and 500 px widths, 72 send lifecycle loops per case, plus Mica-disabled at 700 px.
- In the final stress run, Mica reported `optimizationIntersections: 0`, `optimizationApplyDuringSend: 0`, and `optimizationRemoveDuringSend: 0` for all enabled Mica cases. The fixture also reported no stale final composer text, no final composer missing state, no optimized composer ancestry, no overlay/composer collision, and no Mica-triggered input/change/submit events.
