# Mica 0.3.0 Low Memory candidate report

## Candidate identity

- Runtime commit: `8a0b3acc8e02b4f72d74e2b51691119bdb6b1bef`
- Runtime version: `0.3.0`
- Build label: `low-memory-windowing.2`
- Candidate bundle: `results/mica-product-system-rebuild/low-memory-candidate/8a0b3acc8e02b4f72d74e2b51691119bdb6b1bef`
- Dist tree hash: `7c98e1df8369d73368d28c58d9a8a16dd6dad25116e71b5925f3bb4253213b01`
- Validator: `1.2.0`
- Validator tree hash: `e2e1d436721712a8bcbf624a0363678766511b6efba2d6de4ad1c46a14eff5f6`
- Fixture set hash: `583550f6d24dfc549d129542a8fef180368eb5e8f0eb4eb573194aa4fafc96ca`

## Producer result

```text
FOUNDATION_GATE=PASS
LOW_MEMORY_FEASIBILITY=PASS
LOW_MEMORY_TRUNCATION=PASS
LOW_MEMORY_RESTORE=PASS
LOW_MEMORY_DISABLE_NATIVE=PASS
LOW_MEMORY_CORE_FLOW_REGRESSION=PASS
TARGET_LOW_MEMORY_EVIDENCE=PASS
KNOWN_BAD_CONTROL=REJECTED_31_OF_31
KNOWN_GOOD_CONTROL=ACCEPTED_5_OF_5
DETERMINISTIC_VALIDATOR=PASS
PRODUCER_P0=0
PRODUCER_P1=0
PRODUCER_P2=0
CANDIDATE_IDENTITY=PASS
PACKAGE=PASS
ACTUAL_SURFACE_REVIEW=PENDING_INDEPENDENT_REVIEW
RELEASE_ARTIFACTS=PENDING_MILESTONE_B
RELEASE_0_3_0=BLOCKED_UNTIL_MILESTONE_B_AND_FINAL_HUMAN_ONLY_ACCEPTANCE
```

这些 PASS 是 Producer 对 exact runtime commit 和机械绑定证据的结论，不替代独立 reviewer，也不构成发布结论。上一候选 `d739c81` 已被同一 reviewer 判为 `REVISE`；本候选是六项 P1 修复后的新冻结点。

## 实际截断内容

Mica 在 ChatGPT 解码 conversation 之前处理两类客户端输入：

1. 当前 React Router turbo-stream 初始 hydration graph；
2. 同源、精确 GET 路径的 conversation JSON fallback。

超过 80 个可见 turns 时，Mica 保留当前 branch 上最近 40 个 user/assistant turns、结构根节点、窗口内部的 system/tool/model-context 依赖，以及窗口内的近期 branch descendants。更早且不可达的客户端 graph entries 会从交给 ChatGPT 的 payload 中压缩掉，后续 turbo-stream continuation index 按压缩后的 graph 重新映射。完整 graph 会先校验 exact id、单根、全可达、父子对称、无环，以及受支持的 role/content/lifecycle；未知、歧义、断连、循环或无效结构保持原 payload，不猜测也不截断。

实现不会从 React 管理的 DOM 中拆节点，不会修改服务器 conversation，不会上传内容，也没有把 `content-visibility` 或 ChatGPT 原生 virtualization 当成完成条件。

## 保留与恢复策略

- 最近内容预算：40 个可见 turns；短 thread（24）和中等 thread（72）不截断，长 thread（240）截断为最近 40 个 turns，加上结构与依赖节点。
- 首次安装与开关：MV3 service worker 根据 extension storage 串行注册 `document_start`、MAIN-world data-plane；站点脚本不能通过页面事件或 `localStorage` 开启、关闭或伪造它。storage 读取失败会取消注册并 fail-open。
- `Load full history`：当前 tab 先写入 extension `storage.session` 的 `preparing_full_history`，再取消 data-plane 注册并安全 reload；有 draft、streaming 或 dialog 时拒绝 reload。
- service worker restart：pending 恢复状态保存在 `storage.session`；worker 中途重启后仍保持未注册，目标 tab 完成原生加载后才恢复后续导航所需的注册。
- `full_history_bypass`：reload 后当前 tab 显示完整原生历史，并提供 `Resume Low Memory`；下一次普通导航也会清除 bypass。
- 关闭 Low Memory：若当前已截断，则保留 `Restore full history` 动作，安全时执行原生 reload。关闭、移除 Mica 或刷新到未注册状态后，服务器上的完整历史仍可恢复。

## 目标压力证据

