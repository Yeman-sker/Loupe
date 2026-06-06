# ADP: anomaly `repro` 生成保真回放守卫(绿)，而非失败复现测试(红)

> 关联：细化并部分取代 `adp-20260606-anomaly-capture-offline-replay-pipeline.md`
> 中"`repro` 生成**当场失败**测试、修复后转绿"的描述（该 ADP 第 46–48 行）。
> 本 ADP 只记录"生成的 repro 测试断言什么"这一个决策。

## Context

QA-0 最初设想：`repro` 把 `dom.html` + `Locator` 喂给 `resolve()`，断言"期望
定位结果"，得到一条**当场失败**的离线测试；agent 修复闭环即"读异常 → 跑失败
测试 → 修 → 转绿"。

实现时撞到一个硬约束：一条捕获的 bundle 含 `locator`、捕获时的 `resolve_result`、
以及标了 `data-loupe-target` 的 DOM 快照——但它**不含机器可判定的"正确目标"**。
手动标记的"resolved 却指错"异常只带自由文本 `expected` / `actual`，生成器无法从
中推断出"本应命中哪个元素 / 本应是什么 status"。要生成一条有意义的红测试，必须
由人/agent 先把修正后的期望编码进去——生成器自己做不到，只能产出 TODO 桩。

## Decision

**`repro` 生成一条绿色的保真回放守卫**：离线 `resolve(locator, 快照)` 必须复现
捕获时记录的 `resolve_result.locator_status`；当该 status 为 `resolved` 时，额外
断言离线命中的元素就是快照里 `data-loupe-target` 标记的目标。

- 它证明 **bundle 能离线确定性重放**——这正是 agent 修复前需要的地基。
- 它同时是一套**现成的离线 harness**：agent 修 locator/`resolve()` 时，直接在这条
  测试 + `locator-robustness` 套件上迭代；把"修正后的期望"由 agent 按案情手写进去。
- 当前**保持绿**。若某次改动让离线重放与捕获时分叉，这条守卫会变红，反而成为
  回归信号。

离线重放复用零依赖的 `packages/shared/src/offline-dom.ts`（FakeDOM + 快照 HTML
解析器），与 `locator-robustness` 套件同构、同一套 `resolve()`。

## Alternatives considered

- **红→绿修复闭环**（原 QA-0 设想）。否决：生成器无法从自由文本 `expected` 推断
  "正确目标"，只能产出无法真正编译/失败的 TODO 桩；把"什么是对的"交给生成器是
  错误的归属。改为：地基(确定性重放)由生成器保证，"对错判定"由 agent 在修复时编码。
- **红 + 绿都生成**（一文件含保真守卫 + 期望桩）。否决：生成器更复杂、产物更长，
  且期望桩仍无法自动判定，收益不抵成本。

## Consequences

- `repro` 产物是确定性重放 + 保真守卫，默认绿；不是开箱即用的失败用例。
- 取代 pipeline ADP 中"当场失败"的措辞与 QA-0 中对应验收项。
- 局限：快照是结构化的（无逐元素几何），靠几何消歧的捕获在离线可能与线上分叉；
  MVP 接受，必要时后续在快照中补几何。
- CLI：`loupe anomalies repro <id> [--out <path>]` 读 bundle → 生成自包含
  `*.repro.test.ts`（内联快照 + locator + 期望 status），落到
  `packages/shared/src/` 用同一测试运行器执行。

## Status

Accepted
