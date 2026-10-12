# Mica Foundation UI Freeze

Status: implementation freeze derived from `MICA_PRODUCT_SYSTEM_V1.md`

Date: 2026-10-12

Frontend Design route: S3 product redesign

Authority: this file does not replace the frozen Goal or product system

## 1. Product job and audience

Mica is a quiet local utility for people who work in long ChatGPT conversations
and need lower resource use plus reliable reuse of answers. It is opened
occasionally, scanned quickly, and expected to stay out of the page until an
action is relevant.

The first-screen job is:

> Tell me whether Mica can help this page, show what Low Memory is doing, and
> give me the next safe action without exposing diagnostics.

Normal product UI and developer evidence tooling are separate product surfaces.
The normal user never operates a Start/Stop/Copy/Reset diagnostic matrix.

## 2. Information architecture

### 2.1 Normal popup

Target CSS width: `368px`; accepted range: `320–400px`.

Order is frozen:

1. header: Mica mark/name, global enable switch;
2. current-page compatibility line;
3. Low Memory primary row;
4. Reuse answers row, only when at least one shipped reuse capability exists;
5. Page health, low emphasis while healthy;
6. Troubleshooting entry;
7. version and one Advanced disclosure entry.

The popup is one continuous surface with separators. It is not a dashboard of
large independent cards. It has no persistent page-status toggle, selector text,
fixture language, mounted counters, raw paths, Atlas wording, or diagnostic
buttons.

At the Foundation Gate, an unimplemented feature is either absent or explicitly
`Unavailable in this build`; it never displays `Ready`.

### 2.2 Troubleshooting

Troubleshooting is a separate user-facing view reached from the popup. Its
content order is:

1. back navigation and title;
2. compatibility summary;
3. Low Memory state;
4. latest recovery summary;
5. `Run self-check`;
6. `Export diagnostic bundle`;
7. `Load full history` only when applicable;
8. privacy note;
9. `Open Developer QA` only in an unpacked/dev build or explicit developer
   mode.

The view owns a single operation at a time and presents a postcondition. It does
not make the user start and stop an instrumentation session.

### 2.3 Developer QA

Developer QA is a separate dev-only view. It contains:

- build and candidate identity;
- adapter variant;
- one row per capability with `EXACT`, `COMPATIBLE`, or `UNKNOWN`;
- current contract/evidence identity;
- `Refresh compatibility`;
- focused feature checks;
- `Export sanitized evidence`.

`UNKNOWN` is a safe state and visibly means the affected integration is off.
Developer QA never appears in the normal popup by default.

### 2.4 Page integration

- no persistent status dot;
- at most one Mica entry in a proven native assistant action cluster;
- no entry when placement invariants are not proven;
- selection affordance exists only for a valid supported answer selection;
- recovery affordance is transient and event-driven;
- popup actions never guess a target answer from viewport, recency, or focus.

## 3. Visual direction

Direction: **mineral Swiss / quiet utility**.

The interface uses a disciplined neutral grid, platform typography, thin rules,
and one mineral-teal accent. The memorable move is a small layered Mica stratum
mark and a three-layer status rail; the rest of the product remains calm. There
are no decorative gradients, glass panels, large hero cards, glow, or invented
telemetry.

The current v0 icon remains an install/build asset until a separate icon pass is
accepted. It is not used as permission to introduce gradient-heavy component
styling.

### 3.1 Density and rhythm

- popup outer padding: `16px` at 340px and above, `12px` below 340px;
- primary vertical stack: `12px`;
- section padding: `14px 0`;
- row minimum height: `52px` normal, `44px` compact secondary;
- control hit target: at least `40×40px` where popup space permits;
- 1px separators use semantic border color;
- normal body copy: 13px / 1.45;
- status/value: 12px / 1.35;
- title: 16px / 1.25, weight 650.

### 3.2 Light and dark

Theme follows `prefers-color-scheme`; there is no theme toggle in Foundation.
Both themes use the same semantic roles and component states. Teal is for Mica
identity and selected/on state, not a generic success color.

## 4. Component families

Only these families are admitted for Foundation:

- brand header;
- native-looking switch;
- compatibility status line;
- capability row with title, value, optional one-line help, optional trailing
  action;
- text link row;
- disclosure row;
- inline status badge in Developer QA only;
- primary and secondary buttons in Troubleshooting/Developer QA;
- compact notice for error/limited states;
- capability table/list for Developer QA.

No carousel, tab bar, marketing card, toast stack, chart, or floating toolbar is
needed for the product shell.

## 5. State contract and product copy

Locale for the first implementation is `en`. Labels use ordinary product
language and protect the product meanings below.

### 5.1 Header and compatibility

