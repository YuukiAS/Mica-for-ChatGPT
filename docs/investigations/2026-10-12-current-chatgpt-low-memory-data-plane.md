# Current ChatGPT Low Memory data-plane investigation

Date: 2026-10-12
Browser: Codex In-app Browser, isolated unauthenticated profile
Browser build: unavailable through the supported read-only browser surface
Evidence: `results/mica-product-system-rebuild/current-chatgpt-surface/low-memory-data-plane-evidence.json`

## Scope and privacy boundary

This read-only follow-up reused the public shared conversation and isolated
browser surface from the current-surface bootstrap. It inspected script and
conversation graph structure only. It did not submit prompts, use an
authenticated profile, inspect private conversations, or retain message text,
request bodies, headers, tokens, or account data.

## Confirmed current data path

The sampled current page did not fetch a standalone conversation JSON resource
after load. Its initial conversation arrived in an inline React Router stream:

```text
window.__reactRouterContext.streamController.enqueue(<JSON string>)
```

The main chunk decoded to a 593-entry turbo-stream flat reference graph. The
graph contained this structural path:

```text
loaderData
-> routes/share.$shareId.($action)
-> serverResponse
-> data
-> mapping + current_node
```

The sampled conversation mapping contained 20 graph nodes on one current path:

- 20 total mapping nodes;
- 6 user roles;
- 9 assistant roles, including model-editable-context dependencies;
- 2 tool roles;
- 2 system roles;
- 1 structural root without a message.

The DOM exposed seven mounted user/assistant turns. This demonstrates why DOM
count alone is not a sufficient memory signal: native rendering already mounts
fewer turns than the client conversation graph retains.

## Why the historical path is insufficient

The historical Low Memory checkpoint intercepted exact GET paths shaped like
`/backend-api/conversation/<id>` and expected ordinary JSON with `mapping` and
`current_node`. That path remains useful as a guarded fallback for later
navigation responses, but it does not cover the confirmed initial hydration
path above.

The historical fallback also removed old React-managed turn elements directly.
That approach is rejected. It can reduce mounted DOM without releasing the
conversation model and can violate React reconciliation, streaming, editing,
branching, tool, file, authorization, and composer invariants.

## Chosen implementation path

Low Memory will window the client conversation data before ChatGPT decodes and
renders it:

1. the extension service worker registers the two `document_start`, MAIN-world
   scripts only when extension storage says Mica and Low Memory are enabled;
2. the bridge recognizes and validates the current turbo-stream flat graph;
3. it retains a structural root, the latest 40 visible user/assistant turns,
   all intervening system/tool/dependency nodes, and recent branch dependencies;
4. it compacts unreachable flat-graph entries so old message content is not
   retained in the decoded client graph;
5. it applies the equivalent strict mapping window to recognized same-origin
   conversation JSON responses;
6. unknown routes, graph shapes, branches, or interactive dependencies remain
   untouched and report a fail-open reason;
7. `Load full history` or disabling Mica asks the service worker to unregister
   the data-plane before reload; after the native page completes, the worker
   re-registers the scripts for later navigations. The pending reload state is
   held in extension `storage.session`, survives service-worker restart, and is
   not writable by the page. Removing Mica and reloading likewise restores the
   native full history. Server history is never mutated.

The current React Router surface is an optimized path, not the sole path. The
ordinary JSON interceptor remains a guarded fallback; both paths share one
pure windowing core and one fail-open contract.

## Impact audit before runtime changes

Runtime/build modules expected to change:

- `extension/src/low-memory/low-memory-core.ts`;
- `extension/src/low-memory/low-memory-page.ts`;
- `extension/src/low-memory/low-memory-config.ts`;
- `extension/src/low-memory/low-memory-background.ts`;
- `extension/src/content.ts`;
- popup Low Memory settings/status;
- `scripts/build.mjs`, release config and build validation.

Focused fixtures/validators expected to change:

- turbo-stream graph windowing and malformed/unknown fail-open fixtures;
- ordinary JSON mapping windowing;
- short, medium, long and pressure profiles;
- full-history bypass/reload/disable behavior;
- send, streaming, edit/branch, connector, tool/file/auth and IME hot path;
- acceptance `low-memory-benefit` evidence materialization and controls.

```text
LOW_MEMORY_FEASIBILITY_PATH=CONFIRMED
DOM_REMOVAL_FALLBACK=REJECTED
LOW_MEMORY_TRUNCATION=PASS
```

## Final verification result

The first candidate was rejected because site-local configuration could arrive
after the only hydration chunk, page code could forge its config event, graph
validation covered only the retained path, recovery tests pre-seeded their own
bypass, and the A/B/C run loaded only the two data-plane files. The final path
removes those assumptions:

- configuration authority is `chrome.storage` plus serialized
  `chrome.scripting.registerContentScripts`; storage errors unregister the
  interceptor and fail open;
- every mapping node is validated before mutation: exact id, one root, full
  reachability, parent/child symmetry, supported role/content/lifecycle, and no
  cycles or disconnected nodes;
- malformed, disconnected, unknown-role and unknown-content JSON and turbo
  payloads remain byte-for-byte unchanged;
- the recovery fixture clicks the real on-page control, proves an unwindowed
  161-node reload, exercises `full_history_bypass` and `Resume Low Memory`, and
  proves a draft-blocked disable retains a later recovery action;
- the pressure run loads the complete unpacked extension in isolated Edge
  profiles, proves the service worker registration and content runtime for B/C,
  and uses the current React Router flat-graph plus virtualized-turn DOM shapes.

On the final three-sample 800-turn, 100 MiB workload with a 256 MiB V8
old-space limit, installed/on reduced the decoded mapping from 801 to 41 nodes,
retained message content from 100 to 5 MiB, and JS heap from 101.633 to
6.348 MiB versus installed/off. Mounted turns and mutations stayed at 12 and
62; typing p95 stayed 0.01 ms, scroll p95 improved from 0.10 to 0.01 ms, frame
p95 changed from 16.8 to 17.2 ms, and steady-state long-task count stayed zero.
Full browser process private memory changed from 564.176 to 558.664 MiB; the
extension process overhead means this aggregate is a smaller signal than the
renderer heap and retained graph reduction.

```text
LOW_MEMORY_FEASIBILITY=PASS
LOW_MEMORY_TRUNCATION=PASS
LOW_MEMORY_RESTORE=PASS
LOW_MEMORY_CORE_FLOW_REGRESSION=PASS
TARGET_LOW_MEMORY_EVIDENCE=PASS
```
