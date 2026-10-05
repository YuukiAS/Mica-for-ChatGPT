# Mica UI System

## 方向

Mica 采用“克制的原生邻接工具”方向：popup 是安静、紧凑、可扫读的扩展控制面；页面注入只在能确认原生结构时出现，并服从当前 ChatGPT 的按钮密度与状态语法。识别点来自 Mica 图标和少量青蓝强调色，不使用紫色渐变开关、发光玻璃卡片或 AI dashboard 装饰。

旧品牌图可以作为历史识别资产，但其中的大面积紫蓝渐变、玻璃卡片、虚构性能百分比和宽文字 `Copy as Markdown` 不作为产品 UI 设计权威。

## 容器与信息层级

- Popup 宽度：在 320–400px 内流动，默认设计基准 360px。
- 背景：单一 page surface；内容以开放列表和细分隔线组织，避免每行一张大卡。
- Header：品牌图标、`Mica`、当前页面状态、总开关。
- Capability list：3 个 section，使用同一 row family；标题、1 行状态/说明、至多 1 个 action。
- Advanced：原生 disclosure，默认折叠；只放低频用户设置，不放开发工具。
- Developer/options：独立页面，诊断必须显式开启。

## 视觉 token

### Primitive

```css
--mica-space-1: 4px;
--mica-space-2: 8px;
--mica-space-3: 12px;
--mica-space-4: 16px;
--mica-space-5: 20px;
--mica-radius-control: 8px;
--mica-radius-panel: 12px;
--mica-duration-fast: 120ms;
--mica-duration-normal: 180ms;
--mica-ease-standard: cubic-bezier(.2, 0, 0, 1);
```

### Semantic light

```css
--mica-bg: #f7f7f5;
--mica-surface: #ffffff;
--mica-surface-muted: #f0f1ef;
--mica-text: #171918;
--mica-text-muted: #626763;
--mica-border: #dfe2df;
--mica-accent: #168b91;
--mica-accent-soft: #dff3f2;
--mica-success: #247a46;
--mica-warning: #9a5a13;
--mica-danger: #b33a3a;
--mica-focus: #147c86;
```

### Semantic dark

```css
--mica-bg: #181a19;
--mica-surface: #222524;
--mica-surface-muted: #2b2f2d;
--mica-text: #f3f5f3;
--mica-text-muted: #aeb5b0;
--mica-border: #3a3f3c;
--mica-accent: #55c2c7;
--mica-accent-soft: #183f41;
--mica-success: #70c88d;
--mica-warning: #e5aa5b;
--mica-danger: #f18a8a;
--mica-focus: #7ad8dc;
```

强调色保持单色语义，不用渐变表示 checked。状态颜色必须同时有文字或 icon 语义，不能只靠颜色。

## Typography

- UI family：`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`。
- Product title：15px / 20px，650。
- Capability title：13px / 18px，650。
- Body/status：12px / 17px，400–500。
- Meta/version：11px / 15px，450。
- Control text：12px / 16px，600；不依赖浏览器默认字号。

## 组件

### Toggle

- 40 × 22px；thumb 18px；checked 使用 `--mica-accent`；
- focus-visible 2px outline；disabled 降低对比但保留状态可读性；
- 支持 `prefers-reduced-motion`，不使用弹性或装饰性动效。

### Capability row

- 最小高度 56px，padding 12px 0；
- 左侧标题与状态，右侧 switch 或一个 secondary action；
- 相邻 row 只用 1px divider，不套独立阴影卡片。

### Button / icon button

- 普通按钮最小 32px 高；页面 action cluster 的 hit target 服从当前 native control；
- icon 使用同一 1.75–2px stroke family，`currentColor`，20px optical box；
- 页面 Copy icon 不复制 ChatGPT 专有资产，使用可溯源的 document/copy metaphor；
- tooltip 说明结果，例如 `Copy as Markdown`，不使用 `Mica Copy` 这类重复品牌文字。

### Feedback

- 成功：短时、不抢焦点的 status；
- 失败：一句发生了什么和一个下一步；
- Reliability：上下文内单一 action，不建立第二套全局状态面板。

## 页面注入规则

- Action cluster：只有精确确认 native Copy 的父子/兄弟关系、按钮尺寸和顺序后才注入。
- Composer：不在 ordinary input stack 做 DOM 发现、style/layout、clone、hash 或 storage。
- Highlighter：选择后出现轻量 affordance，Escape/selection collapse/outside action 均关闭；不遮挡 native selection menu。
- Unknown DOM：不渲染。

## 响应式与可访问性

- Popup 在 320、360、400px 宽度与 100%、125%、150% 缩放下不得横向溢出。
- light/dark 都必须用实际浏览器渲染检查。
- 所有 icon button 有 accessible name；focus ring 可见；tab order 与视觉顺序一致。
- 文字和控件满足 WCAG AA 对比；最小点击区域 32px，页面注入服从当前原生 hit target。
- 动效仅用于状态过渡，reduced motion 下关闭位移与缩放。

## Producer taste questions

1. 第一眼能否看出 Mica 当前是否可用，而不是先看到诊断和版本细节？
2. 3 个能力是否形成清楚层级，而不是 3 张重复大卡？
3. 页面注入是否像同一 action cluster 的自然成员，而不是外挂按钮？
4. light/dark、320–400px 和缩放后，文案是否仍简短、对齐、无裁切？
5. 是否存在假指标、装饰状态、紫色渐变、随机圆角或多余常驻控件？

## S3 concept review

2026-10-05 的 ImageGen 概念验证了开放列表、单一青色强调、低装饰层级和三项能力结构。它只用于方向评估，不是实现像素稿，也不是当前 ChatGPT 证据。Producer review 明确修正以下生成偏差：

- 概念中的 popup 视觉高度与字号偏大；实现必须在真实 360px surface 上使用本文件的 11–15px type scale 和 32px 控件。
- 概念背景中的浏览器 UI、ChatGPT sidebar 和 composer 不属于 Mica 资产。
- 概念只覆盖 light theme；dark、320/400px 与 125%/150% 缩放必须由实际扩展渲染证明。
- 概念中的省略号动作只有在确有可达菜单时才可实现，不能作为装饰。

```text
CONCEPT_DIRECTION=ACCEPT_WITH_SCALE_CORRECTION
CONCEPT_IS_RUNTIME_EVIDENCE=NO
```

```text
FRONTEND_SCALE=S3
VISUAL_DIRECTION=QUIET_NATIVE_ADJACENT_UTILITY
POPUP_DESIGN_AUTHORITY=MICA_PRODUCT_CONTRACT_AND_UI_SYSTEM
INJECTED_UI_DESIGN_AUTHORITY=CURRENT_CHATGPT_UI_CONTRACT
INJECTED_UI_GATE=CLOSED_UNTIL_EXACT
```
