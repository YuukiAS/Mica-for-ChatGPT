# Phase 1 — Long-thread Recovery

## 结论先行

第一阶段不要直接把 LightSession 整套搬过来。先把它当前为什么失效查清楚，然后尽快交付一个**不依赖 ChatGPT 私有 conversation 响应结构、可以立刻手动安装的 v0.1**。默认方案应优先从浏览器渲染层减负；只有在确认当前 ChatGPT 的新加载接口存在稳定、安全的裁剪点后，才增加网络层兼容模块。

这一阶段的唯一成功标准是：真实超长 thread 在当前 ChatGPT 上重新流畅，并且发送消息、流式回答、向上查看历史、编辑/branch、工具调用和授权流程不被破坏。

---

## 1. 当前问题

用户侧现象：LightSession 状态条长期停留在 `waiting for messages...`，没有进入正常的 trimming 状态；关闭它以后，超长 ChatGPT thread 在较弱设备上重新出现明显卡顿。

LightSession 当前源码的核心不是普通 DOM 优化，而是在 page context 中 patch `window.fetch`，拦截 conversation 响应，并在 React 渲染前修改 conversation tree。其 `page-script.ts` 目前只把以下 GET 路径认作可裁剪的完整会话：

- `/backend-api/conversation/<id>`
- `/backend-api/shared_conversation/<id>`

随后它要求 JSON 同时仍具有完整的 `mapping` 和 `current_node`，再执行 `trimMapping(...)`。

上游参考：

- https://github.com/11me/light-session
- https://github.com/11me/light-session/blob/master/extension/src/page/page-script.ts

因此当前最重要的工作假设是：**ChatGPT 最近的长会话分段加载改变了请求路径、响应形状或加载时序，使旧代理不再看到它认识的“完整 conversation mapping”。** 这只是待验证假设，不能在没有抓取当前页面实际行为前直接写死修复。

---

## 2. Phase 1 分成两条线，但按顺序执行

### 2.1 先做故障复现与接口勘察

必须在当前 `chatgpt.com` 上用真实长 thread 做一次最小复现，回答四个问题：

1. LightSession 的 page script 是否仍成功注入并 patch `window.fetch`？
2. 打开长 thread 时，当前页面实际请求哪些 conversation / message / pagination 相关 endpoint？
3. 返回的数据是否还包含 `mapping`、`current_node`，还是已经按消息区段返回？
4. `waiting for messages...` 是因为完全没有命中请求、JSON 形状校验失败，还是 status event/内容脚本链路断掉？

复现结果必须写入一个短的 investigation note；不要只在终端日志里留下结论。

### 2.2 同时尽快做不依赖私有接口的 emergency build

无论网络层调查结果如何，都先实现一个可独立工作的渲染优化路径。目标是今天可以通过 `Load unpacked` 使用，而不是等待完整架构。

优先级：

**Level A：低风险渲染减负**

- 找到稳定的 conversation turn 容器，不依赖脆弱的深层 class name。
- 对离屏历史 turn 使用 `content-visibility: auto`、必要的 containment 和浏览器原生跳过布局/绘制能力。
- 尽量利用 `contain-intrinsic-size: auto ...` 保存已经测量过的历史高度，减少滚动跳动。
- 最近若干 turn、正在生成的 turn、用户当前 viewport 附近的 turn 始终保持完整渲染。

这条路径不删除 React 节点、不改 conversation API、不伪造消息数据，因此应该成为 v0.1 的默认安全基线。

**Level B：只有 Level A 明显不够时才做 DOM 虚拟化**

- 对远离 viewport 的旧 turn 记录实际高度后，用等高 placeholder 降低活跃 DOM/布局负担。
- 接近 viewport 前恢复真实内容。
- 必须证明不会破坏 React 后续 reconciliation；如果无法证明，宁可停留在 Level A，也不要用“看起来快但随机坏”的实现。
- 特殊 turn 默认不虚拟化：工具调用、文件/Drive 授权、交互表单、正在生成内容、错误恢复 UI、用户正在编辑或刚 branch 的位置。

