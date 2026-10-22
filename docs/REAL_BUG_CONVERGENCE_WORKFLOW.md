# 真实站点问题收敛流程

这份流程适用于只能在已登录 ChatGPT 页面复现、且结论依赖当前 DOM、可访问性树、控件身份或浏览器生命周期的问题。它的目的不是增加审批步骤，而是避免从截图、旧选择器或用户描述直接猜测修复，造成连续错误候选。

本流程不影响能够独立完成的本地后端工作。真实站点证据暂时不可用时，应继续推进状态机、存储、安全策略、纯模型和验收器；只有依赖争议页面结构的运行时改动需要等待精确证据。

## 证据等级

报告必须逐项标记关键事实：

- `EXACT`：由经过自测的只读探针或 Mica 内置诊断从当前失败页面直接取得，且证明了所需身份、值或结构关系。
- `PARTIAL`：取得了实时信息，但关键相等关系、控件身份、属性值来源或父子关系尚未证明。
- `LIMITED`：只来自截图、旧合同、历史页面或用户可见描述。
- `MISSING`：没有观察到。

不能把 `PARTIAL`、`LIMITED` 或 `MISSING` 写成笼统的 PASS，也不能据此声称问题已经关闭或要求用户再次尝试新候选。

## 固定收敛顺序

真实站点问题必须按同一条证据链处理：

```text
保留已经失败的页面
  -> 明确争议行为和关键字段
  -> 用本地 fixture 自测窄探针
  -> 从同一失败页面取得 EXACT 证据
  -> 生成去敏的真实派生合同/fixture
  -> 证明旧实现对该 fixture 失败
  -> 证明新实现对同一 fixture 通过
  -> 跑受影响的聚焦回归与集成验证
  -> 只请求一次最终正常实站确认
```

如果旧实现也能通过新 fixture，说明 fixture 没有表达真实故障，必须先修正 fixture，不能继续改运行时。

## 取得当前页面证据

已经失败的页面是优先证据源。不要为了改善诊断要求用户重新制造同一个产品故障，也不要刷新、导航到别的 conversation 或在多个标签页中猜测目标。

需要用户现有 Edge 登录态时：

1. 先确认探针在本地 fixture 上能够提取该问题要求的证据等级。
2. 如果目标匹配依赖 conversation URL，应取得完整的 `https://chatgpt.com/c/<conversation-id>` URL。
3. 只提供一条可复制的 host PowerShell 命令，显式传入 `--thread-url` 和 `--user-data-dir`。
4. 探针只能读取必要的 DOM、可访问性、属性、几何、输入属性值和 Mica 状态，不读取正文、请求体、认证信息或附件内容。
5. 如果 Codex sandbox 无法连接用户 Edge 的 DevTools WebSocket，应停止连接重试，请用户运行已经自测的一次性命令。连接失败不是产品证据。

普通流程不得要求用户打开 DevTools、粘贴大型 JavaScript、复制原始 DOM 或反复截图。能够复用的观察逻辑应进入 Mica 的有界、默认关闭、隐私安全诊断模块。

## 控件与输入证据

属性驱动的表单控件必须读取属性或 snapshot 中的输入值，不能把 `textarea.textContent` 当作可见值。

图标按钮必须由窄范围语义、可访问性信息和 backend-node 身份共同确认。不能从宽泛 `div` 祖先、视觉位置或旧 aria 文案猜测 Stop、Retry、Resend、Copy 或建议工作区域。

探针不允许点击 Send、按 Enter、提交表单、上传文件、执行连接器、触发 OAuth、修改账户设置、创建或删除 conversation，也不允许发起 `POST`、`PUT`、`PATCH` 或 `DELETE`。临时输入测试只允许在 composer 原本为空时进行，并必须恢复为空。

## 运行时候选门槛

一次实站最终确认失败后，同一问题在满足以下条件前，不得 bump 版本、重建并推送新运行时候选：

```text
GROUND_TRUTH_CRITICAL_FIELDS = EXACT
OLD_CODE_REAL_FIXTURE = EXPECTED_FAIL
CURRENT_CODE_REAL_FIXTURE = PASS
FOCUSED_REGRESSIONS = PASS
AFFECTED_INTEGRATION_E2E = PASS
VERSION_CONSISTENCY = PASS
READY_FOR_SINGLE_FINAL_NORMAL_CONFIRMATION = YES
```

唯一例外是用户明确接受缺少精确证据的有限诊断补丁。此时文档、提交说明和结果都必须写明 `LIMITED`，不能描述成精确修复或实站闭环。

## 最终记录

失败后的报告必须说明：

- 哪些证据来自当前失败页面；
- 哪些只来自旧合同、截图或历史行为；
- 旧实现是否在真实派生 fixture 上如期失败；
- 新实现是否通过同一 fixture；
- 实际运行了哪些测试，哪些没有运行；
- 是否生成、提交或推送了新运行时候选。

缺少真实证据只限制对应的实站运行时改动，不应被扩展成整个 Mica 后端工作的 `BLOCKED`。
