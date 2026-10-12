# Mica Product System Rebuild — Independent GPT Critic Prompt

Status: **CURRENT PRE-IMPLEMENTATION REVIEW AUTHORITY**  
Date: 2026-10-12  
Audience: **fresh independent GPT Critic, not Codex Producer/Controller**  
Repository: `YuukiAS/Mica-for-ChatGPT`

## 0. Purpose

You are the independent GPT Critic for the complete Mica rebuild plan.

This review happens **before Codex implementation begins**.

You are not reviewing a finished build and you are not a Codex subagent. Your job is to audit the entire proposed product/development/delivery system and decide whether it is safe and coherent enough to freeze into a final Codex Goal.

The Critic must review all of the following together:

1. what Mica is as a product;
2. what the normal Mica UI should look like and how it should be used;
3. how Mica integrates into current ChatGPT without looking bolted on;
4. how ChatGPT UI changes are detected and refreshed later;
5. how Low Memory works as a real core capability;
6. how Copy / Highlight / PDF / Notion should fit the product;
7. how the code architecture prevents selectors and UI assumptions from spreading;
8. how Codex develops and self-QAs the product;
9. how deterministic acceptance prevents degraded/fake implementations;
10. how actual-surface review, GPT Work, ChatGPT Planner and the user divide responsibility;
11. how old Atlas/debug/legacy branches and old product UI are cleaned up;
12. how source-of-truth, candidate identity, Git integration and release closure work;
13. whether the proposed process is too heavy relative to the product;
14. whether the plan is likely to prevent the user from becoming first-line QA again.

The output is a **Planner-level architecture verdict**, not implementation code.

---

## 1. Read these Mica authorities first

Read the current repository state and at least:

```text
docs/product/MICA_PRODUCT_SYSTEM_V1.md
docs/tasks/2026-10-12-mica-product-system-rebuild-goal.md
AGENTS.md
README.md
docs/ROADMAP.md
docs/REAL_BUG_CONVERGENCE_WORKFLOW.md
docs/TEST_ARCHITECTURE_V2.md
```

Read historical evidence only to understand failure classes, not as current authority:

```text
docs/tasks/2026-10-05-mica-product-recovery-current-gpt-ui.md
tests/contracts/chatgpt-live/**
docs/investigations/**
open issues relevant to long-thread, composer/reliability, export/highlighter
```

If the local-only positive checkpoint `0f2d40e16b2dcd0af8f7d567981dce7bf7b656cc` is not available from the repository you can access, treat its reported behavior as **unverified historical context**, not as proof.

---

## 2. Read reusable delivery-discipline authorities

From `YuukiAS/AI_Skills_Collection`, read the current versions of:

```text
docs/plugin-todos/workflow-core.md
docs/plugin-todos/web-development.md
plugins/codex/plugins/presentations/shared/authoring-production-workflow.md
plugins/codex/plugins/presentations/shared/pre-execution-cumulative-acceptance-contract.md
docs/plugin-todos/research-authoring-production-workflow.md
plugins/codex/plugins/research-writing/shared/student-assessment-cumulative-acceptance-contract.md
plugins/codex/plugins/research-writing/shared/student-assessment-delivery-closure-amendment-v1.md
docs/plugin-todos/presentations.md
```

Extract only reusable production/acceptance lessons.

Do **not** import slide-specific, student-assessment-specific, or research-document-specific content rules into Mica.

Pay particular attention to these generic lessons:

- user is not first QA;
- Producer self-QA is necessary but not authoritative acceptance;
- exact candidate identity matters;
- known-bad and known-good controls must exercise the same production validator;
- evidence can self-certify incorrectly if the validator is weak;
- source/artifact changes invalidate stale acceptance;
- actual rendered/consumed surface matters;
- external review should confirm quality, not discover obvious local defects;
- control machinery must remain smaller than the remaining product problem;
- one active authority/route;
- a Human Gate must be genuinely human-only.

---

## 3. Check current public ChatGPT product reality

Use current public/official web information where useful to understand recent ChatGPT web UI and response-surface changes.

