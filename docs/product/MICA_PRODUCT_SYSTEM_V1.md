# Mica Product System V1

Status: **AMENDED PLANNER INPUT / PENDING FRESH GPT CRITIC R2**  
Date: 2026-10-12  
Repository: `YuukiAS/Mica-for-ChatGPT`

This document defines what Mica is supposed to be before another implementation round begins. It supersedes the old pattern of building isolated fixes, diagnostic panels, Surface Atlas tooling, and page-specific UI first, then trying to infer a product afterward.

The product is a **small local browser extension that makes ChatGPT more usable without becoming a second ChatGPT client**.

The four product jobs are:

1. keep very long conversations usable on low-memory machines;
2. make answer reuse reliable: Markdown/LaTeX, Notion, highlighting, PDF;
3. recover from a small set of high-confidence ChatGPT web failures without creating duplicate actions;
4. survive ChatGPT UI changes through an explicit compatibility layer rather than scattered selectors.

Everything else is subordinate to those jobs.

---

## 1. Product principles

### 1.1 Native-first

Mica should look and behave as though it belongs next to ChatGPT, not as an independent dashboard floating over it.

- Preserve native ChatGPT interactions whenever possible.
- Inject the minimum number of controls.
- Prefer one Mica action/menu in a native answer action cluster over several new buttons.
- Prefer selection-driven highlighting over a permanent highlighter toolbar.
- Prefer popup status/settings over a persistent page status dot.
- Reliability UI appears only when an abnormal state exists.
- Unknown ChatGPT structure means fail-open, not visual guessing.

### 1.2 Product UI is not diagnostics UI

Normal users must never need to understand:

- Atlas;
- DOM selectors;
- mounted-turn counters as engineering jargon;
- fixture names;
- raw timing traces;
- contract hashes;
- developer build paths;
- copied PowerShell probes;
- implementation state machines.

These may exist behind Developer QA, but they are not product navigation.

### 1.3 Most operations stay inside Mica

Use the extension itself whenever Chromium APIs permit it.

External PowerShell/CLI is allowed only for tasks the extension cannot safely or technically perform, for example:

- one-time unpacked-extension/profile bootstrap;
- browser developer-mode operations that Chromium does not expose to extensions;
- launching an isolated Edge/Chrome QA profile with remote debugging;
- host-level memory/process inspection;
- UAC-required host operations.

When external tooling is necessary:

- it must be a committed, versioned repository script;
- README documents one stable command;
- never ask the user to paste ad-hoc JavaScript or PowerShell;
- never make external tooling the everyday Mica UX.

### 1.4 The user is not the first QA pass

A user-visible candidate must already have passed:

- Producer self-QA;
- deterministic acceptance;
- actual-surface/rendered review;
- applicable domain QA;
- independent holistic review when required.

The user makes final subtle choices or performs genuinely human-only login/OS/physical actions. The user does not discover ordinary button drift, broken copy, highlighter persistence failures, PDF text-layer failures, or stale ChatGPT selectors.

---

## 2. User mental model

A user should be able to understand Mica in one sentence:

> Mica quietly keeps long ChatGPT conversations light, gives better ways to reuse answers, and steps in only when the page is clearly stuck.

The normal product has four capabilities.

### A. Low memory

User-facing concept:

> Older messages can be paused locally to keep this conversation light. Nothing is deleted from ChatGPT.

Possible states:

- `Auto`
- `Active · N older messages paused`
- `Full history loaded`
- `Unavailable on this page`
- `Compatibility changed · using native ChatGPT`

User actions:

- enable/disable low-memory mode;
- load full history;
- optionally change the recent-message budget under Advanced.

No persistent page overlay is required.

### B. Copy & Export

Per-answer Mica entry opens one compact menu:

- Copy Markdown
- Copy for Notion
- Export PDF

The normal page should not add three separate answer buttons.

When current ChatGPT action-cluster placement is not proven, the page entry is hidden.

The only safe per-answer fallback is a Mica browser/context action invoked **inside an EXACT-resolved assistant answer**. The adapter must resolve the clicked/selected node to one exact assistant turn before showing or enabling `Copy this answer` / `Export this answer`.

The popup must not guess a target answer from viewport position, “latest answer”, broad ancestors, or focus history. If no exact answer target exists, per-answer actions are unavailable and the UI says so plainly.

