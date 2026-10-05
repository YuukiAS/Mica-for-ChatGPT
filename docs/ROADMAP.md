# Mica 路线图

Mica 以“本地、可靠、fail-open”为长期边界。路线不再围绕旧 LightSession 或大范围 Surface Atlas 展开，而以可验证的用户工作纵向收口。

## 0.3.0 — Daily Core

目标：形成可以日常使用的复制与可靠性核心。

- Markdown / LaTeX serializer；
- 只在精确 action cluster 出现的 Copy 控件；
- composer/send 生命周期状态机；
- ghost send、fake waiting、stale response、generation error 的安全恢复提示；
- 紧凑的产品化 popup；
- 长线程能力回归 `Native handling`，不把 ChatGPT 原生 windowing 冒充为 Mica 收益。

本地 fixture 与扩展 E2E 已通过。当前已登录 ChatGPT 的 action cluster 和发送生命周期仍需一次合并证据后才能关闭真实站点 gate。

## 0.4.0 — Research Export

目标：把单条回答可靠地带入后续研究工作。

- conversation/page 范围的本地网页高亮；
- stable quote + prefix/suffix + turn identity 锚点；
- 刷新、remount、同文多处、文本变化和流式阶段的确定性恢复/降级；
- Notion-ready `text/html` + `text/plain` clipboard；
- 本地 KaTeX 渲染的 PDF 预览；
- 标题、段落、列表、引用、表格、代码、链接、公式和高亮的可搜索 PDF。

0.4.0 的本地功能与 artifact 已完成；精确 Notion 网页粘贴语义和已登录 ChatGPT 最终行为保留为一次集中验收项。

## 后续候选方向

后续工作必须由真实使用证据驱动，不在本轮提前扩张：

1. 多条 answer / conversation 级导出；
2. 更精细的引用与附件表示；
3. Chrome / Edge / macOS Chromium 的公开发布 hardening；
4. 页面结构漂移的兼容合同与迁移提示；
5. 只有在可重复测量出额外收益时，才重新讨论性能模块。

## 不做

- 不重做完整聊天客户端；
- 不引入聊天正文上传或服务器端账号；
- 不把 ChatGPT 私有 endpoint 当作稳定核心；
- 不自动越过授权、安全、付费、工具或 connector 确认；
- 不用常驻调试面板污染日常 UI；
- 不用旧 selector、旧截图或旧 Atlas 结论冒充当前界面证据。
