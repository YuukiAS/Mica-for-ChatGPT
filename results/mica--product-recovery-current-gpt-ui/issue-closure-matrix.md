# Issue closure matrix

本矩阵只记录当前冻结 Goal 能证明的状态。GitHub issue 正文当前因认证不可读；标题/范围以仓库内已冻结任务、历史任务与 README 链接为准，不能据此执行远端关闭。

| Issue | 仓库内范围 | 实现定位 | 自动化 / artifact 证据 | 当前状态 | 远端动作 |
|---|---|---|---|---|---|
| #1 | Long-thread recovery | `docs/investigations/2026-10-05-long-thread-product-conclusion.md` | 当前产品移除优化承诺，Popup 为 `Native handling` | `REPLACED_BY_NATIVE_HANDLING`；不是 Mica 优化 PASS | 更新说明，不按功能完成关闭 |
| #2 | Long-thread runtime diagnostics / real bottleneck | 旧性能面已从日常产品移除；新 Troubleshooting 仅服务当前结构验收 | `current-ui-check.js` 隐私边界与 E2E | 原目标不再是产品能力；历史诊断结论保留 | 待当前 issue 正文可读后更新/重写 |
| #3 | Stable Markdown / LaTeX Copy | `extension/src/copy/markdown-copy.ts` | serializer unit + actual clipboard + PDF/Notion reuse | 本地 `PASS`；真实 action cluster 待一次合并证据 | 暂不关闭 |
| #4 | Turn delivery guard | `extension/src/reliability/turn-delivery-guard.ts` | 四状态异常、单一恢复动作、正文不入 diagnostics | 本地 `PASS`；真实 send lifecycle 待一次 HUMAN_ONLY | 暂不关闭 |
| #5 | Composer / connector lifecycle | 同一 delivery guard + event-driven content runtime | ordinary input/IME hot path、connector fixture、remount report | 本地 `PASS`；当前 connector/remount 待一次 HUMAN_ONLY | 暂不关闭 |
| #6 | Stale/residual composer recovery | confirmed user-turn commit 后 one-shot clear | old-bad/new-good，同轮新草稿保护 | 本地 `PASS`；真实 long connector send 待一次 HUMAN_ONLY | 暂不关闭 |
| #9 | Web Highlighter | `extension/src/highlight/highlighter.ts` | cross-node、流式保护、同文多处、文本变化、34-anchor restore、PDF 继承 | 本地 `PASS`；真实当前 answer smoke 待一次 HUMAN_ONLY | 暂不关闭 |
| #10 | Notion-ready / Research Export | `research-export.ts`、`extension/export/**` | 双 MIME、Notion-like import、3 页 searchable PDF | PDF `PASS`；精确 Notion web paste `UNVERIFIED_HUMAN_ONLY` | 暂不关闭 |

任何远端 close 都必须同时满足：当前 issue 正文可读、实现 locator、冻结候选测试、实际 artifact 与最终 live evidence 一致。当前没有 issue 满足全部远端关闭条件。
