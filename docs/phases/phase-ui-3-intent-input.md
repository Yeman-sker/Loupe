# 阶段 UI-3 · Intent input 与 kind rail 全量

> **对应里程碑：M2（功能）+ M5（形态打磨）｜ Surface 4** ｜ 把意图输入做到锁定形态：自增长、圆形提交、kind rail、IME 安全保存、2-step 丢弃、collapse-to-pin。

## 阶段目标

- **自增长输入与定位避让。** 1 → ~4 行自增长（超过 88px 内部滚动）；锚定 target 下 > 上 > 底部 dock fallback；一旦出现，本次输入期间不因轻微 layout / scroll 频繁重排；target 完全离屏时切底部 dock。
- **圆形提交 + kind rail。** 圆形 kind-tinted 提交按钮（空 comment 时禁用置灰，up-arrow 图标）；kind rail（mono `类别/KIND` label + 6 个 dot，hover/选中 dot 展开其 label + kind-tinted halo + tinted bg，默认 `other`），`role=listbox`/`option`，方向键 + Enter 可选。
- **校验与键位。** 空 comment 禁用保存；`⌘/Ctrl+Enter` 空内容 → inline hint「先写一句任务 / Write a task first」+ very subtle micro shake；`⌘/Ctrl+Enter` 保存（普通 Enter **不**保存，避免中文输入法 / 多行冲突）。
- **取消与丢弃。** `Esc`：无内容 → 取消并恢复进入前 focus；有内容 → 第一次 inline「再按一次 Esc 丢弃 / Press Esc again to discard」，第二次丢弃。无传统 confirm dialog。
- **保存成功过渡。** collapse-to-pin（submit / kind accent 缩束到 target 角、淡出，over `--dur-slow`）；pin 出现进入 `open`；默认退出 picker；近新 pin 显示低噪声「+ 再标一个 / Add another」。本地保存失败才在 input 内 inline error；daemon offline **不**视为创建失败（显示 `local only`）。

## 验收标准

- 锁定交互全部成立：自增长 / 内部滚动、空禁用、`⌘↵` 保存、IME-safe Enter、2-step Esc、collapse-to-pin、Add another。
- kind rail 键盘可开可选；kind theme 影响 accent，但**不覆盖** task / locator / sync 状态（状态仍由 text / icon / token 表达）。
- 保存成功无 toast；本地失败 inline error；daemon offline 显示 `local only` 不阻断保存。

## 范围边界（本阶段不做，留待后续）

- page-level fallback 卡片本体与 sync 状态真值映射 → UI-6。
- pin 的全状态与定位 → UI-4。

## 依赖

- UI-1：保存闭环（`create_annotation`）。
- UI-0：token / i18n / status token / 渲染核心。

## 对应 surface 与里程碑

- Surface：4（intent input）。
- interaction-spec：§6、§11（intent input）、§13（locked decisions）；验收场景 §16.5 / 16.6 / 16.7。
- 里程碑：M2 功能（PRD §9.3）+ M5 形态/动效打磨。
