# Mica Product System Rebuild Goal

Status: **FROZEN FINAL CODEX GOAL — GPT CRITIC R2 PASS**  
Date: 2026-10-12

```yaml
task_key: mica--product-system-rebuild
repository: YuukiAS/Mica-for-ChatGPT
mode: execute_validate_review_release
execution_model: one_durable_codex_goal_after_gpt_critic_r2_pass
planner_authority: docs/product/MICA_PRODUCT_SYSTEM_V1.md
critic_r2_verdict: docs/reviews/2026-10-12-mica-product-system-critic-r2-verdict.md
old_goal: docs/tasks/2026-10-05-mica-product-recovery-current-gpt-ui.md
old_goal_disposition: SUPERSEDED_HISTORICAL_EVIDENCE_ONLY
working_branch: codex/mica-product-system-rebuild
user_routine_qa: forbidden
human_review_budget: 1
broad_surface_atlas_budget: 0
release_before_internal_acceptance: forbidden
```

## 0. Objective

彻底重建 Mica 的产品形态、ChatGPT 兼容层、开发入口和验收生产线，然后再把已有功能迁入这套系统。

本 Goal 的第一目标不是“尽快再做几个 feature”，而是让以后所有功能都满足：

```text
产品先清楚
-> ChatGPT 变化有单一兼容入口
-> UI 自然
-> Codex 自己能验
-> 验收器能防止降级
-> GPT Work 只做最后整体补盲
-> 用户不再当第一轮 QA
```

当前优先级已经冻结：

```text
P0 = rebuild foundation
P1 = Low Memory
P2 = built-in ChatGPT Highlighter
P3 = highlight-preserving PDF export with selectable math
DEFERRED = advanced Reliability, Notion, secondary reuse features
```

Highlighter 和 PDF 是当前核心功能，不得再被 Markdown Copy、Notion、60 秒无进展恢复或其他次要功能抢占。所有具体 feature 都必须建立在 rebuild foundation 通过之后。

---

## 1. Current authority

当前 Planner 权威只有：

```text
docs/product/MICA_PRODUCT_SYSTEM_V1.md
docs/tasks/2026-10-12-mica-product-system-rebuild-goal.md
docs/reviews/2026-10-12-mica-product-system-gpt-critic-prompt.md
docs/reviews/2026-10-12-mica-product-system-critic-r1-disposition.md
docs/reviews/2026-10-12-mica-product-system-critic-r2-verdict.md
AGENTS.md
README.md
docs/ROADMAP.md
```

规则：

- `docs/tasks/2026-10-05-mica-product-recovery-current-gpt-ui.md` 已 superseded，只能作为历史证据。
- `docs/reviews/2026-10-12-mica-product-system-rebuild-critic.md` 已 superseded，不是当前 Critic。
- 不得假设 `docs/REAL_BUG_CONVERGENCE_WORKFLOW.md`、`docs/TEST_ARCHITECTURE_V2.md` 或旧开发分支中的其他文档存在于当前 main。Source audit 若发现这些旧材料，只按历史证据/可迁移规则分类，不把它们自动提升为当前 authority。
- `AGENTS.md` 中与最终 2026-10-12 Goal 明确冲突的旧阶段性产品/验收规则，在 Critic PASS 后由 Codex 做一次 docs-only migration；privacy、credential、destructive action、external mutation、platform safety 等 durable boundary 不被覆盖。

同时读取当前正式安装的 AI Skills / workflow rules，至少覆盖：

```text
workflow-core
web-development / Frontend Design
Presentations production/acceptance workflow
Research Authoring production/acceptance workflow
```

只吸收可复用的交付纪律，不把 slide/student-assessment 领域规则复制进 Mica。

法律/许可/第三方 provenance 不是本 Goal 的 Planner/Critic/release gate，不得因此阻塞开发。

---

## 2. Skills and session preflight

在修改 Mica runtime 前：

1. 使用 AI Skills Maintainer 检查当前正式 release；
2. 同步需要的正式插件；
3. 记录：
   - repository/ref/SHA；
   - workflow-core version；
   - web-development/Frontend Design version；
   - 当前 Codex session 实际加载版本；
4. 如果更新后当前 session 仍加载旧插件，先通过正常 fresh-session/Bridge 路径继续同一个 Goal；
5. 不得在明知 Frontend Design / workflow-core 旧版本的 session 中开始 UI/runtime 重建。

输出：

