# TODO: Hide ChatGPT Suggested Work / Suggested Prompts

Status: TODO / later implementation
Priority: UX pain point, independent from current composer P0 recovery work

## User-reported problem

ChatGPT may render personalized suggested work / suggested prompts directly below the composer. In the reported web UI these suggestions are visually prominent and are easy to click accidentally; clicking can immediately start an unwanted task/workflow.

The user reports that disabling ChatGPT's own `Settings -> Personalization -> Suggested prompts` does not reliably remove these suggestions from the page.

This is a separate UX pain point from:

- long-thread optimization
- stale clear recovery
- connector continuity
- send residual recovery

Do not couple this behavior to any of those features.

## Goal

Add an optional Mica feature that hides ChatGPT's suggested-work / suggested-prompt surfaces around the composer when the user does not want them.

The feature must be local-only and fail-open: if ChatGPT changes the markup and Mica can no longer identify the suggestions safely, Mica should simply stop hiding them rather than removing unrelated UI.

## Required independent toggle

Add a dedicated feature toggle, separate from the master `Enabled` switch:

`Hide suggested work`

Semantics:

- `Enabled=OFF` -> feature inactive, as with all normal Mica runtime features.
- `Hide suggested work=OFF` -> preserve ChatGPT native behavior exactly.
- `Hide suggested work=ON` -> hide only confidently identified suggested-work / suggested-prompt UI.
- Preserve the per-feature toggle value when the master switch is turned off and back on.
- Do not reuse `Long-thread optimization`, `Stale clear recovery`, `Connector continuity`, or `Send residual recovery` settings.

Do not add a UI toggle until the underlying implementation is real and tested.

## Detection constraints

Prefer stable structural or semantic signals where available, for example:

- dedicated `data-testid` / semantic attributes
- accessible labels / roles
- known suggestion-list structure directly associated with the composer
- bounded local relationship to the composer region

Avoid brittle matching based only on visible text such as specific suggestion titles.

Do not use permanent full-document polling.

If a lightweight observer is needed, scope it to the relevant composer/suggestion container and clean it up when the feature is disabled or the page lifecycle changes.

## Behavior

When enabled and a supported suggested-work surface is confidently detected:

- remove it from visual layout or hide it without leaving large blank space;
- prevent accidental interaction only by making the hidden element non-interactive as part of hiding it;
- do not trigger, cancel, or mutate any underlying ChatGPT task/workflow;
- do not intercept unrelated composer clicks or keyboard events;
- do not interfere with normal suggestions that are part of the actual composer/editor unless they are confidently the targeted suggested-work surface.

The implementation should work for both the empty/new-chat style screen and ordinary conversation pages if ChatGPT renders the same surface there.

## Safety / compatibility

- Fail open if the selector/structure is uncertain.
- Never delete user content.
- Never auto-click or auto-dismiss a suggested task.
- Do not patch React/private state.
- Do not break the composer, attachment menu, connector menu, model controls, voice controls, or native accessibility tree unnecessarily.
- If ChatGPT later makes its native setting reliable, this Mica feature should remain independently disable-able without affecting other Mica features.

## Diagnostics

This feature does not need verbose diagnostics in the popup.

A minimal internal status is sufficient for debugging, e.g.:

- `suggestedWorkHidingEnabled`
- `suggestedWorkSurfaceDetected`
- `suggestedWorkSurfaceHidden`
- `suggestedWorkDetectionSource`

Do not record suggestion text.

## Tests before real-site acceptance

Focused synthetic coverage should include:

1. Matching suggested-work surface present -> hidden when toggle ON.
2. Same surface -> untouched when toggle OFF.
3. Unrelated buttons/cards below composer -> preserved.
4. Surface removed/reinserted by native remount -> hidden again without permanent polling.
5. Toggle ON/OFF at runtime -> immediate hide/restore behavior without page reload where feasible.
6. Master `Enabled=OFF` -> feature inert.
7. Composer/connector/send recovery features remain unaffected.

Only after focused tests pass should a single real-site acceptance be requested.

## Versioning

Treat this as a separate feature increment when implemented. Do not fold it silently into unrelated connector/composer recovery changes.
