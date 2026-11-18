# Notion equation source coloring and multi-site Mica scope

Status: TODO  
Date: 2026-11-18  
Repository: `YuukiAS/Mica-for-ChatGPT`

## Problem

Mica currently targets ChatGPT web, but the user's actual writing workflow crosses ChatGPT and Notion. A recurring friction point is block equations copied or authored in Notion: Notion's native equation block does not expose a global default equation color, and CSS-only customization is local to one browser/device.

The desired behavior must survive Notion sync across Mac, Windows, iPhone, iPad, and web. Therefore the durable change must be written into the equation block's stored LaTeX expression rather than applied only as local CSS.

The first concrete use case is:

```text
ordinary Notion block equation
-> Mica action / automation
-> rewrite stored equation expression with the chosen Notion-orange color
-> Notion syncs the modified source to every device
```

Initial candidate color from the current investigation is `#CC782F`. Before implementation, perform one visual acceptance against the current native Notion orange and then freeze the chosen source color. Because a literal LaTeX color cannot automatically follow Notion light/dark themes, theme behavior must be an explicit product decision rather than silently changing per device.

## Product direction

Treat this as the first Notion capability in a broader Mica multi-site model.

Mica should remain one extension/product surface but gain site adapters instead of accumulating ChatGPT-specific code in shared features:

```text
Mica
├── shared product shell / settings / actions
├── ChatGPT adapter
└── Notion adapter
```

Do not rename the repository or product as part of this TODO. The immediate goal is to prove the Notion boundary cleanly; broader naming/product changes can follow only if the Notion path becomes a real maintained capability.

A later cross-site workflow may make ChatGPT -> Notion copying more direct, but the first implementation must solve the stored-equation rewrite independently and safely.

## Phase 0 — feasibility probe

Before building UI, prove the following against the current official Notion API:

1. Mica can resolve the current Notion page to a stable page identifier without relying on fragile private Notion endpoints.
2. With an explicitly configured Notion connection, Mica can recursively enumerate the page's child blocks.
3. Equation blocks expose their stored `expression`.
4. An existing equation block can be updated in place through the official block update API.
5. A rewritten expression renders correctly in Notion and remains changed after reload and on another device.
6. The rewrite preserves multiline KaTeX/LaTeX content and does not require deleting/recreating the block.
7. The auth path is suitable for a browser extension:
   - prefer the official integration/OAuth model;
   - do not scrape or persist Notion's private session/auth tokens;
   - keep credentials scoped and locally protected.
8. Determine whether direct extension -> Notion API calls are practical under browser/CORS constraints or whether Mica needs a tiny companion/backend boundary.

The probe should produce a short investigation note under `docs/investigations/` with confirmed API behavior, auth constraints, and the smallest viable architecture.

## Rewrite contract

The formatter must be deterministic, idempotent, and reversible.

For a plain equation such as:

```latex
E = mc^2
```

the first candidate transformation is conceptually:

```latex
\color{#CC782F}{E = mc^2}
```

Exact wrapping syntax should be frozen only after the feasibility probe confirms correct KaTeX rendering for simple and multiline equations.

Required behavior:

- process block equations only in the first version;
- do not alter inline equations;
- skip an equation already wrapped by Mica with the same target color;
- do not add a second nested wrapper on repeated runs;
- preserve equations that already contain intentional user color commands unless an explicit future mode says otherwise;
- preserve the original expression sufficiently to support one-step restore;
- do not normalize, reformat, or otherwise rewrite unrelated LaTeX;
- fail per block: one malformed/unsupported expression must not abort the rest of the page.

Mica-owned wrappers should be recognizable by the formatter so that later color changes or restoration can remove/replace only Mica's own modification.

## First user-facing capability

After the feasibility probe passes, add a small Notion action rather than a large new UI.

Minimum useful flow:

```text
Open a Notion page
-> Mica: "Format block equations"
-> preview counts
-> apply
-> source is written back to Notion
-> changes sync normally to other devices
```

Preview should report only structural counts, for example:

```text
17 equation blocks found
14 will be updated
2 already match
1 skipped because it has explicit custom color
```

Also provide:

- restore Mica-formatted equations on the current page;
- configurable target color after the default is validated;
- clear success/failure counts;
- no need to open DevTools or manually edit every equation block.

## Future automation

Do not require automatic background rewriting for the first release.

After the manual current-page action is proven reliable, evaluate two optional improvements:

1. **Copy pipeline** — when the user copies suitable math content from ChatGPT for Notion, Mica can prepare or apply the Notion-compatible source transformation as part of the existing copy/export workflow.
2. **Automatic maintenance** — use official Notion webhooks or another bounded event path to reformat newly changed equation blocks without polling every page.

Automatic maintenance must not create an update loop where Mica's own write triggers another rewrite indefinitely.

## Security and data boundaries

- Use the official Notion API for durable writes.
- Never use Notion private browser session tokens as the product contract.
- Request only permissions needed to read/update explicitly authorized content.
- Do not send page prose, prompts, or unrelated block contents to external services merely to recolor equations.
- The formatter should operate locally when possible; any backend should be limited to auth/API mediation required by the official platform.
- A dry-run/preview must be available before the first bulk write to an existing page.

## Acceptance

The first implemented capability is complete when all of the following are true:

1. A page containing at least:
   - one simple block equation;
   - one multiline/aligned block equation;
   - one already-Mica-colored equation;
   - one equation with intentional custom color;
   can be processed safely.
2. Eligible equations receive the frozen target color in their stored Notion source.
3. Re-running the command produces no additional source changes.
4. Reloading Notion preserves the result.
5. Opening the same page on another device shows the same colored equations without Mica/CSS installed there.
6. Restore removes only Mica-owned coloring and recovers the original equation source.
7. Unsupported/custom-colored cases are reported as skipped rather than silently rewritten.
8. Existing ChatGPT capabilities and hot-path behavior remain unchanged.

## Priority

This is a future Product/Integration TODO. It does not change the current frozen Mica implementation order.

Recommended execution sequence when this work is activated:

```text
Notion official-API feasibility probe
-> source-rewrite formatter + idempotence/restore tests
-> current-page preview/apply action
-> cross-device acceptance
-> only then evaluate ChatGPT -> Notion copy integration
-> only then evaluate webhook/background automation
```

The purpose of keeping this in Mica is deliberate: the same product already owns the ChatGPT-side copy/export workflow, and the Notion adapter can become the receiving-side companion without forcing the user to maintain a separate one-off extension.