```text
SKILLS_ALIGNED=PASS/FAIL
CURRENT_SESSION_PRODUCTION_SKILLS=PASS/FAIL
```

---

## 3. Preserve the current positive checkpoint before rebuilding

当前本机可能存在尚未推送的正向 checkpoint：

```text
0f2d40e16b2dcd0af8f7d567981dce7bf7b656cc
```

它曾报告：

```text
LOW_MEMORY_TRUNCATION=PASS
independent P0/P1/P2 = 0
```

这不是新系统的 release authority，但它是重要的 positive baseline，不能丢。

先执行 source-of-truth audit：

- 当前 checkout / branch / worktree；
- dirty/untracked state；
- local-only commits；
- `0f2d40e...` 是否存在、属于哪条 branch；
- remote branches；
- main；
- dist/mica-dev；
- package/version；
- release artifacts；
- old 0.3/0.4 candidate evidence；
- current Goal/result files。

禁止：

- reset/clean 覆盖未知工作；
- 为了方便从 remote main 重新开始而丢掉 local checkpoint；
- 把 checkpoint 直接 merge/release。

如果 checkpoint 存在：

1. 把它保留为明确的 historical positive baseline；
2. 在安全、权限允许时 push 对应 review/archive branch，使后续 reviewer 可定位；
3. 从经审计后的正确 base 创建：
   - `codex/mica-product-system-rebuild`

如果 checkpoint 不存在，记录：

```text
POSITIVE_CHECKPOINT_STATUS=MISSING_WITH_EVIDENCE
```

然后从可证明的最佳本地 source 继续，不猜。

---

## 4. GPT Critic admission is complete

Independent GPT Critic R2 has passed on the Planner architecture:

```text
CRITIC_VERDICT=PASS
P0=0
P1=0
P2=0
READY_TO_FREEZE_CODEX_GOAL=YES
```

Binding record:

```text
docs/reviews/2026-10-12-mica-product-system-critic-r2-verdict.md
```

This is sufficient Planner admission. Codex must **not** launch another architecture Critic and must not reopen product planning unless it encounters a genuine new product decision or contradictory real evidence.

The user's post-R2 priority amendment narrows scope only:

- rebuild foundation first;
- Low Memory next;
- Highlighter next;
- PDF next;
- advanced Reliability (~60s no-progress recovery), Notion and secondary reuse remain deferred.

This scope narrowing does not require R3.

```text
CODEX_IMPLEMENTATION_ALLOWED=YES
R3_CRITIC_REQUIRED=NO
```

---

## 5. Freeze product architecture before code

Critic PASS 后，不再创建五份平行治理文档。

Durable prose authority 保持最小化：

```text
MICA_PRODUCT_SYSTEM_V1.md
this Goal
AGENTS.md (仅做必要 migration)
```

Machine-readable contracts、fixtures、evidence schema 可按实现需要创建，但不得形成第二套 Planner authority。

在写 runtime/UI 前，Codex 必须先完成两个冻结动作：

1. **current ChatGPT evidence freeze**  
   为 adapter 的每个需要能力记录当前 variant、invariants、evidence class、contract hash 与 invalidation rule。

2. **Frontend Design freeze**  
   基于当前真实/真实派生 ChatGPT surface，冻结：
   - normal popup hierarchy；
   - control/component families；
   - spacing/density；
   - light/dark；
   - focus/keyboard；
   - 320–400px width；
   - supported/unavailable/degraded states；
   - one-answer Mica menu；
   - selection affordance；
   - recovery affordance；
   - Troubleshooting；
   - Developer QA。

顺序必须是：

```text
current surface evidence
-> product/UI freeze
-> implementation
-> actual rendered comparison
```

不能先猜 UI 再让用户找问题。

---

## 6. Freeze the visible Mica product design

完整调用 Frontend Design。

这是 **design-first specification stage**，不是要求现在就先写 popup runtime。

本节先基于 current ChatGPT surface evidence 冻结 UI 目标；实际 product-shell implementation 按 §23 canonical execution order，在 acceptance skeleton、ChatGPTAdapter/AnswerDocument core 建立之后进行。Low Memory feasibility 和所有 feature work 都在 Foundation Gate 之后。

### 6.1 Normal popup

实现 `MICA_PRODUCT_SYSTEM_V1.md` 定义的信息架构：

- Header / compatibility state
- Low memory
- Reuse answers（只显示已实现的 Copy/Export/Highlight 能力）
- Page health（正常时低权重；异常时才提升）
- Troubleshooting
- version

