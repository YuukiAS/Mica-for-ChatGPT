# Mica 0.3.0 Low Memory candidate report

## Candidate identity

- Runtime commit: `57fa880cf004d7a3c5585f0cabe1b1f17ef269e3`
- Runtime version: `0.3.0`
- Build label: `low-memory-windowing.3`
- Candidate bundle: `results/mica-product-system-rebuild/low-memory-candidate/57fa880cf004d7a3c5585f0cabe1b1f17ef269e3`
- Dist tree hash: `7a7942eb59f2043ebe6578a0d7dd59cd3b5a58337b4b9d28f83a4121430b51fb`
- Validator: `1.3.0`
- Validator tree hash: `cef4679bbc8dc83dddb40c48cf4a75a4745e58ef236077c631b6c84f3216990d`
- Fixture set hash: `ee1d9ef37329e831fde223daaf91688ee244255e05aea6b69f30202e0176a788`

## Producer result

```text
FOUNDATION_GATE=PASS
LOW_MEMORY_FEASIBILITY=PASS
LOW_MEMORY_TRUNCATION=PASS
LOW_MEMORY_RESTORE=PASS
LOW_MEMORY_DISABLE_NATIVE=PASS
LOW_MEMORY_CORE_FLOW_REGRESSION=PASS
TARGET_LOW_MEMORY_EVIDENCE=PASS
KNOWN_BAD_CONTROL=REJECTED_33_OF_33
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

这些 PASS 是 Producer 对 exact runtime commit 和机械绑定证据的结论，不替代独立 reviewer，也不构成发布结论。上一冻结候选 `8a0b3acc` 被同一 reviewer 判为 `REVISE`；本候选补齐真实上滑证明、可信恢复动作边界和目标环境证据分类三项 P1 后重新冻结。

## 实际截断内容

Mica 在 ChatGPT 解码 conversation 之前处理两类客户端输入：

1. 当前 React Router turbo-stream 初始 hydration graph；
2. 同源、精确 GET 路径的 conversation JSON fallback。

超过 80 个可见 turns 时，Mica 保留当前 branch 上最近 40 个 user/assistant turns、结构根节点、窗口内部的 system/tool/model-context 依赖，以及窗口内的近期 branch descendants。更早且不可达的客户端 graph entries 会从交给 ChatGPT 的 payload 中压缩掉，后续 turbo-stream continuation index 按压缩后的 graph 重新映射。完整 graph 会先校验 exact id、单根、全可达、父子对称、无环，以及受支持的 role/content/lifecycle；未知、歧义、断连、循环或无效结构保持原 payload，不猜测也不截断。

实现不会从 React 管理的 DOM 中拆节点，不会修改服务器 conversation，不会上传内容，也没有把 `content-visibility` 或 ChatGPT 原生 virtualization 当成完成条件。

## 保留与恢复策略

- 最近内容预算：40 个可见 turns；短 thread（24）和中等 thread（72）不截断，长 thread（240）截断为最近 40 个 turns，加上结构与依赖节点。
- 首次安装与开关：MV3 service worker 根据 extension storage 串行注册 `document_start`、MAIN-world data-plane；站点脚本不能通过页面事件或 `localStorage` 开启、关闭或伪造它。storage 读取失败会取消注册并 fail-open。
- `Load full history`：只接受 extension UI 命令或 `event.isTrusted` 的真实指针/键盘动作。页面可写 status 只作为 untrusted telemetry；伪造 status 后调用合成 `.click()` 会产生 0 次 prepare 和 0 次 reload。真实上滑到页面顶部才显示历史控件；当前 tab 随后写入 extension `storage.session` 的 `preparing_full_history`，取消 data-plane 注册并安全 reload；有 draft、streaming 或 dialog 时拒绝 reload。
- service worker restart：pending 恢复状态保存在 `storage.session`；worker 中途重启后仍保持未注册，目标 tab 完成原生加载后才恢复后续导航所需的注册。
- `full_history_bypass`：reload 后当前 tab 显示完整原生历史，并提供 `Resume Low Memory`；下一次普通导航也会清除 bypass。
- 关闭 Low Memory：若当前已截断，则保留 `Restore full history` 动作，安全时执行原生 reload。关闭、移除 Mica 或刷新到未注册状态后，服务器上的完整历史仍可恢复。

## 目标压力证据

证据类别是显式冻结的 `TARGET_CLASS_ENVIRONMENT`，不是 `TARGET_LOW_MEMORY_DEVICE`：Microsoft Edge `155.0.0.0`，每个样本使用全新、隔离、未登录的 browser profile；MV3 扩展必须在 headed Edge 中加载，因此窗口移到屏幕外运行。renderer V8 old-space 限制为 256 MiB，physical RAM 记录为 `null`；workload 为从当前 React Router flat graph 与原生 virtualized-turn DOM 形状派生的 800 turns、100 MiB retained content。A/B/C 各重复 3 次，以下为汇总样本值。

| 指标 | A：Mica absent | B：installed/off | C：installed/on |
|---|---:|---:|---:|
| process private memory | 524.234 MiB | 559.625 MiB | 568.984 MiB |
| JS heap | 101.310 MiB | 101.634 MiB | 6.349 MiB |
| retained content | 100 MiB | 100 MiB | 5 MiB |
| mapping nodes | 801 | 801 | 41 |
| mounted turns | 12 | 12 | 12 |
| mutation count | 62 | 62 | 62 |
| typing p95 | 0.01 ms | 0.01 ms | 0.01 ms |
| scroll p95 | 0.10 ms | 0.10 ms | 0.01 ms |
| frame p95 | 16.8 ms | 16.8 ms | 17.4 ms |
| steady long tasks | 0 | 0 | 0 |
| layout / recalc | 1 / 1 | 1 / 1 | 2 / 3 |

相对 installed/off，installed/on 的 process private memory 增加 1.67%，不构成 process-memory 收益；JS heap 下降 93.75%，retained content 下降 95%，mapping nodes 下降 94.88%。A 比 B/C 少一个扩展进程，fresh browser process tree 也存在波动，因此不能用 OS aggregate 掩盖或替代 renderer 证据；关键结果是相同完整扩展 baseline 下 renderer heap、retained graph 和 mapping nodes 的实质下降。三组 mounted turns 都是 12，说明收益来自 Mica 对完整客户端 conversation graph 和重内容引用的额外窗口化，不是把当前 ChatGPT 已有 DOM virtualization 重命名为 Mica 功能。

这是一套本地受限、current-derived 的目标压力环境，不是物理低内存设备或登录态 800-turn 私有 conversation。Goal 的产品规范明确允许显式冻结的 target-class environment 满足 Low Memory benefit 最低证据；Producer 不把该结果误写成物理设备证据。最终登录态真实 conversation 仅在 Goal 最后集中 HUMAN_ONLY 验收时处理。

## 回归与防伪证据

- focused/Tier 1：最终 build、Foundation core、background 注册与 worker restart、active core flows、短/中/长 windowing、page stream/JSON interception、恢复、Popup rendering、build validation 全部 PASS；最后一组约 20 秒。
- final Tier 2 E2E：完整候选链运行 1 次，PASS，用时约 11.5 秒。
- stress：最终成功运行 8 轮、40 次真实 Chromium fixture，全部 PASS；各子运行累计 114.039 秒。此前一次运行在 Windows 覆盖 QA PNG 时出现瞬时 `UNKNOWN/open`，focused popup 随即 PASS，完整 stress 复跑无失败；没有把失败样本写成 PASS。
- pressure：A/B/C 各 3 个隔离 Edge 样本，完整 unpacked extension 在 B/C 中加载；C 证明动态注册为 MAIN / `document_start` / persistent，PASS。
- core flows：composer、send、streaming、edit、branch、connector、tool、file、auth、typing/IME 全部 PASS；普通 typing/composition 事件同步路径 document queries 为 0。
- continuation：压缩后 promise continuation index 正确重映射；同页面后续新的初始 stream 会清空旧映射，短 thread 不受前一条长 thread 污染。
- deterministic preflight：5/5 known-good 接受，33/33 known-bad 拒绝；新增 controls 会拒绝缺失、失败、轮数不足或每轮脚本重复的 stress 证据，也会拒绝页面合成点击越权和把 target-class environment 冒充物理设备。
- package command boundary：系统 PATH 没有 `npm`；最终 E2E 使用 bundled `pnpm` 执行 package script，其他检查直接运行同一组 Node entrypoints，没有跳过候选检查。

## 当前边界

- 当前 ChatGPT data-plane 证据来自只读、未登录的公开 shared conversation；没有自动化或复用用户正常 Edge 登录态。
- ChatGPT private route 与 turbo-stream 结构仍是不稳定边界；实现以严格全图验证、同源精确路径和 fail-open 保护，不能识别时保留原生 payload。
- 当前 dynamic registration 是扩展级别的：单个 tab 执行完整历史 reload 的短窗口内，其他新开的 ChatGPT tab 也会 fail-open 到原生历史；已加载 tab 的现有脚本不被移除。该取舍不影响服务器历史，优先保证恢复路径安全。
- 最终登录态、真实超长 conversation 与低性能设备体验仍属于 Goal 最后集中执行的 HUMAN_ONLY 验收；在 Highlighter、PDF、Milestone B reviewer 和该验收完成前，不发布 `0.3.0`。
