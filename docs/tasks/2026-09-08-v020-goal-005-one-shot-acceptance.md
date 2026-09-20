# Goal 005 — Reliability Convergence + One-shot Pre-send Acceptance

## Goal

把当前 #4 / #5 / #6 中相互重叠的 composer/send/connector 问题收拢到一个共享生命周期，并把所有能够在“真实发送之前”完成的诊断、修复和验证全部做完。

最终状态应该是：

`READY_FOR_ONE_MANUAL_SEND = YES`

此时剩余未知量必须真的是“只有用户本人发送一次，才能看到服务端 commit / assistant generation 后的真实生命周期”。

不要在达到这个状态之前让用户一轮一轮发送测试消息。

## Covered problems

至少覆盖现有证据中的：

- connector mention selection/remount；
- composer temporary disappearance；
- stale draft after successful send；
- stale partial payload reappearing after remount；
- send intent vs true user-turn commit；
- ghost send / fake thinking suspicion；
- stale/duplicate previous assistant turn suspicion；
- new user typing after send must never be deleted；
- continuity shell must not mask a real send generation；
- diagnostics itself must not cause typing jank。

## Architecture principle

不要继续叠五套互相不知道对方状态的 polling recovery。

建立/整理一个共享的 send generation identity：

```text
idle
  -> prepared
  -> send_intent
  -> awaiting_user_commit
  -> user_committed
  -> assistant_started
  -> assistant_settled
  -> complete
```

异常 evidence：

```text
ghost_send_suspected
stale_draft_detected
stale_payload_reappeared
stale_response_suspected
```

不是所有异常都要自动修。

Mica 只有在高置信、无 consequential context 时才可做本地 composer stale-clear recovery；ghost/stale response 第一版主要诊断/提示，绝不自动重发。

## Safety invariants

### No automatic send

任何代码都不能：

- click Send；
- synthesize Enter to submit；
- call form submit；
- invoke ChatGPT send endpoint；
- retry/regenerate automatically。

### No automatic upload / connector action

任何 Computer Use、probe、Mica test helper 都不能：

- upload file；
- open file picker；
- attach image/document；
- choose/execute connector/tool；
- click OAuth/authorization。

这条规则即使用户已经登录、connector 已可用也不放宽。

### User input wins

一旦 send 后检测到新的 trusted user input：

- cancel stale payload cleanup generation；
- 不删除新文字；
- 不恢复旧 snapshot；
- 不“为了保持一致”覆盖用户输入。

## Part 1 — Finish all pre-send paths automatically

Synthetic/contract tests 必须把以下全部做到 PASS：

1. normal typing；
2. IME/composition；
3. `@` text / chooser-open surrogate；
4. first Enter is connector selection surrogate, not send；
5. composer root/editable remount；
6. full delete/cut -> remains empty；
7. connector pill remains, body text empty；
8. temporary composer missing + return；
9. continuity cached shell visual stability；
10. no send generation before true send gesture；
11. no 60/80/150ms permanent polling while idle/typing；
12. stale-clear quiet window deterministic via virtual clock。

如果这些不通过，不允许进入真实 send acceptance。

## Part 2 — One-shot acceptance session

新增一个开发/advanced UI：

`Prepare final send check`

用户点击后，Mica：

1. 确认 diagnostics 当前未运行；
2. 确认 composer 可识别；
3. 如果 composer 非空，不覆盖，提示 `Composer not empty`；
4. arm 一个 bounded acceptance session；
5. 可选写入仓库固定、无敏感的 acceptance prompt；
6. 不发送；
7. 显示 `Ready — send manually when you choose`。

Computer Use 如果被用于准备真实 Edge，仍只能做与上述等价的 composer 文本写入/读取，不能点击这个按钮或 ChatGPT controls，除非用户明确另行放宽；默认按严格边界处理。

## Fixed harmless acceptance prompt

准备一个仓库内固定 prompt，目标是让一次普通回答同时产生可测试的 Copy 结构，例如：

- 一个 heading；
- 一条 bullet；
- 一段普通 prose；
- 一个 inline equation；
- 一个 display equation；
- 一个 fenced code block；
- 一个两列表格。

不要包含私人信息，不引用当前 conversation 内容。

### Connector-specific path

#6 的真实问题与 connector send 有关，但 agent 不能自动选择 connector。

