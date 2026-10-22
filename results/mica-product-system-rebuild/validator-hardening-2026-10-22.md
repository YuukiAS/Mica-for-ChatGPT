# Mica 验收器加固结果（2026-10-22 实施包）

本轮已经在现有 `mica--product-system-rebuild` Goal 和 `codex/mica-functional-convergence` 分支内完成验收器加固：没有新增 Goal、远程任务、subagent、handoff 或第二套验收框架；validator 从 `1.16.0` 升到 `1.17.0`，最终预检接受 13/13 个 known-good controls、拒绝 59/59 个 known-bad controls。新增的完整会话导出反例还复现并修复了一处真实产品漏口，因此运行时从 `0.5.12` 升到 `0.5.13`（`functional-convergence.14`）并重建 `dist/mica-dev`。本轮没有启动浏览器、没有操作真实 ChatGPT，也没有把旧候选或合成数据包装成当前产品通过。

## 1. 执行边界与起点

- 仓库：`D:/Code/Mica-for-ChatGPT`
- 分支：`codex/mica-functional-convergence`
- 用户给出的源码起点：`853b802b7463baa13b590cfb037533891fd0326e`
- 实际实施起点：`8dc3adcca57bfbd4d5be687a47d03ff2d5f19533`；本地先只读核对工作树，再以 `git merge --ff-only origin/codex/mica-functional-convergence` 取得仅含本任务文件的远端快进提交，没有回退或切换分支。
- 工作树：只有当前一个 worktree。实施前已有 `output/pdf/mica-answer-export-sample.pdf`、多项 `results/mica-product-system-rebuild/` JSON/PNG 和未跟踪 `artifacts/`；它们按既有工作处理，未清理、stash、restore、整体暂存或拿来冒充本轮证据。
- 顺序：继续遵守 Foundation → Low Memory → Highlighter → PDF；高级恢复、普通网页、导入和 ChatGPT UI compatibility 只复用既有纯 Node 保护，没有扩展现场能力。
- 权限边界：未启动 Chromium/Edge，未访问登录态 ChatGPT、Notion 或真实 PDF viewer，未重启服务或 session，未发布 Release。

## 2. 真实计数

| 计数 | 数量 | 口径 |
|---|---:|---|
| `NEW_VALIDATORS` | 0 | 没有新增独立 gate、validator kind 或第二套 harness。 |
| `ENHANCED_VALIDATORS` | 2 | `low-memory-benefit` 与 `conversation-export-completeness` 两个既有专业 validator；CLI 的机器可读结果属于 runner 增强，不另算 validator。 |
| `NEW_REGRESSION_CASES` | 13 | 8 个已进入 control catalog 的 bad controls，加 5 个生产模块代表性回归组；unknown/opaque/任意未知 block 的三条断言按同一“不完整内容”代表组只计一次。 |
| `REUSED_VALIDATORS` | 18 | 20 个既有 gate validator kinds 中，除上述两项外的 18 项均未经改动并由最终 preflight 实际复用。 |
| `MERGED_OR_RETIRED` | 0 | 没有合并或退休旧检查；旧坏例和旧正确行为全部仍由原 runner 消费。 |

计数不包含重跑、截图、复制出来的证据文件、版本字段、schema 枚举补全或文档修改。

## 3. 增强项及其作用

### 3.1 `low-memory-benefit`（ENHANCE）

它防止过去只挑一个最好数值、只隐藏 5–9 个 DOM 节点、或关闭 Highlighter/PDF/导出/可靠性后端来制造 Low Memory 收益的错误；`acceptance:preflight`、`acceptance:focused` 与 `acceptance:candidate` 都沿同一个 `validateBundle` 路径调用它；`low-memory-dom-only-rehash`、`low-memory-cherry-picked-sample-rehash` 和 `low-memory-features-disabled-rehash` 已被识别；它继续保护冻结的 10% process / 15% heap、15% retained-content、延迟预算、完整恢复和真实设备证据等级；运行证据见 `validator-hardening-2026-10-22/preflight.json` 及两个历史候选重判 JSON。

