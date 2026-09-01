# Mica for ChatGPT

> A lightweight local enhancement layer for ChatGPT.

Mica 是一个面向 ChatGPT 网页端的浏览器扩展。目标不是重做 ChatGPT，而是在原生界面之上补上几个长期影响使用体验的问题：长对话性能、可靠的 Markdown/LaTeX 复制、烦人的重复确认与重试、以及少量真正有价值的界面增强。

当前最高优先级不是“做完整产品”，而是先恢复一个**今天就能长期使用的长对话优化扩展**。最近 ChatGPT 的长对话加载方式发生变化，LightSession 会停留在 `waiting for messages...`，导致旧的裁剪逻辑失效；在较弱设备上，超长 thread 又会明显拖慢页面。

## 当前目标：v0.1 Long-thread Recovery

第一阶段只解决一件事：让当前 ChatGPT 的长 thread 在 Chrome / Edge / macOS Chromium 浏览器上重新保持流畅，同时不破坏 ChatGPT 自己的新分段加载、工具调用、文件授权、分支、编辑消息和正在生成的回答。

实现原则：

- 先复现 LightSession 当前失效的具体原因，再决定最小修复路径。
- 不盲目沿用旧的 `/backend-api/conversation/<id>` 响应裁剪假设。
- 优先利用 ChatGPT 现在已经存在的原生分段加载，只优化浏览器端仍然造成卡顿的 DOM、布局和渲染成本。
- 如果当前接口仍可安全裁剪，可以保留兼容层；如果接口已经变化，则以 DOM/渲染虚拟化为主。
- 所有优化必须 fail-open：识别失败时宁可不优化，也不能破坏对话内容或交互。
- v0.1 先支持手动加载 unpacked extension，不等待商店发布。

详细执行方案见 [`docs/PHASE_1_LONG_THREAD_RECOVERY.md`](docs/PHASE_1_LONG_THREAD_RECOVERY.md)。整体路线见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## v0.1 候选版安装

当前可加载的 unpacked extension 目录是：

```text
D:\Code\Mica-for-ChatGPT\dist\mica-v0.1.0
```

重新构建：

```bash
npm run build
```

Chrome / Edge 手动安装：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择 `D:\Code\Mica-for-ChatGPT\dist\mica-v0.1.0`。
5. 打开或刷新 `https://chatgpt.com/` 的长 conversation。

页面右下角会显示状态：

- `Active`：已识别长 thread，并对离屏历史 turn 应用渲染 containment。
- `Native only`：当前 turn 数量较少，或 ChatGPT 原生页面还没有加载出需要处理的长 thread。
- `Degraded`：疑似 conversation 页面，但 Mica 无法安全识别 turn 结构，已停止优化并保持原生页面。
- `Disabled`：用户在 popup 或页面状态条中关闭了 Mica。

最短诊断路径：

```js
document.documentElement.dataset.micaStatus
document.documentElement.dataset.micaTurns
document.documentElement.dataset.micaOptimizedTurns
```

popup 可切换启用状态、状态条显示，以及保留原生渲染的最近 turn 数量。

## v0.1 当前限制

- 默认不修改 ChatGPT 私有 API response，也不阻止 network request。
- 不删除 React 管理的消息节点；这一版只用 `content-visibility:auto`、containment 和 intrinsic-size 降低离屏历史 turn 的渲染成本。
- 工具卡片、文件/授权类 UI、正在编辑的内容、viewport 附近内容和最近 turn 会保持原生渲染。
- Codex 当前只能访问未登录 ChatGPT 首页，不能在本机完成真实 authenticated long thread 回归；真实验收需要在目标 Chrome / Edge / MacBook Neo 上完成。
- 旧 LightSession 失效调查见 [`docs/investigations/2026-09-01-lightsession-current-chatgpt.md`](docs/investigations/2026-09-01-lightsession-current-chatgpt.md)。

## v0.1 本地验证

```bash
npm run build
npm run test:fixture
```

本地 90-turn fixture 页面级检查结果：Mica 进入 `Active`，90 个模拟 turn 中 73 个离屏历史 turn 被加上 `mica-turn-optimized`，状态条显示 `Mica · Active · 17 active / 90 turns`。

## 后续方向

在长对话性能稳定后，再逐步加入：

1. **Copy & Export**：复制为稳定、可预测的 Markdown，正确处理代码块、表格、列表、LaTeX、引用与附件信息。
2. **Reliability**：识别可安全恢复的限流/失败状态，减少无意义的手动确认与重复点击，但绝不绕过真正需要用户授权的安全确认。
3. **Interface**：只做能明显降低摩擦的 ChatGPT UI 调整，不做大规模皮肤化。
4. **Diagnostics**：显示当前 thread 的优化状态、已虚拟化消息数量、性能降级原因，并提供一键关闭模块的能力。

## 项目边界

Mica 默认本地运行，不上传聊天内容，不要求外部后端。任何需要读取页面内容的功能都应尽量限制在 `chatgpt.com` 必要范围内，并保持权限最小化。
