# Mica Product System Rebuild Goal

Status: **PLANNER DRAFT — DO NOT EXECUTE UNTIL INDEPENDENT GPT CRITIC PASS**  
Date: 2026-10-12

```yaml
task_key: mica--product-system-rebuild
repository: YuukiAS/Mica-for-ChatGPT
mode: discover_critic_plan_execute_validate_review_release
execution_model: planner_draft_then_independent_gpt_critic_then_one_durable_codex_goal
planner_authority: docs/product/MICA_PRODUCT_SYSTEM_V1.md
prebuild_critic: docs/reviews/2026-10-12-mica-product-system-gpt-critic-prompt.md
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

Highlighter、PDF、Notion 是本 Goal 后半段的重要产品能力，但不得在产品系统、兼容层和验收架构成型前各自继续长出独立实现。

---

## 1. Current authority

当前 Planner 权威只有：

```text
docs/product/MICA_PRODUCT_SYSTEM_V1.md
docs/tasks/2026-10-12-mica-product-system-rebuild-goal.md
docs/reviews/2026-10-12-mica-product-system-gpt-critic-prompt.md
docs/reviews/2026-10-12-mica-product-system-critic-r1-disposition.md
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

## 4. Independent GPT Critic — mandatory before Codex kickoff

这是 major/recovery 级产品与交付架构重建，因此 **当前文件仍是 Planner draft，不是可执行 Codex Goal**。

禁止让 Codex Parent、Producer 或任何 Codex 子代理自行启动、替代或满足这一层 Critic。

下一步必须在一个 fresh independent GPT context 中执行：

```text
docs/reviews/2026-10-12-mica-product-system-gpt-critic-prompt.md
```

GPT Critic 必须审核完整方案，而不只是实现细节，至少覆盖：

```text
产品定位
正常 UI / Troubleshooting / Developer QA
当前 ChatGPT UI 适配与后续 refresh
Low Memory
AnswerDocument / Copy / Highlighter / PDF / Notion
Reliability
开发架构
验收器与 known-good / known-bad controls
actual-surface review
GPT Work / Codex / ChatGPT Planner / user 分工
旧 Atlas / 旧 UI / 旧测试体系清理
source-of-truth / Git / release
scope 与过度工程风险
执行纪律与 Human Gate
```

只有 GPT Critic 返回：

```text
CRITIC_VERDICT=PASS
P0=0
P1=0
READY_TO_FREEZE_CODEX_GOAL=YES
```

Planner 才能根据 Critic 结果把本文件修订并冻结为最终可执行 Codex Goal。

在此之前：

```text
CODEX_IMPLEMENTATION_ALLOWED=NO
RUNTIME_UI_MUTATION_ALLOWED=NO
RELEASE_CLOSURE_ALLOWED=NO
```

如果 Critic 返回 `PLANNER_AMENDMENT_REQUIRED`：

1. ChatGPT Planner 消化 findings；
2. 更新 Product System / Goal；
3. 必要时处理真正的用户产品决策；
4. 使用 fresh GPT Critic 复审；
5. PASS 后才给 Codex kickoff。

Critic 结果不由 Codex 自己写入“PASS”；它是 Codex 执行之前的 Planner-level admission gate。

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

## 6. Rebuild the visible Mica product shell

完整调用 Frontend Design。

这是 **design-first** 阶段。

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

Producer 必须先完成真实 render self-review，P1/P2 未清零不得进入独立 review。

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

只有扩展 API 不足时，才允许调用 committed external helper。

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

## 10. Migrate and re-prove Low Memory

Low Memory 是核心功能。

不得降级成：

```text
Native handling
diagnostics only
no-op
```

必须在新架构下重新证明：

```text
LOW_MEMORY_TRUNCATION=PASS
```

至少覆盖：

- short/medium/long fixture；
- recent-message budget；
- actual memory/render cost；
- current ChatGPT native baseline；
- Mica additional benefit；
- load full history；
- disable -> native；
- reload；
- scroll history；
- send；
- streaming；
- edit/branch；
- connector；
- tool/file/auth；
- typing/IME hot path。

如果旧 checkpoint 的 low-memory 实现已经优秀，允许迁移/保留，但必须通过新 validator；旧 PASS 不能自动继承。

---

## 11. Migrate Copy & Export onto AnswerDocument

先建立：

```text
AnswerDocument
```

由 adapter 唯一生成。

支持：

- heading；
- paragraph；
- list；
- quote；
- table；
- code；
- inline/display math；
- link；
- citation；
- image；
- interactive/unknown block。

Copy Markdown / Copy for Notion / PDF 都消费 AnswerDocument。

不得每个 exporter 自己抓 DOM。

