# 阶段 QA-0 · 异常采集与离线可重放管线（MVP 骨架）

> **关联 ADP：** `adp-20260606-anomaly-capture-offline-replay-pipeline.md`
> 真实测试阶段的支撑能力：在使用扩展时捕获"不合理的异常"，落成 Agent 可
> 确定性重放的离线 fixture。本阶段只做端到端**闭环骨架**，复用 daemon /
> auth / 存储 / MCP，不追求 polish。

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
- **CLI 可浏览异常。** `loupe anomalies list` / `loupe anomalies show <id>`。
- **`repro` 生成失败测试。** 由 bundle 生成一条 `*.repro.test.ts`，喂
  `dom.html` + `Locator` 给 `resolve()`，断言期望定位结果，wire 进
  `locator-robustness` 离线套件且**当场失败**。
- **Agent 经 MCP 读取。** `list_anomalies` / `get_anomaly` 返回复现配方
  （测试路径、fixture 路径、expected vs actual、stack、面包屑），沿用与
  `list_marks` 相同的 project scope 与 token 约束。

## 验收标准

- 三种入口各能产出一条 anomaly：构造一个未捕获异常、触发一条契约断言、
  手动按热键标记一次，均生成 `~/.loupe/anomalies/<id>/` bundle。
- 无 token 访问 `POST /v1/anomalies` 返回 401；有 token 写入成功；DOM 快照与
  存储切片仅落本地。
- 对一条手动标记的"resolved 却指错"样本：`repro` 生成的测试在当前代码下
  **失败**；当定位被修正后该测试**转绿**（闭环可验证）。
- `loupe anomalies list/show` 能列出并展示上述 bundle 的关键字段。
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
