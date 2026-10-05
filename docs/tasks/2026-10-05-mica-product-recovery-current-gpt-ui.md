# Mica 产品恢复与当前 ChatGPT 界面收敛总 Goal

```yaml
task_key: mica--product-recovery-current-gpt-ui
mode: discover_plan_execute_verify_report
repository: YuukiAS/Mica-for-ChatGPT
goal_owner: Codex
execution_model: one_durable_goal_no_successor_churn
user_block_budget_total: 1
gpt_work_budget:
  primary_review: 1
  rereview_after_real_fix: 1
  rate_limit_fallback: independent_fresh_codex_review
broad_surface_atlas_budget: 0
real_chatgpt_send_budget_total: 2
auto_git_commit: true
auto_git_push: true
target_branches:
  working: codex/mica-product-recovery-current-gpt-ui
  final: main
target_releases:
  - v0.3.0-prerelease: daily-core recovery
  - v0.4.0-prerelease: research export completion
```

## 0. 总目标

把 Mica 从“分支、探针、Atlas、测试和 Goal 很多，但用户真正能用的功能基本没有”恢复成一个可以长期日用的浏览器扩展。

本 Goal 必须连续完成以下两条产品里程碑，不得每遇到一个失败就新建 Goal、重新规划或把验证扔给用户：

1. **Mica 0.3.0 — Daily Core**
   - 当前 ChatGPT 界面上的自然、稳定、低打扰集成；
   - 可用的 Markdown/LaTeX Copy；
   - composer / connector / stale draft / ghost send / fake waiting 的可靠性守护；
   - 对长线程能力给出真实结论：有可测收益才保留为功能，没有收益就退出主界面，不得伪装完成；
   - 清理正常产品界面中的 Atlas、开发诊断面板和多余按钮；
   - 形成唯一可信主线、可安装构建与预发布包。

2. **Mica 0.4.0 — Research Export**
   - 网页高亮；
   - 高亮可恢复与本地持久化；
   - 单条回答高保真 PDF 导出；
   - PDF 保留高亮，正文可搜索/选择，数学公式的选择复制能力有实际验收；
   - Notion-ready 复制/导出，尽量免去逐个公式手动转 equation；
   - 完成 Issue #9、#10 的逐项证据闭环。

**这不是继续旧的 Goal 026。它是唯一新的恢复 Goal。内部可以有阶段和提交，但不得把同一个产品问题拆成连续的新 Goal。**

---

## 1. 执行前强制对齐 AI Skills

在读取或修改 Mica 代码前，先通过已安装的 **AI Skills Maintainer** 检查并同步当前机器。

必须记录：

```text
AI_SKILLS_MARKETPLACE_REF
AI_SKILLS_RELEASE_SHA
AI_SKILLS_REPOSITORY_VERSION
INSTALLED_WORKFLOW_CORE_VERSION
INSTALLED_WEB_DEVELOPMENT_VERSION
INSTALLED_PLUGIN_PATHS_OR_HASHES
CURRENT_CODEX_SESSION_LOADED_VERSIONS
```

截至 2026-10-05 的最低已知正式版本仅作为下限，不得当作固定值：

```text
Repository / CLI release >= 5.4.4
workflow-core >= 0.5
web-development / Frontend Design >= 0.4
```

规则：

- 稳定执行默认跟随 AI_Skills 的 `release`，不要为了追未发布内容擅自切到 `main`。
- 如果正式 `release` 已有更高版本，使用更高版本。
- 如果同步导致插件更新，而当前 Codex 会话无法热加载新版本：
  - 在不接触 Mica 源码前持久化本 Goal；
  - 通过正常 Bridge / controller / fresh-session 路径继续同一个 Goal；
  - 不得在加载旧 Frontend Design 或旧 Workflow 的会话中开始 Mica 开发；
  - 这属于执行环境重载，不计入一次产品证据的用户阻塞预算。
