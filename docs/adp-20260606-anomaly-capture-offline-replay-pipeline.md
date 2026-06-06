# ADP: 异常采集产出"离线可重放 fixture"，复用 daemon，并经 MCP 暴露给 Agent

## Context

Loupe 进入真实测试阶段，需要一个本地工具：在使用扩展时捕获"不合理的异常"，
详细记录细节，使 Claude Code / Codex 等 Agent 能**复现**该错误，从而便于修复。

这个产品的 bug 形态有强领域特性：绝大多数异常本质是"在某个具体 DOM 上
**定位 / 漂移判断不正确**"。而 `@loupe/shared` 中的 `resolve(locator, root)`
已是一个**纯函数**——给定 locator bundle 与一棵 DOM 树，输出 `ResolveResult`
是确定的。项目同时已有两套重放基础设施：

- `packages/shared/src/locator-robustness.test.ts`：离线 fixture 套件。
- `packages/e2e/`：Playwright 真实 MV3 套件。

同时已有的本地基础设施可被复用，而不必为采集工具重造：daemon 监听
`127.0.0.1:7373`、Bearer token auth、atomic JSON write、`~/.loupe/` 文件区、
CLI、MCP-over-HTTP + stdio proxy、以及 `mark-resolver` 这一"Agent 读取 →
改代码 → 调用 MCP 收尾"的既有协作范式。

需要决定的是：异常工具应作为**独立崩溃收集器**存在，产出**带 stack 的报告**，
还是嵌入现有架构、产出**可确定性重放的测试 fixture**。

## Decision

1. **不新建独立进程；扩展现有 daemon + extension 一条采集管线。**
   - 扩展内新增轻量采集 SDK：操作面包屑 ring buffer + 全局错误钩子
     (`onerror` / `unhandledrejection`) + **手动标记热键** + 契约不变量断言。
   - 命中异常时快照：目标子树 / 页面 DOM、`Locator`、`ResolveResult`、
     project-scoped 存储切片、面包屑、env（chrome 版本 / viewport / dpr / url）。
   - 经**已鉴权**的 `POST /v1/anomalies` 上报（复用 mark 的 token auth，
     不新开无 token 写入口）。
   - daemon 复用 atomic write，将每条异常写入 `~/.loupe/anomalies/<id>/`。

2. **每条异常的权威产物是"离线可重放 fixture"，而非崩溃报告。**
   bundle 结构：

   ```text
   ~/.loupe/anomalies/<id>/
     report.json   # env + breadcrumbs + error + locator + resolve_result + expected/actual
     dom.html      # 目标子树 / 整页 DOM 快照（fixture 种子）
     storage.json  # project-scoped 存储切片 + sync 状态
     repro.test.ts # 生成的失败测试，wire 进 locator-robustness 离线套件
   ```

   `repro` 生成器把 `dom.html` + `Locator` 喂给 `resolve()`，断言"期望
   定位结果"（来自手动标记或采集到的不变量），从而得到一条**当场失败**的
   离线测试。Agent 的修复闭环即：读异常 → 跑失败测试 → 修 → 测试转绿。
   这正是 CLAUDE.md "先写复现测试再修" 的落地。

3. **采集三层异常，且手动标记不可省。**
   - 硬错误（自动）：未捕获异常 / promise rejection / daemon 5xx / sync / MCP 失败。
   - 契约不变量断言：schema 非法、缺 project scope、bare-id mutation、
     token 泄漏到 page —— 命中即上报。
   - **手动标记热键**：`resolved` 却指错、该 drifted 没 drifted、pin 错位、
     picker 选错、stale route commit 等"产品级不合理"。代码自身无法判定
     这类异常是否发生，必须由人按热键标记，并附"期望行为"。

4. **Agent 入口走 MCP，与 mark 一致。**
   新增 `list_anomalies` / `get_anomaly` 工具；`get_anomaly` 返回复现配方
   （要跑哪条测试、fixture 路径、expected vs actual、stack、面包屑）。
   保持与 `list_marks` 同样的 project scope 与 token 约束。

## Alternatives considered

- **独立崩溃收集器（如内嵌 Sentry-like 进程）。** 否决：会重造 auth /
  传输 / 存储 / Agent 接口，且只能产出 stack，无法利用 `resolve()` 纯函数
  的确定性重放，反而丢掉本产品最大的复现优势。

- **Live e2e 重放优先**（Playwright 还原页面状态 + 重放操作时序）。否决为
  默认形态：依赖能还原页面状态、flaky、重。离线 fixture 更可靠且契合既有
  robustness 套件；bundle 仍保留足够信息供需要时手动 live 复现。

- **只采集硬错误（不做手动标记）。** 否决：用户明确指出核心是"不合理的
  异常"，这类产品级误判代码无法自检，没有手动标记就抓不到最有价值的样本。

- **仅文件 + CLI，让 Agent 自己 grep `~/.loupe/anomalies`。** 否决为默认：
  与产品既有 MCP / agent 范式不一致，Agent 体验割裂；MCP 工具增量很小。

## Consequences

- 异常工具与 mark 系统共享 daemon、auth、存储、MCP，新增面小、安全姿态一致
  （loopback + token，无无鉴权写入口；DOM 快照仅落本地 `~/.loupe/`）。
- 每条被修复的异常沉淀为永久 regression fixture，robustness 套件随真实使用
  持续增长，直接服务 §13.1 / §15 的 locator KPI。
- 代价：扩展需要可靠的 DOM 序列化与"快照即 fixture"的保真度（Shadow DOM /
  same-origin iframe 子树需正确序列化，否则离线重放与线上不一致）。这是本
  管线最主要的实现风险点。
- DOM 快照可能较大且含被测页面内容；以"目标子树优先、整页可选"控制体积，
  全部仅本地存储。
- `report.json` 成为新的 wire 契约面，需与现有 snake_case / 低噪声约定一致。

## Status

Proposed
