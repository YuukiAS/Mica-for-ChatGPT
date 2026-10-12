# Mica Product System — Critic R1 Disposition

Status: **PLANNER RESPONSE / BINDING FOR R1 AMENDMENT**  
Date: 2026-10-12  
Critic verdict: `PLANNER_AMENDMENT_REQUIRED`

This document records the Planner disposition of the independent GPT Critic findings. It is not a new parallel product authority; the actual amendments are incorporated into `docs/product/MICA_PRODUCT_SYSTEM_V1.md` and `docs/tasks/2026-10-12-mica-product-system-rebuild-goal.md`.

## Accepted P1 findings

The Planner accepts the substance of:

- **PSR-01** — Low Memory needed a falsifiable feasibility/benefit gate.
- **PSR-02** — normal product UI needed complete user paths, safe fallback targeting, and an actual design freeze rather than only “call Frontend Design”.
- **PSR-03** — ChatGPTAdapter capability evidence needed per-capability evidence class, variant, freshness/invalidations and independent degradation.
- **PSR-04** — AnswerDocument needed ordered source mapping, version/finality, math source, opaque interactive blocks and highlight conflict handling.
- **PSR-05** — Reliability needed a compact evidence → action decision table.
- **PSR-06** — the acceptance harness needed its own evidence-integrity controls and production-path calibration.
- **PSR-07** — actual-surface review needed explicit evidence classes and `NOT_INDEPENDENTLY_VERIFIED` semantics.
- **PSR-08** — PDF math acceptance needed real pointer selection in a real viewer, not only extraction/programmatic text-layer checks.
- **PSR-09** — real Notion behavior cannot be inferred from a local contenteditable fixture.
- **PSR-10** — source authority and legacy cleanup needed an explicit migration/disposition contract; the draft referenced old-branch documents as though they existed on current main.
- **PSR-11** — the Goal needed two independently useful milestones and one unambiguous implementation order.

These are Planner-contract defects, not requests to add more governance layers. They are being fixed by tightening existing authorities and reducing duplicated documentation.

## Accepted P2 finding

**PSR-13** is accepted.

The rebuild will keep only the minimum durable Planner authorities:

1. `MICA_PRODUCT_SYSTEM_V1.md` — product + UI + compatibility + acceptance semantics;
2. `2026-10-12-mica-product-system-rebuild-goal.md` — executable sequencing after Critic PASS;
3. the Critic prompt/review artifacts.

Implementation may create machine-readable contracts, fixtures and evidence, but it must not create multiple competing prose authorities merely to mirror sections of the same plan.

## Rejected / out-of-scope Critic line

The Planner rejects **PSR-12 licensing/provenance review as an architecture/release finding for this task**.

User direction explicitly excludes license/legal/provenance analysis from subsequent Mica Critic rounds.

For this project:

- `YuukiAS/Web_Highlighter` and AI Exporter may be used as user-directed technical references;
- source identity may be recorded only when useful for technical reproducibility or regression comparison;
- the Mica Critic must not create findings, blockers, release gates, or implementation delays about licensing, legal provenance, upstream redistribution, or third-party permission;
- this exclusion does not change platform/system safety rules, but those are not a Planner/Critic work item here.

The substantive product scope question inside PSR-12 is resolved separately: Mica V1 highlighting is **ChatGPT-scoped**. General arbitrary-webpage highlighting is not part of the first two rebuild milestones and Issue #9 must not be considered fully closed for that broader scope unless a later explicit Goal expands it.

## Planner rebuttal/clarification on two accepted findings

### Reliability one-minute rule

The user previously specified that a roughly one-minute no-progress condition should trigger recovery. The Planner keeps that product requirement, but clarifies that:

- “no progress” means no structural progress signal, not merely “no new visible text”;
- 60 seconds starts a bounded recovery procedure;
- it does **not** automatically mean “create a duplicate user turn”;
- if the original user turn is not committed, Mica may resend once after reload when no consequential context exists;
- if the user turn is already committed, Mica must recover the existing turn/generation rather than create a second user message;
- active tool/file/connector/auth/consequential states suppress automatic resend.

This preserves the user's desired automatic recovery without treating a long legitimate generation as a guaranteed failed send.

### PDF viewer scope

The hard requirement is real continuous pointer selection across prose → inline math → prose.

The acceptance contract will require:

- actual generated PDF;
- actual pointer drag/selection in at least one supported real viewer engine;
- an independent text-layer engine check (PDF.js);
- copy order/search/extraction/visual-position consistency.

Acrobat-specific automation is not a mandatory Planner gate unless a reliable automated path is available. The product requirement is standards-level selectable math text, not dependence on one proprietary viewer automation route.

## No new user decision required

All R1 P1 findings can be resolved from existing product direction.

```text
USER_DECISION_REQUIRED=NO
CODEX_IMPLEMENTATION_ALLOWED=NO
NEXT_STEP=PLANNER_AMENDMENT_THEN_FRESH_GPT_CRITIC
```
