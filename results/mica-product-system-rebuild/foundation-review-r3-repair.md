# Foundation independent-review round 3 repair candidate

Date: 2026-10-12

Runtime candidate commit: `697a7cbf000483eda7f20046f9d605d09633e917`

Candidate bundle:

`results/mica-product-system-rebuild/foundation-candidate/697a7cbf000483eda7f20046f9d605d09633e917`

## Review state

The `0.2.2` candidate received `VERDICT=REVISE`, `P1=1`, `P2=0`. The reviewer
confirmed that all earlier findings remained closed. This document freezes the
third repair as Mica `0.2.3` (`product-foundation.4`) for another review by the
same independent reviewer. It does not declare `FOUNDATION_GATE=PASS` before
that review.

## P1 repair

The current bootstrap proves only the native Copy action identity. It does not
prove the containing assistant turn, cluster parent, sibling insertion point,
visible baseline, or control dimensions. The current-site
`answer.actionCluster` contract is therefore now `UNKNOWN` with fail-open
behavior, and the runtime does not return an injectable cluster on real
ChatGPT. Synthetic fixtures may still prove their own explicit fixture shape,
but cannot promote the current-site contract.

The copy-placement evidence is no longer hard-coded. Materialization computes
`placementProven` from the bound contract and bootstrap observations; the
validator independently repeats that computation. For this candidate:

```text
PLACEMENT_PROVEN=NO
ACTION_INJECTED=NO
FAIL_OPEN=YES
```

The historical injected-misplacement control and a new fabricated-placement-
proof control are both rejected by the production validator.

## Bound candidate identity

- version: `0.2.3`;
- build label: `product-foundation.4`;
- dist hash: `64a62c29c16f9ebfdbc076da62b5e3ec816f5a4c82083f93c487337ab522d7c2`;
- current ChatGPT contract hash:
  `7bc4117efd3a32e99b17defb2809a630db3f2f951e01035af623e143bc1b9538`;
- validator tree hash:
  `a107b5a21c31fe3f59ad41a7afb22833db8a00217b314fda5a3776e643fba184`;
- fixture set hash:
  `7a625bba4150c2cfe2784cd6d0c8d6c86058b39bfed7e729acc3228219bc73e5`.

The candidate validator passed all nine Foundation gates. Acceptance preflight
accepted 5/5 known-good controls and rejected 26/26 known-bad controls.

## Test accounting

- focused Foundation core, flow, popup-render, and build validation: PASS;
- direct Tier 2 candidate chain after the runtime repair: PASS, one full run,
  12.859 s;
- focused preflight after adding the exact fabricated-proof control: PASS,
  1.983 s;
- candidate validator: PASS;
- `npm test`: not counted because the machine's npm command was unavailable;
  the package's direct Node entrypoints above were executed instead;
- stress: not run for Foundation; the frozen sequence requires the substantial
  virtualization stress gate during Low Memory.

## Boundary

This is a review candidate, not an independent-review verdict and not final
authenticated current-site acceptance. Low Memory remains unavailable in this
build. `LOW_MEMORY_TRUNCATION=PASS` is not claimed.