具体变化是 A/B/C 的 process、heap、retained content、mounted turns、mutations、typing p95 和 scroll p95 都必须提交与 `samples` 等长的完整数列，聚合值必须等于数列中位数；A/B 必须关闭 Low Memory，C 必须开启；B/C 必须绑定同一组完整的非 Low-Memory capabilities 和同一 SHA-256 feature-flags identity。冻结阈值没有放松。

### 3.2 `conversation-export-completeness`（ENHANCE）

它防止未知/交互内容、重复身份、调用方伪造 AnswerDocument 生产者或不支持角色在被过滤后仍宣称“完整会话”的错误；正常 preflight/candidate runner 会读取生产 fixture 的五个新增不变量；`forged-incomplete-content-accepted-rehash` 已被拒绝；它保护 settled-only、精确 turn/role 顺序、Markdown/PDF 组装、表格内公式、MathML 预算和安全链接等原有正确行为；证据见 `conversation-export.json` 与 `preflight.json`。

生产代码同步采用 fail-closed：完整会话只接受 `MicaChatGPTAdapter` 产生的文档、唯一 turn/document identity、`user`/`assistant` 角色和明确 block/inline 白名单。`unknown_block`、`opaque_interactive` 及任何未来未知 kind 都会让整次“完整导出”失败，而不是静默删掉内容。因为这是可加载扩展的运行时行为变化，版本按仓库规则升到 `0.5.13` 并重建稳定开发目录。

### 3.3 canonical CLI 结果（RUNNER ENHANCE，不计入 validator）

它防止未来消费者只能解析扁平 stdout、自行猜测每个 gate 的 PASS/FAIL/UNKNOWN 或丢失候选绑定的错误；三个正常命令都支持 `--output <repo-relative-path>`，保存与 stdout 同源的 `mica.acceptance-run.v1` JSON；历史候选的 validator/tree/fixture 身份错误和 Low Memory gate 失败被 Executor 实际读取；原来的直接 CLI 消费仍受保护；证据见本轮三个 CLI JSON。绝对路径及仓库外路径会被拒绝。

JSON 保留 `ok`、`errors`、`identity.requiredGateIds`、候选和 report context、逐 gate 状态与原因、artifact descriptors、原始 evidence references、标准/validator 版本、实际 argv 以及失效条件。证据缺失或 evidence class 不足映射 `UNKNOWN`，已提供证据违反冻结标准映射 `FAIL`，不能把所有拒绝都说成产品坏。

## 4. 新增回归案例逐项作用

| # | 案例 | 防止的旧错误与正确行为 | 正常调用与证据 |
|---:|---|---|---|
| 1 | `wrong-validator-version` | 防止旧 validator 身份被当作当前结论；保护精确版本绑定。 | `acceptance:preflight`；`preflight.json` |
| 2 | `wrong-fixture-set-hash` | 防止替换 fixture/control set 后沿用旧结果；保护完整 fixture-set SHA-256。 | 同上 |
| 3 | `wrong-contract-hash` | 防止候选指向错误 ChatGPT contract；保护当前 contract artifact/hash 绑定。 | 同上 |
| 4 | `duplicate-required-gate` | 防止用重复 gate 伪装完整 profile；保护 profile 与 required-gate 集合相等。 | 同上 |
| 5 | `low-memory-dom-only-rehash` | 防止仅 CSS/DOM 隐藏冒充客户端历史截断；保护 `actualTruncation` 与恢复语义。 | 同上 |
| 6 | `low-memory-cherry-picked-sample-rehash` | 防止从完整数列中挑最好值；保护聚合值等于完整重复样本中位数。 | 同上及 `historical-low-memory-focused.json` |
| 7 | `low-memory-features-disabled-rehash` | 防止关闭其他功能后制造资源收益；保护 B/C 非 Low-Memory 功能等价。 | 同上 |
| 8 | `forged-incomplete-content-accepted-rehash` | 防止 fixture 声称未知/交互内容已拒绝但实际字段为 false；保护完整导出 fail-closed。 | 同上 |
| 9 | duplicate turn identity | 防止两条 turn 复用同一 ID；保护完整、可排序的 turn identity。 | `node scripts/conversation-export-fixture.mjs`；`conversation-export.json` |
| 10 | duplicate document identity | 防止不同 turn 复用同一 AnswerDocument；保护 document/turn 一一对应。 | 同上 |
| 11 | unsupported content group | 防止 opaque、unknown 或未来任意未知 block 被丢弃后仍标完整；保护已知 block/inline 白名单。 | 同上；三条注入断言按一个代表组计数 |
| 12 | unproven document producer | 防止调用方构造 SETTLED 文档越过 adapter；保护 `MicaChatGPTAdapter` 来源。 | 同上 |
| 13 | unsupported role | 防止 tool 等非 user/assistant role 进入完整导出；保护 role sequence proof。 | 同上 |