You do not need to reverse engineer private DOM from public screenshots.

The review question is:

> Does the proposed Mica architecture remain valid when ChatGPT changes its action bar, composer, response rendering, interactive answer surfaces, staged/A-B UI variants, or native virtualization?

Reject any plan that still depends on one globally fixed “latest ChatGPT DOM”.

---

## 4. Review Mica as a product, not a feature backlog

Evaluate whether a normal user can understand Mica immediately.

The intended one-sentence mental model is currently:

> Mica keeps long ChatGPT conversations light, makes answers easier to reuse, and steps in only when the page is clearly stuck.

Critique whether that is the correct product center.

Assess whether the four current product jobs are coherent:

```text
Low memory
Copy & Export
Highlights
Reliability
```

Questions:

- Are these the right top-level jobs?
- Should any be combined, hidden, demoted, renamed or removed?
- Is the popup hierarchy appropriate?
- Does Troubleshooting belong where proposed?
- Should Developer QA exist inside the extension, and if so how hidden should it be?
- Is a single per-answer Mica action the right integration?
- Is selection-driven highlighting the right interaction?
- Should the persistent status dot disappear?
- Are reliability interventions appropriately transient?
- Is there any remaining debug-dashboard thinking in the proposed normal UI?
- Is the product trying to do too much at once?

Judge first-glance coherence and long-term usability, not only feasibility.

---

## 5. Review UI design authority and implementation discipline

The final Codex Goal must not leave enough ambiguity for another improvised/ugly popup.

Audit whether the plan gives Frontend Design enough authority to freeze:

- information hierarchy;
- navigation;
- component families;
- spacing/density;
- button/icon grammar;
- progressive disclosure;
- light/dark;
- responsive popup widths;
- focus/keyboard;
- supported/unsupported/degraded states;
- answer action integration;
- highlighter affordance;
- recovery affordance;
- Troubleshooting;
- Developer QA.

At the same time, reject over-specification that would freeze a visual solution before current ChatGPT surface evidence exists.

The correct plan should require:

```text
current surface evidence
-> product/UI design freeze
-> implementation
-> actual rendered comparison
```

not:

```text
implementation guesses
-> screenshots
-> user points out obvious defects
```

Critique whether the current Product System V1 gets this balance right.

---

## 6. Review ChatGPT compatibility architecture

Audit the proposed `ChatGPTAdapter` idea.

Require a clear answer to:

- what belongs in the adapter;
- what feature modules are forbidden to know;
- how multiple live UI variants are represented;
- how `EXACT / COMPATIBLE / UNKNOWN` are decided;
- how stale contracts are detected;
- what happens when only one capability changes;
- how fail-open works;
- how AnswerDocument is built;
- how interactive/non-Markdown response blocks are treated;
- how native virtualization interacts with Low Memory.

Critique `chatgpt-ui:verify / refresh / diff`.

It must not simply recreate Surface Atlas under a new name.

The refresh system should be:

- narrow;
- capability-oriented;
- privacy-safe;
- repeatable;
- cheap enough to run after UI changes;
- mostly invokable from Mica Developer QA;
- able to fall back to one committed external helper only when browser/OS constraints make that necessary.

Identify any missing capability or drift scenario that would still force repeated user debugging.

---

## 7. Review Low Memory as a true product capability

The plan currently treats:

```text
LOW_MEMORY_TRUNCATION = PASS
```

as a hard release gate.

Audit whether that is scientifically and technically meaningful.

Require that the final plan distinguishes:

- native ChatGPT virtualization baseline;
- Mica's additional effect;
- DOM/render savings;
- JS heap/process memory evidence where measurable;
- current/recent message retention;
- scroll-back behavior;
- full-history restoration;
- disable/uninstall behavior;
- server-history safety;
- send/stream/edit/branch/tool/file/connector/auth regressions;
- typing/IME hot path.

Reject a gate that can pass merely because mounted DOM is small.

Reject a plan that permits Low Memory to become `Native handling` or a status label.