### C. Highlighting

Selecting answer text may reveal a small contextual Mica highlight affordance.

Requirements:

- no permanent floating highlighter toolbar;
- text, inline math, display math boundaries handled coherently;
- highlights persist across reload/re-entry;
- highlights restore after ChatGPT turn remount/virtualization;
- highlight state is local by default;
- remove/change-color actions remain simple;
- if anchoring becomes ambiguous, do not silently attach to the wrong text.

### D. Reliability

Reliability is normally invisible.

Only high-confidence abnormal states may surface a recovery card/toast, for example:

- send intent but no committed user turn;
- generation error with recoverable draft;
- prolonged fake-waiting/stalled generation;
- known safe acknowledgement dialog.

The recovery UI gives one clear next action. It does not expose an internal state machine.

---

## 3. Product surfaces

### 3.1 Normal popup — the product home

Target width: normal Chromium extension popup scale, approximately 340–400 px.

The popup has:

#### Header

- Mica icon/name
- global enable switch
- concise current-page compatibility state

Example:

```text
Mica                    [on]
Ready on this page
```

#### Primary capability hierarchy

The normal popup is not a flat feature index.

Primary daily work is:

```text
Low memory          Auto · 34 older messages paused
Reuse answers       Copy · Export · Highlights
```

Reliability is a quiet page-health status, not a peer CTA when nothing is wrong:

```text
Page health          No issues
```

When a recovery-relevant event exists, Page health may become prominent and expose the one appropriate recovery action.

Rules:

- unreleased capabilities are hidden from the normal popup or explicitly marked unavailable; they must never display a false `Ready`;
- `Reuse answers` opens the Copy/Export/Highlight settings and explains only currently available actions;
- the popup must not imply that an unavailable injected answer control can still target an arbitrary answer;
- no standalone action button is added merely because a row exists.

#### Footer

- Troubleshooting
- version

Advanced settings are behind one progressive-disclosure entry.

### 3.2 Answer integration

Default desired integration is **one Mica entry in the native assistant action cluster**.

That entry owns Copy/Export actions.

Hard rule:

```text
PLACEMENT_PROVEN = NO -> DO_NOT_INJECT
```

The adapter must prove:

- target assistant turn;
- target native action cluster;
- sibling/parent relationship;
- control baseline/size family;
- current rendered visibility.

No “nearest div” fallback.

### 3.3 Selection integration

Only appears after a valid selection in a supported answer.

It must not:

- obscure the selected text;
- intercept native copy unnecessarily;
- remain visible after selection disappears;
- activate inside composer, code editing, auth/tool dialogs, or unsupported interactive blocks.

### 3.4 Recovery integration

Recovery UI is transient and event-driven.

It may appear:

- near the composer when the failure belongs to sending/generation;
- as a small non-blocking notice for a known acknowledgement event.

No permanent “Reliability panel” floats on the page.

### 3.5 Troubleshooting

Troubleshooting is user-facing but occasional.

It should provide:

- compatibility summary;
- low-memory state;
- latest recovery event summary;
- `Run self-check`;
- `Export diagnostic bundle`;
- `Load full history` when applicable;
- link/entry to Developer QA only in development builds or explicit developer mode.

Do not expose a Start/Stop/Copy/Reset matrix as the ordinary workflow.

### 3.6 Developer QA

Developer QA is available only in unpacked/dev builds or an explicit developer toggle.

It may provide:

- current ChatGPT contract status;
- recognized adapter variant;
- capability-level `EXACT / COMPATIBLE / UNKNOWN`;
- `Refresh current ChatGPT compatibility`;
- sanitized contract export;
- focused feature checks;
- candidate/build identity.

It must never appear in the normal popup by default.

---

## 4. Architecture

Mica must separate volatile ChatGPT structure from stable product features.

### 4.1 Platform adapter

Canonical boundary:

```text
extension/src/platform/chatgpt/
```

Suggested modules:

```text
adapter
turns
action-cluster
composer
generation
dialogs
interactive-blocks
compatibility
```

Only this layer may contain ChatGPT-specific DOM/AX selectors or structural heuristics.

Feature modules may consume typed capabilities only.

### 4.2 Capability contract

The adapter exposes capabilities such as:

