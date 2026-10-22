# 0.5.0 功能收敛离线验证

`0.5.0` 的本地后端、构建身份和纯 Node 回归已经通过；本轮没有启动任何浏览器，也没有访问真实 ChatGPT、Notion 或 PDF 查看器。因此，这份记录证明的是离线实现与构建一致性，不是完整产品验收。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.0`
- 构建标签：`functional-convergence.1`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.json`

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run test:convergence-core` | PASS | 1.326 s | 重建、设置迁移和上限、Markdown/Notion、五公式样本、高亮记录、Reliability 状态机、controller 持久化与恢复 |
| `node scripts/low-memory-background-fixture.mjs` | PASS | 0.499 s | 注册串行化、存储失败 fail-open、禁用、service worker 重启后的 full-history 状态 |
| `node scripts/pdf-background-fixture.mjs` | PASS | 0.243 s | 可信来源、一次性本地传递、伪造 consumer 拒绝、失败清理 |
| `npm run test:build` | PASS | 0.846 s | 版本、manifest、脚本顺序、必需文件、需求矩阵、静态语法、隐私字段和 typing hot-path 禁止项 |
| 矩阵 JSON 解析 | PASS | < 0.1 s | 机器可读矩阵语法 |

`test:convergence-core` 输出还确认：Notion 回归样本得到 5 个有序行内公式；Notion 原生公式状态保持 `UNVERIFIED`；提交 A/B/C、首次/第二次刷新、刷新上限、只读/有副作用工具、tab 隔离和无正文历史全部通过纯状态验证。controller fixture 进一步确认首次发现的 settled answer 会直接结束恢复，不会等待到误刷新；未知提交会保留草稿供用户手动复制，未知工具状态会转入人工处理且不增加刷新次数，关闭 Reliability 会取消旧恢复状态。

## 未运行

| 类别 | 状态 | 原因 |
| --- | --- | --- |
| `npm test` | NOT RUN | 包含隔离 Chromium fixture；用户明确要求本轮不打开浏览器。 |
| `npm run test:e2e` | NOT RUN | 浏览器生命周期测试，本轮明确禁止。 |
| `npm run test:e2e:stress` | NOT RUN | 浏览器压力测试；同时当前阶段没有新的已验收浏览器候选可供压力定稿。 |
| Highlighter 浏览器 fixture | NOT RUN | AnswerDocument 有改动，旧证据仅作回归基线。 |
| PDF 生成、查看器选择与搜索 | NOT RUN | 需要浏览器和实际 PDF 查看器。 |
| Popup / Options 渲染 | NOT RUN | 需要浏览器渲染。 |
| 真实 ChatGPT 断流与 Composer/Connector | NOT RUN | 用户禁止真实 GPT 交互，且项目要求精确失败页证据。 |
| 真实 Notion 粘贴与公式编辑 | NOT RUN | 用户禁止打开浏览器；本地 MIME/HTML 不能替代真实目标。 |

## 结论边界

当前构建可以作为继续开发和后续一次性浏览器验收的 `0.5.0` 后端候选。它不能称为正式发布候选，也不能写入新的 `REAL_BROWSER_ACCEPTANCE=PASS`、`NOTION_NATIVE_EQUATIONS=PASS` 或当前构建的 PDF/Highlighter 浏览器 PASS。缺口已经逐项写入功能收敛矩阵，不构成本地源码继续推进的阻塞。
