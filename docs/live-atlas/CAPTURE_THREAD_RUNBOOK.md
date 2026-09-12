# Mica Live Surface Atlas — 专用采集线程操作手册

状态：**READY FOR REAL EDGE NO-SEND PREFLIGHT（可以开始真实 Edge 无发送预检）**。

Goal 009 的协议、定位、数据接入、隐私清洗、fixture 和生命周期门禁已在 `ae0732b Harden atlas ground truth capture` 中完成；Goal 010 的 preflight 完整性门禁已在 `05ebda7 Complete atlas preflight integrity gate` 中完成；Goal 011 的滚动坐标安全定位和 CDP attach handshake 已在 `45aa9dc Harden atlas targeting handshake` 中完成；Goal 012 的截图坐标完整性门禁已在当前候选分支完成。

**不要直接开始 Round 1。** 必须先完成真实 Edge 的“无发送预检”，且终端明确打印：

```text
REAL_EDGE_PREFLIGHT = PASS
```

无发送预检只采集当前 thread 的 composer 和 Mica overlay；不得发送消息、提交表单、上传文件、运行 connector、Retry/Regenerate，也不得修改账号或对话。

在无发送预检和后续正式采集里，只有当 CDP companion 已明确打印下面两行后，才允许在 Mica 中点击 `Start Atlas`：

```text
REAL_EDGE_CDP_ATTACHED = YES
SAFE_TO_START_ATLAS = YES
```

不要用“等几秒”代替这个 handshake。

这份手册定义一个专门用于 Mica Live Surface Atlas 的真实 ChatGPT thread。目标是一次性采集真实 UI 结构、生命周期顺序、时间数据和视觉 checkpoint，之后尽量在本地 fixture 中复现，而不是反复让用户做人工 QA。

## 版本 / 分支前提

不要从 `main` / `0.1.7` 运行本次采集。

必须使用候选分支：

```text
codex/v020-convergence-pushable
```

采集前必须从该分支重新构建 `dist/mica-dev`，并确认 popup/manifest 显示当前 `0.2.0` convergence candidate。

## 推荐方式：复用当前已经登录的 Edge

**不需要为了 Atlas 重新登录 ChatGPT。**

Microsoft Edge 现在支持对已经运行、已经登录的网站会话启用远程调试。推荐直接复用你当前正在使用的 Edge profile，而不是再开一个临时 `--user-data-dir` profile。

操作：

1. 在当前 Edge 打开：

```text
edge://inspect
```

2. 左侧进入“远程调试 / Remote debugging”。
3. 勾选“允许对此浏览器实例进行远程调试”。
4. 当前登录状态、Cookie、现有 ChatGPT 会话都会继续保留。
5. Windows 下 Edge 会在当前用户数据目录写入 `DevToolsActivePort`。PowerShell 可读取：

```powershell
$devtoolsFile = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\DevToolsActivePort'
$port = [int](Get-Content $devtoolsFile | Select-Object -First 1)
$port
```

之后把这个 `$port` 传给 `atlas:preflight` / `atlas:capture`。

只有在 `edge://inspect` 方式不可用时，才考虑另开专用 Edge profile。不要默认要求重新登录。

如确实需要查找本机 `msedge.exe` 路径，可直接在 PowerShell 用：

```powershell
(Get-Process msedge | Where-Object Path | Select-Object -First 1 -ExpandProperty Path)
```

## 硬性安全边界

Atlas、CDP、Codex、Computer Use、Playwright 或任何其他 agent/tool 都不得在真实 ChatGPT 上自动执行：

- Send；
- Enter / Ctrl+Enter 的提交路径；
- form submit；
- 上传或附件选择；
- connector/tool 执行；
- Retry / Regenerate / Stop；
- OAuth / 账号设置 / 支付；
- 编辑或删除真实对话。

本手册中所有真实 Send 都必须由用户手动完成。

CDP companion 只读。正式采集不需要 Computer Use，也不能让 Computer Use 驱动对话。

## 真实 Edge 无发送预检

正式 Round 1 之前先做一次完全不发送消息的 preflight。

### 1. 准备候选版本

在 repo 中：

```powershell
cd C:\Code\Mica-for-ChatGPT
git fetch origin
git switch codex/v020-convergence-pushable
git pull --ff-only origin codex/v020-convergence-pushable
npm run build
npm run test:build
```

重新加载 unpacked extension：

```text
C:\Code\Mica-for-ChatGPT\dist\mica-dev
```

确认 Mica popup 显示：

```text
v0.2.0
v020-convergence.rc5
```

### 2. 准备专用 thread

