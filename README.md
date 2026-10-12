# Mica for ChatGPT

Mica 是一个本地运行的 Chromium 浏览器扩展，面向需要长期使用 ChatGPT 长对话、整理回答和控制客户端资源占用的人。项目已经通过 Foundation 内部关口，当前先冻结真正降低客户端内存占用的 Low Memory，再继续回答高亮和带可选数学文本的 PDF。

当前开发候选是 `0.3.0`（`low-memory-windowing.1`）。它会在 ChatGPT 解码、渲染超长 conversation 之前，把客户端历史限制为最近 40 个可见 turns，并保留必要的 system/tool 依赖与近期 branch。服务器历史不会修改；`Load full history`、关闭 Low Memory 或移除扩展后，刷新页面即可回到 ChatGPT 原生完整历史。未知数据结构保持原样并 fail-open。

这仍是候选，不是已经发布的 `0.3.0`。本地隔离 Chromium 的可行性、压力和回归证据已经通过，独立 reviewer、最终真实登录态验收和发布收口尚未完成。

## 安装开发版

固定的 unpacked extension 路径是：

```text
D:\Code\Mica-for-ChatGPT\dist\mica-dev
```

重新构建：

```bash
npm run build
```

在 Chrome 或 Edge 中安装：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked，选择 `D:\Code\Mica-for-ChatGPT\dist\mica-dev`。
4. 后续更新只需重新构建，在扩展管理页点击 Reload，再刷新 ChatGPT 页面。

## 当前开发版包含什么

弹窗只显示用户需要判断的信息：当前页面是否受支持、Low Memory 是否可用、页面健康状态，以及 Troubleshooting 入口。开发诊断已经移到单独的 Developer QA 页面，不再把 selector、mounted counter、开始/停止诊断按钮或旧 Surface Atlas 状态塞进普通界面。

当前 runtime 包括：

- 一个按 capability 判断 `EXACT`、`COMPATIBLE` 或 `UNKNOWN` 的 `ChatGPTAdapter`；结构不明时停用相关集成，让 ChatGPT 保持原生行为。
- 一个由 adapter 唯一生成的 `AnswerDocument`，保留 ordered blocks、streaming/settled 状态、版本身份、源码区间，以及文本、列表、表格、代码、链接、引用、图片和行内/展示数学。
- 独立的 Troubleshooting 与 Developer QA 页面。导出的诊断只包含结构状态、版本和 contract 身份，不包含对话正文、附件内容、请求 body、认证 token 或原始 DOM。
- 真正的数据层 Low Memory：同时覆盖当前 React Router turbo-stream hydration 与受严格形状保护的 conversation JSON fallback。实现会压缩不可达的历史数据，而不是删除 React 管理的 DOM 或只设置 `content-visibility`。
- 固定开发路径 `dist/mica-dev`，manifest、弹窗和诊断报告均显示 `0.3.0`。

旧的自动提示关闭、composer recovery、connector continuity、send residual recovery、页面状态点和 containment runtime 已从当前 build 入口移除。历史源码和失败 fixture 暂时保留，供迁移真实回归用；它们不再与新 Foundation 同时运行。

## Low Memory 的候选证据

低内存长对话截断仍是 `0.3.0` 的硬性发布条件，不会降级成 `Native handling`、no-op 或 diagnostics only。当前实现已经在客户端限制长 thread 的实际数据保留与渲染输入，同时不修改或删除服务器历史。

候选版需要在同一 workload 下比较：

```text
A = Mica absent/disabled
B = Mica installed, Low Memory disabled
C = Mica installed, Low Memory enabled
```

验收会覆盖 short、medium、long thread，最近消息保留窗口，mounted DOM、JS heap 或 browser process memory、mutation、scroll/typing latency、上滑恢复、完整历史加载、reload、关闭或禁用 Mica 后恢复，以及 composer、send、streaming、edit、branch、connector、tool/file/auth 和 typing/IME hot path。C 必须在目标低内存环境中对 A/B 产生可重复的额外收益，才允许写入：

```text
LOW_MEMORY_TRUNCATION=PASS
```

