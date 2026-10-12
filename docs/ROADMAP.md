# Mica Roadmap

Mica 当前按 2026-10-12 已冻结的产品系统推进。阶段顺序是硬约束：先建立可验证的基础，再交付低内存能力，最后完成高亮与 PDF。没有通过前一阶段的验收，不进入后一阶段。

## Foundation（内部关口）

Foundation 不作为功能版本发布。它负责建立后续功能共用的基础：当前 ChatGPT capability contract、唯一的 `ChatGPTAdapter`、版本化 `AnswerDocument`、实际扩展 popup、独立 Troubleshooting / Developer QA，以及能拒绝伪证据的验收器。

Foundation 已由同一独立 reviewer 复审通过：`FOUNDATION_GATE=PASS`。该结论只开放 Low Memory 阶段，不等于 `0.3.0` 发布通过。

## Milestone A — Low Memory

目标是在低内存机器上为超长 ChatGPT conversation 提供真正可测的客户端历史窗口化，同时保持服务器完整历史不变。

当前候选已经实现 React Router turbo-stream 与 conversation JSON 两条受控数据路径，保留最近 40 个可见 turns、必要依赖和近期分支，并提供完整历史恢复。隔离压力 workload 已显示额外 JS heap、retained content 和进程树 private-memory 收益；Milestone A 仍需完成候选冻结与同一独立 reviewer 复审，之后才可写入 `LOW_MEMORY_TRUNCATION=PASS`。

必须覆盖：

- 相对 Mica 关闭和 ChatGPT 原生行为的额外内存、渲染与交互收益；
- 最近内容窗口、向上加载历史和显式 `Load full history`；
- reload、关闭或卸载 Mica 后恢复原生完整历史；
- streaming、编辑、branch、composer、connector、tool、file、auth 和 IME 输入回归；
- 未知结构 fail-open；
- 短、中、超长 thread、低内存压力 fixture 和目标级重复测量。

ChatGPT 原生 virtualization 只是基线。`content-visibility`、DOM 数量下降、diagnostics 或 no-op 都不能代替 `LOW_MEMORY_TRUNCATION=PASS`。

历史问题和调查方法见 [`PHASE_1_LONG_THREAD_RECOVERY.md`](PHASE_1_LONG_THREAD_RECOVERY.md)。

## Milestone B — Highlighter + PDF

在已接受的 Foundation 和 Low Memory 架构上交付：

- ChatGPT 范围内的内置 Highlighter；
- 经 edit、branch、remount 和 Low Memory 历史恢复后仍可重建的高亮锚点；
- 保留高亮的 PDF 导出；
- 可选择、可搜索的行内和展示数学文本；
- 真实 PDF viewer 的视觉、文本层、选择和搜索验收。

## 延后范围

以下内容不属于当前 Foundation、Milestone A 或 Milestone B 的完成条件：

- 约 60 秒无进展后的高级 Reliability 自动恢复；
- Notion 真实目标集成；
- 任意非 ChatGPT 网页高亮；
- 其他次要复用功能。

这些能力只有在当前优先 Goal 收口后，或被证明是 P0–P3 的窄依赖时，才会重新排期。隐私、最小权限、typing hot path、浏览器测试边界、fail-open 和版本一致性规则始终有效。