- 必须实际调用并遵循：
  - `workflow-core` / Verified Workflow；
  - `web-development` 的 `frontend-visual-systems` 协调器；
  - 协调器选择的 Product UX、Visual Direction、Design Tokens、Responsive/Accessibility、Webapp Testing 等 delegate。
- 不得只在报告里写“已对齐插件”，必须给出精确版本、ref、SHA 与当前会话加载证据。

---

## 2. 首先承认并固化过去的失败，不得重复

开始实现前，创建：

```text
docs/workflows/MICA_EXECUTION_FAILURE_HISTORY.md
```

它不是情绪性复盘，而是后续执行者必须遵守的项目记忆。至少覆盖：

1. `main`、开发分支、公开 Release、实际加载版本长期不一致；
2. 多次“本地测试全绿”，真实 ChatGPT 上同一问题仍失败；
3. fixture 没有忠实复现真实 action bar、composer value、remount 与 connector 生命周期；
4. Atlas、探针、验收工具反客为主，产品功能长期没有交付；
5. UI 明显丑、按钮乱放、产品层级错误，却让用户/GPT Work先发现；
6. 用户被迫充当第一线 UI reviewer、测试员和诊断操作员；
7. Goal 反复拆分，失败后继续增加流程而不是修根因；
8. 最终 0.2.4 通过把主要功能默认关闭获得“安全”，不等于产品完成；
9. 正常 popup 混入大量开发按钮、Atlas 控件和内部状态；
10. 旧 README、ROADMAP、版本文案与真实代码不一致；
11. 真实失败后继续让用户重试，而不是先做 old-bad/new-good 本地复现；
12. 证据没有绑定同一最终候选，旧截图/旧 PASS 被跨候选复用。

同时把下列规则写入 `AGENTS.md` 的 Mica 专属部分，而不是只留在本 Goal：

- 用户不是普通 QA；
- Codex Producer 必须先消灭同一截图/同一交互中自己能发现的 P0/P1/P2；
- GPT Work 是独立盲区和整体审美检查，不是第一次认真看产品；
- evidence tooling 从属于产品，不得无限修“验证器的验证器”；
- 同类失败连续两次且没有新增信息，立即停止盲目重跑，转为根因、fixture 与 validator 审计；
- 真实失败必须走 `旧代码在真实派生 fixture 上失败 -> 新代码在同一 fixture 上通过 -> 一次最终真实确认`；
- 任何 source 变化都会使受影响表面的旧截图、旧 reviewer PASS 和旧 release evidence 失效；
- 正常产品 UI 不得出现 Atlas、fixture、mock、debug、raw selector、内部路径或诊断协议文案。

---

## 3. 恢复唯一可信源码主线

不得假设 `main`、`codex/v020-convergence-pushable` 或任何旧 PR 自动正确。

先完成并提交：

```text
docs/recovery/MICA_SOURCE_OF_TRUTH_RECOVERY.md
```

至少检查：

- canonical 本地 checkout / worktree；
- origin URL；
- `git status --short --branch`；
- 所有相关 branch、tag、release、PR；
- `main` 与 `codex/v020-convergence-pushable` 的共同祖先、ahead/behind、有效产品提交；
- 本地未推送提交、未跟踪文件、用户工作；
- 当前公开 Release 实际包含的版本；
- `dist/mica-dev`、manifest、popup、diagnostics 与 package version 是否一致；
- PR #7、#8 以及旧 Goal 文档是否仍有任何有效约束。

规则：

- 不得 `git clean -fd`、广泛 reset、覆盖未知本地工作或重映射 remote。
- 建立一个新的语义分支：
  - `codex/mica-product-recovery-current-gpt-ui`
- 从经证据选择的正确 base 开始；可以复用旧分支中的有效代码和测试，但不得把 57 个提交或旧 Atlas 体系整包视为可信产品。
- 对每类旧实现做三分：
  - `KEEP_AND_PROVE`
  - `PORT_WITH_REWRITE`
  - `ARCHIVE_OR_REMOVE`
