# Loupe

> 在本地开发页面上精确「钉选（pin）」一个真实 DOM 元素并写下意图，让 AI 编码 Agent 通过 MCP 精确读取该元素的定位与上下文。

Loupe 把「我在浏览器里指的这个元素」转换成 Agent 可执行、可复核、可完成的结构化任务，消除「切回编辑器 → 描述『右上角那个蓝色按钮』→ Agent 猜组件」这段有损翻译。

它服务一条信任闭环：

```text
pick（指一下真实 DOM） → robust locate/recover（稳定定位 + 漂移恢复）
→ persist/sync（本地优先存储 + daemon 镜像） → low-noise Agent read（MCP 读取）
→ resolve（Agent 完成后关闭任务）
```

完整产品定义见 [`PRD.md`](./PRD.md)。本文件只讲**如何使用**。

---

## 目录

- [组件总览](#组件总览)
- [环境要求](#环境要求)
- [安装](#安装)
- [快速开始（Golden Path）](#快速开始golden-path)
- [CLI 参考（`@loupe-server/server`）](#cli-参考loupe-serverserver)
- [接入 Agent / MCP](#接入-agent--mcp)
- [键盘操作](#键盘操作)
- [本地文件与端口](#本地文件与端口)
- [安全模型](#安全模型)
- [项目结构与脚本](#项目结构与脚本)
- [当前范围](#当前范围)

---

## 组件总览

Loupe 是一个 pnpm monorepo，包含四个交付组件 + 一个共享包：

| 组件 | 包名 | 职责 |
| ---- | ---- | ---- |
| 浏览器扩展 | `@loupe/extension` | Chrome MV3。picker、composer、locator/context 采集、minimal pin overlay、`chrome.storage.local` 本地优先存储 |
| 本地 daemon | `@loupe-server/server` | 监听 `127.0.0.1:7373`，暴露 `/health`、authenticated `/v1/marks*` 与 `/mcp`，维护 `~/.loupe/marks.json` 镜像。同时提供 `loupe` CLI 与 stdio `mcp-proxy` |
| Claude 插件 | `loupe@loupe-server` Claude/OMP marketplace plugin | 启动 daemon（SessionStart hook）、配置 stdio MCP proxy、`/loupe:marks` 命令与 `mark-resolver` agent |
| Codex 插件 | `loupe` Codex marketplace plugin | 启动 daemon（SessionStart hook）、配置 stdio MCP proxy、提供 `loupe-marks` skill |
| 共享 schema/逻辑 | `@loupe-server/shared` | snake_case wire schema、`resolve()` locator 评分、route-recovery 状态机 |

数据流：

```text
Chrome 扩展 ──(本地优先写 chrome.storage.local)──┐
   │                                              │ best-effort + Bearer token
   └──────────────── POST /v1/marks ──────────────▶  本地 daemon (127.0.0.1:7373)
                                                       │  ~/.loupe/marks.json (atomic 镜像)
                                                       │
Agent / Claude / Codex ──(stdio MCP proxy 注入 token)──▶ POST /mcp ──┘
   list_marks / get_mark / resolve_mark / delete_mark
```

---

## 环境要求

- **Node.js ≥ 20.6**（推荐 22；用到 `node --import` 与内置 test runner）
- **pnpm 9.15.4**（仓库已用 `packageManager` 锁定）
- **Chrome / Chromium**（MV3，加载 unpacked extension）

---

## 安装

```bash
pnpm install          # 安装全部 workspace 依赖
pnpm check            # 递归 typecheck（tsc）所有包
pnpm test             # 递归运行各包的 node --test 套件
```

> 说明：`@loupe-server/server` 与 `@loupe-server/shared` 发布时会编译到 `dist/`；`@loupe/extension` 直接以 TypeScript 源码 + `tsx` loader 做类型检查/测试；Claude/OMP 与 Codex 插件都是轻量 marketplace 元数据（skills/commands/agents/hooks/MCP 配置），不再单独发布 npm 包。扩展的运行时脚本 `src/content.js` / `src/background.js` 是直接被 Chrome 加载的手写 MV3 脚本，同名 `.ts` 文件用于类型检查与测试。

---

## 快速开始（Golden Path）

### 1. 启动本地 daemon

daemon 固定使用默认端口 **7373**。三种启动方式任选其一：

**A. 本地源码运行（开发推荐）**

```bash
# 初始化 ~/.loupe（生成 token / server.json），并打印下一步提示
node --import tsx packages/server/src/cli.ts init

# 启动 daemon（前台）
node --import tsx packages/server/src/cli.ts serve --port 7373

# 随时查看健康状态 / token / marks 数量
node --import tsx packages/server/src/cli.ts status
```

**B. 已发布包（`@loupe-server/server` 提供 `loupe` / `loupe-server` 两个 bin）**

```bash
npx -y @loupe-server/server ensure --port 7373   # 没在跑就拉起，已在跑就复用
npx -y @loupe-server/server status
```

**C. 交给 Claude 插件自动拉起** —— 插件的 `SessionStart` hook 会执行 `@loupe-server/server ensure --port 7373`（见 [`packages/claude-plugin/hooks/hooks.json`](./packages/claude-plugin/hooks/hooks.json)），无需手动启动。

安装 Claude Code / OMP plugin marketplace 后可自动完成 C：

```text
/plugin marketplace add <owner>/<repo>      # Claude Code
/plugin install loupe@loupe-server

/marketplace add <owner>/<repo>             # OMP
/marketplace install loupe@loupe-server
```

Codex 使用独立的原生插件元数据：

```bash
codex plugin marketplace add <owner>/<repo>
```

然后在 Codex 的 `/plugins` 界面安装 `loupe`。

本仓库 Claude/OMP marketplace 入口为 [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json)，Claude/OMP 插件定义位于 [`packages/claude-plugin/.claude-plugin/plugin.json`](./packages/claude-plugin/.claude-plugin/plugin.json)。Codex marketplace 入口为 [`.agents/plugins/marketplace.json`](./.agents/plugins/marketplace.json)，Codex 插件定义位于 [`packages/codex-plugin/.codex-plugin/plugin.json`](./packages/codex-plugin/.codex-plugin/plugin.json)。

> `ensure` 先打 `GET /health`：是 Loupe daemon 就复用，端口被非 Loupe 进程占用则**明确报错**（MVP 不做动态端口发现）。

### 2. 加载浏览器扩展

1. 打开 `chrome://extensions`，启用右上角 **开发者模式 / Developer mode**。
2. 点击 **加载已解压的扩展程序 / Load unpacked**。
3. 选择 [`packages/extension`](./packages/extension) 目录（含 `manifest.json`）。

### 3. 授权当前 host

扩展默认不持有任何 host 权限（`manifest.json` 里 `host_permissions: []`，仅声明 `optional_host_permissions`）。在目标页面（如 `http://127.0.0.1:4172`）点击 Chrome 工具栏里的 **Loupe** 扩展图标，会打开一个小弹窗；点击弹窗里的 **Authorize current site**，Chrome 会弹出 `chrome.permissions.request` 授权当前 origin；同意后扩展会自动刷新当前 tab，刷新后才会注入 picker。**授权前不会显示 Loupe 面板，也不会响应 ⌥L。**

### 4. 钉选元素并写意图

1. 在已授权页面按 **⌥L（Alt+L）** 进入拾取模式。
2. 鼠标 hover 或键盘选择目标：`Tab` 遍历候选，`↑` 选父级、`↓` 回子级，`Enter` 确认。
3. composer 自动聚焦，填写 `intent.comment`（必填），按 **⌘/Ctrl + Enter** 保存。
4. mark 立即写入 project-scoped `chrome.storage.local`（local-first），pin 显示任务/定位/同步状态；daemon 在线且已配对 token 时 best-effort 同步到 `~/.loupe/marks.json`。

> daemon 离线也能保存（`sync.status = local_only`）；恢复后补同步，并始终提供 **Copy Markdown** 兜底。

### 5. Agent 读取并完成

在 Claude 中运行 `/loupe:marks` 列出当前 project/session 的 open marks；或交给 `mark-resolver` agent：它会 `get_mark`（带 project scope）→ 按 `intent` 与 locator/context 改代码并验证 → 调用 **`resolve_mark`** 关闭任务，浏览器 pin 随之进入 resolved。

---

## CLI 参考（`@loupe-server/server`）

```text
loupe serve  [--port <n>] [--home <path>]   # 启动 daemon（前台）
loupe ensure [--port <n>] [--home <path>]   # /health 探测：缺失则启动，已在跑则复用
loupe init   [--port <n>] [--home <path>]   # 创建 ~/.loupe、token、server.json，打印下一步
loupe status [--port <n>] [--home <path>]   # 报告 daemon / token / server.json / marks 状态
loupe logs   [--home <path>]                # 打印 server.log 末尾（优先 error/warning 行）
```

- `--port` 默认 `7373`；`--home` 默认 `~/.loupe`。
- 退出码：`0` 正常 · `1` 出错（含修复建议）· `2` 有 warning（如端口被占、`server.json` 缺失、`marks.json` 损坏）。
- 本地源码运行时把 `loupe` 换成 `node --import tsx packages/server/src/cli.ts`，例如 `node --import tsx packages/server/src/cli.ts logs`。

---

## 接入 Agent / MCP

### Claude / OMP（stdio proxy 注入 token）

插件采用 **stdio MCP proxy**：proxy 读取 `~/.loupe/token`（或 `~/.loupe/server.json` 里的 `token_path`）并转发到 daemon `/mcp`，因此 `.mcp.json` 里**不出现明文 token**。

```json
{
  "mcpServers": {
    "loupe": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@loupe-server/server", "mcp-proxy", "--url", "http://127.0.0.1:7373/mcp"],
      "timeout": 5000
    }
  }
}
```

Claude/OMP 插件同时提供：

- `/loupe:marks` 命令 —— 列出当前 project/session 的 open marks（[`commands/marks.md`](./packages/claude-plugin/commands/marks.md)）。
- `mark-resolver` agent —— 读取 → 改代码并验证 → `resolve_mark`（[`agents/mark-resolver.md`](./packages/claude-plugin/agents/mark-resolver.md)）。
- `SessionStart` hook —— 自动 `ensure` daemon（[`hooks/hooks.json`](./packages/claude-plugin/hooks/hooks.json)）。

### Codex（原生 plugin metadata）

Codex 插件定义位于 [`packages/codex-plugin`](./packages/codex-plugin)：

- `.codex-plugin/plugin.json` —— 指向 `skills`、`.mcp.json` 与 `hooks/hooks.json`。
- `.mcp.json` —— 通过 `npx -y @loupe-server/server mcp-proxy` 接入 Loupe MCP。
- `hooks/hooks.json` —— SessionStart 自动 `ensure` daemon；Codex 会要求用户 review/trust plugin-bundled hooks。
- `skills/loupe-marks/SKILL.md` —— instruct Codex 如何 list/get/resolve Loupe marks。

### 通用 MCP 客户端（直连 HTTP）

```json
{
  "type": "http",
  "url": "http://127.0.0.1:7373/mcp",
  "headers": { "Authorization": "Bearer ${LOUPE_TOKEN}" }
}
```

`LOUPE_TOKEN` 取自 `~/.loupe/token`。`/mcp` 走 JSON-RPC 2.0，支持 `tools/list` 与 `tools/call`。

### MCP 工具

| 工具 | 必需入参 | 语义 |
| ---- | -------- | ---- |
| `list_marks` | `project_id`，或 `url`/`route_key`/`workspace_root_hash`/`origin` 之一（可选 `task_status`） | 默认只列该 scope 下的 marks，**不跨项目混合** |
| `get_mark` | `id` + project 断言（`project_id`，或 `url`+`route_key`） | 返回低噪声 `AgentMark` |
| `resolve_mark` | `id` + project 断言（可选 `resolution_note`） | **完成任务的默认路径**，置 `task_status=resolved` |
| `delete_mark` | `id` + project 断言（可选 `reason`） | 仅用于用户**明确删除**，写 tombstone，**不代表完成** |

scope 约束（信任与隔离边界）：

- `list_marks` 不带任何 scope → 返回 **`SCOPE_REQUIRED`**。
- scope 命中多个项目 → 返回 **`MULTI_PROJECT`** 与候选列表，**不**返回混合结果。
- 任何 id mutation（get/resolve/delete）都必须带 project 断言并与 mark 匹配；缺断言或不唯一即拒绝（即使 id 是 UUID）。

---

## 键盘操作

| 场景 | 按键 | 行为 |
| ---- | ---- | ---- |
| 任意已授权页面 | `⌥L` (Alt+L) | 进入 / 退出拾取模式 |
| 拾取中 | `Tab` / `Shift+Tab` | 在候选元素间遍历 |
| 拾取中 | `↑` / `↓` | 选父级 / 回子级（micro-adjust） |
| 拾取中 | `Enter` | 确认当前 target，打开 composer |
| 拾取中 | `Esc` | 退出并恢复进入前的 focus |
| composer | `⌘/Ctrl + Enter` | 保存 mark |
| composer | `Esc` | 取消 |

---

## 本地文件与端口

daemon 在 `~/.loupe/`（可用 `--home` 覆盖）维护：

| 文件 | 说明 |
| ---- | ---- |
| `~/.loupe/token` | pairing token（`0600`，32+ bytes base64url） |
| `~/.loupe/server.json` | `{ pid, port, token_path, started_at }` |
| `~/.loupe/marks.json` | marks 的 atomic JSON 镜像；损坏时备份为 `.corrupted.<ts>` 并重建空 store |
| `~/.loupe/server.log` | daemon 日志（`loupe logs` 读取） |

端口固定 `7373`（`--port` 可改）。

---

## 安全模型

- **Loopback + token**：`/v1/marks*` 与 `/mcp` 必须带 `Authorization: Bearer <token>`；无 token 返回 `401`。`/health` 匿名，只返回非敏感状态。
- **页面脚本无写入口**：token 不暴露给宿主页面；扩展 MAIN world 只做一次性、nonce-gated 的**只读**框架检测，Agent 的读写只走 authenticated daemon。
- **project/session 隔离是安全边界**：同一 origin 可对应多个 `project_id`，所以 MCP 不靠 URL 判断项目，bare-id 跨项目 mutation 一律拒绝。

---

## 项目结构与脚本

```text
.
├── packages/
│   ├── extension/        # Chrome MV3 扩展（content.js / background.js 运行时脚本）
│   ├── server/           # 本地 daemon + loupe CLI + stdio MCP proxy
│   ├── claude-plugin/    # Claude/OMP marketplace plugin: commands / agents / hooks / MCP config
│   ├── codex-plugin/     # Codex marketplace plugin: skill / hooks / MCP config
│   └── shared/           # wire schema + resolve() + route-recovery
├── docs/                 # ADP 与 phase 文档（规则见 AGENTS.md）
├── PRD.md                # 产品需求文档（权威定义）
└── pnpm-workspace.yaml
```

每个包统一脚本：

| 脚本 | 命令 | 说明 |
| ---- | ---- | ---- |
| `check` | `tsc -p tsconfig.json` | 类型检查（扩展/shared/server 为 `noEmit`） |
| `test` | `node --import tsx --test src/*.test.ts` | 单元 / 契约测试 |
| `build` | `tsc -p tsconfig.build.json` / `tsc` | shared/server 编译到 `dist/`；Claude 插件编译 proxy 到 `dist/` |

根目录 `pnpm check` / `pnpm test` 会递归执行各包对应脚本。

---

## 当前范围

当前实现聚焦 **MVP / Trust Core**：精确 pick、locator bundle + 加权 `resolve()` + ambiguity downgrade、route epoch 漂移恢复、本地优先存储、authenticated daemon 与 project-scoped MCP 四工具、`resolve_mark` 默认闭环、Markdown copy 兜底。

**不在 MVP 内**（见 PRD §4.3）：页面内设计值预览 / 可逆 patch、默认截图、`watch_marks`、team/cloud sync、多浏览器、Agent 写回讨论线程，以及保证 DOM→源码 file:line 精确映射（`source_hint` 永远只是辅助线索）。

术语、locator 评分细节、roadmap 与 KPI 均以 [`PRD.md`](./PRD.md) 为准。
