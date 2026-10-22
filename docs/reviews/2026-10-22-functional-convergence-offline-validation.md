# 0.5.8 功能收敛离线验证

`0.5.8` 把回答导出的语义链继续推进到表格内部。表格单元格现在保留有序 inline runs，单元格里的强调、行内代码、链接、引用和公式可以进入 Markdown、Notion 与 PDF；PDF 打印模型也会保留富文本语义，只允许 `http(s)` / `mailto` 链接成为可点击对象。

这仍是浏览器外的后端候选。本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。这里的 PASS 只证明离线合同、fail-open 行为、构建一致性和验收器抗伪造能力，不代表真实站点或查看器验收通过。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.8`
- 构建标签：`functional-convergence.9`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：33 项，其中 14 项 `IMPLEMENTED_VERIFIED`、14 项 `IMPLEMENTED_UNVERIFIED`、4 项 `BLOCKED_BY_REAL_EXTERNAL_DEPENDENCY`、1 项 `SUPERSEDED`

## 本轮主要推进

### 单回答 Mica actions

`ChatGPTAdapter.inspectAnswerActionTargets()` 只返回唯一、settled、`EXACT` 的 assistant target。`MicaAnswerActionsController` 在经过证明的原生 Copy 操作区旁挂载一个 32px `Mica actions` 入口，菜单只列当前可用动作，并按设置把默认格式排在首位。

控制器复用内容脚本已有 observer 的调度，不新增 observer、轮询或 typing listener，也不维护 ChatGPT selector。打开菜单后可用 Escape 或外部点击关闭；route change、remount、streaming、重复 Copy、设置关闭或合同失效都会移除 Mica UI。动作执行前再次核对 turn 和精确目标，非可信点击不会进入导出后端。

当前真实 ChatGPT action-cluster 合同仍未取得，因此 live 路径明确返回 `MISSING / current_site_contract_unproven`，不会把合成 fixture 当作真实 placement 证据。矩阵新增 MFC-025，并保留为 `IMPLEMENTED_UNVERIFIED`。

### PDF 与设置消费

单回答和完整会话 PDF 模型现在都接收 `pageSize` 与 `includeHighlights`。Letter 使用独立的 216mm × 279mm 页面尺寸和 print page rule；关闭 PDF 高亮后，模型不会保留已解析高亮或未解析计数。回答菜单还会消费默认导出格式和 Notion mode。

### 表格与 PDF 富文本保真

`AnswerDocument` 为每个表格单元格保留 `cellInlines`，同时继续保留纯文本 `rows` 供兼容路径使用。Markdown 与 Notion serializer 优先消费结构化单元格，因此公式、marks、行内代码、链接和引用不会在进入表格时丢失。

PDF model 继续使用同一份结构化数据，并把允许的 marks 与经过过滤的链接写入打印模型。表格选择投影与 PDF model 共用 `\t` / `\n` 逻辑分隔符，纯 Node 回归会从真实 `AnswerDocument` 表格选区生成锚点，再证明同一文本范围进入 PDF 高亮。打印页会为强调、斜体、删除线、行内代码、引用和图片占位添加明确语义样式；链接只接受 `http:`、`https:` 和 `mailto:`，`javascript:` 等 scheme 只保留可见文字，不生成可点击节点。

### 验收器

验收器升到 `1.11.0`。`conversation-export-completeness` gate 除完整性证明外，还绑定 AnswerDocument 表格结构、Markdown/Notion 表格公式、PDF inline 语义和危险链接过滤。新增反例会重新哈希一份伪造的表格保真结果；生产 validator 必须拒绝它。原有 `target-surface-backend` 的单回答入口、安全动作和 live fail-open 约束保持不变。

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run build` | PASS | 0.862 s | 生成版本一致的 `0.5.8` 到固定路径 `dist/mica-dev`；后续套件继续刷新同一路径 |
| `node scripts/conversation-export-fixture.mjs` | PASS | 0.121 s | 实际 AnswerDocument 表格解析、跨单元格高亮到 PDF、完整性证明、Markdown/Notion 表格公式、PDF 富文本模型/打印页、安全链接过滤 |
| `npm run test:answer-actions` | PASS | 1.161 s | 最终代码的重建、单回答入口、导出保真 fixture 与静态构建门禁 |
| `npm run test:convergence-core` | PASS | 2.393 s | 最终代码的全部非浏览器收敛回归，包括 target surfaces、导出、Reliability、普通网页模型和后台注册 |
| `node scripts/low-memory-background-fixture.mjs` | PASS | 0.409 s | Low Memory 动态注册、完整历史 bypass、恢复 claim 与隐私历史 |
| `node scripts/pdf-background-fixture.mjs` | PASS | 0.120 s | PDF 一次性本地 handoff、来源限制、伪造 consumer 和失败清理 |
| `npm run test:build` | PASS | 0.735 s | 版本、必需文件、导出语义 token、selector 边界、隐私和 typing hot path |
| `npm run acceptance:preflight` | PASS | 4.660 s | validator `1.11.0` 接受 10/10 正例，拒绝 46/46 反例，包括伪造表格保真结果 |

## 未运行

| 类别 | 状态 | 用时 | 原因 |
| --- | --- | ---: | --- |
| `npm test` | NOT RUN | 0 s | 命令包含隔离 Chromium fixture；用户明确要求本轮不打开浏览器。 |
| `npm run test:e2e` | NOT RUN | 0 s | 浏览器生命周期测试，本轮明确禁止。 |
| `npm run test:e2e:stress` | NOT RUN | 0 s | 浏览器压力测试，本轮明确禁止。 |
| Highlighter 浏览器 fixture | NOT RUN | 0 s | 需要隔离 Chromium 和页面选区交互。 |
| PDF 生成、查看器选择与搜索 | NOT RUN | 0 s | 需要浏览器和实际 PDF 查看器。 |
| Popup / Options 渲染 | NOT RUN | 0 s | 需要浏览器渲染。 |
| 普通网页权限提示、文章页高亮与快捷键 | NOT RUN | 0 s | 纯模型和注册 fixture 不能替代实际站点。 |
| 真实 ChatGPT 回答菜单、断流、原生控件与 suggested work | NOT RUN | 0 s | 用户禁止真实 GPT 交互，且项目要求精确合同证据。 |
| 真实 Notion 粘贴与公式编辑 | NOT RUN | 0 s | 本地 MIME/HTML 不能替代真实目标。 |

## 结论边界

`0.5.8` 已把表格内结构从“纯文本兼容值”推进为所有导出后端共用的语义数据，并为 PDF 链接加上独立的安全过滤。离线 fixture 与验收器覆盖了这一后端合同，但当前真实 action-cluster placement、系统剪贴板、PDF viewer、Notion 原生公式和浏览器焦点行为仍未验证。

这些缺口不是本轮整体阻塞：源码、`dist/mica-dev`、机器矩阵和离线门禁都可继续推进；它们只阻止把 `0.5.8` 称为发布候选或声称真实网站已经完成验收。
