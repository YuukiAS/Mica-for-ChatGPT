# Mica Product System V1

Status: **FROZEN PLANNER AUTHORITY / GPT CRITIC R2 PASS / POST-R2 PRIORITY AMENDMENT**  
Date: 2026-10-12  
Repository: `YuukiAS/Mica-for-ChatGPT`

This document defines what Mica is supposed to be before another implementation round begins. It supersedes the old pattern of building isolated fixes, diagnostic panels, Surface Atlas tooling, and page-specific UI first, then trying to infer a product afterward.

The product is a **small local browser extension that makes ChatGPT more usable without becoming a second ChatGPT client**.

The durable product jobs are:

1. keep very long conversations usable on low-memory machines;
2. make ChatGPT answer highlighting reliable and persistent;
3. export high-fidelity local PDF, preserving highlights and selectable/searchable mathematics;
4. support answer reuse and conservative reliability improvements without turning Mica into a second ChatGPT client;
5. survive ChatGPT UI changes through an explicit compatibility layer rather than scattered selectors.

Current implementation priority is narrower than the full durable product scope:

```text
P0 FOUNDATION = rebuild product shell + ChatGPTAdapter + compatibility refresh + acceptance harness
P1 FEATURE = Low Memory
P2 FEATURE = built-in ChatGPT Highlighter
P3 FEATURE = highlight-preserving PDF export with selectable math
DEFERRED = advanced Reliability (~60s no-progress recovery), Notion, other secondary reuse features
```

Everything else is subordinate to that order. No deferred feature may delay P0–P3.

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

### D. Reliability — durable future capability, not current priority

Reliability is normally invisible.

The safety semantics in §8 remain frozen for later work, but advanced recovery is **not part of the current prioritized rebuild path**. In particular, the ~60-second no-structural-progress recovery behavior is deferred until Foundation, Low Memory, Highlighter and PDF are stable.

Existing Reliability code may be preserved, simplified, disabled or migrated only as required to keep the rebuild safe. Codex must not spend substantial implementation/review budget expanding Reliability before P0–P3 are closed.

