# ADP 20260604 · 扩展 in-page surfaces 用 tsc-emit + 原生 DOM 重建（不打包、不引入框架）

## Context

锁定的 in-page surfaces 视觉系统（"Optical Instrument"，见 `docs/ui-ux/loupe-in-page-surfaces-interaction-spec.md` 与 `docs/ui-ux/prototypes/`）共 8 个 surface，是高保真、有状态、需精确动效的交互面（morph 选择框、kind rail、collapse-to-pin、2-step 确认、reticle pin 等）。原型以 **React + Babel 在浏览器内运行**，但原型 README 明确：原型是 **spec of record，不是可直接 ship 的产物**，要求在 `packages/extension` 内**用 repo 约定重建为 real TypeScript**，且 `loupe-tokens.css` 可原样 lift。

需要在动工前钉死「用什么构建 + 渲染方式实现这 8 个 surface」，因为它决定每个 phase 的写法且后续难以回退。约束来自三方面：

1. **Monorepo 现状是 tsc-only。** 全部包无任何 bundler；`@loupe/server` 用 `tsconfig.build.json` 经 `tsc` emit；`@loupe/extension` 目前 `noEmit`，并**手写 `content.js`/`background.js` 与 `.ts` 并行维护**（双写，易漂移）。
2. **content script 注入任意宿主页面。** 运行时体积、全局污染、与宿主 CSS/JS 的隔离都敏感；surfaces 必须全部渲染在 Shadow DOM，不插入目标内部、不改宿主布局、不依赖宿主 CSS（见 ADP 20260602）。
3. **设计要求像素级保真。** 实现要能逐项对齐锁定 token、间距、动效曲线与交互状态。

## Decision

采用 **tsc-emit + 原生 DOM 渲染**，**不引入打包器、不引入运行时 UI 框架**。

1. **构建管线：tsc-emit。** 新增 `packages/extension/tsconfig.build.json`（参照 `@loupe/server`），从 `src` emit 到 `dist`；`manifest.json` 指向 `dist/content.js` / `dist/background.js`，**废除手写并行 JS**，消除双写漂移。
2. **渲染：原生 DOM。** surfaces 用原生 DOM（`createElement` + 一套小型 mount/update/卸载与事件绑定辅助）实现；不引入 Preact/lit/React 等运行时。
3. **样式：token 层原样注入。** `loupe-tokens.css` 连同组件 CSS 以**字符串注入 Shadow root**（构建期内联，不依赖宿主样式管线）。
4. **字体自托管。** Space Grotesk + JetBrains Mono 自托管随包分发，CJK 回退系统 PingFang / Noto。
5. **原型不进产物。** 原型的 React/JSX/Babel 与 `tweaks-panel.jsx` 仅作视觉与行为 spec of record；实现是**重建，不是粘贴**。

## Alternatives considered

### 1. esbuild + Preact + TSX

优点：最贴近 React 原型，JSX / CSS import / 字体资源一步到位，移植与后续迭代 DX 最佳。

缺点：引入 **repo 首个 bundler + 运行时框架**，反转全仓 tsc-only 的既定选择；content script 注入宿主页面时多一层框架运行时与体积；新增构建面与依赖维护成本。

未采用。

### 2. 保持手写 JS、无构建

优点：零工具、零依赖、维持现状。

缺点：8 个高保真有状态 surface 手写 JS **不可维护**，且与 `.ts` 双写持续漂移；与「像素级保真 + 可演进」目标冲突。

未采用。

### 3. lit / Web Components

优点：模板与样式封装较好，Shadow DOM 亲和。

缺点：通常仍需打包 / 装饰器配置，并引入运行时库；偏离 tsc-only 约定，收益不抵成本。

未采用。

## Consequences

### Positive

- 与 monorepo 既定约定一致（tsc-only），无运行时依赖，**content-script 体积最小**、Shadow DOM 内无框架全局泄漏。
- 消除手写 JS 与 `.ts` 的双写漂移；`tsc` 严格模式（`exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` / `verbatimModuleSyntax`）与现有 `check`/`test` 管线直接复用。
- 直接复用 `@loupe-server/shared` 的 wire schema 与 `@loupe/extension` 已有的 storage / sync / 授权逻辑，UI 只做呈现与编排。

### Negative / cost

- 有状态 surface（morph 选择框、kind rail、collapse-to-pin、2-step 确认）用原生 DOM 比 JSX **更冗长**，需要一套小型渲染/状态约定与显式 DOM 更新管理。
- 从 React 原型移植需**逐一重写**而非粘贴；动效与列表更新需手动管理 DOM 生命周期。

### Follow-up constraints

- 所有 surface 必须渲染在 **Shadow DOM**、不插入目标内部、不改宿主布局、不依赖宿主 CSS；默认不吞宿主交互，active 控件 opt-in pointer-events。
- token 层按 `loupe-tokens.css` **原样**；状态表达**不只靠颜色**（glyph + 文本 + token）；kind theme 不作唯一意义载体。
- 尊重 `prefers-reduced-motion`（收敛速度/幅度但保留空间连续性）。
- `pointermove` **不做无界全树扫描**；target resolution 与 frame 动画**分离**，动画可中断重定向、不排队。

## Amendment (2026-06-05)

实现 UI-0 时发现 §1/§3 的两处细节与 MV3 现实及既有测试契约冲突，按下述修正（核心决策——tsc-emit + 原生 DOM + Shadow DOM、不打包不引入框架——不变）：

- **§1 构建/加载边界修正为「增量管线」。** MV3 的 declarative content script **不支持 ES module**；且 `packages/extension/src/phase4-e2e.test.ts` 用 `new vm.Script` 以**经典脚本**执行 `src/content.js` / `src/background.js`，并断言 manifest 路径精确为 `src/*.js`、content script **不含 UI**。因此 content/background **保持经典脚本、留在 `src/`，其与 `.ts` 的双写不在此移除**。tsc-emit 仅作用于**新增的 `src/ui` 树 → `dist/ui`**（经 `web_accessible_resources` 暴露），由 content.js 在**授权后**以 `import(chrome.runtime.getURL("dist/ui/app.js"))` 动态加载。原 §1「manifest 指向 dist/content.js、废除手写并行 JS」及 Positive 中「消除手写双写」**仅适用于 `src/ui`，不适用于 content/background**。
- **§3 token 注入并非字节级 verbatim。** `loupe-tokens.css` 用 `:root` / `[data-theme]`，在 shadow tree 中不生效；注入时按机械变换 `:root`→`:host,.loupe`、`[data-theme="x"]`→`:host([data-theme="x"]),.loupe[data-theme="x"]`，**值完全保留**。

## Status

Accepted（2026-06-05 amended，见 Amendment）
