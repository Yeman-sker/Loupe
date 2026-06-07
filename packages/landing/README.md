# @loupe-server/landing

Loupe 的落地产品介绍页（营销产物，非产品运行路径）。访客在页内直接体验签名动作——
指一下真实 DOM、Selection frame 精确跟过去——并把信任闭环演到合上。

权威范围见 `docs/phases/phase-mkt-0-landing-interactive-demo.md`。

## 技术

- Next.js 15 (App Router) + React 19，全站 SSG。
- 品牌 token 唯一真相源：`docs/ui-ux/prototypes/loupe-tokens.css`（在 `app/layout.tsx` 直接 import）。
  各 surface（Selection frame / intent / pin / 仿终端）按落地页语境**重写**，不耦合 `packages/extension` 运行时。
- 默认 dark "Instrument" + 主题开关；默认英文 + 单一语言开关同步切外壳与沙盒，技术术语恒英文。

## 结构

- `components/Sandbox.tsx` — hero 受控沙盒：作用域锁定在 mock host 面板内的 `[data-pick]` 元素，
  `hover→morph→pick→intent→⌘↵→collapse-to-pin`。永不指落地页自身元素。
- `components/AgentClose.tsx` — 仿 Agent 终端：把访客刚创建的 mark 渲染成低噪声 AgentMark
  payload（PRD §11.1 shape），`resolve_mark` 合环、pin 翻 done。**demo 自生数据，不接真 MCP/locator 引擎。**
- `components/Install.tsx` — 诚实三件套：daemon 包管理器 tab（`@loupe-server/server`，bin `loupe serve`）
  + Step 1/2/3 结构；扩展/插件未发布标 Coming soon。**绝不伪装单行 `curl | bash`。**

## 开发

```bash
pnpm --filter @loupe-server/landing dev     # 本地起 http://localhost:3000
pnpm --filter @loupe-server/landing build   # 生产构建（SSG）
pnpm --filter @loupe-server/landing check   # tsc 类型检查
```

## 部署（Vercel）

Monorepo 子目录部署：Root Directory 指向 `packages/landing`。`next.config.mjs` 的
`outputFileTracingRoot` 已指向仓库根，使共享 token 文件 `../../docs/...` 在构建期可达。
