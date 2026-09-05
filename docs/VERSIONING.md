# Mica Versioning Policy

Mica 的版本号首先用于区分“用户实际加载的是哪一份运行代码”，而不是装饰性发布标签。只要 `main` 上产生一个新的可加载运行版本，就必须有新的版本号。

## 1. 版本格式

从下一次运行代码改动开始，统一使用普通三段式版本号：

`MAJOR.MINOR.PATCH`

例如：

- `0.1.4`
- `0.1.5`
- `0.2.0`
- `1.0.0`

不再把日常开发版本长期写成 `0.1.0-alpha.3`、`0.1.0-alpha.4` 这类“固定三段版本 + 额外 alpha/beta 序号”的双重编号。

在 1.0 之前，版本本身已经表达“仍处于开发阶段”；GitHub Release 是否为 pre-release 由 GitHub 的 pre-release 标记表达，不需要再把 `alpha` / `beta` 重复塞进每个日常 build 的显示版本。

## 2. 当前迁移

历史公开包已经存在：

- `v0.1.0-alpha.1`
- `v0.1.0-alpha.2`
- `v0.1.0-alpha.3`

这些历史 tag / release 保持不动，不重写。

下一份包含运行代码变更的 build 从 `0.1.4` 开始。这样旧的 alpha.1 / alpha.2 / alpha.3 在人类阅读上可自然对应到前三个早期迭代，后续不再继续 alpha 序号。

## 3. 什么时候必须 bump

任何 push 到 `main`、并改变用户实际运行行为的提交，都必须在同一轮 bump 版本，并 rebuild `dist`。包括但不限于：

- `extension/src/**` 行为变化；
- `extension/popup/**` 行为或 UI 变化；
- `manifest` / 权限 / content script 装载变化；
- 诊断逻辑、状态逻辑、overlay、可靠性逻辑变化；
- 会改变 unpacked extension 实际输出的 build 配置变化。

以下情况通常不 bump runtime version：

- 纯文档；
- issue / task / roadmap 更新；
- 不影响运行产物的注释或研究记录；
- 仅新增尚未被 build / manifest 引用的开发辅助脚本。

判断原则：如果用户 reload unpacked extension 后“运行代码可能与上一个 main build 不同”，就必须是新版本。

## 4. bump 规则

当前 `0.x` 阶段：

- 同一功能线内的修复、诊断增强、小功能：PATCH + 1，例如 `0.1.4 -> 0.1.5`；
- 进入明显的新能力阶段或一组较大的产品能力：MINOR + 1，例如 `0.1.x -> 0.2.0`；
- 达到公开稳定基线后再进入 `1.0.0`。

不要为了“看起来更正式”提前升 major，也不要因为改动小就复用旧版本号。

## 5. Manifest / build source of truth

`scripts/release-config.mjs` 是版本 source of truth。

从 `0.1.4` 开始：

- `MACHINE_VERSION` 使用新的三段式版本，例如 `0.1.4`；
- `VERSION_NAME` 应与 `MACHINE_VERSION` 一致，或在后续清理中直接取消额外 display version；
- 不允许出现 `MACHINE_VERSION = 0.1.0`、`VERSION_NAME = 0.1.0-alpha.3` 长期复用但 runtime 已变化的情况；
- `BUILD_LABEL` 可以继续保留为内部诊断描述，例如 `composer-guided-diagnostics.1`，但它不能代替正式版本号。

用户判断“我到底加载了哪版”时，版本号应该已经足够区分；`BUILD_LABEL` 只负责补充说明该版本的实现主题。

## 6. 开发用 unpacked 路径必须稳定

**版本号应该变化，但浏览器日常 `Load unpacked` 的目录不应该跟着版本号变化。**

从 `0.1.4` 起，开发构建使用一个跨版本稳定的 canonical 路径：

`dist/mica-dev`

日常流程应当是：

1. Edge / Chrome 只需要第一次 `Load unpacked` 选择 `dist/mica-dev`；
2. 后续 `0.1.4 -> 0.1.5 -> 0.1.6` 只重建这个目录的内容；
3. 用户只需要在扩展管理页点击 Reload，不应每次重新浏览并选择新的版本目录；
4. `manifest.json`、popup 和 diagnostics 内部仍显示真实版本号，因此稳定路径不会掩盖版本差异。

不要把日常开发目录写成：

- `dist/mica-v0.1.4`
- `dist/mica-v0.1.5`
- `dist/mica-v0.1.6`

这种版本化目录只适合作为阶段性 snapshot，不适合作为长期加载路径。路径不断变化会增加人工操作，也可能让 Chromium 把不同路径视为不同的 unpacked extension 实例，从而干扰本地设置和诊断连续性。

### 版本化产物仍然保留

稳定开发目录与版本化发布产物是两件事：

- **开发 / 真机手工验收：** `dist/mica-dev`
- **需要归档或发布时：** 生成带版本号的 ZIP / SHA-256 / 可选 snapshot，例如 `mica-for-chatgpt-v0.1.4.zip`

`npm run build` 不应为了普通开发产生一个新的版本化 Load-unpacked 目录。

`npm run package:release` 可以从当前 canonical build 生成版本化发布产物，但必须验证包内 manifest 的正式版本与 `scripts/release-config.mjs` 一致。

## 7. Dist 与验收一致性

每次 runtime version bump 后必须：

1. 更新版本 source of truth；
2. rebuild canonical `dist/mica-dev`；
3. 验证 `dist/mica-dev/manifest.json` 与 popup 显示的是新版本；
4. diagnostics 报告中的 `version` / `versionName` 与新版本一致；
5. 测试通过后才 push 到 `main`；
6. 汇报用户只需 Reload `dist/mica-dev`，而不是提供一个每轮变化的新 unpacked 路径。

不得出现 source 已变、canonical dev build 还是旧版本，或 popup / diagnostics 继续显示旧编号的情况。

## 8. GitHub Release

不是每次 patch 都必须创建 GitHub Release。

- `main` 上每个 runtime build 都必须有唯一版本；
- 只有需要给用户打包、跨机器下载或形成阶段性快照时才创建 Release；
- 1.0 之前需要发布时，使用 GitHub `pre-release` 标记即可；
- Release tag 使用同一个正式版本，例如 `v0.1.4`；
- 不复用旧 tag，不重写历史 release。
