# LightSession and Current ChatGPT Check

Date: 2026-09-01

Browser build: Codex in-app browser was available, but it did not expose a reliable Chromium user-agent string through the automation sandbox. Local Chrome control was not available from Codex on this machine.

LightSession source checked: https://github.com/11me/light-session/blob/master/extension/src/page/page-script.ts

## Exact Observations

- The local `Mica-for-ChatGPT` repository had no extension source before this iteration; it contained only `README.md`, `AGENTS.md`, `docs/PHASE_1_LONG_THREAD_RECOVERY.md`, and `docs/ROADMAP.md`.
- The available in-app browser opened `https://chatgpt.com/` to the logged-out homepage. The page text included login/signup prompts and had no loaded conversation.
- On that logged-out page, these candidate selectors all returned `0`: `[data-testid*="conversation"]`, `[data-testid*="message"]`, `[data-message-author-role]`, `article`, `main article`, and `main [role="article"]`.
- The same logged-out page exposed no resource entries matching `backend-api`, `conversation`, `message`, `history`, `stream`, or `thread` at the time of inspection.
- The current LightSession upstream source still identifies only exact GET paths matching `/backend-api/(conversation|shared_conversation)/<id>` as trim candidates and then requires JSON with both `mapping` and `current_node` before trimming.

## Confirmed vs Inferred

Confirmed:

- LightSession's upstream implementation is centered on a page-context fetch proxy, not on low-risk DOM containment.
- Its recognized conversation endpoints are exact full-conversation paths, excluding extra path suffixes such as stream status and textdocs.
- Its shape guard returns false unless the response still contains a full conversation `mapping` object and a string `current_node`.
- The Codex-accessible ChatGPT page was not logged in, so it could not reproduce a real long-thread load or observe authenticated conversation endpoints.

Inferred:

- If current authenticated ChatGPT long threads are loaded through paginated, segmented, renamed, or differently shaped endpoints, LightSession will not dispatch trim status and can remain in a waiting state.
- Because this iteration could not observe an authenticated long thread from Codex, the exact current endpoint names and response shapes still need confirmation on the target browser/device.

## Why the Old Assumption Failed

The old LightSession assumption is brittle because it depends on seeing a full private conversation tree before React renders it. Any one of these changes is enough to break it:

- request path no longer exactly matches `/backend-api/conversation/<id>` or `/backend-api/shared_conversation/<id>`;
- response no longer includes both `mapping` and `current_node`;
- ChatGPT renders from native pagination/segments before a full authoritative tree is fetched;
- status propagation depends on a successful trim event, so a miss can look like indefinite `waiting for messages...`.

## Chosen Implementation Path

Mica v0.1 uses render-layer containment only:

- identify conversation turn containers from stable semantic-ish markers such as `data-message-author-role`, conversation-turn test IDs, and `article`;
- apply `content-visibility: auto`, `contain`, and `contain-intrinsic-size` only to offscreen historical turns;
- keep recent turns, viewport-near turns, focused/editing turns, streaming-adjacent turns, tool/file/auth-like turns, and ambiguous structures native;
- never modify private API responses and never remove React-managed nodes;
- fail open into `Native only`, `Degraded`, or `Disabled` instead of waiting indefinitely.

Rejected alternatives for v0.1:

- copying LightSession's fetch response rewrite, because the authenticated endpoint contract was not confirmed;
- explicit DOM virtualization/placeholders, because it risks React reconciliation breakage and was not required for the first candidate;
- Markdown copy, retry automation, or UI polish, because they are out of P0 scope.
