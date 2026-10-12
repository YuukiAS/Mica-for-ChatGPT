> **SUPERSEDED — DO NOT USE AS CURRENT CRITIC AUTHORITY**
>
> This file incorrectly framed the prebuild Critic as something launched by Codex.
> The current independent GPT Critic authority is:
>
> `docs/reviews/2026-10-12-mica-product-system-gpt-critic-prompt.md`
>
> The GPT Critic review happens before the Codex implementation Goal is frozen.
> Codex must not self-launch or self-satisfy this planner-level review.
>
# Mica Product System Rebuild — Prebuild Critic

Status: **MANDATORY FRESH READ-ONLY CRITIC BEFORE IMPLEMENTATION**  
Date: 2026-10-12

You are the independent prebuild Critic for the Mica product-system rebuild.

Repository:

```text
YuukiAS/Mica-for-ChatGPT
```

Primary Planner authority:

```text
docs/product/MICA_PRODUCT_SYSTEM_V1.md
docs/tasks/2026-10-12-mica-product-system-rebuild-goal.md
```

Historical authority for comparison only:

```text
docs/tasks/2026-10-05-mica-product-recovery-current-gpt-ui.md
README.md
docs/ROADMAP.md
AGENTS.md
```

The old 2026-10-05 Goal is not current product authority after the 2026-10-12 rebuild Goal is present.

Before reviewing, read the current installed/repository rules that govern delivery discipline:

```text
YuukiAS/AI_Skills_Collection:
docs/plugin-todos/workflow-core.md
docs/plugin-todos/web-development.md
plugins/codex/plugins/presentations/shared/authoring-production-workflow.md
plugins/codex/plugins/presentations/shared/pre-execution-cumulative-acceptance-contract.md
docs/plugin-todos/research-authoring-production-workflow.md
plugins/codex/plugins/research-writing/shared/student-assessment-cumulative-acceptance-contract.md
plugins/codex/plugins/research-writing/shared/student-assessment-delivery-closure-amendment-v1.md
```

Use those only for reusable workflow/acceptance lessons. Do not import presentation or assessment-specific product rules into Mica.

---

## Role

This is a read-only specification review.

Do not:

- modify Mica;
- implement code;
- rewrite the Goal;
- weaken release gates;
- turn process preferences into product requirements;
- require user QA merely because real ChatGPT exists;
- insist on a broad Surface Atlas campaign.

Your job is to decide whether the Planner package is strong enough to begin a long implementation campaign without predictably recreating the previous Mica failure pattern.

---

## Review questions

### 1. Product coherence

Determine whether the product is now understandable as one extension rather than a collection of experiments.

Check:

- Does the normal popup have a clear information architecture?
- Are Low memory, Copy & Export, Highlights, Reliability coherent primary jobs?
- Are normal UI, Troubleshooting and Developer QA separated?
- Is page injection minimal?
- Does each page control have a clear reason to exist?
- Are diagnostics subordinate to the product?
- Would a user understand the product without knowing Atlas, DOM or test vocabulary?

Fail if implementation could still legally produce another debug-dashboard popup or multiple floating page controls.

### 2. ChatGPT-change resilience

Check whether the design actually solves the recurring “ChatGPT UI changed again” problem.

Require:

- one ChatGPT-specific adapter authority;
- no feature-specific selector ownership;
- capability-level EXACT / COMPATIBLE / UNKNOWN;
- multiple simultaneous UI variants;
- read-only verify/refresh/diff;
- bounded capture of only Mica-relevant surfaces;
- unknown fail-open;
- Developer QA support inside Mica before external scripts.

Fail if “refresh current UI” is only a new name for broad Atlas or if the design still assumes one globally latest DOM.

### 3. External-tool burden

Check the rule:

> Use Mica itself whenever Chromium APIs permit it.

Fail if normal development/acceptance still depends on the founder repeatedly copying PowerShell, opening DevTools, pasting JavaScript, taking screenshots or manually assembling reports.

External scripts are allowed only for real browser/OS boundaries and must be stable committed entry points.

### 4. Low-memory core