因此 final acceptance 支持两种 mode：

**Plain one-shot**

用户只点击 Send；验证绝大多数 send/composer/copy lifecycle。

**Connector one-shot（优先用于当前 #6）**

Mica 先准备 harmless prompt；然后**用户本人**手动选择 `@GitHub`，确认它是 read-only request，再手动点击 Send 一次。

推荐固定 read-only request 只读取本仓库公开信息，例如 README 标题/版本，不请求任何写操作。

Mica/Computer Use 绝不替用户选择 connector，也绝不发送。

如果用户不想触发 connector，则使用 Plain one-shot，不阻塞 0.2.0 其余功能；connector-specific evidence 标为 pending。

## Part 3 — What one manual send must capture

从用户手动 Send 之前已经 armed 的 session 中，结构化记录：

### Before send

- build/version；
- Mica feature flags；
- composer/root/editable IDs；
- body text length；
- connector pill boolean/structural signal；
- mounted turn count；
- latest user/assistant structural identity hash；
- typing/perf counters baseline。

### Send intent

- click/submit intent timestamp；
- pre-send fingerprint/length，仅本 session memory；
- report 不含 raw prompt。

### Commit

- new user turn appeared；
- user-turn identity advanced；
- total mounted delta；
- composer unmount/remount；
- body text became zero；
- residual appeared/not appeared；
- recovery attempted/succeeded/skipped reason。

### Assistant

- new assistant identity advanced；
- streaming started；
- settled；
- previous assistant fingerprint vs current fingerprint；
- only hash/length/similarity metadata, not answer text。

### UI/performance

- Mica overlay remained single/bottom-right；
- no top-right diagnostic panel；
- no long task caused by Mica callback where attributable；
- long-thread mode/counters after send。

## Ghost-send handling

如果 send intent 后没有 user-turn commit：

- 不自动再发；
- 保留/恢复 composer text only when provenance is high confidence and no new user input；
- report `GHOST_SEND_SUSPECTED`；
- session 结束时给用户一个清楚提示，而不是无限 thinking。

## Stale response handling

如果 user turn 已 commit，但 assistant structural identity 没推进或最终 answer fingerprint 与上一轮高度重复：

- report `STALE_RESPONSE_SUSPECTED`；
- 不自动 regenerate；
- 不 reload；
- consequential/tool context 时只记录。

第一版宁可漏报，不要误杀正常相似回答。

## Copy integration after the same response

一次 manual send 完成后，不需要再发送第二条。

用户可以对刚生成的回答执行一次 Mica Copy；Goal 003 的 copy diagnostics 记录：

- serializer profile；
- output length；
- heading/list/code/table/math structural counts；
- display delimiter check = `$$`；
- 不把完整回答写进 diagnostics。

这样一次生成同时覆盖 Copy acceptance。

## Automatic exit

assistant settled 或合理 bounded timeout 后，acceptance session 自动停止重采样，report 进入 ready state。

不允许 diagnostic session 长时间常驻 150ms polling。

如确实需要 sampler，只在 bounded send generation active 时运行，并优先事件驱动。

## Acceptance before asking user

在向用户展示“一次发送”步骤前必须满足：

- `test:fast` PASS；
- `test:affected` PASS；
- `test:integration` PASS；
- typing hotpath PASS；
- pre-send connector/remount fixture PASS；
- copy golden fixture PASS；
- overlay fixture PASS；
- long-thread performance invariant PASS；
- candidate build ready；
- no automated send/upload capability used。

## Final pre-send output

停止并只输出一个短 handoff：

- `READY_FOR_ONE_MANUAL_SEND = YES/NO`
- `RECOMMENDED_MODE = CONNECTOR/PLAIN`
- `BUILD =`
- `PREPARED_PROMPT = YES/NO`
- `DIAGNOSTICS_ARMED = YES/NO`
- `AUTOMATED_SEND_PERFORMED = NO`
- `AUTOMATED_UPLOAD_PERFORMED = NO`
- `AUTOMATED_CONNECTOR_ACTION_PERFORMED = NO`
- `USER_ACTION =` 精确到 1–3 个动作
- `AFTER_SEND =` 等待 report ready，然后一次 Copy report / Mica Copy

Goal 到这里结束，不替用户完成发送。