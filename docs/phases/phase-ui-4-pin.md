# 阶段 UI-4 · Pin 全状态与定位

> **对应里程碑：M2（功能）+ M5（形态打磨）｜ Surface 5** ｜ 把 pin 做到可信、可定位、状态不只靠颜色、大页面只渲染视口附近。

## 阶段目标

- **reticle 组合与入场。** surface 填充 hairline ring + 居中 mono 编号 + kind-accent arc（SVG `circle` `stroke-dasharray` rotate −58°）；`pin-in` 入场（scale 0.4 → 1.12 → 1）；open + located 的 pin 发出慢速 iris focus pulse（`pin-ping`）。
- **全状态（不只靠颜色）。** done → ring 收敛到 surface-2 + `✓` badge；drifted → dashed warn ring + `△` badge；lost → 透明 dashed strong-hairline ring + `✕` badge；stack → 右下 `+N` count chip。
- **定位。** `translate(-50%,-50%)` 到 target 最少遮挡外角（clamp 在视口内，空间不足回内侧角）；同 host 多 pin `+16px` 下移堆叠；在 mount / resize / `document.fonts.ready` 时重测 host rect。
- **非交互 tooltip。** pin 上方 compact 状态行（`open · located 100% · synced`、`open · drifted 62% · local only`、`open · lost · synced` 等）；click / `Enter` / `Space` → Pin detail。
- **大页面只渲染视口附近 pin，近的自动堆叠。**

## 验收标准

- 四种状态（done / drifted / lost / stack）在 pin 上均有 glyph + 形态区分（**不只颜色**）；tooltip 状态行正确，confidence 展示符合规则（located/drifted 带 %、lost 不显示假百分比）。
- 定位贴合 target、clamp 在屏内、同 host 堆叠正确；resize 与字体就绪后位置重测正确。
- 仅渲染视口附近 pin；相近 pin 堆叠显示 `+N`。

## 范围边界（本阶段不做，留待后续）

- drifted / lost 的**活体恢复触发与世代校验**（route epoch / DOM quiet window / stale route 取消）→ 阶段 4；本阶段只**忠实渲染**来自 store / locator 的状态。
- pin detail 与 view all → UI-5。

## 依赖

- UI-1：pin 最小形态。
- UI-0：token / status token / 渲染核心。
- 阶段 1：`locator_status` + `confidence`（located / drifted / lost）。

## 对应 surface 与里程碑

- Surface：5（pin）。
- interaction-spec：§7（pin）、§11；验收场景 §16.11。
- 里程碑：M2 功能（PRD §9.4）+ M5 形态/动效打磨。
