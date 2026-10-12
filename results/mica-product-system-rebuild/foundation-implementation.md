# Foundation implementation candidate

Date: 2026-10-12

## Outcome

The active development build is now Mica `0.2.0` (`product-foundation.1`). It
contains the rebuilt product shell, a capability-scoped `ChatGPTAdapter`, the
single-producer `AnswerDocument` core, separate Troubleshooting and Developer
QA surfaces, and the canonical acceptance hooks needed to freeze a Foundation
candidate.

This is not a 0.3.0 release and does not claim Low Memory completion. The
normal popup renders Low Memory as `Unavailable in this build`.

## Runtime boundary

The built manifest now activates only:

```text
chatgpt-adapter.js
answer-document.js
content.js
```

The old known-interruption, composer-diagnostics, stale-clear recovery,
connector-continuity and send-residual entrypoints are absent from the build.
Their historical source and fixtures remain available as migration evidence,
but the legacy and rebuilt runtimes do not run together.

The current contract is bound to:

```text
CONTRACT_ID=chatgpt-current-2026-10-12-v1
CHATGPT_CONTRACT_HASH=cc6f89fc65d4c36da2f859618ec7dc61efa3ceafd336a21a997ef93d5572bd7f
```

Proven current capabilities cover ordered role-owned turns, assistant content,
the native Copy action cluster and the property-backed composer. Scroll-root,
current math structure and streaming/edit/branch/tool lifecycle details remain
`UNKNOWN` and fail open until refreshed evidence proves them.

## Focused evidence

- Adapter/AnswerDocument: PASS. Ordered blocks include heading, paragraph,
  list, quote, table, code, inline/display math, link, citation, image, opaque
  interactive and unknown content. Streaming is provisional; settled output is
  durable. Remount preserves identity, edit changes source version, branch
  changes document identity, and ambiguous role ownership returns `UNKNOWN`.
- Runtime privacy and hot path: PASS. The QA report contains no conversation
  text/raw DOM/request/auth content; ordinary input performed zero synchronous
  document queries; disabling Mica disconnected the observer.
- Core flows: PASS. `keydown`, `beforeinput`, `input` and IME composition were
  not prevented. Composer, one-send commit, streaming settle, edit, branch,
  connector selection, tool, file and auth controls remained functional.
- Popup: PASS for loading/exact/compatible/unknown/unsupported/disabled/content
  unavailable; 320/340/368/400 px; 100/125/150%; light/dark; keyboard traversal
  and accessible names. Troubleshooting and Developer QA are separate views.
- Build/version: PASS. Source, built manifest, popup and sanitized runtime
  report agree on `0.2.0`; `dist/mica-dev` was rebuilt in place.

Rendered evidence is under
`results/mica-product-system-rebuild/foundation-popup/` and machine-readable
focused evidence is under
`results/mica-product-system-rebuild/foundation-evidence/`.

## Test ladder

- Impact audit: adapter/content runtime, popup views, build manifest/version,
  focused fixtures, build validator and canonical acceptance profiles.
- Focused checks: repeated during implementation; final focused core, core-flow
  and popup evidence runs all PASS.
- `npm test`: the local `pnpm.cmd` wrapper aborted before test execution because
  it attempted a no-TTY modules purge. No test result was claimed from that
  wrapper invocation.
- Equivalent complete Tier 2 chain executed directly with the package's `node`
  entries: PASS in 9.405 s.
- Full E2E candidate run count: 1.
- Build / `test:build`: PASS in the complete chain.
- Acceptance preflight: PASS; 5/5 known-good accepted and 19/19 known-bad
  rejected.
- Stress: not run; no lifecycle flake or Low Memory implementation exists yet.

## Remaining Foundation gate work

The code candidate must be committed, materialized into a hash-bound Foundation
bundle, validated through `acceptance:candidate`, and inspected by a fresh
read-only reviewer. Only then may `FOUNDATION_GATE=PASS` be recorded and Low
Memory feasibility/implementation begin.
