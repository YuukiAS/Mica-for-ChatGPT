# Current ChatGPT Surface Bootstrap

Date: 2026-10-12  
Browser: Codex In-app Browser, isolated unauthenticated profile  
Browser build: unavailable through the supported read-only browser surface  
Evidence root: `results/mica-product-system-rebuild/current-chatgpt-surface/bootstrap-evidence.json`

## Scope and privacy boundary

This is the one bootstrap exception allowed by the frozen rebuild Goal before
Developer QA exists. It used an isolated browser surface and made only read-only
requests to:

- the logged-out ChatGPT home page; and
- a public shared ChatGPT conversation cited by a published technical paper.

No private profile, private conversation, prompt submission, attachment upload,
login, account mutation, or repeated real-request loop was used. The evidence
pack contains structure and counts only; it excludes message text, request
bodies, headers, tokens, and account data.

## Confirmed current behavior

The logged-out home page and public shared conversation expose two different
valid composer shapes:

```text
textarea#mobile-composer-prompt
div#prompt-textarea[role="textbox"][contenteditable="true"]
```

The public shared conversation exposed seven mounted turns. The stable observed
relationship was:

```text
main#main
-> section[data-testid^="conversation-turn-"]
-> descendant [data-message-author-role="user" | "assistant"]
```

Assistant nodes contained semantic paragraphs and code/pre descendants. Native
copy actions used `data-testid="copy-turn-action-button"`. One scroll container
owned the transcript and measured 720 px client height against 7,301 px scroll
height at the capture point.

These findings are current real-site evidence for turn discovery, observed
static block extraction, composer variants, and native action adjacency. They
are not evidence for a target long thread or authenticated lifecycle behavior.

## Confirmed versus unresolved

Confirmed:

- real current `section[data-testid^="conversation-turn-"]` turn containers;
- real current `data-message-author-role` ownership;
- semantic paragraph and code/pre descendants in assistant answers;
- native Copy action identity;
- both textarea and contenteditable composer variants;
- current transcript scroll ownership on the sampled public page.

Unresolved and therefore fail-open:

- streaming and generation settlement;
- edit, branch, remount, and alternate conversation variants;
- connector, tool, file, authorization, and signed-in account surfaces;
- math/KaTeX structure;
- current native long-thread virtualization;
- target low-memory-device benefit.

The unresolved rows must be closed later by local production-path fixtures,
Developer QA, target-class measurements, and the single final authenticated
manual acceptance boundary. They may not be filled with the September Surface
Atlas or the October 5 recovery branch's old PASS.

## Why the previous assumption is insufficient

The historical implementation already recognizes some of the same selector
families, but it combines surface discovery, optimization, diagnostics,
Reliability behavior, and visible overlay concerns inside a large content
runtime. Selector overlap does not validate that architecture and does not make
old screenshots current.

The fresh observation also proves that composer identity is variant-specific:
the logged-out page used a textarea while the shared-conversation page used a
contenteditable textbox. A single exact element assumption would therefore be
unsafe. The new adapter must bind capabilities to invariants, support both
observed variants, and fail open for unknown structures.

## Chosen implementation path

1. Freeze capability-scoped contracts from the fresh evidence rather than a
   broad page snapshot.
2. Put all ChatGPT discovery behind `ChatGPTAdapter`.
3. Make the adapter emit a versioned `AnswerDocument` for supported static
   blocks and explicit opaque/unknown blocks elsewhere.
4. Build Developer QA to capture the unresolved authenticated variants without
   conversation content.
5. Treat native virtualization as a later measured Low Memory baseline, never
   as a reason to remove Mica truncation.

Rejected alternatives:

- treating old Surface Atlas or old recovery evidence as current;
- selecting hashed class names;
- assuming all composers are contenteditable or all are textareas;
- claiming native virtualization from a seven-turn public conversation;
- probing private endpoints or automating a logged-in account.

```text
CURRENT_CHATGPT_BOOTSTRAP_EVIDENCE=PASS
CURRENT_CHATGPT_AUTHENTICATED_LIFECYCLE=PENDING_DEVELOPER_QA
OLD_SURFACE_ATLAS_AS_CURRENT_EVIDENCE=NO
```
