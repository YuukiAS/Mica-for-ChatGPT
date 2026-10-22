# Mica 功能收敛 V1

Mica `0.5.3` 是一次后端功能收敛候选，不是正式发布。它在 `codex/mica-product-system-rebuild` 的 Foundation、Low Memory、Highlighter 和 PDF 基础上，新增统一设置模型、AnswerDocument 驱动的 Markdown/Notion 序列化、完整会话导出、高亮记录迁移、有边界的断流恢复状态机，以及按站点授权的普通网页高亮运行时。当前用户明确禁止启动浏览器和操作真实 ChatGPT，因此本轮只把纯 Node、静态构建、存储合同和验收器控制集能够证明的部分标为已验证；真实页面交互、PDF 查看器和 Notion 原生公式均保留明确缺口。

配套机器矩阵位于 [`MICA_FUNCTIONAL_CONVERGENCE_V1.json`](MICA_FUNCTIONAL_CONVERGENCE_V1.json)。它是当前功能状态的唯一机器可读来源，README 和 ROADMAP 只做面向读者的摘要。

## 状态含义

| 状态 | 含义 |
| --- | --- |
| `IMPLEMENTED_VERIFIED` | 代码已进入当前构建，并有本轮允许范围内的自动验证。 |
| `IMPLEMENTED_UNVERIFIED` | 代码已进入当前构建，但本轮没有运行所需浏览器或真实目标验收。 |
| `MISSING` | 当前候选没有完成该能力，或只有设置项而没有运行时。 |
| `SUPERSEDED` | 历史实现已由当前架构替代，不应重新并行启用。 |
| `BLOCKED_BY_REAL_EXTERNAL_DEPENDENCY` | 本地工作已做到安全边界，结论仍依赖本轮明确禁止的真实网站、登录态、查看器或外部权限。 |

## 本轮架构边界

```text
ChatGPTAdapter
  -> AnswerDocument（唯一回答语义模型）
     -> Highlighter anchors
     -> Markdown / Notion serializer
     -> PDF export model

Low Memory validated graph
  -> 不含正文的完整性证明
     -> ConversationExportCoordinator
        -> 完整会话 Markdown / PDF

SettingsModel（schemaVersion 5）
  -> popup / options / content / service worker

RecoveryStateMachine（纯状态与安全策略）
  -> RecoveryController（提交后监听、会话快照、刷新后对账）
     -> RecoveryLedger（后台动作租约、去重、隐私历史）
```

新功能不得独立抓取回答 DOM。永久复制和导出只接受 `generationState=SETTLED` 且 `durable=true` 的 `AnswerDocument`；对话导出还必须显式证明所选范围完整。高亮、恢复和设置数据均留在浏览器扩展本地存储中。

## 已完成的后端能力

### 统一设置

`MicaSettingsModel` 将旧的扁平设置迁移到版本化 schema，并同时保留兼容字段。总开关不会删除子功能偏好。数值会被限制在安全范围内，`consequentialActionAutoReplay` 永远为 `false`，不能通过导入设置绕过。

设置页已经覆盖通用、高亮、复制与导出、低内存、可靠性、界面和故障排查。高亮记录与设置都可本地导入、导出和清理。页面运行效果本轮未做浏览器验收，因此设置页整体仍是 `IMPLEMENTED_UNVERIFIED`。

### Markdown 与 Notion 数据路径

`MicaAnswerSerializer` 只消费稳定的 `AnswerDocument`，保留标题、段落、强调、列表、引用、GFM 表格、代码语言、链接、图片和行内/展示数学。数学分隔符可在 `$...$` / `$$...$$` 与 `\(...\)` / `\[...\]` 之间选择；代码块和行内代码不会经过数学替换。

Notion 有两条清楚区分的路径：

- Rich clipboard 同时提供 `text/plain` 与 `text/html`，公式携带明确的行内/块级语义和 TeX 表达式；真实 Notion 是否把它转成可编辑原生公式尚未验证。
- Import file 生成确定性的 GFM Markdown 文件，用作一次导入的保底路径。它不冒充直接粘贴已通过，也不声称导入后一定是原生公式。

要求中的中文五公式样本已经进入纯 Node 回归，并检查五个行内公式的数量和顺序。

### 完整会话导出

完整会话导出不再接受调用方传入的 `completeSelection=true`。Low Memory 在裁剪客户端历史前，从已经通过全图校验的当前分支生成可见 turn 数量和角色顺序哈希；用户选择加载完整历史时，这份不含正文的证明会按 tab 保存在 `chrome.storage.session`，并在 reload 后继续使用。

