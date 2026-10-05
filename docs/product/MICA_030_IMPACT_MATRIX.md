# Mica 0.3.0 影响矩阵

## 变更面

| 风险 | 源码模块 | fixture / unit | validator / E2E | 候选证据 |
|---|---|---|---|---|
| Markdown / LaTeX Copy | `copy/markdown-copy.ts`, `content.ts` | answer serializer、old-bad action placement | clipboard MIME、extension popup、unknown DOM | Markdown/plain HTML、失败反馈、自然入口 |
| Composer lifecycle | `reliability/turn-delivery-guard.ts`, `content.ts` | typing、IME、paste/cut、mention、connector、remount | hot-path counters、persistent extension context | commit/settled 状态和不误清草稿 |
| Ghost send / fake waiting | `turn-delivery-guard.ts` | deterministic clock、identity/fingerprint | lifecycle E2E | 单一安全恢复动作、去重锁 |
| Popup product UI | `popup/*` | storage/message contract | 320/360/400、light/dark、100/125/150%、AX、screenshot | 真实 extension popup、无开发控件 |
| Page integration | `content.ts`, `copy/*` | current-derived action cluster | placement geometry/keyboard | exact contract 未开门前 fail-open |
| Long-thread truth | `content.ts` | synthetic long thread | OFF / inactive / active metrics | 无额外收益则 `Native handling` |
| Version/build/package | release/build scripts | build validation | install/package smoke | manifest/popup/report/ZIP/SHA 一致 |

## 预计移除或关闭

- 正常 popup 的 diagnostics、composer check、raw mounted/optimized counters。
- 常驻 status dot 与 draggable overlay。
- 自动 dismiss 授权/安全 UI 的普通产品能力。
- 未证明确有额外收益的 long-thread optimization 开关和 Active 宣称。

## 测试顺序

1. serializer 与状态机纯单元测试；
2. old-bad/new-good 真实派生 fixture；
3. popup 与 clipboard focused extension E2E；
4. composer/input hot-path focused E2E；
5. `npm test`；
6. 同一候选一次完整 Tier 2；
7. Producer 机制审查与整产品审查；
8. 当前界面合同补齐后才启用注入；
9. 冻结候选独立审查。

```text
IMPACT_AUDIT=COMPLETE
TIER_2_INDICATED=YES
STRESS_INDICATED=YES_FOR_LIFECYCLE_FINAL_CANDIDATE
```
