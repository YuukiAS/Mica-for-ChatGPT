# Windows Codex Desktop — Computer Use Setup

本文记录 2026-09-06 在 Windows 11 + Codex Desktop 上实际验证通过的 Computer Use 配置。目标是以后在另一台 Windows 机器（例如工位电脑）快速复现，不再重新排查 Browser Use / Computer Use / `sky` 注入问题。

## 适用场景

该配置用于让 Codex Desktop 在 Windows 上获得原生 Computer Use 能力，从而：

- 枚举 Windows 应用与窗口；
- 启动并聚焦应用；
- 获取窗口 fresh state / geometry / screenshot / accessibility tree；
- 通过 accessibility element 执行结构化点击；
- 通过键盘输入操作桌面应用；
- 辅助 Mica、Bobbio、Lucerna 等真实 GUI 开发与验收。

Browser Use 与 Computer Use 是两条不同链路。Browser Use 能工作，不代表 Windows native Computer Use 已经注入。

## 已验证环境

本次成功环境：

- Windows 11
- Codex Desktop `26.901.4073.0`
- Codex CLI `0.153.1`
- Computer Use plugin/runtime `26.901.31953`
- `@oai/sky` `0.6.26`
- Codex Desktop 为 MSIX / WindowsApps 安装

版本未来可以变化；真正的验收标准是 `sky` 能工作，而不是某个固定版本号或某个 `.mcp.json` 是否存在。

## 必须配置的三项

### 1. User-scope environment variable

为当前 Windows 用户设置：

```text
CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE=1
```

PowerShell 示例：

```powershell
[Environment]::SetEnvironmentVariable(
  "CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE",
  "1",
  "User"
)
```

不要使用 Machine scope，也不需要修改 `PATH`。

验证：

```powershell
[Environment]::GetEnvironmentVariable(
  "CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE",
  "User"
)
```

应返回：

```text
1
```

### 2. Enable Computer Use feature

编辑：

```text
%USERPROFILE%\.codex\config.toml
```

确保已有的 `[features]` section 中包含：

```toml
[features]
computer_use = true
```

如果 `[features]` 已存在，只增加字段，不要创建重复 section。

### 3. Windows sandbox mode

同一份 `config.toml` 中确保：

```toml
[windows]
sandbox = "unelevated"
```

如果 `[windows]` 已存在，只修改/增加对应字段，不要重复创建 section。

## Plugin 状态

确认以下 bundled plugin 为 enabled：

```text
computer-use@openai-bundled
unified-computer-use@openai-bundled
```

不要为了“看起来完整”猜测未知 plugin key；应以当前安装真实 metadata / 现有 Codex 配置为准。

## 修改后的正确流程

配置完成后，**由用户手动重启 Codex Desktop**：

1. `File -> Exit` 完全退出 Codex Desktop；
2. 等待主进程退出；
3. 手动重新打开 Codex Desktop；
4. 新建一个全新 thread；
5. 在新 thread 中验证 native Computer Use。

不要让 Codex 创建 helper 去杀死/重启自身；这会增加不必要的状态复杂度。

## 最小验收

在新 Codex thread 中：

1. 确认 Computer Use runtime injected；
2. 确认 `sky` available；
3. 执行 `sky.list_apps()`；
4. 执行 `sky.list_windows()`；
5. 使用 `launch_app(...)` 打开 Calculator；
6. 获取 Calculator fresh state；
7. 确认 geometry / screenshot / accessibility tree 可用；
8. 优先使用结构化 accessibility click，例如 `click({ window, element_index })` 点击数字 `7`；
9. 再用 keyboard input 验证输入路径。

本次最终实测结果：

```text
Computer Use runtime injected: yes
sky available: yes
list_apps(): success
list_windows(): success
launch_app(Calculator): success
fresh state: success
geometry: yes
screenshot: yes
accessibility tree: yes
structured click: success
keyboard input: success
```

这才是 Windows Computer Use 的通过标准。

## 关于 `.mcp.json` / CUA surfaces

曾观察到生成配置：

```text
%USERPROFILE%\.codex\plugins\cache\openai-bundled\unified-computer-use\<version>\.mcp.json
```

其中一度只有：

```text
CUA_REPL_ENABLED_SURFACES=browser
```

这会导致 Browser Use 可用，但 native `sky` 不注入。

但是最终成功后，验收应以实际 runtime 为准：

```text
sky available = yes
```

不要把 `.mcp.json` 是否存在、是否持久化当作最终成功条件。

## 不推荐的修复方式

默认不要做：

- 手工编辑生成的 `.mcp.json`；
- 把 `browser` 硬改为 `browser,computer`；
- 修改 bundled plugin source / `launch.mjs`；
- 修改 WindowsApps；
- 删除整个 plugin cache；
- 创建假的 `Codex.exe` / symlink；
- 因为 Browser Use 可用就用它代替 native Computer Use；
- 在未确认配置问题前卸载/重装 Codex Desktop。

## 常见误判

### Browser Use 能操作网页，但 `sky` 不存在

说明浏览器 surface 可用，但 native Computer Use 没有注入。重点检查上面的三项配置，而不是继续调 Browser Use。

### `list_apps()` 能看到 Calculator app，但 `windows=[]`

可能只是 Calculator 当前没有运行。先用 `launch_app(...)` 打开，再获取 fresh state。

### `coordinate input geometry is unavailable`

不要直接猜坐标。先获取目标窗口 fresh state；优先用 accessibility element click。只有拿到同一次 fresh state 的 geometry / screenshotId 后，才考虑 coordinate click。

## 更新/换机后的快速 smoke test

Codex Desktop 大版本更新或在另一台 Windows 机器配置后，用一个新 thread 运行：

```text
只验证 Windows Computer Use：
1. sky.list_apps()
2. launch Calculator
3. 获取 Calculator fresh state
4. 使用 accessibility element 点击数字 7
5. 再测试一次 keyboard input
6. 不使用 Browser Use workaround

只汇报 PASS / FAIL 和 exact error。
```

如果上述全部成功，则无需重复审计路径、MCP cache 或安装形态。
