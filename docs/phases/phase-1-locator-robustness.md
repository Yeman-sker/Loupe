# 阶段 1 · Locator 鲁棒性核心

> **对应里程碑：M1** ｜ 做出“定位即信任”的核心：可靠的多证据 locator 与重解析，信心不足时显式 drifted/lost，并用可自动出指标的鲁棒性测试集校准阈值。

## 阶段目标

- **mark-time 留下多证据 locator，而非单一 selector。** 每次拾取都按 §7.2 采集到一束可定位证据（selector 级联、stable 属性/id、role/可访问名、文本归一化与 hash、parent_chain、nth_path、shadow_path、geometry 等），为后续可信重定位提供冗余证据。
- **重解析在任意 root 下产出可信、可解释的结果。** 给定 locator 与当前 DOM root，可重新解析目标并产出符合 §7.1 契约的结果：`locator_status`（resolved/drifted/lost）、`confidence`、能解释证据来源的 `matched_by`、`candidates_considered` 与 `ambiguity`；`matched_by` 不得只返回 `["score"]`。
- **不盲信单一 selector。** 即使 primary selector 唯一命中，也必须通过最少证据校验后才高置信返回，否则回落到完整候选评分——单点匹配不足以判定 resolved。
- **缺证据不被系统性低分。** 评分只对 mark-time 实际采集到的证据计分，缺失的 id/文本/role/geometry 不惩罚候选，使“没有文本/id 的按钮”等元素不会被结构性地误判为低置信。
- **相似目标会被降级而非误判。** 当 top-1 与 top-2 过于接近、或证据来源高度重合时，从 resolved 降级为 drifted；信心不足时显式 drifted/lost，绝不静默指向错误元素。
- **大页面下不卡死且可控降级。** 候选收集有上限保护，超限时降级信心并留下可读原因，而不是无界扫描。
- **拥有可自动产出指标的离线鲁棒性测试集。** fixtures 覆盖 class hash 变化、Tailwind 噪声、文案变更、列表插入、父容器重排、Shadow DOM、same-origin iframe、SVG、nested scroll，并能自动输出四项离线 locator 分类指标，成为阈值校准与 KPI 判定的权威来源（§7.6 的阈值是起始值，须由该 suite 标定）。same-origin iframe fixture 依赖阶段 0 已冻结的 `frame_path` 契约；本阶段不声明活体 route/detach 恢复 KPI。

## 验收标准

- 鲁棒性测试集可自动输出四项离线 locator 指标：Top-1 target accuracy、False-resolved rate、Ambiguity downgrade correctness、Offline drift/lost classification，无需主观演示。
- 四项阶段 1 KPI 达到 §15.1 目标：Top-1 ≥ 99%、False-resolved ≤ 0.5%、Ambiguity downgrade correctness ≥ 95%、Offline drift/lost classification ≥ 95%。
- 全部 fixtures 场景下，重解析输出均满足 §7.1 的 ResolveResult 契约，且 `matched_by` 可解释证据来源；same-origin iframe 场景必须使用阶段 0 的 `frame_path` 定位目标 frame。

## 范围边界（本阶段不做，留待后续）

- 本阶段只交付“可被调用的采集/解析库”与离线测试集，**不**接入运行中扩展，也不判定 live route/detach 恢复正确性。
- 活体漂移恢复（route epoch、DOM quiet window、RouteObserver、stale route 取消、target detach 后恢复）与对应 KPI → 阶段 4。
- picker 选元素触发采集的交互 → 阶段 2。

## 依赖

- 阶段 0：`Locator`/`ResolveResult` 的 schema 与 snake_case wire 契约（字段语义与命名规则），以及 same-origin iframe `frame_path` 等 support-matrix 必需字段。

## 对应 PRD 章节

- §2（原则 1：定位即信任）、§7.1–7.6、§13.1、§15.1、§14（M1）