当前 256 MB V8 old-space 压力 workload 使用 800 turns、约 100 MiB UTF-16 retained content，重复 3 次。中位数结果为：A/B 保留 801 个 mapping nodes 和约 100 MiB 内容，C 保留 41 个 nodes（40 个最近 turns）和约 5 MiB 内容；JS heap 从较低的 A/B 基线 101.231 MiB 降到 6.442 MiB，fresh Chromium 进程树 private memory 从较低的 A/B 基线 281.711 MiB 降到 248.793 MiB。mounted DOM 在三组中都保持 12，说明收益来自额外的数据截断，而不是把 ChatGPT 已有 virtualization 当成功劳。

这些数字满足当前本地 feasibility threshold，但只有候选 validator 与同一独立 reviewer 复审通过后，才能正式写入 `LOW_MEMORY_TRUNCATION=PASS`。在此之前不得发布。

## 本地验证

常用命令：

```bash
npm run build
npm run test:foundation-core
npm run test:foundation-flows
npm run test:low-memory
npm run test:low-memory-page
npm run test:low-memory:pressure
npm run test:popup-render
npm run test:build
npm run acceptance:preflight
```

`test:foundation-core` 使用隔离 Chromium 验证 adapter、AnswerDocument、fail-open、编辑/branch/remount identity、诊断隐私和 typing hot path。`test:low-memory` 验证 ordinary JSON 与 turbo-stream 图窗口化；`test:low-memory-page` 验证早期拦截、fallback、禁用、reload bypass 和上滑恢复入口；`test:low-memory:pressure` 执行重复 A/B/C 资源测量。`test:popup-render` 验证 actual built popup 的 7 种状态、320/340/368/400 px、100/125/150% scale、light/dark、键盘顺序，以及 Troubleshooting / Developer QA 分离。

验收器的入口和证据模型见 [`acceptance/README.md`](acceptance/README.md)。它会同时运行 known-good 与 known-bad controls，并拒绝 Low Memory no-op、缺失或篡改证据、旧候选报告、错误页面、重复截图、能力合同缺项、不可选择数学 PDF，以及漏掉 0.3.0 Low Memory gate 的候选结果。

自动化测试使用仓库 fixture 与隔离 Playwright Chromium，不连接用户日常 Edge profile，也不自动操作登录态 ChatGPT。当前页面协议依据来自隔离浏览器中的公开只读 shared conversation；最终登录态 current-site 验收仍按冻结 Goal 的 HUMAN_ONLY 边界执行。

## 产品与实现依据

- 当前产品系统：[`docs/product/MICA_PRODUCT_SYSTEM_V1.md`](docs/product/MICA_PRODUCT_SYSTEM_V1.md)
- Foundation UI freeze：[`docs/product/MICA_FOUNDATION_UI_FREEZE.md`](docs/product/MICA_FOUNDATION_UI_FREEZE.md)
- 当前 ChatGPT surface evidence：[`docs/investigations/2026-10-12-current-chatgpt-surface-bootstrap.md`](docs/investigations/2026-10-12-current-chatgpt-surface-bootstrap.md)
- 长对话恢复背景：[`docs/PHASE_1_LONG_THREAD_RECOVERY.md`](docs/PHASE_1_LONG_THREAD_RECOVERY.md)
- 版本规则：[`docs/VERSIONING.md`](docs/VERSIONING.md)

## Release 与安装包

`dist/mica-dev/` 是固定的开发版加载路径。版本化 ZIP、SHA-256 和 release snapshot 只在完整候选冻结后生成；当前 Low Memory 候选不会冒充正式发布。详细规则见 [`docs/RELEASE_PACKAGING.md`](docs/RELEASE_PACKAGING.md)。

## Branding

品牌说明见 [`docs/BRANDING.md`](docs/BRANDING.md)，图标规范见 [`docs/ICON_ASSETS.md`](docs/ICON_ASSETS.md)。现有图标只是安装资产，不代表 Foundation popup 的视觉方向。

## 项目边界

Mica 默认本地运行，不需要外部后端，也不上传聊天内容。任何读取页面内容的功能都必须限制在 `chatgpt.com` / `chat.openai.com` 的必要范围内；未知结构 fail-open，授权、安全、支付、工具和文件确认界面不由 Mica 自动点击或绕过。
