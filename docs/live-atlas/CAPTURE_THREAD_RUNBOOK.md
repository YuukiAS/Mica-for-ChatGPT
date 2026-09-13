# Mica Live Surface Atlas — 专用采集线程操作手册

状态：**READY FOR ONE SHORT EVENT-ONLY LIVE ACCEPTANCE（准备一次短真实 event-only 验收）**。

Goal 009 的协议、定位、数据接入、隐私清洗、fixture 和生命周期门禁已在 `ae0732b Harden atlas ground truth capture` 中完成；Goal 010 的 preflight 完整性门禁已在 `05ebda7 Complete atlas preflight integrity gate` 中完成；Goal 011 的滚动坐标安全定位和 CDP attach handshake 已在 `45aa9dc Harden atlas targeting handshake` 中完成；Goal 014 已把真实 Round 1–6 artifact 转换为 committed real contract pack；Goal 016 把最终产品验收切到 event-only 模式。

**不要再开始完整 Round 1–6 视觉采集。** 真实 UI/DOM ground truth 已经进入：

```text
tests/contracts/chatgpt-live/real-2026-09-13/
```

最终产品验收只使用 `atlas:final-acceptance -- --capture-mode=event-only`。在 event-only 模式下，真实用户交互期间 CDP 只接收 recorder marker/report，不发送：

```text
DOMSnapshot.captureSnapshot
Page.captureScreenshot
```

视觉 Atlas (`atlas:capture` 默认 visual mode) 只作为开发者 UI drift / 新 ground-truth 采集工具，不是 0.2.0 产品验收路径。

在最终验收里，只有当 CDP companion 已明确打印下面两行后，才允许在 Mica 中点击 `Start Atlas`：

```text
REAL_EDGE_CDP_ATTACHED = YES
SAFE_TO_START_ATLAS = YES
```

不要用“等几秒”代替这个 handshake。

这份手册定义一个专门用于 Mica Live Surface Atlas 的真实 ChatGPT thread。当前目标是一次短 event-only 产品验收：用 committed real contract pack 覆盖 UI/DOM ground truth，用轻量 recorder event 覆盖真实产品交互。

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
5. Windows 下 Edge 会在当前用户数据目录写入 `DevToolsActivePort`。Atlas 工具会通过 `--user-data-dir` 读取该文件，并直接连接其中记录的 browser WebSocket。

```powershell
$edgeUserData = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
```

之后把这个 `$edgeUserData` 传给 `atlas:final-acceptance`；仅在开发者重新采集 visual ground truth 时才传给 `atlas:capture`。不要把 `/json/list` 或 `/json/version` 是否可访问作为成功标准；`edge://inspect` 的 auto-connect 路径以 `DevToolsActivePort` 为准。

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

## 最终 event-only live acceptance

这是 0.2.0 的产品验收入口。它验证 Mica 本体，而不是验证视觉采样工具本身。

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
v020-convergence.rc7
```

### 2. 准备专用 thread

在**当前项目**内准备一个无敏感内容的专用 ChatGPT thread。

URL 必须已经包含 `/c/<conversation-id>`。Project-scoped URL 也支持；使用地址栏中的**完整原始 URL**，不要手动删 path/query。

如果一个全新空 thread 暂时没有 `/c/<id>`，不要为了生成 ID 先发消息。可使用一个已有、无敏感内容的项目 thread 做最终 event-only 验收。

### 3. 启用当前 Edge 的远程调试

优先按上面的“复用当前已经登录的 Edge”方式，在 `edge://inspect` 中启用远程调试，然后准备当前 Edge user-data-dir：

```powershell
$edgeUserData = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
```

### 4. 启动 final acceptance harness

复制专用 thread 的完整 URL：

```powershell
$threadUrl = '<完整 ChatGPT thread URL>'
```

运行推荐的 `DevToolsActivePort` auto-connect 命令。注意这里必须是 `atlas:final-acceptance`，并显式使用 event-only mode：

```powershell
npm run atlas:final-acceptance -- --thread-url="$threadUrl" --user-data-dir="$edgeUserData" --capture-mode=event-only
```

仅当当前环境明确提供传统 `/json/list` discovery 时，才使用兼容 fallback：

```powershell
npm run atlas:final-acceptance -- --thread-url="$threadUrl" --port=9222 --capture-mode=event-only
```

event-only 模式下，真实用户交互期间必须保持：

```text
DOMSnapshot.captureSnapshot = 0
Page.captureScreenshot = 0
heavyCaptureCount = 0
```

### 5. 等待明确 handshake

**什么都不要点**，直到终端出现：

```text
REAL_EDGE_CDP_ATTACHED = YES
SAFE_TO_START_ATLAS = YES
```

### 6. 用户手动执行短验收

看到 `SAFE_TO_START_ATLAS = YES` 后：

1. 打开 Mica popup；
2. 展开 `Advanced`；
3. 点击 `Start Atlas`；
4. 确认显示 `Recording`；
5. 输入一段短英文 + 中文草稿，并做一次小编辑；
6. 手动输入 `@GitHub`，并由用户本人手动选择 GitHub connector；
7. 手动发送这条只读请求：

```text
@GitHub 仅做只读检查：读取 YuukiAS/Mica-for-ChatGPT 仓库 README.md 第一行，并用一句中文告诉我这一行是什么。禁止任何写操作。
```

8. 等回答 settle；
9. 在当前 assistant response 上手动点击一次 `Mica Copy`；
10. 再次打开 popup；
11. 点击 `Stop`。

正常让 companion 收到 `atlas_stopped` 后自动收口；不要用 Ctrl+C 提前终止。

### 7. 成功标准

Stop 后 harness 会自动：

- sanitize；
- validate privacy；
- build local fixture；
- compare committed `real-2026-09-13` contract pack；
- validate lifecycle；
- validate Atlas overhead；
- classify feature evidence；
- 写出 `final-acceptance-report.json` 和 `release-readiness.json`。

最终 JSON 必须至少满足：

```text
FINAL_LIVE_ACCEPTANCE = PASS
DOMSnapshot.captureSnapshot = 0
Page.captureScreenshot = 0
heavyCaptureCount = 0
```

用户只需要额外报告三项人工观察：

```text
LIVE_VISUAL_STABILITY = PASS/FAIL
LIVE_TYPING_SMOOTHNESS = PASS/FAIL
LIVE_CONNECTOR_STABILITY = PASS/FAIL
```

如果失败，不要立刻重跑。保留终端错误和 raw artifacts，先修真实问题。

---

## Developer visual Atlas mode

`atlas:capture` 默认仍是 visual mode，仅用于未来 UI drift 或新 ground-truth 获取。这个模式允许 sparse semantic visual checkpoints，因此可能发送：

```text
DOMSnapshot.captureSnapshot
Page.captureScreenshot
```

它不是最终产品 acceptance。只有需要重新获取真实 UI contract、截图坐标或 surface drift 证据时才使用 visual mode；raw capture 必须保留在 gitignored `artifacts/live-atlas/<session-id>/`。

任何 visual mode 中未真实观察到的 surface 都必须保持 `MISSING`，不得手画一个近似组件再称其为 ground truth。
