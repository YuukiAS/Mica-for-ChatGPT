# Extension Icon Assets

Mica 的正式 extension icon 使用独立透明母版 `assets/branding/mica-icon-master-v1.png`，不再从 16:9 品牌概念图裁切。

当前 symbol 是克制的青色 faceted mica crystal：在 16px 仍保留强轮廓，不包含文字、对话气泡、ChatGPT/OpenAI 标记、发光或圆角方形背景。

## v0.x working icon

为了尽快获得一个可安装、可识别的浏览器扩展图标，可以从现有品牌概念图中裁出中央 symbol，制作干净的正方形 master，再生成以下文件：

- `extension/icons/icon16.png`
- `extension/icons/icon32.png`
- `extension/icons/icon48.png`
- `extension/icons/icon128.png`
- `extension/icons/icon512.png`

要求：

- 只保留中央 Mica symbol，不包含 `Mica for ChatGPT` 文字、功能卡片或背景 ChatGPT UI。
- 正方形构图，symbol 居中，四周保留足够 safe area。
- 使用高质量缩放生成不同尺寸。
- 16×16 和 32×32 必须实际检查辨识度；若细节糊成一团，应适当简化，而不是机械缩小。
- 当前概念图裁切版只视为 v0.x working icon；Chrome Web Store 正式上架前仍应制作独立、透明背景的 master asset。

当前图标源与派生文件：

- `assets/branding/mica-icon-master-v1.png`
- `extension/icons/icon16.png`
- `extension/icons/icon32.png`
- `extension/icons/icon48.png`
- `extension/icons/icon128.png`
- `extension/icons/icon512.png`

生成脚本：

```bash
npm run icons
```

发布候选需实际检查 `icon16.png` 和 `icon32.png` 的轮廓与透明背景；生成脚本只做高质量缩放和小尺寸锐化，不再从旧概念图提取内容。

## Manifest 与构建

`manifest.json` 应同时声明顶层 `icons` 和 `action.default_icon`，并保留现有 `default_popup` / `default_title`。构建脚本必须把整个 `icons/` 目录复制到 `dist` 和 release ZIP。

发布前应分别在 Edge / Chrome 的扩展管理页、工具栏和 popup 中检查小尺寸图标是否清楚。
