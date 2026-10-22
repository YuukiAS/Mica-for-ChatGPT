# Mica for ChatGPT

Mica 是一个本地运行的 Chromium 浏览器扩展，面向需要长期使用 ChatGPT 长对话、整理回答和控制客户端资源占用的人。当前 `0.5.11` 开发候选把既有 Foundation、Low Memory、ChatGPT 高亮和 PDF 管线，与统一设置、Markdown/Notion 序列化、完整会话导出、有备注/标签扩展位且严格清洗的高亮记录、有边界的本地导入、可靠性恢复后端、按站点授权的普通网页高亮及受合同约束的页面控制适配整合到同一构建中。

当前开发候选是 `0.5.11`（`functional-convergence.12`）。Low Memory 会在 ChatGPT 解码、渲染超长 conversation 之前，把客户端历史限制为最近 40 个可见 turns，并保留必要的 system/tool 依赖与近期 branch。服务器历史不会修改；`Load full history`、关闭 Low Memory 或移除扩展后，刷新页面即可回到 ChatGPT 原生完整历史。未知数据结构保持原样并 fail-open。

这仍是未发布的开发候选。既有 Low Memory、Highlighter 和 PDF 证据来自重建候选；`0.5.11` 新整合后的浏览器回归、真实登录态 ChatGPT、普通文章页、PDF 查看器和 Notion 验收尚未运行，不能把历史证据当作当前构建的完整验收。逐项状态见 [`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.md`](docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.md)。

## 安装开发版

固定的 unpacked extension 路径是：

```text
D:\Code\Mica-for-ChatGPT\dist\mica-dev
```

重新构建：

```bash
npm run build
```

在 Chrome 或 Edge 中安装：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked，选择 `D:\Code\Mica-for-ChatGPT\dist\mica-dev`。
4. 后续更新只需重新构建，在扩展管理页点击 Reload，再刷新 ChatGPT 页面。

## 当前开发版包含什么

弹窗只显示用户需要判断的信息：当前页面是否受支持、Low Memory 是否可用、完整会话能否安全导出、页面健康状态，以及 Troubleshooting 入口。开发诊断已经移到单独的 Developer QA 页面，不再把 selector、mounted counter、开始/停止诊断按钮或旧 Surface Atlas 状态塞进普通界面。

当前 runtime 包括：

