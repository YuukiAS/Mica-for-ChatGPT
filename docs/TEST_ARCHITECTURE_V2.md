# Mica Test Architecture V2

## Objective

Mica's test system should make one real ChatGPT bug reproducible locally before another user acceptance round is requested.

Target flow:

```text
real-site evidence -> reproducible contract/fixture -> affected tests -> CI/full regression as appropriate -> at most one user acceptance
```

This is a testing architecture change, not a product feature expansion. Runtime reliability behavior remains out of scope unless a tiny seam is required to make production timing observable or controllable in tests.

## Manual Acceptance Policy

For one bug or goal, Mica should request at most one final manual authenticated ChatGPT acceptance by default. If that acceptance fails, Codex should first use existing diagnostic evidence, improve capture, update the contract/fixture, reproduce locally, and run automated validation.

A second manual request is allowed only when the first failure exposes a previously unknown real-site behavior that is not derivable from the available evidence. The request must name the missing evidence.

## Real Edge Safe Probe

The Safe Probe is a narrow, separately authorized diagnostic boundary for the user's current authenticated Edge tab.

Allowed:

- read-only DOM/page inspection;
- Mica runtime state inspection;
- composer structure, role, stable `data-*`, aria structure, geometry, selected computed styles, connector pill structure, identity relationships, and performance counters;
- temporary composer text only when the composer is empty, with restore to the original empty state.

Forbidden:

- clicking Send, pressing Enter, form submit, mutating ChatGPT API calls, file upload, connector execution, OAuth/auth action, account settings mutation, editing/deleting real conversations, navigation to other real conversations, reload, or arbitrary browser automation.

The probe API must stay narrow: `inspectPage`, `inspectComposer`, `inspectMicaRuntime`, `captureComposerContract`, `measureTyping`, `setTemporaryComposerText`, and `restoreComposer`.

## Composer Contract Capture

Versioned sanitized contracts live under:

```text
tests/contracts/chatgpt-composer/YYYY-MM-DD.json
```

The current repository includes a synthetic seed contract at:

```text
tests/contracts/chatgpt-composer/2026-09-08.synthetic.json
```

Contracts must include structure and selected geometry/style evidence, but must not include prompt text, answer text, conversation text, auth/session data, request bodies, headers, connector payloads, raw DOM dumps, or personal dynamic identifiers.

Fixture generation starts from a contract:

```bash
node scripts/build-composer-fixture-from-contract.mjs --contract=tests/contracts/chatgpt-composer/2026-09-08.synthetic.json
```

The contract owns structural ground truth. Lifecycle behavior remains a deterministic fixture state machine rather than an attempt to clone the full ChatGPT React app.

## Virtual Clock

`tests/fixtures/virtual-clock.js` provides test-only deterministic time when a fixture is opened with:

```text
?clock=virtual
```

It patches `Date.now`, `setTimeout`, `setInterval`, and `requestAnimationFrame` inside the fixture page before Mica's runtime scripts load. Production code still uses normal browser globals.

The connector lifecycle fixture now reports `clock: "virtual"` and the E2E runner requires that case to use virtual time. The old real-time path remains available by omitting the query parameter.

## Fixture Split Strategy

The old `connector-mention-lifecycle.html` is treated as the release regression fixture. New work should move independent behavior into:

- fast state-machine tests for pure TTL, quiet-window, latch, and provenance rules;
- focused browser contract tests for DOM/API behavior;
- integration lifecycle smoke for cross-module behavior;
- full release regression for the complete legacy combination.

Do not split by copying boilerplate. Extract common fixture setup and drive it from contracts where possible.

## Test Tiers

FAST target: <= 10 seconds

Command:

```bash
npm run test:fast
```

Runs one build, static smoke validators, build validation, and typing hotpath.

AFFECTED target: <= 30 seconds for normal runtime changes

Command:

```bash
npm run test:affected
```

Uses `git diff <base>...HEAD` and a dependency map in `scripts/test-affected.mjs`.

INTEGRATION target: <= 60 seconds for candidates

Command:

```bash
npm run test:integration
```

Runs one build and a small cross-module browser suite.

FULL policy:

```bash
npm run test:e2e
```

Full E2E is for CI pull requests, main candidates, releases, and broad architecture changes. It is not the normal local edit loop.

STRESS policy:

```bash
npm run test:e2e:stress
```

Stress remains limited to race-condition work, flake investigation, substantial lifecycle/virtualization changes, release candidates, or explicit request.

## Candidate Identity

`scripts/test-candidate.mjs` builds once and then reuses the same `dist/mica-dev` artifact for all checks in that candidate tier. This removes repeated build work inside the same candidate run.

Future result caching may use exact commit SHA plus artifact hash. Do not reuse a focused result across source changes.

## CI Policy

`.github/workflows/mica-ci.yml` runs install, build-backed fast tests, affected tests, integration tests, and full E2E according to event type. Independent shards are separated so local iteration does not need to wait for the entire full regression on every bug.

Race-sensitive stress remains opt-in through release/manual workflow expansion.

## Iteration Report Fields

Final iteration reports should include:

```text
TEST_ARCHITECTURE_V2 =
MANUAL_ACCEPTANCE_POLICY =
REAL_EDGE_SAFE_PROBE =
REAL_EDGE_SEND_BLOCKED =
COMPOSER_CONTRACT_CAPTURE =
VIRTUAL_CLOCK =
MEGA_FIXTURE_SPLIT =
AFFECTED_TEST_SELECTOR =
CI =
PARALLEL_SHARDS =
TYPING_HOTPATH_SECONDS =
CONNECTOR_SUITE_BEFORE_SECONDS =
CONNECTOR_SUITE_AFTER_SECONDS =
AFFECTED_SUITE_SECONDS =
INTEGRATION_SECONDS =
FULL_E2E_LOCAL_POLICY =
FULL_E2E_CI_POLICY =
USER_MANUAL_ROUNDS_TARGET =
READY_FOR_ONE_PASS_REAL_EDGE_ACCEPTANCE =
```