**Level C：网络层兼容模块，仅在确认安全后加入**

如果调查发现当前 ChatGPT 仍有稳定的分段 message API，可以考虑只阻止不必要的历史预加载，或者适配新结构。但必须放在独立 feature flag 后，默认不能因为 endpoint 改版而破坏页面。

---

## 3. v0.1 最小架构

建议第一版保持非常小：

```text
extension/
  manifest.json
  src/
    content.ts            # 页面识别、生命周期、模块装配
    long-thread/
      detector.ts         # 找到 turn / viewport / active response
      renderer.ts         # content-visibility / containment
      virtualizer.ts      # 可选，Level B
      status.ts           # active/degraded/disabled 指示
    shared/
      settings.ts
      logger.ts
  popup/
    index.html
    popup.ts
```

不要一开始引入复杂框架。Manifest V3 + TypeScript 即可；构建链只要能稳定输出 unpacked extension。

---

## 4. 必须测量，而不是只凭“感觉变快”

至少记录以下基线与开启 Mica 后的变化：

- 当前 thread 的 turn 数量。
- DOM element 数量的大致变化。
- 打开 thread 到可以正常输入的时间。
- 快速滚动长 thread 时是否出现明显掉帧/输入延迟。
- Chrome Performance 中长任务是否明显减少。
- 如果方便，记录 JS heap / renderer memory 的变化；但 v0.1 不要求为了省内存而冒险删 React DOM。

最重要的真实验收设备是出现卡顿的 macOS 设备；桌面高性能机器只能作为开发环境，不能代替最终验收。

---

## 5. 功能回归清单

任何性能优化都必须逐项通过：

- 打开已有超长 thread。
- 滚到底部并发送新消息。
- 回答可以正常 stream 完成。
- 停止生成、重新生成等基本动作不异常。
- 向上连续滚动并查看旧回答，不丢内容，不出现持续空白。
- 点击旧消息附近的复制、引用等常见交互仍有效。
- 编辑一条旧用户消息并 branch 后页面仍一致。
- 工具调用卡片正常显示。
- 文件、Google Drive 或其他需要用户明确授权的确认 UI 不被隐藏、不被自动操作。
- 刷新、切换 conversation、浏览器前进/后退后模块可以重新识别。
- Mica 关闭时页面恢复原生行为。

如果某种页面结构无法安全识别，Mica 必须进入 `degraded` 或 `disabled`，而不是继续猜。

---

## 6. 状态设计

第一版只需要四种状态：

- `Active`：已识别 thread，正在优化历史 turn。
- `Native only`：ChatGPT 自己已经只保留很少内容，Mica 当前无需额外处理。
- `Degraded`：发现 thread，但选择器/结构不满足安全条件，仅停止优化。
- `Disabled`：用户关闭。

状态中最好同时给出简短计数，例如：

```text
Mica · Active · 18 active / 76 turns
```

禁止出现类似旧 LightSession 那种无限期 `waiting for messages...` 却不给原因的状态。初始化超过合理时间后必须明确进入 `Native only` 或 `Degraded`。

---

## 7. v0.1 验收标准

可以打 `v0.1.0` 的条件：

1. 当前 ChatGPT 长 thread 上可以稳定启用，不依赖旧 LightSession 的完整 `mapping` 假设。
2. 出现卡顿的真实 macOS 设备上，长 thread 的滚动和继续对话有明显改善。
3. 连续使用多个不同长 thread，不需要刷新扩展才能重新工作。
4. 上述功能回归全部通过。
5. 结构识别失败时 fail-open，不破坏原页面。
6. 仓库提供清楚的 Chromium 手动安装步骤和一条最短诊断路径。

性能目标暂时不写死为某个百分比，因为不同 thread 的代码块、表格、公式、图片与工具卡片差异很大；第一阶段先要求可复现的前后对比和真实设备体感都明显改善。

---

## 8. v0.1 之后再处理什么

长 thread 稳定后才进入 Markdown Copy、可靠重试和 UI 增强。不要在 P0 阶段顺手实现这些功能，否则会拖慢“立刻替代 LightSession”这个核心目标。