When later activated, only high-confidence abnormal states may surface a recovery card/toast.

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
npm run chatgpt-ui:refresh -- --input <mica-developer-qa.v1.json> [--output <repo-relative.json>]
npm run chatgpt-ui:diff
npm run chatgpt-ui:diff -- --input <qa-or-normalized-observation.json>
```

These commands are offline repository tooling. They do not open a browser, navigate ChatGPT, send messages, or update `contracts/chatgpt/current.json`. Developer QA remains the primary capture surface; `refresh` only ingests an explicit exported report and writes an allowlisted observation. Its output is input for review and diffing, not automatic release authority or live acceptance.

### 5.1 verify

Checks the committed contract and committed bootstrap evidence for schema, privacy, source-observation, and fail-open consistency. A successful result verifies the repository baseline only; it does not assert that the current live ChatGPT UI still matches.

It should be read-only by default.

### 5.2 refresh

In the implemented CLI fallback, requires an explicit `mica-developer-qa.v1` export. It verifies the current contract hash and privacy flags, rejects duplicate or unbounded capabilities, fingerprints free-form invariant/reason strings, and retains only capability-level metadata. It never captures a page itself.

Developer QA captures only the surfaces Mica actually depends on:

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

Without `--input`, compares the committed bootstrap evidence with the current contract. With `--input`, accepts either a Developer QA export or a normalized refresh observation and produces a small capability-oriented report:

```text
answerActions: unchanged
composer: compatible variant added
generation: invariant changed
interactiveBlocks: new unknown class
```

The goal is to tell the developer what adapter capability changed, not produce a huge DOM archive.

The report classifies capabilities independently. A changed supported capability becomes `CONTRACT_CHANGED` and fails open without invalidating unrelated matches. A previously unknown or entirely new capability remains `UNKNOWN` even if an untrusted exported report claims `EXACT`; contract promotion still requires the repository's normal evidence and review process.

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

Bootstrap exception for this rebuild: because Developer QA does not exist yet, the **first** current-ChatGPT evidence pack may be acquired through an already-supported read-only browser surface or one existing/self-tested bounded helper. It must obey the same privacy and capability-scoped contract and must not automate the user's normal browsing profile or generate a repeated real-request loop.

After Developer QA is implemented and validated, ordinary compatibility refresh must move into Mica; the bootstrap route becomes fallback only.

---

## 6. Low-memory contract

Low-memory is a core product capability, not an optional diagnostics experiment.

Hard release condition:

```text
LOW_MEMORY_TRUNCATION = PASS
```

### 6.1 Feasibility and benefit gate

Before broad feature migration, the rebuild must prove that Low Memory provides **additional value beyond current native ChatGPT behavior**.

Compare the same long-conversation workload in three conditions:

```text
A = Mica absent/disabled
B = Mica installed, Low Memory disabled
C = Mica installed, Low Memory enabled
```

Use the same representative scroll/typing/send/re-entry sequence.

Measure, where the environment exposes them reliably:

- process/private working-set memory or an equivalent browser-process metric;
- JS heap;
- mounted/heavy retained content;
- long tasks;
- frame/scroll stalls;
- input latency;
- mutation/layout work.

The acceptance result is falsifiable:

- C must show a repeatable resource/performance improvement over A/B on at least one target long-thread workload **without** a material regression in typing, scrolling, send/streaming or history recovery;
- a fixture that merely reduces synthetic DOM count but does not improve the measured target workload is a known-bad `LOW_MEMORY_NO_EFFECT` control;
- a candidate that simply reports native ChatGPT windowing cannot pass;
- noisy memory metrics are reported with repeated samples/ranges; one favorable sample is not sufficient.

The exact numerical threshold may be calibrated during the pre-candidate feasibility run because browser/process metrics vary by machine, but it must be frozen before authoritative candidate validation. The final threshold must reject the historical/no-op control and accept the known-good positive control.

### 6.2 Safety contract

The implementation mechanism may evolve, but the user contract is fixed:

1. preserve recent active context needed for normal work;
2. never delete server history;
3. provide deterministic full-history restoration;
4. disabling/uninstalling Mica returns to native behavior;
5. preserve send, streaming, edit, branch, tools, attachments, connectors and auth surfaces;
6. preserve typing/IME hot-path performance;
7. unknown/unsafe structures fail-open;
8. do not delete or detach React-managed interactive nodes merely to improve a metric unless the mechanism has been explicitly proven safe against the current adapter contract.

“ChatGPT already virtualizes” is a baseline fact, not permission to remove this capability.

Normal UI describes the outcome, not the mechanism:

```text
34 older messages paused
Keep recent 40 active
Load full history
```

---

## 7. Copy, Highlighter, PDF and Notion

These are one answer-reuse system.

### 7.1 Technical reference boundary

`YuukiAS/Web_Highlighter` and AI Exporter are user-directed technical references for behavior and regression comparison.

For this Planner/acceptance system:

- legal/licensing/provenance review is out of scope and is not a product gate;
- source identity may be recorded only when useful for technical reproducibility;
- Critic/reviewer findings must not block the rebuild on licensing/provenance analysis;
- the first two rebuild milestones scope highlighting to ChatGPT surfaces. General arbitrary-webpage highlighting is a later explicit scope and must not be silently claimed complete.

### 7.2 Highlight anchors

A highlight anchor combines independent evidence where possible:

```text
conversation identity
turn identity
AnswerDocument sourceVersion
BlockID
text quote
prefix/suffix
source span
structural hint
math TeX source
```

Anchor resolution must explicitly detect ambiguity.

Required cases:

- repeated identical sentence within one answer;
- edited/branched answer with similar text;
- turn remount/virtualization;
- equivalent or reformatted math;
- surrounding text changes;
- deleted source content.

If one unique target cannot be proven, the highlight record remains stored but is not automatically attached to a different location. The UI may mark it unresolved; it must never silently restore to the wrong phrase.

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
- **real pointer drag/selection in at least one supported real viewer engine**;
- search;
- copy order;
- visual position/text-layer alignment;
- highlight mapping, including cross-line/cross-page/math cases;
- visual comparison.

PDF.js programmatic selection and extraction are supporting evidence, not substitutes for the real pointer-selection regression.

The baseline hard case is ordinary prose → inline math → ordinary prose. It cannot be downgraded to PASS through a complex-formula fallback.

Complex formulas may have a documented fallback only after the baseline case passes. The fallback must be visible and deterministic rather than silently rasterizing selectable text away.

A PDF that merely looks correct is insufficient.

---

## 8. Reliability contract

Reliability uses a shared internal state machine, but the user sees only evidence-backed recovery actions.

### 8.1 Evidence → action table

| Observed state | Minimum evidence | Automatic action | Prohibited action |
|---|---|---|---|
| normal long generation | committed user turn plus continuing structural progress, active tool/status transition, or assistant mutation | none | timeout-based duplicate send |
| no structural progress for about 60 seconds | committed/unknown send state plus no assistant/tool/status progress during the window | preserve recovery snapshot; begin one bounded recovery cycle; if safe, one reload/refresh may be used to re-establish page truth | immediate duplicate user message |
| reload shows original user turn was never committed | matching send snapshot, no consequential tool/file/connector/auth state, no later user edit | resend the original turn at most once with per-turn dedupe | more than one resend |
| reload shows user turn is committed but generation is stalled/disconnected | exact committed turn identity; no consequential state | recover the existing turn/generation through the safest supported same-turn path; if no proven same-turn recovery exists, show one explicit recovery action | create a second user turn automatically |
| delayed commit arrives after suspicion | matching committed turn appears | cancel pending resend/recovery | send another copy |
| stale draft remains after confirmed commit | exact commit + composer still matches pre-send snapshot + no later user edit | clear/reconcile stale draft once | clear uncertain or newly edited text |
| stale/wrong-turn response suspected | new user turn confirmed plus assistant identity/fingerprint evidence | mark/offer bounded confirmation or same-turn regenerate when safe | semantic-guess auto-regenerate |
| tool/file/connector/auth/consequential flow active | exact consequential-state evidence | observe or notify only | automatic resend/regenerate |
| unknown structure/state | insufficient evidence | fail open | guessed recovery |

“60 seconds” means **no structural progress**, not merely “no newly visible prose”. The threshold initiates recovery; it does not prove that the prompt was uncommitted.

### 8.2 Recovery invariants

- confirm a new user turn before treating send as committed;
- preserve drafts when commit is uncertain;
- never duplicate a consequential send;
- protect any user input entered after the original send snapshot;
- automatic reload/retry/resend has an explicit per-turn maximum and dedupe key;
- a recovery cycle has a kill switch;
- diagnostics/reliability logic must not add broad DOM scans, serialization, hashing, layout reads or timer churn to the ordinary typing/IME synchronous path;
- unknown conditions fail-open.

The visible UI gives one clear next action and does not expose the internal state machine.

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

Inspects what the user actually consumes and records the evidence class actually reached.

Evidence classes include:

```text
SYNTHETIC_FIXTURE
LOCAL_REAL_BROWSER
CURRENT_CHATGPT_READ_ONLY
CURRENT_CHATGPT_BOUNDED_ACTION
TARGET_LOW_MEMORY_DEVICE
ACTUAL_PDF_VIEWER
REAL_NOTION_TARGET
```

Each acceptance requirement declares its minimum evidence class.

Minimum release-authoritative evidence:

| Requirement | Minimum evidence |
|---|---|
| popup/product-shell visual + interaction | `LOCAL_REAL_BROWSER` using the actual built extension popup, not a static HTML mock |
| answer-action placement / current ChatGPT selector contract | `CURRENT_CHATGPT_READ_ONLY` or an exact current real-derived contract consumed by the independent reviewer |
| composer/send/recovery behavior that depends on real lifecycle | `CURRENT_CHATGPT_BOUNDED_ACTION` when the behavior cannot be faithfully proven locally |
| Low Memory benefit | `TARGET_LOW_MEMORY_DEVICE` or an explicitly frozen target-class environment with process/runtime measurements |
| PDF math selection | `ACTUAL_PDF_VIEWER` plus independent PDF.js/text-layer evidence |
| Notion release claim | `REAL_NOTION_TARGET` |
| deterministic serializer/state-machine behavior | synthetic/unit evidence is sufficient only for the deterministic subclaim, not for the actual-surface claim |

The Reviewer records which exact artifact/window/contract was consumed. A screenshot generated by the Producer without bound candidate identity cannot satisfy an actual-surface gate.

The Reviewer inspects, as applicable:

- real extension popup;
- actual injected UI against current ChatGPT contract;
- light/dark and relevant width/scale;
- actual low-memory behavior;
- actual PDF in a viewer;
- recovery states;
- real Notion paste only when Notion is in release scope.

If a mandatory requirement cannot be reached at its minimum evidence class, the result is:

```text
NOT_INDEPENDENTLY_VERIFIED
```

not PASS and not automatically a product defect.

The user may perform a one-time login/OS/physical action when genuinely HUMAN_ONLY, but the subsequent routine verification remains the agent/reviewer responsibility whenever the platform supports it.

The Reviewer judges visuals and interaction semantics, not Producer prose or screenshots that are not bound to the exact candidate.

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

The exact command names may vary, but there is only one production validator path.

### 10.1 Freeze model

Before feature migration, freeze:

- acceptance schema;
- candidate identity schema;
- evidence schema;
- production validator entrypoint;
- minimum evidence class for each hard gate;
- the known-good/known-bad control corpus.

Validator implementation may be repaired during development if the harness itself is proven wrong, but before an authoritative release candidate is frozen record:

```text
VALIDATOR_VERSION
VALIDATOR_TREE_HASH
FIXTURE_SET_HASH
EVIDENCE_SCHEMA_VERSION
```

After candidate freeze, changing the candidate, validator, threshold, contract, relevant fixture/control or evidence schema invalidates the affected prior PASS.

### 10.2 Production-path controls

Required:

```text
KNOWN_BAD_CONTROL = REJECTED
KNOWN_GOOD_CONTROL = ACCEPTED
```

Known-good and known-bad controls must enter the same production validation functions as the real candidate. The validator must not branch on fixture names, expected labels or a dedicated `rejects()` switch.

Controls include at least:

- historical Mica Copy action misplacement;
- connector/composer residual/remount failure;
- stale/fake-waiting send lifecycle;
- low-memory no-op/ineffective candidate;
- lost highlight after remount;
- non-selectable inline-math PDF;
- stale ChatGPT contract accepted as current.

### 10.3 Validator self-integrity controls

The harness must also reject invalid evidence and false closure:

- missing evidence payload;
- tampered artifact hash;
- wrong candidate/dist hash;
- stale prior-candidate report;
- duplicate screenshot/crop used for distinct required surfaces;
- wrong page/turn/surface target;
- hard-coded PASS field with no underlying measurement;
- evidence root that does not match the manifest;
- a low-memory report with no measured additional effect;
- PDF text extraction that passes while real pointer-selection evidence is absent;
- ChatGPT contract evidence from an older incompatible surface presented as current.

Every PASS is derived from executed evidence, never from a Producer-authored boolean.

The harness must prove that a valid control can pass; an always-rejecting validator is itself a failure.

### 10.4 Coverage

The harness covers:

- candidate identity;
- current ChatGPT adapter compatibility;
- popup/render states;
- low-memory;
- Copy serialization;
- highlighter anchors/remount when in scope;
- PDF visual/text/math/highlight behavior when in scope;
- Notion real-target behavior when in scope;
- reliability state transitions;
- privacy;
- packaging/version consistency.

---

## 11. Release model

A release candidate is immutable after freeze.

A source/artifact change invalidates the corresponding prior validation/review.

Release readiness is not derived from one executor-written status field.

### 11.1 Foundation + two continuous product milestones

The rebuild has one internal Foundation Gate followed by two independently useful product milestones.

### 11.2 Internal Foundation Gate

Before feature work, Mica must first establish the rebuild foundation:

- current ChatGPT capability evidence;
- frozen product/UI direction;
- normal popup / Troubleshooting / Developer QA separation;
- single ChatGPTAdapter authority;
- compatibility verify/refresh/diff path;
- versioned AnswerDocument core sufficient for highlighting/PDF mapping;
- self-validating acceptance harness;
- legacy-path disposition and no parallel old product shell.

Foundation is an internal gate, not a fake feature release.

```text
FOUNDATION_GATE = PASS
```

No substantial Low Memory, Highlighter, PDF, advanced Reliability or Notion implementation begins before this gate.

### 11.3 Milestone A — Low Memory

Builds on the accepted Foundation.

Required product:

- falsifiable Low Memory feasibility;
- real additional resource/performance benefit over native ChatGPT baseline on the target workload;
- safe recent-history windowing/truncation behavior;
- full-history restore;
- disable/uninstall -> native behavior;
- no material regression in typing/scroll/send/stream/edit/branch/tool/file/connector/auth paths.

Milestone A may release once its own hard gates pass.

### 11.4 Milestone B — Highlight + PDF

Builds only on the accepted Foundation and Milestone A architecture.

Required product:

- built-in ChatGPT-scoped Highlighter;
- highlight persistence/remount reconciliation;
- ambiguity fail-open;
- local PDF export;
- highlight preservation;
- selectable/searchable/copyable math including the baseline prose → inline math → prose pointer-selection regression;
- actual PDF viewer acceptance.

### 11.5 Deferred capabilities

The following are **not current release gates**:

- advanced Reliability recovery, including the ~60-second no-progress path;
- Notion;
- broader Markdown/LaTeX export enhancements beyond what the Highlighter/PDF architecture requires;
- arbitrary non-ChatGPT webpage highlighting.

They may be pursued only after Milestone B, unless a narrow dependency is technically required by P0–P3.

The overall prioritized rebuild Goal is complete after Foundation, Milestone A and Milestone B pass. Deferred capabilities remain explicit follow-up scope and must not be falsely reported complete.

### 11.6 Candidate sequence

Each milestone uses:

```text
current surface evidence
-> product/visual contract freeze
-> acceptance schema/control freeze
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

