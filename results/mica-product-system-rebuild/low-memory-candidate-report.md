# Mica 0.3.0 Low Memory candidate report

## Candidate identity

- Runtime commit: `d739c81c91c0045f49987bc24ae907529fb95abd`
- Runtime version: `0.3.0`
- Build label: `low-memory-windowing.1`
- Candidate bundle: `results/mica-product-system-rebuild/low-memory-candidate/d739c81c91c0045f49987bc24ae907529fb95abd`
- Dist tree hash: `c06fde5756671e6533aab2adb7ad7e955379649a4197b5cabf5db8ae8edc9d0a`
- Validator: `1.1.0`
- Validator tree hash: `8dd1ebf03b16ed2fdb217648692e0a737c6cc877119d5165f3607c4be41089a9`
- Fixture set hash: `64ad57139334d8390fa234d89b1c3bc9fec46a6027fe5f486b40720556e4f163`

## Producer result

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
PRODUCER_P0=0
PRODUCER_P1=0
PRODUCER_P2=0
CANDIDATE_IDENTITY=PASS
PACKAGE=PASS
ACTUAL_SURFACE_REVIEW=PENDING_INDEPENDENT_REVIEW
RELEASE_ARTIFACTS=PENDING_MILESTONE_B
RELEASE_0_3_0=BLOCKED_UNTIL_MILESTONE_B_AND_FINAL_HUMAN_ONLY_ACCEPTANCE
```

这些 PASS 是 Producer 对已冻结候选及其机械绑定证据的结论，不替代独立 reviewer，也不构成发布结论。

## 实际截断内容

Mica 在 ChatGPT 解码 conversation 之前处理两类客户端输入：

1. 当前 React Router turbo-stream 初始 hydration graph；
2. 同源、精确 GET 路径的 conversation JSON fallback。

超过 80 个可见 turns 时，Mica 保留当前 branch 上最近 40 个 user/assistant turns、结构根节点、窗口内部的 system/tool/model-context 依赖，以及窗口内产生的近期 branch descendants。更早且不可达的客户端 graph entries 会被压缩，后续 turbo-stream continuation index 会按压缩后的 graph 重新映射。未知、歧义、循环或无效结构保持原 payload，不猜测也不截断。

实现不会从 React 管理的 DOM 中拆节点，不会修改服务器 conversation，不会上传内容，也没有把 `content-visibility` 或 ChatGPT 原生 virtualization 当成完成条件。

## 保留与恢复策略

- 最近内容预算：40 个可见 turns；短 thread（24）和中等 thread（72）不截断，长 thread（240）截断为 40 个最近 turns，加上必要依赖和两个近期 branch turns。
- `Load full history`：为当前 `origin + pathname` 写入一次 session-scoped bypass，然后安全 reload；有 draft、streaming 或 dialog 时拒绝 reload。
- 上滑恢复入口：激活窗口后提供 `Load full history`，fixture 证明入口在顶部可见且可写入 bypass；Popup 同时提供相同恢复动作。
- reload：bypass 在同一 tab session 中保留，下一次加载走完整原生历史。
- 关闭 Low Memory：若当前已截断，则设置 bypass 并安全 reload；关闭或移除 Mica 后，没有脚本再处理响应，ChatGPT 原生完整服务器历史保持可用。

## 目标压力证据

环境：Headless Chrome `151.0.7922.34`，每个样本使用全新 browser process tree，V8 old-space 限制为 256 MB；workload 为 800 turns、约 100 MiB UTF-16 retained content。A/B/C 各重复 3 次，以下为中位数。

| 指标 | A：Mica absent/disabled | B：installed/off | C：installed/on |
|---|---:|---:|---:|
| process private memory | 288.266 MiB | 281.711 MiB | 248.793 MiB |
| JS heap | 101.231 MiB | 101.776 MiB | 6.442 MiB |
| retained content | 100 MiB | 100 MiB | 5 MiB |
| mapping nodes | 801 | 801 | 41 |
| mounted turns | 12 | 12 | 12 |
| mutation count | 62 | 62 | 62 |
| typing p95 | 0.01 ms | 0.01 ms | 0.01 ms |
| scroll p95 | 0.01 ms | 0.10 ms | 0.10 ms |

相对更低的 A/B process baseline，C 的 process private memory 下降约 11.7%；相对更低的 A/B heap baseline，C 下降约 93.6%；retained content 下降 95%。三组 mounted turns 都是 12，说明收益来自 Mica 对完整客户端 conversation graph 和重内容引用的额外窗口化，而不是把当前 ChatGPT 已有 DOM virtualization 重命名为 Mica 功能。

## 回归与防伪证据

- final focused/Tier 2：build、Foundation core、Low Memory active core flows、短/中/长 windowing、page stream/JSON interception、reload/disable recovery、Popup rendering、build validation 全部 PASS；最终完整链运行 1 次，用时约 25 秒。
- stress：8 轮、40 次真实 Chromium fixture run 全部 PASS，用时约 90 秒。
- pressure：A/B/C 各 3 个全新 browser 样本，PASS，用时约 51 秒。
- core flows：composer、send、streaming、edit、branch、connector、tool、file、auth、typing/IME 全部 PASS；普通 typing/composition 事件同步路径 document queries 为 0。
- continuation：压缩后 promise continuation index 正确重映射；同页面后续新的初始 stream 会清空旧映射，短 thread 不受前一条长 thread 污染。
- deterministic preflight：5/5 known-good 接受，27/27 known-bad 拒绝；`low-memory-no-op` 同时因绑定证据不一致、无额外内存收益和 retained content 无下降而被拒绝。
- `npm test` 未运行：本机 PATH 没有 `npm`；已直接运行 package scripts 对应的 Node 入口，没有跳过任何候选检查。

## 当前边界

- 当前 ChatGPT data-plane 证据来自只读、未登录的公开 shared conversation；没有自动化或复用用户正常 Edge 登录态。
- ChatGPT private route 与 turbo-stream 结构仍是不稳定边界；实现以严格形状验证、同源精确路径和 fail-open 保护，不能识别时使用原生完整历史。
- 最终登录态、真实超长 conversation 与低性能设备体验仍属于 Goal 最后集中执行的 HUMAN_ONLY 验收；在 Highlighter、PDF、最终 reviewer 和该验收完成前，不发布 `0.3.0`。