导出协调器随后核对 conversation 身份、精确 turn 数量、角色顺序、唯一且连续的 turn 身份，以及每个用户/助手文档的 settled 与 durable 状态。任何局部窗口、过期会话、重复 ID、角色顺序变化、streaming 回答或空文档都会 fail closed。验证通过后，Markdown 保留用户与助手交替顺序；整段 PDF 复用单回答模型，并把逻辑高亮偏移到合并后的全文坐标。弹窗提供 `Copy Markdown` 和 `Export PDF` 两个入口，但真实 clipboard、full-history reload 和 PDF viewer 本轮没有打开，因此该能力仍是 `IMPLEMENTED_UNVERIFIED`。

### 高亮记录

现有 ChatGPT 高亮继续使用文档身份、回答身份、source version、块身份、文本范围、前后文和 TeX 组成锚点。新增的记录工具能够：

- 导出带 schema 的本地 JSON；
- 导入并拒绝完全无效的数据；
- 按记录 ID 合并，避免无界重复；
- 按 conversation 或 turn 筛选；
- 在设置页清空全部本地记录。

普通网页高亮已经进入开发构建，但默认关闭。设置页只在用户点击“Add site”时请求该 origin 的访问权，后台也只为“已保存且浏览器已授权”的 origin 动态注册隔离世界脚本；ChatGPT 仍走独立适配器，不会被普通网页运行时覆盖。

网页锚点使用页面路径、语义根、文本引用、有限前后文和原始区间，不保存整页文本，也不接受绝对 DOM 路径。运行时通过 CSS Custom Highlight API 绘制四种颜色，不包裹或替换站点节点；引用缺失、重复且上下文不能唯一消歧、语义根变化或页面过大时都保持未解析。设置页的备份文件同时覆盖 ChatGPT 与普通网页记录，并继续兼容旧的单类记录文件。权限提示、文章页渲染、点击编辑和跨刷新恢复仍需浏览器验收。

### 可靠性状态机

新的 `RecoveryStateMachine` 覆盖发送意图、等待提交、已提交、生成中、停滞、刷新、刷新后对账、完成、取消和人工处理。它保存 `lastMeaningfulProgressAt`，只有回答签名、turn 身份或明确工具阶段推进才刷新计时。

提交状态始终分成：

- A：确定已提交，只恢复当前 assistant turn，绝不新建同一 user turn；
- B：确定未提交，只提供原草稿的人工恢复入口；
- C：状态未知，禁止自动重发。

状态机允许最多 2 次刷新、每轮 1 个恢复周期，并拒绝并行恢复。只读工具可继续观察；未知或有外部副作用的工具进入人工处理。原始草稿只进入 `chrome.storage.session`。每次自动刷新还必须先向 Service Worker 申请由 recovery、tab、sequence 和 ordinal 共同绑定的一次性租约；租约跨 Service Worker 重启保留，按标签页隔离，5 分钟后自动失效。后台存储不可用时，控制器转入人工处理，不会绕过门槛继续刷新。

持久恢复历史也改由 Service Worker 串行写入。相同终态事件只记录一次，多标签页并发不会互相覆盖，最多保留 50 条；记录只包含哈希化 scope、状态、原因、次数和安全标记，不包含草稿、prompt、conversation 原始 ID 或对话正文。页面侧重复发送意图也不能替换正在恢复的草稿。

当前运行时只实现了保守的自动刷新与刷新后对账。原生 Stop、自动 assistant retry 和自动新消息 resend 尚未接入，因为没有本轮真实页面合同可证明控件身份和副作用安全；设置中的策略字段不会让这些动作偷偷发生。

## 需求与实现矩阵摘要

