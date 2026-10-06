# Mica 产品合同

## 产品任务

Mica 是一个本地运行的 Chromium 扩展。它在不接管 ChatGPT、不上传聊天正文、不绕过授权界面的前提下，减少日常复制、研究整理和页面故障恢复的摩擦。

主要用户是长期使用 ChatGPT 处理技术、研究和写作工作的个人用户。使用频率高，界面应适合快速扫读和重复操作，不应把诊断、测试或内部状态当作产品内容。

## 正常产品界面

### Popup

Popup 是日常控制面，不是调试控制台。结构固定为：

1. 顶部显示 Mica 身份、总开关和当前页是否受支持。
2. 主体最多显示 4 组能力：`Copy & Export`、`Low-memory mode`、`Reliability`、`Page integration`。
3. 每组只显示用户能理解的当前状态和至多 1 个必要动作。
4. 高级设置默认收起；开发诊断进入独立 developer/options surface。

Popup 不显示 Atlas、fixture、mock、raw selector、mounted DOM 计数、build internals、内部路径或成排的 Run/Copy/Stop/Reset。

### 页面注入

- Copy 入口只有在 Mica 能确认 assistant answer、正文边界和当前 native action cluster 时才出现。
- 入口使用图标按钮和无歧义 tooltip，不用破坏原生工具条密度的长文字按钮。
- Reliability 只在异常发生时出现，靠近相关上下文，提供 1 个清楚且安全的下一步。
- Highlighter 使用选择后的轻量入口或浏览器 context menu，不常驻悬浮工具栏。
- 页面不显示常驻状态点。无法证明自然锚点时，状态只留在 popup 或短暂反馈中。
- 未识别结构时 fail-open：不修改正文、不移动原生控件、不创建漂浮 fallback。

## 能力与状态

### Copy & Export

状态：`Available`、`Unavailable on this page`、`Copy failed`、`Export ready`。

用户动作：复制当前 assistant answer 为 Markdown、复制为 Notion-ready、导出当前 answer 为 PDF。

后置条件：

- 复制成功后 clipboard 中必须有与所选模式匹配的 MIME 和内容；
- PDF 必须生成可搜索/选择的文本层，并保留适用高亮；
- 结构不可信时不输出错误内容，而是明确不可用。

### Reliability

正常状态不显示提示。异常状态包括：

- `ghost_send_suspected`
- `fake_waiting_suspected`
- `stale_response_suspected`
- `generation_error_recovery_available`

恢复动作遵守最小风险原则：高置信未提交时可恢复草稿；可能已提交、包含 tool/attachment/connector/授权或外部写入时只提示，不自动重发。第一版不把自动重发作为默认路径。

### Page integration

该区域说明 Mica 是否安全识别当前页面。未知 action cluster 保持 `Native handling`，不猜测插入 Copy 控件。

### Low-memory mode

超长 conversation 默认只保留最近 40 turns 活跃。优先路径在 ChatGPT 页面消费 conversation mapping 前创建本地裁剪副本，因此同时降低历史 app-state、DOM 与渲染负担；服务器原始 conversation 不被修改。`Load full history` 会为当前路径设置一次会话 bypass 并刷新，关闭 Mica 后刷新也恢复完整历史。

仅处理同源 GET、精确 conversation 路径、可验证的无环 active path。近期 active branch、未知 graph、streaming、dialog、tool/file/auth/connector 等敏感结构 fail-open。DOM fallback 只处理 120+ 个同父级、单一 user/assistant role 的普通 turns；它不保存正文，恢复依赖重新加载服务器历史。

### Highlighter

高亮以 conversation/page 为范围保存在本机。选区无法稳定锚定、正文变化或 turn remount 后无法确定唯一位置时，确定性降级，不猜测恢复位置。

## 用户可见文案合同

产品文案使用普通动作和结果，不暴露内部协议。当前冻结语义如下：

| Surface | UI role | Product state | User job | Consequence / next action |
|---|---|---|---|---|
| Popup header | 总开关 | 支持页 / 非支持页 | 启用或停用 Mica | 只影响 Mica，不改变 ChatGPT 账号设置 |
| Copy & Export | 能力行 | 可用 / 不可用 / 失败 | 选择输出方式 | clipboard 或本地 PDF 更新 |
| Low-memory mode | 能力行 | 待命 / 已窗口化 / 完整历史 / fail-open | 减少长对话内存或恢复历史 | 最近 40 turns 活跃；恢复时刷新完整历史 |
| Reliability | 异常提示 | 有可恢复异常 | 恢复草稿或按安全建议处理 | 不自动跨过授权，不盲目双发 |
| Page integration | 页面状态 | 已识别 / 原生处理 / 不支持 | 理解当前工作范围 | 未识别时保持原生行为 |
| Highlighter | 选择入口 | 选区可锚定 | 添加或移除高亮 | 只在本机保存 |

最终短文案由 `product-ui-copy` 在实际 viewport 中验证，不能用措辞掩盖产品状态或隐私边界。

## 开发与诊断界面

诊断是独立、显式进入的开发 surface。它可以显示 bounded event trace、结构计数和 Copy report，但默认关闭，不参与普通输入热路径，不修改 composer，不发送消息，也不成为正常功能的依赖。

## 信任与隐私

- 默认本地执行，不把聊天正文上传到第三方。
- diagnostics 只记录时间、长度、hash、状态和结构信号，不记录 prompt/answer 原文、token、header、cookie 或 request body。
- low-memory diagnostics 只记录模式、计数、字节数与原因码；不记录 conversation 正文。
- 不隐藏、点击、确认或绕过安全与授权 UI。
- 权限保持最小；新增权限必须对应可见能力和测试证据。

## 可见 action 的承诺

每个可见 action 必须满足：有真实实现、可达、可用状态正确、点击或键盘触发后有可验证后置条件、失败有自然反馈、刷新或 remount 后状态不伪造。没有满足这些条件的 action 不进入正常 UI。

```text
PRODUCT_CONTRACT=FROZEN
NORMAL_UI_DEV_CONTROLS=FORBIDDEN
FAIL_OPEN=REQUIRED
```