- 一个按 capability 判断 `EXACT`、`COMPATIBLE` 或 `UNKNOWN` 的 `ChatGPTAdapter`；除 AnswerDocument 外，它也统一负责 composer context、assistant 进展、工具安全和 reload 安全观察，Reliability controller 不再维护第二套 ChatGPT selector。结构不明时停用相关集成，让 ChatGPT 保持原生行为。
- 一个由 adapter 唯一生成的 `AnswerDocument`，保留 ordered blocks、streaming/settled 状态、版本身份、源码区间，以及文本、列表、表格、代码、链接、引用、图片和行内/展示数学。表格单元格还保留有序 inline runs，不再把其中的强调、代码、链接和公式压成纯文本。
- 单回答 `Mica actions` 后端：每个 settled assistant answer 最多只允许一个入口，菜单按设置提供 Markdown、Notion 和 PDF。入口只接受 adapter 证明的唯一 `EXACT` 原生操作区，点击动作前还会重新核对 turn；streaming、歧义、remount 或合同缺失时立即移除。当前真实 ChatGPT 操作区尚无精确合同，所以实站暂不注入，合成 fixture 不能冒充 live 支持。
- 独立的 Troubleshooting 与 Developer QA 页面。导出的诊断只包含结构状态、版本和 contract 身份，不包含对话正文、附件内容、请求 body、认证 token 或原始 DOM。
- 真正的数据层 Low Memory：同时覆盖当前 React Router turbo-stream hydration 与受严格形状保护的 conversation JSON fallback。实现会压缩不可达的历史数据，而不是删除 React 管理的 DOM 或只设置 `content-visibility`。
- ChatGPT 回答高亮：选择文字后出现短暂工具条，可保存 4 种本地颜色；设置页可选择默认颜色、快捷键以及“选区工具条 / 快捷键 / 两者同时”三种交互方式。快捷键直接应用默认颜色，重复按键与 IME composition 会被忽略，真正的选区映射延后到 animation frame。锚点跨正文与数学，支持刷新、remount 和等价数学重排恢复；重复或缺失文本不会被猜测性附着。ChatGPT 与普通网页记录都预留了本地 `annotation.note` / `annotation.tags` 后端接口，旧记录会迁移为空 annotation；本版没有增加备注编辑界面。
- 默认关闭的普通网页高亮：只在设置页按 exact origin 请求可选权限，使用语义根与文本上下文恢复四种本地高亮，并与 ChatGPT 高亮共用同一套默认颜色、快捷键和交互策略；不保存整页正文，不能唯一解析时不附着。浏览器与文章页交互尚未验收。
- 本地 PDF 导出：从 settled `AnswerDocument` 与高亮模型生成可打印 A4 或 Letter 页面，并按设置决定是否带入高亮。支持的 KaTeX、MathJax 或原生 MathML 会先转换成有节点、深度和文本预算的安全 AST，再由打印页使用 MathML 命名空间重建；结构不支持或局部高亮无法精确映射时才明确退回可见 TeX。表格选择与 PDF 共用行/单元格逻辑分隔符，跨单元格高亮按文本偏移继承；打印模型也保留强调、删除线、行内代码、引用和安全链接。实际 PDF 中的 MathML 排版、选择和搜索仍待查看器验收。
- Markdown 与 Notion 数据路径：从同一 settled `AnswerDocument` 生成 GFM/标准 Markdown、可配置数学分隔符、Notion rich clipboard 数据或确定性 Markdown 导入文件；表格单元格内的公式和格式也走同一序列化路径。真实 Notion 原生公式仍明确标为未验证。
- 完整会话导出：Low Memory 在窗口化前生成不含正文的计数与角色顺序证明；加载完整历史后，协调器逐项核对 conversation 身份、turn 数量、角色顺序、稳定 ID 和 settled 状态，验证通过后才允许复制整段 Markdown 或生成整段 PDF。局部窗口、旧会话证明、streaming 回答和调用方伪造的完成布尔值都会被拒绝。
- 一套版本化设置模型与完整 Options 页面：schema v6 会把旧版未生效的高亮交互默认值迁移成“工具条 + 快捷键”，并提供设置迁移、分组恢复默认、高亮记录和设置的本地导入导出，以及 Low Memory、导出和 Reliability 安全上限。导入文件会在读取正文前检查体积；设置 JSON 上限为 256 KiB，高亮组合备份上限为 40 MiB。组合备份必须使用精确的 v2 envelope，两类记录还各有 1,000 条源记录上限；旧的单类备份继续兼容，但混装两类旧记录会默认拒绝。回答菜单的默认动作顺序、Notion 可用性、PDF 纸张和高亮开关均已接入运行时消费端。
- 一套统一的 Reliability 状态机：区分已提交、未提交和未知提交状态，按 adapter 提供的正文哈希与工具阶段计时，最多执行两次恢复刷新，并在未知工具、外部副作用、切换 conversation、切换 tab 或用户主动停止时终止自动流程。刷新、原生 Stop、assistant retry 和确认未提交后的 resend 共用一次性后台 claim；后三类动作还必须提供新鲜、精确且与 recovery、scope、turn 和原生控件身份一致的证据。新的控件适配器会在动作前再次核对 subject 与 control identity；当前真实 ChatGPT 控件合同仍是 `UNKNOWN`，因此真实页面保持原生，不会猜测点击或提交。隐私历史也由后台串行去重，不保存草稿、prompt、回答正文或原始 conversation ID。
- `Hide suggested work` 设置已经接入可逆控制器。只有 `ChatGPTAdapter` 返回唯一 `EXACT` 表面时才会添加 `hidden`、`inert` 和 `aria-hidden`，关闭功能、结构歧义或节点替换时恢复原状态。当前真实目标结构尚未取得精确合同，所以真实页面暂时不隐藏任何内容。
- Developer QA 的去敏报告增加了 composer 附近及最新 assistant turn 的有界结构候选、语义分类和属性指纹，不包含建议文本、回答正文或原始 DOM，用于以后一次性取得 MFC-402/MFC-420 所需合同。
- 固定开发路径 `dist/mica-dev`，manifest、弹窗、设置页和诊断报告均显示 `0.5.11`。

旧的 composer recovery、connector continuity、send residual recovery、页面状态点和 containment runtime 仍未重新并行启用。新 Reliability 后端只监听可信的提交动作和结构变化，不在普通键入事件里扫描或克隆 DOM。历史源码和失败 fixture 继续保留，等待真实页面精确合同后再迁移必要行为。

## Low Memory 的候选证据

低内存长对话截断仍是 `0.3.0` 的硬性发布条件，不会降级成 `Native handling`、no-op 或 diagnostics only。当前实现已经在客户端限制长 thread 的实际数据保留与渲染输入，同时不修改或删除服务器历史。

候选版需要在同一 workload 下比较：

```text
A = Mica absent/disabled
B = Mica installed, Low Memory disabled
C = Mica installed, Low Memory enabled
```

