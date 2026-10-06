# Independent review history

## Candidate `49e7bc9c631c840aab7e3f1b75aca7c332b43430`

```text
INDEPENDENT_REVIEW=FAIL
P0=0
P1=2
P2=1
LOW_MEMORY_TRUNCATION=FAIL
READY_FOR_USER_ACCEPTANCE=NO
READY_FOR_RELEASE=NO
```

The same independent reviewer found three offline-resolvable gaps:

1. storage absence or `chrome.runtime.lastError` produced a fresh enabled config instead of failing open;
2. mapping validation accepted missing `children`, unknown roles and sensitive non-text structures;
3. an unsupported page could show `Unavailable on this page` in the header while capability sub-states still implied availability.

The candidate was withdrawn immediately. The working repair makes config read failures publish `enabled=false`, validates every mapping node before truncation, rejects unknown/tool/multimodal-file structures, and unifies all unsupported popup sub-states. Focused, full E2E and stress evidence passed after those changes; a new exact commit and same-reviewer decision are still required.

## Candidate `dc5c2f80ae464325cda07fb3c9b14c0de8fbd1e0`

```text
INDEPENDENT_REVIEW=FAIL
P0=0
P1=1
P2=0
LOW_MEMORY_TRUNCATION=FAIL
READY_FOR_USER_ACCEPTANCE=NO
READY_FOR_RELEASE=NO
```

The same reviewer confirmed the prior three findings were fixed, then reproduced one remaining offline-resolvable gap: sensitive metadata keys such as `tool_calls`, nested `invoked_plugin` and `connected_apps` were not classified as sensitive, so a tool-bearing 100-turn mapping was incorrectly reduced to 40 turns.

The candidate was withdrawn immediately. The working repair expands the key classifier, walks nested metadata with a 2,000-container safety bound, and adds direct MV3 regression cases for all three forms. Focused, full E2E and stress evidence passed after the repair; a new exact commit and same-reviewer decision are still required.
