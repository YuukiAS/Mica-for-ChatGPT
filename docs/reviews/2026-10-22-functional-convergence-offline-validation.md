# 0.5.9 功能收敛离线验证

`0.5.9` 补上了 PDF 数学输出中的后端断点。`AnswerDocument` 不再只保存公式的原始 TeX 和渲染文本；遇到可识别的 KaTeX、MathJax 或原生 MathML 时，它会提取有边界的安全 MathML AST。PDF model 再次验证这棵树，打印页通过 MathML 命名空间 DOM 重建公式。没有可靠语义树、树不安全，或局部高亮无法精确映射时，仍保留可见 TeX 降级。

这仍是浏览器外的后端候选。本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。这里的 PASS 只证明离线合同、fail-open 行为、构建一致性和验收器抗伪造能力，不代表真实站点或查看器验收通过。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.9`
- 构建标签：`functional-convergence.10`
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

### MathML 语义输出

MathML 提取只接受明确的 presentation MathML 标签和有限属性，并设置 32 层深度、512 个节点和 4096 字符的上限。`annotation` 不会进入 AST，原始 TeX 仍由独立字段保存。PDF model 不信任 `AnswerDocument` 的输入，会重新应用同样的边界；打印页又独立执行标签、属性和资源预算检查，不使用 `innerHTML`。

没有高亮或整段公式被同一高亮覆盖时，打印页重建语义 MathML。高亮只覆盖公式局部时，当前数据模型还没有 TeX token 到 MathML 子树的可靠映射，因此该公式明确退回可见 TeX，以保留逻辑偏移和颜色位置。这个降级会记录为 `text-fallback-partial-highlight`，非法或过深的树则记录为 `text-fallback-invalid-mathml`，不会静默伪装成语义渲染成功。

### 验收器

验收器升到 `1.12.0`。`conversation-export-completeness` gate 除完整性证明、表格结构和链接安全外，还绑定 MathML 捕获、模型传递、命名空间 DOM 重建、非法树拒绝、资源预算以及局部高亮降级。控制语料增加一份重新哈希的伪语义渲染结果；生产 validator 必须拒绝它。原有单回答入口、安全动作和实站默认失败约束保持不变。

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run build` | PASS | 1.065 s | 生成版本一致的 `0.5.9` 到固定路径 `dist/mica-dev` |
| `node scripts/conversation-export-fixture.mjs` | PASS | 0.192 s | KaTeX 与非 `HTMLElement` 原生 MathML 捕获、双重过滤、打印页重建、局部高亮降级、过深树拒绝，以及原有表格和完整会话导出合同 |
| `npm run test:answer-actions` | PASS | 1.368 s | 最终代码的重建、单回答入口、导出专项与静态构建门禁 |
| `npm run test:convergence-core` | PASS | 2.699 s | 最终代码的全部非浏览器收敛回归，包括 target surfaces、导出、Reliability、普通网页模型和后台注册 |
| `npm run test:build` | PASS | 1.044 s | 版本、必需文件、MathML 安全边界、selector 边界、隐私和 typing hot path |
| `npm run acceptance:preflight` | PASS | 6.199 s | validator `1.12.0` 接受 10/10 正例，拒绝 47/47 反例，包括伪造 MathML 语义渲染结果 |

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

`0.5.9` 已把 PDF 数学从统一的“可见 TeX”推进为“安全 MathML 优先、明确 TeX 降级”。离线 fixture 与验收器证明了数据提取、模型传递、安全过滤和 DOM 重建合同，但没有证明具体浏览器的 MathML 排版质量，也没有证明保存后的 PDF 能正确搜索、选择和复制公式。

这些缺口不是本轮整体阻塞：源码、`dist/mica-dev`、机器矩阵和离线门禁都可继续推进；它们只阻止把 `0.5.9` 称为发布候选或声称真实 PDF、ChatGPT 与 Notion 已经完成验收。