Do not merge merely to make a candidate reviewable; push the immutable review branch first.

---

## 12. Legacy cleanup and single-authority migration

The rebuild must not leave two product shells or parallel validation systems enabled.

Every legacy class receives one disposition:

```text
KEEP_AND_MIGRATE
KEEP_AS_HISTORICAL_EVIDENCE
ARCHIVE
REMOVE
SUPERSEDE
```

Minimum migration table:

| Legacy class | Required disposition |
|---|---|
| broad Surface Atlas runtime/UI entry | REMOVE from normal runtime; historical capture data may be KEEP_AS_HISTORICAL_EVIDENCE |
| Atlas scripts/contracts that uniquely preserve old failure evidence | KEEP_AS_HISTORICAL_EVIDENCE or ARCHIVE; not current compatibility authority |
| old popup diagnostics grid | REMOVE/SUPERSEDE |
| persistent status dot/overlay | REMOVE unless a later frozen design proves a real user job |
| old recovery modules | KEEP_AND_MIGRATE only if folded into one Reliability state contract; otherwise REMOVE |
| feature-owned ChatGPT selectors | REMOVE after adapter migration |
| synthetic fixtures that reproduce real failures | KEEP_AND_MIGRATE into the canonical acceptance harness |
| fixtures that only self-certify obsolete architecture | ARCHIVE or REMOVE |
| old Goals | SUPERSEDE, historical only |
| old release packages | KEEP_AS_HISTORICAL_EVIDENCE, never current candidate |
| old PRs/branches | close/archive only after source-of-truth audit and preservation of unique work |
| stale README/ROADMAP claims | SUPERSEDE by current product truth |