- 旧 PR #7、#8 只在新恢复 PR 已建立且历史约束已迁移后关闭或标记 superseded。
- 最终必须让 `main`、公开预发布、`dist/mica-dev` 和文档指向同一真实候选。
- README 与 ROADMAP 必须按真实产品重写，不能继续写过期的 0.1/0.2 rc 状态。

---

## 4. 当前 ChatGPT UI 是注入界面的设计权威

这是一次 S3 产品恢复。必须完整运行 Frontend Design 的 P0–P4 与 F-A–F-D。

在写 UI 代码前，创建：

```text
docs/product/MICA_PRODUCT_CONTRACT.md
docs/product/CURRENT_CHATGPT_UI_CONTRACT.md
docs/product/MICA_UI_SYSTEM.md
```

### 4.1 产品合同

`MICA_PRODUCT_CONTRACT.md` 必须先固定：

- Mica 的核心用户工作；
- 正常使用时哪些 UI 应出现；
- 哪些 UI 只属于开发/诊断；
- popup 的信息架构；
- 页面注入控件的出现条件；
- reliability 状态与恢复动作；
- highlighter / export 的交互入口；
- 失败时 fail-open 行为；
- 用户可理解的产品文案；
- 不应显示的内部信息；
- 每个可见 action 的承诺与后置条件。

### 4.2 当前 ChatGPT UI 合同

不得根据 9 月旧截图、旧 selector 或旧 fixture 猜 10 月的 ChatGPT 界面。

优先级：

1. Codex 自己使用现有已授权、隔离、只读的当前 ChatGPT 测试路径；
2. 已存在的精确真实派生合同；
3. 一次有界、经过自测的当前界面采集；
4. 最后才使用旧截图，并只能标为 `LIMITED`。

合同至少需要覆盖：

- assistant answer 的真实 action cluster；
- native Copy 及相邻按钮的 DOM/AX identity、父子/兄弟关系、尺寸、间距、hover/focus 语义；
- composer empty / typed / streaming / error / stop 状态；
- contenteditable、textarea 或其他 property-backed value 来源；
- composer remount 与 mention/connector 相关结构；
- native toast、error、dialog、retry/regenerate 区域；
- conversation turn identity；
- 页面窄宽、常规宽度；
- light/dark token 与可访问性信号；
- 当前 ChatGPT 已有的原生虚拟化/窗口化行为。

禁止：

- 广泛 Surface Atlas Round 1–6；
- 无界 DOM dump；
- 抓取 prompt、answer、token、header、cookie、request body；
- 为获取布局而反复刷新、发送或消耗真实请求；
- 连接用户日常浏览器并任意浏览其他 tab。

### 4.3 唯一一次用户阻塞预算

整个 Goal 只有一次 `USER_BLOCK_BUDGET=1`。

不要过早使用。必须先完成：

- repo 恢复；
- skills 对齐；
- 本地 probe 自测；
- 所有能离线确定的产品与测试工作；
- 汇总本 Goal 所有确实需要的外部证据。

只有当 Codex 无法通过已有授权路径取得关键事实时，才允许一次性向用户发出一个最小、清楚、可复制执行的请求。必须把所有真正 HUMAN_ONLY 的证据需求合并在同一次请求中，例如：

- 当前 ChatGPT action bar / composer 的一次只读采集；
- 一个 connector/remount 的最小手工动作；
- 若最终 Notion 粘贴语义无法由本地和官方合同证明，可把一次 Notion paste 结果也合并进去。

要求：

- 提供一个已经在本地 fixture 上自测通过的单一命令或一个有界动作序列；
- 不让用户开 DevTools、找 DOM、贴大段 JS、逐张截图或做多轮 A/B；
- 用户完成后自动恢复同一个 Goal；
- 不再询问“继续吗”；
- 之后不得再把普通 UI/功能验收交给用户。

---