要求：

- 正常 popup 不出现 Atlas；
- 不出现 raw diagnostics；
- 不出现 Start/Stop/Copy/Reset button grid；
- 不出现内部 selectors/counters/paths；
- 不用一堆独立大 card 堆页面；
- light/dark；
- 100/125/150% scale；
- 320–400 px width；
- keyboard/focus；
- disabled/error/limited states；
- 文案是产品语言，不是工程语言。

### 6.2 Troubleshooting

Troubleshooting 只提供：

- compatibility summary；
- low-memory state；
- recent recovery summary；
- Run self-check；
- Export diagnostic bundle；
- Load full history（适用时）；
- development build 下进入 Developer QA 的入口。

不得把用户变成录制器操作员。

### 6.3 Developer QA

仅 dev/unpacked build 或显式 developer mode：

- adapter variant；
- capability EXACT/COMPATIBLE/UNKNOWN；
- Refresh current ChatGPT compatibility；
- current contract identity；
- focused feature self-check；
- sanitized evidence export；
- candidate/build identity。

### 6.4 Page integration

页面常驻 UI 最小化：

- 默认不保留 persistent status dot；
- answer action cluster 最多一个 Mica entry；
- selection 时才出现 highlighter affordance；
- Reliability 只在异常时出现；
- unknown placement -> do not inject；
- 如果 action-cluster placement 无法证明，但 `turn.resolveFromNode` 能 EXACT 解析用户右键/selection 所在的 assistant answer，可使用 Mica browser/context action 作为 per-answer fallback；
- popup 不得用 viewport/last-answer/focus history 猜目标 answer；
- 无法精确识别目标 answer 时，per-answer action 必须明确 unavailable。

实现阶段的 Producer 必须完成真实 render self-review，P1/P2 未清零不得进入独立 review。

---

## 7. Build ChatGPTAdapter as the only volatile UI authority

重构为类似：

```text
extension/src/platform/chatgpt/
  adapter.*
  turns.*
  action-cluster.*
  composer.*
  generation.*
  dialogs.*
  interactive-blocks.*
  compatibility.*
```

规则：

- feature code 不准散布 ChatGPT selectors；
- feature code 只消费 typed capabilities；
- adapter 支持多个结构 variant；
- capability 有 EXACT / COMPATIBLE / UNKNOWN；
- UNKNOWN 必须 fail-open；
- 不允许 broad ancestor guess；
- 不允许按“按钮在右边第几个”定位；
- 不允许把 visible text 当唯一 identity；
- property-backed control 读 property，不用 `textContent` 猜 value。

建立 selector ownership static guard，阻止未来 feature 模块重新出现 ChatGPT selector 漂移。

---

## 8. Replace Surface Atlas with Compatibility Refresh

新增 canonical commands：

```text
npm run chatgpt-ui:verify
npm run chatgpt-ui:refresh
npm run chatgpt-ui:diff
```

每个 capability contract 必须记录：

```text
capabilityId
variantId
requiredInvariants
observedInvariants
status = EXACT | COMPATIBLE | UNKNOWN
evidenceClass
observedAt
sourceArtifactHash
contractHash
invalidatedBy
```

Synthetic/local fixture 不能单独把 current ChatGPT capability 提升为 release-authoritative EXACT。一个 capability 漂移只使该 capability 和依赖它的 feature 失效，不得无故拖垮其他已验证能力。

### verify

- read-only；
- 检查当前 observed surface 是否满足已知 contract；
- 不需要真实 prompt/answer 文本。

### refresh

只采集 Mica 需要的 surface：

- assistant turn；
- action cluster / native Copy neighborhood；
- composer；
- generation/error/stop；
- connector chooser（不执行 connector）；
- supported answer structure；
- interactive block boundary；
- virtualization/mount behavior；
- representative theme/width when safe。

默认通过 Developer QA button 可启动。

本次 rebuild 在 Developer QA 尚未存在前允许一次 bootstrap：使用已有受支持的只读 browser surface 或一个已自测的 bounded helper 获取 current ChatGPT evidence。不得接管用户日常浏览器 profile，不得循环发送真实请求。

Developer QA 验证通过后，ordinary compatibility refresh 必须迁入 Mica；只有扩展 API/浏览器安全边界不足时，才允许调用 committed external helper。

### diff

输出 capability-level drift，不输出巨大 DOM dump。

例如：

