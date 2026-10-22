# 0.5.11 功能收敛离线验证

`0.5.11` 补齐了设置和高亮备份的本地导入边界。文件会在读取正文前检查体积，设置导入拒绝未来 schema，高亮组合备份使用精确的 v2 envelope 和分类型记录上限；旧的单类高亮文件继续兼容，混装文件则默认拒绝。`0.5.10` 已完成的高亮字段白名单和 annotation 清洗、`0.5.9` 已建立的安全 MathML PDF 路径保持不变。

这仍是浏览器外的后端候选。本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。这里的 PASS 只证明离线合同、fail-open 行为、构建一致性和验收器抗伪造能力，不代表真实站点或查看器验收通过。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.11`
- 构建标签：`functional-convergence.12`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：33 项，其中 14 项 `IMPLEMENTED_VERIFIED`、14 项 `IMPLEMENTED_UNVERIFIED`、4 项 `BLOCKED_BY_REAL_EXTERNAL_DEPENDENCY`、1 项 `SUPERSEDED`

## 本轮主要推进

### 本地导入边界

设置 JSON 最多接受 256 KiB，高亮组合备份最多接受 40 MiB。Options 页面通过统一的 `MicaLocalImportModel.readFile()` 读取文件；体积超限时不会调用 `File.text()`。各高亮模型还会在解析后限制源数组为最多 1,000 条，避免小体积、超多空对象的输入拖入无界清洗循环。

组合高亮备份只接受 `schemaVersion`、`exportedAt`、`chatgptRecords` 和 `generalWebRecords` 这 4 个字段，版本必须为 2。未知字段、无效时间戳、未来版本和缺少任一记录数组都会失败。旧 ChatGPT 或普通网页单类备份仍可导入，但同一旧文件混装两种记录会被拒绝，避免按首个 ID 猜测类型。合并规则固定为：导入记录覆盖现有同 ID 记录；导入文件内部重复 ID 时，第一条有效记录生效。

### 高亮记录完整性

ChatGPT 与普通网页模型都新增 `withAnnotation()`。备注最多 2,000 字符；标签最多 16 个，每个最多 64 字符，并会清理首尾空白、压缩内部空格和按大小写不敏感去重。当前只提供后端接口，没有新增备注编辑 UI，也没有增加云同步或外部服务。

旧 schema v1 记录缺少 annotation 时会迁移为 `{ note: "", tags: [] }`。ChatGPT 导入路径原先会展开未知顶层和锚点字段，现在改为逐项重建允许字段；两类模型的换色、resolution 和 annotation helper 都会先重新清洗记录。超长记录身份、不合理 source offset 以及完全无效的导入会被拒绝。

新的纯 Node fixture 向两类记录注入顶层 prompt/token、整页正文、原始 DOM、未知锚点和未知 annotation 字段，再验证本地记录、变更 helper 和 JSON 导出都不含这些字段。该 fixture 不读取真实页面内容，也不启动浏览器。

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

验收器升到 `1.14.0`。新增 `local-import-integrity` gate，把读取前体积检查、未来 schema 拒绝、精确组合 envelope、记录数量预算、旧文件兼容和确定性冲突规则绑定到独立证据文件。控制语料新增重新哈希的伪导入预算结果；生产 validator 必须拒绝它。原有高亮字段清洗、完整会话、MathML、单回答入口、安全动作和实站默认失败约束保持不变。

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run test:local-import-integrity` | PASS | 0.979 s | 构建后验证读取前预算、schema/envelope、两类记录上限、旧文件兼容、混装拒绝与冲突规则 |
| `node scripts/convergence-core-fixture.mjs` + `node scripts/highlight-record-integrity-fixture.mjs` | PASS | 0.274 s | 受影响的既有设置与高亮记录回归 |
| `npm run test:convergence-core` | PASS | 2.590 s | 最终代码的全部非浏览器收敛回归；首步重建版本一致的 `dist/mica-dev` |
| `npm run test:build` | PASS | 0.781 s | 版本、必需文件、本地导入模型、selector 边界、隐私和 typing hot path |
| `npm run build` | PASS | 0.824 s | 生成版本一致的 `0.5.11` 到固定路径 `dist/mica-dev` |
| `npm run acceptance:preflight` | PASS | 5.430 s | validator `1.14.0` 接受 12/12 正例，拒绝 49/49 反例，包括伪造导入预算结果 |

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

`0.5.11` 已把本地导入从“选择文件后直接读取和解析”推进为“读取前限额、解析后限量、版本与 envelope 明确、旧格式兼容但不猜测混装类型”。离线 fixture 与验收器证明了这些本地边界，但没有运行实际文件选择器，也没有改变既有浏览器、PDF 或真实站点验收结论。

这些缺口不是本轮整体阻塞：源码、`dist/mica-dev`、机器矩阵和离线门禁都可继续推进；它们只阻止把 `0.5.11` 称为发布候选或声称真实 PDF、ChatGPT、普通网页与 Notion 已经完成验收。
