# 0.5.6 功能收敛离线验证

`0.5.6` 的本地后端、构建身份和纯 Node 回归已经通过。相较 `0.5.5`，本轮把恢复动作授权接到了 adapter-owned 原生控件执行边界，并为 `Hide suggested work` 增加了可逆控制器；两者都只接受唯一的 `EXACT` 合同。当前真实 ChatGPT 控件和建议区域结构没有被观察，因此 live 路径明确返回 `MISSING / current_site_contract_unproven`，不会猜测点击、提交或隐藏页面元素。

本轮没有启动任何浏览器，也没有访问真实 ChatGPT、普通文章页、Notion 或 PDF 查看器。这里的 PASS 只证明离线合同、fail-open 行为、构建一致性和验收器抗伪造能力，不代表真实站点或查看器验收通过。

## 当前候选

- 分支：`codex/mica-functional-convergence`
- 版本：`0.5.6`
- 构建标签：`functional-convergence.7`
- 固定开发路径：`dist/mica-dev`
- 需求矩阵：`docs/product/MICA_FUNCTIONAL_CONVERGENCE_V1.json`

## 已运行

| 验证 | 结果 | 用时 | 覆盖范围 |
| --- | --- | ---: | --- |
| `npm run test:target-surfaces` | PASS | 1.272 s | 最终安全修正后的独立构建、目标表面合同、页面可写 fixture 标记拒绝与未知 live contract fail-open |
| `npm run test:convergence-core` | PASS | 2.498 s | 最终构建、设置迁移、高亮交互、adapter recovery、target-surface backend、Markdown/Notion、完整会话导出、恢复策略/ledger/controller、普通网页锚点与动态注册 |
| `node scripts/low-memory-background-fixture.mjs` | PASS | 1.616 s | 注册串行化、存储失败 fail-open、full-history 状态、后台恢复与原生动作 claim 的 Worker 重启去重 |
| `node scripts/pdf-background-fixture.mjs` | PASS | 1.378 s | 可信来源、一次性传递、伪造 consumer 拒绝和失败清理 |
| `npm run build` | PASS | 1.048 s | 本轮独立构建；最终组合回归再次刷新 `dist/mica-dev`，其构建用时包含在 2.498 s 内 |
| `npm run test:build` | PASS | 0.887 s | `0.5.6` 版本一致性、脚本顺序、adapter/controller 选择器边界、权限、必需文件、矩阵、隐私字段与 typing hot-path 禁止项 |
| `npm run acceptance:preflight` | PASS | 5.669 s | 验收器 `1.9.0` 接受 10/10 正例并拒绝 44/44 反例；新增 target-surface 伪造证据也被拒绝 |

### Target-surface backend

`target-surface-backend-fixture.mjs` 汇总三组纯 Node fixture，确认：

- suggested-work 只有一个满足合同的候选时才会隐藏；关闭设置、节点替换或合同失效会恢复原有 `hidden`、`inert` 和 `aria-hidden` 状态；
- 无关卡片、歧义候选和未知 live contract 保持原生；控制器不创建轮询、独立 observer 或页面 selector；
- Stop、assistant retry 和 confirmed-unsent resend 的控件证据与恢复 subject、control identity 绑定；执行前再次验证控件身份；
- confirmed-unsent resend 只有在 composer 合同精确且值为空时才恢复短期草稿并调用原生控件；
- 敏感、有外部副作用和未知工具状态不会取得动作资格；同一证据只提交一次；
- QA 结构报告不包含建议文本、回答正文或原始 DOM。
- 页面可写的 `data-mica-fixture` 或 `data-mica-*` 标记不能单独启用精确合同；还必须存在扩展隔离世界中的 test-only authority，回归确认伪造 DOM 标记仍返回 `MISSING` 且不会点击。

fixture 明确输出 `realSuggestedWorkContractIncluded=false` 和 `realRecoveryControlContractIncluded=false`。验收器也要求这两个字段保持 false，防止把合成合同伪装成当前真实站点证据。

### 架构和隐私边界

`MicaRecoveryControlAdapter` 不直接查询页面，只消费 `ChatGPTAdapter` 的精确观察，再让既有 `RecoveryActionPolicy`、后台 claim 和 `RecoveryController` 决定是否动作。adapter 在执行前重新检查 subject 和 control hash，避免授权后控件被 remount 或切换到其他 turn。

`MicaSuggestedWorkController` 复用内容脚本已有的结构观察调度，并通过 `requestAnimationFrame` 合并重复 reconcile。关闭总开关或子开关会立即进入恢复路径。它没有输入事件监听器，不进入普通键入同步调用栈。

Developer QA 只在用户主动导出报告时扫描 composer 附近三层祖先和最新 assistant turn，最多保留 32 个结构候选。输出只含结构 token、相对关系、按钮状态、语义分类和 accessibility label 指纹；label 原文、prompt、回答、请求体、token 与 raw DOM 均不输出。

## 未运行

| 类别 | 状态 | 用时 | 原因 |
| --- | --- | ---: | --- |
| `npm test` | NOT RUN | 0 s | 包含隔离 Chromium fixture；用户明确要求本轮不打开浏览器。 |
| `npm run test:e2e` | NOT RUN | 0 s | 浏览器生命周期测试，本轮明确禁止。 |
| `npm run test:e2e:stress` | NOT RUN | 0 s | 浏览器压力测试；当前没有经过实站验收的候选需要定稿。 |
| Highlighter 浏览器 fixture | NOT RUN | 0 s | 需要隔离 Chromium 和页面选区交互。 |
| PDF 生成、查看器选择与搜索 | NOT RUN | 0 s | 需要浏览器和实际 PDF 查看器。 |
| Popup / Options 渲染 | NOT RUN | 0 s | 需要浏览器渲染。 |
| 普通网页权限提示、文章页高亮与快捷键 | NOT RUN | 0 s | 纯模型和注册 fixture 不能替代实际站点。 |
| 真实 ChatGPT 断流、原生控件与 suggested work | NOT RUN | 0 s | 用户禁止真实 GPT 交互，且项目要求精确失败页证据。 |
| 真实 Notion 粘贴与公式编辑 | NOT RUN | 0 s | 本地 MIME/HTML 不能替代真实目标。 |

## 结论边界

`0.5.6` 已把 MFC-402 和 MFC-420 从“没有运行时后端”推进到 `IMPLEMENTED_UNVERIFIED`：执行与隐藏管线、证据门槛、回滚、隐私诊断和离线抗伪造验证都已存在。由于当前真实合同仍是 `MISSING`，这两个功能在真实 ChatGPT 上会保持原生，而不是冒险工作。

这不是整体阻塞，也不否定其他离线后端进展；它只阻止声称真实 ChatGPT 控件已适配、suggested work 已在当前页面隐藏，或把 `0.5.6` 称为正式发布候选。浏览器、Notion 和 PDF 查看器相关缺口继续保留在矩阵中，等待以后按真实证据流程一次性验收。