## 5. UI 必须自然，不得再出现“按钮乱放还丑”

### 5.1 Popup

正常 popup 必须是产品，不是调试控制台。

目标信息架构：

- 顶部：Mica 身份、总开关、当前页面是否受支持；
- 主体：不超过三个用户能力入口：
  - Copy & Export
  - Reliability
  - Performance / Page integration
- 每项只显示用户需要理解的状态和一个必要动作；
- 高级设置默认收起；
- 开发诊断迁移到独立 developer/options surface，正常 popup 不展示；
- 正常 popup 中不得出现：
  - Start Atlas
  - Stop Atlas
  - Copy Atlas report
  - 一排 Run / Copy / Stop / Reset
  - raw counters、mounted DOM 细节、selector、build internals
- 不要把每一行都套成独立大卡片；
- 不要通用紫色渐变、随意阴影、随机圆角、AI dashboard 风格；
- 不要用缩小字体和拥挤来掩盖重复信息；
- 使用明确的语义 token、统一图标家族、真实 hover/focus/disabled 状态；
- 320–400 px popup 宽度都必须自然；
- 100%、125%、150% 缩放不得裁切或溢出；
- light/dark 均需实际渲染检查。

### 5.2 ChatGPT 页面注入

原则：

- **能证明正确位置才出现；不能证明就不出现。**
- Mica Copy 不得再漂到 action row 最右侧、独立新行或宽泛容器。
- 注入控件必须属于当前 native action cluster，尺寸、基线、间距、hover、focus、tooltip 与当前 ChatGPT 语法一致。
- 不直接复制不明确授权的专有图标资产；使用一致、可溯源、可识别的图标。
- 不允许“文字按钮 Mica Copy”破坏原生工具条密度，除非当前产品合同有明确设计证据。
- 页面状态入口只能在有真实用户价值时存在：
  - 若保留底部状态点，必须证明其锚点、避让、窄屏、composer、移动和点击行为自然；
  - 若当前 GPT UI 无合适位置，默认不显示页面常驻状态，仅在 popup 或瞬时状态中呈现；
  - 不得用可拖动任意坐标掩盖没有设计好位置的问题。
- Reliability 提示只在异常发生时出现，靠近相关上下文，只有一个清楚的下一步，不制造第二套全局状态面板。
- Highlighter 不得永久悬浮一条工具栏；优先采用自然的 selection affordance、context menu 或经过设计验证的轻量入口。
- 所有未知 DOM/AX 结构 fail-open，不修改正文、不创建漂浮 fallback 控件。

### 5.3 Producer 自检

Codex 必须自己查看最终截图与真实交互，不得只生成图片或让测试脚本判断。

每个 UI 里程碑至少做两轮 Producer review：

1. **机制检查**：位置、尺寸、点击、键盘、后置条件、滚动、溢出、持久化；
2. **整产品检查**：层级、密度、重复、图标、文案、状态一致性、是否像自然浏览器扩展而不是测试面板。

在这两轮通过前，禁止交给 GPT Work 或用户。

---

## 6. 里程碑 A：Mica 0.3.0 Daily Core

### 6.1 Markdown / LaTeX Copy

必须交付：

- 单条 assistant answer 的稳定 Markdown；
- 标题、列表、引用、表格、代码块、链接；
- 行内数学与块级数学；
- 块级数学默认使用 `$$...$$`；
- 清除 ChatGPT UI 文案和 action controls；
- 输出不依赖当前 native Copy 偶然格式；
- clipboard 失败有清楚但不打扰的反馈；
- 未识别结构 fail-open，不复制错误内容；
- 一个自然的页面入口或 popup/context menu 入口；
- 默认可用，不再作为“实现了但安全基线强制关闭”的死功能。

历史 Copy 错位必须有真实派生 fixture：

```text
OLD_0_2_4_OR_RC11_COPY_PLACEMENT = EXPECTED_FAIL
NEW_COPY_PLACEMENT_SAME_FIXTURE = PASS
```