## 5. 实际运行

### 5.1 运行记录

| 检查 | 完整命令 | 退出码 | 耗时 | 结果 |
|---|---|---:|---:|---|
| 基线 preflight | `npm run acceptance:preflight` | 0 | 7.338 s | validator 1.16.0：13 good 接受、51 bad 拒绝。 |
| 最终 preflight | `npm run acceptance:preflight -- --output results/mica-product-system-rebuild/validator-hardening-2026-10-22/preflight.json` | 0 | 9.316 s | validator 1.17.0：13/13 good 接受、59/59 bad 拒绝。 |
| 当前 build + export focused | `npm run build`，随后 `node scripts/conversation-export-fixture.mjs` | 0 / 0 | 2.2 s 合计 wall time | `0.5.13` 构建完成；五个新增完整性不变量均为 true。 |
| compatibility | `npm run test:chatgpt-ui-compatibility` | 0 | 1.258 s | PASS。 |
| record integrity | `node scripts/highlight-record-integrity-fixture.mjs` | 0 | 0.105 s | PASS。 |
| local import | `node scripts/local-import-integrity-fixture.mjs` | 0 | 0.139 s | PASS。 |
| recovery | `npm run test:recovery-controller` | 0 | 1.022 s | policy、ledger、controller 均 PASS。 |
| target surfaces | `node scripts/target-surface-backend-fixture.mjs` | 0 | 0.534 s | PASS。 |
| build validation | `npm run test:build` | 0 | 0.869 s | manifest、popup、diagnostics 与 `0.5.13` 一致。 |
| 历史候选完整重判 | `npm run acceptance:candidate -- --bundle results/mica-product-system-rebuild/highlight-pdf-candidate/e510461d7f94fcdeecd37bb0e97c8d204c4e5463 --output results/mica-product-system-rebuild/validator-hardening-2026-10-22/historical-candidate-revalidation.json` | 1（预期拒绝） | 1.005 s | 总体 FAIL；11 gate PASS，Low Memory FAIL；旧 validator/tree/fixture 身份失效。 |
| 历史 Low Memory focused | `npm run acceptance:focused -- --bundle results/mica-product-system-rebuild/highlight-pdf-candidate/e510461d7f94fcdeecd37bb0e97c8d204c4e5463 --gate low-memory-benefit --output results/mica-product-system-rebuild/validator-hardening-2026-10-22/historical-low-memory-focused.json` | 1（预期拒绝） | 1.069 s | FAIL；旧包缺完整样本序列和 B/C 功能等价绑定。 |

历史候选的非零退出是 validator 正确拒绝旧证据，不是本轮程序崩溃。当前 `0.5.13` 没有在本轮权限边界内可合法产生的真实浏览器/低配设备/PDF viewer 候选 bundle，因此没有伪造新的 candidate manifest 让它变绿。

### 5.2 原始证据

- `results/mica-product-system-rebuild/validator-hardening-2026-10-22/preflight.json`
- `results/mica-product-system-rebuild/validator-hardening-2026-10-22/historical-candidate-revalidation.json`
- `results/mica-product-system-rebuild/validator-hardening-2026-10-22/historical-low-memory-focused.json`
- 同目录的 `conversation-export.json`、`chatgpt-ui-compatibility.json`、`highlight-record-integrity.json`、`local-import-integrity.json`、`recovery-actions.json`、`recovery-ledger.json`、`target-surface-backend.json` 和 `built-manifest.json`

