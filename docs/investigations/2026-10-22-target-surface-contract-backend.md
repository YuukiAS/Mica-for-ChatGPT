# Target-surface contract backend investigation

## Environment and scope

- Date: 2026-10-22
- Candidate: Mica `0.5.6` / `functional-convergence.7`
- Browser build: not observed; this iteration did not launch a browser
- Real ChatGPT: not accessed
- Evidence used: repository contracts, existing runtime architecture, synthetic DOM fixtures and static build validation

This investigation covers two page-owned target surfaces: ChatGPT's native recovery controls and the suggested-work area near the composer. It does not claim to identify either surface on the current authenticated site.

## Confirmed

- Before this iteration, the recovery policy could authorize Stop, assistant retry and confirmed-unsent resend, but the content runtime had no adapter-owned executor for those native controls.
- `Hide suggested work` existed as a setting and task contract, but had no runtime controller.
- Recovery lifecycle observations already flowed through `ChatGPTAdapter`; adding separate page selectors to each controller would break that ownership boundary.
- The existing content lifecycle observer can schedule both new controllers. Neither feature needs a new permanent observer or polling loop.
- Synthetic exact-contract fixtures can prove subject/control binding, ambiguity rejection, pre-action identity revalidation, empty-composer gating, reversible hiding, remount handling and privacy-safe report shape. Their exact path also requires a test-only authority in the extension's isolated world; a page-writable DOM fixture marker alone is insufficient.

## Not observed

- The current ChatGPT DOM or accessibility identity of Stop, retry, resend or suggested-work controls.
- Whether the current site exposes stable semantic attributes for those controls.
- The real visual result of hiding suggested work.
- Real native click, submit, streaming or remount behavior.

These facts are `MISSING`, not `PASS`. Screenshots, old selectors and fixture-only `data-mica-*` markers are not current-site evidence.

## Why the old assumption was insufficient

A generic visible label or broad position near the composer is not enough to identify an icon-only recovery control or a personalized suggestion surface. Matching by text, broad ancestor or guessed visual location could hide unrelated cards, retry the wrong assistant turn, or send a new message. A successful policy decision alone also cannot prove that the page control still belongs to the same recovery subject at execution time.

## Chosen implementation

`ChatGPTAdapter` now owns four bounded interfaces:

- `inspectSuggestedWorkSurface()` returns a unique surface only for an exact contract;
- `inspectRecoveryControl()` binds the native action to its recovery subject and hashed control identity;
- `executeRecoveryControl()` repeats the identity check immediately before invoking the control;
- `inspectTargetSurfaceDiagnostics()` emits a bounded structural report only when Developer QA is exported.

`MicaRecoveryControlAdapter` converts an exact adapter observation into policy evidence once, then delegates execution back through the adapter. Sensitive, consequential and unknown tool states remain ineligible. Confirmed resend additionally requires an exact empty composer before restoring the short-lived draft.

`MicaSuggestedWorkController` hides only one exact surface, records its original visibility/accessibility attributes, and restores those attributes when the feature is disabled, the node is replaced or the contract becomes uncertain.

For ordinary current-site pages, both target contracts intentionally return `MISSING / current_site_contract_unproven`. The build therefore stays native and fail-open until exact real-site evidence is available. A page that adds fixture-like `data-mica-*` attributes cannot enable the synthetic click/hide path because it cannot set the extension-isolated test authority.

## Privacy and performance boundary

The target-surface diagnostic is inactive during ordinary typing. On explicit QA report export, it inspects at most three composer ancestors plus the latest assistant turn and keeps at most 32 structural candidates. It records tag/role/test tokens, relative location, enabled/hidden state, semantic class and an accessibility-label fingerprint. It does not output the label itself, suggestion text, answer text, prompt text, raw DOM, request data or authentication data.

The controllers add no typing listeners, no sub-100 ms polling and no independent `MutationObserver`. Existing structural events coalesce reconciliation through `requestAnimationFrame`.

## Rejected alternatives

- Visible-text matching: rejected because it is localized, personalized and can match unrelated UI.
- Broad `div` ancestry or visual-position guessing: rejected because it cannot prove control ownership.
- Controller-local selectors: rejected because it duplicates unstable ChatGPT structure outside the adapter.
- Permanent polling: rejected because it adds avoidable runtime and typing-path risk.
- Enabling a guessed live selector from old evidence: rejected because this iteration had no exact current failed-page evidence.

## Next evidence step

When real-site work is allowed, export one Developer QA report from the relevant existing page and classify the critical structural fields as `EXACT`, `PARTIAL`, `LIMITED` or `MISSING`. Only an exact contract may activate the live selector path. The same sanitized contract must then make the previous implementation fail and the candidate pass before one final normal live confirmation.