### 6.2 Composer / Connector / stale draft

把 Issue #5、#6 作为同一个 composer lifecycle 产品问题收敛，而不是继续堆三个互相竞争的 recovery 模块。

必须证明：

- 普通输入、IME、paste、cut、Ctrl+A/Delete；
- mention chooser 打开/选择/取消；
- connector chip 插入/删除；
- composer editable/root remount；
- send 成功后 user turn 真正 commit；
- 已发送文本不会错误残留；
- 若 user turn 未 commit，Mica 不得清除原始草稿；
- delayed commit 不会双发；
- 用户发送后继续输入，不会被旧 recovery 清掉；
- unknown structure fail-open；
- 不在普通 input hot path 执行 broad query、clone、geometry、hash、序列化或轮询风暴。

历史长 connector residual 必须有 old-bad/new-good：

```text
OLD_RC10_RC11_LONG_CONNECTOR_RESIDUAL = EXPECTED_FAIL
NEW_LONG_CONNECTOR_RESIDUAL_SAME_FIXTURE = PASS
```

不要用“加长 timeout”替代根因。

### 6.3 Turn Delivery Guard

完成 Issue #4 的第一条真正可用纵向链：

```text
send_intent
-> awaiting_user_commit
-> user_committed
-> assistant_generating
-> settled
```

异常至少包含：

```text
ghost_send_suspected
fake_waiting_suspected
stale_response_suspected
generation_error_recovery_available
```

要求：

- “输入框清空”“Stop 按钮出现”“正在思考”都不能单独证明发送成功；
- 必须以新 user turn identity + payload fingerprint 等结构证据确认 commit；
- prompt 原文只可在当前 session 的临时恢复区保存，成功后立即清除；
- diagnostics 只记录 hash、长度、状态、时间，不记录正文；
- 高置信未 commit 时可提供恢复草稿/重新发送动作；
- 第一版默认不盲目自动重发；
- 任何自动恢复最多一次，并有 per-turn 去重锁和 kill switch；
- tool、attachment、connector、授权或可能产生外部写入时，不得自动 resend/regenerate；
- “连接中断，正在等待完整回复”超过确定阈值后不能无限伪装成正常等待：
  - 识别状态没有推进；
  - 保存可恢复信息；
  - 提供终止/刷新/重试中最安全、最明确的一个动作；
  - 已可能产生外部动作时只提示，不自动重发；
- stale/duplicate response 以 turn identity、DOM identity、稳定后文本指纹为主，宁可漏报，不用 LLM 猜语义并自动重试；
- 正常相似回答、相同 prompt、流式早期相似不得误报。

### 6.4 长线程性能的真实结论

不要继续把“当前 ChatGPT 已原生窗口化”包装成 Mica 性能功能。

做受控测量：

- 当前 GPT mounted turn 行为；
- Mica OFF；
- Mica ON 但 performance module inactive；
- Mica performance module active；
- typing latency、mutation rate、long tasks、scroll/frame stalls；
- 低成本本地 synthetic stress；
- 若已有低内存设备证据则纳入，但不要再次让用户做多轮性能测试。

决策：

- 有可重复、用户可感知、无回归的收益：保留并明确说明；
- 无额外收益：从主界面移除“优化”承诺，保留 native-safe/no-op 或删除无价值路径；
- 不得为了显示 Active 而降低阈值或制造优化计数；
- Issue #1 只能按真实结果关闭、重写或标记被当前原生行为取代，不得假 PASS。

### 6.5 0.3.0 发布门

必须全部通过：