页面只保留一个 Mica answer action/menu。

---

## 12. Migrate Reliability onto adapter/state contracts

保留产品要求：

- send commit 必须以新 user turn identity 为主；
- fake-waiting/stall；
- stale response high-confidence；
- draft recovery；
- bounded retry；
- dedupe；
- consequential flow 禁止自动 resend；
- unknown fail-open。

但不再把内部状态暴露成普通 UI。

Troubleshooting 只给用户看：

```text
No issues
Recovered one stalled send
Compatibility changed; risky recovery paused
```

---

## 13. Then implement built-in Highlighter

Highlighter 现在才进入实现阶段。

读取：

```text
YuukiAS/Web_Highlighter
```

先做 provenance/license audit。

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
text quote
prefix/suffix
structural hint
math TeX source
```

Highlighter UI 只在 selection 后出现。

---

## 14. Then implement PDF Export and fix math selection

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
- search；
- highlight mapping；
- pagination；
- formulas；
- code/table；
- actual visual review。

如果某类复杂公式无法完全保持文本层，必须有明确 fallback 和用户可理解的边界，不能静默退化。

---

## 15. Notion

Copy for Notion 也必须消费 AnswerDocument。

测试：

- text/plain；
- text/html；
- headings/lists/code/table；
- inline/display math；
- many formulas；
- formula in lists/tables；
- deterministic fallback。

先用 local MIME/DOM harness。

真实 Notion 只在无法代理的最后语义确认时才使用，不能变成正常 regression 环。

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

## 19. Documentation cleanup

产品和 acceptance system稳定后：

- rewrite README to current truth；
- rewrite ROADMAP；
- mark old Goals superseded/historical；
- explain normal Mica use first；
- explain Developer QA separately；
- document external fallback commands only when truly necessary；
- remove stale version/status claims；
- keep one canonical development `dist/mica-dev` path。

---

## 20. Release

不要提前锁死具体 version number。

Source-of-truth audit 后选择 next appropriate SemVer；若 local 0.4 checkpoint 是真实 current lineage，预计下一 product-system milestone 应为新 minor，而不是伪装成旧 0.4 patch。

Release requires:

```text
PREBUILD_CRITIC=PASS
PRODUCT_SYSTEM=PASS
NORMAL_POPUP=PASS
TROUBLESHOOTING=PASS
DEVELOPER_QA=PASS
CHATGPT_ADAPTER=PASS
CHATGPT_UI_REFRESH=PASS
ACCEPTANCE_HARNESS=PASS
KNOWN_BAD_CONTROL=REJECTED
KNOWN_GOOD_CONTROL=ACCEPTED
LOW_MEMORY_TRUNCATION=PASS
COPY_EXPORT=PASS
RELIABILITY=PASS
HIGHLIGHTER=PASS
PDF_TEXT_MATH_HIGHLIGHT=PASS
NOTION=PASS
PRODUCER_P0=0
PRODUCER_P1=0
PRODUCER_P2=0
DETERMINISTIC_VALIDATOR=PASS
ACTUAL_SURFACE_REVIEW=PASS
GPT_WORK=PASS | NOT_REQUIRED_WITH_JUSTIFICATION
USER_IS_FIRST_QA=NO
CANDIDATE_IDENTITY=PASS
PACKAGE=PASS
```

Only then:

1. push exact review candidate;
2. final independent review;
3. minimal user acceptance;
4. merge;
5. package/tag/prerelease as authorized;
6. update issue closure matrix;
7. delete/supersede temporary work branches only when safe.

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
RELEASE=
PRODUCT_SYSTEM=
CHATGPT_UI_REFRESH=
LOW_MEMORY_TRUNCATION=
COPY_EXPORT=
HIGHLIGHTER=
PDF_MATH_SELECTION=
NOTION=
RELIABILITY=
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

## 23. Current next step and eventual Codex start order

**Current next step is NOT Codex implementation.**

First:

```text
fresh independent GPT Critic
-> Planner amendment if required
-> fresh GPT Critic PASS
-> freeze final Codex Goal
```

Only after that admission gate passes, the final Codex Goal should execute:

```text
skills/session preflight
-> source/checkpoint preservation
-> final product/contracts freeze
-> acceptance-harness skeleton + frozen validator design
-> current ChatGPT compatibility baseline
-> ChatGPTAdapter
-> visible UI shell
-> compatibility refresh
-> Low Memory migration
-> Copy/Export + Reliability migration
-> Highlighter
-> PDF/Notion
-> candidate freeze
-> deterministic validation
-> actual-surface review
-> repair/re-freeze/review as needed
-> GPT Work
-> minimal user acceptance
-> merge/release
```

Do not create another ordinary successor Goal after the final freeze.
