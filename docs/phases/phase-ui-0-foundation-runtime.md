# 阶段 UI-0 · UI 基座、Token 与渲染管线

> **对应里程碑：M2 基座（视觉/动效最终打磨归 M5）｜ Surface 0（跨切面基座）** ｜ 把 8 个 in-page surface 共同依赖的运行底座钉死：tsc-emit 构建管线、Shadow-DOM surface host、锁定 token 层、自托管字体、theme / i18n / status-token 原语、原生 DOM 渲染/状态核心、pointer-events 纪律与 reduced-motion 接线。

## 阶段目标

- **构建管线落地为 tsc-emit（增量管线）。** 新增扩展 `tsconfig.build.json`（参照 `@loupe/server`），仅将**新增的 `src/ui` 树** emit 到 `dist/ui`（经 `web_accessible_resources` 暴露）；content.js 在授权后以 `import(chrome.runtime.getURL("dist/ui/app.js"))` 动态加载。`content.js`/`background.js` **保持 `src/` 经典脚本不变**——MV3 禁止 ES module content script，且 `phase4-e2e.test.ts` 以 `vm.Script` 经典执行并锁定其路径与「无 UI」形态，故其双写不在本阶段移除（见 ADP 20260604 Amendment）。
- **Shadow-DOM surface host 取代占位 marker。** 把现有 content root 从「隐藏的 closed shadow marker」演进为可承载 surface 的隔离 overlay 层：默认不吞宿主交互、仅 active 控件 opt-in pointer-events；不插入目标内部、不改宿主布局、不依赖宿主 CSS。
- **锁定 token 层与字体就位。** `loupe-tokens.css` 原样注入 Shadow root；Space Grotesk + JetBrains Mono 自托管，CJK 回退系统字体；light/dark 双主题可切换并持久化。
- **i18n 与 status-token 原语成立。** 中文主 / EN 切换字典（DOM、Agent、Markdown、Pin、kind、route、⌘↵ 等技术术语保持英文）；status token 统一为 glyph + 文本（located/synced/done `✓`、drifted `△`、lost/failed `✕`、open `○`、neutral `•`、syncing `◌`），状态不只靠颜色。
- **原生 DOM 渲染/状态核心成立。** 一套小型 mount / update / 卸载与事件绑定约定供后续 surface 复用；`prefers-reduced-motion` 把动效时长收敛到 `.001s` 但保留空间连续性。

## 验收标准

- 扩展 build（tsc-emit）产出 `dist/ui/*.js`；`manifest.json` 经 `web_accessible_resources` 暴露 `dist/ui` 与自托管字体；`check` / `build` / `test` 全绿（含**未改动**的 phase4-e2e 契约）；`content.js`/`background.js` 仍为 `src/` 经典脚本。
- 授权 host 上注入的是隔离 surface host：宿主点击/滚动不被默认吞掉，overlay 不改变宿主布局，token 在 light/dark 下渲染正确，自托管字体生效。
- 一个最小 smoke surface 能 mount / update / 卸载，证明渲染核心、pointer-events 纪律、theme 切换、reduced-motion 收敛与 status-token 渲染。

## 范围边界（本阶段不做，留待后续）

- 不实现任何业务 surface（auth / picker / intent / pin / detail / view all / fallback）→ UI-1 起逐步交付。
- 不接 daemon 同步引擎（阶段 3）、不接活体漂移恢复引擎（阶段 4）；本阶段只搭底座。
- onboarding 文案与发布级视觉/动效最终打磨 → UI-7（= M5）。

## 依赖

- 阶段 0：storage key / project scope 契约、`@loupe-server/shared` wire schema。
- ADP 20260604：构建/渲染决策（tsc-emit + 原生 DOM + Shadow DOM）。
- ADP 20260602：Shadow DOM / MAIN-ISOLATED 世界边界、不改宿主布局。

## 对应 surface 与里程碑

- Surface：跨切面基座（interaction-spec §14 实现约束、§15 性能边界、§1.2 invisible-until-needed）。
- 里程碑：实现 M2 的 UI 运行底座；视觉/动效最终打磨在 UI-7 收口（= M5）。
- 现有代码：演进 `packages/extension/src/content.ts`（注入根），新增 `tsconfig.build.json` 与 token / styles / i18n / 渲染核心模块。