在**当前项目**内准备一个无敏感内容的专用 ChatGPT thread。

URL 必须已经包含 `/c/<conversation-id>`。Project-scoped URL 也支持；使用地址栏中的**完整原始 URL**，不要手动删 path/query。

如果一个全新空 thread 暂时没有 `/c/<id>`，不要为了生成 ID 先发消息。可先使用一个已有、无敏感内容的项目 thread 做 no-send preflight。

### 3. 启用当前 Edge 的远程调试

优先按上面的“复用当前已经登录的 Edge”方式，在 `edge://inspect` 中启用远程调试，然后取得 `$port`。

### 4. 启动 preflight

复制专用 thread 的完整 URL：

```powershell
$threadUrl = '<完整 ChatGPT thread URL>'
```

运行：

```powershell
npm run atlas:preflight -- --thread-url="$threadUrl" --port=$port
```

### 5. 等待明确 handshake

**什么都不要点**，直到终端出现：

```text
REAL_EDGE_CDP_ATTACHED = YES
SAFE_TO_START_ATLAS = YES
```

### 6. Start / Stop Atlas

看到 `SAFE_TO_START_ATLAS = YES` 后：

1. 打开 Mica popup；
2. 展开 `Advanced`；
3. 点击 `Start Atlas`；
4. 确认显示 `Recording`；
5. 不输入、不 Send、不选 connector、不上传；
6. 再次打开 popup；
7. 点击 `Stop`。

正常让 companion 收到 `atlas_stopped` 后自动收口；不要用 Ctrl+C 提前终止。

### 7. 成功标准

最终必须打印：

```text
REAL_EDGE_PREFLIGHT = PASS
```

如果失败，不要立刻重跑。保留终端错误和 raw artifacts，先修真实问题。

---

## 正式专用采集 thread

只有 preflight PASS 后才进入下面 Round 1–5。

正式采集时，Atlas 从 Round 1 开始后应保持**同一个连续 recording session**。除非采集本身失败，否则不要每轮 Stop/Start。

开始前：

1. Reload 当前 `dist/mica-dev`；
2. 打开专用 capture thread；
3. 启动只读 CDP companion，使用该 thread 的完整 URL；
4. 等到终端打印 `SAFE_TO_START_ATLAS = YES`；
5. Mica popup → `Advanced` → `Start Atlas`；
6. 确认 Atlas 显示 Recording，CDP companion 也只绑定了这个 exact target。

## Round 1 — 真实输入 / 中文 IME / 粘贴

目的：采集普通 composer focus、英文/中文输入、IME composition、删除修正、粘贴、输入延迟，以及第一次普通手动 Send 生命周期。

发送前手动操作：

1. 输入：`Mica Atlas typing test: ABC 123 `
2. 使用中文输入法输入：`中文输入法测试`
3. Backspace 删除最后两个中文字符，再重新输入
4. 精确粘贴：` | pasted-segment | `
5. 清理 composer，使最终发送内容只保留下面这句话，然后**手动点击 Send 一次**：

```text
Mica Atlas baseline round. 请只用一句中文回复：Baseline capture complete.
```

等待回答完全结束，并出现正常 assistant action bar。

## Round 2 — Rich Markdown / LaTeX / Copy ground truth

目的：采集真实 Markdown/LaTeX assistant DOM、action bar 几何、原生 Copy 区域和 Mica Copy 输出。

精确发送：

```text
这是一个浏览器渲染与复制测试。请不要调用任何工具或联网，只生成一份短测试答案，并严格包含以下结构：

1. 一个二级标题；
2. 一段普通文字，其中同时有粗体、斜体和行内公式 a^2+b^2=c^2；
3. 一个两层嵌套的无序列表；
4. 一个引用块；
5. 一个独立展示公式：从 0 到 1 的 x^2 积分等于 1/3；
6. 一个 fenced Python 代码块，内容为定义并调用平方函数；
7. 一个恰好两列、三行数据的 Markdown 表格；
8. 最后一行写：Rich capture complete.

不要加入额外章节，也不要使用附件、工具、搜索或连接器。
```

回答结束后：

1. 等原生 assistant action bar 出现；
2. 手动执行一次 Mica Copy；
3. 保留复制出来的 Markdown，最终交给 Atlas 后处理比较，不要手工修改。

Copy 的预期约束：展示公式应输出为 `$$ ... $$`，不是 `\[ ... \]`。

## Round 3 — 长回答 / streaming cadence

目的：采集较长的真实 streaming、mutation cadence、settled transition、action bar 出现时间、mounted-turn window 变化、Long Animation Frames 和 long-task evidence。

精确发送：

