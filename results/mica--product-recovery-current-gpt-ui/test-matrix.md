# Test matrix

## 冻结候选范围

- 运行版本：`0.4.1`（包含 0.3.0 Daily Core 的低内存硬门与 0.4.x Research Export）；
- unpacked path：`dist/mica-dev`；
- 自动化浏览器：Microsoft Edge persistent extension context，隔离临时 profile；
- 真实 ChatGPT send：`0`；
- Browser plugin：本会话未提供可调用能力，按 Frontend Testing skill 使用 Playwright + isolated Edge fallback；
- 当前已登录真实站点：尚未运行，等待冻结 commit 与同一 reviewer 复审通过后的唯一 HUMAN_ONLY 合并证据。

## 最终本地门禁

| 层 | 命令 / 证据 | 结果 | 最终耗时 |
|---|---|---|---|
| Low-memory focused | `pnpm run test:low-memory` | PASS；短/中/长、data window、DOM fallback、restore、disable、unknown/recent-branch fail-open、typing/IME、connector、send、streaming、scroll | 4.7 s（含 build） |
| Highlighter focused | `pnpm run test:highlighter` | PASS；SPA route isolation、Escape、Delete、公式不破坏、disable/reenable | 6.6 s（含 build） |
| Build + unit + product + validator | `pnpm test` | PASS；13 个状态机/隐私/config fail-open case；serializer；remote-resource stripping；input hot path heavy counters 全 0；manifest/build 通过 | 3.0 s |
| Actual MV3 extension E2E | `pnpm run test:e2e` | PASS；low-memory schema/sensitive fail-open、三项 popup + unsupported 状态合同、Copy、双 MIME、migration、diagnostic、highlighter、PDF、lifecycle、四异常、18 组 popup matrix | 22.2 s |
| Stress | `pnpm run test:e2e:stress` | PASS；10 次 reload/remount，最大 71 ms；3 轮 ghost/generation-error；同一全套 E2E 仍通过 | 23.2 s |
| PDF structure | bundled Python `scripts/verify-research-pdf.py` | PASS；3 页、790 words、精确 inline/display TeX source、7 font resources、0 image XObject、2 highlight rect、0 edge violation | 0.5 s |
| Producer visual review | popup light/dark、Troubleshooting、low-memory window、PDF preview | PASS；`PRODUCER_P1=0`、`PRODUCER_P2=0` | 逐图原尺寸目视检查 |
| Release package | `pnpm run package:release` | PASS；root manifest、必需文件、无 source wrapper/node_modules/log；SHA 一致 | 0.9 s |

## 低内存量化证据

最终标准 E2E 的 240-turn mapping-derived pressure fixture：

| 指标 | Baseline | Low-memory active | 变化 |
|---|---:|---:|---:|
| received / mounted turns | 240 | 40 | -83.3% |
| mapping nodes | 241 | 41 | -83.0% |
| response bytes | 3,033,461 | 505,821 | -83.3% |
| DOM nodes | 15,637 | 2,645 | -83.1% |
| JS heap after forced GC | 4,785,156 | 2,729,120 | -43.0% |
| 120 IME/input cycles | — | 0.5 ms total | <80 ms budget |
| two-frame scroll exercise | — | 49.9 ms | <250 ms budget |
| composer mutations during interaction | — | 4 | bounded |

恢复与兼容：20 turns 不裁剪；90→40；160-turn DOM fallback→40；`Load full history` 恢复 240；disable+reload 恢复 160；recent branch 与未知 graph fail-open；connector open/close、fixture send 与 27-character streaming mutation 均通过。

## 关键断言

