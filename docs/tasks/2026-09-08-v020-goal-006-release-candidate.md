# Goal 006 — 0.2.0 Candidate / Release Gate

## Goal

在 Goal 001–005 已经自动推进到极限，并取得那一次不可替代的用户手动 send/copy evidence 后，把 convergence branch 收敛成单一 `0.2.0` candidate。

本 goal **不在第一次持续开发 prompt 中提前执行真实发送**。如果 Goal 005 输出 `READY_FOR_ONE_MANUAL_SEND = YES`，应先停下等待用户本人完成那一次 send。用户返回 acceptance report 后再继续本 goal。

## Versioning

最终 runtime version：

`0.2.0`

推荐 build label：

`v020-convergence.rc1`

如果自动 gate 通过但用户真实 acceptance 暴露 substantive runtime bug：

- 留在 `0.2.0` convergence branch；
- 修复；
- build label -> `rc2`；
- 不为每个内部修复创建 `0.2.1 / 0.2.2`；
- 只有 `0.2.0` 已经进入 `main` 后出现新的 runtime patch 才进入 `0.2.1`。

## Required evidence

### Test architecture

- Test Architecture v2 已远端可复用；
- affected/integration runner 工作；
- workflow scope 若仍阻塞，要独立记录但不能掩盖 local gates。

### Performance

- ordinary typing hotpath PASS；
- connector-latched typing PASS；
- no permanent <100ms polling in idle typing path；
- long-thread mode有真实 counters/evidence；
- Mica does not make native-windowed ChatGPT heavier in a material way。

### Copy

- single-answer copy PASS；
- display math default `$$...$$`；
- code/table/list/math golden fixtures PASS；
- no duplicate KaTeX/MathML output。

### Interface

- no independent top-right composer diagnostics panel；
- single page overlay system；
- bottom-right compact status；
- popup redesigned；
- light/dark screenshots reviewed；
- advanced/internal toggles not cluttering default view。

### Reliability

- stale clear / send residual / connector continuity synthetic suite PASS；
- no new trusted user input deletion；
- no automatic resend/regenerate；
- one-shot real send report classified cleanly or known residual issue explicitly documented。

### Safety

Confirm from logs/report/code review：

- `AUTOMATED_SEND_PERFORMED = NO`
- `AUTOMATED_UPLOAD_PERFORMED = NO`
- `AUTOMATED_CONNECTOR_ACTION_PERFORMED = NO`
- `AUTOMATED_REGENERATE_PERFORMED = NO`
- `AUTH/ACCOUNT_ACTION_PERFORMED = NO`

Computer Use access does not change this requirement。

## One-shot real acceptance interpretation

### PASS

User manual send yields：

- new user turn commit；
- composer clears/stays correct；
- no stale payload；
- assistant identity advances/settles；
- Mica overlay remains correct；
- no visible typing/performance regression；
- Mica Copy from resulting answer produces expected Markdown/math structure。

Then proceed to candidate packaging。

### PARTIAL

If the only failure is connector-specific native ChatGPT behavior also observed with Mica OFF, do not automatically block all of 0.2.0；document it and ensure Mica does not worsen it。

### FAIL — Mica regression

If Mica ON uniquely causes composer disappearance/residual/jank/copy corruption：

- do not release；
- improve fixture/contract based on the single evidence bundle；
- fix autonomously；
- do not immediately request another user send unless the new fix truly changes a send-dependent state that cannot be simulated。

## Final tests

Use Test Architecture v2 policy：

1. exact affected suite；
2. integration；
3. one final full E2E for the release candidate；
4. stress only if lifecycle/race changes in final stabilization justify it；
5. build validation；
6. package validation。

Do not rerun 3-minute full E2E after docs/build-label-only edits。

## Canonical build

Ensure all match `0.2.0`：

- `scripts/release-config.mjs` source of truth；
- source build constants；
- `dist/mica-dev/manifest.json`；
- popup version；
- diagnostics version；
- package version；
- README current build section。

`dist/mica-dev` remains stable Load-unpacked path。

## Packaging

Generate：

- `mica-for-chatgpt-v0.2.0.zip`
- SHA-256

Until MacBook Neo low-memory P0 acceptance is genuinely satisfactory, GitHub Release should remain pre-release。

Do not call 1.0 stable merely because 0.2.0 is feature-complete。

## Issues / roadmap reconciliation

After acceptance：

- update #1 long-thread with measured status；
- update #4 reliability with implemented vs deferred pieces；
- update #5/#6 composer/connector evidence；
- close only issues whose acceptance is actually satisfied；
- update `docs/ROADMAP.md` to mark Copy v1 / Interface baseline / Reliability baseline appropriately；
- do not erase historical investigation notes。

## Final output

- `VERSION = 0.2.0`
- `BUILD_LABEL =`
- `LONG_THREAD_GATE = PASS/DEFERRED_WITH_REASON`
- `COPY_GATE = PASS/FAIL`
- `UI_GATE = PASS/FAIL`
- `RELIABILITY_GATE = PASS/FAIL`
- `ONE_SHOT_REAL_ACCEPTANCE = PASS/PARTIAL/FAIL`
- `TYPING_HOTPATH = PASS/FAIL`
- `AFFECTED = PASS/FAIL + seconds`
- `INTEGRATION = PASS/FAIL + seconds`
- `FULL_E2E = PASS/FAIL + seconds`
- `STRESS = PASS/NOT_INDICATED/FAIL`
- `PACKAGE = PASS/FAIL`
- `ZIP =`
- `SHA256 =`
- `AUTOMATED_SEND_PERFORMED = NO`
- `AUTOMATED_UPLOAD_PERFORMED = NO`
- `COMMIT =`
- `PUSHED = YES/NO`
- `RELEASE = URL / NOT_CREATED`
- `READY_FOR_DAILY_USE = YES/NO`

只有这些 gate 都诚实收敛后，才结束 0.2.0 program。