```text
请不要调用任何工具或联网。用大约 1200 至 1600 个中文字解释“偏差—方差权衡”，面向已经学过基础统计但还没有系统学机器学习的读者。要求分成 5 个小节，每节有清楚标题；包含一个简单公式、一个具体数字例子和一个最后总结。不要故意缩短答案，也不要超过 1800 个中文字。
```

生成过程中不要点 Stop，也不要操作回答。等待完全结束和 action bar 出现。

## Round 4 — Composer 生命周期，不发送

目的：采集编辑、清空、剪切、focus/blur；本轮不产生 server-side Send。

**本轮不要发送任何内容。**

1. 在 composer 输入：`Atlas composer lifecycle 123 中文测试 ABC`
2. `Ctrl+A` → Delete
3. 输入：`Atlas second draft — 不发送`
4. 只选中 `second draft`，用 `Ctrl+X` 剪切
5. 点击 composer 外的无害空白区域，使其 blur
6. 再点击 composer，使其 focus
7. `Ctrl+A` → Delete 清空剩余草稿
8. 最终保持空 composer

## Round 5 — Connector chooser / pill / remount，不发送

目的：采集真实 connector chooser、selected pill、composer identity/remount、几何和移除过程，但不执行 connector。

**本轮不要发送任何内容。**

1. 手动输入 `@GitHub`
2. 手动从 chooser 选择 GitHub connector
3. 等 connector pill 和 composer 视觉稳定
4. 输入：`Atlas connector UI only — do not send`
5. 观察普通输入是否仍然流畅
6. 用正常 UI/editor 操作移除 connector 并清空草稿
7. 最终保持空 composer

只有用户本人可以选择 `@GitHub`。Agent / CDP / Computer Use 不得代替用户选择。

## Round 6 — 可选：Connector Send + Mica 0.2.0 最终验收

只有 Round 1–5 全部采集成功、pre-send gates 仍为绿色时才运行。

这一轮可以同时作为 Mica `0.2.0` 的最终 connector 人工验收。

用户手动选择 `@GitHub`，并手动发送：

```text
@GitHub 仅做只读检查：读取 YuukiAS/Mica-for-ChatGPT 仓库的 README.md 第一行，并用一句中文告诉我这一行是什么。禁止创建、修改、删除、合并、评论、打标签或执行任何其他 GitHub 写操作。
```

完成后人工确认：

- 只提交了一个 user turn；
- composer 正确清空；
- 已发送文本不会残留或重新出现；
- composer 仍可正常输入且流畅；
- assistant/tool UI 正常 settle；
- Mica overlay 没有挡住 ChatGPT 原生 UI。

如果不想在本轮执行 connector，可跳过 Round 6，稍后用普通无害 Send 单独做最终 `0.2.0` acceptance。

## 采集结束

最后一轮完成后：

1. 只 Stop Atlas 一次；
2. `Copy Atlas report` 可作为人工备份，但正常管线已自动 ingest recorder report；
3. 让只读 CDP companion 正常收到 terminal marker 并退出；
4. raw capture 保留在 `artifacts/live-atlas/<session-id>/`，必须保持 gitignored；
5. 在解释结果前运行完整后处理：

```text
npm run atlas:sanitize -- --input=<raw-session>
npm run atlas:build-fixtures -- --input=<sanitized-contract>
npm run atlas:analyze-timings -- --input=<sanitized-contract>
npm run test:atlas
npm run test:integration
```

6. 比较 Round 2 的 Mica Copy 与预期结构，并检查 `$$` 展示公式约束；
7. 根据真实 timing ledger 审计剩余 lifecycle timing constants：优先改为 event-driven，只保留真正有必要的 safety cap。

## Bootstrap capture 成功门槛

只有以下全部成立，第一次 Atlas bootstrap 才算完成：

```text
REAL_CDP_ATTACHED = YES
REAL_SURFACE_CONTRACTS > 0
REAL_CROPPED_CHECKPOINTS > 0
MULTI_ROUND_LIFECYCLE_RECORDED = YES
TIMING_LEDGER_REAL_N > 1 where the transition repeats
PRIVACY_VALIDATION = PASS
OFFLINE_FIXTURE_REPLAY = PASS
ATLAS_CAPTURE_DID_NOT_CAUSE_TYPING_LAG = YES
AUTOMATED_SEND = NO
AUTOMATED_ENTER = NO
AUTOMATED_UPLOAD = NO
AUTOMATED_CONNECTOR_ACTION = NO
```

任何要求的真实 surface 如果没有观察到，就保持 `MISSING`。不得手画一个近似组件再称其为 ground truth。
