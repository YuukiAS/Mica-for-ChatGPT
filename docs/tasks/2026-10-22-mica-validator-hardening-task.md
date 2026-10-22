# Mica：在现有 Goal 内增强专业验收器

实施补充包，非新 Goal。既有 rebuild R2 架构批准继续有效；本任务不重开架构，也不因中央 DA 未开发而等待。新增专业标准或高风险判断变化才按原合同独立审查。

## 有效源码、工作树与权限

仓库 `YuukiAS/Mica-for-ChatGPT`，实际有效执行分支 `codex/mica-functional-convergence`，起点 `853b802b7463baa13b590cfb037533891fd0326e`；继承原 `codex/mica-product-system-rebuild@0aee22f3e04c2b8bcfd36663d8f3a3918b56e23c` 的成果。原 Goal 仍为 `docs/tasks/2026-10-12-mica-product-system-rebuild-goal.md`，task_key 为 `mica--product-system-rebuild`。不能回退旧分支、新开主 Goal 或重新做 Foundation。

本次读取已实际确认本地 `D:/Code/Mica-for-ChatGPT` 正在 functional-convergence 分支，HEAD 与 GitHub 相同；只有一个已列工作树。已有 Codex 任务“推进 Mica 后端功能收敛”会话当前 idle，但 Goal 保留；本地 `output/pdf/mica-answer-export-sample.pdf`、多项 `results/mica-product-system-rebuild/` JSON/PNG 及未跟踪 artifacts 仍为脏文件。它们归既有工作，不得清理、覆盖、自动拉取或整体暂存。默认交回同一任务继续；本文件不启动会话。

当前代码为 0.5.12，validator 为 1.16.0。当前 `docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.md/.json` 明确此次后端工作禁止启动浏览器、操作真实 ChatGPT；本任务保留该边界。高级恢复/Notion/普通网页的已加入后端成果不能因旧文档写 DEFERRED 而删除，也不能借本任务扩大现场测试。核心加固顺序仍为 Foundation → Low Memory → Highlighter → PDF；其余已有后端只做受影响旧保护。

必读原 Goal、`MICA_PRODUCT_SYSTEM_V1.md`、`MICA_FUNCTIONAL_CONVERGENCE_V1.md/.json`、AGENTS、ROADMAP、VERSIONING、`acceptance/README.md`、`acceptance/contracts.json` 和原 R2 verdict；对新旧文字的冲突用现有当前用户授权定位，不改 Goal 来迎合本包。

## 允许范围和具体实施

首选增强 `scripts/acceptance/{cli,validator,control-corpus}.mjs`，`acceptance/controls/catalog.json`、现有 schema/contract 的兼容字段、对应 fixture 与必要 package.json 接线。合同阈值/golden 不得由候选作者改松。runtime 修复只在当前 Goal 已批准范围内先复现再修；本任务优先验收器自身和案例，不重建 harness。

