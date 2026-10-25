# Mica 真实扩展测试覆盖矩阵

本文件记录 `0.5.15`（`product-delivery.2`）当前候选的自动化证据边界。它补充现有产品矩阵和验收器，不建立第二套验收框架。所有类别 4 自动化均加载 `dist/mica-dev` 的正式 Manifest V3 构建，使用独立 Playwright Chromium 用户目录，拒绝所有未匹配网络请求；不会接触用户日常 Edge profile、登录 Cookie、令牌或真实聊天数据。

## 六类实施路径

| 类别 | 路径 | 当前用途 | 能否单独给出产品端到端结论 |
| --- | --- | --- | --- |
| 1 | 纯 Node 函数、状态机与存储合同 | 快速验证序列化、锚点、设置迁移、安全门槛、验收器控制语料 | 否，只证明浏览器无关合同 |
| 2 | 真实浏览器 + 模拟扩展接口 | 保留旧 popup/fixture 的轻量状态和布局回归 | 否，不能证明真实扩展消息、存储或后台 |
| 3 | 真实浏览器 + 单独注入生产脚本 | 保留高亮、PDF.js、Low Memory 页面数据面的聚焦回归 | 否，只能作为模块级浏览器证据 |
| 4 | 真实安装扩展 + 实际后台、存储和页面注入 | 当前四项核心功能的日常端到端主路径 | 是，针对离线高保真宿主和本地产物 |
| 5 | 当前真实 ChatGPT 只读结构校准 | 把有限、去敏的实站观察转成 capability contract 和离线重放变体 | 只证明被观察到的结构；不证明登录态生命周期 |
| 6 | 登录态 ChatGPT 或目标物理设备 | 最终发布前的真实账号、系统集成和低内存设备边界 | 是，但只覆盖本地自动化无法证明的剩余边界 |

类别 4 是新增的统一主路径。类别 1–3 继续承担快速定位和聚焦回归，不会被删除，也不能再独自把候选提升为完整产品验收。类别 5 当前绑定 2026-10-12 的公开只读 ChatGPT bootstrap；本轮没有打开或操作登录态 ChatGPT，因而不会把人工构造生命周期称作新的实站证据。

## 四项核心功能

| 功能 | 真实扩展用户路径 | 已覆盖的用户可见结果 | 尚需类别 6 的边界 |
| --- | --- | --- | --- |
| Markdown Copy | 可信右键回答 → 实际 Service Worker 菜单 → 内容脚本重新核对回答 → Serializer → 系统剪贴板读取 | 只复制目标 settled answer；保留标题、列表、表格、代码、中文和公式；不混入按钮文字；过期、重放、remount、歧义和 streaming 均 fail-open | 登录态 ChatGPT 上的原生右键菜单和用户系统剪贴板一次确认 |
| ChatGPT Highlighter | 可信鼠标选区 → 实际内容脚本 → 工具条 → `chrome.storage` → CSS Custom Highlight | 四色、换色、单条删除、按回答清理、跨行内公式、刷新/remount/等价数学重排恢复、重复文本与来源删除 fail-open、conversation/branch 隔离、快捷键与 IME 保护 | 当前登录态 DOM 中的选择、定位和虚拟化一次确认 |
| PDF | 用户导出动作 → 实际消息传递 → Service Worker → `chrome.storage.session` 一次性模型 → 扩展导出页 → Chromium `printToPDF` → PDF.js / pdfplumber | 三页 A4；正文、表格、代码、中文、行内/展示数学；独立文本提取；高亮可见；临时模型消费后清理 | 用户偏好的桌面 PDF 查看器可作为最终一次人工中的附带检查；不是日常补丁的默认要求 |
| Low Memory | 实际设置 → Service Worker 动态注册 MAIN world/document_start 脚本 → React Router stream 窗口化 → popup 加载完整历史/恢复优化 → Worker 重启 | 121 个 mapping nodes 窗口化为 41，完整历史恢复为 121，再恢复为 41；后台重启后注册恢复；禁用后原生完整历史 fail-open；压力测试 A/B/C 使用真实扩展 B/C | 登录态真实长对话和目标低内存设备的最终表现 |

弹窗和设置页也通过实际 `chrome-extension://` 页面验证：设置写入与重载持久化、设置跳转、不支持页面 fail-open、后台重启恢复、320/368/400 px 宽度、亮暗主题、键盘可达控件和无水平溢出。普通网页高亮、Notion 原生公式与真实断流控制仍不是这四项核心自动闭环的一部分；它们的状态继续由产品矩阵单独报告。

## 高保真宿主与证据来源

`tests/fixtures/mica-product-host.html` 是受控的 ChatGPT 风格宿主，不复制完整 ChatGPT 应用。它使用宿主自身状态更新和完整 DOM rerender 产生多回合、streaming、settled、回答编辑、分支与 conversation 切换、操作区/输入框重挂载、工具阶段、虚拟滚动卸载/恢复、亮暗主题及不同宽度。页面没有测试专用 `data-mica-fixture` authority，不能自行取得生产权限。

结构来源分两层：

