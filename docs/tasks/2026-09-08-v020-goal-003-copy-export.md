# Goal 003 — Stable Copy & Export v1

## Goal

实现 Mica 最初承诺的第二个核心能力：复制 ChatGPT 单条回答时，得到稳定、干净、可预测的 Markdown，而不是依赖 ChatGPT 当前 clipboard formatter 的偶然输出。

用户明确要求：**display LaTeX 默认恢复为双美元 delimiters：`$$ ... $$`，不要 ChatGPT 当前常见的 `\[ ... \]`。**

本 goal 先完成单条 assistant answer Copy；整段 conversation export 可以留接口，但不为了扩 scope 拖延 0.2.0。

## Product behavior

默认 profile：`Mica Markdown`

目标输出：

- headings -> `# / ## / ###`
- unordered / ordered lists -> 标准 Markdown
- nested list indentation 稳定
- blockquote -> `>`
- fenced code block -> 保留语言 hint；正文不转义
- inline code -> backticks，并正确处理内容中已有 backtick
- links -> `[label](url)`，过滤 UI-only action links
- tables -> 可读的 GFM table
- emphasis -> `*` / `**`
- horizontal rule -> `---`
- paragraphs -> 合理空行，不把每个 span 拆行
- citations/footnote UI -> 只保留回答正文需要的可读引用文本，不复制 hover/button/accessibility 垃圾
- math -> 按下述规则标准化

## LaTeX normalization

### Display math — required default

输入无论来自：

- `\[ ... \]`
- KaTeX/MathJax render DOM
- ChatGPT 当前 math wrapper
- 已经是 `$$ ... $$`

默认输出统一为：

```text
$$
<latex>
$$
```

简单单行公式也允许：

```text
$$...$$
```

但 serializer 必须 deterministic；同一 DOM 每次复制结果一致。

不得把 display math 输出成 `\[ ... \]` 作为 Mica 默认值。

### Inline math

默认输出标准 Markdown/LaTeX inline delimiter：

`$...$`

如果 ChatGPT DOM 能恢复原始 TeX，不从渲染后的可见 Unicode 重新猜公式。

为未来 profile 留接口，但 0.2.0 不需要复杂设置矩阵。

### Escaping

- 不重复 escape 已合法 TeX；
- 不把 `\` 变成错误双重转义；
- 不改变 `\begin{aligned}` / matrix / cases；
- display/inline 不错误互换；
- code block 内的 `$`、`\[` 不做 math normalization。

## Architecture

不要直接把整个 copy serializer 塞进 `content.ts`。

建议模块：

```text
extension/src/copy/
  detector.ts
  serializer.ts
  math.ts
  table.ts
  clipboard.ts
```

或同等清晰结构。

核心 serializer 尽量是纯函数/DOM-fragment -> Markdown，便于 fixture 测试。

## Integration with ChatGPT native Copy

先用 real-site read-only evidence 确认当前 assistant action bar / native Copy DOM 与事件路径。

实现优先级：

1. 如果能够稳定识别“当前 assistant answer 的 Copy action”，在不破坏其他 action 的前提下复用该入口；
2. 如果拦截 native Copy 会依赖脆弱 selector 或与 ChatGPT 自身 event handler 竞争，则添加一个低干扰的 Mica Copy action，放在相同 action area/附近；
3. 不通过全局 monkey-patch `navigator.clipboard`；
4. 不读取用户 clipboard 历史；
5. 只在用户明确点击 Copy 时写 clipboard；
6. 识别失败时 fail native，不阻断 ChatGPT 原 Copy。

必须在 investigation note 中记录选择 1 或 2 的原因。

## Source extraction

优先从 assistant turn 的语义 DOM 恢复：

- prose container；
- headings；
- pre/code；
- table；
- math source annotation / KaTeX MathML annotation / stable data attribute；
- links；
- list structure。

不要：

- 复制按钮本身；
- “复制代码”等 UI 文案；
- reaction controls；
- screen-reader duplicate math；
- hidden duplicated rendering layer；
- tool controls / unrelated metadata。

如果数学 DOM 同时含视觉 HTML + MathML/annotation，必须去重，只输出一个 TeX source。

## Fixtures

至少新增以下 golden fixtures：

1. prose + headings；
2. nested list；
3. blockquote；
4. fenced Python/R/JS code；
5. inline code containing backticks；
6. Markdown table；
7. inline math；
8. display math from `\[...\]` -> `$$...$$`；
9. aligned/multiline equation；
10. cases/matrix；
11. mixed prose + code + math；
12. citation links / footnote-like UI；
13. duplicate visual + MathML math DOM；
14. unknown node fail-readable；
15. answer containing literal dollar signs outside math。

Golden output 应直接按字符串比较。

## Performance

Copy serializer 只在用户点击复制时运行，不得加入常驻 MutationObserver / polling。

它不能触碰 composer typing path。

对于非常长单条回答，允许 bounded DOM traversal，但必须限制在目标 assistant turn，不扫整个 conversation。

## Popup

Goal 004 会重做 popup；本 goal 只暴露最小设置模型：

- `Mica Copy` enabled
- display math = `$$`（0.2.0 默认）

如果 UI 尚未重做，可以先在 setting model/fixture 中实现，不必把临时丑控件塞进旧 popup。

## Real-site verification

在真实 Edge 中自动化只允许：

- 只读识别 assistant answer 与 Copy action；
- 读取 DOM 结构；
- 不点击 ChatGPT Copy；
- 不发送；
- 不上传。

实际 clipboard action 可以在 synthetic fixture 全自动验证；真实站点最后由用户对已有回答点一次 Copy 即可，不需要新发送消息。

尽量把这一动作合并进 Goal 006/one-shot final acceptance：用户手动发送唯一一次测试消息 -> 等回答 -> 点一次 Copy -> 检查 Markdown。

## Acceptance

输出：

- `COPY_ENTRY_STRATEGY = NATIVE_ACTION_INTEGRATION/MICA_ACTION`
- `DISPLAY_MATH_DEFAULT = $$`
- `INLINE_MATH_DEFAULT = $...$`
- `GOLDEN_FIXTURES = PASS/FAIL`
- `CODE_BLOCKS = PASS/FAIL`
- `TABLES = PASS/FAIL`
- `MATH_DUPLICATION = PASS/FAIL`
- `COPY_RUNTIME_POLLING = 0`
- `TYPING_HOTPATH = PASS/FAIL`
- `REAL_SITE_STRUCTURE_GROUNDED = YES/NO`
- `READY_FOR_ONE_FINAL_COPY_ACCEPTANCE = YES/NO`

0.2.0 不得发布一个“号称 Copy & Export 但公式仍复制成 `\[...\]`”的版本。