| 编号 | 来源 | 用户结果 | 当前状态 | 自动证据 | 真实验收 |
| --- | --- | --- | --- | --- | --- |
| MFC-010 | 冻结产品系统 | 所有回答能力共享一个解析入口 | `IMPLEMENTED_UNVERIFIED` | build/static | 真实 ChatGPT contract |
| MFC-020 | 本轮 §4/§7 | 稳定回答可复制为 Markdown | `IMPLEMENTED_VERIFIED` | convergence core | 实际剪贴板仍需浏览器 |
| MFC-021 | Issue #10、本轮 §7 | Notion rich clipboard 保留公式语义 | `IMPLEMENTED_UNVERIFIED` | MIME/结构模型 | 真实 Notion paste |
| MFC-022 | Issue #10、本轮 §7 | 确定性 Notion 导入文件 | `IMPLEMENTED_VERIFIED` | convergence core | 真实导入结果 |
| MFC-100 | Issue #1、重建分支 | 长对话客户端数据窗口化 | `IMPLEMENTED_UNVERIFIED` | 既有证据 + 本轮后台纯测试 | 当前构建浏览器回归 |
| MFC-200 | Issue #9、Milestone B | ChatGPT 正文与公式高亮 | `IMPLEMENTED_UNVERIFIED` | 既有 fixture 证据 | 当前构建浏览器回归 |
| MFC-202 | Issue #9、本轮 §5 | 普通网页高亮 | `IMPLEMENTED_UNVERIFIED` | 锚点与动态注册 fixture | 可选站点权限 + 文章页 |
| MFC-220 | Milestone B、本轮 §6 | 回答 PDF 与高亮继承 | `IMPLEMENTED_UNVERIFIED` | 既有 fixture 证据 | 当前构建 PDF viewer |
| MFC-221 | 本轮 §6.1 | 完整会话 Markdown/PDF 导出 | `IMPLEMENTED_UNVERIFIED` | completeness fixture + 后台存储 + validator gate | full-history reload、clipboard、PDF viewer |
| MFC-300 | 本轮 §8/§11 | 版本化设置和安全上限 | `IMPLEMENTED_VERIFIED` | convergence core | 设置页渲染 |
| MFC-400 | Issue #4、本轮 §8 | 60 秒无进展状态机 | `IMPLEMENTED_VERIFIED` | convergence core | 真实断流流程 |
| MFC-401 | Issue #4、本轮 §8 | 有界自动刷新和跨刷新去重 | `IMPLEMENTED_UNVERIFIED` | 状态/存储合同 | 真实 ChatGPT 回合 |
| MFC-403 | 本轮 §8.5/§8.6 | 跨刷新动作去重和无正文历史 | `IMPLEMENTED_VERIFIED` | ledger + controller + worker-restart fixtures | 真实多标签页 reload |
| MFC-410 | Issues #5/#6 | 输入框与连接器旧故障收敛 | `BLOCKED_BY_REAL_EXTERNAL_DEPENDENCY` | 历史证据存在 | 失败页精确 DOM/AX 合同 |
| MFC-420 | 历史任务 | Hide suggested work | `MISSING` | 仅设置项 | 精确且稳定的目标结构 |
| MFC-620 | 本轮 §13 | 验收器拒绝伪完整性结论 | `IMPLEMENTED_VERIFIED` | validator 1.7.0 preflight | 完整浏览器候选 run |

完整字段、模块归属、成功行为和未解决差距见 JSON 矩阵。

## 本轮允许范围内的验证

不启动浏览器的验证入口：

```bash
npm run build
node scripts/convergence-core-fixture.mjs
node scripts/conversation-export-fixture.mjs
node scripts/recovery-ledger-fixture.mjs
node scripts/recovery-controller-fixture.mjs
node scripts/general-web-core-fixture.mjs
node scripts/general-web-background-fixture.mjs
node scripts/low-memory-background-fixture.mjs
npm run test:build
npm run acceptance:preflight
```

`convergence-core-fixture.mjs` 覆盖设置迁移和安全上限、Markdown/Notion 序列化、五公式样本、高亮记录导入导出，以及可靠性 15 类关键状态。`conversation-export-fixture.mjs` 另行覆盖完整性证明、turn/role 身份绑定、整段 Markdown/PDF、高亮偏移，以及对 partial、stale、streaming 和伪造输入的拒绝。`recovery-ledger-fixture.mjs` 覆盖首次租约、重复拒绝、Service Worker 重启、多标签页隔离、TTL、冲突身份、存储失败、历史去重、并发写入、50 条上限、隐私字段和标签页清理。Acceptance validator `1.7.0` 已将完整会话和恢复去重都纳入 `functional-convergence` profile；预检接受 8 个 known-good，并拒绝全部 42 个 known-bad。它们都不替代真实 ChatGPT、系统剪贴板、Notion、PDF viewer 或实际设置页渲染。

## 明确保留的差距

以下工作没有被虚假标成完成：

- 普通网页高亮的实际权限提示、文章页渲染与交互验收；
- 整段 conversation 的 full-history reload、系统剪贴板和 PDF viewer 验收；
- Notion 一次粘贴后的原生可编辑公式；
- 原生 Stop、assistant retry 和确认未提交后的自动 resend；
- 历史 Composer / Connector 修复在当前真实页面上的精确收敛；
- Hide suggested work 的当前 ChatGPT 结构合同；
- 当前 `0.5.3` 的浏览器、真实 ChatGPT、PDF viewer 和 Notion 验收；
- `functional-convergence` profile 的完整浏览器候选物化与 candidate run。

这些缺口不会阻止源码和开发构建继续存在，但会阻止把 `0.5.3` 称为发布候选或声称全功能验收通过。