```text
answerActions = MATCH
composer = COMPATIBLE_NEW_VARIANT
generation = CONTRACT_CHANGED
interactiveBlocks = UNKNOWN_NEW_CLASS
```

### External fallback boundary

如果浏览器/OS 限制要求外部启动：

- 提供单一稳定 committed script；
- README 最多记录必要的一次性命令；
- 不让用户拼接参数或复制临时代码；
- UAC/DevTools profile bootstrap 只在确实需要时发生；
- 不能把外部脚本变成 everyday Mica workflow。

---

## 9. Build one canonical acceptance harness before migrating features

在 adapter/feature 大规模迁移之前，先冻结 acceptance schema、evidence schema、candidate identity schema、minimum evidence class 和 canonical validator entrypoint。

建立：

```text
npm run acceptance:preflight
npm run acceptance:focused -- <feature>
npm run acceptance:candidate
```

具体名字可调整，但只能有一条 canonical production validator path。

### 9.1 Freeze

在开发早期冻结验收**路径和证据模式**；validator 实现只有在证明验收器本身存在缺陷时才可修改。

进入 authoritative candidate 前必须冻结：

```text
CANDIDATE_COMMIT
DIST_HASH
VALIDATOR_VERSION
VALIDATOR_TREE_HASH
CHATGPT_CONTRACT_HASH
FIXTURE_SET_HASH
EVIDENCE_SCHEMA_VERSION
EVIDENCE_ROOT_HASH
```

candidate、validator、threshold、contract、相关 fixture/control 或 evidence schema 任一改变，受影响的旧 PASS 自动失效。

### 9.2 Controls

至少加入：

```text
known-good current popup
known-good adapter contract
known-good low-memory fixture
known-good selectable-math PDF
known-bad historical Copy misplacement
known-bad connector residual/remount
known-bad fake-waiting lifecycle
known-bad low-memory no-op
known-bad lost highlight after remount
known-bad non-selectable inline-math PDF
known-bad stale ChatGPT UI contract
```

硬要求：

```text
KNOWN_BAD_CONTROL=REJECTED
KNOWN_GOOD_CONTROL=ACCEPTED
```

所有 controls 必须走与 production candidate 相同的 validator path。

禁止：

- fixture-specific rejects；
- hard-coded PASS；
- 根据 fixture 名、expected label 或 control identity 选择不同验证逻辑；
- 用 Producer 自己写的布尔状态代替测量；
- candidate freeze 后修改 threshold/validator 让它通过；
- same Producer process 作为 authoritative validator。

验收器自身必须用同一 production path 拒绝：

- missing/tampered evidence；
- wrong candidate/dist hash；
- stale prior report；
- duplicate screenshot/crop 冒充不同 surface；
- wrong turn/page/surface target；
- evidence-root mismatch；
- low-memory 无额外效果却自称 PASS；
- PDF 只有 extraction 而没有实际 pointer-selection evidence；
- stale ChatGPT contract 冒充 current。

同时必须证明一个 known-good control 能通过，避免“永远拒绝”的假严格 validator。

### 9.3 Fresh rendered/actual-surface reviewer

Validator PASS 后，由 fresh read-only reviewer 按每个 gate 的最低 evidence class 检查：

```text
SYNTHETIC_FIXTURE
LOCAL_REAL_BROWSER
CURRENT_CHATGPT_READ_ONLY
CURRENT_CHATGPT_BOUNDED_ACTION
TARGET_LOW_MEMORY_DEVICE
ACTUAL_PDF_VIEWER
REAL_NOTION_TARGET
```

至少包括适用的：

- actual extension popup；
- actual injected surface；
- light/dark/scale；
- actual low-memory target；
- actual PDF viewer；
- recovery states；
- current ChatGPT compatibility state；
- real Notion target（仅当 Notion 在 release scope）。

无法达到 mandatory evidence class 时报告 `NOT_INDEPENDENTLY_VERIFIED`，不能伪装 PASS，也不能简单把整个验收剧本转给用户。用户若只负责一次登录/OS/physical HUMAN_ONLY 动作，之后验证仍由 reviewer/Codex 完成。

Reviewer 不看 Producer“我做完了”的总结。

---

## 10. Milestone A — Low Memory

Low Memory 是 Foundation 后的第一优先级产品功能。

不得降级成：

```text
Native handling
diagnostics only
no-op
```

先做 feasibility，再做正式实现：

```text
A = Mica disabled/absent
B = Mica installed + Low Memory off
C = Mica installed + Low Memory on
```

