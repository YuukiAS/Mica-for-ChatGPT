# Low-memory truncation 影响审计

本轮把低内存长对话截断恢复为 0.3.0 的硬性功能门。原先“当前 ChatGPT 已原生窗口化，因此 Mica 不再提供额外优化”的结论作废；`LOW_MEMORY_TRUNCATION` 未通过前，0.3.0、后续 0.4.x 以及整个 Goal 都不能发布或完成。

## 运行链

实现分为两条可关闭、默认失败的路径：

1. `document_start` 的 MAIN-world 响应窗口只处理同源 GET `\/backend-api\/(conversation|shared_conversation)\/<id>`，且只有在响应同时满足完整 `mapping`、有效 `current_node`、无环父链和可识别 root 时才裁剪。它保留当前分支最近 40 个可见 turn 及其间的隐藏依赖节点，不改服务器数据，不处理发送请求，不认识的响应原样返回。
2. 如果响应路径没有命中，但页面实际挂载至少 120 个结构明确、无敏感交互的普通 user/assistant turn，DOM fallback 只保留最近 40 个，并提供 `Load full history`。该动作或关闭功能会设置本 conversation 的 session bypass 并刷新，从服务器恢复完整原生历史。

当前实现不把 `content-visibility` 计作内存截断，也不把小 mounted window 计作 Mica 的优化收益。

## 受影响文件与检查

| 风险 | 运行模块 | fixture / validator | 必须保持 |
|---|---|---|---|
| 初始 conversation 数据裁剪 | `low-memory-page.ts`、manifest MAIN world | mapping graph fixture、短/中/超长响应 | 非匹配 endpoint、未知 shape、POST 原样通过 |
| DOM fallback | `low-memory-windowing.ts` | 160-turn direct DOM fixture | 特殊 turn、dialog、streaming、未知层级 fail-open |
| 设置与恢复 | config bridge、service worker、popup、content | migration、toggle、reload/bypass | 既有 false 设置不被覆盖；完整服务器历史不变 |
| 配置竞态 | MAIN-world cache + isolated bridge | build validator、actual MV3 load/reload | 首次命中等待 fresh event；过期 cache 无事件时 fail-open |
| 内存与渲染 | 低内存压力 fixture | CDP `Memory.getDOMCounters`、`JSHeapUsedSize`、响应字节 | 最近 40 turns、DOM nodes、JS heap 均有实测下降 |
| 输入与核心流程 | content、reliability、highlighter | IME/input、connector、send/stream、scroll | 普通输入同步路径不做 turn 枚举、序列化、布局读取 |
| 相邻审查修复 | highlighter、export、delivery guard | SPA 切换、远程资源、PDF 文本层、重复回答 | 不跨 conversation 存高亮；不误报正常重复回答 |

浏览器插件专用 Browser skill 在本会话未提供；按 Frontend Testing/Debugging 的规定，使用仓库既有 Playwright + 隔离 Edge profile，不接触用户的正常 Edge profile或登录态 ChatGPT。
