# 2026-09-06 Real ChatGPT Composer Root-Cause Diagnostic

## 背景

Windows Codex Desktop 的 native Computer Use 已完成配置并通过真实 Calculator 验收：`sky.list_apps()` / `sky.list_windows()`、`launch_app(...)`、fresh state、geometry、screenshot、accessibility tree、结构化点击和键盘输入均可用。

Mica 当前需要解决一个真实 ChatGPT composer 故障：

- 用户发送消息后，已发送文本有时仍残留在 composer；
- 对残留内容执行全选删除时，composer 会短暂消失；
- composer 恢复后，文本可能仍然无法可靠清空；
- 该现象在真实长期使用中重复出现；
- 当前尚不能确定根因来自 Mica、ChatGPT 原生 composer / React lifecycle、connector/mention 流程、Edge profile / 其他扩展，还是多因素叠加。

本任务的目标是先建立真实设备 A/B 证据，不先修改 Mica 代码。

## 核心原则

必须把“复现”和“修复”分开。本轮只诊断。

Codex 可以使用 Windows native Computer Use 操作真实 Edge UI，并可以读取 Mica 内置的 Guided Composer Diagnostics 报告；但不能自动发送真实 ChatGPT 消息。任何真实 Send 都必须由用户手动完成。

不得创建新的真实 ChatGPT 测试对话，不得循环发送、Retry、Regenerate 或刷新制造请求。

## 目标 A — 复现现有残留状态

优先从用户当前已经出现 stale composer text 的真实页面开始，不要为了测试而重新发送。

需要记录：

- 当前 composer 是否可见；
- 当前文本长度，不记录正文；
- `Ctrl+A -> Delete` 后 composer 是否短暂消失；
- 消失后是否自动恢复；
- 恢复后文本长度是否为 0；
- 是否出现 editable/root identity replacement；
- Mica Guided Diagnostics 是否捕捉到 `composerDisappeared`、`maxMissingDurationMs`、identity changes。

## 目标 B — 三层 A/B

为了真正区分 Mica 与 ChatGPT 原生问题，按以下层次测试。

### B1. Mica Enabled

保持扩展正常启用，运行 `Run composer check`，执行普通删除与 `@GitHub` mention 删除。不要自动发送。

### B2. Mica runtime Disabled，但扩展仍加载

通过 Mica popup 将 `Enabled` 关闭，刷新当前 thread，再执行同样的普通删除与 `@GitHub` 删除。

这一层用于判断 Mica runtime 行为（containment / observers / listeners / status logic）是否是触发条件。

### B3. Mica extension 完全 Disabled

如果 B1/B2 仍不能定责，再通过 Edge 扩展管理页完全禁用 Mica，刷新当前 thread，并执行一次最小普通删除复现。

这一层最重要：如果扩展完全禁用后故障仍以相同方式出现，则不能把根因归到 Mica content scripts；应转向 ChatGPT 原生 composer、Edge profile 或其他扩展。

禁用/启用扩展只能通过正常 UI 完成，不直接修改 extension 文件或 profile 数据。

## 目标 C — `@GitHub` 是否是独立触发因素

普通文本删除与 `@GitHub` mention 删除必须分开记录。

如果普通文本正常，而 `@GitHub` 路径出现 editable/root replacement、composer disappearance 或 stale restoration，则优先怀疑 connector/mention lifecycle。

Mica 不自动输入/选择 connector；Codex 可以通过正常 UI 输入并选择 `@GitHub`，但不得 Send。

## 目标 D — Send 后残留

只有当前面的无发送 A/B 仍不足以定责时，才进入一次真实 Send 测试。

Codex 必须停下来要求用户手动发送一条很短的测试消息。用户点击 Send 后，Codex继续观察：

- 是否出现新的 user turn；
- composer 是否 unmount/remount；
- remount 后旧 draft 是否恢复；
- 最终 composer 是否清空；
- Mica report 是否出现 `newUserTurnObserved` / `staleTextAfterSend`。

默认最多做一次真实 Send。若需要 Mica ON/OFF 各一次，必须先解释为什么第一条不足以定责，再由用户决定是否继续。

## Windows Computer Use 使用要求

优先使用已验证可工作的 native `sky`：

- 先 `list_windows()` 并确认目标 Edge window；
- 对窗口执行 fresh state；
- 优先 accessibility / element-targeted action；
- 键盘输入使用 `type_text` / `press_key`；
- 不在没有 fresh state 的情况下猜坐标；
- 不用 Browser Use 替代 native Computer Use，除非任务明确需要 DOM/CDP 且用户另行同意。

## Mica Guided Diagnostics

当前 Mica 已内置 `Run composer check`，应优先使用，而不是重新粘贴 Console JS。

它只在主动诊断 session 内低接触采样，并记录：

- composer existence；
- text length；
- editable/root session-local identity；
- disappearance duration；
- mention signal；
- mounted/user turn count；
- native-safe / observer / listener 状态；
- send 后 stale text / new user turn。

不得记录 prompt / answer 原文。

## 本轮禁止

- 不修改 Mica source；
- 不修改 `dist/mica-dev`；
- 不 bump 版本；
- 不 commit runtime fix；
- 不自动 Send；
- 不自动 Retry / Regenerate；
- 不创建新真实对话；
- 不循环刷新；
- 不用 synthetic JS 修改 ChatGPT composer；
- 不通过 DevTools Console dispatch input/change/submit；
- 不自动化用户正常 Edge profile 产生真实消息流量。

## 判定规则

### 高置信 Mica root cause

- Mica Enabled 稳定复现；
- Mica runtime Disabled 后不复现，或 extension 完全 Disabled 后不复现；
- 同时 Guided report / runtime state 能指出 Mica 活动与 disappearance 时间相关。

### 高置信 ChatGPT / non-Mica root cause

- Mica extension 完全 Disabled 后仍以相同方式复现；
- 普通删除也会出现 composer unmount/remount；
- 或 `@GitHub` mention 路径在无 Mica 时同样触发。

### Connector-specific

- 普通文本删除正常；
- `@GitHub` mention 删除异常；
- Mica ON/OFF 都相同。

### 证据不足

如果只有一次偶发、A/B 条件不一致、或无法在相同 thread/相同操作下比较，应明确写 `insufficient evidence`，不要强行归因。

## 最终输出

Codex 本轮只返回诊断结论，不修代码：

1. 当前目标 thread 是否成功定位；
2. Mica Enabled 普通删除结果；
3. Mica Enabled `@GitHub` 删除结果；
4. Mica runtime Disabled 对照；
5. 如执行，Mica extension 完全 Disabled 对照；
6. Guided Composer Diagnostics 关键摘要；
7. 是否执行了用户手动 Send；
8. 最可能根因排序；
9. 置信度；
10. 下一步最小修复/实验建议。

若最终高置信判断是 Mica，再单独开启下一轮 runtime fix；不要在本轮边诊断边改代码。