Check whether low-memory remains a hard product capability rather than a diagnostic label.

Require:

- measurable additional client-memory/render benefit beyond current ChatGPT baseline;
- no server-history deletion;
- deterministic full-history restore;
- native behavior after disable;
- core-flow regression coverage;
- honest fail-open.

Fail if the Goal permits `Native handling`/no-op to satisfy the low-memory product requirement.

### 5. Answer reuse architecture

Check whether Copy, Highlighting, PDF and Notion share one semantic answer model.

Fail if any feature is allowed to independently scrape ChatGPT DOM.

Check that Highlighter/PDF are explicitly downstream of the product foundation rather than allowed to create another UI/selector/testing stack.

### 6. PDF math-selection requirement

Verify that the known AI Exporter-style defect is captured as a hard product regression:

```text
prose -> inline math -> prose
```

must support continuous selection/highlight/copy with the formula preserved.

Require actual PDF text-layer evidence, not screenshot-only or `pdftotext` alone.

### 7. Acceptance architecture

Compare the Mica proposal against the reusable lessons from workflow-core, Presentations and Research Authoring.

Require distinct ownership:

- Planner;
- Parent Controller;
- Producer;
- frozen deterministic Validator;
- fresh actual-surface/rendered Reviewer;
- GPT Work holistic review;
- user final subtle decision.

Require:

```text
KNOWN_BAD_CONTROL = REJECTED
KNOWN_GOOD_CONTROL = ACCEPTED
```

through the same production validator.

Fail if the Producer can edit its validator after candidate freeze, self-certify final PASS, or create fixture-specific rejection logic.

### 8. Evidence identity

Require the final candidate/evidence chain to bind at least:

- commit;
- dist hash;
- validator version;
- ChatGPT UI contract hash;
- artifact hashes;
- evidence-root identity.

Fail if stale screenshots or prior candidate PASS can be reused after source changes.

### 9. User burden

The user is not routine QA.

Fail if the proposed final gate still asks the user to run a long sequence equivalent to:

```text
reload -> scroll -> click several controls -> send -> highlight -> refresh -> Notion -> copy report
```

A final user review may contain only truly subjective acceptance or unavoidable human-only actions.

### 10. Overengineering

The previous Mica failure included tooling expanding faster than the visible product.

Check whether the new plan is small enough:

- one adapter system;
- one semantic answer model;
- one acceptance harness;
- one normal popup;
- one troubleshooting surface;
- one Developer QA surface.

Reject new parallel ledgers/state machines/watchers/Atlas replacements that do not directly enable the product.

### 11. Execution feasibility

Check whether the Goal can be executed from the current local Mica work without discarding the positive checkpoint or assuming the remote main contains it.

Require source-of-truth discovery before branch/reset decisions.

---

## Severity

Use:

- P0 — architecture would predictably invalidate the rebuild or repeat user-as-QA;
- P1 — material missing contract likely to create another broad repair round;
- P2 — bounded improvement that should be fixed before implementation but does not change product direction.

Do not create cosmetic process findings.

---

## Verdict

Return exactly one:

```text
CRITIC_VERDICT=PASS
```

or:

```text
CRITIC_VERDICT=PLANNER_AMENDMENT_REQUIRED
```

A PASS requires:

```text
P0=0
P1=0
```

P2 may be nonzero only if every P2 is a bounded implementation clarification already unambiguously resolved by existing authority. Otherwise require amendment.

For every finding provide:

```text
ID
SEVERITY
AUTHORITY
FAILURE_MODE
WHY_IT_MATTERS
MINIMAL_AMENDMENT
USER_DECISION_REQUIRED=YES/NO
```

Do not provide implementation code.

End with:

```text
PRODUCT_COHERENCE=
CHATGPT_REFRESH_ARCHITECTURE=
LOW_MEMORY_CONTRACT=
ANSWER_REUSE_ARCHITECTURE=
ACCEPTANCE_ARCHITECTURE=
USER_NOT_FIRST_QA=
OVERENGINEERING_RISK=
READY_FOR_IMPLEMENTATION=YES/NO
```
