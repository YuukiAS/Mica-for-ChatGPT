# Release Packaging

## 当前结论

GitHub Release 不应只指向仓库里的 `dist/` 目录。每个可测试/可发布版本都应额外提供一个可下载的 ZIP，例如：

```text
mica-for-chatgpt-v0.1.4.zip
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

开发阶段使用固定的 `dist/mica-dev/`，方便本地 `Load unpacked`、fixture 和快速排查。普通 `npm run build` 不再生成新的版本化 unpacked 目录。

正式进入稳定发布流程后：

- repo 以 `extension/` 源码、构建脚本、测试和文档为主；
- GitHub Release 保存真正给用户下载的版本化 ZIP；
- 每个 ZIP 应由同一个 commit 构建；
- Release notes 明确标注支持范围、已知限制和安装步骤；
- 最好同时提供 SHA-256 校验值；
- 不使用 GitHub Actions 自动发布，除非未来明确需要。当前优先使用本地构建 + `gh release`，避免消耗 Actions 额度。

## 当前 0.5.16 候选状态

当前 `dist/mica-dev/` 已经可以通过 `Load unpacked` 安装。0.5.16 已通过实际安装扩展的隔离 Chromium 回归、Low Memory A/B/C 压测、PDF.js 指针选择、视觉基准和完整候选验收；登录态 ChatGPT 与目标物理低内存设备仍需一次集中确认。因此它是预发布候选，不是稳定版。

当前候选包含单回答右键复制入口、ChatGPT 高亮、保留高亮和可选择数学文字层的 PDF，以及最近 40 条消息的 Low Memory 数据窗口。候选包名为：

```text
v0.5.16
mica-for-chatgpt-v0.5.16.zip
```

Chrome manifest 的机器版本与用户可见版本均使用 `scripts/release-config.mjs` 中的三段式正式 runtime 版本，例如当前的 `0.5.16`。日常 runtime build 不再继续 `0.1.0-alpha.N` 双重编号。

当前本地命令：

```bash
npm run package:release
```

该命令会重新 build，然后生成：

```text
release/mica-for-chatgpt-v0.5.16.zip
release/mica-for-chatgpt-v0.5.16.sha256
```

当前本地候选 ZIP 的 SHA-256 为 `138df13446321fb8d5a6a38de83572c07a62d29fad57acd8504ed1d36dbc95f9`。最终发布前必须从最终合入提交重新生成并复核，不能只沿用此处记录。

当前 ZIP 解压后根目录直接包含：

```text
manifest.json
content.js
answer-context-menu-background.js
low-memory-background.js
popup/
options/
pdf/
icons/
```

版本来源集中在 `scripts/release-config.mjs`，避免 manifest、固定开发目录、ZIP 文件名和 release tag 漂移。Release package 从当前 canonical `dist/mica-dev` 内容生成版本化 ZIP / SHA-256。

0.5.16 的预发布说明草稿位于 [`releases/v0.5.16.md`](releases/v0.5.16.md)。只有最终登录态验收通过、候选按最终提交重新冻结并经受保护流程合入后，才可以用该说明创建 GitHub Pre-release。

## 发布前最低检查

- `manifest.json` 位于 ZIP 根目录。
- Edge / Chrome 可以从解压目录成功 `Load unpacked`。
- popup 正常打开。
- content script 只作用于声明的 ChatGPT host。
- extension icon 在 16 / 32 / 48 / 128 px 下可辨认。
- 不包含源码之外的本地缓存、日志、诊断结果或用户数据。
- ZIP 与 release tag 对应同一 commit。
- README 的安装说明与实际包名一致。
