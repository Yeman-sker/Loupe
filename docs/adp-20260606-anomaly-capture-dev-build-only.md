# ADP: 异常采集只进 dev 构建，不进用户安装的扩展

> 关联：细化 `adp-20260606-anomaly-capture-offline-replay-pipeline.md`（管线本身）。
> 本 ADP 只记录"这套工具如何与用户产品隔离"这一个决策。

## Context

异常采集（⌥⇧A 手动标记、面包屑、DOM 快照、上报 daemon）服务的是
**Loupe 团队自己**——在真实测试阶段捕获 Loupe 自身的不合理行为去修 Loupe。

它**不服务 Loupe 的终端用户**。终端用户安装扩展只为标 mark（feedback），交给
自己的 agent 修自己的应用；他们不需要、也不应看到一个错误上报工具。

最初实现把采集直接做进了 `packages/extension` 的产品代码（app.ts 热键 +
background poster），等于把开发者工具随产品发给了所有用户——多余的热键、
潜在干扰、暴露内部机制。

采集探针有一个绕不开的约束：最有复现价值的数据（locator bundle、resolve
结果、Loupe 自己管线的面包屑）**只存在于扩展运行时内部**，纯外部旁观工具
拿不到。所以探针必须住在扩展代码里，但必须从用户构建中剔除。

## Decision

**采用编译期 dev 构建隔离。产品构建不包含任何异常采集代码。**

1. **产品扩展保持干净。**
   - `background.ts/.js`：无 anomaly 代码。
   - `app.ts`：只暴露一个**通用且惰性**的 instrumentation 接缝
     （`breadcrumb` 钩子 + `attach(api)` 只读访问 current target / project scope）。
     生产调用方不传 instrumentation → 完全无行为。
   - 面包屑改为走 `instrumentation?.breadcrumb?.()`，prod 下是 no-op。

2. **采集代码全部 dev-only，且从产品构建排除。**
   - 模块住在 `src/ui/anomaly/**` 与 `src/ui/dev/**`。
   - `tsconfig.build.json`（产品）`exclude` 这两个目录；`tsconfig.build.dev.json`
     不排除；`build` vs `build:dev` 两条脚本。

3. **dev 构建用独立 manifest + 独立 content script 加载。**
   - `manifest.dev.json` 的 content script 指向 `src/mv3/content.dev.js`，后者
     import `dist/ui/dev/mount-dev.js` 的 `mountDev`（= mount + 注入采集
     instrumentation）。产品 `content.js` 仍 import `app.js` 的 `mount`，不碰任何
     anomaly 代码。
   - dev 采集**直接从 content（isolated）世界 fetch loopback daemon**：content
     script fetch 绕过页面 CSP，凭证从配对键 `loupe:v1:daemon` 读取——因此
     **无需改 service worker**，background 保持产品干净。

4. **daemon 侧 `/v1/anomalies` 与 MCP 工具保留，不额外门控。** daemon 本就是
   开发者机器上的 agent 桥；没有 dev 扩展上报时这些是休眠端点，不构成用户
   可见面。

## Alternatives considered

- **运行时 dev 开关**（代码随产品发布，默认关闭）。否决：默认关 ≠ 不存在，
  死代码与潜在面仍随产品走，不满足"用户那里根本没有"。
- **独立伴生扩展**（与 Loupe 并存加载）。否决：拿不到 Loupe 内部
  locator/resolve，复现价值退化为 DOM+console。
- **采集仍走 service worker**（dev/prod 分离 background）。否决：`background.js`
  是手维护单文件，分离成本高；改为 content 世界直接 fetch 后 background 零改动。

## Consequences

- 发布构建已验证**不含**任何 anomaly 代码（`dist/ui/anomaly`、`dist/ui/dev`
  在 `pnpm build` 产物中不存在；background 干净；app.ts 仅余惰性接缝）。
- e2e 通过 `build:dev` + `manifest.dev.json` 加载 dev 变体，真实浏览器端到端
  验证 ⌥⇧A → 直接上报 → daemon 落盘 → 读回。
- 代价：多出 dev 构建脚本、`tsconfig.build.dev.json`、`manifest.dev.json`、
  `content.dev.js`（与 `content.js` 仅 `loadSurfaceRuntime` 一处不同，需保持同步）。
- 真实使用仍依赖 pairing（把 daemon token 写入扩展 storage 的
  `loupe:v1:daemon`）；目前 e2e 用 seed 模拟，pairing 本体未实现（另立 issue）。
- content 世界直接 fetch 依赖"content script fetch 绕过页面 CSP"；极端 CSP 站点
  若拦截，可回退走 SW（dev-only），但当前不需要。

## Status

Accepted
