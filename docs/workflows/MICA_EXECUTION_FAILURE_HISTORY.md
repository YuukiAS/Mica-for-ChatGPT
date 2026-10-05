# Mica 执行失败历史

## 结论

Mica 过去的主要问题不是缺少流程，而是源码、构建、真实页面证据和发布候选长期没有绑定到同一个版本。测试与诊断工具不断增加，但用户能直接使用的功能没有同步收敛。本文件把这些失败转成后续实现必须遵守的约束，避免再次用更多探针代替产品修复。

## 已确认的失败模式

1. `main`、开发分支、公开 Release 与浏览器实际加载版本长期不一致，导致“已修复”无法对应到用户正在运行的代码。
2. 多轮本地测试通过后，真实 ChatGPT 仍复现同一故障；本地绿色结果被错误地扩大为真实页面结论。
3. 旧 fixture 没有忠实覆盖 action cluster、property-backed composer value、editable/root remount 与 connector 生命周期。
4. Surface Atlas、探针和验收工具逐渐成为主要交付物，正常产品功能与界面反而停滞。
5. 页面按钮位置、popup 层级和整体视觉存在明显缺陷，却由用户或 GPT Work 先发现。
6. 用户被迫承担普通 UI reviewer、测试员和诊断操作员的工作。
7. 失败后反复拆分 Goal、增加流程，没有先修复根因与真实派生 fixture。
8. `0.2.4` 通过默认关闭主要能力形成安全基线；这能降低风险，但不能证明产品完成。
9. 正常 popup 混入 Atlas、诊断操作、内部计数和多组 Run/Copy/Stop/Reset 控件。
10. README、ROADMAP、版本文案与实际代码、构建和公开发布状态不一致。
11. 真实失败后继续要求用户重试，没有先形成 `old-bad -> same fixture -> new-good` 的本地证据链。
12. 旧截图、旧 PASS 与旧 release evidence 被跨候选复用，无法证明最终候选。

## 后续执行约束

- 用户不是普通 QA。安全且可自动完成的低级验收由 Codex 完成。
- Producer 必须先清除同一截图、同一状态和同一交互中可见的 P0/P1/P2。
- 独立审查负责整体审美、信息层级、自然融合和实现者盲点，不承担第一轮机械验证。
- evidence tooling 从属于产品；当缺口属于实现或产品语义时，不再扩展“验证器的验证器”。
- 同类失败连续两次且没有新增信息，停止盲目重跑，转为根因、fixture 与 validator 审计。
- 真实失败按 `旧代码在真实派生 fixture 上失败 -> 新代码在同一 fixture 上通过 -> 一次最终真实确认` 收口。
- 任何 source 变化都会使受影响表面的旧截图、旧 reviewer PASS 和旧 release evidence 失效。
- 正常产品 UI 不显示 Atlas、fixture、mock、debug、raw selector、内部路径或诊断协议文案。

## 证据边界

2026 年 9 月的 Atlas 与真实失败合同可用于理解历史故障和构造回归，但不能冒充 2026-10-05 当前 ChatGPT UI 证据。当前界面结论必须来自本 Goal 的当前合同与同一候选证据。
