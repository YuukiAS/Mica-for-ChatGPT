# 0.5.3 功能收敛离线验证

`0.5.3` 的本地后端、构建身份和纯 Node 回归已经通过；本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。因此，这份记录证明的是离线实现与构建一致性，不是完整产品验收。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.3`
- 构建标签：`functional-convergence.4`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.json`

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run test:convergence-core` | PASS | 1.698 s | 重建、设置迁移和上限、Markdown/Notion、完整会话导出、两类高亮记录、普通网页锚点与动态注册、Reliability 状态机、后台动作租约、隐私历史和 controller 持久化 |
| `node scripts/recovery-ledger-fixture.mjs` | PASS | 0.289 s | 首次租约、重复拒绝、Service Worker 重启、多标签页隔离、TTL、存储失败、历史去重和隐私边界 |
| `node scripts/low-memory-background-fixture.mjs` | PASS | 0.570 s | 注册串行化、存储失败 fail-open、full-history 状态、后台恢复租约及历史去重 |
| `node scripts/pdf-background-fixture.mjs` | PASS | 0.292 s | 后台脚本整合后仍保持可信来源、一次性传递、伪造 consumer 拒绝和失败清理 |
| `npm run test:build` | PASS | 0.888 s | 版本、权限边界、后台 ledger、必需文件、需求矩阵、静态语法、隐私字段和 typing hot-path 禁止项 |
| `npm run acceptance:preflight` | PASS | 4.134 s | 验收器 `1.7.0` 接受 8/8 正例，拒绝 42/42 反例 |
| 矩阵 JSON 解析 | PASS | < 0.1 s | 机器可读矩阵语法与状态计数 |

`test:convergence-core` 输出还确认：Notion 回归样本得到 5 个有序行内公式；Notion 原生公式状态保持 `UNVERIFIED`；提交 A/B/C、首次/第二次刷新、刷新上限、只读/有副作用工具、tab 隔离和无正文历史全部通过纯状态验证。controller fixture 进一步确认首次发现的 settled answer 会直接结束恢复，不会等待到误刷新；未知提交会保留草稿供用户手动复制，未知工具状态会转入人工处理且不增加刷新次数，关闭 Reliability 会取消旧恢复状态，活跃恢复中的草稿也不能被第二个发送意图替换。

新增的 `RecoveryLedger` 由 Service Worker 统一管理。每次自动刷新都要先取得由 recovery、scope、sequence 和 ordinal 绑定的一次性租约；相同租约在 Worker 重启后仍被拒绝，其他标签页不受影响，过期租约可清理重建。隐私历史的并发追加由后台串行化，相同事件只记录一次，最多保留 50 条，并明确删除草稿、prompt 和原始 conversation ID。存储层不可用时，控制器进入人工处理，不会退化成未去重刷新。

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

当前构建可以作为继续开发和后续一次性浏览器验收的 `0.5.3` 后端候选。它不能称为正式发布候选，也不能写入新的 `REAL_BROWSER_ACCEPTANCE=PASS`、`NOTION_NATIVE_EQUATIONS=PASS` 或当前构建的 PDF/Highlighter 浏览器 PASS。缺口已经逐项写入功能收敛矩阵，不构成本地源码继续推进的阻塞。