```text
SKILLS_ALIGNED = PASS
SOURCE_OF_TRUTH_UNIQUE = PASS
CURRENT_CHATGPT_UI_CONTRACT = EXACT
PRODUCT_CONTRACT = FROZEN
NORMAL_POPUP_NO_DEV_CONTROLS = PASS
COPY_FUNCTIONAL = PASS
COPY_NATIVE_PLACEMENT = PASS
COMPOSER_LIFECYCLE = PASS
LONG_CONNECTOR_RESIDUAL = PASS
TURN_DELIVERY_GUARD = PASS
FAKE_WAITING_RECOVERY = PASS
INPUT_HOT_PATH_BUDGET = PASS
LONG_THREAD_CLAIM_TRUTHFUL = PASS
ACCESSIBILITY = PASS
LIGHT_DARK_RESPONSIVE = PASS
PRODUCER_P1 = 0
PRODUCER_P2 = 0
FOCUSED_TESTS = PASS
AFFECTED_E2E = PASS
FULL_SUITE = PASS
EDGE_LOCAL_FIXTURE = PASS
CANDIDATE_IDENTITY = PASS
DIST_VERSION_CONSISTENCY = PASS
PACKAGE_ZIP_SHA256 = PASS
```

冻结 exact candidate 后，才允许：

- 一次隔离 profile 的当前 ChatGPT 最终检查；
- 整个 Goal 最多 2 条固定、无敏感内容、无 connector/tool/file 的 harmless test send；
- 未知 dialog、Cloudflare、rate limit、账户异常立即停止真实流量，继续本地验证；
- 不把真实服务循环用作回归测试。

通过后：

- 提交、推送；
- 建立一个新的恢复 PR；
- 合并到 `main`；
- 生成 `v0.3.0` prerelease、ZIP、SHA-256；
- `dist/mica-dev` 保持固定开发加载路径；
- 关闭或更新 #1–#6 时提供逐项实现与证据矩阵，不能凭总报告批量关闭。

---

## 7. 里程碑 B：Mica 0.4.0 Research Export

0.3.0 完成后继续同一个 Goal，不需要用户重新发 prompt。

### 7.1 Web Highlighter

实现 Issue #9 的网页高亮纵向链：

- 普通正文、标题、列表、引用；
- 公式周边文本；
- 跨行、跨段；
- stable text/DOM anchor；
- conversation/page 级本地持久化；
- 刷新、重新进入、长对话虚拟化/remount 后恢复；
- 与 native selection、Copy、KaTeX/MathJax、streaming、composer 互不干扰；
- 未识别结构 fail-open；
- 不上传任何聊天正文到第三方。

必须测试：

- 文本变化；
- turn remount；
- 同文多处；
- cross-node range；
- display math 相邻范围；
- 删除/编辑导致 anchor 失效时的确定性降级；
- 大量高亮时的性能与输入热路径隔离。

### 7.2 高保真 PDF

第一阶段交付单条 assistant answer：

- 标题、段落、列表、引用、表格、代码、链接；
- inline/display math；
- 高亮继承；
- 分页、跨页代码块、表格和公式；
- 去除 ChatGPT UI；
- 全本地执行。

验收不能只看截图：

- 普通文本可选择、复制、搜索；
- PDF 文本提取能恢复正文；
- 高亮与对应文本位置一致；
- 数学公式视觉正确；
- 公式选择/复制能力必须相较当前已知 AI Exporter 问题有可测改善；
- 不允许默认把公式栅格化为不可选图片；
- 若复杂公式无法完全语义化，定义明确、可测试、对用户诚实的 fallback；
- 生成后自动运行 PDF 结构、文本层、页面边界、字体/矢量对象和复制结果检查；
- 至少准备一份数学密集、表格、代码、高亮跨页 fixture。

### 7.3 Notion-ready

完成 Issue #10：

- 与普通 Markdown、GitHub Markdown 分离；
- clipboard 同时提供合适的 `text/plain` 与 `text/html`；
- 正确区分 inline/display math；
- 尽量让粘贴到 Notion 后直接成为可用公式；
- 保留标题、列表、引用、代码、链接、表格；
- 大量公式、连续公式、公式与标点、列表/表格内公式；
- 不要求用户连接 Notion 账号作为默认路径；
- 不能无损表达时使用确定性 fallback，不静默损坏。

