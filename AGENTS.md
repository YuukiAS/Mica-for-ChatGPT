# AGENTS.md

## Project objective

Mica is a local browser extension that improves the ChatGPT web experience. The current P0 is **long-thread performance recovery**: replace the now-unreliable LightSession behavior with a working extension that can be manually installed immediately.

Read these first:

1. `README.md`
2. `docs/PHASE_1_LONG_THREAD_RECOVERY.md`
3. `docs/ROADMAP.md`
4. `docs/VERSIONING.md`

## P0 rules

- Do not expand scope into Markdown export, retry automation, or UI polish until long-thread performance is demonstrably fixed.
- Reproduce the current failure before copying or rewriting LightSession behavior.
- Treat ChatGPT private endpoints and DOM structure as unstable.
- Prefer fail-open behavior: if Mica cannot safely identify a structure, disable optimization instead of guessing.
- Do not hide, click, confirm, or bypass authorization/security UI.
- Preserve streaming answers, editing, branching, tools, attachments, and navigation.
- Prefer a small Manifest V3 + TypeScript implementation over a framework-heavy architecture.
- The first useful artifact should be a loadable unpacked Chromium extension, not a design-only scaffold.

## Versioning rules

Mica runtime versions must identify the actual code the user has loaded. Follow `docs/VERSIONING.md`.

- Do not keep changing runtime code while continuing to report the same version such as `0.1.0-alpha.3`.
- Any change pushed to `main` that changes the loadable extension's runtime behavior must bump the runtime version in the same iteration and rebuild `dist`.
- Pure documentation, task, roadmap, investigation, or unused development-helper changes do not require a runtime bump.
- Starting with the next runtime change after the historical alpha.3 builds, use plain three-part versions beginning at `0.1.4`; do not continue the `0.1.0-alpha.N` sequence.
- During the current `0.x` line, use PATCH bumps for ordinary fixes/small features and MINOR bumps for a clear new capability stage.
- `scripts/release-config.mjs` is the version source of truth. `MACHINE_VERSION` and the user-visible version must not drift from the actual build.
- `BUILD_LABEL` may remain as an internal descriptive diagnostic field, but it never substitutes for a unique formal version.
- After a bump, verify source, built manifest, popup, diagnostics, and reported unpacked path all agree on the new version.
- Do not create or rewrite GitHub Releases automatically unless the task explicitly asks for a release. A runtime version bump on `main` does not by itself require a Release.

## Investigation requirements

When diagnosing LightSession or current ChatGPT behavior, write the result into `docs/investigations/` with:

- date and browser build;
- exact observed request/DOM behavior;
- what was confirmed vs inferred;
- why the old assumption failed;
- chosen implementation path and rejected alternatives.

Do not leave the only evidence in console output.

## Testing requirements

Before calling P0 complete, test a real long conversation and cover the regression checklist in `docs/PHASE_1_LONG_THREAD_RECOVERY.md`. Record enough before/after evidence to show that the optimization is real. A powerful development desktop is not sufficient final evidence if the target symptom only appears on a lower-power machine.

### Browser-test boundary

Automated development and regression testing must not depend on the user's normal Microsoft Edge session or authenticated ChatGPT account.

- Codex should perform routine iteration with local/synthetic fixtures and, when useful, an isolated test Chromium instance that only opens local fixture pages.
- Synthetic browser tests should reproduce relevant ChatGPT lifecycle behavior such as composer mount/unmount, message submission, input clearing, streaming mutations, long-thread turn mount/unmount, overlay placement, and resizing.
- Do not attach to, automate, reload, copy, inspect, or reuse the user's normal Edge profile or its user-data directory.
- Do not create an automated authenticated ChatGPT browsing loop for regression testing. Do not repeatedly open conversations, submit prompts, refresh pages, or otherwise generate real ChatGPT traffic solely for automated Mica testing; this avoids unnecessary account/session risk and rate-limit or anti-abuse triggers.
- Do not require a separately automated logged-in ChatGPT profile as part of normal development acceptance. If a bug cannot be reproduced faithfully with existing fixtures, improve the synthetic fixture from manually observed evidence instead of repeatedly probing the live service.
- Before a real-site acceptance pass, leave the repository and unpacked build ready for manual testing and report exactly what the user should refresh or verify.
- The user performs the final authenticated ChatGPT acceptance manually by refreshing/reloading the local unpacked Mica extension in their existing Edge environment and exercising the relevant real conversation flow.
- Real-device checks remain necessary for behavior that depends on actual ChatGPT DOM/runtime behavior or lower-power hardware performance, but they are explicit manual acceptance steps rather than Codex-controlled browser automation.

## Implementation preference

Start with low-risk render containment / `content-visibility` optimization. Escalate to explicit DOM virtualization only if measurements show the safe path is insufficient. Add a network interception path only if the current ChatGPT loading protocol provides a well-understood, stable enough hook and keep it isolated behind a feature flag.

## Deliverables for each iteration

Each iteration should leave the repository in a runnable state and include:

- source changes;
- a short note on what was tested;
- any new known limitation;
- updated installation instructions if the loadable output path changed;
- for runtime-changing iterations, a unique bumped version and rebuilt `dist` matching that version.

Avoid unrelated refactors during P0.