| State | Primary line | Supporting line |
| --- | --- | --- |
| loading | `Checking this page…` | none |
| supported exact | `Ready on this page` | none |
| supported compatible | `Ready with limited support` | `Some actions stay off until compatibility is confirmed.` |
| unknown structure | `Using ChatGPT normally` | `Mica couldn’t safely recognize this page.` |
| unsupported page | `Open a ChatGPT conversation` | none |
| global disabled | `Mica is off` | `ChatGPT is unchanged.` |
| content script unavailable | `Couldn’t reach this page` | `Reload the page, then try again.` |

Protected meaning: unknown or unavailable never implies failure of native
ChatGPT, and never claims Mica is active.

### 5.2 Low Memory

Title: `Low memory`

| State | Value/action |
| --- | --- |
| auto idle | `Auto` |
| active | `{N} older messages paused` |
| full history | `Full history loaded` |
| unsupported/unknown | `Unavailable on this page` |
| feature not shipped | `Unavailable in this build` |
| restoring | `Loading full history…` |
| restore error | `Couldn’t load full history` + `Try again` |

Help text when space is available:

> Older messages are paused locally. Nothing is deleted from ChatGPT.

Primary reversible action when active: `Load full history`.

### 5.3 Reuse answers

Title: `Reuse answers`.

The value lists only shipped capabilities in the fixed order `Copy · Export ·
Highlights`. If none is shipped, the row is absent. If answer placement is not
proven, per-answer actions are unavailable; the popup does not offer a guessed
answer target.

### 5.4 Page health

Healthy value: `No issues`.

This row remains visually quiet. A recovery event may replace the value with a
specific problem and one specific safe action. Deferred Reliability features do
not produce placeholder controls.

### 5.5 Troubleshooting copy

- title: `Troubleshooting`
- action: `Run self-check`
- pending: `Checking Mica and this page…`
- success: `Self-check complete`
- limited: `Some checks need attention`
- failure: `Couldn’t complete the self-check. Try again.`
- action: `Export diagnostic bundle`
- privacy note: `Includes structural status and build identity, not conversation text.`
- dev-only link: `Open Developer QA`

### 5.6 Developer QA copy

- title: `Developer QA`
- environment badge: `Development build`
- action: `Refresh compatibility`
- action: `Run focused checks`
- action: `Export sanitized evidence`
- unknown help: `This capability stays off because its structure is not confirmed.`

Internal selectors, filesystem paths, and raw event payloads may be included in
the exported evidence but not used as visible navigation labels.

## 6. Focus, keyboard, and accessibility

- DOM order equals visual order;
- every switch has a persistent label and an accessible state;
- icon-only controls have an accessible name and tooltip;
- `Tab` reaches every interactive control once;
- `Enter`/`Space` activate controls according to native semantics;
- focus uses a 2px high-contrast outline with 2px offset;
- focus is moved to the view heading after popup-view navigation;
- Back returns focus to the originating link;
- status is not communicated by color alone;
- normal text and controls meet WCAG AA contrast;
- reduced motion removes nonessential transitions;
- error text is adjacent to the failed action and announced through a polite
  live region.

## 7. Responsive and scale contract

Required rendered checks:

- widths: 320, 340, 368, and 400 CSS px;
- browser/OS scale equivalents: 100%, 125%, 150%;
- light and dark themes;
- long localized/state strings;
- keyboard-only traversal;
- maximum normal popup height without clipping important footer actions.

At 320px the hierarchy stays single-column, row values may wrap below labels,
and trailing actions move to a second line. No horizontal scrolling is allowed.

## 8. Page-affordance freeze

### One-answer Mica menu

- 32px native-family icon button;
- accessible name and tooltip: `Mica actions`;
- inserted only beside a proven native answer action cluster;
- menu contains only currently available actions;
- closes on Escape, outside click, route change, turn remount, or invalidation;
- returns focus to the trigger on close;
- no insertion when `PLACEMENT_PROVEN=NO`.

### Selection affordance

- appears only after exact assistant-answer selection resolution;
- compact color actions plus remove when a Mica highlight already exists;
- never covers the current selection or composer;
- disappears when selection collapses, route changes, or anchor resolution
  becomes ambiguous;
- no global Selection/Range prototype patch.

### Recovery affordance

- absent while healthy;
- compact non-blocking notice near the related composer context;
- one evidence-backed action at most;
- never clicks or bypasses authorization/security UI;
- deferred Reliability does not reserve visible space.

## 9. Acceptance targets

The UI freeze is satisfied only when the actual built extension, not a static
mock, proves:

- normal popup hierarchy and all frozen states;
- separation of Troubleshooting and Developer QA;
- light/dark and required widths/scales;
- keyboard/focus behavior and accessible names;
- no false-ready unreleased capability;
- no internal diagnostic language in the normal popup;
- exact-candidate screenshots and interaction evidence;
- Producer P0/P1/P2 = 0 before independent review.

```text
UI_DESIGN_FREEZE=PASS
PRODUCT_UI_COPY_FREEZE=PASS
IMPLEMENTATION_STARTED=NO
```