在同一 long-thread workload 下比较可获得的：

- process/private working-set memory 或等价 browser-process metric；
- JS heap；
- heavy retained content；
- long tasks；
- frame/scroll stalls；
- input latency；
- mutation/layout work。

要求：

```text
FOUNDATION_GATE=PASS
LOW_MEMORY_FEASIBILITY=PASS
LOW_MEMORY_TRUNCATION=PASS
```

PASS 必须表示 C 对 A/B 在至少一个真实目标 long-thread workload 上产生重复可测的额外收益，同时没有 material typing/scroll/send/stream/history regression。

一个只减少 synthetic DOM、真实 workload 无额外效果的实现必须作为 `LOW_MEMORY_NO_EFFECT` known-bad control 被 validator 拒绝。

最终至少覆盖：

- short/medium/long fixture；
- recent-message budget；
- current ChatGPT native baseline；
- target long-thread workload；
- load full history；
- disable/uninstall -> native；
- reload；
- scroll history；
- send/streaming；
- edit/branch；
- connector；
- tool/file/auth；
- typing/IME hot path。

不得为了指标随意删除/拆卸 React 管理的 interactive nodes。

如果旧 checkpoint 的 low-memory 实现已经优秀，允许迁移/保留，但必须通过新 feasibility + validator；旧 PASS 不能自动继承。

Milestone A 完成后可以独立冻结、验收和发布，不等待 Highlighter/PDF。
---

## 11. AnswerDocument core belongs to Foundation; Markdown Copy is secondary

由 adapter 唯一生成 ordered/versioned `AnswerDocument`，这是 Highlighter/PDF 的基础架构，不是为了优先开发 Markdown Copy。

至少包含：

```text
documentId
conversationId
turnId
sourceVersion
generationState = STREAMING | SETTLED
orderedBlocks[]
```

每个 block 有 BlockID、order、source spans 和 content identity。

支持：

- heading；
- paragraph；
- list；
- quote；
- table；
- code；
- inline/display math（保留 rawTeX/renderedText/sourceSpan）；
- link；
- citation；
- image；
- opaque interactive；
- unknown block。

规则：

- streaming snapshot 不作为 durable final export/highlight anchor；
- settled version 才进入 durable reuse；
- edit/branch/remount 触发 version reconciliation；
- interactive blocks 默认 opaque，不把隐藏交互状态伪装成静态正文；
- Highlighter/PDF/未来 Copy/Notion 不得各自抓 ChatGPT DOM。

Markdown Copy 可以作为 AnswerDocument 的低成本 sanity path 或后续 secondary feature，但**不得延迟 Low Memory、Highlighter 或 PDF**。
---

## 12. Reliability is deferred

Advanced Reliability work is **not a current implementation priority**.

The evidence/action safety contract in `MICA_PRODUCT_SYSTEM_V1.md §8` remains durable future authority, including the ~60-second no-structural-progress behavior, but Codex must not spend significant implementation or review budget on it before:

```text
FOUNDATION_GATE=PASS
MILESTONE_A_LOW_MEMORY=PASS
MILESTONE_B_HIGHLIGHT_PDF=PASS
```

During the prioritized rebuild, Codex may only:

- preserve an already-safe existing behavior;
- disable/remove conflicting or dangerous old recovery code;
- ensure the new architecture leaves a clean future hook;
- prevent reliability observers/diagnostics from regressing typing/IME performance.

Do not build the ~60-second recovery feature now.
---

## 13. Milestone B part 1 — built-in ChatGPT Highlighter

Highlighter 是 Low Memory 之后的第二优先级产品功能，只在 Foundation 和 Milestone A 完整通过后进入实现。

读取：

```text
YuukiAS/Web_Highlighter
```

它是用户指定的技术行为参考。法律/许可/provenance 不属于本 Goal 的 Planner/Critic/release gate，不得因此阻塞开发。

吸收已经真实验证的行为：

- cross-formula selection；
- KaTeX/MathJax/raw LaTeX source；
- refresh restore；
- remount restore；
- color/delete/click ownership；
- no global Range/Selection prototype patch。

但最终 Mica 应有自己的 clean HighlightEngine，而不是把一个大型 minified extension bundle原样塞进 Mica。

Anchor 至少组合：

```text
conversation identity
turn identity
AnswerDocument sourceVersion
BlockID
text quote
prefix/suffix
source span
structural hint
math TeX source
```

