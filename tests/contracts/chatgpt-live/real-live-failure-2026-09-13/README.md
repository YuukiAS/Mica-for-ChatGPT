# Real Live Failure Contract

This pack is commit-safe materialized evidence for Goal 023. The ideal one-shot DevToolsActivePort live probe was implemented as `npm run probe:live-failure`, but the current Codex sandbox could not complete the loopback browser WebSocket connection and elevated loopback access was rejected by safety review.

The fixtures in this goal therefore use the user's failure screenshot plus the committed `real-2026-09-13` contract pack to model the closest deterministic failing cases:

- Mica Copy must be inserted into the true native action cluster even when native Copy is icon-only.
- Long connector send residual must recover when the committed user turn changes identity while mounted user-turn count stays constant.

Raw live page text, headers, cookies, and screenshots are not committed.
