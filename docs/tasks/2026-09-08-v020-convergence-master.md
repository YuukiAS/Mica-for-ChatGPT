# Mica v0.2.0 Convergence Program

## 结论

Mica 不再按“发现一个真实站点症状 -> 改一个 patch -> 让用户再测一次”的方式推进。`0.2.0` 是一次集中收敛版本：在一个长期工作分支内同时完成长线程性能/内存、稳定 Markdown/LaTeX Copy、composer/reliability 收敛、overlay/popup 产品化，以及一次性真实站点验收基础设施；只有形成完整 candidate 后才合并到 `main`。

当前远端 `main` 基线：`aa4ce52581fff2e207d1f93600becbb3018b0efc` (`0.1.7`, `typing-hotpath-fix.1`)。

用户报告本地另有尚未推送的测试架构提交：

`6337b71 Redesign Mica test architecture`

该提交因 GitHub workflow OAuth scope 被拒而未进入远端。本 program 的第一步必须保住并核对该本地提交，不允许因为远端优先而丢弃它。

## 为什么进入 0.2.0

`0.1.x` 已经不再只是单一 long-thread emergency build。当前实际产品面同时包含：

- long-thread render/memory recovery；
- composer stale/remount/connector continuity；
- send residual/reliability；
- diagnostics；
- copy/export；
- popup / page status interface。

仓库版本策略规定“进入明显的新能力阶段或一组较大的产品能力”使用 MINOR bump，因此本次最终 candidate 使用 `0.2.0`，而不是把同一收敛工作拆成 `0.1.8 / 0.1.9 / 0.1.10 ...`。

开发中不要为了每个内部修正向 `main` 推新的 runtime patch。使用独立 convergence branch；只有阶段 candidate 稳定时才将正式 runtime version 设为 `0.2.0`。中间诊断身份用 `BUILD_LABEL` 区分，例如 `v020-convergence.copy.1`、`v020-convergence.ui.2`，但在同一次真实验收前必须确保用户加载的是明确可识别的 candidate。

## 最高优先级原则

### 1. Mica 绝不能让 ChatGPT 更卡

composer typing path 是最高级性能红线。普通输入必须近似 O(1)，不得重新出现 clone/style/layout/full-document scan/high-frequency polling 回归。

### 2. Long-thread P0 不能靠状态文案冒充完成

当前 ChatGPT 已存在 native conversation windowing。Mica 只有在真实测量证明以下至少一项时，才可声称 long-thread optimization 有效：

- 明确减少 Mica 可控的活跃 DOM/render/layout 成本；
- 明确减少额外 JS/observer/timer overhead；
- 在原生 mounted window 变大/异常时实施安全、可恢复的额外预算控制；
- 或证明当前 native windowing 已承担真正“截断”，Mica 保持 zero-cost/native-safe 并不会把历史重新拖回高成本状态。

不得通过降低 threshold 或伪造 `Active` 状态制造“好像优化了”的结论。

### 3. 用户人工验收预算 <= 1 轮/普通问题

一个 goal 内应先把 synthetic/contract/affected/integration 测试做完，再进入真实站点。第一次真实 acceptance 失败时必须先改 fixture/contract/diagnostics，不得立即让用户重复同一动作。

### 4. 真实 authenticated Edge 的绝对安全边界

即使 Codex / Computer Use / browser agent 能控制真实 Edge，也只能：

- 读取当前页面、DOM、layout、performance metadata 和 Mica runtime state；
- 在 composer 中写入/替换/清除临时、无敏感测试文本，并恢复原状态。

**绝对禁止：**

- 点击 Send；
- 通过 Enter / Ctrl+Enter / keyboard shortcut 触发发送；
- form submit；
- 调用任何发送消息 endpoint；
- 上传文件、图片或附件；
- 打开 file picker；
- 选择/执行 connector/tool；
- OAuth、Drive/GitHub/Gmail 外部动作；
- retry / regenerate；
- 删除、编辑真实 conversation；
- 账户设置、购买、付费、授权；
- 为测试制造批量真实 ChatGPT 请求。

如果 Computer Use 的动作边界不能可靠证明，则真实 Edge 退回纯只读。

任何需要“真实发送”的验收必须停在发送前，由用户本人完成一次明确手动发送。

## 执行顺序

### Goal 001 — Test Architecture Reconciliation + Safe Live Evidence