验证顺序：

1. 当前 Notion 官方公开合同与文档；
2. 本地 clipboard MIME inspector；
3. 本地 Notion-like contenteditable/import fixture；
4. 若已有隔离且已登录的 Notion 测试页面，Codex 自己做一次有界粘贴检查；
5. 若确实只能由用户完成，把它合并到本 Goal唯一一次用户证据请求中，而不是后续再单独打断。

### 7.4 0.4.0 发布门

```text
WEB_HIGHLIGHTER = PASS
HIGHLIGHT_PERSISTENCE = PASS
HIGHLIGHT_REMOUNT_RECOVERY = PASS
HIGHLIGHT_STREAMING_SAFETY = PASS
PDF_VISUAL_FIDELITY = PASS
PDF_TEXT_SEARCH_SELECT = PASS
PDF_HIGHLIGHT_MAPPING = PASS
PDF_MATH_COPY_IMPROVEMENT = PASS
PDF_DETERMINISTIC_FALLBACK = PASS
NOTION_READY_CLIPBOARD = PASS
NOTION_MATH = PASS
NO_THIRD_PARTY_CONTENT_UPLOAD = PASS
PERFORMANCE_REGRESSION = PASS
PRODUCER_P1 = 0
PRODUCER_P2 = 0
FOCUSED_TESTS = PASS
AFFECTED_E2E = PASS
FULL_SUITE = PASS
CANDIDATE_IDENTITY = PASS
DIST_VERSION_CONSISTENCY = PASS
PACKAGE_ZIP_SHA256 = PASS
```

通过后：

- merge 到 `main`；
- 发布 `v0.4.0` prerelease；
- 对 #9、#10 做逐项 closure matrix；
- 只有全部验收项有实现 locator + 测试 + 实际 artifact 证据时才关闭 issue。

---

## 8. Codex 必须承担的低级验收

下面全部属于 Producer/Codex，不得交给用户或 GPT Work：

- popup 每个按钮和 toggle 的可见性、enablement、点击、后置条件、持久化；
- action bar 插入位置、hit target、tooltip、focus、keyboard；
- copy clipboard 实际 MIME 与内容；
- composer 输入、删除、paste、IME、mention、remount；
- scroll、resize、zoom、light/dark；
- PDF 生成、分页、文本层、复制搜索；
- highlighter selection、恢复、失效；
- Notion-ready serialization；
- unknown DOM fail-open；
- 关闭/启用模块；
- uninstall/reload/update migration；
- manifest 权限；
- build/package/version；
- performance budget；
- exact candidate binding。

至少建立以下自动化层：

1. **纯状态机/serializer 单元测试**；
2. **真实派生、脱敏的 current ChatGPT fixture**；
3. **Playwright bundled Chromium + extension persistent context**；
4. **真实 Edge 打开本地 fixture**；
5. **实际 extension popup，不是普通静态 HTML 替身**；
6. **截图矩阵 + DOM/AX/geometry 断言**；
7. **PDF 结构与文本层检查**；
8. **性能和 input hot-path regression**；
9. **安装包 smoke**；
10. **冻结候选后的独立 reviewer replay**。

测试纪律：

- 先列 impact matrix，再改代码；
- 迭代只跑最小 focused test；
- 同一个 focused failure 连续两次且无新信息，禁止第三次盲跑；
- 所有受影响 focused test 通过后，才跑 full E2E；
- 每个冻结候选原则上只跑一次 full suite；只有真实新信息导致修复后才允许一次重跑；
- 不得用 fake data 的“漂亮成功态”证明真实产品；
- fixture 必须清楚标记且永远不能进入普通 runtime；
- 不得用 screenshot-only 证明点击、复制、持久化或发送生命周期；
- 不得跨 candidate 拼接 PASS。

---

## 9. GPT Work 与独立审查边界

GPT Work 只做：

