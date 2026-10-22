# 0.5.12 回答级高亮清理离线验证

Mica `0.5.12` 补齐了高亮清理的回答级范围。用户仍可删除单条高亮；当当前回答已经存在高亮时，临时工具条还会显示 “Clear answer highlights”，用于移除同一 conversation、同一 turn 下的全部本地高亮记录。这个动作不会删除回答正文，也不会影响其他回答或其他会话。

## 身份与存储边界

回答级清理必须同时取得有效的 `conversationId` 和 `turnId`。只有 conversation、只有 turn、带控制字符或超过身份长度上限的输入都会返回 `exact_answer_scope_required`，记录保持不变。同一回答经过编辑或重建后可能出现不同的 `documentId` / `sourceVersion`；清理按逻辑回答身份覆盖这些版本，但保留其他 turn 和其他 conversation。

清理前会先使用现有白名单重建全部记录。即使输入数组混入未知顶层字段、原始 DOM 或其他污染字段，保留下来的记录也不会把这些字段继续写回本地存储。工具条只在精确身份成立且当前回答确实有高亮时展示清理动作，点击仍受 `event.isTrusted` 约束。新增按钮可能引起工具条换行，因此定位改为使用实际渲染高度，不再依赖固定的 92 px 偏移。

## 验收器变化

Acceptance validator 升级到 `1.16.0`。`highlight-record-integrity` 门禁新增四项必需事实：精确回答范围清理、conversation + turn 双身份要求、跨范围隔离、保留记录再清洗。控制集新增 `forged-answer-scope-clear-rehash`，它即使重算证据哈希，也会因伪造 `answerScopedClearIsolated=false` 被生产验收逻辑拒绝。

## 本轮验证

| 验证 | 结果 | 用时 | 说明 |
| --- | --- | ---: | --- |
| `node scripts/highlight-record-integrity-fixture.mjs` | PASS | 0.106 s | 覆盖精确范围、部分范围拒绝、跨版本清理、跨范围隔离和再清洗 |
| `npm run test:convergence-core` | PASS | 3.259 s | 最终源码与 `dist/mica-dev` 的纯 Node 收敛套件 |
| `npm run acceptance:preflight` | PASS | 5.685 s | 13/13 known-good 接受，51/51 known-bad 拒绝 |
| `npm run build` | PASS | 0.919 s | 生成 `0.5.12` / `functional-convergence.13` 到固定开发路径 |
| `npm run test:build` | PASS | 0.671 s | manifest、源码、内容脚本、版本和静态热路径门禁一致 |
| `npm test` | 未运行 | — | 该命令包含 Playwright/Chromium 脚本，本轮明确禁止打开浏览器 |
| `npm run test:e2e` | 未运行 | — | 浏览器禁止；不把旧浏览器证据写成当前候选 PASS |
| `npm run test:e2e:stress` | 未运行 | — | 浏览器禁止，且本轮不以竞态或压力问题为目标 |

实现阶段第一次运行静态构建门禁时，矩阵仍报告 `0.5.11`，验证器按预期拒绝版本漂移。矩阵、说明和构建版本同步到 `0.5.12` 后，最终门禁通过。

## 仍需浏览器验收的部分

本轮没有打开浏览器，没有连接真实 ChatGPT，也没有操作用户的 Edge profile。因而以下结论仍保持未验证，而不是本轮阻塞：

- 工具条在真实 ChatGPT 回答上的显示、换行、键盘焦点与可信点击；
- 清理后 CSS Custom Highlight 的即时视觉消失和 remount 后不恢复；
- 当前 ChatGPT DOM 合同、真实剪贴板、PDF viewer 与 Notion 行为；
- 完整 `npm test`、Tier 2 E2E 和 stress。

这些缺口只限制发布和实站验收结论，不影响本轮已经由纯模型、构建和验收器证明的回答范围清理后端。
