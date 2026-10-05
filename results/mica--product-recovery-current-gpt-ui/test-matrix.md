# Test matrix

## 冻结候选范围

- 运行版本：`0.4.0`（包含已提交的 0.3.0 Daily Core）；
- unpacked path：`dist/mica-dev`；
- 自动化浏览器：Microsoft Edge persistent extension context，隔离临时 profile；
- 真实 ChatGPT send：`0`；
- 当前已登录真实站点：尚未运行，等待唯一一次 HUMAN_ONLY 合并证据。

## 最终本地门禁

| 层 | 命令 / 证据 | 结果 | 最终耗时 |
|---|---|---|---|
| Build + unit + product + validator | `pnpm run test` | PASS；10 个状态机/隐私 case；serializer；old placement EXPECTED_FAIL/new PASS；input hot path heavy counters 全 0；manifest/build 通过 | 2.44 s |
| Page Copy focused | `node scripts/test-page-copy.mjs` | PASS；实际页面 action feedback 与系统 clipboard 后置条件 | 1.89 s（含 build） |
| Actual MV3 extension E2E | `pnpm run test:e2e` | PASS；popup、页面 Copy click/keyboard、双 MIME、settings/migration、unknown fail-open、diagnostic workflow、highlighter、PDF、lifecycle、四异常、18 组 popup matrix | 14.05 s |
| Stress | `pnpm run test:e2e:stress` | PASS；10 次 reload/remount，最大 78 ms；3 轮 ghost/generation-error 恢复；同一全套 E2E 仍通过 | 15.24 s |
| PDF structure | bundled Python `scripts/verify-research-pdf.py` | PASS；3 页、780 words、searchable text/table/code/math、7 font resources、0 image XObject、2 highlight rect、0 edge violation | 与 package 合计 1.01 s |
| Release package | `pnpm run package:release` | PASS；root manifest、必需文件、无 source wrapper/node_modules/log；SHA 一致 | 与 PDF 合计 1.01 s |
| Producer visual review | popup light/dark、Troubleshooting、PDF preview + 3 页 Poppler render、16/32px icons | PASS；`PRODUCER_P1=0`、`PRODUCER_P2=0` | 两轮目视检查 |

## 关键断言

| 风险 | 证据 | 结果 |
|---|---|---|
| Copy placement | current-derived fixture：旧右侧漂移 EXPECTED_FAIL；精确 cluster 相邻插入 PASS | PASS |
| Clipboard | popup Markdown、Notion 双 MIME、页面 Copy click 与 Enter | PASS |
| Composer hot path | ordinary input counters：query/clone/geometry/computed style = 0 | PASS |
| Delivery lifecycle | awaiting -> committed -> generating -> settled；新草稿保留；one-shot clear | PASS |
| Anomalies | ghost/fake waiting/stale response/generation error，各只显示一个安全动作 | PASS |
| Highlighter | heading/list/quote/formula-adjacent/cross-paragraph；cross-node；streaming；duplicate；text change；34 anchors | PASS；34-anchor restore 最终 44 ms，stress candidate 31 ms |
| Module isolation | page integration/reliability/highlighter off 后无对应行为；重新启用恢复 | PASS |
| Update migration | 保留旧 false 值，只为新字段补默认值；fresh install 全默认 | PASS |
| Troubleshooting privacy | remount/action/connector 捕获；sentinel 正文不进入报告 | PASS |
| PDF | 公式非栅格、文本可搜索、高亮保留、分页无裁切 | PASS |
| Notion | `text/html` + `text/plain`、本地 Notion-like import | PASS（精确 Notion web paste 仍为 HUMAN_ONLY） |

## 迭代运行说明

0.4.0 开发期间共运行 9 次标准扩展 E2E：5 次 PASS、4 次在新 evidence 暴露后 FAIL（锚点测试设置错误 1 次、页面 Copy 异步后置条件链 3 次）。每次失败后均静态检查并修改对应 failure class；最终冻结 runtime 后的标准 E2E 与 stress 各通过 1 次。没有跨 candidate 拼接 PASS。

```text
FOCUSED_TESTS=PASS
AFFECTED_E2E=PASS
FULL_SUITE=PASS
STRESS=PASS
PERFORMANCE_REGRESSION=PASS
NO_THIRD_PARTY_CONTENT_UPLOAD=PASS
PRODUCER_P1=0
PRODUCER_P2=0
CURRENT_AUTHENTICATED_CHATGPT=PENDING_HUMAN_ONLY
```
