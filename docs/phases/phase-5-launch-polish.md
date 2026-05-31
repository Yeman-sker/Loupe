# 阶段 5 · Launch Polish 与 Marketplace

> **对应里程碑：M5** ｜ Trust Core 稳定后做发布与体验打磨：官方 marketplace 一键安装、完整 onboarding 分支、视觉/CLI 打磨——让用户能装好并完成第一条 mark。

## 阶段目标

- **插件可从官方 marketplace 被发现并一键安装。** 以官方 marketplace 形态发布并通过官方 schema 校验，用户无需手工配置即可安装 Loupe 插件。
- **首次使用在每种环境下都有明确的下一步与错误恢复。** 针对“已装 Claude 插件 / 通用 MCP client / 无 MCP / host 未授权 / daemon 离线”各自给出清晰引导与兜底（无 MCP 时突出 Copy Markdown，host 未授权时提供授权入口，daemon 离线时仍可本地保存）。
- **视觉与体验达到发布级别，且不动摇 Trust Core 正确性。** 主题、动效、更完整的工具栏与 pin detail 完成打磨，动效尊重 `prefers-reduced-motion`，pin 状态仍不只靠颜色；这些打磨不进入也不破坏定位/隔离/漂移恢复/同步韧性的正确性路径。
- **CLI 支撑安装与运行期自助诊断。** `init`、`status`、`logs` 覆盖首次安装、运行状态与排障；token 缺失、端口占用、marks 存储损坏 warning 都有明确诊断与下一步。

## 验收标准

- marketplace 清单通过官方 schema 校验。
- 在 clean machine 上，用户可从 marketplace 安装并成功运行 `/loupe:marks`，走通“拾取 → 写意图 → 保存 → Agent 读取”的首个 mark 闭环。
- onboarding 覆盖 PRD §9.6 全部分支并通过：
  - Claude plugin detected：显示“按 ⌥L 标记元素，然后在 Claude 中运行 `/loupe:marks`”。
  - Generic MCP client：显示 daemon `/mcp` URL 与 Authorization 配置提示。
  - No MCP：强调 Copy Markdown fallback，且不阻塞标注。
  - Host not authorized：解释当前 host 未授权，提供 `chrome.permissions.request` 授权入口；未授权前不注入 picker。
  - Daemon offline：显示 `loupe init` / 插件自动启动状态；mark 仍可 local-only 保存。
- CLI diagnostics 全部通过：`loupe init` 能完成初始化并给出下一步；`loupe status` 能显示 daemon/extension/token/store 状态；`loupe logs` 能定位最近错误；token missing、port occupied、corrupted marks warning 均有清晰错误、非零/告警语义与修复指引。
- KPI（§15.2）：TTFM < 5min；单条 `AgentMark` JSON 中位数（不含截图）< 1KB；marketplace install success ≥ 95%。

## 范围边界（本阶段不做，留待后续）

- PRD §4.4 后续路线，均不属于本阶段：
  - **Roadmap Phase 2 · 更强 Agent 工作流：** lazy screenshot、`watch_marks`、discussion replies、generic client config helper。
  - **Roadmap Phase 3 · 页面内设计工作流：** `pending_changes`、design token 映射、preview/undo。
  - **Roadmap Phase 4 · 团队化：** cloud sync、字段级 merge、审计、共享 mark。

## 依赖

- 阶段 0–4 已完成且 Trust Core 稳定（信任闭环、project/session 隔离、漂移恢复与同步韧性均已通过测试）。

## 对应 PRD 章节

- §4.2、§9.6、§9.7、§11.5、§14（M5）、§15.2
