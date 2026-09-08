# 2026-09-09 v0.2.0 Convergence Automation Evidence

## Environment

- Date: 2026-09-09
- Branch: `codex/v020-convergence`
- Candidate runtime: `0.2.0`
- Build label: `v020-convergence.rc1`
- Automated browser: Playwright Chromium `151.0.7922.34`
- Real ChatGPT session: not automated in this investigation

## Safety Boundary

This convergence pass did not automate the user's authenticated ChatGPT session and did not trigger real ChatGPT Send, Enter, Ctrl+Enter, uploads, connector execution, OAuth, or account actions.

The only send-like behavior exercised by automated tests was synthetic local fixture behavior under `tests/fixtures/`. The new final-send fixture explicitly guards against `submit`, send-button `click`, Enter, Ctrl+Enter, `requestSubmit`, and `form.submit`; all counters stayed at zero.

## Confirmed

- The imported Test Architecture v2 baseline remains usable after the convergence runtime changes.
- `dist/mica-dev` is the canonical unpacked development build path for this candidate.
- Runtime identity is `0.2.0` with `BUILD_LABEL = v020-convergence.rc1` across source, built manifest, popup, and diagnostics validation.
- The page-level composer diagnostics UI no longer creates the independent top-right panel. Recording state is represented in the existing bottom-right Mica overlay.
- Native-safe idle work is throttled instead of probing mounted turn status on every 1500 ms tick while the page is in native-safe mode.
- Markdown Copy v1 serializes heading, prose, bold/emphasis, escaped inline code, links, lists, quote, fenced code, Markdown table, inline math, and display math.
- Display math serializes with `$$ ... $$`; the fixture verifies that bracket display delimiters do not leak into the final Markdown.
- Markdown Copy does not add its own `MutationObserver`, polling interval, typing listeners, network interception, or submit path.
- The one-shot final send preparation can prefill an empty composer and start diagnostics without triggering any send path.
- The same one-shot preparation fails safe when the composer is missing or already contains text.

## Inferred

- A separate `Mica Copy` action is currently lower risk than intercepting ChatGPT's native Copy action because the authenticated real-site assistant action bar has not been revalidated in this automated pass.
- The native ChatGPT Copy path remains untouched; if Mica cannot place or sync its own action, ChatGPT's original actions should remain available.

## Rejected Alternatives

- Intercepting ChatGPT's native Copy button without fresh real-site action-bar evidence was rejected as selector-fragile.
- Running an automated authenticated ChatGPT send/copy loop was rejected because it violates the browser-test boundary and the user's explicit no-send/no-upload instruction.
- Reintroducing the separate composer-diagnostics page panel was rejected because the v0.2.0 goal is interface convergence into one bottom overlay plus popup controls.

## Automated Gates

- `node scripts/run-e2e.mjs --case=final-send-check`: passed.
- `npm run test:fast`: passed in 4.87 s.
- `npm run test:integration`: passed in 8.67 s.
- `npm run test:affected`: passed in 144.55 s.

`npm run test:e2e` and `npm run test:e2e:stress` were not run in this pass. Full E2E is still a candidate gate before packaging or merge; stress is reserved for race-condition or release-candidate evidence when indicated by test policy.

## Remaining Manual Evidence

The candidate is ready for the user's single manual authenticated ChatGPT acceptance step:

1. Reload the unpacked extension from `dist/mica-dev`.
2. Open the Mica popup.
3. Run `Prepare final send check`.
4. Verify the composer is prefilled and the popup/overlay shows diagnostics recording.
5. Manually send once only if the user chooses.
6. After the response completes, run Mica Copy on the generated assistant answer and copy the diagnostics report.

This manual step is still required to confirm current real-site ChatGPT composer/send behavior and current assistant answer action placement.