```text
conversation.identity
turns.list
turn.resolveAnswerBody
turn.resolveFromNode
answerActions.resolveCluster
composer.resolve
generation.resolveState
dialogs.resolveKnownSafeAcknowledgement
interactiveBlocks.classify
virtualization.observe
```

Every capability is evaluated independently and records:

```text
capabilityId
variantId
status = EXACT | COMPATIBLE | UNKNOWN
requiredInvariants
observedInvariants
evidenceClass
observedAt
sourceArtifactHash
contractHash
invalidatedBy
```

Evidence classes are ordered:

```text
SYNTHETIC
LOCAL_REAL_BROWSER
REAL_DERIVED_CURRENT_CHATGPT
CURRENT_CHATGPT_READ_ONLY
CURRENT_CHATGPT_BOUNDED_ACTION
```

Rules:

- `EXACT` requires current real/real-derived ChatGPT evidence for the invariants that the capability depends on; synthetic evidence alone cannot produce release-authoritative `EXACT`.
- `COMPATIBLE` means the current observed variant differs from the frozen shape but every invariant required by that capability is directly proven on the current surface.
- `UNKNOWN` means the affected feature fails open.
- one capability becoming `UNKNOWN` does not automatically invalidate unrelated capabilities whose invariants still pass.
- a structural fingerprint mismatch, missing required invariant, incompatible variant, or newer refresh that contradicts the prior contract invalidates the prior capability acceptance immediately.
- `observedAt` is recorded for auditability, but elapsed time alone does not manufacture compatibility or incompatibility.
- visible text, DOM position, broad ancestor proximity, or “button N from the right” cannot be the sole identity proof.
- property-backed controls are read from authoritative properties/AX semantics rather than `textContent`.

No capability may manufacture certainty from text position or broad ancestor guesses.

### 4.3 Stable semantic answer model

Copy, Highlighter, PDF and Notion share one ordered, versioned intermediate model:

```text
AnswerDocument
  documentId
  conversationId
  turnId
  sourceVersion
  generationState = STREAMING | SETTLED
  orderedBlocks[]
```

Each block has a stable local BlockID, order, source mapping and content identity. Supported block kinds include:

```text
heading
paragraph
list
quote
table
code
inline_math
display_math
link
image
citation
opaque_interactive
unknown_block
```

Text-bearing blocks expose ordered source spans. Math blocks preserve, where available:

```text
rawTeX
renderedText
sourceSpan
displayMode
```

The model must preserve links/citations, code/table ordering, image references and unknown content without silently flattening interactive state into ordinary prose.

Streaming rules:

- a streaming answer produces provisional `sourceVersion` snapshots;
- export/highlight persistence does not treat a provisional snapshot as immutable final content;
- settled content creates the stable version used by export and durable highlight anchoring;
- later edit/branch/remount changes create a new source version and trigger anchor reconciliation rather than silent reuse.

Interactive/rich response blocks are opaque by default. Mica may copy/highlight only explicitly supported static text regions; it must not mutate or serialize hidden interactive state as though it were normal Markdown.

The ChatGPT adapter is the only layer that produces `AnswerDocument`. Copy, Highlighter, PDF and Notion may not independently scrape ChatGPT DOM.

### 4.4 Feature modules

```text
extension/src/features/
  low-memory/
  copy-export/
  highlighter/
  reliability/
```

Each feature owns:

- state;
- user-facing behavior;
- persistence;
- deterministic tests;
- failure semantics.

It does not own ChatGPT selectors.

---

## 5. Current ChatGPT compatibility refresh

Surface Atlas is historical evidence, not the ongoing compatibility authority.

The supported maintenance workflow becomes:

```text
verify -> refresh if drift -> diff -> adapter repair -> focused validation
```

Repository commands:

```text
npm run chatgpt-ui:verify
npm run chatgpt-ui:refresh
npm run chatgpt-ui:diff
```

### 5.1 verify

Checks whether the currently observed supported ChatGPT surface satisfies a known contract.

It should be read-only by default.

### 5.2 refresh

Captures only the surfaces Mica actually depends on:

- assistant turn boundary;
- assistant action cluster/native Copy neighborhood;
- composer empty/typed/busy/error/stop states when observable;
- known connector chooser structure when available without executing a connector;
- supported answer content structure;
- interactive/rich block boundary;
- virtualization/mounted-turn behavior;
- light/dark and representative width when obtainable safely.

Do not capture the full ChatGPT product.

