# Branding

## 基本信息

- 正式名称：Mica for ChatGPT
- 当前 tagline：`A lighter, cleaner, less frustrating ChatGPT.`

## 视觉概念

Mica 是覆盖在原生 ChatGPT 之上的增强层，而不是 ChatGPT 的替代品。当前视觉方向强调多层、轻薄、半透明的界面质感，表达“在原生体验之上降低阻力”的产品定位。

当前产品主色方向：

- ivory
- cool gray
- graphite
- 单一 teal 强调色

## 当前资源

- [`assets/branding/mica-product-hero.png`](../assets/branding/mica-product-hero.png)：产品宣传概念图，用于 README、GitHub repo 和后续 Chrome Web Store 宣传。
- [`assets/branding/mica-brand-concept.png`](../assets/branding/mica-brand-concept.png)：品牌/图标概念图，用于未来 extension icon 的设计参考。
- [`assets/branding/mica-icon-master-v0.png`](../assets/branding/mica-icon-master-v0.png)：从品牌概念图中央 Mica symbol 裁切出的 v0.x working icon master。
- [`assets/branding/mica-icon-master-v1.png`](../assets/branding/mica-icon-master-v1.png)：当前透明背景 faceted mica crystal 图标母版。

这两张图均属于早期设计稿，不代表最终 UI。

## Extension Icon 注意事项

后续真正发布 Chrome extension 前，需要单独制作纯图标版本，至少准备：

- 16×16
- 32×32
- 48×48
- 128×128
- 512×512 source

真正的 extension icon 只保留中央 Mica crystal，不包含文字、功能卡片、对话气泡或背景 UI。

Chrome 实际使用的尺寸由 `scripts/generate-icons.py` 从 v1 母版派生。
