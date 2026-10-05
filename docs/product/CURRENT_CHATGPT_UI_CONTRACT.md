# 当前 ChatGPT UI 合同

## 当前结论

2026-10-05 已通过 Codex 隔离的 in-app browser 对 `https://chatgpt.com/` 做一次只读、无发送、无登录观察。当前证据可以精确描述登录前空 composer 和页面基础视觉语法，但不能证明已登录 assistant action cluster、typed/streaming/error/stop、connector/remount 或原生虚拟化。未解决表面不得用 2026 年 9 月 Atlas 结论补成 `EXACT`。

```text
CURRENT_CHATGPT_UI_CONTRACT=PARTIAL_CURRENT
LOGGED_OUT_EMPTY_COMPOSER=EXACT
ASSISTANT_ACTION_CLUSTER=UNRESOLVED
AUTHENTICATED_LIFECYCLE=UNRESOLVED
INJECTED_UI_IMPLEMENTATION_GATE=CLOSED
REAL_CHATGPT_SEND_COUNT=0
BROAD_ATLAS_RUN_COUNT=0
```

## 采集边界

- surface：Codex in-app browser，独立于用户日常 Edge profile；
- URL：`https://chatgpt.com/`；
- 时间：`2026-10-05T04:10:57.757Z` 至 `2026-10-05T04:12:44.098Z`；
- viewport：`1280 × 720`，`devicePixelRatio=2`；
- 主题信号：`prefers-color-scheme: dark`，root `color-scheme: light dark`；
- 账号状态：未登录；
- 观察方式：targeted DOM/AX/geometry 与截图；
- 未执行：登录、发送、打开私有会话、读取草稿/附件、网络抓包、DOM dump、Atlas。

页面暴露的会话状态工具可能返回草稿、附件或私有对话内容，安全审查拒绝调用。本 Goal 不绕过该边界。

## 空 composer 精确合同

### DOM 与值来源

- editable：`textarea#mobile-composer-prompt`；
- AX role：`text entry area (settable)`；
- accessible name：`与 ChatGPT 聊天`；
- 值来源：property-backed `HTMLTextAreaElement.value`；
- 空状态正文长度：`0`；
- 当前页面没有 `contenteditable="true"` composer。

### 几何与排版

- textarea：`614 × 24`，位置约 `x=443, y=386`；
- 字号/行高：`17px / 24px`；
- padding：`0`；
- `overflow-y: auto`；
- shell：向上第 7 层 `form`，`768 × 52`，位置约 `x=386, y=372`；
- shell radius：`28px`；
- shell background：`oklch(0.247759 0 none)`；
- shell shadow：`rgba(255, 255, 255, 0.2) 0 0 1px inset`。

### 空状态控件

- `添加文件等`：44 × 44，圆形，enabled；
- `开始听写`：44 × 44，圆形，enabled；
- 发送按钮：AX 中存在但 disabled；视觉截图当前显示 voice affordance，不得仅凭旧 selector 假设发送按钮位置。

## 当前视觉语法

当前暗色界面使用接近黑色的主背景、单层低对比 composer surface、白色正文、圆形 44px utility controls、极少阴影与紧凑图标。Mica 页面注入应继承尺寸、基线、间距和状态语法，但不能复制来源不明的专有图标资产。

Popup 属于扩展自己的 surface，不需要伪装成 ChatGPT；它应保持同样的克制密度和语义状态，同时保留 Mica 品牌识别。

## 状态覆盖矩阵

| 表面 / 状态 | 当前证据 | 等级 | 实现规则 |
|---|---|---|---|
| Composer empty | 当前 IAB DOM/AX/geometry/screenshot | EXACT | 可用于 property-backed value 与空状态 fixture |
| Composer typed | 未发送、未写入草稿 | UNRESOLVED | 不据此写 selector 或 recovery 语义 |
| Streaming / Stop | 未登录，无 generation | UNRESOLVED | 只做本地派生 fixture，最终需当前证据 |
| Error / retry / dialog | 当前页面只见非目标 AX alerts/dialogs | UNRESOLVED | 不自动点击；未知结构 fail-open |
| Mention / connector | 登录前不可用 | UNRESOLVED | 旧 fixture 仅作历史回归 |
| Composer remount | 当前未触发 | UNRESOLVED | 旧 9 月证据为 LIMITED，不是当前权威 |
| Assistant answer action cluster | 当前无 assistant turn | UNRESOLVED | Copy 注入隐藏，直到当前合同精确 |
| Native Copy 邻接 | 当前无 assistant turn | UNRESOLVED | 不使用宽泛 fallback 容器 |
| Conversation turn identity | 当前无 turn | UNRESOLVED | 使用真实派生 fixture 后再冻结 |
| Native virtualization | 当前无长 thread | UNRESOLVED | 不宣称 Mica 性能收益 |
| Narrow viewport | 尚未在当前服务采集 | UNRESOLVED | 先由本地 fixture 验证，最终合并采集 |
| Light theme | 尚未在当前服务采集 | UNRESOLVED | 先由本地 fixture 验证，最终合并采集 |

## 历史证据使用规则

2026-09-13 的 Atlas、action bar 和 long connector failure 合同只可用于：

- 重建 old-bad fixture；
- 保留已知 failure semantics；
- 对比 selector 漂移；
- 证明旧代码曾失败。

它们不可证明 2026-10-05 的 DOM/AX identity、按钮顺序、间距、tooltip、composer lifecycle 或 native virtualization。

## 唯一外部证据合并项

在本地 probe、自测、serializer、reliability、popup、highlighter、PDF、Notion-ready 和全部可离线 QA 完成后，如仍无已授权隔离登录路径，将一次性请求：

1. 当前 assistant action cluster 与 native Copy 邻接的脱敏只读报告；
2. 一次 connector 选择/remount 的 bounded lifecycle 报告；
3. 冻结候选的最终真实确认；
4. 只有本地与官方合同无法证明时，追加一次 Notion paste 结果。

该请求必须由已在本地 fixture 自测通过的单一 Mica 动作完成，不要求用户开 DevTools 或粘贴 JavaScript。
