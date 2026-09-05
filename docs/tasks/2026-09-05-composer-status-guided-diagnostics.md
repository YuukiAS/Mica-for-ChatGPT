# 2026-09-05 Composer status + guided diagnostics task

## 背景

Lenovo Legion 上当前加载的 Mica 已确认是 `buildLabel: native-safe-inert.1`，不是 9 月 1 日公开 ZIP 中更早的运行逻辑。真实诊断同时出现：

- `runtime.nativeSafeMode: true`
- `runtime.documentMutationObserverActive: false`
- `runtime.composerLifecycleListenersAttached: false`
- `status.mountedTurns: 0`
- 但同一份报告里的 `mountedTurns.current: 5`、`mountedTurnComplexity.count: 5`

因此当前有三个相互独立但应在同一轮处理的目标：

1. 恢复用户熟悉的右下角 Mica compact status 点；
2. 修复 native-safe 启动过早后 `0 mounted` 状态永久陈旧的问题；
3. 把临时 Console probe 升级为 Mica 内置的“引导式 composer 诊断”，让用户只执行少量明确的人工作业，Mica 自动收集隐私安全的结构证据。

本轮不是直接解决所有 composer 根因。先把状态本身修正确，并准备足够好的真机诊断闭环，再决定“文本框消失 / 发送后文本残留”到底是 Mica、ChatGPT 原生 composer/connector lifecycle、Edge profile/其他扩展，还是叠加问题。

---

## Goal A — 恢复右下角 compact status，且继续 zero-contact composer

当前 compact 状态走 `top-right-static`，这是为了绕开 composer geometry。用户明确要求恢复到右下角。

实现要求：

- compact status 默认固定在 viewport 右下角，例如 12px 安全边距；
- **不要**为了放回右下角重新读取 composer geometry；
- compact 状态不得重新 attach composer `ResizeObserver`、input/cut/keydown/submit/click listeners 或 document-wide `MutationObserver`；
- native-safe 模式下仍应保持：
  - `documentMutationObserverActive: false`
  - `composerLifecycleListenersAttached: false`
- 右下角只放 compact 点；如果 expanded status / toast 需要更大空间，优先采用静态、viewport-only 的布局（向左/向上展开），不要恢复 composer-aware 动态避让作为默认路径；
- 小屏幕允许使用纯 viewport breakpoint 做静态调整，但不要以读取 composer DOM/geometry 为前提。

验收：

- 页面正常加载后 compact 点出现在右下角；
- 点击可展开状态；
- synthetic fixture 中 compact/expanded 均不读取 composer geometry；
- 不与现有 native-safe 安全边界冲突。

---

## Goal B — 修复 native-safe 下 stale `0 mounted`

当前死锁：首次 scan 可能在 ChatGPT turns 挂载前看到 0，随后 `enterNativeSafeMode("no mounted turns")`。native-safe 的 1.5s interval 只执行 `processKnownInterruptions()` 后直接 return，而普通 `scheduleScan()` 又拒绝在 native-safe 内运行，于是后来 DOM 已有 5 个 turns，`currentStatus` 仍永久保留 0。

修复原则：

- native-safe 不是“永远不再看 conversation”，而是“绝不碰 composer，只保留极轻量 conversation presence/count probe”；
- 不重新启用 document `MutationObserver`；
- 不重新启用 composer lifecycle listeners；
- 不读取 composer geometry；
- 在 native-safe 内按低频（当前 1.5s interval 可复用，必要时 2–3s）只检查 mounted conversation turns 的结构/数量；
- 为这个用途最好增加一个独立的 `collectMountedTurnStatusProbe()` / 等价函数，不调用 composer protection/geometry 路径；
- 如果 probe 从 `0 -> 5`，更新 `currentStatus` 为正确 mounted count，同时继续保持 native-safe；
- 如果 mounted count 在小窗口内变化（例如 5 -> 7 -> 6），status 应跟随更新；
- 如果发现数量已经超过 native-only threshold，需要再进入完整 decision path 时，必须通过显式、可审计的状态转换，而不是偷偷重开 observers；
- diagnostics 中 `status.mountedTurns`、`mountedTurns.current`、`mountedTurns.lastObserved` 不应长期互相矛盾。

需要增加 fixture：

1. Mica 先启动，初始 0 turns；
2. 延迟数百毫秒后挂载 5–6 turns；
3. Mica 必须从 `0 mounted` 自动更新为真实 count；
4. 全程 `nativeSafeMode === true`、document MutationObserver false、composer lifecycle listeners false；
5. 后续小范围 turn churn 也能更新 status。

---

## Goal C — 内置“引导式 Composer 诊断”，替代手工 Console JS

### 产品目标

用户不应再需要：打开 DevTools、粘贴 JS、执行 `reportText()`、自己记时间点。

Mica popup 增加一个清晰入口，例如：

`Run composer check`

点击后，在 ChatGPT 页面显示一个轻量的诊断引导卡。这个卡只告诉用户下一步做什么，并自动记录结构证据；**绝不替用户发送真实 ChatGPT 消息**。

### 建议诊断流程

第一版只做一个短流程，避免过重：

**Step 1 — 普通删除**

页面提示：

> 在输入框输入 `abc test`，然后 Ctrl+A → Delete。不要发送。

