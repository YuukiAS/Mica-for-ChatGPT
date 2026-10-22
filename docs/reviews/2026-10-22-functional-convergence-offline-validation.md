# 0.5.7 功能收敛离线验证

`0.5.7` 已补上单回答动作入口和导出设置的实际消费路径。每条 settled assistant answer 最多只有一个 `Mica actions` 入口，菜单复用现有 Markdown、Notion 和 PDF 后端；A4/Letter、PDF 是否包含高亮、默认动作顺序和 Notion disabled 也不再是只保存、不生效的设置。

这仍是浏览器外的后端候选。本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。这里的 PASS 只证明离线合同、fail-open 行为、构建一致性和验收器抗伪造能力，不代表真实站点或查看器验收通过。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.7`
- 构建标签：`functional-convergence.8`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：33 项，其中 14 项 `IMPLEMENTED_VERIFIED`、14 项 `IMPLEMENTED_UNVERIFIED`、4 项 `BLOCKED_BY_REAL_EXTERNAL_DEPENDENCY`、1 项 `SUPERSEDED`

## 本轮主要推进

### 单回答 Mica actions

`ChatGPTAdapter.inspectAnswerActionTargets()` 只返回唯一、settled、`EXACT` 的 assistant target。`MicaAnswerActionsController` 在经过证明的原生 Copy 操作区旁挂载一个 32px `Mica actions` 入口，菜单只列当前可用动作，并按设置把默认格式排在首位。

控制器复用内容脚本已有 observer 的调度，不新增 observer、轮询或 typing listener，也不维护 ChatGPT selector。打开菜单后可用 Escape 或外部点击关闭；route change、remount、streaming、重复 Copy、设置关闭或合同失效都会移除 Mica UI。动作执行前再次核对 turn 和精确目标，非可信点击不会进入导出后端。

当前真实 ChatGPT action-cluster 合同仍未取得，因此 live 路径明确返回 `MISSING / current_site_contract_unproven`，不会把合成 fixture 当作真实 placement 证据。矩阵新增 MFC-025，并保留为 `IMPLEMENTED_UNVERIFIED`。

### PDF 与设置消费

单回答和完整会话 PDF 模型现在都接收 `pageSize` 与 `includeHighlights`。Letter 使用独立的 216mm × 279mm 页面尺寸和 print page rule；关闭 PDF 高亮后，模型不会保留已解析高亮或未解析计数。回答菜单还会消费默认导出格式和 Notion mode。

### 验收器

验收器升到 `1.10.0`。既有 `target-surface-backend` gate 现在同时约束单回答入口的唯一性、可信手势、streaming/歧义 fail-open、remount、设置清理和“当前实站合同缺失时不注入”。新增反例会重新哈希一份伪造的多入口证据；生产 validator 必须拒绝它。

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `node scripts/answer-actions-controller-fixture.mjs` | PASS | 0.223 s | 精确 target、单入口、菜单动作、默认排序、可信手势、streaming/歧义、remount、开关和 live fail-open |
| `node scripts/conversation-export-fixture.mjs` | PASS | 0.131 s | 完整性证明、会话 Markdown/PDF、高亮偏移、A4/Letter 与 PDF 高亮开关 |
| `node scripts/target-surface-backend-fixture.mjs` | PASS | 0.459 s | 回答入口、恢复控件与 suggested-work 的聚合门禁；页面可写 fixture 标记不能授权回答入口 |
| `npm run build` | PASS | 0.311 s | 生成 `0.5.7` 的 `dist/mica-dev`；最终纯 Node 收敛套件又刷新一次相同构建 |
| `npm run test:answer-actions` | PASS | 1.198 s | 最终安全边界修正后的构建、回答入口 fixture、PDF 设置 fixture 与静态门禁 |
| `npm run test:convergence-core`，Low Memory/PDF 后台 fixture，`npm run test:build`，首次 preflight | PASS/PASS/PASS/预检合同漂移 | 10.0 s（组合批次） | 全部非浏览器核心回归；首次 preflight 精确定位到 `acceptance/contracts.json` 仍为 `1.9.0` |
| `npm run test:build` 独立静态门禁 | PASS | 0.226 s | 版本、脚本顺序、必需文件、adapter/controller selector 边界、隐私和 typing hot path |
| `npm run acceptance:preflight` 最终重跑 | PASS | 5.115 s | validator `1.10.0` 接受 10/10 正例，拒绝 45/45 反例；validator tree 绑定全部 target-surface fixture |

首次 preflight 的唯一失败是 validator 代码与 `acceptance/contracts.json` 的版本号不同步。同步为 `1.10.0` 后，最终预检通过；没有为通过测试而放宽 gate 或删除反例。

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

`0.5.7` 把“单回答导出只有选择工具条路径”和“导出设置部分闲置”推进为可安装构建中的正式后端。离线 fixture 与验收器已经覆盖安全边界，但当前真实 action-cluster placement、系统剪贴板、PDF viewer、Notion 原生公式和浏览器焦点行为仍未验证。

这些缺口不是本轮整体阻塞：源码、`dist/mica-dev`、机器矩阵和离线门禁都可继续推进；它们只阻止把 `0.5.7` 称为发布候选或声称真实网站已经完成验收。