- 整体审美；
- 信息层级；
- 密度；
- 与当前 ChatGPT 的自然融合；
- 状态是否容易理解；
- 跨 popup / injected UI / recovery UI 的一致性；
- 实现者盲点与探索性检查。

GPT Work 不做：

- 第一轮按钮点击；
- 构建/测试；
- selector 调试；
- fixture 修复；
- PDF 文本层机械验证；
- composer 低级回归；
- 让用户代做普通 QA。

交付方式：

- 只生成一个 self-contained parent prompt；
- 用户不需要分别启动多个 reviewer；
- 最多一次主审；
- 主审 FAIL 后，修复完整 failure class 和相邻状态，再允许一次终审；
- 若 GPT Work 因 rate limit / 服务不可用不能运行：
  - 不要等待或把任务扔给用户；
  - 启动一个全新、未参与实现的 Codex reviewer session；
  - 只读审查同一冻结候选和同一 evidence pack；
  - 报告 `GPT_WORK_NOT_RUN_RATE_LIMIT`，但完成独立审查；
  - 不得把“GPT Work没跑”伪装成 GPT Work PASS。

任何外部 reviewer FAIL 都会使：

```text
READY_FOR_RELEASE = NO
READY_FOR_USER_ACCEPTANCE = NO
```

修复后产生新 candidate，旧 review 自动失效。

---

## 10. 完成与报告

必须维护：

```text
results/mica--product-recovery-current-gpt-ui/
  result.md
  MANIFEST.md
  source-recovery.md
  skills-alignment.md
  current-chatgpt-ui-contract.json
  issue-closure-matrix.md
  test-matrix.md
  visual-evidence/
  pdf-evidence/
  release-evidence/
  independent-review.md
```

最终 `result.md` 只能有一个权威状态：

```text
complete
partial_complete
qa_failed
blocked
blocked_target_not_met
```

禁止一边写 PASS/READY，一边承认必需项未完成。

最终报告必须给出：

- 起始 main / branch / release；
- 最终 main commit；
- 0.3.0 与 0.4.0 commit/tag/release；
- skills 精确版本与 SHA；
- current GPT UI contract 的证据等级；
- 用户阻塞次数；
- 真实 ChatGPT send 次数；
- GPT Work / fallback reviewer 结果；
- 各 issue 的逐项状态；
- 所有测试命令、退出码与耗时；
- 未运行项目及理由；
- ZIP 路径与 SHA-256；
- normal UI 截图与实际 surface locator；
- residual risk；
- 是否仍有任何需要用户做普通 QA 的项目。

完成的硬边界：

```text
USER_BLOCK_COUNT <= 1
BROAD_ATLAS_RUN_COUNT = 0
NO_NORMAL_UI_DEV_CONTROLS = PASS
NO_USER_AS_FIRST_LINE_QA = PASS
ALL_VISIBLE_ACTIONS_PRODUCER_VERIFIED = PASS
ALL_EVIDENCE_BOUND_TO_FINAL_CANDIDATE = PASS
MAIN_IS_SINGLE_SOURCE_OF_TRUTH = PASS
```

只有当两个里程碑的适用验收项都完成，才可报告整个 Goal `complete`。

若某一外部平台事实上无法达到目标：

- 必须先证明 `UNSUPPORTED_WITH_EVIDENCE`；
- 说明尝试过的官方/本地路径；
- 给出最接近且不欺骗用户的确定性 fallback；
- 不得把降级偷偷包装成 PASS；
- 继续完成所有不依赖该项的工作，不得因为一个缺口停掉整个 Goal。

## 最后一句执行指令

**现在开始执行。先对齐正式 AI Skills，再恢复唯一源码主线，再取得当前 ChatGPT UI 合同；没有完成设计合同与真实界面合同前禁止写 UI。此后由 Codex 连续完成实现、低级验收、独立审查、合并与预发布。除最多一次合并后的 HUMAN_ONLY 证据采集外，不得让用户充当测试员、UI reviewer 或诊断操作员。**
