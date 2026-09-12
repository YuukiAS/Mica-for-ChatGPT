# Goal 013 — 兼容 Edge `edge://inspect` / DevToolsActivePort 自动连接

## 状态

**BLOCKING REAL EDGE NO-SEND PREFLIGHT.**

真实 Edge 预检暴露了一个环境兼容缺口：通过 `edge://inspect` 开启“允许对此浏览器实例进行远程调试”后，Edge 会在用户数据目录写入 `DevToolsActivePort`，其中包含端口和 browser WebSocket path；但本机 `http://127.0.0.1:9222/json/list`、`/json/version` 返回 404。

这不是远程调试未启动：Edge 页面明确显示 `Server running at: 127.0.0.1:9222`，且 `DevToolsActivePort` 存在。Microsoft 当前文档对 auto-connect 的说明也是由客户端读取 `DevToolsActivePort` 后直接连接 browser WebSocket。

当前 Mica companion 仍依赖 `/json/list` 做 target discovery，因此无法复用用户已经登录的 Edge profile。

## 目标

让 Mica Atlas companion 支持两种只读发现模式：

1. 传统 `--remote-debugging-port` 模式：HTTP `/json/list` 可用时继续使用；
2. Edge `edge://inspect` auto-connect 模式：HTTP discovery 不可用时，读取 `DevToolsActivePort`，连接 browser WebSocket，并通过只读 CDP `Target.getTargets` / `Target.attachToTarget(flatten=true)` 精确附加到用户指定的 ChatGPT conversation tab。

优先复用当前登录 Edge，不要求用户重新登录或另开 profile。

## 安全边界

保持：

- `AUTOMATED_SEND = NO`
- `AUTOMATED_ENTER = NO`
- `AUTOMATED_UPLOAD = NO`
- `AUTOMATED_CONNECTOR_ACTION = NO`
- 不允许 `Page.navigate` / `Page.reload` / `Input.*` / arbitrary `Runtime.evaluate`

新增 browser-session CDP 只允许 target discovery / attach 所需的明确命令，并继续对 page session 应用原有只读 allowlist。

## 实现要求

### 1. DevToolsActivePort 发现

Windows Edge Stable 默认用户数据目录：

`%LOCALAPPDATA%\Microsoft\Edge\User Data`

支持显式参数，例如：

`--user-data-dir=<path>`

读取：

`<user-data-dir>\DevToolsActivePort`

第一行：端口；第二行：browser WebSocket path。

构造：

`ws://127.0.0.1:<port><browser-path>`

不得把该文件内容写入公开 contract。

### 2. Browser WebSocket target discovery

通过 browser WebSocket 使用只读：

- `Target.getTargets`
- `Target.attachToTarget`，`flatten: true`

按用户传入的完整 `thread-url` 做 **exact target URL match**；必须恰好一个 page target。

不得导航或创建新 target。

### 3. Session-aware CDP

Browser WebSocket 上 attach page 后，后续 page-domain CDP command 必须带对应 `sessionId`，并正确路由 response/event。

原有 direct page WebSocket 路径仍应保持兼容。

### 4. Discovery fallback 顺序

推荐：

1. 如果用户显式提供 `--user-data-dir` 且 `DevToolsActivePort` 可用，优先 auto-connect；
2. 否则尝试传统 `/json/list`；
3. 若 HTTP discovery 404/空结果，但默认 Edge user-data-dir 有 `DevToolsActivePort`，自动 fallback；
4. 两种方式都失败才报错。

错误信息必须告诉用户实际尝试了哪几种方式。

### 5. CLI / preflight

`atlas:preflight` / `atlas:capture` 支持：

`--user-data-dir="$env:LOCALAPPDATA\Microsoft\Edge\User Data"`

在成功 attach 当前已登录 Edge 后仍打印：

`REAL_EDGE_CDP_ATTACHED = YES`
`SAFE_TO_START_ATLAS = YES`

### 6. 测试

新增 fake browser-WebSocket protocol test，证明：

- `/json/list` 404；
- `DevToolsActivePort` 存在；
- browser WebSocket attach 成功；
- `Target.getTargets` 返回多个 target；
- exact ChatGPT thread 被唯一选中；
- `Target.attachToTarget(flatten=true)` 成功；
- page session event/response routing 正常；
- 原有 DOMSnapshot/screenshot/preflight pipeline 仍工作；
- forbidden CDP commands 仍不可能发送。

同时保留传统 direct page discovery regression。

## 完成门禁

`EDGE_DEVTOOLS_ACTIVE_PORT_DISCOVERY = PASS`
`BROWSER_WS_TARGET_DISCOVERY = PASS`
`SESSION_ROUTING = PASS`
`HTTP_DISCOVERY_FALLBACK = PASS`
`EXISTING_LOGGED_IN_EDGE_REUSE = READY`
`PREFLIGHT_PIPELINE = PASS`
`AUTOMATED_SEND = NO`
`AUTOMATED_ENTER = NO`
`AUTOMATED_UPLOAD = NO`
`AUTOMATED_CONNECTOR_ACTION = NO`
`READY_FOR_REAL_EDGE_NO_SEND_PREFLIGHT = YES`
