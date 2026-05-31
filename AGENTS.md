# AGENTS.md

## docs/ 文档规则

`docs/` 只写 ADP 文档；不要在 `docs/` 中新增普通说明、会议记录、临时分析、教程、草稿或实现笔记。

自动提出并编写 ADP 时，必须同时满足以下三条：

1. **Hard to reverse** — 以后改主意的成本有实际意义。
2. **Surprising without context** — 未来读者如果没有背景，会问“为什么要这样做？”
3. **The result of a real trade-off** — 存在真实可选方案，并且我们基于具体理由选择了其中一个。

不满足三条时，不写 ADP；把上下文留在代码、PRD、issue、commit message 或当前任务说明中。

### ADP 文件要求

- 文件名：`docs/adp-YYYYMMDD-short-kebab-title.md`
- 一个 ADP 只记录一个决策。
- 内容必须包含：
  - Context
  - Decision
  - Alternatives considered
  - Consequences
  - Status
- Status 只能是：`Proposed`、`Accepted`、`Superseded`。
- 不要为默认配置、微小实现细节、易回滚改动、纯执行计划写 ADP。

## 项目协作规则

- 当前核心产品文档是 `PRD.md`。
- `opensource/` 是参考开源项目归档目录，已被 `.gitignore` 忽略；不要修改其中内容作为项目交付。
- 修改 PRD 或 ADP 时，优先保持决策可追溯、边界明确、术语一致。
- 不要新增无请求的文档；需要沉淀决策时按上面的 ADP 条件判断。