文件：`2026-09-08-v020-goal-001-test-architecture-and-safe-probe.md`

先合并/保住本地 `6337b71`，修复 workflow scope 造成的远端落地问题，并把 real-site evidence capture 做成真正可用、fail-closed 的只读/文本框修改工具链。

### Goal 002 — Long-thread Performance & Memory Hardening

文件：`2026-09-08-v020-goal-002-long-thread-memory.md`

重新证明 P0：不允许只依赖 `content-visibility` 文案。建立 native-window + Mica overhead 预算，确保长线程不会因 Mica 自身变重，并在安全范围内提供真实减负。

### Goal 003 — Stable Copy & Export v1

文件：`2026-09-08-v020-goal-003-copy-export.md`

实现可预测的单条回答 Markdown Copy。默认 display math 使用 `$$ ... $$`，不再输出 ChatGPT 当前的 `\[ ... \]`；同时稳定处理 heading/list/table/code/quote/link/math。

### Goal 004 — Overlay + Popup Productization

文件：`2026-09-08-v020-goal-004-interface-polish.md`

移除/收敛目前 composer diagnostics 的右上角独立 panel，统一 page status/diagnostics overlay；重做当前过于原始的 320px popup，使其成为紧凑、清晰、低摩擦的正式 extension UI。

### Goal 005 — Reliability Convergence + One-shot Pre-send Acceptance

文件：`2026-09-08-v020-goal-005-one-shot-acceptance.md`

将 #4/#5/#6 的共享 composer/send lifecycle 收拢，所有可在发送前诊断的行为全部自动推进；建立一个 one-shot acceptance session，把必须依赖一次真实 send 才能确认的证据合并到同一次用户手动发送中。

### Goal 006 — 0.2.0 Candidate / Release Gate

文件：`2026-09-08-v020-goal-006-release-candidate.md`

只有前五个 goal 都满足自动 gate，并且只剩一次真人 send / 低内存设备体验这种不可替代验收时，才形成 `0.2.0` candidate。

## 并行策略

Goal 001 是所有 runtime goal 的前置依赖。

Goal 002、003、004 的研究/fixture 可以并行，但实际 runtime 修改建议在同一个 convergence worktree 中顺序落地，避免 `content.ts`、popup settings、build manifest 相互踩踏。

Goal 005 必须在 002–004 的 runtime surface 基本稳定后执行，因为 one-shot acceptance 需要一次性覆盖：

- typing no-jank；
- composer native geometry；
- stale/remount；
- send-intent -> user-turn commit；
- send residual；
- overlay 状态；
- long-thread runtime counters；
- response settled 后的 copy action（复制本身无需再次发送）。

## 测试策略

开发循环使用：

- `test:fast`
- `test:affected`
- 必要的 focused browser case

candidate 才运行 integration/full。

不要因为“最终 full 反正会跑”而跳过 deterministic invariant，也不要因为“已有 focused 通过”在每次小修改后重复跑 3 分钟 full E2E。

## 0.2.0 最终产品验收

必须同时满足：

1. 普通 typing 与 connector-latched typing 都无可见 Mica 输入延迟；
2. long-thread 模块有可解释、可测量的真实效果或明确 native-windowed zero-cost 行为；
3. 单条回答复制得到稳定 Markdown；display math 默认 `$$...$$`；
4. popup 视觉达到可日常使用/未来 Web Store 基础，而不是工程调试表单；
5. 页面常驻状态与 diagnostics 不占右上角/输入区域，不遮挡 ChatGPT；
6. composer stale/remount/connector flow 不因 Mica 增加额外故障；
7. 一次用户手动发送可以收集剩余 send-dependent evidence；
8. Computer Use/agent 从头到尾没有发送、上传、connector 外部动作；
9. diagnostics/privacy 边界保持：不保存 prompt/answer 原文到报告，不上传 telemetry；
10. `dist/mica-dev`、version、popup、diagnostics、manifest 一致。

## Stop condition

持续开发 goal 不应在每一个小问题后停下来问用户。

只有以下情况允许停：

- 已自动修完并达到 `READY_FOR_ONE_MANUAL_SEND = YES`，剩余信息必须由用户本人发送一次才能获得；
- 真实 Edge 安全边界无法保证，继续会有发送/上传/授权风险；
- 需要用户提供新的业务决策而不是工程判断。

除此之外继续使用仓库现有证据、fixture、issues 和安全只读页面检查自行推进。