这些文件是本轮独立副本，没有覆盖实施前已经脏的 PDF、PNG 或历史结果。机械 control PASS 证明 validator 能识别这些反例；纯 Node 生产 fixture PASS 证明相应模块行为；两者都不等于独立实际产物审查通过。

## 6. 未运行或仍为 UNKNOWN

| 范围 | 状态与原因 | 同一 Goal 恢复入口 |
|---|---|---|
| 当前 `0.5.13` 的 `acceptance:candidate` | UNKNOWN；没有真实浏览器、目标低配设备和 actual PDF viewer 新证据，不能造包。 | 权限边界解除并取得原始实际证据后，对同一实际 candidate 目录运行 canonical `acceptance:candidate -- --output ...`。 |
| `npm test` | 未运行；命令链包含 browser fixtures，与本轮“不启动浏览器”冲突。 | 后续按 testing ladder 在隔离本地 Chromium 中运行。 |
| `npm run test:e2e` | 0 次；同上。 | 当前候选获得浏览器执行授权后只跑一次候选级 full E2E。 |
| `npm run test:e2e:stress` | 未运行；既有 stress 使用浏览器，且本轮没有新的浏览器 race 候选。 | 仅在普通 E2E 显示 flake、重大生命周期改动或阶段候选明确需要时运行。 |
| 真实 ChatGPT DOM/登录态 | UNKNOWN；明确禁止操作。 | 用户手动 reload `dist/mica-dev` 后按既有 popup `Copy report` 路径提供最小结构证据。 |
| 目标低配物理机 | UNKNOWN；无设备/实际测量授权。 | 在同负载 A/B/C、完整 runtime 和重复样本合同下采集。 |
| PDF viewer 连续选择/搜索/复制 | UNKNOWN；未启动查看器。 | 使用 actual-viewer 证据类完成正文—行内公式—正文、展示公式及跨页高亮。 |
| Notion 原生公式 | UNKNOWN；未访问 Notion。 | 仍需 REAL_NOTION_TARGET；本地 contenteditable 不替代。 |
| 独立 Reviewer/实际产物审查 | 未执行；本执行会话不自签，也不等待中央 DA。 | 沿原 Goal 的现有审查/用户手动边界收口。 |

## 7. HISTORICAL_COVERAGE（Mica:M01–M46）

