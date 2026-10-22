# Mica Roadmap

Mica 以 2026-10-12 的冻结产品系统为基础继续推进。Foundation、Low Memory、Highlighter 和 PDF 的既有成果仍是架构底座；`0.5.5` 功能收敛阶段新增统一设置、Markdown/Notion 数据路径、完整会话导出、高级 Reliability 后端、按站点授权的普通网页高亮，以及 ChatGPT/普通网页共用的高亮交互策略。各项状态以 [`product/MICA_FUNCTIONAL_CONVERGENCE_V1.md`](product/MICA_FUNCTIONAL_CONVERGENCE_V1.md) 为准，历史候选证据不自动等于当前构建已完成真实验收。

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

## 功能收敛阶段 — Copy / Settings / Reliability

当前 `0.5.5` 后端候选已经加入：

- 版本化设置 schema 和统一 Options 页面；
- AnswerDocument 驱动的 Markdown、Notion rich clipboard 和 Notion import file；
- 以完整历史计数、角色顺序、conversation 身份和 settled turn 为硬门槛的整段 Markdown/PDF 导出；
- 高亮记录导入、导出、合并和清理；
- 默认颜色、经过约束的快捷键和选区/快捷键/组合三种高亮交互模式；
- 普通网页 exact-origin 可选权限、动态注册、语义锚点、四种颜色及本地备份；
- 约 60 秒无真实进展的状态机、最多两次恢复刷新、跨刷新草稿快照，以及由 Service Worker 管理的动作 claim 和隐私历史 ledger；
- 原生 Stop、assistant retry、确认未提交 resend 的精确证据授权、次数限制、settle/backoff 和 fail-closed 执行边界；
- 由 ChatGPTAdapter 统一提供 composer、assistant 进展、工具安全与 reload 安全观察，controller 不再直接查询页面结构；
- 对已提交、未提交、未知提交状态以及只读/有副作用工具的安全分流。

这些代码已经进入固定开发路径，但浏览器集成仍需当前构建回归。真实 Notion 原生公式、PDF viewer、真实 ChatGPT 断流和设置页渲染在完成对应验收前保持未验证。

## 仍未完成

- 普通网页权限提示、文章页绘制、编辑和跨刷新恢复的实际浏览器验收；
- 完整 conversation 的 full-history reload、剪贴板和 PDF 产品路径浏览器验收；
- Notion 一次粘贴后的原生可编辑公式；
- 真实 ChatGPT 原生 Stop、assistant retry 和确认未提交 resend 的控件身份适配与执行；
- Composer / Connector 历史真实故障在当前页面结构上的精确收敛；
- Hide suggested work 的当前结构合同；
- `functional-convergence` 完整候选的浏览器证据物化与正式 candidate run。

本轮禁止启动浏览器，因此上述真实目标验证留作明确缺口，不会被本地模型或旧截图冒充。隐私、最小权限、typing hot path、浏览器测试边界、fail-open 和版本一致性规则始终有效。
