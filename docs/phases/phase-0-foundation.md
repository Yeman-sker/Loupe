# 阶段 0 · 基础契约：Schema / Daemon Health / 最小 MCP

> **对应里程碑：M0** ｜ 先把所有后续阶段都要依赖的“契约地基”钉死：权威 wire schema、project/session 隔离模型、可被匿名探活的 daemon，以及“可连接、强 scope、空库可读”的 project-scoped MCP。

## 阶段目标

- **三包骨架与职责边界成立。** `@loupe/server`、`@loupe/claude-plugin` 具备最小可连接骨架；`@loupe/extension` 可先保留 MV3 placeholder（manifest / package / 权限边界占位），不把真实扩展构建作为本阶段硬门槛；三包职责与 §0 总览一致。
- **权威 wire schema 冻结。** `Annotation` 持久化 envelope 以 snake_case 作为权威 storage 形态并携带 `schema_version`；迁移只按持久化 envelope 的 `schema_version` 判定、不靠字段猜测。`Locator`、`ResolveResult`、`AgentMark` 同样冻结为 snake_case wire 形态，但不强制各自携带 `schema_version`；domain 层即便包 camelCase adapter，也不得改变 wire 语义。
- **support matrix 所需字段先入契约。** `Locator` / `Annotation.target` / `AgentMark.target` 的 schema 预留并定义 support-matrix 字段：same-origin iframe 必须有 `frame_path`，Shadow DOM 使用 `shadow_path`，SVG/canvas/closed shadow/cross-origin iframe 等边界必须能表达“内部不可定位、只能标外壳”的状态，不把这些字段拖到阶段 4 才发现。
- **project/session 隔离模型确定。** 隔离单位是“project + branch + route 组合”而非单纯 URL route；`project_id`、`workspace_root_hash`、`branch`、`origin`、`route_key`、`session_id` 的语义与生成规则被钉死，并确立“同一 origin 可对应多个 project”的前提。
- **storage key 契约与 MCP scope 契约冻结。** 本地存储 key 必须携带 project scope（禁止全局 marks 或仅 route 维度 key）；MCP 侧确立一条可被后续强制执行的规则：读写必须带 project scope，缺 project 断言的 bare-id 跨项目 mutation 必须被拒绝（即使 id 是 UUID）。
- **daemon 可被匿名探活并自证身份。** daemon 在固定默认端口上提供匿名 `/health`，返回足以判定“这是不是 Loupe daemon”的非敏感状态，使后续“复用还是启动”的决策有可靠依据。
- **本地鉴权凭据就位且不泄露给页面。** daemon 持有本地 pairing token 与 status file；token 由 daemon/CLI 管理、不暴露给宿主页面脚本，status file 足以让插件/CLI 复用并诊断 daemon。
- **project-scoped MCP 骨架闭环。** scoped `list_marks` 可被连接调用并在空库下返回空数组；缺失 project scope 的 `list_marks` 必须显式失败为 `SCOPE_REQUIRED`，不能用“空数组”掩盖未隔离查询；`/mcp` 与 `/v1/marks*` 在无 token 时被拒绝，`/health` 保持匿名。
- **Claude 插件最小入口属于 Trust Core。** stdio MCP proxy 可连接 daemon，且不需要把 token 明文写进 `.mcp.json`；插件 `SessionStart` 以健康检查（而非进程名）判定 daemon 是否存在、必要时拉起；至少提供 `/loupe:marks` 命令文件与 `mark-resolver` agent 文件的最小可安装路径（若实现未接四工具，也必须显式走空命令/空库提示路径）。

## 验收标准

- Claude MCP proxy 可连接 daemon；无 token 访问 `/mcp`、`/v1/marks*` 均返回 401/失败；no-token origin matrix 覆盖 `Origin: null`、无 Origin、localhost 页面 origin、chrome-extension origin，且只有 `/health` 匿名可读。
- scoped `list_marks` 在空库下返回空数组；缺失 project scope 时返回 `SCOPE_REQUIRED`，不得返回混合结果，也不得把 unscoped 查询伪装成空库。
- `@loupe/server` 与 `@loupe/claude-plugin` 最小骨架可构建/可连接；`@loupe/extension` 允许仅有 MV3 placeholder，不作为本阶段硬构建 gate。
- 持久化 `Annotation`/storage envelope 携带 `schema_version`；`Locator`/`ResolveResult`/`AgentMark` wire 字段为 snake_case，但不要求各自携带 `schema_version`；support-matrix 字段（尤其 iframe `frame_path`）在 schema 中存在且语义明确。
- 本地 token 与 status file 按 §10.1 生成；token 不被宿主页面脚本读取。
- 插件 `SessionStart` 使用健康检查而非进程名判定 daemon；当默认端口（MVP 固定 7373）被非 Loupe 进程占用时，启动失败信息清晰；`/loupe:marks` 与 `mark-resolver` 的最小文件路径存在或空命令路径明确失败。

## 范围边界（本阶段不做，留待后续）

- 真实 locator 采集、`resolve()` 评分与 ambiguity downgrade → 阶段 1（本阶段只冻结 `Locator`/`ResolveResult` 的 schema 形态与 support-matrix 必需字段）。
- picker / composer / pin overlay 等扩展交互、host authorization CTA、`chrome.storage.local` 真实写入 → 阶段 2。
- marks 真实持久化、`get_mark`/`resolve_mark`/`delete_mark` 全量工具，以及 project scope 的**强制执行**（`MULTI_PROJECT`、assertion 匹配、tombstone 防复活）与隔离 KPI 判定 → 阶段 3。本阶段 MCP 仅为“可连接、强 scope、空库可读”的骨架，且**不**声明 Project-isolation KPI 达成（无 mutation 路径，该 KPI 的判定属阶段 3）。

## 依赖

- 无（项目起点）。
- 后续所有阶段都依赖此处冻结的权威 wire schema 与 project/session scope 契约。

## 对应 PRD 章节

- §0、§4.1、§5、§6、§8、§10.1–10.2、§11.1–11.3、§12.2、§14（M0）