| source_scoped_id | 当前分类 | 动作、检查路径与证据/未证原因 |
|---|---|---|
| Mica:M01 | 环境待验 | REUSE `low-memory-benefit`；真实长对话目标低配设备仍 UNKNOWN，本轮不把 control 当收益。 |
| Mica:M02 | 可靠保护 | ENHANCE；`low-memory-dom-only-rehash` 已拒绝，原生 5–9 挂载节点不能替代内存收益。 |
| Mica:M03 | 证据等级边界 | REUSE；TARGET_LOW_MEMORY_DEVICE 与受限 heap 环境继续分开，物理设备未验。 |
| Mica:M04 | 可靠保护 | ADD_CASE；错误 validator/fixture/contract 身份与旧 candidate 已被拒绝，版本升到 0.5.13。 |
| Mica:M05 | 历史已修待浏览器回归 | REUSE `send-lifecycle-safety`；本轮未启动浏览器，不归因真实 ChatGPT 行为。 |
| Mica:M06 | 可靠保护 | REUSE recovery policy/controller；纯 Node PASS，仍不声称真实消息已提交。 |
| Mica:M07 | 可靠保护 | REUSE target-surface/recovery structural progress；纯 Node PASS，实站根因仍未验。 |
| Mica:M08 | 可靠保护 | REUSE send safety 和 recovery；新草稿/未确认提交不自动清除，浏览器回归待跑。 |
| Mica:M09 | 可靠保护 | REUSE target-surface `no competing observer`；本轮未增加 observer 或输入热路径逻辑。 |
| Mica:M10 | 可靠保护 | REUSE recovery-action-safety；只允许精确新鲜原生控件，未知对话框不动作。 |
| Mica:M11 | 环境待验 | 合成 fixture 通过不等于真实 ChatGPT；继续保留手动 acceptance。 |
| Mica:M12 | 正式替代 | 本轮只增强 canonical acceptance runner，没有新 Atlas、探针平台或第二状态库。 |
| Mica:M13 | 历史已修待浏览器回归 | REUSE popup/copy-placement controls；真实按钮位置和 popup 易用性仍 UNKNOWN。 |
| Mica:M14 | 可靠保护 | ADD_CASE `low-memory-features-disabled-rehash`；主要/相邻功能关闭不能制造完成。 |
| Mica:M15 | 可靠保护 | ENHANCE native invalidation list；没有新 Goal，旧 candidate 重判为 FAIL。 |
| Mica:M16 | 文档一致性处置 | README、ROADMAP、功能矩阵和版本同步到 0.5.13；没有改原 Goal。 |
| Mica:M17 | 可靠保护 | REUSE 冻结收益阈值并新增完整样本中位数绑定；阈值未放松。 |
| Mica:M18 | 历史设计已修 | REUSE Foundation-first 顺序；本轮不是用视觉设计替代产品路径。 |
| Mica:M19 | 可靠保护 | REUSE `chatgpt-ui-compatibility`；纯 Node PASS，当前实站来源仍需 Developer QA。 |
| Mica:M20 | 可靠保护并修复漏口 | ENHANCE conversation completeness，REUSE record integrity；顺序、终态、公式、交互块和跨版本清理均有纯 Node 保护。 |
| Mica:M21 | 可靠保护 | REUSE recovery-dedup/action-safety；无正文进展不自动等于可执行恢复，纯 Node PASS。 |
| Mica:M22 | 可靠保护 | ADD_CASE/REUSE production validator path；最终 13 good/59 bad 全符合预期。 |
| Mica:M23 | 证据等级边界 | ENHANCE gate-native PASS/FAIL/UNKNOWN；缺真实 evidence class 不可写 PASS。 |
| Mica:M24 | 环境待验 | REUSE PDF gate；actual viewer 未运行，旧 0.3.0 结果不继承给 0.5.13。 |
| Mica:M25 | 环境待验 | Notion 仍需 REAL_NOTION_TARGET；本轮未把本地模型说成原生公式通过。 |
| Mica:M26 | 来源处置 | 必读来源、当前分支和实际 HEAD 已记录；未从旧分支覆盖当前实现。 |
| Mica:M27 | 正式替代 | 继续 Foundation → Low Memory → Highlighter → PDF，结果只写一个本任务入口。 |
| Mica:M28 | 可靠保护 | REUSE `forced-unknown-settled`，并新增 document producer proof；调用方不能自封 SETTLED 来源。 |
| Mica:M29 | 当前已证缺陷并已修 | 生产 `ConversationExport` 原先未在 collect 阶段拒绝 unknown/opaque；现以 block/inline 白名单 fail-closed，fixture PASS。 |
| Mica:M30 | 可靠保护 | REUSE artifact/evidence binding，新增 wrong contract/fixture controls；没有创建无原始观察的当前候选。 |
| Mica:M31 | 历史已修待浏览器回归 | compatibility/recovery 纯 Node PASS；焦点和实际输入变体仍需实站。 |
| Mica:M32 | 可靠保护 | REUSE missing/duplicate capability controls；最终 preflight 继续拒绝。 |
| Mica:M33 | 观察器边界 | 既有 adapter/placement 绑定仍在；本轮没有把 observation ID 本身当真实来源。 |
| Mica:M34 | 环境待验 | REUSE copy-placement controls；真实父容器、兄弟位置、尺寸仍需 current ChatGPT evidence。 |
| Mica:M35 | 可靠保护 | REUSE coherent-incomplete-placement-proof，并新增 identity/hash 反例；协调重哈希仍不等于实际观察。 |
| Mica:M36 | 裁剪正例 | 只跑受影响纯 Node 与一次最终 preflight，没有因 validator-only 部分强制全套浏览器重测。 |
| Mica:M37 | 环境待验 | 历史候选被 1.17.0 拒绝；真实上滑、可信恢复动作和目标设备仍需新候选。 |
| Mica:M38 | 观察器缺陷已加固 | ENHANCE 完整数列/中位数及 process/heap 分离；挑最好样本被控制集捕获。 |
| Mica:M39 | 可靠保护、浏览器待回归 | 既有 branch/tool/recovery 合同未删；本轮未跑浏览器 Low Memory 图截断回归。 |
| Mica:M40 | 历史实现取舍待浏览器回归 | 既有 registration/page 保护保留；跨 tab 动态注册窗口本轮未实测。 |
| Mica:M41 | 基础设施错误分类 | 本轮没有 PNG 打开故障；预期 validator 拒绝与程序崩溃分开记录。 |
| Mica:M42 | 实际命令记录 | 本机 npm 可用；只报告上表真实运行命令，未声称 `npm test` PASS。 |
| Mica:M43 | 当前能力边界 | canonical runner 验证 bundle，不证明观察发生或独立权限；报告和 JSON 明示此限制。 |
| Mica:M44 | 观察器缺陷部分加固 | 新增 5 个生产模块代表性回归组；control mutation 仍不替代浏览器端到端回放。 |
| Mica:M45 | 可靠保护 | 版本升到 0.5.13，旧 0.3.0 候选实际重判为 FAIL；旧报告不代表当前 HEAD。 |
| Mica:M46 | 仅担忧/未执行 | `icons` 仍含机器专有 Python 路径；本轮未运行 icon 生成，也未把它计为新增 validator。 |

