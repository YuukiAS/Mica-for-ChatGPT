# Goal 004 — Overlay + Popup Productization

## Goal

把 Mica 从“工程调试扩展”收敛成可以长期日用的 extension UI。

当前 popup 是 320px 白底表单：大量 checkbox、原生 number input、两块 diagnostics button grid，没有明显的信息层级；composer diagnostics session 另外在页面 `top: 12px; right: 12px` 创建独立 panel，而常驻 Mica status 已经使用 bottom-right static anchor。两套 overlay 体系并存容易造成用户看到的“右上角还有东西/位置不对”。

0.2.0 要统一这两套界面。

## Visual direction

沿用 `docs/BRANDING.md`：

- Mica 是覆盖在原生 ChatGPT 上的轻薄增强层；
- ivory / cool gray / graphite；
- cyan / blue / violet 只作少量 accent；
- clean / calm / lightweight；
- 不做夸张 dashboard；
- 不引入 React/Vue 等重量框架；当前原生 HTML/CSS/TS 足够。

目标是“像一个成熟浏览器扩展”，不是“设置页堆控件”。

## Part A — Page overlay consolidation

### 当前问题

- 常驻 status：bottom-right static；
- composer diagnostics：单独 `position: fixed; top/right` panel；
- diagnostics active 时页面上出现第二套 Mica UI；
- status/toast/diagnostics 的视觉和生命周期不统一。

### 新规则

页面只允许一个 Mica overlay root / anchor system。

默认：

- bottom-right；
- compact 20–26px status indicator；
- 不自动展开；
- 不读取 composer geometry 来“智能避让”；
- 不占右上角；
- pointer events 只在自身控件区域开启。

Diagnostics active：

- 不再创建右上角 300px recording card；
- status indicator 可以出现极小 recording ring/dot 或短 toast；
- 详细 diagnostic state 留在 popup；
- 页面最多显示一个非阻塞 compact signal，例如 `Recording` 2 秒后收敛到小 indicator；
- stop/copy/reset 控制放 popup，不在页面上制造 mini control panel。

如果用户所说“右上角问题”来自真实 ChatGPT 自身或旧残留 build，使用 real-site read-only contract 确认；不得凭猜测继续移动元素。

## Part B — Popup information architecture

建议 popup 宽度约 360–380px，避免当前 320px 太挤；高度自然，Advanced 区域默认折叠。

### Header

- Mica icon；
- `Mica`；
- 小版本号；
- 总开关使用 compact branded switch；
- 不显示大段 tagline。

### Runtime status card

一张紧凑 card：

- status dot；
- `Native windowed / Optimizing / Degraded / Disabled`；
- 一行 reason；
- 极简 secondary metrics，例如 `7 mounted`；
- diagnostics active 时在这里显示 `Recording`。

### Core features

只给用户看高层能力，不暴露内部实现名：

1. **Performance**
   - Long-thread optimization
   - 用户只需要知道“Reduce long-thread rendering overhead”

2. **Copy**
   - Mica Markdown copy
   - secondary text: `Display equations as $$...$$`

3. **Reliability**
   - Safe interruption handling
   - Composer recovery

不要让普通用户理解 `send residual recovery`、`stale clear recovery`、`connector continuity` 这些内部状态机名。

内部 feature toggles 可以放进 `Advanced / Recovery modules`，用于开发/故障隔离。

### Advanced

使用 `<details>` 或等价轻量折叠：

- recent native turns；
- individual recovery modules；
- auto-dismiss known interruptions；
- detailed counters。

### Diagnostics

单独 compact section：

Idle 时：

- `Run one-shot diagnostics`

Running 时：

- state / elapsed / event count；
- `Stop & copy report` 主操作；
- secondary `Reset`。

避免当前四个按钮 + 三个按钮同时铺满页面。

为 Goal 005 的 one-shot acceptance 预留：

- `Prepare final send check`（开发 build / advanced only）

该按钮只能 arm diagnostics / prepare harmless composer text；**不能发送。**

### Footer

- `v0.2.0` / build label；
- optional tiny `Diagnostics` / `About` entry；
- 不用 `0 mounted` 这种孤立 footer 文案。

## Interaction design

### Toggle

使用自定义 accessible switch，但保留真实 `<input type=checkbox>` 语义。

- keyboard accessible；
- focus-visible；
- disabled state；
- high contrast；
- reduced motion。

### Feedback

setting 保存成功无需每次 toast。

只有：

- copied report；
- copy failed；
- diagnostics prepared；
- degraded/error

才给短 feedback。

## Dark mode

必须跟随 `prefers-color-scheme`，不要只优化白底。

浅色与深色都保持：

- 文字对比充分；
- border 不过强；
- accent 不刺眼；
- status colors 不只靠颜色表达。

## Performance constraints

popup 自身不是长时间运行页面，但 page overlay 必须继续极轻。

禁止为了视觉：

- backdrop-filter 大面积实时模糊；
- page-wide animations；
- polling placement；
- composer geometry tracking；
- shadow DOM 每 150ms 全量 innerHTML 重建。

Diagnostics data 更新到 popup 可以低频/事件驱动。

## Tests

### Popup fixture

至少覆盖：

- 360/380px width；
- light/dark；
- Active/native/degraded/disabled；
- diagnostics idle/running/complete；
- Advanced open/closed；
- long reason text；
- version/build overflow；
- keyboard focus。

生成 screenshot evidence 供 Codex 自审，不要求用户逐次看图。

### Overlay fixture

覆盖：

- bottom-right compact；
- expanded status；
- toast；
- diagnostics active indicator；
- narrow viewport；
- ChatGPT bottom composer present；
- no top-right Mica panel；
- no composer overlap；
- pointer hit test。

## Real-site boundary

Computer Use 对真实 Edge：

- 允许只读检查 overlay rect/visibility；
- 不点击 ChatGPT 控件；
- 不发送；
- 不上传。

popup 自身可以在 isolated extension fixture 中全自动测试；不要为了看 popup 去操纵真实 ChatGPT。

## Acceptance

输出：

- `TOP_RIGHT_DIAGNOSTIC_PANEL_REMOVED = YES/NO`
- `SINGLE_OVERLAY_ROOT = YES/NO`
- `DEFAULT_OVERLAY_PLACEMENT = bottom-right`
- `POPUP_WIDTH =`
- `POPUP_INFORMATION_ARCHITECTURE = PASS/FAIL`
- `LIGHT_SCREENSHOT =`
- `DARK_SCREENSHOT =`
- `OVERLAY_MATRIX = PASS/FAIL`
- `ACCESSIBILITY = PASS/FAIL`
- `PAGE_OVERLAY_POLLING_ADDED = NO`
- `TYPING_HOTPATH = PASS/FAIL`
- `READY_FOR_DAILY_USE_UI = YES/NO`

不要把“美化 popup”理解为换几个颜色；本 goal 的核心是减少普通用户看到的工程内部复杂度。