|职责、历史来源与动作|具体控制和保护|为什么现有检查仍需加固|
|---|---|---|
|候选/控制隔离 REUSE/ADD_CASE，M04/M22/M30/M32–M36/M43–M45|沿 validateBundle 同一代码路径；旧 report、错 dist/validator/contract/fixture hash、重复/缺 gate、把 control 当 candidate、删 requiredGates、协调重哈希仍缺实际观察必须拒绝。good 是现有完整控制，missing 缺源观察，unchanged 是未变 dist 的合法原始证据经新 validator 重判。|现有控制已覆盖许多攻击，先核 catalog 是否已有，已有直接复用；bundle 自洽仍不能证明采集真实或独立权限，不声称哈希等于隔离。|
|Foundation ENHANCE/ADD_CASE，M05–M13/M18–M20/M28–M35|原 AnswerDocument/adapter fixture：未知生成不得被调用方强置 SETTLED；unknown/opaque、工具和多归属不能过滤后宣称完整；原生 Copy 出现不能推导正确父容器、兄弟位置、尺寸。保留输入法、连接器、剪切/删空、remount、新草稿不误清和单一 observer 轻热路径。|已有 bad bundle 不能代产品坏实现；在纯模型/本地可执行 fixture 中注入实际错误，确保生产模块输出改变并被正常 validator 抓住。浏览器依赖部分待原权限恢复。|
|Low Memory ENHANCE/ADD_CASE，M01–M03/M14/M17/M37–M40|复用 low-memory-benefit/pressure/registration/page。A 无或禁用、B 安装关闭、C 安装开启同负载同完整 runtime；零收益、DOM-only 隐藏、全关功能、伪物理设备、挑最好样本、缺上滑/完整恢复、跨 tab 注册窗口错误都要识别。旧短中对话、stream/edit/branch/tool/attachment 保持。|已有 10% process 或15% heap、retained≥15% 等冻结门槛不得改松；heap 限制环境不是物理低配设备，二者证据等级分开，不能凭5–9挂载节点称收益。|
|Highlighter ENHANCE/ADD_CASE，M20/M24/M39|复用 highlighter fixture/stress 与 record-integrity：同语义锚点跨 remount/版本恢复；歧义不错误附着，正文与 TeX 顺序/高亮范围正确；当前回答清理必须同时匹配 conversation+turn，保留别的回答和会话。|控制集已有 lost-highlight/ambiguous/forged-answer-scope-clear；补缺失生产模块反例而非再增加同名 gate。未知字段不穿透存储/导出。|
|复制/PDF ENHANCE/ADD_CASE，M24/M25/M29|复用 pdf/conversation-export/background 与 actual-viewer selection 判定：正文—行内公式—正文连续指针选择、展示公式、搜索/复制、高亮跨公式继承；完整会话拒绝局部窗口、角色错序、重复ID、未settled。good 保真；bad 只提取文字但不可选择/错consumer；missing 无查看器证据；unchanged 代码/表格/TeX/来源和安全链接。|已有提取/模型证据不能替查看器，Notion rich clipboard 不能签真实 Notion 原生公式；维持各自未证状态。|
|新收敛后端旧保护 REUSE，M06–M10/M21|继续已有 recovery-deduplication/action-safety/target-surface/local-import/chatgpt-ui-compatibility 控制；保护已提交不重发、未知不自动动作、仅精确新鲜原生控件、存储失败不绕门槛、敏感正文不入诊断。|这些后端已存在；不因为此次是旧历史专项将其删掉，不用 live MISSING 冒能力完成。|

M16/M26/M27 的来源与顺序、M41 的基础设施错误、M42 实际命令、M46 工具路径都在结果单列处置：文档/环境问题不自动算新增验收器，更不生成第二个 Atlas。

## 正常命令与当前不启动浏览器的执行路线

先运行纯 Node `npm run acceptance:preflight`；定向用 `npm run acceptance:focused -- --bundle <本任务实际候选目录> --gate <现有gate-id>`，收口用 `npm run acceptance:candidate -- --bundle <同目录>`。CLI 仅验证 bundle，缺原始证据必须真实拒绝；不得造候选测量使其变绿。

当前允许的纯 Node 回归优先 `npm run test:chatgpt-ui-compatibility`、record/import/conversation-export/recovery 的确认为非浏览器脚本，以及 `npm run build`/`npm run test:build`；每次先读对应命令链。当前 `npm test` 和 test:e2e 含 browser fixture，不能在“不启动浏览器”的当前指令下整串运行。准确记录只跑的子命令和未跑范围，不谎报 npm test PASS。原浏览器边界解除后，仍只用隔离本地 Chromium fixture，按原 Tier 1/2/stress 阶梯，不连接用户 Edge/ChatGPT 登录态。

真实 ChatGPT 加载/当前 DOM、低配物理机器、PDF viewer 和 Notion 只有原手动/独立实际产物边界能关闭；本轮不刷新用户会话，不自动提交提示词或操纵安全 UI。runtime 变化才按 release-config 更新版本并重建稳定 `dist/mica-dev`；纯任务或未加载 helper 不无故 bump，不发布 Release。

