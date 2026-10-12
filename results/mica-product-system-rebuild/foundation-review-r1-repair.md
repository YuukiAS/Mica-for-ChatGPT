# Foundation independent-review repair candidate

> Historical repair candidate. Independent review returned `REVISE` with two
> new P1 and one P2 finding. It is superseded by
> `foundation-review-r2-repair.md`.

Date: 2026-10-12

Runtime candidate commit: `313ac974ed01d1973b3d2e5120943a1e7f889805`

Candidate bundle:

`results/mica-product-system-rebuild/foundation-candidate/313ac974ed01d1973b3d2e5120943a1e7f889805`

## Review state

The prior `0.2.0` candidate at `63b62c96f2f35a3a4dedac007e8c4ff352f8c0e5`
received `VERDICT=REVISE` from the independent reviewer with three P1 and two
P2 findings. It is retained only as historical evidence. This document freezes
the repaired `0.2.1` (`product-foundation.2`) candidate for review by the same
reviewer. It does not declare `FOUNDATION_GATE=PASS` before that review.

## P1 repairs

1. Unknown lifecycle can no longer become durable `SETTLED` output. The content
   runtime obtains generation state from the adapter, ignores caller-supplied
   state, and returns no `AnswerDocument` when the lifecycle is unknown. Direct
   unrecognized top-level content becomes `unknown_block`; interactive content
   becomes `opaque_interactive` rather than disappearing.
2. The adapter no longer filters an ambiguous, tool, unknown-role, or
   multi-owner candidate and then reports the remaining subset as `EXACT`.
   Mixed and tool-bearing fixtures now force the overall inspection to
   `UNKNOWN` and fail open.
3. Candidate measurements are derived from the bound browser evidence files.
   The validator reads those raw artifacts, compares each measured value, and
   binds every contract capability to a named capability in the current
   bootstrap artifact. Known-bad controls prove rejection of a forged bound
   measurement, a caller-forced settled lifecycle, and a wrong bootstrap
   capability binding.

## P2 repairs

1. Troubleshooting and Developer QA return keyboard focus to the exact link
   that opened them. The browser fixture follows both navigation paths and
   verifies the resulting active element.
2. The current composer contract now explicitly models the contenteditable and
   mobile textarea variants as `COMPATIBLE`, matching both the bootstrap
   evidence and runtime inspection identity.

## Bound candidate identity

- version: `0.2.1`;
- build label: `product-foundation.2`;
- dist hash: `ece235f547953a85ff7eccb767828f18d50ec8308463fe6f4e328d7ae9fea701`;
- current ChatGPT contract hash:
  `c6dd6bf00d015f691cc1433ec557008818ec4a328e625946e8d43ed13d51fecc`;
- validator tree hash:
  `93f8fdc922d2cd36bc566093685911ec5ea47bf1dc993fdb45222be4451f49aa`;
- fixture set hash:
  `b229bcbeaa0c5672e01fcf448aacdef1154ee18596d8d215d4c617099b8104d2`.

The candidate validator passed all nine Foundation gates. Acceptance preflight
accepted 5/5 known-good controls and rejected 22/22 known-bad controls.

## Test accounting

- focused Foundation core, flow, popup-render, and build validation: PASS;
- direct Tier 2 candidate chain after the final evidence-binding change: PASS,
  one full run, 12.297 s;
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
