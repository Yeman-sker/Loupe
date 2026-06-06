# 阶段 QA-0 · 异常采集与离线可重放管线（MVP 骨架）

> **关联 ADP：** `adp-20260606-anomaly-capture-offline-replay-pipeline.md`（管线）、
> `adp-20260606-anomaly-capture-dev-build-only.md`（dev/prod 隔离）、
> `adp-20260606-anomaly-repro-fidelity-replay-guard.md`（repro 改为保真守卫(绿)）。
> 真实测试阶段的支撑能力：在使用扩展时捕获"不合理的异常"，落成 Agent 可
> 确定性重放的离线 fixture。本阶段只做端到端**闭环骨架**，复用 daemon /
> auth / 存储 / MCP，不追求 polish。
>
> **隔离约束：** 采集只进 dev 构建（`build:dev` + `manifest.dev.json` +
> `content.dev.js`），产品构建零 anomaly 代码；app.ts 仅留惰性 instrumentation
> 接缝。已落地并经 e2e 验证。

## 阶段目标

- **扩展内采集 SDK 成立。** 操作面包屑 ring buffer + 全局错误钩子
  (`onerror` / `unhandledrejection`) + 手动标记热键 + 契约不变量断言四个入口
  都能产出统一的 anomaly 事件。
- **三层异常可被捕获。** 硬错误（自动）、契约不变量违例（命中即上报）、
  手动标记的产品级"不合理"行为（附用户填写的期望行为）。
- **快照足以离线重放。** 命中时采集目标子树 / 页面 DOM、`Locator`、
  `ResolveResult`、project-scoped 存储切片、面包屑、env；Shadow DOM /
  same-origin iframe 子树序列化保真，保证离线 `resolve()` 与线上一致。
- **上报复用既有鉴权通道。** `POST /v1/anomalies` 要求 Bearer token；无 token
  被拒；不新增任何无鉴权写入口；token 不暴露给宿主页面脚本。
- **daemon 持久化每条异常 bundle。** atomic 写入
  `~/.loupe/anomalies/<id>/{report.json, dom.html, storage.json}`；损坏 / 超大
  有界处理，与 marks.json 一致的写入安全姿态。
- **Agent 可浏览异常。** 经 MCP `list_anomalies` / `get_anomaly`，以及
  `/loupe:anomalies` 命令；CLI `list` / `show` 暂未实现（按需再加）。
- **`repro` 生成保真回放守卫。** `loupe anomalies repro <id>` 由 bundle 生成一条
  自包含 `*.repro.test.ts`，离线把 `dom.html` + `Locator` 喂给 `resolve()`，断言
  复现捕获时的 `resolve_result`（status，resolved 时含 `data-loupe-target` 命中）；
  与 `locator-robustness` 同构、默认**绿**。见 `adp-...-fidelity-replay-guard.md`。
- **Agent 经 MCP 读取。** `list_anomalies` / `get_anomaly` 返回复现配方
  （测试路径、fixture 路径、expected vs actual、stack、面包屑），沿用与
  `list_marks` 相同的 project scope 与 token 约束。

## 验收标准

- 三种入口各能产出一条 anomaly：构造一个未捕获异常、触发一条契约断言、
  手动按热键标记一次，均生成 `~/.loupe/anomalies/<id>/` bundle。
- 无 token 访问 `POST /v1/anomalies` 返回 401；有 token 写入成功；DOM 快照与
  存储切片仅落本地。
- 对一条捕获的 bundle：`loupe anomalies repro <id>` 生成的 `*.repro.test.ts` 当前
  **通过**——离线 `resolve()` 复现捕获时的 `resolve_result`（确定性重放守卫）；
  agent 修复时在此 harness 上编码修正后的期望。
- `list_anomalies` 能列出 bundle 的关键字段（id/source/summary/locator_status/
  has_dom/created_at）。
- `get_anomaly` 经 MCP 返回复现配方，scope / token 约束与 `get_mark` 一致；
  缺 project scope 的访问按既有规则被拒。
- Shadow DOM / same-origin iframe 子树快照重放时，离线 `resolve()` 结果与采集
  时记录的 `ResolveResult` 一致（保真度回归）。

## 范围边界（本阶段不做）

- 截图 / 录屏 / 媒体捕获。
- Live e2e 自动重放（Playwright 还原页面状态 + 重放操作时序）→ 仅保留 bundle
  中足够信息供手动 live 复现，自动化留待后续。
- 异常去重 / 分组 / 频次聚合 / 趋势面板。
- 自动语义检测启发式（自动判断"指错了"）；本阶段产品级异常仅靠手动标记。
- `resolve_anomaly` / `delete_anomaly` 等生命周期 mutation 工具（先只读）。

## 依赖

- 阶段 0：daemon `/health`、token / status file、`/v1/*` 鉴权中间件、MCP 骨架。
- 阶段 1：`Locator` / `ResolveResult` wire schema 与 `resolve()`；
  `locator-robustness` 离线套件作为 `repro` 测试的落点。
- 阶段 2：扩展 picker / 存储 / 运行时，作为采集 SDK 的挂载点。

## 对应 PRD 章节

- §6（系统架构 / 复用 daemon）、§7（`resolve` 与 locator 重放）、§10.3（auth）、
  §11.1（MCP 工具风格）、§13.1 / §13.4（robustness 与 contract 测试）、
  §15（locator KPI 数据来源）。