结果写 `results/mica-product-system-rebuild/validator-hardening-2026-10-22.md`，本次新证据放同名前缀独立子目录，避免覆盖当前脏产物。未来 DA 推荐单一入口是 `acceptance:candidate` 的原生结构化 stdout（保存为本次候选验证 JSON），保留 ok/errors/identity/requiredGateIds 和所引 bundle 原始证据，UNKNOWN 由证据缺失原因映射，不能把一切拒绝都称产品坏。沿当前 Goal 原产物审查和用户手动边界收口，不新增架构轮次；普通提交只包含本任务文件，推送沿既有授权 helper，不切分支/merge/tag。

## 执行方法、准入与成本

本文件是准备完成的实施包，不是本轮已执行、独立批准或产品通过的证明。用户将本任务交给当前合法 Codex 执行入口后，在已有授权和专业标准内 IMPLEMENT：回读本仓规则与当前任务 → 核对下列已有程序及当前调用关系 → 先冻结适用的 good/bad/missing/unchanged 输入与预期 → 增强原程序或加案例 → 接入原正常 runner → 运行当前合法目标 → 按产品/观察器/环境/标准归因修复 → 重跑受影响检查 → 写真实结果。发现历史失败先核当前源码与证据；没有复现不得擅改已修产品。

动作仅取 REUSE、ENHANCE、ADD_CASE、NEW、REPAIR_HARNESS、MERGE/RETIRE、BLOCKED_REAL_EVIDENCE。NEW 必须证明观察对象或失败含义确实不同，说明现有程序为什么不能承担；同类检查缺样例只 ADD_CASE，误报漏报先 REPAIR_HARNESS。合并/退休须保留旧坏例、旧正确行为和消费者去向，不设新增数量配额。

专业标准沿本仓有效合同。既有冻结标准内的低成本小回归继续使用原授权；新专业判断、阈值/golden/来源/观察器变化、严重假绿、产品和验收器实质联动修改，须由已有独立 Reviewer/Verifier/GPT Work 途径批准相应候选与控制集。候选作者不能同时改标准答案制造通过。独立审查不由本执行会话自签，不默认创建 subagent、远程任务、schedule 或第二评审平台。本专项提供一份六仓协调审查入口；各仓单独裁定，任一仓等待不阻其他仓。实际高影响权限仍由用户决定，审查通过不能代替授权。

开始时核 repository/branch/HEAD、git status 与 git worktree list、当前 Goal/已存在任务和 owner。本文 SHA 是读取基线，不是要求回退：HEAD 前进时比较差异并记录新的实际起点；同范围新增代码要纳入，标准或权限变更则停依赖部分。不得切换/新建分支、重置、stash、restore/clean、覆盖既有 Goal、修改别的任务结果或抢占其运行资源。脏工作只记录归属，无法确认的文件不动；无权或无法查看远程工作树时记录未核实，不能声称无冲突。

只修改下列项目范围内的验收逻辑、测试、隔离 fixtures、必要 runner 接线和本任务结果。产品 bug 必须先有复现回归，且仅在现有明确批准的产品代码范围修复；其他产品改动交回原 owner，不把本验收任务扩成新产品设计。不得修改根规则、生产配置、发布状态、现有 Goal、中央 DA、Bridge 或 AI Skills 源码。

先运行最便宜、最相关的检查；共享状态/格式/runner 变更扩展到受影响旧能力，收口再跑项目规定的累计阶梯。不为文档变化打开真实产品或全量设备。沿原预算，不新增付费 API，不无限重复相同失败；第二次相同失败且无新证据时先判断根因，保存具体恢复点。缺账号、设备、现场权限或独立结论只停依赖路径，可合法的程序/隔离样本工作继续。未运行、跳过、崩溃、超时和缺证据分别报告，退出 0 不自动等于专业通过。

## 未来 Delivery Assurance 的薄适配