环境：Microsoft Edge `155.0.0.0`，每个样本使用全新、隔离、未登录的 browser profile；MV3 扩展必须在 headed Edge 中加载，因此窗口移到屏幕外运行。renderer V8 old-space 限制为 256 MiB；workload 为从当前 React Router flat graph 与原生 virtualized-turn DOM 形状派生的 800 turns、100 MiB retained content。A/B/C 各重复 3 次，以下为中位数。

| 指标 | A：Mica absent | B：installed/off | C：installed/on |
|---|---:|---:|---:|
| process private memory | 529.562 MiB | 564.176 MiB | 558.664 MiB |
| JS heap | 101.310 MiB | 101.633 MiB | 6.348 MiB |
| retained content | 100 MiB | 100 MiB | 5 MiB |
| mapping nodes | 801 | 801 | 41 |
| mounted turns | 12 | 12 | 12 |
| mutation count | 62 | 62 | 62 |
| typing p95 | 0.01 ms | 0.01 ms | 0.01 ms |
| scroll p95 | 0.10 ms | 0.10 ms | 0.01 ms |
| frame p95 | 16.8 ms | 16.8 ms | 17.2 ms |
| steady long tasks | 0 | 0 | 0 |
| layout / recalc | 1 / 1 | 1 / 1 | 2 / 3 |

相对 installed/off，installed/on 的 process private memory 下降 0.98%，JS heap 下降 93.75%，retained content 下降 95%。A 比 B/C 少一个扩展进程，因此 OS process aggregate 不适合掩盖成大幅收益；关键证据是相同完整扩展 baseline 下 renderer heap、retained graph 和 mapping nodes 的实质下降。三组 mounted turns 都是 12，说明收益来自 Mica 对完整客户端 conversation graph 和重内容引用的额外窗口化，不是把当前 ChatGPT 已有 DOM virtualization 重命名为 Mica 功能。

这是一套本地受限、current-derived 的目标压力环境，不是物理低内存设备或登录态 800-turn 私有 conversation。后两者仍保留给 Goal 最后的集中 HUMAN_ONLY 验收，Producer 不把这项边界改写成已完成的真人硬件证据。

## 回归与防伪证据

- focused/Tier 1：最终 build、Foundation core、background 注册与 worker restart、active core flows、短/中/长 windowing、page stream/JSON interception、恢复、Popup rendering、build validation 全部 PASS；最后一组约 20 秒。
- final Tier 2 E2E：完整候选链运行 1 次，PASS，用时 17.1 秒。
- stress：最终成功运行 8 轮、40 次真实 Chromium fixture，全部 PASS，用时约 128 秒。此前一次运行在 Windows 覆盖 QA PNG 时出现瞬时 `UNKNOWN/open`，focused popup 随即 PASS，完整 stress 复跑无失败；没有把失败样本写成 PASS。
- pressure：A/B/C 各 3 个隔离 Edge 样本，完整 unpacked extension 在 B/C 中加载；C 证明动态注册为 MAIN / `document_start` / persistent，PASS。
- core flows：composer、send、streaming、edit、branch、connector、tool、file、auth、typing/IME 全部 PASS；普通 typing/composition 事件同步路径 document queries 为 0。
- continuation：压缩后 promise continuation index 正确重映射；同页面后续新的初始 stream 会清空旧映射，短 thread 不受前一条长 thread 污染。
- deterministic preflight：5/5 known-good 接受，31/31 known-bad 拒绝；新增 controls 会拒绝缺失、失败、轮数不足或每轮脚本重复的 stress 证据。
- package command boundary：系统 PATH 没有 `npm`；最终 E2E 使用 bundled `pnpm` 执行 package script，其他检查直接运行同一组 Node entrypoints，没有跳过候选检查。

## 当前边界

- 当前 ChatGPT data-plane 证据来自只读、未登录的公开 shared conversation；没有自动化或复用用户正常 Edge 登录态。
- ChatGPT private route 与 turbo-stream 结构仍是不稳定边界；实现以严格全图验证、同源精确路径和 fail-open 保护，不能识别时保留原生 payload。
- 当前 dynamic registration 是扩展级别的：单个 tab 执行完整历史 reload 的短窗口内，其他新开的 ChatGPT tab 也会 fail-open 到原生历史；已加载 tab 的现有脚本不被移除。该取舍不影响服务器历史，优先保证恢复路径安全。
- 最终登录态、真实超长 conversation 与低性能设备体验仍属于 Goal 最后集中执行的 HUMAN_ONLY 验收；在 Highlighter、PDF、Milestone B reviewer 和该验收完成前，不发布 `0.3.0`。
