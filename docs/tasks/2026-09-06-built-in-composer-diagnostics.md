# Built-in Composer Diagnostics for Real-Site Manual Debugging

Date: 2026-09-06

## Context

Real authenticated ChatGPT acceptance remains manual. Windows Computer Use and Browser Use are not reliable enough on the user's normal authenticated Edge session to be part of the Mica debugging contract. The user should not be asked to paste large JavaScript snippets into DevTools Console or manually inspect DOM details.

Current Issue #6 evidence already shows that ChatGPT's connector mention lifecycle itself can briefly unmount/remount the composer: with Mica runtime OFF, both `@GitHub` + Enter selection and mouse-click selection still cause a short composer disappearance. That behavior alone must not be treated as a Mica regression.

A separate symptom remains important: composer text can become difficult to clear or can remain after interaction/send flows, and the user reports that longer text seems more likely to leave stale content. This needs structural evidence that distinguishes a normal native ChatGPT composer remount from stale draft restoration or Mica interference.

## Product requirement

Mica development builds must contain the JavaScript needed to collect recurring composer lifecycle evidence. The normal debugging flow must be low-friction:

1. user reloads the current `dist/mica-dev` build if needed;
2. user opens Mica popup and starts a composer diagnostic session;
3. user performs one short manual reproduction on the real ChatGPT page;
4. user clicks `Copy report`;
5. the resulting privacy-safe report is directly usable by Codex/GPT.

Do not make the user paste large Console scripts, inspect Elements, copy raw DOM, or run a sequence of ad-hoc JS commands.

## Diagnostic scope

Keep diagnostics isolated from optimization/runtime behavior and inactive outside an explicit diagnostic session.

Capture bounded structural evidence such as:

- monotonic timestamp / elapsed time;
- composer present/missing transitions;
- composer root and editable session-local identity changes;
- contenteditable / role / testid structural metadata;
- text length only, never text content;
- focus/blur state;
- beforeinput/input/cut/delete-relevant event type and inputType where safe;
- mention/connector signal present/absent;
- chooser/connector-related structural signal if it can be detected without brittle content scraping;
- user-turn count and mounted-turn count;
- whether a new user turn appeared during a manual-send diagnostic;
- stale text after a new user turn using text length/identity evidence only;
- Mica runtime flags that matter to composer safety, including native-safe mode, document MutationObserver state, composer lifecycle listener state, and relevant observer/listener activity;
- a short bounded event trace around the reproduction window.

Do not include:

- prompt text;
- assistant response text;
- copied conversation text;
- request bodies;
- auth/session tokens;
- headers/cookies;
- unbounded DOM dumps;
- unbounded logs.

## UX

Prefer a small existing-popup extension of the current guided diagnostics rather than a second complicated debug surface.

At minimum provide:

- `Run composer check` / equivalent start action;
- clear current step/status;
- `Stop check`;
- `Copy report`;
- a concise summary that distinguishes expected native remount from suspicious stale-state restoration where the evidence supports that distinction.

The diagnostic itself must not synthesize input, intercept Enter, restore drafts, click Send, retry, reload the page, or otherwise alter ChatGPT behavior.

## Current investigation priority

Do not spend the next runtime patch trying to eliminate the brief `@GitHub` connector-selection composer disappearance by itself. The OFF A/B demonstrates that this happens natively in ChatGPT too.

The next useful target is to make the built-in report strong enough to diagnose the user's remaining stale-text problem, especially:

- deleting `@GitHub`/connector content where the composer briefly remounts;
- text that reappears or cannot be reliably cleared after deletion;
- longer composer text that appears more likely to remain stale;
- manual-send flows where a new user turn commits but old composer content remains.

The report should be able to tell whether:

1. the composer merely remounted and cleared normally;
2. the editable/root identity changed and old text was restored afterward;
3. a new user turn committed while composer text length remained non-zero;
4. Mica runtime activity coincided with the suspicious transition;
5. the same suspicious transition can occur with Mica runtime OFF.

## Testing

This is a DOM/composer/diagnostics change, so after implementation settles use Tier 2:

- `npm test`
- `npm run test:e2e`

Use focused synthetic fixtures while iterating. Add fixture coverage for native connector-like composer identity replacement and stale-text restoration detection without accessing real ChatGPT.

Do not run stress unless the implementation specifically targets an intermittent timing race that ordinary E2E cannot validate.

## Acceptance

A development iteration is acceptable when:

- the user can collect the needed real-site composer evidence with one popup-guided session and `Copy report`;
- no DevTools Console script is required;
- report contains enough evidence to separate native connector remount from suspicious stale text restoration;
- diagnostic mode is bounded and off when not running;
- normal Mica runtime remains simpler rather than accumulating permanent observers/polling just for debugging;
- privacy constraints above are preserved;
- canonical `dist/mica-dev` is rebuilt if runtime code changes and versioning rules are followed.