The final acceptance harness checks that removed legacy entrypoints are not simultaneously active in the runtime/build.

Task-local historical rules that contradict the 2026-10-12 frozen Goal are superseded only where the final Goal explicitly says so. Privacy, destructive-action, credential, external-mutation and platform safety boundaries remain durable.

---

## 13. Definition of Foundation completion

Foundation is complete only when:

```text
CURRENT_CHATGPT_EVIDENCE = PASS
UI_DESIGN_FREEZE = PASS
NORMAL_POPUP_IS_PRODUCT_UI = PASS
TROUBLESHOOTING_IS_BOUNDED = PASS
DEVELOPER_QA_SEPARATE = PASS
CHATGPT_ADAPTER_SINGLE_AUTHORITY = PASS
CHATGPT_UI_REFRESH = PASS
MULTI_VARIANT_COMPATIBILITY = PASS
UNKNOWN_FAIL_OPEN = PASS
ANSWER_DOCUMENT_CORE_MODEL = PASS
ACCEPTANCE_HARNESS_SELF_VALIDATES = PASS
KNOWN_BAD_CONTROL = REJECTED
KNOWN_GOOD_CONTROL = ACCEPTED
LEGACY_PARALLEL_RUNTIME = NONE
USER_IS_FIRST_QA = NO
```