Do not capture:

- prompt/answer text;
- conversation titles;
- account identity;
- sidebar history;
- tokens/cookies/headers/request bodies;
- unrelated tabs.

### 5.3 diff

Produces a small capability-oriented report:

```text
answerActions: unchanged
composer: compatible variant added
generation: invariant changed
interactiveBlocks: new unknown class
```

The goal is to tell the developer what adapter capability changed, not produce a huge DOM archive.

### 5.4 Multiple simultaneous UI variants

Do not define one global “latest ChatGPT DOM”.

The runtime may recognize several active contracts because of staged rollout/A-B tests.

A contract is identified by structural invariants, not by account name or brittle CSS classes.

### 5.5 Refresh inside Mica

Developer QA should expose a button:

```text
Refresh current ChatGPT compatibility
```

When browser security prevents the extension from completing a required developer-only capture, it may export a bounded request for the committed CLI helper.

That is fallback, not primary workflow.

---

## 6. Low-memory contract

Low-memory is a core product capability, not an optional diagnostics experiment.

Hard release condition:

```text
LOW_MEMORY_TRUNCATION = PASS
```

The implementation mechanism may evolve, but the user contract is fixed:

1. substantially reduce additional client memory/render cost for long conversations on target low-memory machines;
2. preserve recent active context needed for normal work;
3. never delete server history;
4. provide deterministic full-history restoration;
5. disabling Mica returns to native behavior;
6. preserve send, streaming, edit, branch, tools, attachments, connectors and auth surfaces;
7. unknown/unsafe structures fail-open;
8. prove measurable value beyond current native ChatGPT behavior.

“ChatGPT already virtualizes” is a baseline fact, not permission to remove this capability.

Normal UI should describe the outcome, not the mechanism:

```text
34 older messages paused
Keep recent 40 active
Load full history
```

---

## 7. Copy, Highlighter, PDF and Notion

These are one answer-reuse system.

### 7.1 Provenance

Before integrating code from `YuukiAS/Web_Highlighter` or AI Exporter:

- record upstream/source identity;
- inspect license/provenance;
- copy code only when allowed;
- otherwise reimplement behavior from the observed contract.

### 7.2 Highlight anchors

A highlight anchor should combine independent evidence where possible:

```text
conversation identity
turn identity
text quote
prefix/suffix
structural hint
math TeX source
```

Do not depend on one absolute DOM path.

### 7.3 PDF

Use a local document-rendering route, not screenshot concatenation.

PDF acceptance must prove both visual and text-layer behavior.

Hard gates include:

```text
PDF_TEXT_SEARCH_SELECT = PASS
PROSE_INLINE_MATH_PROSE_SELECTION = PASS
DISPLAY_MATH_SELECTABLE = PASS
MATH_COPY_RESULT = PASS
MATH_SEARCHABLE = PASS
WEB_HIGHLIGHT_CROSS_MATH_TO_PDF = PASS
```

The critical regression case is a continuous selection:

```text
prose -> inline math -> prose
```

The copied/selected output must retain the mathematical symbols in order rather than skipping them.

Validation must combine:

- actual rendered PDF;
- PDF text extraction;
- PDF.js text-layer behavior;
- programmatic cross-node selection/copy;
- search;
- highlight mapping;
- visual comparison.

A PDF that merely looks correct is insufficient.

---

## 8. Reliability contract

Reliability uses a shared delivery state machine, but the state machine is internal.

Product behavior:

- confirm a new user turn before treating send as committed;
- preserve drafts when commit is uncertain;
- never duplicate a consequential send;
- detect high-confidence stalled/fake-waiting states;
- recover known safe failures with one bounded action;
- consequential tool/file/connector/auth flows prohibit automatic resend/regenerate;
- unknown conditions fail-open.

Any automatic recovery must be:

- bounded;
- deduplicated;
- kill-switchable;
- visible after it occurs.

---

## 9. Acceptance architecture

Mica adopts the same separation of ownership that has proven necessary in other artifact/product workflows.

### 9.1 ChatGPT / Planner

Owns:

- product meaning;
- product surfaces;
- user jobs;
- visible hierarchy;
- what belongs in normal UI vs troubleshooting vs developer QA;
- release scope;
- genuine subjective decisions.

### 9.2 Codex Parent Controller

Owns autonomous execution inside one Goal:

