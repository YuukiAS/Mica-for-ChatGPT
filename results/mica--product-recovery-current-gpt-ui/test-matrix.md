# Test matrix

## Mica 0.3.0 Daily Core — local candidate

| Layer | Command / evidence | Result | Elapsed |
|---|---|---|---|
| Build | `pnpm run build` | PASS | included below |
| Pure state core | `pnpm run test:core` | PASS, 10 transitions/privacy/hot-path assertions | focused run |
| Serializer + derived fixture | `pnpm run test:product` | PASS; old placement EXPECTED_FAIL, new placement PASS | 1.5 s |
| Actual extension E2E | `pnpm run test:e2e` | PASS; popup, clipboard, storage, placement, lifecycle, four anomaly states, responsive matrix | 4.6 s |
| Visual Producer review | light/dark 360px screenshots + 16/32px icons | PASS after icon/crop correction | manual inspection |
| Stress | not yet run | pending frozen candidate | — |
| Current authenticated ChatGPT | not yet run | merged HUMAN_ONLY evidence pending | — |

The 0.3.0 runtime remains a local candidate until the current authenticated UI contract is exact. The listed PASS claims do not cover the unresolved live action cluster or authenticated lifecycle.
