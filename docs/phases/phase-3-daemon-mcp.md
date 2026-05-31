# 阶段 3 · Daemon 持久化与 project-scoped MCP

> **对应里程碑：M3** ｜ 让 Agent 能在严格 project 隔离下读/取/完成/删除 mark：authenticated `/v1/marks*`、可信的 `marks.json` 镜像、四个 MCP 工具与低噪声 `AgentMark`。

## 阶段目标

- **写入接口默认安全。** `/v1/marks*` 的读/写/删全部要求有效 token 才能获得能力；页面 origin、`null` origin、扩展 origin 在无 token 时都无写入口，CORS 仅决定能否发起请求、不替代鉴权。
- **磁盘镜像可信、可自愈。** `~/.loupe/marks.json` 的写入对并发安全，且单次损坏不会丢失或污染既有数据；启动遇到损坏时能安全恢复并对外暴露 warning。
- **四个 MCP 工具可用且 payload 低噪声。** `get_mark` 返回低噪声 `AgentMark`；`list_marks` 返回 scoped 列表/候选 scope，`resolve_mark` 返回完成后的状态结果，`delete_mark` 返回删除/tombstone 结果。所有工具都不得泄露 raw 内部字段、全量样式、token、错误栈或截图字节。
- **project scope 被强制执行。** `list_marks` 命中多个 project 时返回候选 scope 而非混读；`get_mark`/`resolve_mark`/`delete_mark` 必须带 id + project 断言且与目标 project/session 匹配；缺断言的 bare-id 跨项目 mutation 一律被拒绝（即使 id 是 UUID）。
- **删除语义清晰分离。** `resolve_mark` 是完成任务的默认路径（置 `task_status=resolved`）；`delete_mark` 仅代表用户明确删除并写 tombstone，不代表完成。
- **扩展 → daemon 的同步在 happy path 打通。** daemon online 时，扩展能完成本地 daemon 探测、extension pairing/proxy/daemon ensure 与 token 校验；本地保存的 mark 能被鉴权同步进镜像，从而进入 MCP 可读状态（`sync.status` 由 `local_only` 推进到 `synced`）。
- **Agent mutation 会回写浏览器本地真相源。** `resolve_mark`/`delete_mark` 经 MCP 修改 daemon 镜像后，daemon 必须通知或供扩展拉取 reconciliation，使 `chrome.storage.local`、pin 状态与 View all 列表同步更新；浏览器本地真相源不得长期停留在 stale open/pin 状态。

## 验收标准

- Agent scoped 的 read/get/resolve/delete 契约全部通过；`get_mark` 返回 `AgentMark`，`list_marks`/`resolve_mark`/`delete_mark` 返回 PRD 定义的对应输出；同一 origin 下多个 project 不混读；命中多 project 时返回候选 scope。
- 缺 project 断言的 bare-id 跨项目 mutation 被拒绝；断言与目标 project/session 不匹配或不唯一时拒绝执行。
- 无 token 访问 `/v1/marks*` 与 `/mcp` 被拒绝；`/health` 匿名可读；最小 contract/security gate 在本阶段覆盖 tool schema、project scope、鉴权与 mutation 拒绝路径。
- `marks.json` 损坏时启动可安全恢复并对外暴露 warning。
- daemon online 且已完成 pairing/ensure 时，“扩展保存 mark → daemon 镜像 → MCP 可读”happy path 成立；`resolve_mark`/`delete_mark` 后浏览器本地状态与 pin/View all 完成 reconciliation。
- KPI（本阶段**首次达成并判定**）：Project isolation violations（跨项目混读/误 mutation）= 0；daemon online 时“保存 mark → Agent 可读”的 Save-to-Agent readable P95 < 2s。

## 范围边界（本阶段不做，留待后续）

- 同步韧性（retry/backoff、offline fallback、service worker 唤醒补同步、`delete_pending` 重试）→ 阶段 4。
- Playwright MV3 E2E 与跨浏览器集成回归 → 阶段 4（本阶段已拥有最小 contract/security gates，阶段 4 负责集成回归守护）。

## 依赖

- 阶段 0：MCP scope 契约、本地 token/status 文件、`marks.json` 的 schema 与 project/session 结构。
- 阶段 2：扩展已能拾取并在本地保存 mark，以供同步。

## 对应 PRD 章节

- §2（原则 2/3）、§5.3、§8.3、§10.3、§11.1、§12.1–12.2、§14（M3）
