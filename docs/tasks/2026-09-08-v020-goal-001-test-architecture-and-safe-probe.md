# Goal 001 — Test Architecture Reconciliation + Safe Live Evidence

## Goal

把用户本地已经完成的 Test Architecture v2 真正变成后续 0.2.0 的开发基线，并建立一个**绝不发送/绝不上传**的 authenticated Edge 证据入口。完成后，后续 goal 不应再因为缺少真实 ChatGPT DOM 证据反复要求用户手测。

## 已知前提

用户报告本地存在提交：

`6337b71 Redesign Mica test architecture`

报告结果：

- `npm test`: PASS ~1.89s
- `npm run test:affected`: PASS ~10.74s
- `npm run test:integration`: PASS ~7.33s
- `npm run test:e2e`: PASS ~185.56s
- connector affected suite 从 ~40.8s 降至 ~1.84s
- virtual clock / affected selector / candidate runner / synthetic composer contract 已实现
- `.github/workflows` 因当前 GitHub credential 缺少 workflow scope 导致整个本地 commit 无法 push
- executable Real Edge probe 被 auto-review 拒绝，当前只有规则/设计

不要丢弃或覆盖这个本地提交。

## Step 1 — Reconcile local vs remote

1. 确认本地 `6337b71` 的 parent 与远端 `aa4ce525...` 关系。
2. 逐项审计其 13 个 changed files，尤其：
   - `AGENTS.md`
   - `docs/TEST_ARCHITECTURE_V2.md`
   - `package.json`
   - `scripts/test-affected.mjs`
   - `scripts/test-candidate.mjs`
   - `tests/fixtures/virtual-clock.js`
   - composer contract seed/validator/builder
   - `.github/workflows/*`
3. 保证测试架构改动没有修改 `extension/src` runtime；如果确实没有，则保持 runtime `0.1.7` 不 bump。
4. 将 workflow 文件与其余 Test Architecture v2 变更解耦：GitHub auth 暂时不允许 workflow write 时，**不得让 CI 文件阻塞其余十几个已验证文件进入远端工作分支**。
5. 不使用 force push 覆盖远端历史。

允许最终状态：

- Test Architecture v2 非-workflow部分已远端化；
- workflow 单独保留 pending，并明确 `CI_REMOTE_BLOCKED_BY_WORKFLOW_SCOPE=YES`。

不要为了 CI scope 卡住整个 0.2.0。

## Step 2 — Make test architecture authoritative

确认并修正以下命令语义：

- `test:fast`: 目标 <=10s；
- `test:affected`: 普通 runtime 修改目标 <=30s；
- `test:integration`: candidate integration 目标 <=60s；
- `test:e2e`: 不作为每次编辑 gate；
- `test:e2e:stress`: 仅 race/release。

Affected selector 必须显式把跨模块性能不变量映射进去：

- 修改 composer/listener/observer/connector -> typing hotpath；
- 修改 long-thread -> typing hotpath + long-thread lifecycle；
- 修改 copy -> copy fixtures + minimal composer-interference smoke；
- 修改 overlay/popup -> overlay + popup visual/interaction fixture；
- 修改 shared content entry -> broad affected set。

不要依靠 Codex 临时猜测试集合。

## Step 3 — Real Edge safety contract

真实 authenticated Edge 只允许以下动作：

### Allowed

- 读取当前 tab URL/origin；
- 读取 DOM 结构和属性；
- 读取 element bounding rect / limited computed style；
- 读取 Performance API / Mica runtime counters；
- 读取 extension version/build label；
- 若 composer 可安全识别，保存其当前文本长度/是否为空；
- 仅在无敏感原文被覆盖的前提下写入固定 harmless sentinel；
- 恢复原 composer 内容/空状态。

### Forbidden — unconditional

- Send button；
- Enter / Ctrl+Enter / keyboard shortcut 发送；
- `form.submit()` / `requestSubmit()`；
- fetch/XHR/websocket mutation；
- 上传/附件/file picker；
- connector/tool invocation；
- OAuth/Drive/GitHub/Gmail actions；
- retry/regenerate；
- Stop；
- conversation navigation/reload；
- delete/edit existing conversation；
- account/settings/payment/authorization；
- arbitrary click API on ChatGPT controls。

**即使 Computer Use 插件可用，也不放宽上述规则。**

如果 generic computer-use surface 无法保证这些限制，不使用 generic interaction；退回只读 DOM/CDP 或 Mica 自身的 bounded diagnostic surface。

## Step 4 — Safe evidence implementation

首选实现不是一个通用“浏览器遥控器”，而是窄接口。目标 API/command surface 类似：

- `inspectPage()`
- `inspectComposer()`
- `inspectMicaRuntime()`
- `captureComposerContract()`
- `measureTypingSentinel()`
- `restoreComposer()`

代码层面不得存在可被该 probe 暴露的：

- `click(selector)`
- `press(key)`
- `submit()`
- `navigate()`
- `upload()`
- arbitrary page evaluate with unrestricted side effects

### 如果外部 executable probe 仍被 auto-review 拒绝

不要绕过。

实现 Mica 内置的 `Live Contract Capture` / 等价开发诊断：

- 用户在 popup 手动触发；
- content script 只采结构化、脱敏信息；
- `Copy report` 导出；
- 不发送；
- 不上传；
- 不需要 DevTools Console。

这样后续真实站点证据仍然只需要一次用户点击，而不是十轮人工描述。

## Step 5 — Composer contract

真实 contract 至少覆盖：

- composer surface/root/editable 层级关系；
- stable tag / role / data-testid / relevant data-*；
- connector pill structural selector（若当前页面已有，则只读；不要自动选择 connector）；
- bounding rect；
- limited visual properties；
- send button presence/disabled 状态只读；
- mounted/native window summary；
- Mica overlay rect。

严格排除：

- prompt/answer 原文；
- auth token/session cookie；
- request/response body；
- attachment/file names if private；
- account identifiers。

## Acceptance

必须输出：

- `LOCAL_6337B71_PRESERVED = YES`
- `TEST_ARCH_V2_REVIEW = PASS`
- `FAST_SECONDS`
- `AFFECTED_SECONDS`
- `INTEGRATION_SECONDS`
- `WORKFLOW_REMOTE = PASS/BLOCKED_SCOPE`
- `SAFE_EDGE_ALLOWED_SURFACE`
- `SAFE_EDGE_SEND_CAPABILITY_EXPOSED = NO`
- `SAFE_EDGE_UPLOAD_CAPABILITY_EXPOSED = NO`
- `LIVE_COMPOSER_CONTRACT = PASS/PENDING_ONE_MANUAL_CAPTURE`
- `READY_FOR_RUNTIME_GOALS = YES/NO`

只有 Test Architecture v2 可被后续 worktree 使用，并且真实站点证据链不会要求 Computer Use 发送/上传时，才结束 Goal 001。