---

## 14. Definition of Milestone A — Low Memory completion

Milestone A is complete only when:

```text
FOUNDATION_GATE = PASS
LOW_MEMORY_FEASIBILITY = PASS
LOW_MEMORY_TRUNCATION = PASS
LOW_MEMORY_RESTORE = PASS
LOW_MEMORY_DISABLE_NATIVE = PASS
LOW_MEMORY_CORE_FLOW_REGRESSION = PASS
TARGET_LOW_MEMORY_EVIDENCE = PASS
KNOWN_BAD_CONTROL = REJECTED
KNOWN_GOOD_CONTROL = ACCEPTED
ACTUAL_SURFACE_REVIEW = PASS
USER_IS_FIRST_QA = NO
```

---

## 15. Definition of Milestone B — Highlight + PDF completion

Milestone B is complete only when:

```text
HIGHLIGHTER = PASS
HIGHLIGHT_AMBIGUITY_FAIL_OPEN = PASS
HIGHLIGHT_REMOUNT_RESTORE = PASS
PDF_TEXT_SEARCH_SELECT = PASS
PROSE_INLINE_MATH_PROSE_POINTER_SELECTION = PASS
DISPLAY_MATH_SELECTABLE = PASS
MATH_COPY_RESULT = PASS
MATH_SEARCHABLE = PASS
WEB_HIGHLIGHT_CROSS_MATH_TO_PDF = PASS
ACTUAL_PDF_VIEWER_REVIEW = PASS
ACCEPTANCE_HARNESS_SELF_VALIDATES = PASS
KNOWN_BAD_CONTROL = REJECTED
KNOWN_GOOD_CONTROL = ACCEPTED
USER_IS_FIRST_QA = NO
```

Notion is not part of Milestone B completion and remains deferred unless a later explicit Goal promotes it.