必须覆盖重复文本、edit/branch、remount、math reformat、source deletion 等 ambiguity cases。

不能唯一解析时：

```text
store record
-> mark unresolved
-> do not auto-attach to another location
```

Highlighter UI 只在 valid selection 后出现。第一、第二 rebuild milestone 的高亮范围只承诺 ChatGPT surface；通用任意网页高亮不在本轮 release claim 内。

---

## 14. Milestone B part 2 — PDF Export and math selection

参考 AI Exporter 的 local print-document 思路，但不得复制其已知数学选择缺陷。

PDF 必须从 AnswerDocument + Highlight model 渲染。

禁止 screenshot PDF。

硬 gates：

```text
PDF_TEXT_SEARCH_SELECT=PASS
PROSE_INLINE_MATH_PROSE_SELECTION=PASS
DISPLAY_MATH_SELECTABLE=PASS
MATH_COPY_RESULT=PASS
MATH_SEARCHABLE=PASS
WEB_HIGHLIGHT_CROSS_MATH_TO_PDF=PASS
```

核心回归：

```text
ordinary prose -> inline math -> ordinary prose
```

在 PDF.js / viewer text layer 中连续选择时，数学必须与前后正文一起进入 Selection/Copy，不得被跳过。

验证至少包含：

- actual PDF render；
- text extraction；
- PDF.js text layer；
- programmatic cross-boundary selection/copy；
- **actual pointer drag/selection in at least one supported real viewer engine**；
- search；
- copy order；
- visual position/text-layer alignment；
- highlight mapping（cross-line/cross-page/math）；
- pagination；
- formulas；
- code/table；
- actual visual review。

PDF.js/extraction 不能替代 pointer-selection hard regression。

`ordinary prose -> inline math -> ordinary prose` 是 baseline hard case，不能用 complex-math fallback 把它改判 PASS。

如果某类复杂公式无法完全保持文本层，必须有明确 fallback 和用户可理解的边界，不能静默退化。

---

## 15. Notion is deferred

Notion is not part of the current prioritized rebuild and is not a Foundation, Milestone A or Milestone B release gate.

Keep only the architectural invariant:

```text
future Notion export must consume AnswerDocument
```

Do not implement or validate real Notion behavior until after Low Memory, Highlighter and PDF are complete, unless the user explicitly reprioritizes it.
---

## 16. Review ownership and delivery discipline

### ChatGPT / Planner

已冻结本 Goal 和 product system。

只有真正的新产品选择才返回 Planner。

### Codex Parent

负责：

- fresh Producer；
- frozen Validator；
- fresh rendered reviewer；
- repair/re-review；
- exact candidate；
- evidence；
- Git integration。

### Producer

负责实现和 self-QA。

必须先做到：

```text
PRODUCER_P0=0
PRODUCER_P1=0
PRODUCER_P2=0
```

才允许进入 independent review。

Producer 不得 authoritative PASS。

### Deterministic Validator

fresh/read-only/frozen。

### Actual-surface Reviewer

fresh/read-only。

### GPT Work

只在所有内部 gate PASS 后运行一次整体产品审查。

GPT Work 只看：

- coherent product；
- first-glance quality；
- cognitive load；
- visual integration；
- discoverability；
- subtle UX blind spots。

不得让 GPT Work 找：

- selector bug；
- button drift；
- PDF math text-layer bug；
- highlight persistence；
- low-memory no-op；
- ordinary composer regression。

如果 GPT Work 找到明显 P1/P2，记为 Producer/acceptance-system failure，并修复 failure class，不只是那个截图。

### User

用户只接收 internally accepted final candidate。

默认：

```text
HUMAN_REVIEW_BUDGET=1
```

用户不执行 routine regression checklist。

唯一可请求：

- final subjective acceptance；
- genuine login/OS/physical HUMAN_ONLY action；
- genuinely unresolved product preference。

---

## 17. Candidate and evidence lifecycle

每个 candidate 记录：

```text
CANDIDATE_ID
PARENT_ID
COMMIT
DIST_HASH
CONTRACT_HASH
VALIDATOR_HASH
EVIDENCE_ROOT
MODIFIED_SURFACES
INVALIDATED_PRIOR_EVIDENCE
```

任何影响 surface 的 source 变化：

```text
prior validation for that surface = STALE
prior rendered review for that surface = STALE
prior GPT Work result for that surface = STALE
```

不得跨 candidate 拼 PASS。

---

## 18. UI refresh must remain cheap after release

