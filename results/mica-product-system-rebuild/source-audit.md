# Source and Checkpoint Audit

Date: 2026-10-12
Repository: `YuukiAS/Mica-for-ChatGPT`
Canonical checkout: `D:/Code/Mica-for-ChatGPT`

## Rebuild baseline

The user authorized one exact branch effect. The rebuild branch was created and
selected from the verified base without merging the historical implementation:

| Field | Value |
| --- | --- |
| Base | `origin/main@7059c0dc24b908b57bd0e1f475142ba4f4520621` |
| Working branch | `codex/mica-product-system-rebuild` |
| Initial tracking ref | `origin/main` |
| Frozen Goal blob | `776590c3912ad7b2527d3f4732c84029076ea1c3` |
| Product authority blob | `7ccae47ce5e24b73d083f941a48bccdf3a68e2a8` |
| R2 verdict blob | `201dcb4d60f837ecbe1223849eff56814c746bd5` |

The only worktree-carried files at branch creation were two task-owned,
read-only plugin replay inputs under
`results/mica-product-system-rebuild/skills-alignment/`. Existing ignored local
dependency and temporary directories were not staged, removed, or rewritten.

## Positive checkpoint preservation

The positive checkpoint exists:

```text
0f2d40e16b2dcd0af8f7d567981dce7bf7b656cc
fix: detect sensitive conversation metadata
```

It belongs to the preserved historical branch:

```text
origin/codex/mica-product-recovery-current-gpt-ui
```

Before switching to the rebuild branch, three modified historical generated
artifacts were identified, hashed, staged exactly, reviewed, and committed as:

```text
0065a7ba841f72244e6bc1dbce0b5ec2ada12d35
chore: preserve historical 0.4.0 artifacts
```

Their SHA-256 values at preservation time were:

| Artifact | SHA-256 |
| --- | --- |
| `output/pdf/mica-research-export-0.4.0.pdf` | `022B7500522362EF206E153179A537444B0007F4DD5E7088B08BFBBA402C872E` |
| `results/mica--product-recovery-current-gpt-ui/pdf-evidence/0.4.0-export-preview.png` | `84A2E1A49551D771E4B3A42B327702C25F89AFB98623B4D40874D12AF981907F` |
| `results/mica--product-recovery-current-gpt-ui/visual-evidence/0.4.0-popup-dark-360.png` | `834FD4705EEA7C4DA37963A6CC4FA5CC6D89D6202EA0EB1CCD5A51A2F5A1F391` |

The preservation branch was then published as the same-name remote branch.
No force update, merge, PR, tag, release, or `main` mutation occurred.

## Historical branch inventory

The preserved branch contains 11 commits not in the rebuild base and a
three-dot diff of 182 files, 8,448 insertions, and 16,467 deletions. Its
historical runtime reported version `0.4.1`, while the current rebuild begins
from the audited `main` source and must select its own next version only after
the source audit and runtime scope are settled.

The historical implementation includes:

- a first-generation low-memory windowing path;
- highlighter and research PDF prototypes;
- a simplified popup/options shell;
- current-UI diagnostics and fixtures;
- replacement of the large legacy Reliability modules with a turn-delivery
  guard;
- 0.3.0, 0.4.0, and 0.4.1 packages/evidence.

These artifacts are evidence and migration inputs, not release authority. Old
screenshots, old reviewer PASS results, and the old current-UI contract do not
prove the current ChatGPT surface or the new architecture.

## Disposition rule

`legacy-disposition.json` is the machine-readable inventory. The governing
choices are:

- preserve immutable history and evidence;
- reference useful behavior and test cases;
- reimplement only behind the new adapter, AnswerDocument, UI, and acceptance
  contracts;
- retire parallel old product/runtime paths;
- defer advanced Reliability and secondary exports until the frozen priority
  gates permit them.

```text
POSITIVE_CHECKPOINT_STATUS=PRESERVED_REMOTE
HISTORICAL_BRANCH_RELEASE_AUTHORITY=NO
LEGACY_INVENTORY=PASS
REBUILD_BASE=PASS
```
