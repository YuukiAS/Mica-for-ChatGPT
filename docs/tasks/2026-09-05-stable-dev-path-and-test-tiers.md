# 2026-09-05 Stable unpacked path + proportional test policy

## 背景

当前 `0.1.4` 迭代把正式版本号理顺了，但又暴露出两个新的开发体验问题：

1. 日常 unpacked build 路径变成 `dist/mica-v0.1.4`。如果以后每次 PATCH 都生成 `dist/mica-v0.1.5`、`dist/mica-v0.1.6`，用户就需要不断在 Edge / Chrome 里重新选择目录，既麻烦，也会破坏本地扩展实例的连续性。
2. 当前任务里默认把 `npm test`、`npm run test:e2e`、`npm run test:e2e:stress` 连续全跑，容易把 stress 变成每轮常规动作。Stress 对 race-condition / 发布前很有价值，但不应该成为每个 patch 的固定成本。

本任务只定义并落实这两件事，不扩展 Mica 功能范围。

---

## Goal A — 稳定的开发 Load-unpacked 路径

正式版本继续变化，但开发目录固定为：

`dist/mica-dev`

### 目标体验

用户只做一次：

1. `edge://extensions` / `chrome://extensions`
2. `Load unpacked`
3. 选择 `dist/mica-dev`

之后每一版只需要：

1. `git pull` / 获取新代码；
2. `npm run build`；
3. 在扩展管理页点 Reload；
4. 刷新 ChatGPT 页面。

**不再要求因为 `0.1.4 -> 0.1.5` 而重新选择一个新目录。**

### 实现建议

把 build / release 两个概念拆开：

- canonical development build：`dist/mica-dev`
- versioned release artifact：例如 `release/mica-for-chatgpt-v0.1.4.zip`

建议在 `scripts/release-config.mjs` 中明确区分：

- 正式 runtime version；
- 固定 dev dist 目录名，例如 `DEV_DIST_DIR_NAME = "mica-dev"`；
- versioned release basename。

`npm run build`：

- 始终刷新 `dist/mica-dev`；
- manifest / popup / diagnostics 内仍然显示正式版本，例如 `0.1.4`；
- 不因版本 bump 改变 Load-unpacked 路径。

`npm run package:release`：

- 从当前 canonical build 生成带版本号的 ZIP / SHA-256；
- 发布产物仍然必须版本化；
- 验证包内 manifest 版本与 source of truth 一致。

### 需要同步更新

至少检查并统一：

- `scripts/build.mjs`
- `scripts/release-config.mjs`
- `scripts/package-release.mjs`
- `scripts/validate-build.mjs`
- `scripts/validate-release.mjs`
- `scripts/run-e2e.mjs`
- 所有 fixture / smoke test 中硬编码的 `dist/mica-v...`
- README / installation instructions
- 本轮 investigation 中的 reload 路径

不要留下“有些测试加载 `dist/mica-dev`、有些还加载 `dist/mica-v0.1.4`”的双轨状态。

### 旧目录处理

当前 main 上的旧 versioned dist 目录不再作为 canonical dev path。可以在本轮整理掉当前版本化开发目录，避免用户误选；历史版本信息由 Git / Release 保留，不需要靠 main 上堆多个 dev dist 目录保存。

---

## Goal B — 测试按风险分层，不再默认全跑

遵循 `AGENTS.md` 的新 Test tiers。

### Tier 1 — 普通 runtime 改动

默认只跑：

`npm test`

适用：

- 版本号；
- build 配置；
- popup 非复杂交互；
- 普通 source fix；
- manifest / packaging 校验。

### Tier 2 — DOM / browser lifecycle

在候选实现稳定后跑一次：

1. `npm test`
2. `npm run test:e2e`

适用：

- composer lifecycle；
- mount / unmount；
- overlay；
- virtualization；
- observer/listener；
- guided browser diagnostics。

不要在每个小编辑之后重复整个 E2E。

### Tier 3 — stress

`npm run test:e2e:stress`

只在以下情况使用：

- race condition / intermittent lifecycle bug；
- E2E 有 flaky；
- substantial lifecycle change；
- release/stage candidate；
- task 明确要求。

普通 patch 不默认跑 stress。

如果不需要，最终明确报告：

`stress: not run — not indicated by test policy`

而不是为了“测试越多越保险”自动跑满。

---

## 与当前 0.1.4 任务的衔接

当前 Codex 很可能正在本地完成 `0.1.4`，并且已经跑过 `npm test` / `npm run test:e2e`，甚至 stress 可能正在运行。

处理原则：

- **不要丢弃当前未提交实现。**
- 如果 stress 已经启动，让这一轮完成并记录结果；不要因为本任务的 build-path 修改再无条件跑第二次 stress。
- 把 stable dev path 改动并入当前尚未完成的 `0.1.4` 候选，不要仅因为“目录名从版本化改为固定”再制造一个无意义的新版本。
- 如果 `0.1.4` 在执行本任务前已经正式 push 到 `main`，则遵循 `docs/VERSIONING.md` 判断是否需要下一 PATCH；不要静默覆盖已经发布的 runtime build。
- stable path 修改完成后至少跑 `npm test`；由于当前 E2E fixture 的加载路径也会改变，应再跑一次 `npm run test:e2e` 证明 fixture 确实加载 canonical `dist/mica-dev`。
- 若 composer/runtime lifecycle 代码在上一次 stress 通过后没有再次变化，则不要重跑 stress。

---

## 验收标准

1. `npm run build` 输出固定到 `dist/mica-dev`。
2. `dist/mica-dev/manifest.json` 显示当前正式版本，例如 `0.1.4`。
3. popup / diagnostics 与 manifest 版本一致。
4. E2E fixture 加载 `dist/mica-dev`，不再引用当前 PATCH 的版本目录。
5. Release packaging 仍生成版本化文件名。
6. README 明确告诉用户：只需第一次 Load unpacked `dist/mica-dev`，以后只 Reload。
7. `npm test` PASS。
8. `npm run test:e2e` PASS。
9. 不因本任务本身自动再跑 stress；如跳过，按 test policy 明确说明。
10. 不操作真实登录态 ChatGPT，不自动发送消息。

---

## 本轮不要做

- 不新增 Mica 产品功能；
- 不改 ghost-send / stale-response 逻辑；
- 不扩大 known interruption allowlist；
- 不自动创建 GitHub Release；
- 不因为 stable path 重构引入新的 framework / build system；
- 不把版本号重新编码进 dev directory；
- 不把 stress 重新塞进 `npm test` 或普通 `test:e2e`。