最终 Developer QA 必须让未来适配变成：

```text
ChatGPT UI changed
-> open Developer QA
-> Refresh current ChatGPT compatibility
-> contract diff
-> only affected adapter capability turns UNKNOWN
-> feature fails open
-> Codex repairs adapter
-> focused validator
-> release
```

而不是：

```text
run Atlas for hours
-> copy PowerShell
-> user reproduces many states
-> rebuild fixtures
-> still guess UI
```

这是本 Goal 的核心长期价值之一。

---

## 19. Legacy migration and cleanup

Source audit 后先生成 machine-readable legacy disposition matrix，不创建新的平行 Planner 文档。

每个 class 只能是：

```text
KEEP_AND_MIGRATE
KEEP_AS_HISTORICAL_EVIDENCE
ARCHIVE
REMOVE
SUPERSEDE
```

至少覆盖：

- broad Surface Atlas runtime/UI entry；
- Atlas scripts/contracts/evidence；
- old popup diagnostics grid；
- persistent status dot/overlay；
- old recovery modules；
- feature-owned ChatGPT selectors；
- synthetic fixtures；
- local-only candidate artifacts；
- old Goals；
- old release packages；
- old PRs/branches；
- stale README/ROADMAP；
- legacy Issue closure state。

硬要求：

- normal runtime 不再同时启用旧 Atlas / old diagnostics shell / new product shell；
- recovery 只保留一个 current state contract；
- feature-owned selectors 在 adapter migration 后清零；
- 真实失败 fixture 可迁入 canonical acceptance harness；
- 只会自证旧架构的 fixtures 归档或删除；
- old Goals 明确 superseded；
- unique local work 未确认前不删 branch/worktree；
- final validator 检查 removed legacy entrypoint 不再进入 build/runtime。

产品和 acceptance system稳定后：

- rewrite README to current truth；
- rewrite ROADMAP；
- explain normal Mica use first；
- explain Developer QA separately；
- external fallback command 只记录扩展确实做不了的 browser/OS bootstrap；
- remove stale version/status claims；
- keep one canonical development `dist/mica-dev` path。

---

## 20. Foundation + two prioritized release milestones

不要提前锁死具体 version number。Source-of-truth audit 后选择 next appropriate SemVer。

### Foundation Gate — internal, not a fake release

必须全部通过：

```text
PREBUILD_CRITIC_R2=PASS
CURRENT_CHATGPT_EVIDENCE=PASS
UI_DESIGN_FREEZE=PASS
NORMAL_POPUP=PASS
TROUBLESHOOTING=PASS
DEVELOPER_QA=PASS
CHATGPT_ADAPTER=PASS
CHATGPT_UI_REFRESH=PASS
ANSWER_DOCUMENT_CORE=PASS
ACCEPTANCE_HARNESS=PASS
KNOWN_BAD_CONTROL=REJECTED
KNOWN_GOOD_CONTROL=ACCEPTED
LEGACY_PARALLEL_RUNTIME=NONE
PRODUCER_P0=0
PRODUCER_P1=0
PRODUCER_P2=0
USER_IS_FIRST_QA=NO
```

Foundation Gate 通过后才允许进入具体 feature implementation。

### Milestone A — Low Memory

必须全部通过：

```text
FOUNDATION_GATE=PASS
LOW_MEMORY_FEASIBILITY=PASS
LOW_MEMORY_TRUNCATION=PASS
LOW_MEMORY_RESTORE=PASS
LOW_MEMORY_DISABLE_NATIVE=PASS
LOW_MEMORY_CORE_FLOW_REGRESSION=PASS
TARGET_LOW_MEMORY_EVIDENCE=PASS
KNOWN_BAD_CONTROL=REJECTED
KNOWN_GOOD_CONTROL=ACCEPTED
DETERMINISTIC_VALIDATOR=PASS
ACTUAL_SURFACE_REVIEW=PASS
PRODUCER_P0=0
PRODUCER_P1=0
PRODUCER_P2=0
CANDIDATE_IDENTITY=PASS
PACKAGE=PASS
```

Milestone A 可以独立 push immutable candidate -> independent review -> minimal user acceptance if genuinely needed -> merge/release。

### Milestone B — Highlighter + PDF

必须全部通过：