本专项消费已通过的 DA 设计原则，完全不依赖其 P0、Hook、共享核心或最终签发。复用本仓现有 JSON/报告；只补确实缺失的信息：稳定检查名、适用对象与候选身份、标准来源/版本、实际 argv/正常入口、逐项原生结果和原因、原始证据路径、检查/观察器版本及失效条件、历史来源 ID。本仓 PASS/FAIL/未证语义可在未来映射 PASS/FAIL/UNKNOWN。

正常 runner 必须实际产生并保存逐项结果，当前 Executor 实际读取失败并修复；原结果入口必须保留缺项和未证范围，不能只写自评 READY。这是项目内结果消费，不宣称已实现 DA 的正常 host 结束拦截。未来薄 adapter 从本任务指定的单一既有结果入口读取并转换；不实现 da/2 GateDescriptor/ProjectAdapter 全协议、激活服务、通用控制器或新状态数据库。停用未来 DA 时项目检查仍可直接运行。

## 交付与真实计数（由实施 Codex 填写，禁止预填）

在本任务指定的结果文件中，用实际 diff、正常 runner 调用和原始运行记录填：

- NEW_VALIDATORS：真正新增独立检测语义且已接入正常 runner 的类别数。
- ENHANCED_VALIDATORS：实际增强的原验收器数；同一验收器改多处只计一次。
- NEW_REGRESSION_CASES：实际新增且已运行的代表性案例数；参数展开、重跑、截图和辅助文件不重复计数。
- REUSED_VALIDATORS：未修改而实际复用的既有检查数。
- MERGED_OR_RETIRED：数量、旧名称、替代者、所有旧坏例与受保护行为去向。
- ACTUALLY_RUN：检查名、完整命令、退出码、逐项结果、当前代码/产物/运行身份和原始证据。
- NOT_RUN_OR_UNKNOWN：未跑的准确范围、缺少的账号/设备/权限/独立结论或阶段前提，以及同任务恢复入口。
- HISTORICAL_COVERAGE：下列所有原始 source_scoped_id 逐项对应当前已证缺陷、历史已修待回归、可靠保护、观察器缺陷、正式替代、环境待验或仅担忧；写动作、检查路径、运行证据或未证原因。不能删除 ID，也不能将历史条数当当前缺陷数。
- FUTURE_DA_ADAPTER_ENTRY：一个推荐结果入口、原生数据格式、候选绑定及现有消费者；标明未来只转换、不重写专业逻辑。

每个新增/增强项目必须写一条完整中文：“它防什么过去的真实错误；何时由哪个正常命令调用；哪个坏例被识别；保护哪项正确行为；证据在哪里”。机械检查通过、原生成品通过、独立审查通过分别报告。NEW_VALIDATORS=0 可以正确；程序存在、fixture 绿或旧审查通过不能算当前产品通过。结果还须写修改/未修改范围、验证限制、commit/push 状态及是否需重启/重连；未经授权不执行重启或发布。

## 共同来源

