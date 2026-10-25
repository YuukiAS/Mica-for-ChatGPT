# Mica Roadmap

Mica 以 2026-10-12 的冻结产品系统为基础继续推进。当前 `0.5.16` 候选在 Foundation、Low Memory、Highlighter、PDF、Copy、Settings 和 Reliability 后端之上，加入真实安装扩展的统一自动回归：正式 Manifest V3、content scripts、Service Worker、storage、动态注册、popup、Options、键盘焦点、剪贴板和 PDF 页面都在隔离 Chromium 中运行。测试拒绝所有未匹配网络请求，不接触用户 Edge profile 或真实 ChatGPT。各项状态以 [`product/MICA_FUNCTIONAL_CONVERGENCE_V1.md`](product/MICA_FUNCTIONAL_CONVERGENCE_V1.md) 为准，测试分类见 [`testing/MICA_EXTENSION_TEST_COVERAGE.md`](testing/MICA_EXTENSION_TEST_COVERAGE.md)。

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

当前 `0.5.16` 候选已经加入：

- 版本化设置 schema 和统一 Options 页面；
- AnswerDocument 驱动的 Markdown、Notion rich clipboard 和 Notion import file；
- 表格单元格的结构化 inline 模型，使其中的公式、强调、行内代码、链接和引用能够进入 Markdown、Notion 与 PDF，而不是被压平成纯文本；
- PDF print model 的富文本语义和链接安全层：保留强调、删除线、行内代码、引用及允许的 `http(s)` / `mailto` 链接，拒绝危险 scheme；
- PDF 数学语义链：从页面已有 MathML 中提取有界安全 AST，经模型传递后用命名空间 DOM 重建；不受支持的树和无法精确映射的局部公式高亮显式回退到可见 TeX；
- 由 adapter 唯一 `EXACT` 目标驱动的单回答 `Mica actions` 菜单，以及在实站 placement 未证明时按可信右键回答归属工作的浏览器菜单 fallback；两条路径都在 streaming、歧义和 remount 时 fail-open；
- 以完整历史计数、角色顺序、conversation 身份和 settled turn 为硬门槛的整段 Markdown/PDF 导出；
- 真正消费 A4/Letter、PDF 高亮包含开关和默认导出动作顺序的导出路径；
- 高亮记录导入、导出、合并和清理；ChatGPT 与普通网页记录共用同一备注/标签预算，导入和变更 helper 都只重建允许字段；
- 默认颜色、经过约束的快捷键和选区/快捷键/组合三种高亮交互模式；
- 普通网页 exact-origin 可选权限、动态注册、语义锚点、四种颜色及本地备份；
- 约 60 秒无真实进展的状态机、最多两次恢复刷新、跨刷新草稿快照，以及由 Service Worker 管理的动作 claim 和隐私历史 ledger；
- 原生 Stop、assistant retry、确认未提交 resend 的精确证据授权、次数限制、settle/backoff 和 fail-closed 执行边界；
- 连接内容运行时的恢复控件适配器：只接收 `EXACT` 证据，提交一次授权，并在动作前重新核对 recovery subject 与 control identity；
- `Hide suggested work` 的可逆控制器：只处理唯一 `EXACT` 表面，设置关闭、结构歧义和 remount 时恢复原状态，不创建第二个 observer 或轮询；
- Developer QA 的有界目标结构报告，只输出结构 token、关系、语义类别和指纹，不输出建议或对话正文；
- 由 ChatGPTAdapter 统一提供 composer、assistant 进展、工具安全与 reload 安全观察，controller 不再直接查询页面结构；
- 对已提交、未提交、未知提交状态以及只读/有副作用工具的安全分流。

这些代码已经进入固定开发路径。当前构建已通过真实安装扩展 E2E、Low Memory 生命周期、六张视觉基准和实际 PDF 检查；登录态 ChatGPT、目标低内存设备、真实 Notion 原生公式与真实断流控件仍保持未验证。

## 仍未完成

- 普通网页权限提示、文章页绘制、编辑和跨刷新恢复的实际浏览器验收；
- 登录态 conversation 的 full-history reload、系统剪贴板和桌面 PDF 查看器最终确认；
- Notion 一次粘贴后的原生可编辑公式；
- 真实 ChatGPT 原生 Stop、assistant retry 和确认未提交 resend 的控件合同与实际执行验收；
- Composer / Connector 历史真实故障在当前页面结构上的精确收敛；
- Hide suggested work 的当前真实结构合同与页面验收；
- 单回答 `Mica actions` 在当前真实 ChatGPT 操作区中的精确 placement；已验证右键 fallback 在此之前提供安全入口；

`functional-convergence` 完整候选现已按冻结提交物化并通过全部 20 个 gate；每次最终提交后仍会重新绑定 SHA 再验证，避免沿用旧候选结论。

本轮只运行隔离 Playwright Chromium，没有打开用户日常浏览器或真实 ChatGPT。剩余真实目标验证集中到最后一次人工验收，不会被模拟宿主或旧截图冒充。今后普通补丁默认由类别 1–4 自动化闭环；只有登录态结构漂移、新的高风险交互、Low Memory 数据语义/资源边界或系统集成证据失效时，才重新考虑人工验收。
