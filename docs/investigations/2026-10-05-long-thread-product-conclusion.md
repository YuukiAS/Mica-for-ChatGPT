# Long-thread low-memory conclusion — updated 2026-10-06

## Conclusion

The earlier native-safe no-op conclusion is superseded. Low-memory truncation is a hard Mica 0.3.0 capability gate and is present in the current 0.4.1 candidate.

Mica now uses two bounded, reversible paths:

1. A `document_start`, MAIN-world interceptor recognizes only same-origin GET responses for the exact conversation/shared-conversation path. It validates an acyclic active mapping path, preserves the latest 40 visible turns and their hidden support nodes, and gives the page a cloned response. It never mutates or writes the server conversation.
2. If the data path is unavailable, a DOM fallback activates only for 120 or more direct, ordinary user/assistant turn siblings. Any dialog, streaming state, editable, tool, attachment, connector, auth, mixed parent or unknown structure fails open.

`Load full history` sets a path-scoped session bypass and reloads. Disabling Mica and reloading also restores the full server-backed history. No conversation content is persisted by the windowing module.

## Why this adds value beyond native virtualization

Native virtualization can reduce mounted DOM while the client still owns the complete historical conversation graph and response payload. Mica's primary path reduces the data before the page application consumes it. In the frozen 240-turn, mapping-derived pressure fixture:

| Metric | Native baseline | Mica active | Change |
|---|---:|---:|---:|
| Visible/mounted turns | 240 | 40 | -83.3% |
| Mapping nodes delivered to the fixture app | 241 | 41 | -83.0% |
| Conversation response bytes | 3,033,461 | 505,821 | -83.3% |
| DOM nodes | 15,637 | 2,645 | -83.1% |
| JS heap after forced GC | 4,784,376 | 2,712,220 | -43.3% |

This is additional client-state and heap reduction, not a mounted-turn counter presented as an optimization. The exact current authenticated ChatGPT binding remains part of the one final HUMAN_ONLY report; release remains closed until that report confirms the live path is active or yields evidence for a safe repair.

## Compatibility and recovery evidence

- short thread: 20 turns remain unchanged;
- medium thread: 90 turns become 40;
- long thread: 240 turns become 40;
- direct-DOM fallback: 160 turns become 40;
- recent active branch and unknown mapping shape: fail-open;
- stale or missing extension configuration: wait for a fresh bridge event; an expired cache fails open;
- full-history action: reload restores all 240 turns;
- disable + reload: restores all 160 DOM-fallback turns;
- 120 IME/input cycles: 0.5 ms in the final candidate run, with no synchronous broad query/clone/geometry/style work;
- connector open/close, one fixture send, 27-character streaming mutation and scroll-frame check pass;
- stress: 10 reload cycles and 3 anomaly cycles pass.

## Current gate

```text
LOW_MEMORY_TRUNCATION=PASS
RECENT_TURNS_KEPT=40
SERVER_CONVERSATION_MUTATED=NO
FULL_HISTORY_RECOVERY=PASS
UNKNOWN_STRUCTURE_FAIL_OPEN=PASS
INPUT_HOT_PATH_BUDGET=PASS
CURRENT_AUTHENTICATED_CHATGPT=PENDING_HUMAN_ONLY
```
