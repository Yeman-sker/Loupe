# 阶段 UI-2 · Picker / Selection frame 全量

> **对应里程碑：M2｜ Surface 3（signature surface）** ｜ 把拾取做到键盘可独立完成、层级可见、宿主不误触、大页面 silky。

## 阶段目标

- **键盘层级模型。** `Tab` / `Shift+Tab` 切换候选、`↑` 父目标、`↓` 子目标、`Enter` 确认、`Esc` 退出并恢复进入前 focus；鼠标移动、route 变化、退出与保存成功都复位微调状态。
- **breadcrumb 与语义标签。** selection frame label 语义优先、selector fallback（`button "Save"` / `input "Email"` / `nav`，回落 `div.px-4`）；键盘父/子移动或 dwell 后显示 ≤3–4 段 breadcrumb，语义优先、不显示 source/component path。
- **选择框 morph 连续性。** 同一选择框在目标 rect 间 morph（transform/width/height over `--dur` + `--ease`）；组成：iris veil 填充、hairline iris edge、四角 13px（2px iris）角括号、右上 mono dimension readout、左下语义 label tab。
- **宿主交互纪律。** 允许 wheel / scroll；capture 阶段阻断宿主 click / activation，不触发宿主按钮/链接/表单；穿透 open Shadow DOM 并排除扩展自身 UI；contextual cursor，不做全屏 crosshair。
- **性能边界。** `pointermove` 不做无界全树扫描；target resolution 与 frame 动画**分离**；几何插值 + compositor-friendly transform；动画可被打断并干净 retarget，不排队在高频 pointermove 之后。

## 验收标准

- 纯键盘可完成拾取并有可见层级反馈（breadcrumb）；`Esc` 恢复进入前 focus。
- 跨目标 morph 连续、可中断重定向；大页面 hover 不卡顿、无布局抖动。
- click / 键盘确认不触发宿主业务事件；open Shadow DOM 内目标可被拾取，且不会选中扩展自身 UI。
- label 语义优先、selector fallback；breadcrumb ≤3–4 段、语义优先。

## 范围边界（本阶段不做，留待后续）

- cross-origin iframe / canvas / closed Shadow DOM 等 support matrix 全量运行时验证 → 阶段 4。
- same-origin iframe 目标按阶段 0/1 的 `frame_path` 契约可标注，但其**活体恢复**在阶段 4。
- intent input 全形态、pin 全状态 → UI-3 / UI-4。

## 依赖

- UI-1：拾取 → 保存的最小闭环已成立。
- 阶段 1：locator 采集（含语义 / role / 可访问名 / selector 证据），供 label 与 breadcrumb 语义优先策略。

## 对应 surface 与里程碑

- Surface：3（picker / selection frame）。
- interaction-spec：§5、§11（picker active）、§14–15（约束与性能）；验收场景 §16.3 / 16.4。
- 里程碑：M2（PRD §3.2、§9.1–9.2、§14 M2）。
