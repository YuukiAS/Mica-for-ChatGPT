# Canonical acceptance harness bootstrap

Date: 2026-10-12

## Outcome

The rebuild now has one production validator path with versioned bundle,
candidate and evidence schemas, evidence-class floors, immutable identity
bindings, milestone profiles and a positive/negative control corpus.

Preflight result:

```text
VALIDATOR_VERSION=1.0.0
VALIDATOR_TREE_HASH=12d271041b37bd0aafc06aa4d78939b3586b368f511a558cee275aa626d26f03
FIXTURE_SET_HASH=62c99bce534468db957c6d3599d9d8dfd6afa82d48f3ccd267150558fd7c6507
EVIDENCE_SCHEMA_VERSION=1
KNOWN_GOOD_CONTROL=ACCEPTED (5/5)
KNOWN_BAD_CONTROL=REJECTED (19/19)
```

The controls cover the required known-good popup, adapter, Low Memory and
selectable-math PDF shapes, plus missing/tampered evidence, wrong candidate or
dist, stale reports, duplicate popup images, wrong surface, hard-coded PASS,
root mismatch, historical Copy misplacement, connector/remount regression,
fake waiting, Low Memory no-op, lost highlight remount, non-selectable math,
stale ChatGPT contract, control/candidate confusion, serializer mismatch,
packaging/version drift and an omitted 0.3.0 release gate.

## Low Memory release gate

`release-0.3.0` includes `low-memory-benefit` unconditionally. The production
validator requires real client-history truncation/windowing, not native-only or
diagnostics behavior; repeated target-class A/B/C memory and latency evidence;
short/medium/long thread coverage; recent-turn retention; full history loading,
scroll restoration, reload, disable and close/uninstall restoration; no server
mutation; fail-open unknown structures; and composer/send/streaming/edit/branch/
connector/tool-file-auth/typing-IME regression coverage.

This is a validator and evidence-contract PASS, not a Low Memory feature PASS.
`LOW_MEMORY_TRUNCATION` remains unclaimed until implementation and target-class
candidate evidence pass the same gate.

## Impact audit and tests

Affected files: acceptance schemas/contracts/controls, the acceptance CLI and
validator, package scripts, and this result note. No extension runtime, popup,
manifest, build output or version source changed.

- JSON parse and `node --check`: PASS.
- Focused check `pnpm run acceptance:preflight`: PASS in 1.818 s.
- `npm test`: not run; this iteration changes only the isolated acceptance
  helper path and package command registration, not extension runtime.
- Full E2E: 0 runs; not indicated by the Tier 2 policy.
- Build / `test:build`: not run; no dist-dependent or runtime change.
- Stress: not run; no runtime lifecycle candidate exists yet.

The installed environment exposes the repository scripts through `pnpm.cmd`;
the committed package entries remain package-manager-neutral `npm run ...`
commands for the documented user workflow.
