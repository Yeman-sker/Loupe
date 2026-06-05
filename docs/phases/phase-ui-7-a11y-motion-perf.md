# 阶段 UI-7 · a11y、动效与性能收口（发布级打磨）

> **对应里程碑：M5｜ 全 surface 收口** ｜ 在 Trust Core 正确性不被动摇的前提下，把 a11y、动效、性能、主题/语言一致性打磨到发布级，并通过 interaction-spec §16 的设计验收场景。

## 阶段目标

- **a11y 收口。** 全 surface 键盘可完成；focus 管理 + 关闭后恢复进入前 focus；icon button 有 aria-label；status **永不只靠颜色**；kind theme 不作唯一意义载体；tooltip 不承担完成关键操作所必需的信息。
- **动效收口。** 锁定 motion 值（`--ease` / `--ease-out`、`--dur .19s` / `--dur-fast .12s` / `--dur-slow .34s`）；selection frame 几何插值、可中断重定向；hover/press 微反馈；collapse-to-pin；状态变化就地过渡；`prefers-reduced-motion` 收敛速度/幅度但保留空间连续性。
- **性能收口。** compositor-friendly transform；无 hover 布局抖动；杜绝 `pointermove` 无界全树扫描；仅渲染视口附近 pin；动画不排队在高频 pointermove 之后。
- **主题/语言与文案一致性。** light/dark + 中/EN 持久化；host auth / project / onboarding 文案与视觉达发布级（onboarding 分支与 PRD §9.6 对齐）；全 surface 间距 / 圆角 / 阴影 / 字体按锁定 token 逐项对齐（像素级保真）。

## 验收标准

- interaction-spec §16.1–16.11 设计验收场景全部通过。
- a11y：纯键盘可完成 picker → intent → pin → detail → view all；focus 恢复正确；status 非颜色单一载体；reduced-motion 保留空间连续性。
- 性能：大页面 hover / morph silky、pin 仅视口附近渲染、无明显布局抖动。
- 视觉与锁定 token / 原型逐项对齐（像素级保真）。

## 范围边界（本阶段不做，留待后续）

- 官方 marketplace 发布、CLI diagnostics UI、完整 onboarding 安装流（daemon ensure 等）属 M5 的**非 in-page** 部分，由阶段 5 负责，不在本 UI 系列。
- 团队 / cloud sync / replies / `pending_changes` 等 PRD §4.4 后续路线不做。

## 依赖

- UI-0 … UI-6 全部交付（8 个 surface 功能与状态已成立）。

## 对应 surface 与里程碑

- Surface：全部 8 个 surface 的发布级收口。
- interaction-spec：§11（键盘）、§12（a11y）、§13（locked）、§15（性能）、§16（验收）、§17。
- 里程碑：M5 视觉 / 动效 / onboarding 打磨（PRD §4.2、§9.6、§14 M5）。