- 已观察层：2026-10-12 公开只读 ChatGPT bootstrap 和 `contracts/chatgpt/current.json` 所证明的有限结构，只支持相应 capability 的校准声明。
- 人工鲁棒性层：streaming、工具、重复文本、损坏来源、未知结构、整树 remount 和路由切换等变体，用来证明 fail-open 与生命周期安全，不会升级为“当前登录态 ChatGPT 已验证”。

Low Memory 另有 `tests/fixtures/mica-low-memory-host.html`，在实际 document_start/Main world 注入下联动会话图、React Router stream、可见 turns 与完整历史恢复。压力路径固定为隔离 Playwright Chromium、256 MB V8 old-space、800 turns、约 100 MiB retained content，并记录三个 A/B/C 样本；不再依赖本机 Edge 私有路径。

## 历史故障回归

| 历史故障 | 自动识别方式 |
| --- | --- |
| 找到复制按钮但插入错误父容器 | 实站 inline placement 未证明时不注入；右键 fallback 以精确回答归属完成操作 |
| 复制绑定相邻回答 | 剪贴板断言只含目标回答的结构化内容 |
| 操作区 remount 后重复入口 | remount/重新生成后检查唯一入口与旧上下文失效 |
| 多个候选操作目标 | adapter 返回歧义并 fail-open |
| 跨公式选择丢失公式 | Highlighter 可见范围和 PDF/剪贴板内容同时断言数学语义 |
| 刷新后高亮消失或误附着 | refresh、整树 remount、数学重排、重复文本、来源删除均有正反例 |
| Composer remount 恢复旧草稿 | 宿主切换 textarea/contenteditable 并断言旧草稿不恢复 |
| Low Memory 只隐藏 DOM | A/B/C 断言 mapping nodes、retained content 和 heap 实际下降，mounted DOM 保持同一虚拟化基线 |
| 未恢复完整历史却声称完整导出 | 完整性证明、turn 数量和角色顺序不一致时拒绝导出 |
| PDF 有文本但鼠标不能跨公式选取 | 现有 PDF.js 可信 pointer 选择和独立提取继续作为聚焦门禁 |
| Service Worker 重启后状态丢失 | 实际停止 Worker，等待重启，核对设置和 Low Memory 持久注册恢复 |
| 未知 ChatGPT 结构触发错误动作 | unsupported/ambiguous/expired/remounted source 全部断言不执行 |
| 截图失败后自动改基准 | 默认只比较；只有显式 `MICA_CAPTURE_VISUALS=1` 才允许人工批准后生成基准 |

这些场景既包含已发生的 Mica 故障，也包含从真实边界推导出的负向控制。验收器还包含“绕过 Service Worker”“伪造视觉基线”“访问真实 ChatGPT 网络”等 known-bad，必须被拒绝。

## 视觉与产物

Chromium 151 下已人工查看并冻结六张 `0.5.15` 基准：Options 亮色、Highlighter 亮/暗色、Popup 320 亮色、368 暗色、400 亮色。自动比较状态为 `MATCH`，没有裁切、水平溢出、主题对比或固定表面位置问题。PDF 导出页另有实际截图，但不自动提升为基准；实际 PDF 为三页 A4，含当前列表高亮，并由独立解析器复核文本与数学语义。

基准文件为 `tests/mica-extension-visual-baseline.json`。截图哈希、浏览器版本、批准版本及实际 PDF 都由原 acceptance validator 的 `installed-extension-e2e` gate 绑定；失败时不会自动覆盖基准。

## 运行入口与原验收器

- `npm run test:extension`：构建后运行最小安装冒烟、完整真实扩展 E2E、Low Memory 扩展生命周期和构建校验。
- `npm run test:e2e`：在既有浏览器 fixture 后追加真实安装扩展主路径。
- `npm run test:low-memory:pressure`：执行三样本 A/B/C 压力测量。
- `npm run acceptance:preflight`：验证正确/错误控制语料。
- `acceptance:focused` / `acceptance:candidate`：继续消费同一候选 bundle；新增 `installed-extension-e2e` gate，不另建平行平台。

## 人工验收触发规则

今后的普通补丁版本默认不要求用户手动测试。只要改动未触及登录态结构合同、高风险真实交互或目标设备性能边界，并且对应类别 1–4 回归与候选 gate 通过，就继续由自动化闭环。

只有以下情况才考虑消耗新的人工动作：

- ChatGPT 登录态结构发生漂移，现有去敏 contract 无法安全判定回答归属、操作入口、数学来源或 lifecycle；
- 新增自动点击、自动提交、外部写入、权限或其他高风险真实交互；
- 修改 Low Memory 数据入口、窗口化语义或资源预算，需要重新证明目标低内存设备表现；
- 修改系统剪贴板、下载/打印或桌面查看器边界，且隔离 Chromium 无法独立证明；
- 真实验收后又修改了其所覆盖、且无法由独立证据重新证明的生产路径。

本候选仍需要一次集中类别 6 验收，预算固定为 `HUMAN_ONLY_BUDGET=1`。在此之前，四项核心功能的真实安装扩展自动回归已经闭环；尚未取得的是登录态 current-site 与物理目标设备的最终外部证据，因此当前状态是“本地候选已准备，尚非正式发布”。