| 风险 | 证据 | 结果 |
|---|---|---|
| Copy placement | current-derived fixture：旧右侧漂移 EXPECTED_FAIL；精确 cluster 相邻插入 PASS | PASS |
| Low-memory truncation | data mapping 240→40；DOM fallback 160→40；最近 40 turns；完整恢复 | PASS |
| Clipboard | popup Markdown、Notion 双 MIME、页面 Copy click 与 Enter | PASS |
| Composer hot path | ordinary input counters：query/clone/geometry/computed style = 0 | PASS |
| Delivery lifecycle | awaiting -> committed -> generating -> settled；新草稿保留；one-shot clear | PASS |
| Anomalies | ghost/fake waiting/stale response/generation error，各只显示一个安全动作 | PASS |
| Highlighter | heading/list/quote/formula-adjacent/cross-paragraph；cross-node；streaming；duplicate；text change；34 anchors；SPA/Escape/Delete | PASS；34-anchor restore 最终 36 ms，stress candidate 46 ms |
| Module isolation | page integration/reliability/highlighter off 后无对应行为；重新启用恢复 | PASS |
| Update migration | 保留旧 false 值，只为新字段补默认值；fresh install 全默认 | PASS |
| Troubleshooting privacy | remount/action/connector 捕获；sentinel 正文不进入报告 | PASS |
| PDF | 公式非栅格、精确 TeX source 可复制、文本可搜索、高亮保留、分页无裁切 | PASS |
| Notion | `text/html` + `text/plain`、本地 Notion-like import | PASS（精确 Notion web paste 仍为 HUMAN_ONLY） |

## 独立审查 P1/P2 修复回归

| 旧审查发现 | 修复 | 证据 |
|---|---|---|
| PDF math copy extraction | KaTeX 视觉公式后增加可见、可复制的精确 TeX source | verifier exact inline/display/order PASS |
| SPA route highlight bleed | storage key + generation-bound context switch | route A=5、route B=1、back 恢复 A=5 |
| sanitized export remote resources | 移除 remote-load elements/attributes，只保留安全 anchor href | product test PASS |
| identical normal replies stale false positive | settle 后要求 DOM message identity + stable fingerprint 同时重复 | same text/new identity 与 early-similar-then-changed 均 `settled` |
| Escape/Delete accessibility | affordance Escape；mark tabindex/aria/Delete/Backspace | focused + full E2E PASS |
| observer typing hot path | input/form/contenteditable mutations直接忽略；普通 input heavy counters 0 | product test + Tier 2 PASS |

## 迭代运行说明

本修复迭代的标准完整 E2E 共 10 次：第一次在新增 SPA/keyboard coverage 中 FAIL，定位并修复异步 affordance ownership 与 Escape keyup 重建；第二次 PASS 后，冻结审阅把最近 N 策略从“角色切换”收紧为“每个可见 node”；第三次 PASS 后又补上 fresh-config/expired-cache fail-open，因此前两次 PASS 均失效；第四次在该 runtime 上 PASS。将 popup 收回原 Goal 的三项合同后，第五次 PASS；证据截图改为默认闭合菜单后，第六次首次命中扩展安装迁移与 baseline 设置竞态，静态审计后增加 schema settle guard；第七次 PASS。独立 review 再发现 config error、schema drift fail-open 与 unsupported popup 缺口；修复后的第八次仅因新增 fixture URL 变量写错而在 harness 中 FAIL，第九次 PASS。冻结前自审又把 payload streaming 与整图连通性纳入 fail-open，第十次在最终源码与证据 harness 上 PASS。

Low-memory focused 在初始指标阈值校准前有 1 次 harness FAIL；静态检查指标来源后，后续 8 次直接 focused run 均 PASS。最终 direct run 覆盖 missing children、unknown role、tool role、multimodal/file、payload streaming 与断连 graph fail-open。完整 E2E 与 stress 也各自重新覆盖了同一 low-memory case。Highlighter focused 的中间 FAIL 分别暴露测试选区漂移、跨 route 异步竞态和 Escape keyup 重建；每类在重复两次前完成静态根因检查。最终 focused、完整 E2E、stress 均 PASS。

最终 runtime 后只调整截图默认态、测试启动隔离与文档；完整 E2E 和 stress 均已在这些变化后重跑。没有跨 candidate 拼接 PASS，0.4.0 的旧截图、PDF、package 和 reviewer FAIL 不能作为 0.4.1 PASS。

```text
FOCUSED_TESTS=PASS
AFFECTED_E2E=PASS
FULL_SUITE=PASS
FULL_E2E_RUNS_THIS_REPAIR=10
FINAL_FULL_E2E_RUNS=1
STRESS=PASS
PERFORMANCE_REGRESSION=PASS
NO_THIRD_PARTY_CONTENT_UPLOAD=PASS
PRODUCER_P1=0
PRODUCER_P2=0
PACKAGE_ZIP_SHA256=PASS
CURRENT_AUTHENTICATED_CHATGPT=PENDING_HUMAN_ONLY
```