- fresh Producer;
- frozen deterministic Validator;
- fresh actual-surface/rendered Reviewer;
- repair/re-review loops;
- candidate identity;
- evidence assembly.

The user does not relay review blocks between these roles.

### 9.3 Codex Producer

Owns implementation and self-QA.

May not:

- weaken acceptance rules;
- edit validators/negative controls merely to make the candidate pass;
- declare authoritative final PASS;
- send an internally failing candidate to GPT Work/user.

### 9.4 Frozen deterministic Validator

Must be read-only against the candidate.

It binds:

```text
candidate commit
dist hash
validator version
UI contract hash
fixture/control hashes
artifact hashes
evidence-root identity
```

It must prove both:

```text
KNOWN_BAD_CONTROL = REJECTED
KNOWN_GOOD_CONTROL = ACCEPTED
```

Known-bad controls must exercise the same production validation path as the real candidate.

No fixture-specific `rejects()` shortcut.

### 9.5 Fresh actual-surface/rendered Reviewer

Inspects what the user actually consumes:

- real extension popup;
- actual injected UI against current ChatGPT contract;
- actual PDF;
- light/dark;
- relevant width/scale;
- recovery states.

It reviews visuals and interaction semantics, not Producer prose.

### 9.6 GPT Work

GPT Work is a final holistic quality gate when the candidate is already internally accepted.

It evaluates:

- product coherence;
- cognitive load;
- natural visual integration;
- discoverability;
- whether the feature set feels like one product;
- subtle UX blind spots.

GPT Work does not debug:

- selectors;
- button placement mechanics;
- PDF text extraction;
- highlighter persistence;
- composer state machines;
- low-memory correctness.

### 9.7 User

The user is the final subtle decision-maker.

The user may be asked for:

- one final subjective acceptance;
- a genuinely human-only login/OS/physical action;
- a true product preference not frozen by this contract.

The user must not be asked to perform a multi-step routine regression script.

---

## 10. Acceptance harness

Create one canonical acceptance entry, for example:

```text
npm run acceptance:preflight
npm run acceptance:focused -- <feature>
npm run acceptance:candidate
```

The exact command names may vary, but there must be one canonical production path.

The harness covers:

- candidate identity;
- current ChatGPT adapter compatibility;
- popup/render states;
- low-memory;
- Copy/Notion serialization;
- highlighter anchors/remount;
- PDF visual/text/math/highlight behavior;
- reliability state transitions;
- privacy;
- packaging/version consistency.

Known-bad regressions should include at least:

- historical Mica Copy action misplacement;
- connector/composer residual/remount failure;
- stale/fake-waiting send lifecycle;
- low-memory no-op/ineffective candidate;
- lost highlight after remount;
- non-selectable inline-math PDF;
- stale ChatGPT contract accepted as current.

---

## 11. Release model

A release candidate is immutable after freeze.

A source/artifact change invalidates the corresponding prior validation/review.

Release readiness is not derived from one executor-written status field.

Required sequence:

```text
Product/contract freeze
-> Producer
-> self-QA
-> candidate freeze
-> frozen deterministic Validator
-> fresh actual-surface/rendered Reviewer
-> repair if needed
-> fresh freeze + validation/review
-> GPT Work holistic review when required
-> minimal final user acceptance
-> merge/release
```

Do not release from a local-only commit that independent reviewers cannot fetch.

Do not merge merely to make a candidate reviewable; push the review branch first.

---

## 12. Definition of Mica V1 product-system completion

The product system is complete only when:

```text
NORMAL_POPUP_IS_PRODUCT_UI = PASS
TROUBLESHOOTING_IS_BOUNDED = PASS
DEVELOPER_QA_SEPARATE = PASS
CHATGPT_ADAPTER_SINGLE_AUTHORITY = PASS
CHATGPT_UI_REFRESH = PASS
MULTI_VARIANT_COMPATIBILITY = PASS
UNKNOWN_FAIL_OPEN = PASS
ANSWER_DOCUMENT_SHARED_MODEL = PASS
LOW_MEMORY_TRUNCATION = PASS
ACCEPTANCE_HARNESS_SELF_VALIDATES = PASS
USER_IS_FIRST_QA = NO
```

Highlighter/PDF/Notion may be implemented after this foundation, but they must use it rather than create new parallel DOM, UI, or acceptance systems.
