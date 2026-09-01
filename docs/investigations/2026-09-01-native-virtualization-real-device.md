# Current ChatGPT Native Virtualization — Real Device Observation

Date: 2026-09-01

## 结论

真实登录态 Edge 已确认：当前 ChatGPT 的超长 conversation 并不会把完整历史 turn 同时保留在 DOM 中。即使逻辑上的 thread 很长、能够持续向上滚动直到最顶部，Mica 实时只能观察到约 5–9 个 mounted turn；随着滚动，这个数字会在小范围内增加、减少和波动，而不是持续累积。

因此，Mica v0.1 最初的“长 thread 主要因为 DOM 中堆积大量历史 turn 而卡顿”的假设，在当前 ChatGPT 上至少不是主要解释。现有 `content-visibility` / containment 路径仍可作为安全 fallback，但不能再被当作 P0 的主要性能方案。

## 真实观察

测试环境：

- 已登录 ChatGPT 的 Microsoft Edge（Chromium）
- 一个实际包含大量历史消息、可持续向上滚动到 thread 顶部的 CUHK Date 开发 conversation
- 当前开发机内存 32 GB，因此明显卡顿不如 8 GB 目标设备容易复现

观察到：

- 初始 Mica 状态约为 `Native only · 5 mounted turns`（旧 UI 文案仍显示 active / turns）。
- 连续向上滚动后，mounted turn 数变为 6、7、8、9。
- 继续滚动时数字长期在约 6–9 之间波动，而不是随着历史内容加载持续增长。
- 历史内容仍然可以不断加载并最终到达 thread 顶部。

最合理的解释是：ChatGPT 当前已经使用窗口化/虚拟化列表，在滚动过程中不断 mount 邻近 turn，并 unmount 远离 viewport 的 turn。

## 对 Mica P0 的影响

1. 不要为了让状态从 `Native only` 变成 `Active` 而简单降低 `nativeOnlyTurnThreshold`。
2. `5 active / 5 turns` 一类状态文案具有误导性；这些数字只是当前 mounted DOM turns，而不是完整 conversation 的总 turn 数。
3. 现有 synthetic fixture 仍可用于验证 containment 和 fail-open 行为，但不能再作为真实 ChatGPT 长 thread 性能有效性的主要证据。
4. P0 下一步必须先诊断：在 ChatGPT 已经原生虚拟化之后，为什么超长 conversation 在 8 GB MacBook Neo 上仍会明显变卡。

## 下一步诊断重点

优先做轻量、完全本地的 runtime diagnostics：

- mounted turn 数及 mount / unmount 频率
- DOM node 总数及变化
- MutationObserver mutation rate
- Long Task 次数、总时长和最大时长
- requestAnimationFrame / scroll frame stall 指标
- Chromium 可用时的 `performance.memory` / JS heap 信息；不可用时 graceful fallback
- mounted turn 的 DOM complexity（只统计 descendant node count，不读取或导出聊天文本）
- 页面运行时长与诊断采样时长

最终性能验收设备必须是实际出现问题的 8 GB MacBook Neo。32 GB Windows 机器用于功能回归与 diagnostics 可用性验证，不用于替代最终 P0 性能结论。
