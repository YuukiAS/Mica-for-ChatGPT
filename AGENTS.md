# AGENTS.md

## Project objective

Mica is a local browser extension that improves the ChatGPT web experience. The current P0 is **long-thread performance recovery**: replace the now-unreliable LightSession behavior with a working extension that can be manually installed immediately.

Read these first:

1. `README.md`
2. `docs/PHASE_1_LONG_THREAD_RECOVERY.md`
3. `docs/ROADMAP.md`

## P0 rules

- Do not expand scope into Markdown export, retry automation, or UI polish until long-thread performance is demonstrably fixed.
- Reproduce the current failure before copying or rewriting LightSession behavior.
- Treat ChatGPT private endpoints and DOM structure as unstable.
- Prefer fail-open behavior: if Mica cannot safely identify a structure, disable optimization instead of guessing.
- Do not hide, click, confirm, or bypass authorization/security UI.
- Preserve streaming answers, editing, branching, tools, attachments, and navigation.
- Prefer a small Manifest V3 + TypeScript implementation over a framework-heavy architecture.
- The first useful artifact should be a loadable unpacked Chromium extension, not a design-only scaffold.

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

## Implementation preference

Start with low-risk render containment / `content-visibility` optimization. Escalate to explicit DOM virtualization only if measurements show the safe path is insufficient. Add a network interception path only if the current ChatGPT loading protocol provides a well-understood, stable enough hook and keep it isolated behind a feature flag.

## Deliverables for each iteration

Each iteration should leave the repository in a runnable state and include:

- source changes;
- a short note on what was tested;
- any new known limitation;
- updated installation instructions if the loadable output path changed.

Avoid unrelated refactors during P0.
