# Production Skills Alignment

Date: 2026-10-12
Repository: `YuukiAS/Mica-for-ChatGPT`
Goal: `mica--product-system-rebuild`

## Release alignment

The installed AI Skills marketplace was aligned before any Mica runtime or UI
change.

| Item | Verified value |
| --- | --- |
| Marketplace | `yuukias-ai-skills` |
| Source | `https://github.com/YuukiAS/AI_Skills_Collection.git` |
| Release branch | `release` |
| Checkout HEAD | `06d135d8a6ee62cd41abb40fc5771fcef7f8db25` |
| Local `release` | `06d135d8a6ee62cd41abb40fc5771fcef7f8db25` |
| `origin/release` | `06d135d8a6ee62cd41abb40fc5771fcef7f8db25` |
| Release record | `5.4.4` |
| Bridge Kit disposition | `NO CHANGE` |
| Codex CLI | `0.158.0-alpha.2.1` |

The marketplace checkout is clean apart from the installer-owned untracked
`.codex-marketplace-install.json` marker. `codex plugin marketplace upgrade
yuukias-ai-skills --json` reported no upgraded roots and no errors.

## Installed production plugins

| Plugin | Installed version | Current-session entrypoint |
| --- | --- | --- |
| `ai-skills-core` | `0.5` | `C:/Users/humc2/.codex/plugins/cache/yuukias-ai-skills/ai-skills-core/0.5/skills/orchestrator/SKILL.md` |
| `workflow-core` | `0.5` | `C:/Users/humc2/.codex/plugins/cache/yuukias-ai-skills/workflow-core/0.5/skills/workflow/SKILL.md` |
| `web-development` | `0.4` | `C:/Users/humc2/.codex/plugins/cache/yuukias-ai-skills/web-development/0.4/skills/visual/SKILL.md` |

The current Codex session advertised and loaded the same versioned paths. The
Workflow verification matrix, Frontend Design source, Presentations production
workflow, and Research Authoring report/paper production workflow were read for
reusable acceptance discipline. Domain-specific slide and student-assessment
rules are not part of Mica.

## Fresh-runtime replay note

A bounded `ai-bridge plugin-replay` check was attempted after alignment. The
input prompts are retained under `skills-alignment/`. The wrapper reached the
installed plugin but could not complete because this Codex/Bridge combination
reported both:

- Windows `cp1252` decode failure; and
- `CHILD_CONTRACT_DRIFT` because the child did not report the required
  `approval: never` and `sandbox: workspace-write` contract.

No raw nested `codex exec` fallback was used. This supplemental replay failure
does not contradict the directly verified installed manifest versions or the
current session's loaded skill paths. Release 5.4.4 explicitly records no
Bridge Kit update, so the runtime contract mismatch is kept as an evidence
boundary rather than bypassed.

```text
SKILLS_ALIGNED=PASS
CURRENT_SESSION_PRODUCTION_SKILLS=PASS
PLUGIN_REPLAY_SUPPLEMENT=UNAVAILABLE_WITH_EVIDENCE
```