```text
FOUNDATION_GATE=PASS
HIGHLIGHTER=PASS
HIGHLIGHT_AMBIGUITY_FAIL_OPEN=PASS
HIGHLIGHT_REMOUNT_RESTORE=PASS
PDF_TEXT_SEARCH_SELECT=PASS
PROSE_INLINE_MATH_PROSE_POINTER_SELECTION=PASS
DISPLAY_MATH_SELECTABLE=PASS
MATH_COPY_RESULT=PASS
MATH_SEARCHABLE=PASS
WEB_HIGHLIGHT_CROSS_MATH_TO_PDF=PASS
ACTUAL_PDF_VIEWER_REVIEW=PASS
KNOWN_BAD_CONTROL=REJECTED
KNOWN_GOOD_CONTROL=ACCEPTED
DETERMINISTIC_VALIDATOR=PASS
ACTUAL_SURFACE_REVIEW=PASS
PRODUCER_P0=0
PRODUCER_P1=0
PRODUCER_P2=0
CANDIDATE_IDENTITY=PASS
PACKAGE=PASS
```

Advanced Reliability、Notion、secondary Markdown/LaTeX export 不阻塞 Milestone B，也不得被标成已完成。

每个 product milestone 都：

1. push exact immutable review candidate；
2. final independent review；
3. GPT Work only after internal closure and only for holistic UX/product quality；
4. minimal user acceptance only when genuinely needed；
5. merge；
6. package/tag/prerelease as authorized；
7. update issue closure matrix；
8. safe cleanup only after unique work preservation。
---

## 21. Stop rules

Stop dependent execution only for:

```text
STOP_PLANNER_DECISION_REQUIRED
HUMAN_ONLY
SAFETY_OR_AUTHORITY_BLOCKER
UNSUPPORTED_WITH_EVIDENCE
```

Do not stop for:

- ordinary repo work;
- fixture updates;
- local browser harness;
- adapter repair;
- deterministic tests;
- screenshot review;
- PDF validation;
- evidence packaging;
- reviewer findings.

If the same failure repeats twice without new information:

```text
STOP BLIND RERUN
-> inspect source
-> inspect validator
-> inspect fixture/control fidelity
-> inspect actual surface
-> identify root cause
```

---

## 22. Final report

Final result must start with what the user actually gets.

Then record:

```text
RESULT=
FINAL_COMMIT=
FINAL_VERSION=
FOUNDATION_GATE=
MILESTONE_A_LOW_MEMORY=
MILESTONE_B_HIGHLIGHT_PDF=
CHATGPT_UI_REFRESH=
LOW_MEMORY_TRUNCATION=
HIGHLIGHTER=
PDF_MATH_SELECTION=
DEFERRED_RELIABILITY=
DEFERRED_NOTION=
KNOWN_BAD_CONTROL=
KNOWN_GOOD_CONTROL=
PRODUCER_P0_P1_P2=
DETERMINISTIC_VALIDATOR=
ACTUAL_SURFACE_REVIEW=
GPT_WORK=
HUMAN_REVIEW_COUNT=
EXTERNAL_TOOLING_REQUIRED_FOR_NORMAL_USE=
RESIDUAL_RISKS=
```

Do not report `complete` if a hard product gate is missing.

---

## 23. Start now — canonical Codex execution order

The Planner/Critic phase is complete. **The next step is Codex implementation.**

Execute this same Goal continuously:

```text
skills/session preflight
-> source/checkpoint preservation + legacy inventory
-> current ChatGPT surface evidence
-> product/UI freeze
-> acceptance schema + controls skeleton
-> ChatGPTAdapter + AnswerDocument core
-> actual normal UI shell + Troubleshooting + Developer QA
-> compatibility refresh
-> Foundation Gate validation
-> Low Memory feasibility
-> Low Memory implementation/migration
-> Milestone A candidate freeze/validation/review
-> Milestone A merge/release when accepted
-> built-in Highlighter
-> PDF export + selectable-math + highlight-preservation
-> Milestone B candidate freeze/validation/review
-> Milestone B merge/release when accepted
```

Deferred after Milestone B unless the user reprioritizes:

```text
advanced Reliability (~60s no-progress recovery)
Notion
secondary Markdown/LaTeX export enhancements
arbitrary non-ChatGPT webpage highlighting
```

This order is mandatory:

- Foundation first;
- then Low Memory;
- then Highlighter;
- then PDF;
- deferred features may not consume substantial implementation or review budget before those close.

Do not create another ordinary successor Goal.

Stop only for a genuine new product decision, HUMAN_ONLY action, safety/authority blocker, or unsupported-with-evidence condition.
