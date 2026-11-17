# Post-render safety replacement detection and recovery

Status: TODO  
Date: 2026-11-17  
Repository: `YuukiAS/Mica-for-ChatGPT`

## Problem

ChatGPT may complete an assistant turn, render ordinary answer content on the page, and only afterward replace that already-rendered assistant content with a safety/moderation placeholder.

This is a distinct lifecycle from:

- model refusal produced as the assistant answer;
- generation failure before an answer is committed;
- transport interruption;
- stale/duplicate answer replay;
- ordinary edit/branch/remount;
- low-memory virtualization.

Mica must not collapse these cases into one generic "refusal" or "generation failed" state.

Observed real-site symptom:

1. a normal assistant answer is visible;
2. the same assistant turn remains the logical turn;
3. its rendered answer body is later replaced by a ChatGPT safety placeholder;
4. the replacement may happen after the user has already seen the original answer.

## Product goal

Add a bounded Reliability capability that detects this post-render replacement as its own event and gives the user an explicit recovery/status path.

This capability is for lifecycle detection and recovery UX. It must not bypass ChatGPT safety UI, suppress the replacement, or restore/re-display content that ChatGPT has withdrawn.

## Required detection contract

The ChatGPT adapter should expose enough current-surface evidence to distinguish:

```text
NORMAL_GENERATION
NORMAL_SETTLED_ANSWER
MODEL_REFUSAL
POST_RENDER_SAFETY_REPLACEMENT
GENERATION_INTERRUPTED
UNKNOWN
```

A candidate `POST_RENDER_SAFETY_REPLACEMENT` event requires all of the following:

1. one exact assistant turn identity is resolved;
2. that turn previously exposed a non-placeholder answer body in the same page lifecycle;
3. the answer had reached a rendered/settled or otherwise user-visible state;
4. later, the same turn's visible body changes to a recognized current ChatGPT safety/moderation placeholder;
5. no branch/edit/navigation/remount evidence explains the change instead;
6. the placeholder recognition is based on current ChatGPT structural/semantic evidence, not broad text matching alone.

If the current page structure cannot prove these invariants, classify the event as `UNKNOWN` and preserve native ChatGPT behavior.

## Runtime behavior

When the event is confirmed:

- record a bounded local event containing only:
  - conversation-local turn identity;
  - timestamps;
  - lifecycle transition;
  - structural contract/variant identity;
  - whether the answer had previously reached visible/settled state;
  - placeholder class;
- do not persist prompt text or assistant answer text in diagnostics;
- do not cache withdrawn answer content for later display;
- do not block or race the native replacement;
- do not synthesize a replacement answer;
- do not automatically resend the user's message.

User-facing behavior may expose one compact Reliability notice such as:

```text
This answer was replaced after it had already been shown.
Mica detected a post-render safety replacement.
```

Available actions may include only actions that preserve native safety semantics, for example:

- retry/regenerate through the current native ChatGPT path when that action is available and safe;
- start a new branch from the user's message;
- copy a sanitized diagnostic summary;
- open troubleshooting details.

No action may reveal or reconstruct content that ChatGPT has withdrawn.

## Adapter requirements

Add a capability under the ChatGPT platform adapter rather than feature-specific DOM scraping.

Suggested boundary:

```text
generation.observeTurnLifecycle
generation.classifyVisibleOutcome
generation.detectPostRenderReplacement
```

The adapter owns recognition of:

- ordinary answer body;
- model-refusal answer;
- safety/moderation placeholder;
- turn remount;
- edit/branch replacement;
- generation interrupted state.

Reliability consumes only typed lifecycle events.

## Acceptance

Synthetic fixture must cover at least:

1. normal answer -> remains normal;
2. model refusal rendered from the start;
3. normal answer -> post-render safety placeholder;
4. streaming answer -> interrupted;
5. answer remount with same content;
6. edit/branch causing a new source version;
7. unknown placeholder-like text inside ordinary answer content.

The post-render case passes only if Mica reports the dedicated lifecycle event and does not misclassify it as model refusal or generation failure.

Real-site acceptance should use one manually observed occurrence or bounded current-surface evidence. Routine automation must not repeatedly provoke moderation/safety events in the user's authenticated account.

## Priority

This is a Reliability TODO and does not change the frozen current implementation order:

```text
P0 Foundation
P1 Low Memory
P2 Highlighter
P3 highlight-preserving PDF
DEFERRED Reliability
```

It should be preserved in the long-term Reliability backlog and implemented when that stage resumes, unless a later explicit product decision reprioritizes it.
