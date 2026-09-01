# Release Packaging

## 当前结论

GitHub Release 不应只指向仓库里的 `dist/` 目录。每个可测试/可发布版本都应额外提供一个可下载的 ZIP，例如：

```text
mica-for-chatgpt-v0.1.0-alpha.1.zip
```

用户下载后解压，再在 Edge / Chrome 的扩展管理页中使用 `Load unpacked` 选择解压目录。未来提交 Chrome Web Store 时，也可以复用同一份经过校验的 ZIP 结构。

## ZIP 结构

ZIP 根目录应直接包含扩展文件，不要额外再套一层无意义目录：

```text
manifest.json
content.js
popup/
icons/
```

解压后打开该目录即可看到 `manifest.json`。

## Repo 与 Release 的职责

开发阶段可以暂时保留 `dist/mica-vX.Y.Z/`，方便本地 `Load unpacked`、fixture 和快速排查。

正式进入稳定发布流程后：

- repo 以 `extension/` 源码、构建脚本、测试和文档为主；
- GitHub Release 保存真正给用户下载的版本化 ZIP；
- 每个 ZIP 应由同一个 commit 构建；
- Release notes 明确标注支持范围、已知限制和安装步骤；
- 最好同时提供 SHA-256 校验值；
- 不使用 GitHub Actions 自动发布，除非未来明确需要。当前优先使用本地构建 + `gh release`，避免消耗 Actions 额度。

## 当前 v0.1 状态

当前 `dist/mica-v0.1.0/` 已经可以通过 `Load unpacked` 安装，但 P0 尚未在目标 8 GB MacBook Neo 上完成真实性能验收。因此不应把它表述为“稳定版”。

下一次完成 diagnostics、状态文案修正和正式 extension icon 后，建议产出第一个预发布包：

```text
v0.1.0-alpha.1
mica-for-chatgpt-v0.1.0-alpha.1.zip
```

Chrome manifest 的机器版本仍使用合法的四段以内数字版本，例如 `0.1.0`；如需要显示预发布名称，可使用 `version_name` 表达 `0.1.0-alpha.1`。

当前本地命令：

```bash
npm run package:release
```

该命令会重新 build，然后生成：

```text
release/mica-for-chatgpt-v0.1.0-alpha.1.zip
release/mica-for-chatgpt-v0.1.0-alpha.1.sha256
```

当前 ZIP 解压后根目录直接包含：

```text
manifest.json
content.js
popup/
icons/
```

版本来源集中在 `scripts/release-config.mjs`，避免 manifest、dist 目录、ZIP 文件名和 release tag 漂移。

## 发布前最低检查

- `manifest.json` 位于 ZIP 根目录。
- Edge / Chrome 可以从解压目录成功 `Load unpacked`。
- popup 正常打开。
- content script 只作用于声明的 ChatGPT host。
- extension icon 在 16 / 32 / 48 / 128 px 下可辨认。
- 不包含源码之外的本地缓存、日志、诊断结果或用户数据。
- ZIP 与 release tag 对应同一 commit。
- README 的安装说明与实际包名一致。
