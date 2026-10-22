# 0.5.4 功能收敛离线验证

`0.5.4` 的本地后端、构建身份和纯 Node 回归已经通过。恢复后端现在能对原生 Stop、assistant retry 和确认未提交 resend 执行精确证据授权、次数限制、settle/backoff 和跨 Service Worker 重启去重；真实 ChatGPT 控件适配仍未接入。本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。因此，这份记录证明的是离线实现与构建一致性，不是完整产品验收。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.4`
- 构建标签：`functional-convergence.5`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.json`

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run test:convergence-core` | PASS | 1.628 s | 重建、设置迁移和上限、Markdown/Notion、完整会话导出、两类高亮记录、普通网页锚点与动态注册、Reliability 状态机、三类精确动作授权、后台 claim、隐私历史和 controller 持久化 |
| `node scripts/low-memory-background-fixture.mjs` | PASS | 0.451 s | 注册串行化、存储失败 fail-open、full-history 状态、后台恢复与原生动作 claim 的 Worker 重启去重 |
| `node scripts/pdf-background-fixture.mjs` | PASS | 0.171 s | 后台脚本整合后仍保持可信来源、一次性传递、伪造 consumer 拒绝和失败清理 |
| `npm run test:build` | PASS | 0.790 s | `0.5.4` 版本一致性、权限边界、动作策略与 ledger、必需文件、需求矩阵、静态语法、隐私字段和 typing hot-path 禁止项 |
| `npm run acceptance:preflight` | PASS | 4.536 s | 验收器 `1.8.0` 接受 9/9 正例，拒绝 43/43 反例，包括重哈希后的错 turn 动作授权 |
| 矩阵 JSON 解析 | PASS | < 0.1 s | 机器可读矩阵语法与状态计数 |

`test:convergence-core` 输出还确认：Notion 回归样本得到 5 个有序行内公式；Notion 原生公式状态保持 `UNVERIFIED`；提交 A/B/C、首次/第二次刷新、刷新上限、只读/有副作用工具、tab 隔离和无正文历史全部通过纯状态验证。controller fixture 进一步确认首次发现的 settled answer 会直接结束恢复，不会等待到误刷新；未知提交会保留草稿供用户手动复制，未知工具状态会转入人工处理且不增加刷新次数，关闭 Reliability 会取消旧恢复状态，活跃恢复中的草稿也不能被第二个发送意图替换。

`RecoveryActionPolicy` 只接受 10 秒内的 `EXACT` 证据，并同时核对 recovery、scope、subject 和 native-control hash。原生 Stop、assistant retry、confirmed resend 都只能取得一次授权；错误 turn、错误 scope、陈旧证据、未知工具和有外部副作用工具均被拒绝。Stop 成功后按设置等待 settle，再决定是否第二次刷新；retry/resend 使用设置的 backoff。controller 必须先取得后台 claim，执行器还要回传同一 action ID，否则转入人工处理。普通内容运行时没有真实控件执行器，因此不会在没有 live contract 时猜测点击或提交。

`RecoveryLedger` 由 Service Worker 统一管理。自动刷新和三类原生动作都要先取得由 recovery、scope、sequence、ordinal 以及动作/控件身份绑定的一次性 claim；相同 claim 在 Worker 重启后仍被拒绝，其他标签页不受影响，过期项可清理重建。隐私历史的并发追加由后台串行化，相同事件只记录一次，最多保留 50 条，并明确删除草稿、prompt 和原始 conversation ID。存储层不可用时，控制器进入人工处理，不会退化成未去重动作。

普通网页高亮的纯模型验证覆盖 exact-origin 规范化、ChatGPT 排除、上下文消歧、内容位移恢复、重复文本 fail-open、页面和语义根隔离、绝对 DOM 路径拒绝，以及本地记录导入导出。后台 fixture 证明只有浏览器已经授权的 origin 会进入动态注册，拒绝授权的 origin 不会注入；权限撤销会注销脚本，权限恢复可重新注册，功能关闭也会注销。上述结果不等于文章页中的实际 CSS Highlight 绘制和交互已经通过。

## 未运行

| 类别 | 状态 | 原因 |
| --- | --- | --- |
| `npm test` | NOT RUN | 包含隔离 Chromium fixture；用户明确要求本轮不打开浏览器。 |
| `npm run test:e2e` | NOT RUN | 浏览器生命周期测试，本轮明确禁止。 |
| `npm run test:e2e:stress` | NOT RUN | 浏览器压力测试；同时当前阶段没有新的已验收浏览器候选可供压力定稿。 |
| Highlighter 浏览器 fixture | NOT RUN | AnswerDocument 有改动，旧证据仅作回归基线。 |
| PDF 生成、查看器选择与搜索 | NOT RUN | 需要浏览器和实际 PDF 查看器。 |
| Popup / Options 渲染 | NOT RUN | 需要浏览器渲染。 |
| 普通网页权限提示、文章页高亮与快捷键 | NOT RUN | 用户明确禁止打开浏览器；纯模型和注册 fixture 不能替代实际站点。 |
| 真实 ChatGPT 断流与 Composer/Connector | NOT RUN | 用户禁止真实 GPT 交互，且项目要求精确失败页证据。 |
| 真实 Notion 粘贴与公式编辑 | NOT RUN | 用户禁止打开浏览器；本地 MIME/HTML 不能替代真实目标。 |

## 结论边界

当前构建可以作为继续开发和后续一次性浏览器验收的 `0.5.4` 后端候选。它不能称为正式发布候选，也不能写入新的 `REAL_BROWSER_ACCEPTANCE=PASS`、`NOTION_NATIVE_EQUATIONS=PASS` 或当前构建的 PDF/Highlighter 浏览器 PASS。真实 ChatGPT 原生控件执行适配仍属于 MFC-402 缺口；这不否定 MFC-404 的离线授权后端证据，也不构成本地源码继续推进的阻塞。