[六仓主任务](https://github.com/YuukiAS/AI_Research_Toolkit/blob/research/software-production-decision-20261013/docs/research/software-production/23_SIX_REPO_VALIDATOR_SPRINT_20261022/GPT_WORK_MASTER_PROMPT.md)；同研究分支 `22_DELIVERY_ASSURANCE_GLOBAL_WORK_RESEARCH_20261022/WORK_OUTPUT/` 的 02、03（E4–E8、R1-AR02、F4、R2）、04、06 仅给兼容方向；`12_COMPLEX_DELIVERY_REQUIREMENTS_INTAKE_20261015/11_RAW_CASES_ONLY_NO_SOLUTION_MAPPINGS.csv` 与 `22_DELIVERY_ASSURANCE_GLOBAL_WORK_RESEARCH_20261022/WORK_OUTPUT/05_HISTORICAL_COVERAGE.csv` 给历史原 ID 和设计映射，不能当当前运行证明。研究仓 main 的 `COMPLEX_SYSTEM_DESIGN_GUIDE.md` 与 AI_Skills_Collection main 的 `docs/workflows/{PLANNER_ROLE_CONTRACT,CRITIC_ROLE_CONTRACT,PLUGIN_CAPABILITY_GATE_POLICY}.md` 保留独立准入和专业边界；不引入它们的中央实施工程。

## 历史范围索引

Mica:M01–M46 共46条。早期“延后”记录保持历史含义，当前功能状态以853b802的功能矩阵为准，不把旧记录变成删除新能力的命令。

- `Mica:M01`：LightSession 在当前 ChatGPT 一直等待消息，长对话性能目标没有兑现。[I1]（历史目标来源，不能假定根因一直相同）
- `Mica:M02`：ChatGPT 已原生窗口化，只有约 5–9 个挂载消息；旧 containment 不再能当主性能方案。[I2]（真实调查结论；版本相关）
- `Mica:M03`：Windows 大内存功能检查被误用为低内存目标设备性能结论的风险。[I2；ML]（证据等级边界）
- `Mica:M04`：主线、分支、公开 ZIP、实际加载版本长期不同；旧发布早于修复。[I6；MH §2]（历史明确故障来源）
- `Mica:M05`：发送后原文残留、全选删除/剪切时输入框塌陷、连接器选择后重建；无 Mica 机器也复现。[I5、I6]（宿主/扩展归因未可混同）
- `Mica:M06`：输入框清空或“思考中”被当发送成功，实际消息未提交。[I4]（已观察宿主/网络故障模式；高级恢复当前延后）
- `Mica:M07`：新问题后显示上一回答，可能是旧 DOM/消息复用或未提交，不应仅语义猜测。[I4]（观察与根因候选分开）
- `Mica:M08`：未确认提交就直接清空草稿，会丢输入；提交后用户继续编辑又可能误删新草稿。[I5]（明确安全回归要求）
- `Mica:M09`：修 observer 时又加 observer，输入热路径和重建互相干扰。[I6；MG]（历史诊断/实现风险）
- `Mica:M10`：精确限流提示自动关闭可能扩大为通用对话框点击。[I3]（功能安全边界，不断言已发生越权）
- `Mica:M11`：多次本地全绿，真实 ChatGPT 同一问题仍失败；夹具不忠实反映按钮栏、输入状态及重建。[MH §2]（历史明确失败）
- `Mica:M12`：Atlas、诊断、探针和验收工具反客为主，产品能力长期未交付。[MH §2；MP 开头]（历史）
- `Mica:M13`：按钮乱放、UI 难用、正常弹窗堆开发状态，用户成为首轮 QA。[MH §2；MP §1]（历史）
- `Mica:M14`：通过默认关闭主要功能取得安全，仍宣称产品完成。[MH §2 第8项]（历史明确降级）
- `Mica:M15`：失败后反复新 Goal、新计划、让用户重试，旧证据跨候选复用。[MH §2]（历史）
- `Mica:M16`：README/ROADMAP 与真实源码及当前优先级不一致。[MH；MR2]（历史；R2 修订记录）
- `Mica:M17`：低内存需求缺可证伪收益门槛。[PD PSR-01]（方案缺陷，R2 已修改）
- `Mica:M18`：“调用前端设计”取代完整产品路径和设计冻结。[PD PSR-02]（方案缺陷已修订）
- `Mica:M19`：宿主适配缺逐能力来源/变体/新鲜度/失效范围，局部漂移可能拖垮所有功能。[PD PSR-03]（方案缺陷已修订）
- `Mica:M20`：回答语义模型缺顺序、版本/终态、数学来源、交互块及高亮冲突处理。[PD PSR-04]（方案缺陷，重构正实施）
- `Mica:M21`：一分钟无新文字被误当失败风险，恢复动作与实际提交证据未绑定。[PD PSR-05及澄清]（设计已区分结构进度；功能延后）
- `Mica:M22`：验收器缺防伪自检，无法区分有文件/哈希与真实生产路径。[PD PSR-06]（方案缺陷，现有 M-CONTROL 已新增实码）
- `Mica:M23`：实际产物审查缺证据等级，没看真正对象也可被表述通过。[PD PSR-07]（已修改合同）
- `Mica:M24`：PDF 文字提取/程序化文本层通过，但鼠标不能连续选正文—行内公式—正文。[PD PSR-08；I9]（已知外部参考缺陷和硬能力要求）
- `Mica:M25`：本地 contenteditable 夹具被用来推断真正 Notion 粘贴数学可用。[PD PSR-09；I10]（方案证据不足；Notion 当前延后）
- `Mica:M26`：草案把旧分支才有的文档当主线文件，来源和旧实现处置不明。[PD PSR-10]（设计缺陷已修订）
- `Mica:M27`：实施顺序不清、没有独立有用里程碑，并拟造多份重复权威文档。[PD PSR-11、13]（设计缺陷已收敛）
- `Mica:M28`：未知生成生命周期被调用方指定为已结束，生成可持久回答。[MR1]（重构历史实码缺陷，报告修复）
- `Mica:M29`：未识别内容、工具/多归属回答被过滤，剩余子集却称精确匹配；交互块丢失。[MR1]（重构历史缺陷）
- `Mica:M30`：候选测量未从绑定原始浏览器证据取得，能力与 bootstrap 对应错。[MR1]（重构历史缺陷）
- `Mica:M31`：排障/开发页返回后焦点未回到入口；输入框变体契约与实际观察不一致。[MR1]（历史 P2 修复记录）
- `Mica:M32`：能力 ID 缺失/重复/集合不相等仍可能通过。[MR2]（重构历史验收缺陷）
- `Mica:M33`：只写观察 ID，没有重新核对实际来源断言。[MR2]（重构历史缺陷）
- `Mica:M34`：仅识别原生 Copy 按钮就宣称回答归属、父容器、兄弟插入位置、尺寸均已证明。[MR3]（重构真实审查发现）
- `Mica:M35`：放置证明曾硬编码；后虽用契约/测量哈希绑定，协调改写所有对象仍能伪装完整。[MR3、MR4]（多轮验收器缺陷；R4 报告修复）
- `Mica:M36`：验收器唯一修复、运行包未变，却可能要求全套昂贵产品重测。[MR4]（当前记录给出正确裁剪正例）
- `Mica:M37`：低内存前候选缺真实上滑证明、恢复动作可信边界和正确环境分类。[ML]（后续独立审查三项 P1，报告已修）
- `Mica:M38`：性能数据可被挑选：JS 堆下降，不代表进程内存下降；限制堆不等于物理低内存设备。[ML]（当前报告明确区分的边界）
- `Mica:M39`：截断客户端图涉及关联节点和续流索引，可能破坏分支、工具和恢复。[ML]（当前机制需维持的强回归）
- `Mica:M40`：扩展级动态注册在单标签恢复窗口影响其它新标签。[ML]（已记录实现取舍，不自动算缺陷）
- `Mica:M41`：压力运行遇 PNG 文件打开故障，容易混成产品失败或悄悄改成通过。[ML]（报告正确记录过基础设施失败与复测）
- `Mica:M42`：系统没有 npm，实际用等价 Node/pnpm 脚本；不能报告未执行的 npm test。[MR1–MR4；ML]（已记录环境事实）
- `Mica:M43`：当前 `acceptance:candidate` 主要验证包内容，不能证明原始观察真的发生；同 repo 中契约/验证器可被同身份修改。[MC、MV]（当前源码能力边界，非已执行攻击）
- `Mica:M44`：preflight 的坏例多为证据包变异，不能代替产品真实坏实现的端到端回放。[MT]（当前测试层级）
- `Mica:M45`：主线、重构根 package 及不同里程碑报告版本不同；旧报告不代表当前 HEAD 全部通过。[MK；ML]（当前多候选事实，不自动判版本错误）
- `Mica:M46`：普通安装/图标生成含机器专有工具路径，跨机器可能失效。[MK]（当前可移植性观察，未执行验证）