验收会覆盖 short、medium、long thread，最近消息保留窗口，mounted DOM、JS heap 或 browser process memory、mutation、scroll/typing latency、上滑恢复、完整历史加载、reload、关闭或禁用 Mica 后恢复，以及 composer、send、streaming、edit、branch、connector、tool/file/auth 和 typing/IME hot path。C 必须在目标低内存环境中对 A/B 产生可重复的额外收益，才允许写入：

```text
LOW_MEMORY_TRUNCATION=PASS
```

当前 256 MB V8 old-space 压力 workload 使用 800 turns、约 100 MiB UTF-16 retained content，重复 3 次。最终候选中位数结果为：A/B 保留 801 个 mapping nodes 和约 100 MiB 内容，C 保留 41 个 nodes（40 个最近 turns）和约 5 MiB 内容；相对 installed/off，JS heap 从 101.685 MiB 降到 6.402 MiB，fresh Edge 进程树 private memory 从 643.117 MiB 降到 626.672 MiB。mounted DOM 在三组中都保持 12，mutation 都是 62，typing p95 都是 0.01 ms，说明收益来自额外的数据截断，而不是把 ChatGPT 已有 virtualization 当成功劳。

上述 `LOW_MEMORY_TRUNCATION=PASS` 属于 `0.3.0` 重建候选及其同一独立 reviewer 的历史证据。`0.5.11` 保留了该数据平面，但修改了内容脚本、设置和 service worker 集成，因此仍需当前构建的浏览器回归，不能直接继承为完整候选结论。

## Highlighter 与 PDF 的候选证据

Highlighter 使用 CSS Custom Highlight API，不包裹或删除 ChatGPT 的 React 节点，也不修改全局 `Range` / `Selection` 原型。隔离浏览器 fixture 覆盖了正文到行内数学再回到正文的连续选择、刷新、remount、数学重排、重复文本、源文删除、branch 不匹配、streaming、composer/code 排除、键盘、换色、删除与 8 轮压力回归。

PDF fixture 从真实构建产物生成两页 A4 PDF，并在 PDF.js 5.6.205 的实际 text layer 中用可信 pointer 事件连续选择 `Before x+1 after`。展示数学 `E=mc^2` 也可选择，`pdfplumber` 能从同一个 PDF 独立提取两段数学文本。黄色跨数学高亮和薄荷色跨页高亮保留在渲染结果中。导出 model 只在 `chrome.storage.session` 中一次性传递；不支持的来源、伪造 consumer 和失败的导出页创建都会 fail-open 并清理临时数据。

`0.3.0` 的 focused evidence 支持 `PDF_TEXT_SEARCH_SELECT=PASS` 与 `WEB_HIGHLIGHT_CROSS_MATH_TO_PDF=PASS`。由于 `0.5.11` 扩展了 AnswerDocument、高亮记录模型、本地导入模型、回答动作控制器、导出语义模型、后台注册和内容脚本，这些结果只作为回归基线；当前构建重新通过对应浏览器 fixture 和实际 PDF viewer 之前，不写入新的 PASS。

## 本地验证

常用命令：

```bash
npm run build
npm run test:foundation-core
npm run test:foundation-flows
npm run test:low-memory
npm run test:low-memory-page
npm run test:low-memory:pressure
npm run test:highlighter
npm run test:highlighter:stress
npm run test:highlight-interaction
npm run test:highlight-record-integrity
npm run test:local-import-integrity
npm run test:adapter-recovery
npm run test:target-surfaces
npm run test:answer-actions
npm run test:pdf
npm run test:pdf-background
npm run test:popup-render
npm run test:convergence-core
npm run test:build
npm run acceptance:preflight
```