Also identify if the proposed implementation scope risks fighting React/native virtualization unsafely.

---

## 8. Review AnswerDocument / reuse architecture

Audit whether one shared semantic `AnswerDocument` is the right boundary for:

```text
Markdown copy
Notion copy
Highlighter
PDF
```

Check:

- semantic block coverage;
- source fidelity;
- inline/display math representation;
- citations/links;
- tables/code;
- images;
- interactive/rich UI blocks;
- unknown blocks;
- mapping back to source ranges for highlights;
- preserving current ChatGPT answer evolution without four independent DOM scrapers.

Reject any design where PDF/Highlighter/Copy independently parse ChatGPT.

---

## 9. Review Highlighter integration

Use `YuukiAS/Web_Highlighter` only as evidence/reference after provenance/license review.

Audit whether the Mica plan correctly preserves the valuable behaviors:

- mixed text + math selection;
- KaTeX/MathJax/raw LaTeX source;
- persistence after reload;
- remount/virtualization recovery;
- color/change/delete behavior;
- no dangerous global Range/Selection monkey patch.

Critique the proposed highlight anchor:

```text
conversation identity
turn identity
text quote
prefix/suffix
structural hint
math TeX source
```

Identify ambiguity/failure cases.

---

## 10. Review PDF architecture and the math-selection defect

This is a mandatory product issue.

The plan must solve the known AI Exporter-style failure:

> In exported PDF, mathematical symbols cannot be selected/highlighted continuously with nearby prose.

The Critic must explicitly judge whether the proposed acceptance is strong enough.

The required regression is:

```text
ordinary prose -> inline math -> ordinary prose
```

A drag/selection across that span must include the mathematical content in order.

The plan currently requires:

```text
PDF_TEXT_SEARCH_SELECT
PROSE_INLINE_MATH_PROSE_SELECTION
DISPLAY_MATH_SELECTABLE
MATH_COPY_RESULT
MATH_SEARCHABLE
WEB_HIGHLIGHT_CROSS_MATH_TO_PDF
```

Review whether these are sufficient.

Require actual PDF behavior, not screenshot-only or text extraction alone.

Audit whether the proposed combination of:

- rendered PDF;
- PDF.js text layer;
- cross-boundary programmatic selection/copy;
- search;
- extraction;
- visual fidelity;
- highlight mapping

is a good acceptance model.

Call out any technically impossible or misleading expectation and propose a truthful fallback contract.

---

## 11. Review reliability architecture

Audit:

- send intent vs actual user-turn commit;
- draft retention;
- fake waiting/stall;
- stale/wrong-turn response;
- generation error;
- bounded reload/retry;
- per-turn dedupe;
- kill switch;
- connector/tool/file/auth consequential boundaries;
- unknown-state fail-open.

The visible UI must stay simple even if the internal state machine is complex.

Reject any plan likely to add permanent observers/polling or typing hot-path cost merely for diagnostics.

---

## 12. Review normal UI vs Troubleshooting vs Developer QA vs external tooling

The current intended boundary is:

### Normal UI
daily product use.

### Troubleshooting
bounded occasional self-check/recovery.

### Developer QA
dev/unpacked-only compatibility refresh and focused diagnostics.

### External tooling
only when extension/browser APIs cannot perform the required developer action.

Audit whether each proposed action is in the correct layer.

External tooling should be allowed for things such as:

- developer-mode bootstrap;
- isolated browser/CDP startup;
- host process/memory measurements;
- UAC-required system actions.

Reject any plan that normalizes:

- copying temporary PowerShell;
- pasting JavaScript into DevTools;
- manual DOM inspection;
- repeated screenshot collection;
- user-run Atlas sessions.

---

## 13. Review acceptance harness design

The proposed architecture uses:

```text
acceptance:preflight
acceptance:focused
acceptance:candidate
```

Audit whether this is enough.

The deterministic validator must be:

- frozen before authoritative final validation;
- independent/read-only relative to candidate;
- bound to exact candidate and evidence;
- capable of rejecting historical bad implementations;
- capable of accepting valid controls;
- incapable of special-casing fixture identity.

