# Foundation independent-review round 2 repair candidate

Date: 2026-10-12

Runtime candidate commit: `8643c03c91f6cb188a1124675d4fcd4dd5216508`

Candidate bundle:

`results/mica-product-system-rebuild/foundation-candidate/8643c03c91f6cb188a1124675d4fcd4dd5216508`

## Review state

The repaired `0.2.1` candidate received `VERDICT=REVISE`, `P1=2`, `P2=1`.
The reviewer confirmed that all findings from the first review were closed.
This document freezes the second repair as Mica `0.2.2`
(`product-foundation.3`) for another review by the same independent reviewer.
It does not declare `FOUNDATION_GATE=PASS` before that review.

## P1 repairs

1. The adapter-contract validator now requires unique measured, contract, and
   bootstrap capability IDs and exact equality between the measured and bound
   contract capability sets. Missing and duplicate capability controls are
   rejected.
2. Each contract capability names its bootstrap capability, evidence class,
   and required normalized observation IDs. The materializer derives observed
   IDs only by evaluating bootstrap assertions against the bound surface data;
   the validator independently repeats the evaluation. A mutated bootstrap
   surface assertion is rejected by the same production validator.
3. `AGENTS.md` and `docs/ROADMAP.md` now use the frozen Foundation → Low Memory
   → Highlighter/PDF order. Advanced Reliability, Notion, arbitrary-webpage
   highlighting, and secondary reuse remain deferred. Durable privacy,
   fail-open, typing-hot-path, browser-boundary, and version rules remain in
   force.

## P2 repair

README no longer embeds the stale known-bad count. It describes the control
classes while the executed preflight remains the authoritative count.

## Bound candidate identity

- version: `0.2.2`;
- build label: `product-foundation.3`;
- dist hash: `39398b15b3f2cca15e68723be22e65ef9a3767d3795a00b8a04eb8ac9f5a4308`;
- current ChatGPT contract hash:
  `2ca0f3276af681b5d721101e4b15145547f8a457b77159dc76f5f2d592ba068b`;
- validator tree hash:
  `95afd8141c4f56d54f6c600bdb4d8a4bb1d710cbe35a68820f3478b88c70b437`;
- fixture set hash:
  `e76db79b7c4cf48e4f860a8930cdd9385b43fddb5a917b2f9c687e59b848dabb`.

The candidate validator passed all nine Foundation gates. Acceptance preflight
accepted 5/5 known-good controls and rejected 25/25 known-bad controls.

## Test accounting

- focused Foundation core, flow, popup-render, and build validation: PASS;
- direct Tier 2 candidate chain after the final repair: PASS, one full run,
  12.213 s;
- candidate validator: PASS;
- acceptance preflight: PASS;
- `npm test`: not counted because the machine's npm command was unavailable;
  the package's direct Node entrypoints above were executed instead;
- stress: not run for Foundation; the frozen sequence requires the substantial
  virtualization stress gate during Low Memory.

## Boundary

This is a review candidate, not an independent-review verdict and not final
authenticated current-site acceptance. Low Memory remains unavailable in this
build. `LOW_MEMORY_TRUNCATION=PASS` is not claimed.
