# Notion-ready 输出合同（2026-10-05）

## 结论

Mica 0.4.1 已证明自己能把单条 assistant answer 写成结构化 `text/html` 与确定性的 `text/plain` fallback，并保留标题、列表、引用、表格、代码、链接和 LaTeX 源码；同时移除可能触发远程加载的元素与属性。当前证据不能证明 Notion 网页端会把任意 clipboard HTML 稳定转换成完全相同的 block 树，因此精确 Notion paste 保持 `UNVERIFIED`，不包装成通过。

```text
MICA_NOTION_SERIALIZER=PASS
CLIPBOARD_MIME_PAIR=PASS
LOCAL_NOTION_LIKE_IMPORT=PASS
EXACT_NOTION_WEB_PASTE=UNVERIFIED_HUMAN_ONLY
DETERMINISTIC_TEXT_FALLBACK=PASS
```

## 官方合同

- [Notion 数学公式帮助](https://www.notion.com/en-us/help/math-equations)说明 Notion 使用 KaTeX，并公开了 inline equation 的 `$$…$$` 文本输入方式。
- [KaTeX Browser 文档](https://katex.org/docs/browser)与 [API 文档](https://katex.org/docs/api)说明了本地浏览器渲染和 `htmlAndMathml` 输出。
- 这些公开文档没有承诺任意第三方 `text/html` clipboard 一定映射成某种固定的 Notion block 结构。

因此，Mica 的“Notion-ready”承诺限于可验证的输入合同，不声称控制 Notion 未公开的 paste importer。

## Mica 输出

点击 `Copy for Notion` 时，Mica 同时写入：

- `text/html`：保留语义 HTML；公式节点携带 `data-equation-expression`，不从渲染后的 Unicode 反推 LaTeX；
- `text/plain`：保留可读结构，并将公式输出为 Notion 可重新识别的 `$$…$$` 源码。

如果目标应用忽略 HTML，它仍可读取纯文本；如果公式导入失败，用户看到的是原始 LaTeX，而不是静默丢失或错误图片。

## 本地证据

实际 MV3 扩展 E2E 已读取系统 clipboard 并确认：

- MIME 同时包含 `text/plain` 与 `text/html`；
- plain output 含 inline/display LaTeX source；
- HTML 重新导入脱敏 Notion-like fixture 后包含 heading、table、code block 和 2 个 equation marker；
- 未发生网络请求或第三方内容上传。

证据入口：

- `scripts/test-extension-e2e.mjs`
- `extension/src/export/research-export.ts`
- `results/mica--product-recovery-current-gpt-ui/test-matrix.md`

## 剩余一次真实验证

若最终已登录环境可用，唯一一次 HUMAN_ONLY 合并验收会在一个空白或非敏感 Notion 页面粘贴同一候选输出，并只报告结构是否保留。若无法安全取得这条证据，最终状态必须写成 `UNSUPPORTED_WITH_EVIDENCE` 或 `UNVERIFIED`，而不是把本地 importer 结果冒充 Notion PASS。