## 8. FUTURE_DA_ADAPTER_ENTRY

未来 Delivery Assurance 的唯一推荐入口是：

```text
npm run acceptance:candidate -- --bundle <actual-candidate-directory> --output <repo-relative-result.json>
```

原生格式为 `mica.acceptance-run.v1`。未来薄 adapter 只需把顶层 `ok/errors`、`identity.gateResults`、candidate/report identity、required gate IDs、artifact descriptors、raw evidence references、validator/contract/fixture/evidence identities、实际 argv 和 invalidation conditions 转换到 DA；现有消费者仍可直接读取 stdout 或保存的同源 JSON。停用 DA 不影响本项目 runner。adapter 不得重写专业阈值、补造缺失证据、把 `UNKNOWN` 转成 `PASS`，也不得实现新的项目状态数据库。

## 9. 修改与未修改范围

已修改：canonical acceptance CLI/validator/control corpus/catalog/schema/contracts，conversation export 生产模块与 fixture，运行时版本和稳定 `dist/mica-dev`，当前 README/ROADMAP/功能矩阵，以及本轮独立结果证据。`acceptance/schema/bundle-v1.json` 只补回 validator 已支持但 schema 漏列的 `functional-convergence` profile。

未修改：原 Goal、AGENTS、冻结收益阈值/golden、中央 DA、Bridge/AI Skills、分支拓扑、远端配置、真实 ChatGPT/Notion/PDF viewer、VPN/Cloudflare/Tailscale、Slurm、SSH key、known_hosts、生产服务和 Release。既有高级恢复、普通网页、高亮记录、本地导入后端没有被删除或降级。

## 10. 提交、推送与重启状态

实现、结果和原始证据已由普通 task-owned commit `c5fc4a7`（`Harden canonical acceptance validation`）提交，并精确推送到既有 `origin/codex/mica-functional-convergence`。优先尝试的 bounded `ai-bridge host publish-current-branch` 因本机缺少 `ai_bridge_kit` 模块而无法启动；随后使用经过审批、只更新同一既有 ref 的精确 `git push origin HEAD:refs/heads/codex/mica-functional-convergence` 完成发布，没有修改 remote 或分支拓扑。本段状态修订由紧随其后的 report-only 提交落盘，其 hash 以最终用户交付消息为准。

没有重启或重连任何 session。本轮运行时变更只要求用户未来手动 Reload `dist/mica-dev` 才会进入浏览器，当前没有替用户执行。
