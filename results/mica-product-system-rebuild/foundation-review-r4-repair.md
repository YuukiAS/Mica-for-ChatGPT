# Foundation independent-review round 4 repair candidate

Date: 2026-10-12

Runtime candidate commit: `c44c4d1774d8f3f592e4d047b42e6e499dc256ec`

Candidate bundle:

`results/mica-product-system-rebuild/foundation-candidate/c44c4d1774d8f3f592e4d047b42e6e499dc256ec`

## Review state

The round 3 candidate received `VERDICT=REVISE`, `P1=1`, `P2=0`. The reviewer
confirmed that all earlier findings remained closed. This document freezes the
fourth repair for another review by the same independent reviewer. It does not
declare `FOUNDATION_GATE=PASS` before that review.

## P1 repair

The validator now requires a capability-specific, complete action-placement
proof set before accepting `placementProven=true`. The bound contract must be
`EXACT`, and the bootstrap must contain exactly these four passing observations:

- `copy-inside-assistant-turn`;
- `action-cluster-parent`;
- `copy-sibling-insertion`;
- `visible-size-baseline`.

The acceptance corpus now includes a coordinated forgery control that changes
the contract to `EXACT`, supplies only `native-copy-action`, updates the bound
contract hash, updates all capability contract hashes, and rewrites both the
adapter and placement measurements coherently. The production validator rejects
that control because the full placement proof set is absent.

This change affects only candidate evidence validation. Runtime behavior and
the loadable `dist/mica-dev` bytes are unchanged, so the formal runtime version
remains Mica `0.2.3` (`product-foundation.4`).

## Bound candidate identity

- version: `0.2.3`;
- build label: `product-foundation.4`;
- dist hash: `64a62c29c16f9ebfdbc076da62b5e3ec816f5a4c82083f93c487337ab522d7c2`;
- current ChatGPT contract hash:
  `7bc4117efd3a32e99b17defb2809a630db3f2f951e01035af623e143bc1b9538`;
- validator tree hash:
  `c8ca939a7c4d4a4ec92e0bc6389e61447766d788ca2b59c4b8ffc23de3cd7d92`;
- fixture set hash:
  `64ad57139334d8390fa234d89b1c3bc9fec46a6027fe5f486b40720556e4f163`.

The candidate validator passed all nine Foundation gates. Acceptance preflight
accepted 5/5 known-good controls and rejected 27/27 known-bad controls.

## Test accounting

- focused acceptance preflight after this validator-only repair: PASS, 2.077 s;
- candidate validator: PASS;
- the full Tier 2 runtime chain was not repeated because this repair did not
  change runtime or dist bytes; the round 3 direct chain remains bound to the
  unchanged dist and passed once in 12.859 s;
- `npm test`: not counted because the machine's npm command was unavailable;
  the package's direct Node entrypoints were used for the bound runtime chain;
- stress: not run for Foundation; the frozen sequence requires the substantial
  virtualization stress gate during Low Memory.

## Boundary

This is a review candidate, not an independent-review verdict and not final
authenticated current-site acceptance. Low Memory remains unavailable in this
build. `LOW_MEMORY_TRUNCATION=PASS` is not claimed.