`test:convergence-core` 是不启动浏览器的纯 Node 验证，覆盖设置迁移、高亮交互策略、Markdown/Notion 序列化、五公式样本、完整会话证明与 Markdown/PDF 组装、两类高亮记录迁移、普通网页锚点和权限过滤注册，以及 Reliability 状态机、精确动作授权、恢复 claim、隐私历史 ledger 和目标结构后端。`test:highlight-record-integrity` 专门验证备注/标签预算、旧记录迁移、导入白名单、变更 helper 再清洗和未知字段不进入导出。`test:local-import-integrity` 验证文件读取前预算、未来 schema 拒绝、精确组合备份 envelope、源记录数量限制、旧单类备份兼容和确定性冲突规则。`test:target-surfaces` 单独覆盖 suggested-work 的可逆隐藏、恢复控件的 subject/control 绑定，以及单回答 Mica 入口的唯一性、可信手势、streaming/歧义 fail-open、remount 和设置清理。`test:answer-actions` 额外串联回答入口、PDF 设置消费和静态构建门禁。`test:highlight-interaction` 单独验证快捷键规范化、危险组合拒绝、三种交互模式、默认颜色路由以及 repeat/IME 保护。`test:foundation-core` 使用隔离 Chromium 验证 adapter、AnswerDocument、fail-open、编辑/branch/remount identity、诊断隐私和 typing hot path。`test:low-memory` 验证 ordinary JSON 与 turbo-stream 图窗口化；`test:low-memory-page` 验证早期拦截、fallback、禁用、reload bypass 和上滑恢复入口；`test:low-memory:pressure` 执行重复 A/B/C 资源测量。`test:highlighter` 与压力命令验证锚点、remount 和交互所有权。`test:pdf` 验证实际 PDF、PDF.js 指针选择和独立文本提取，`test:pdf-background` 验证本地一次性 handoff。`test:popup-render` 验证实际构建的 popup 状态、尺寸、缩放、主题与键盘顺序。

其中 `conversation-export-fixture` 还会在纯 Node 环境直接解析一张带强调、公式和引用的表格，验证 Markdown、Notion、PDF model 与打印页语义。它会证明安全 MathML AST 能从 `AnswerDocument` 到达命名空间打印 DOM，拒绝伪造标签，并在局部公式高亮不能精确映射时采用可见 TeX 降级；`javascript:` 等危险链接也不会进入可点击 PDF 链接。

验收器的入口和证据模型见 [`acceptance/README.md`](acceptance/README.md)。它会同时运行 known-good 与 known-bad controls，并拒绝 Low Memory no-op、缺失或篡改证据、旧候选报告、错误页面、重复截图、能力合同缺项、不可选择数学 PDF、伪造会话完整性、伪造导出保真度、伪造恢复去重、伪造本地导入预算、错 turn 动作授权及伪造单回答入口唯一性，以及漏掉必需 gate 的候选结果。

自动化测试使用仓库 fixture 与隔离 Playwright Chromium，不连接用户日常 Edge profile，也不自动操作登录态 ChatGPT。当前页面协议依据来自隔离浏览器中的公开只读 shared conversation；最终登录态 current-site 验收仍按冻结 Goal 的 HUMAN_ONLY 边界执行。

## 产品与实现依据

- 当前产品系统：[`docs/product/MICA_PRODUCT_SYSTEM_V1.md`](docs/product/MICA_PRODUCT_SYSTEM_V1.md)
- 功能收敛状态：[`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.md`](docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.md)
- 机器可读矩阵：[`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.json`](docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.json)
- Foundation UI freeze：[`docs/product/MICA_FOUNDATION_UI_FREEZE.md`](docs/product/MICA_FOUNDATION_UI_FREEZE.md)
- 当前 ChatGPT surface evidence：[`docs/investigations/2026-10-12-current-chatgpt-surface-bootstrap.md`](docs/investigations/2026-10-12-current-chatgpt-surface-bootstrap.md)
- Highlighter 调查：[`docs/investigations/2026-10-12-highlighter-reference-and-anchor-engine.md`](docs/investigations/2026-10-12-highlighter-reference-and-anchor-engine.md)
- PDF 与 text-layer 调查：[`docs/investigations/2026-10-12-pdf-export-and-text-layer.md`](docs/investigations/2026-10-12-pdf-export-and-text-layer.md)
- 长对话恢复背景：[`docs/PHASE_1_LONG_THREAD_RECOVERY.md`](docs/PHASE_1_LONG_THREAD_RECOVERY.md)
- 版本规则：[`docs/VERSIONING.md`](docs/VERSIONING.md)

## Release 与安装包

`dist/mica-dev/` 是固定的开发版加载路径。版本化 ZIP、SHA-256 和 release snapshot 只在完整候选冻结后生成；当前 Highlighter/PDF 候选不会冒充正式发布。详细规则见 [`docs/RELEASE_PACKAGING.md`](docs/RELEASE_PACKAGING.md)。

## Branding

品牌说明见 [`docs/BRANDING.md`](docs/BRANDING.md)，图标规范见 [`docs/ICON_ASSETS.md`](docs/ICON_ASSETS.md)。现有图标只是安装资产，不代表 Foundation popup 的视觉方向。

## 项目边界

Mica 默认本地运行，不需要外部后端，也不上传聊天内容。任何读取页面内容的功能都必须限制在 `chatgpt.com` / `chat.openai.com` 的必要范围内；未知结构 fail-open，授权、安全、支付、工具和文件确认界面不由 Mica 自动点击或绕过。