Required:

```text
KNOWN_BAD_CONTROL = REJECTED
KNOWN_GOOD_CONTROL = ACCEPTED
```

Known-bad controls must use the **same production validation path**.

Review the proposed known-bad set and add/remove cases as needed.

Explicitly check for the exact failure recently found in Presentations:

> a nominal validator can self-certify bad evidence or use fixture-specific rejection paths.

Mica's plan must prevent that class.

---

## 14. Review role ownership

Audit whether the final development/review sequence should be:

```text
ChatGPT Planner
-> Codex Parent/Producer
-> deterministic Validator
-> actual-surface/rendered Reviewer
-> GPT Work
-> user
```

Clarify responsibilities.

### ChatGPT Planner

Should own:

- product definition;
- architecture boundaries;
- visible product semantics;
- product priorities;
- genuine semantic decisions;
- final Goal.

### Codex

Should own:

- implementation;
- local environment;
- tests;
- fixtures;
- browser harness;
- candidate generation;
- mechanical/interaction/visual self-QA;
- automated repair loops;
- evidence;
- packaging.

### Deterministic Validator

Should own machine-verifiable release invariants.

### Actual-surface/rendered Reviewer

Should inspect the final consumed surface independently.

### GPT Work

Should be used only when it adds holistic UX/product/taste value after local closure.

It must not be the first system to notice obvious button drift, incorrect states, broken PDF selection or failed highlighting.

### User

Should only make final subtle judgments or unavoidable human-only actions.

Audit whether any proposed Human Gate violates this.

---

## 15. Review cleanup/migration plan

The rebuild must not leave Mica with two products and three test systems.

Require an explicit disposition for:

- old Surface Atlas code/scripts/contracts;
- old popup/debug UI;
- persistent status dot/overlay;
- old recovery modules;
- old selector-heavy feature paths;
- old synthetic fixtures;
- old local-only candidate artifacts;
- old Goals;
- stale README/ROADMAP;
- old release packages;
- old open PRs/branches;
- legacy Issue closure state.

For each class, require one of:

```text
KEEP_AND_MIGRATE
KEEP_AS_HISTORICAL_EVIDENCE
ARCHIVE
REMOVE
SUPERSEDE
```

Do not allow dead paths to remain enabled “just in case”.

---

## 16. Review source-of-truth and Git/release plan

The Critic should verify that the proposed workflow handles the local-only positive checkpoint safely.

Reject:

- throwing away local work because remote main is older;
- merging unreviewed local candidate into main just to make it visible;
- releasing from a local-only commit;
- using old evidence against a new candidate;
- versioning before source lineage is known.

Require:

```text
source audit
-> preserve positive checkpoint
-> new rebuild branch
-> immutable review candidate pushed
-> validation/review
-> merge
-> tag/package/release
```

---

## 17. Review scope and sequencing

The current proposed order is:

```text
product/contracts
-> visible shell
-> ChatGPTAdapter
-> compatibility refresh
-> acceptance harness
-> Low Memory
-> Copy/Export + Reliability
-> Highlighter
-> PDF/Notion
-> frozen validation
-> actual-surface review
-> GPT Work
-> minimal user acceptance
-> release
```

Critique this sequence.

In particular decide:

- should acceptance-harness skeleton come before visible shell implementation?
- should ChatGPTAdapter precede UI shell implementation?
- should Low Memory be proven before answer-reuse features?
- should Highlighter/PDF be in the first rebuilt release or a second milestone?
- what is the smallest product milestone that is actually useful and structurally complete?
- where should the system freeze and review before scope expands?

Do not optimize for the shortest calendar time. Optimize for avoiding another month of invalid development.

---

## 18. Review overengineering risk

The plan is itself invalid if it creates another large process system that delays the visible product.

Explicitly check whether Mica can remain limited to:

- one product UI system;
- one ChatGPT adapter;
- one semantic answer model;
- one compatibility refresh mechanism;
- one acceptance harness;
- one candidate/evidence identity scheme.

