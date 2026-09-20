# Goal 002 — Long-thread Performance & Memory Hardening

## Goal

把 Mica 最初存在的理由重新做实：**长 conversation 必须更轻，而不是只显示一个状态点。**

当前 `0.1.7` 的默认安全路径主要是 `content-visibility:auto + containment + intrinsic-size`；README 已确认真实 ChatGPT 目前本身只挂载约 5–9 个 conversation turns。这个现状意味着：不能继续把“给历史 turn 加 CSS containment”直接等价成“截断省内存成功”。

本 Goal 要回答两个问题：

1. 当前真实 ChatGPT 在长线程上究竟还剩什么性能/内存成本？
2. Mica 如何在不破坏 React/native windowing 的前提下提供可测量的额外减负，并保证自身近似 zero-overhead？

## Non-negotiable

- Mica OFF 不得比 Mica ON 明显更流畅；一旦出现，视为 P0 regression。
- ordinary typing hotpath deterministic guard 必须持续 PASS。
- 不通过删除/挪走 React-managed composer/active turn 来换 benchmark。
- 不用“mounted turns 少于 threshold”伪造优化效果。
- 不以 `Active` 字样作为性能证据。
- 真实 authenticated Edge 检查只读；不得发送、上传、scroll automation、connector/tool action。

## Step 1 — Establish current native budget

在 synthetic fixture + 可获得的 real-site read-only evidence 中记录：

- mounted conversation turn count；
- descendant DOM node count；
- Mica-owned DOM node count；
- active timers / intervals；
- active MutationObserver / ResizeObserver / IntersectionObserver count where measurable；
- Mica callback rate；
- long task count/duration；
- frame stall summary；
- JS heap where Chromium exposes it；
- composer input callback cost；
- URL/status polling cost；
- known interruption scan cost；
- overlay rendering cost。

建立 budget snapshot，而不是只收一个总耗时。

## Step 2 — Distinguish three runtime modes

### A. NATIVE_WINDOWED

ChatGPT 已经维持小 mounted window，Mica 无需再对 conversation 做重扫描。

要求：

- long-thread module 进入低成本 native-safe mode；
- document-wide scan/observer/timer 尽可能关闭；
- 只保留极轻量 route/status detection；
- 不因 Mica 为了“监测优化”反而增加主线程负担。

### B. MICA_RENDER_CONTAINED

ChatGPT 当前挂载的普通历史 turns 明显超过安全 budget，但结构仍可安全识别。

允许使用已证明低风险的：

- content-visibility；
- containment；
- intrinsic-size；
- bounded ResizeObserver；
- near-viewport protection。

必须测量“有/无 containment”的 browser work 差异。

### C. MEMORY_PRESSURE / LARGE_NATIVE_WINDOW

如果真实或 fixture 证据证明 DOM/heap 仍因大量历史内容增长，且 CSS containment 不足以减少内存：

不要立刻删除 React DOM。

先研究两个安全方向并写明选择理由：

1. 当前 ChatGPT 是否已有可利用的原生 pagination/windowing signal，使 Mica 只需阻止自己干扰它；
2. 是否存在稳定的、isolated、feature-flagged historical data/window hook 可以真正限制历史预加载。

只有能证明不会造成 branch/tool/file/auth/message-loss 风险时，才允许实现更强 trimming。

如果无法安全做到真正 DOM/data trimming，必须诚实报告：

`EXPLICIT_MEMORY_TRIM = NOT_SAFE_ON_CURRENT_ARCHITECTURE`

但同时要把 Mica 自身额外 overhead 降到接近零，并证明 native windowing 已经承担历史截断。禁止用危险方案满足“看起来省内存”。

## Step 3 — Remove avoidable runtime overhead

系统审计 `content.ts` 当前持续运行路径：

- 1500ms route/status interval；
- `processKnownInterruptions()`；
- overlay polling/placement；
- turn status probes；
- MutationObserver；
- ResizeObserver；
- reliability modules；
- diagnostic modules when inactive。

目标：

- native-windowed + diagnostics inactive 时，Mica 大部分模块事件驱动/休眠；
- 不需要的 observer detach；
- 不需要的 timer clear；
- no continuous DOM enumeration merely to update UI counters；
- page status 使用缓存 counters，结构变化再更新。

## Step 4 — Add long-thread performance regression fixture

fixture 至少模拟：

- 90–200 ordinary turns；
- code block / table / math-heavy turns；
- tool-like protected turn；
- composer active；
- native-windowed small mounted window；
- expanded mounted window；
- fast scroll surrogate；
- streaming mutations surrogate。

断言不要只看 wall clock；加入 deterministic counters：

- turn full scans；
- observer callbacks；
- overlay placements；
- geometry reads；
- style writes；
- optimized class churn；
- typing-path heavy work。

## Step 5 — A/B diagnostic mode without real actions

实现一个 bounded local diagnostic mode，可以在用户**不发送消息**的情况下比较：

- current Mica runtime；
- long-thread optimization temporarily inert/native-only。

它不能：

- reload；
- navigate；
- auto-scroll；
- send；
- upload。

只测 stationary/用户自然滚动产生的指标，并在同一 report 中给出 A/B counters。

## Step 6 — Status semantics

状态必须表达真实运行策略：

- `Native windowed`：ChatGPT 已控制 mounted history，Mica long-thread path dormant；
- `Optimizing`：Mica 确有额外 bounded render containment；
- `Degraded`：结构未知，fail native；
- `Disabled`。

不要把 mounted count 当完整 thread total。

popup 可显示极简 summary，例如：

`Native windowed · 7 mounted · low overhead`

高级 counters 放 diagnostics/details，不污染主 UI。

## Real-device exit criterion

MacBook Neo 8 GB 仍是最终低内存设备，但本 goal 在要求用户之前必须先做到：

- synthetic deterministic performance gate PASS；
- Windows Edge read-only structural evidence collected if available；
- no Mica typing regression；
- no unsafe trimming；
- one compact performance report ready。

不要让用户反复切 ON/OFF、发送多条消息。

如果最终确实需要 MacBook 主观验收，把它合并进 Goal 006 的一次 release acceptance，而不是现在单独要求。

## Acceptance

输出：

- `NATIVE_WINDOWED_BEHAVIOR =`
- `MICA_OVERHEAD_IDLE =`
- `MICA_OVERHEAD_TYPING =`
- `LONG_THREAD_HEAVY_SCAN_RATE_BEFORE/AFTER =`
- `ACTIVE_TIMER_COUNT_BEFORE/AFTER =`
- `DOM/HEAP_EVIDENCE =`
- `RENDER_CONTAINMENT_EFFECT = PROVEN/NOT_NEEDED/INSUFFICIENT`
- `EXPLICIT_MEMORY_TRIM = SAFE_IMPLEMENTED/NOT_NEEDED_NATIVE_WINDOWED/NOT_SAFE_ON_CURRENT_ARCHITECTURE`
- `PERF_FIXTURES = PASS/FAIL`
- `TYPING_HOTPATH = PASS/FAIL`
- `READY_FOR_SINGLE_FINAL_DEVICE_ACCEPTANCE = YES/NO`

P0 只有在“实际长线程不会因 Mica 变重，并且减负机制有证据”时才算进入可发布状态。