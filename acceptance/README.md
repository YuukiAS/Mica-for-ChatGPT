# Canonical acceptance harness

This directory defines the sole production acceptance path for the Mica product
rebuild. Controls and candidates enter the same measurement validators in
`scripts/acceptance/validator.mjs`; the control runner changes only input
bundles and expected outcomes.

## Commands

```text
npm run acceptance:preflight
npm run acceptance:focused -- --bundle <bundle-directory> --gate <gate-id>
npm run acceptance:candidate -- --bundle <bundle-directory>
```

`acceptance:preflight` must accept every declared known-good control and reject
every declared known-bad control. The focused and candidate commands require a
`candidate` bundle; a `control` bundle cannot be presented as release evidence.

## Frozen identities

Every bundle binds these identities:

- full candidate commit;
- candidate version, build label, dist artifact and dist SHA-256;
- validator version and validator-tree SHA-256;
- current ChatGPT contract artifact and SHA-256;
- fixture/control-set SHA-256;
- evidence-schema version and evidence-root SHA-256;
- report candidate/dist context.

Changing any bound source, artifact, contract, fixture, schema, threshold or
validator invalidates the affected prior result. The validator tree includes
the production validator, CLI, control runner, schemas and contracts.

## Profiles

- `foundation`: product shell, current adapter contract, AnswerDocument core,
  placement safety, core flows, send safety,
  privacy and packaging/version consistency.
- `milestone-a`: Foundation plus Low Memory.
- `milestone-b`: Milestone A plus Highlighter remount and actual-viewer PDF
  selection.
- `release-0.3.0`: the full Milestone B set. Low Memory cannot be omitted.
- `functional-convergence`: the full Milestone B set plus complete-conversation
  export, recovery-deduplication, recovery-action-safety and target-surface-backend gates. The export gate binds a versioned
  fixture to exact completeness proof, turn/role identity, settled-only
  documents, Markdown/PDF assembly, structured table-cell math, bounded MathML
  capture/model/rendering, explicit partial-highlight fallback, PDF inline
  semantics, safe-link filtering and rejection of forged or partial inputs.
  The recovery gate binds Service Worker restart persistence, one-shot action
  claims, tab isolation, TTL cleanup, fail-closed storage behavior and
  content-free deduplicated history. The action-safety gate binds exact and
  fresh evidence to the recovery, scope, subject and native-control identities;
  it also requires one-shot limits, configured backoff, tool-safety rejection
  and content-free claims. It proves the browser-independent authorization
  backend, not a live ChatGPT native-control adapter. The target-surface gate
  verifies reversible suggested-work hiding, exact fixture control identity,
  pre-action revalidation, remount handling, no competing observer and
  privacy-safe structural diagnostics. It explicitly requires both current-site
  contracts to remain marked absent until real evidence exists.

The profile-to-gate mapping is enforced by the validator, so shortening a
bundle's `requiredGates` cannot manufacture a PASS.

## Low Memory evidence

The release gate rejects native-only/no-op behavior. It requires repeated A/B/C
target-class measurements (`A` absent/disabled, `B` installed/off, `C`
installed/on), measured process/heap ranges, retained content, mounted turns,
mutations, typing and scroll latency, short/medium/long profiles, a recent-turn
budget, a low-memory pressure fixture, client-only truncation, full restoration
and the complete core-flow regression set.

The initial quantitative floor is deliberately falsifiable: C must improve
process memory by at least 10% or JS heap by at least 15% versus the better A/B
baseline, reduce retained content by at least 15%, and avoid more than 10%
mounted-turn or mutation regression. Typing and scrolling must remain within a
10% relative budget, with a 0.1 ms absolute noise allowance for sub-millisecond
headless measurements. Current ChatGPT native
virtualization may already keep mounted DOM low, so mounted-turn reduction is
not allowed to substitute for actual client-memory benefit. Feasibility work may
calibrate these values before the authoritative candidate freeze, but any such
change requires a validator version change and a fresh control run.

## Evidence boundary

Synthetic controls prove validator behavior only. They do not satisfy
candidate evidence classes for actual popup rendering, current ChatGPT
placement, target-device Low Memory benefit or actual PDF viewer selection.
Those gates require the minimum classes in `acceptance/contracts.json` and a
fresh independent read-only review after validator PASS.
