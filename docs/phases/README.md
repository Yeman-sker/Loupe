# Loupe 迭代阶段（Phases）

> 本目录把 `PRD.md` 拆成**依赖有序、可稳步推进**的迭代阶段。每个阶段文件**只写目标**（阶段目标 / 验收标准 / 范围边界 / 依赖 / 对应 PRD 章节）；实现细节、字段定义、算法与阈值仍以 `PRD.md` 为权威来源。

## 阶段与里程碑映射

阶段 0–5 与 PRD §14 的里程碑 M0–M5 **一一对应**：

| 阶段 | 里程碑 | 主题 | 文件 |
|---|---|---|---|
| 阶段 0 | M0 | 基础契约：Schema / Daemon Health / 空 MCP | [phase-0-foundation.md](./phase-0-foundation.md) |
| 阶段 1 | M1 | Locator 鲁棒性核心（定位即信任） | [phase-1-locator-robustness.md](./phase-1-locator-robustness.md) |
| 阶段 2 | M2 | 扩展拾取闭环：Picker / Composer / Pin / 本地存储 | [phase-2-extension-capture.md](./phase-2-extension-capture.md) |
| 阶段 3 | M3 | Daemon 持久化与 project-scoped MCP | [phase-3-daemon-mcp.md](./phase-3-daemon-mcp.md) |
| 阶段 4 | M4 | 漂移恢复、同步韧性与扩展 E2E | [phase-4-drift-sync-e2e.md](./phase-4-drift-sync-e2e.md) |
| 阶段 5 | M5 | Launch Polish 与 Marketplace | [phase-5-launch-polish.md](./phase-5-launch-polish.md) |

> **编号歧义提醒：** 这里的“阶段 0–5”是本项目的**迭代阶段**（= 里程碑 M0–M5）。PRD §4.4 中的 “Phase 2 / 3 / 4” 指**发布后的后续路线**，与本目录的阶段 2/3/4 **不是同一回事**（见文末）。

## 信任闭环与依赖链

MVP 只服务一条信任闭环：

```
pick → robust locate/recover → persist/sync → low-noise Agent read → resolve
```

阶段按依赖有序推进，前一阶段是后一阶段的地基：

```
阶段0 契约地基 ──┬─→ 阶段1 重解析库 ──┐
                 │                     ├─→ 阶段2 扩展拾取+本地保存 ─→ 阶段3 daemon 持久化+MCP ─→ 阶段4 漂移恢复+同步韧性+E2E ─→ 阶段5 发布打磨
                 └─────────────────────┘
```

- **阶段 0** 冻结所有后续阶段都要依赖的 wire schema 与 project/session scope 契约。
- **阶段 1** 是“定位即信任”的核心，可用离线测试集独立校准，不依赖扩展 UI。
- **阶段 2** 在阶段 1 的库之上做浏览器内拾取与本地优先保存（无 daemon 也能存）。
- **阶段 3** 让 Agent 能在严格隔离下读/改 mark。
- **阶段 4** 把闭环做到生产级稳，并用真实 E2E + 契约/安全测试兜底。
- **阶段 5** 才做发布与体验打磨。

## KPI 落在哪个阶段判定

为避免“同一 KPI 在多个阶段重复声明”，明确每个 KPI 的判定阶段：

| KPI | 目标 | 判定阶段 |
|---|---|---|
| Top-1 / False-resolved / Ambiguity downgrade / Offline drift-lost classification | ≥99% / ≤0.5% / ≥95% / ≥95% | 阶段 1（离线 locator 鲁棒性测试集） |
| Live route/detach recovery correctness（无 stale route pin commit） | 生产 E2E 通过 | 阶段 4 |
| Local save success（daemon offline） | 100% | 阶段 2 首次达成；阶段 4 在韧性路径下守住 |
| Save-to-Agent readable P95（daemon online） | < 2s | 阶段 3 |
| Project isolation violations | 0 | 阶段 3 首次达成并判定；阶段 4 回归守住 |
| TTFM / AgentMark 体积 / Marketplace install success | <5min / <1KB / ≥95% | 阶段 5 |

## 发布后的后续路线（PRD §4.4，非本次迭代阶段）

以下属于 Trust Core / Launch 之后的探索方向，**不**纳入阶段 0–5，列此仅为对齐长期方向：

- **Roadmap Phase 2 · 更强 Agent 工作流：** lazy screenshot、`watch_marks`、discussion replies、generic client config helper。
- **Roadmap Phase 3 · 页面内设计工作流：** `pending_changes`、design token 映射、preview/undo。
- **Roadmap Phase 4 · 团队化：** cloud sync、字段级 merge、审计、共享 mark。