Reject unnecessary:

- new state-machine families;
- watchers/daemons;
- duplicated review layers;
- Atlas replacements;
- dozens of new governance files;
- per-feature validation frameworks;
- permanent debug overlays.

Every proposed artifact/tool must have a direct product or release-safety purpose.

---

## 19. Review final user journey

Simulate these journeys at the specification level:

### Daily normal use

1. user opens a long ChatGPT thread;
2. Mica keeps it light without asking questions;
3. user copies/exports an answer;
4. user highlights text/math;
5. no diagnostics UI is visible.

### ChatGPT UI changed

1. runtime detects unsupported capability;
2. affected feature fails open;
3. user can keep using native ChatGPT;
4. Developer QA refreshes compatibility;
5. Codex repairs only affected adapter capability;
6. focused validation proves it;
7. update ships.

### Page got stuck

1. Mica detects a high-confidence failure;
2. one clear recovery action appears;
3. no duplicate/consequential send occurs.

### Developer release

1. Product/contract is frozen;
2. Producer implements;
3. known-bad controls fail and known-good controls pass;
4. exact candidate passes deterministic validation;
5. actual surface passes;
6. GPT Work reviews product-level quality;
7. user sees only an already-good final candidate.

If any journey still requires repeated founder debugging, fail the plan.

---

## 20. Verdict rules

Return exactly one top-level verdict:

```text
CRITIC_VERDICT=PASS
```

or:

```text
CRITIC_VERDICT=PLANNER_AMENDMENT_REQUIRED
```

PASS requires:

```text
P0=0
P1=0
PRODUCT_MODEL_READY=YES
UI_DIRECTION_READY=YES
CHATGPT_COMPATIBILITY_ARCH_READY=YES
DEVELOPMENT_ARCH_READY=YES
ACCEPTANCE_ARCH_READY=YES
CLEANUP_PLAN_READY=YES
EXECUTION_DISCIPLINE_READY=YES
READY_TO_FREEZE_CODEX_GOAL=YES
```

Do not PASS because the plan is long or sounds rigorous.

---

## 21. Finding format

For every finding:

```text
ID=
SEVERITY=P0|P1|P2
AREA=PRODUCT|UI|CHATGPT_COMPAT|ARCHITECTURE|LOW_MEMORY|ANSWER_REUSE|HIGHLIGHTER|PDF|RELIABILITY|ACCEPTANCE|ROLE_OWNERSHIP|CLEANUP|GIT_RELEASE|SCOPE|EXECUTION
AUTHORITY=
FAILURE_MODE=
WHY_IT_MATTERS=
MINIMAL_PLANNER_AMENDMENT=
USER_DECISION_REQUIRED=YES|NO
```

Distinguish:

- real product/architecture defect;
- missing evidence;
- optional improvement;
- implementation detail that does not belong in Planner authority.

Do not inflate P2 cosmetic preferences into blockers.

---

## 22. Required final synthesis

End with a compact replacement decision, not just findings:

```text
WHAT_MICA_SHOULD_BE=
WHAT_NORMAL_UI_SHOULD_CONTAIN=
WHAT_SHOULD_NOT_BE_IN_NORMAL_UI=
HOW_CHATGPT_UI_REFRESH_SHOULD_WORK=
WHAT_CODEX_SHOULD_BUILD_FIRST=
WHAT_ACCEPTANCE_HARNESS_MUST_PROVE=
WHAT_GPT_WORK_SHOULD_REVIEW=
WHAT_THE_USER_SHOULD EVER_HAVE_TO_DO=
WHAT_OLD_MICA_PARTS_SHOULD_BE_REMOVED_OR_ARCHIVED=
RECOMMENDED_IMPLEMENTATION_SEQUENCE=
RECOMMENDED_FIRST_RELEASE_SCOPE=
READY_TO_FREEZE_CODEX_GOAL=YES|NO
```

If amendment is required, keep it bounded. Do not rewrite the entire plan unless the product model itself is fundamentally wrong.
