# Mica Roadmap

Mica 的路线按“先能用，再稳定，再扩功能”推进。任何阶段都不为了架构漂亮而拖延当前可用性。

## Phase 1 — Long-thread Recovery（P0）

目标：替代当前失效的 LightSession，让超长 ChatGPT thread 在日常机器上重新可用。

交付物：

- 可直接通过 Chromium `Load unpacked` 安装的扩展。
- 能识别当前 ChatGPT conversation DOM 与加载行为。
- 默认只保留最近一段消息处于完整高成本渲染状态；历史内容离屏后降低渲染/布局成本。
- 向上滚动时可以可靠恢复历史内容，不丢内容、不跳错位置。
- 不破坏流式生成、编辑、branch、工具调用、文件/Drive 授权等特殊内容。
- 状态指示明确区分：active / native pagination only / degraded / disabled。
- 先在真实长 thread 上完成手工回归，再考虑发布。

详细方案：[`PHASE_1_LONG_THREAD_RECOVERY.md`](PHASE_1_LONG_THREAD_RECOVERY.md)。

## Phase 2 — Copy & Export

目标：让“复制 ChatGPT 回答”得到稳定、干净、可复用的 Markdown，而不是依赖 ChatGPT 当前 UI 的偶然格式。

重点：

- 标题、列表、引用、表格、代码块稳定转换。
- LaTeX 保留为可配置格式，避免复制后公式结构损坏。
- 清理 UI 文案、脚注按钮等不属于正文的节点。
- 支持单条回答复制与整段 conversation 导出。
- 输出策略可配置，例如 GitHub Markdown / Notion-friendly / plain Markdown。

## Phase 3 — Reliability

目标：减少 ChatGPT 网页端可恢复错误造成的无意义人工操作。

重点：

- 识别明确可重试的请求失败、临时限流和前端卡死状态。
- 建立发送生命周期守护：区分“点击发送 / 页面显示正在思考”和“新的 user turn 已真正进入 conversation”，检测网络异常造成的 ghost send / fake thinking，并保留可恢复的输入草稿。
- 检测明显的 stale-turn / duplicate response：当前 user turn 已变化，但新 assistant turn 仍复用或高度重复上一轮回答时，以结构证据和高阈值文本指纹进行提示，不依赖语义猜测。
- 对安全的恢复动作提供自动或半自动重试；任何自动重发都必须先高置信确认未 commit，并有单次重试上限与去重锁，避免双发。
- 对疑似旧回答重放优先提供“刷新确认 / 重新生成本轮”等人工恢复路径；工具、附件、授权或外部动作存在时禁止自动 regenerate / retry。
- 对需要真实授权、付费、敏感操作或不可逆操作的确认框绝不自动越过。
- 所有自动行为有次数上限、退避和可见状态，避免形成请求风暴。
- diagnostics 只记录状态、时间、指纹等元数据，不保存 prompt / answer 原文。

详细设计与回归范围：[#4 Reliability: guard against ghost sends and stale/duplicate turn responses](https://github.com/YuukiAS/Mica-for-ChatGPT/issues/4)。

## Phase 4 — Interface

目标：只修复高频、明确影响使用效率的 UI 问题。

候选：

- 长 thread 内更可靠的定位与回到当前回答。
- 可选的紧凑模式与固定控制区。
- 更清楚的工具调用、附件和引用状态。
- 为 Mica 各模块提供统一设置入口。

## Phase 5 — Hardening & Release

目标：从“自己稳定使用”提升到“可以公开发布”。

重点：

- Chrome / Edge / macOS Chromium 回归。
- 页面结构变化检测与 fail-open。
- 权限最小化与隐私说明。
- 版本迁移、诊断信息、可恢复配置。
- 打包与商店发布流程。

## 暂不做

- 不重做完整聊天客户端。
- 不引入服务器端存储或账号系统。
- 不依赖私有 ChatGPT API 作为长期核心架构。
- 不为了兼容其他 AI 平台牺牲 ChatGPT 体验；当前项目明确围绕 ChatGPT。