Mica 观察 composer 是否消失、editable/root identity 是否替换、删除后 text length 是否回到 0。完成后用户点“下一步”，或在能高置信检测完成时自动推进。

**Step 2 — GitHub mention 删除**

页面提示：

> 输入 `@GitHub` 并正常从 ChatGPT 候选里选中 GitHub，然后 Ctrl+A → Delete。不要发送。

不要让 Mica 自动点击 connector 候选。不要自动插入 mention。用户完成后点“下一步”。

**Step 3 — 一次人工发送**

页面提示：

> 输入一条很短的测试消息，并由你自己点击发送。Mica 不会自动发送。

Mica 记录：发送前后 composer 是否 unmount/remount、editable/root identity、text length 是否清零、是否出现新的 user turn、发送后旧 draft 是否恢复。不要记录测试消息正文。

**Step 4 — 完成**

显示一个简短结论摘要，例如：

- composer disappeared during delete: yes/no
- max missing duration
- editable identity changes
- stale text after send: yes/no
- new user turn observed: yes/no/unknown
- Mica runtime mode during test

提供 `Copy report`。

### 诊断采样边界

诊断本身不能成为新的干扰源。

第一版优先使用短时、低接触的定时采样，而不是新增永久 observer：

- guided session 未开启时：**零额外 composer 诊断采样**；
- session 开启时，可每 100–200ms 读取一次最小状态；
- 不使用 document-wide MutationObserver；
- 不修改 composer DOM；
- 不 dispatch `input` / `change` / `submit`；
- 不调用 `.click()` 操作 send/mention/connector；
- 不拦截或修改 fetch/XHR；
- 不读取 request body/header/token；
- 不记录 prompt/answer 原文；
- 允许记录文本长度、布尔状态、DOM identity（session-local WeakMap id）、testid/role/contenteditable、turn identity、时间戳；
- 诊断结束后停止 timer，清理 panel 和 session state。

可以参考已经提交的 `scripts/composer-page-probe.js`，但不要把它原样作为长期产品模块塞进 `content.ts`。建议独立为：

`extension/src/reliability/composer-diagnostics.ts`

或等价模块，并在 build 中单独加载，保持边界清楚。

### 诊断 UI 边界

- popup 负责启动 / 停止 / Copy latest report；
- 用户实际操作页面时 popup 会关闭，因此步骤提示必须在 page overlay 中继续显示；
- 诊断卡不要盖住 composer，优先放在右上/顶部等静态区域；
- 诊断卡的布局不得为了避让 composer 去读 composer geometry；
- status dot 仍保持右下角；诊断卡与 status dot 是两套 UI；
- 诊断卡必须明确显示 `Mica 不会自动发送消息`。

### 真机风控边界

- Codex / Playwright 不得自动操作用户已登录 ChatGPT；
- synthetic fixture 可完全自动化；
- 真站发送动作永远由用户手动完成；
- 真站只做必要的 1 次发送诊断，不循环请求；
- 普通输入、删除和 `@GitHub` mention 选择也由用户执行，Mica 只引导和记录；
- 不自动 reload conversation，不自动 regenerate，不自动 retry。

---

## Synthetic tests

至少新增/扩展以下覆盖：

1. **Delayed turns after Mica boot**：0 -> 6 mounted，status 自动更新，native-safe 不退出。
2. **Static bottom-right status**：compact status 位于右下角，且 placement path 不读取 composer geometry。
3. **Guided delete**：模拟输入和 delete，diagnostic session 记录 text length / identity / missing duration，不记录文本。
4. **Guided mention-like lifecycle**：fixture 模拟 mention chip / editable replacement；Mica 不点击、不修改。
5. **Guided manual-send surrogate**：fixture 自己触发 native submit lifecycle；Mica 只观察，报告能指出 stale text / remount / new user turn。
6. **Diagnostics off**：未启动 guided session 时，不产生新的 composer sampler/timer。
7. **Privacy**：报告中不得出现 fixture prompt/answer 文本。
8. **Regression**：现有 `npm test`、`npm run test:e2e`、`npm run test:e2e:stress` 继续通过。

---

## 本轮不要做

- 不实现 ghost-send 自动重发；
- 不实现 stale-answer 自动 regenerate；
- 不用 LLM 判定回答是否答非所问；
- 不做 authenticated ChatGPT 自动化；
- 不扩大 known-interruptions allowlist；
- 不为了诊断重新把 native-safe 变成重 observer 模式；
- 不发布 stable release。

---

## 交付要求

Codex 完成后必须：

1. 更新 source + build/dist；
2. 更新/新增 investigation，说明 stale `0 mounted` 根因与修复；
3. 新增 guided diagnostics 的 privacy/safety 说明；
4. 跑完 `npm test`、`npm run test:e2e`，条件允许再跑 `npm run test:e2e:stress`；
5. 给出新的 `BUILD_LABEL`，不要继续沿用 `native-safe-inert.1`，建议类似 `composer-guided-diagnostics.1`；
6. 不自动发布 GitHub Release，先留给用户 Lenovo 真站手工验收；
7. 最后只告诉用户：需要 reload 哪个 unpacked extension、刷新哪个页面、按 guided check 做哪些动作，以及把哪份报告发回来。
