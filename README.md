# Loupe

> 在本地开发页面上精确「钉选（pin）」一个真实 DOM 元素并写下意图，让 AI 编码 Agent 通过 MCP 精确读取该元素的定位与上下文，完成修改后默认 `resolve`。

Loupe 把「我在浏览器里指的这个真实 DOM 元素」转换成 Agent 可执行、可复核、可完成的结构化任务。它**不是**网页批注工具、截图标注工具或页面内设计编辑器。

核心信任闭环：

```text
pick → robust locate/recover → persist/sync → low-noise Agent read → resolve
```

详见 [`PRD.md`](./PRD.md) 与 [`CONTEXT.md`](./CONTEXT.md)。

## 架构

Loupe 是本地优先的工具：交互真相源是浏览器扩展的 `chrome.storage.local`，本地 daemon 只做磁盘镜像与 Agent bridge。

| 组件 | 包名 | 职责 |
| --- | --- | --- |
| 浏览器扩展 | `@loupe/extension` | Chrome MV3。picker、composer、locator/context capture、最小 pin overlay、本地优先存储 |
| 本地 daemon | `@loupe-server/server` | 监听 `127.0.0.1:7373`，暴露带 token 鉴权的 `/v1/marks*` 与 `/mcp`，维护 `~/.loupe/marks.json` 镜像 |
| 共享 schema | `@loupe-server/shared` | 扩展、daemon、插件共用的类型与 mark schema |
| Claude 插件 | `@loupe/claude-plugin` | 启动 daemon、注册 MCP proxy、提供 `/loupe:marks` 与 mark-resolver agent |
| Codex 插件 | `@loupe/codex-plugin` | Codex 侧的 MCP 接入 |
| 端到端测试 | `@loupe/e2e` | Playwright 驱动的 MV3 扩展 + daemon 全链路测试 |

## 环境要求

- Node.js ≥ 22（开发机为 v24）
- pnpm 9（`packageManager` 已锁定 `pnpm@9.15.4`）
- Chrome / Chromium（加载 MV3 扩展）

## 快速开始

```bash
pnpm install

# 构建顺序有依赖：shared 先于其消费方（extension/server/plugins 通过 dist 消费 shared）
pnpm --filter @loupe-server/shared build
pnpm --filter @loupe/extension build:dev
pnpm --filter @loupe-server/server build
```

在 Chrome 的 `chrome://extensions` 打开「开发者模式」，「加载已解压的扩展程序」选择 `packages/extension/dist`。

启动本地 daemon 后，扩展会与 `127.0.0.1:7373` 同步 marks，Agent 经 MCP 读取。

### Golden Path

1. 运行本地应用（如 `http://localhost:5173`）。
2. 安装 Loupe 扩展与 Claude 插件；插件在 SessionStart 通过 `/health` 检查并按需拉起 daemon。
3. 扩展检测当前 host 已授权，生成 `project_id` / `route_key` / `session_id`。
4. 按 `⌥L` 进入拾取模式，用鼠标或键盘选择真实 DOM，`↑/↓` 微调父子层级，`Enter` 确认。
5. 写下意图（comment 必填），生成 mark。
6. Agent 读取 project-scoped mark，按 locator/context 定位代码并修改，默认调用 `resolve_mark` 关闭任务。

## 常用脚本

仓库根目录（对所有包递归执行）：

```bash
pnpm check      # 类型检查（= typecheck）
pnpm test       # 运行所有包的测试
```

单包：

```bash
pnpm --filter @loupe/extension      check        # tsc 类型检查
pnpm --filter @loupe/extension      build        # 产物构建
pnpm --filter @loupe/extension      build:dev    # 开发构建（含 dev manifest）
pnpm --filter @loupe-server/server  build
pnpm --filter @loupe/e2e            test
```

> 编辑 `@loupe-server/shared` 的 `src` 后需重新 `build`，否则消费方看到的是 dist 中的旧导出。

## 仓库结构

```text
packages/
  extension/      Chrome MV3 扩展（picker / composer / pin overlay）
  server/         本地 daemon（HTTP + MCP，marks.json 镜像）
  shared/         共享 schema 与类型
  claude-plugin/  Claude Code 插件
  codex-plugin/   Codex 插件
  e2e/            端到端测试
docs/
  adp-*.md        架构决策记录（ADP）
  phases/         分阶段交付文档
  ui-ux/          产品设计原型（UI/UX 实现的唯一依据）
PRD.md            核心产品文档
CONTEXT.md        领域语言与术语
```

## 设计原则（摘自 PRD）

1. **定位即信任。** 宁可显示 `drifted` / `lost`，也不静默指错。
2. **完成默认 `resolve`，不默认 `delete`。**
3. **project / session 隔离是安全边界。** mark 不能只按 route 存取。
4. **本地优先，daemon 镜像。**
5. **Agent payload 低噪声。** raw storage 保留证据，MCP 只返回当前决策所需信息。
6. **默认安全。** loopback 接口必须带 token，页面脚本没有任何无 token 写入口。
</content>
</invoke>
