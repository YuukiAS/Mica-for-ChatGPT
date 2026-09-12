# Mica Live Surface Atlas — Dedicated Capture Thread Runbook

Status: **PRE-CAPTURE BLOCKED by Goal 012 screenshot-coordinate integrity gate.**

Goal 009 protocol, targeting, ingestion, sanitizer, fixture, and lifecycle gates are implemented in `ae0732b Harden atlas ground truth capture`. Goal 010 preflight-integrity gates are implemented in `05ebda7 Complete atlas preflight integrity gate`. Goal 011 coordinate-safe targeting and attach-handshake gates are implemented in `45aa9dc Harden atlas targeting handshake`.

A final code audit found that the current matcher correctly converts DOMSnapshot document coordinates into viewport coordinates for comparing against `getBoundingClientRect()`, but screenshot capture still reuses that viewport-relative rectangle. `Page.captureScreenshot` needs a page/document clip with deliberate CSS-pixel/DIP conversion. See `docs/tasks/2026-09-12-v020-goal-012-screenshot-coordinate-integrity.md`.

Do not run the real Edge no-send preflight or Round 1 until Goal 012 passes and this runbook is explicitly marked READY again.

During the no-send preflight and the later dedicated capture, click Mica -> Advanced -> `Start Atlas` only after the CDP companion has printed both:

```text
REAL_EDGE_CDP_ATTACHED = YES
SAFE_TO_START_ATLAS = YES
```

Do not use a fixed sleep as a substitute for this handshake.

This runbook defines the single dedicated real ChatGPT thread used to bootstrap Mica's Live Surface Atlas. The goal is to collect real UI structure, lifecycle ordering, timing evidence, and visual checkpoints once, then replay them locally instead of repeatedly asking the user to QA Mica.

## Version / branch prerequisite

Do not run this capture from `main` / `0.1.7`.

Required candidate branch:

```text
codex/v020-convergence-pushable
```

Before capture, the local `dist/mica-dev` must be rebuilt from that branch and the popup/manifest must identify the current `0.2.0` convergence candidate.

## Hard safety boundary

Atlas, CDP, Codex, Computer Use, Playwright, or any other agent/tool must never perform a real ChatGPT Send, Enter/Ctrl+Enter submit path, upload, connector execution, regenerate/retry, OAuth, account mutation, or conversation mutation.

All real Send actions in this runbook are manual user actions.

The CDP companion is read-only. Computer Use is not required for the capture and must not drive the conversation.

## Dedicated thread

Create one harmless dedicated ChatGPT thread inside the current project. Do not use a research/work/private thread and do not upload files.

Keep one Atlas recording session active across the whole run. Do not stop/restart Atlas between rounds unless capture fails.

Before Round 1:

1. Reload the unpacked Mica candidate from `dist/mica-dev`.
2. Open the dedicated capture thread.
3. Start the hardened read-only CDP companion for this exact thread URL.
4. Wait until the CDP companion prints `SAFE_TO_START_ATLAS = YES`.
5. Open Mica popup -> Advanced -> `Start Atlas`.
6. Confirm Atlas shows Recording and the CDP companion reports one exact target attached in read-only mode.

## Round 1 — Real composer typing / IME / paste

Purpose: capture normal composer focus, English/Chinese input, IME composition, correction, paste, input latency, and the first plain manual Send lifecycle.

Manual editing sequence before Send:

1. Type `Mica Atlas typing test: ABC 123 `.
2. Using Chinese IME, type `中文输入法测试`.
3. Backspace the final two Chinese characters and re-type them.
4. Paste exactly: ` | pasted-segment | `.
5. Type the final sentence below, then manually click Send once.

Message to send:

```text
Mica Atlas baseline round. 请只用一句中文回复：Baseline capture complete.
```

Wait until the answer is fully settled and its normal assistant action bar is visible.

## Round 2 — Rich answer / Copy ground truth

Purpose: capture the real assistant DOM for Markdown/LaTeX, action-bar geometry, native Copy area, and Mica Copy output.

Send exactly:

```text
这是一个浏览器渲染与复制测试。请不要调用任何工具或联网，只生成一份短测试答案，并严格包含以下结构：

1. 一个二级标题；
2. 一段普通文字，其中同时有粗体、斜体和行内公式 a^2+b^2=c^2；
3. 一个两层嵌套的无序列表；
4. 一个引用块；
5. 一个独立展示公式：从 0 到 1 的 x^2 积分等于 1/3；
6. 一个 fenced Python 代码块，内容为定义并调用平方函数；
7. 一个恰好两列、三行数据的 Markdown 表格；
8. 最后一行写：Rich capture complete.

不要加入额外章节，也不要使用附件、工具、搜索或连接器。
```

After the answer settles:

1. Wait until the native assistant action bar is visible.
2. Manually invoke Mica Copy once.
3. Keep the copied Markdown for the final Atlas handoff; do not edit it before comparison.

Expected Copy invariant: display math should serialize with `$$ ... $$`, not `\[ ... \]`.

## Round 3 — Streaming cadence / longer answer

Purpose: capture a longer real streaming sequence, mutation cadence, settled transition, action-bar appearance, mounted-turn window changes, Long Animation Frames, and long-task evidence.

Send exactly:

```text
请不要调用任何工具或联网。用大约 1200 至 1600 个中文字解释“偏差—方差权衡”，面向已经学过基础统计但还没有系统学机器学习的读者。要求分成 5 个小节，每节有清楚标题；包含一个简单公式、一个具体数字例子和一个最后总结。不要故意缩短答案，也不要超过 1800 个中文字。
```

During generation, do not click Stop or interact with the answer. Wait for full settlement and the normal action bar.

## Round 4 — Composer lifecycle without Send

Purpose: capture edit/clear/cut/focus behavior without consuming a server-side Send.

Do **not** send anything in this round.

1. In the composer, type exactly:
   `Atlas composer lifecycle 123 中文测试 ABC`
2. Press `Ctrl+A`, then Delete.
3. Type exactly:
   `Atlas second draft — 不发送`
4. Select only `second draft` and cut it with `Ctrl+X`.
5. Click a harmless blank area outside the composer to blur it.
6. Click the composer again to focus it.
7. Clear the remaining draft with `Ctrl+A` -> Delete.
8. End with an empty composer.

## Round 5 — Connector chooser / pill / remount without Send

Purpose: capture real connector chooser, selected connector pill, composer identity/remount behavior, geometry, and removal without executing the connector.

Do **not** send anything in this round.

1. Manually type `@GitHub`.
2. Manually select the GitHub connector from the chooser.
3. Wait briefly until the connector pill and composer are visually stable.
4. Type exactly: `Atlas connector UI only — do not send`.
5. Observe that ordinary typing remains smooth.
6. Remove/clear the connector and draft using normal UI/editor actions.
7. End with an empty composer.

Only the user may select `@GitHub`. Agents/CDP/Computer Use must not select it.

## Round 6 — Optional connector Send + final Mica 0.2.0 acceptance

Run this only after Rounds 1–5 have captured successfully and the pre-send gates remain green.

This round may double as the final Mica `0.2.0` manual connector acceptance.

The user manually selects `@GitHub` and manually sends the following read-only request:

```text
@GitHub 仅做只读检查：读取 YuukiAS/Mica-for-ChatGPT 仓库的 README.md 第一行，并用一句中文告诉我这一行是什么。禁止创建、修改、删除、合并、评论、打标签或执行任何其他 GitHub 写操作。
```

After completion, verify manually:

- only one user turn was committed;
- composer clears correctly;
- no stale sent text reappears;
- composer remains usable and typing stays smooth;
- assistant/tool UI settles normally;
- Mica overlay does not obstruct native ChatGPT UI.

If connector execution is not desired, skip Round 6 and perform the final `0.2.0` acceptance later with a plain harmless Send instead.

## End of capture

After the final chosen round:

1. Stop Atlas once.
2. Copy the Atlas report once.
3. Stop the read-only CDP companion cleanly.
4. Keep raw capture under `artifacts/live-atlas/<session-id>/`; raw artifacts must remain gitignored.
5. Run the complete post-processing pipeline before interpreting the result:

```text
npm run atlas:sanitize -- --input=<raw-session>
npm run atlas:build-fixtures -- --input=<sanitized-contract>
npm run atlas:analyze-timings -- --input=<sanitized-contract>
npm run test:atlas
npm run test:integration
```

6. Compare Round 2 Mica Copy against the expected structure and `$$` display-math invariant.
7. Audit every remaining lifecycle timing constant against the real timing ledger. Prefer event-driven transitions; retain only justified safety caps.

## Capture success gate

The bootstrap session is complete only when all are true:

```text
REAL_CDP_ATTACHED = YES
REAL_SURFACE_CONTRACTS > 0
REAL_CROPPED_CHECKPOINTS > 0
MULTI_ROUND_LIFECYCLE_RECORDED = YES
TIMING_LEDGER_REAL_N > 1 where the transition repeats
PRIVACY_VALIDATION = PASS
OFFLINE_FIXTURE_REPLAY = PASS
ATLAS_CAPTURE_DID_NOT_CAUSE_TYPING_LAG = YES
AUTOMATED_SEND = NO
AUTOMATED_ENTER = NO
AUTOMATED_UPLOAD = NO
AUTOMATED_CONNECTOR_ACTION = NO
```

If any required real surface remains `MISSING`, keep it marked `MISSING`; do not hand-draw an approximation and call it ground truth.
