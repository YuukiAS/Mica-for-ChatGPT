# Mica 源码主线恢复

## 结论

本轮以 `main` 的 `2a33a57ca7e65c3dd72a741e861c7bf39dcab71c` 为恢复基线，并在精确授权的分支 `codex/mica-product-recovery-current-gpt-ui` 上工作。旧分支 `origin/codex/v020-convergence-pushable` 不作为整体产品基线；其中经过重新审计的功能代码、回归语义和测试夹具可以选择性迁移，Atlas 产品界面和旧 UI 结论不得直接继承。

## 仓库身份与起点

- canonical checkout：`D:\Code\Mica-for-ChatGPT`
- origin：`https://github.com/YuukiAS/Mica-for-ChatGPT.git`
- 起始分支：`main`
- 起始 `main` 与 `origin/main`：`2a33a57ca7e65c3dd72a741e861c7bf39dcab71c`
- 工作区起始状态：干净，`## main...origin/main`
- 当前工作分支：`codex/mica-product-recovery-current-gpt-ui`
- 未发现其他本地 worktree、未推送本地提交或未跟踪用户文件。

## 分支分叉

`main` 与 `origin/codex/v020-convergence-pushable` 的共同祖先是 `aa4ce52581fff2e207d1f93600becbb3018b0efc`。相对该祖先，`main` 有 3 个独有提交，旧产品分支有 57 个独有提交。旧分支包含约 131 个文件、41,397 行新增和 956 行删除，其中大量内容属于 Atlas、旧 Goal、旧合同和验证基础设施。

旧分支最终提交为 `f919e6f656b6da0d9bfdb495b41ff23feb22493c`，运行版本为 `0.2.4`。其正常 popup 仍直接包含 Diagnostics、Live Surface Atlas、多个 Run/Copy/Stop/Reset 操作和内部状态；主要功能在 safe baseline 中默认关闭。因此它不是本 Goal 所需的可日用产品基线。

## 公开引用与历史约束

- 远端只存在历史 tags：`v0.1.0-alpha.1`、`v0.1.0-alpha.2`、`v0.1.0-alpha.3`。
- PR #7 head 为 `d15982bf1954121f2cdb35908dd33f79b30f5489`，对应旧 v0.2 convergence 计划。
- PR #8 head 为 `77e9fc41603716a56282cb3370c1db5ae4725ee4`，对应旧 Live Surface Atlas 计划。
- 两个 PR 的历史约束仅在与当前隐私、fail-open、真实派生 fixture、版本一致性和浏览器边界仍兼容时保留。新恢复 PR 建立并迁移有效约束后，它们应标记为 superseded 或关闭。
- 当前 `gh` 认证失效；本轮通过远端 Git refs 核对 PR head、merge refs 和 tags。GitHub 页面状态、Issue 更新与 Release 创建仍需在发布阶段通过可用认证路径重新验证。

## 当前主线版本一致性

起始 `main` 的 `package.json`、`scripts/release-config.mjs` 与 `dist/mica-dev/manifest.json` 均为 `0.1.7`。这证明当前 checkout 内部一致，但公开 tags 仍停在 `v0.1.0-alpha.3`，不代表公开发布与当前主线一致。

## 旧实现分流

### KEEP_AND_PROVE

- `main` 上现有 Manifest V3 + TypeScript 小型架构、稳定 `dist/mica-dev` 路径和版本 source of truth。
- typing hot-path 预算与已有的 IME、输入、connector 相关回归原则。
- fail-open、最小权限、禁止自动处理授权/安全 UI 的边界。
- 经过本 Goal 重新运行并绑定最终候选的 fixture 和 E2E 基础设施。

### PORT_WITH_REWRITE

- 旧分支的 Markdown/LaTeX serializer 逻辑与 `markdown-copy` fixture。
- composer/connector/send residual 的状态证据、race 测试和 real-derived failure semantics。
- 候选身份、受影响测试和 Playwright extension persistent context 的测试能力。
- 只保留隐私安全且与当前 UI 合同一致的 2026 年 9 月派生 fixture；它们只能证明历史故障，不得证明当前 ChatGPT UI。

### ARCHIVE_OR_REMOVE

- 正常 runtime 与 popup 中的 Atlas recorder、Atlas 操作、raw counters 和 build internals。
- 页面常驻、可拖动的状态点及其“通过随意移动掩盖锚点不明确”的交互。
- `0.2.4` safe baseline 对核心能力默认关闭的产品策略。
- 旧 Atlas 作为当前 UI 设计权威的结论。
- 旧 Goal 001–025 的任务编排权威；它们只保留为历史证据。

## 恢复策略

1. 保留 `main` 的可追溯起点和本 Goal 文档。
2. 在当前工作分支完成失败历史、产品合同、当前 UI 合同和设计系统。
3. 以文件和行为为单位迁移旧分支的有效实现，不 cherry-pick 整个 57 提交序列。
4. 对每个历史真实失败建立 old-bad/new-good 同夹具证据。
5. 分别冻结 `0.3.0` 与 `0.4.0` 候选，绑定构建、截图、测试、ZIP、SHA-256 和独立审查。
6. 发布阶段再核对远端 PR/Issue/Release 状态；不得因当前 `gh` 认证失效伪造已完成的远端动作。
