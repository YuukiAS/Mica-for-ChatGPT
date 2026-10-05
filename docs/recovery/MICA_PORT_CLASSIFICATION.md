# Mica 旧实现迁移分类

## 结论

`origin/codex/v020-convergence-pushable` 不作为产品主线，也不整体合并。该分支相对当前 `main` 有 57 个独有提交、132 个文件变化和约 4.1 万行新增，其中 Atlas、探针、旧 Goal 和生成合同占主要体积。新主线只迁移能被当前合同与新测试独立证明的最小部分。

## KEEP_AND_PROVE

- `extension/src/reliability/*` 中与普通输入热路径隔离的状态机思想；保留现有 `main` 实现并重新验证，不以旧 PASS 继承结论。
- `tests/fixtures/composer-typing-hotpath.html`、`connector-mention-lifecycle.html` 的风险覆盖维度；fixture 结构必须按当前合同重建。
- 固定 `dist/mica-dev`、统一版本源、构建后校验和打包校验的机制。
- `markdown-copy.ts` 中“从 answer DOM 独立序列化、不依赖 native Copy 输出”的产品方向；算法重写并用新 fixture 证明。

## PORT_WITH_REWRITE

- Markdown/LaTeX serializer：保留覆盖目标，删除旧 action-bar 假设和旧 selector 权威。
- composer/connector/send recovery：合并为单一 turn-delivery 生命周期；不再让多个 recovery 模块竞争清理 composer。
- popup：完全按 `MICA_PRODUCT_CONTRACT.md` 和 `MICA_UI_SYSTEM.md` 重写，诊断迁出正常 surface。
- Playwright：保留 bundled Chromium 的本地 fixture 能力，改为扩展 persistent context、真实 popup、clipboard、AX/geometry、截图和候选绑定。
- 旧真实失败 fixture：仅提炼脱敏结构与时间顺序，并明确标记 historical-derived；不会标成 2026-10 当前 UI。

## ARCHIVE_OR_REMOVE

- `atlas-recorder.ts`、全部 `live-atlas-*`、Atlas popup 控件与 Atlas 生成 fixture。
- 常驻页面状态点、可拖动 overlay、宽泛 fallback 容器和旧 `Mica Copy` 文字按钮。
- 旧分支中的 26 个连续 Goal 文档、旧 release-candidate 叙述和跨候选 evidence。
- 未经当前证据证明的 action-bar selector、composer selector、按钮顺序与 ChatGPT 样式结论。
- 把功能默认关闭后称为完成的 safe-baseline 结论。

```text
OLD_BRANCH_MERGE=REJECTED
SELECTIVE_PORT_ONLY=YES
ATLAS_RUNTIME=ARCHIVED
OLD_UI_AUTHORITY=NO
```
