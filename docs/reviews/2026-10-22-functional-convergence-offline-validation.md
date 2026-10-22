# 0.5.5 功能收敛离线验证

`0.5.5` 的本地后端、构建身份和纯 Node 回归已经通过。ChatGPT 与普通网页高亮现在共用一套交互策略，设置中的默认颜色、快捷键和工具条行为不再只是存储字段；composer context、assistant 进展、工具安全和 reload 安全也已收口到 `ChatGPTAdapter`，Reliability controller 不再自行查询页面结构。恢复后端继续保留原生 Stop、assistant retry 和确认未提交 resend 的精确证据授权、次数限制、settle/backoff 和跨 Service Worker 重启去重。真实 ChatGPT 控件适配仍未接入。本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。因此，这份记录证明的是离线实现与构建一致性，不是完整产品验收。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.5`
- 构建标签：`functional-convergence.6`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.json`

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run test:highlight-interaction` | PASS | 0.885 s | 快捷键规范化、危险组合拒绝、三种交互模式、默认颜色路由和 repeat/IME 保护 |
| `npm run test:adapter-recovery` | PASS | 1.053 s | property-backed composer、敏感/有副作用上下文、无正文进展签名、工具安全、reload fail-closed，以及 controller 只消费 adapter 观察 |
| `npm run test:convergence-core` | PASS | 1.924 s | 构建、schema v6 迁移、受约束快捷键、adapter recovery 观察、Markdown/Notion、完整会话导出、两类高亮记录、普通网页锚点与动态注册、Reliability 状态机、三类精确动作授权、后台 claim、隐私历史和 controller 持久化 |
| `node scripts/low-memory-background-fixture.mjs` | PASS | 0.447 s | 新策略代码进入 Service Worker bundle 后，注册串行化、存储失败 fail-open、full-history 状态、后台恢复与原生动作 claim 的 Worker 重启去重仍通过 |
| `node scripts/pdf-background-fixture.mjs` | PASS | 0.199 s | 后台脚本整合后仍保持可信来源、一次性传递、伪造 consumer 拒绝和失败清理 |
| `npm run build` | PASS | 0.851 s | 最终刷新固定开发路径 `dist/mica-dev` |
| `npm run test:build` | PASS | 0.680 s | `0.5.5` 版本一致性、策略脚本顺序、设置页字段、adapter-only recovery 选择器门禁、权限边界、必需文件、需求矩阵、静态语法、隐私字段和两个快捷键 hot path 禁止项 |
| `npm run acceptance:preflight` | PASS | 4.351 s | 验收器 `1.8.0` 接受 9/9 正例，拒绝 43/43 反例，包括重哈希后的错 turn 动作授权 |
| 矩阵 JSON 解析 | PASS | < 0.1 s | 机器可读矩阵语法与状态计数 |

`test:convergence-core` 输出还确认：旧 schema 的 `selection` 默认值迁移为 `both`，`control+shift+k` 规范化为 `Ctrl+Shift+K`，不安全组合回退到默认值；Notion 回归样本得到 5 个有序行内公式，原生公式状态保持 `UNVERIFIED`；提交 A/B/C、首次/第二次刷新、刷新上限、只读/有副作用工具、tab 隔离和无正文历史全部通过纯状态验证。controller fixture 进一步确认首次发现的 settled answer 会直接结束恢复，不会等待到误刷新；未知提交会保留草稿供用户手动复制，未知工具状态会转入人工处理且不增加刷新次数，关闭 Reliability 会取消旧恢复状态，活跃恢复中的草稿也不能被第二个发送意图替换。

高亮快捷键只在配置允许且目标不可编辑时进入一次合并的 animation frame；同步 `keydown` 路径不读取选区、不枚举 turn、不访问 storage，也不执行布局计算。frame 内的 ChatGPT 路径仍通过 adapter 与 AnswerDocument 建立锚点，普通网页路径仍通过语义根模型建立锚点，然后直接使用配置的默认颜色。快捷键与选区工具条没有引入第二套记录格式。首次组合回归只因旧 fixture 把 schema 固定为 5 而失败；审计全部残留版本断言并更新为 6 后，最终组合回归通过。

`ChatGPTAdapter` 新增三类只读观察：composer recovery context、assistant turn recovery observation 和 reload safety。进展签名仅保留 FNV-1a 哈希、标准化长度和工具阶段计数；fixture 明确检查签名不含回答文本。未知工具保持 `unknown`，有副作用标记优先进入 `consequential`；找不到 composer 时禁止 reload。controller fixture 中的伪 DOM selector 会主动抛错，而整个恢复流程仍通过，证明 controller 的观察路径确实经过 adapter。真实 lifecycle/tool capability 仍按当前合同标为 `UNKNOWN`，所以这些 live 观察最多是 `PARTIAL`，不冒充 MFC-402 所需的精确控件证据。

`RecoveryActionPolicy` 只接受 10 秒内的 `EXACT` 证据，并同时核对 recovery、scope、subject 和 native-control hash。原生 Stop、assistant retry、confirmed resend 都只能取得一次授权；错误 turn、错误 scope、陈旧证据、未知工具和有外部副作用工具均被拒绝。Stop 成功后按设置等待 settle，再决定是否第二次刷新；retry/resend 使用设置的 backoff。controller 必须先取得后台 claim，执行器还要回传同一 action ID，否则转入人工处理。普通内容运行时没有真实控件执行器，因此不会在没有 live contract 时猜测点击或提交。

`RecoveryLedger` 由 Service Worker 统一管理。自动刷新和三类原生动作都要先取得由 recovery、scope、sequence、ordinal 以及动作/控件身份绑定的一次性 claim；相同 claim 在 Worker 重启后仍被拒绝，其他标签页不受影响，过期项可清理重建。隐私历史的并发追加由后台串行化，相同事件只记录一次，最多保留 50 条，并明确删除草稿、prompt 和原始 conversation ID。存储层不可用时，控制器进入人工处理，不会退化成未去重动作。

普通网页高亮的纯模型验证覆盖 exact-origin 规范化、ChatGPT 排除、上下文消歧、内容位移恢复、重复文本 fail-open、页面和语义根隔离、绝对 DOM 路径拒绝，以及本地记录导入导出。后台 fixture 证明只有浏览器已经授权的 origin 会进入动态注册，拒绝授权的 origin 不会注入；权限撤销会注销脚本，权限恢复可重新注册，功能关闭也会注销。上述结果不等于文章页中的实际 CSS Highlight 绘制和交互已经通过。

## 未运行

| 类别 | 状态 | 原因 |
| --- | --- | --- |
| `npm test` | NOT RUN | 包含隔离 Chromium fixture；用户明确要求本轮不打开浏览器。 |
| `npm run test:e2e` | NOT RUN | 浏览器生命周期测试，本轮明确禁止。 |
| `npm run test:e2e:stress` | NOT RUN | 浏览器压力测试；同时当前阶段没有新的已验收浏览器候选可供压力定稿。 |
| Highlighter 浏览器 fixture | NOT RUN | 本轮新增真实按键与选区接线，旧证据仅作回归基线。 |
| PDF 生成、查看器选择与搜索 | NOT RUN | 需要浏览器和实际 PDF 查看器。 |
| Popup / Options 渲染 | NOT RUN | 需要浏览器渲染。 |
| 普通网页权限提示、文章页高亮与快捷键 | NOT RUN | 用户明确禁止打开浏览器；纯模型和注册 fixture 不能替代实际站点。 |
| 真实 ChatGPT 断流与 Composer/Connector | NOT RUN | 用户禁止真实 GPT 交互，且项目要求精确失败页证据。 |
| 真实 Notion 粘贴与公式编辑 | NOT RUN | 用户禁止打开浏览器；本地 MIME/HTML 不能替代真实目标。 |

## 结论边界

当前构建可以作为继续开发和后续一次性浏览器验收的 `0.5.5` 后端候选。MFC-203 的交互策略、设置消费和 hot-path 约束已有离线证据，但真实键盘事件、IME、CSS Highlight 绘制和页面选区仍分别受 MFC-200/MFC-202 的浏览器验收约束。它不能称为正式发布候选，也不能写入新的 `REAL_BROWSER_ACCEPTANCE=PASS`、`NOTION_NATIVE_EQUATIONS=PASS` 或当前构建的 PDF/Highlighter 浏览器 PASS。真实 ChatGPT 原生控件执行适配仍属于 MFC-402 缺口；这不否定 MFC-404 的离线授权后端证据，也不构成本地源码继续推进的阻塞。
