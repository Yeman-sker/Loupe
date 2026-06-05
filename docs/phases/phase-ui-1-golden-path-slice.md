# 阶段 UI-1 · Golden-path 端到端薄切片

> **对应里程碑：M2（golden path 的 UI 落地）｜ Surface 1 / 3 / 4 / 5 最小形态** ｜ 用每个 surface 的最小形态打通浏览器内 golden path：host auth → 拾取 → 写意图 → 保存为 pin → 写入真实 project-scoped `chrome.storage.local`，无 daemon 也保存成功。

## 阶段目标

- **最小 host auth 入口。** 未授权 host 显示极简授权 CTA，点击走 `chrome.permissions.request`；授权成功才注入拾取；未授权或取消保持低噪声、不进 picker。（完整文案/视觉留 UI-6 / UI-7）
- **最小 picker + selection frame。** 单一 morphing 选择框跟随 hover、click / Enter 确认目标；active 时显示极小 mode indicator（`正在选取元素 / Picking element · Esc`）。（键盘父子微调 / breadcrumb / 性能优化留 UI-2）
- **最小 intent input。** 就近浮现、自动聚焦、`intent.comment` 必填、`⌘/Ctrl+Enter` 保存、Esc 取消并恢复进入前 focus；`intent.kind` 默认 `other`。（kind rail 全形态 / collapse-to-pin / 2-step Esc 留 UI-3）
- **最小 pin。** 保存成功后在 target 角落出现 reticle pin（编号 + kind accent），进入 `open` 状态。（全状态 / 定位 / tooltip 留 UI-4）
- **接真实本地存储与 locator。** 拾取时调用阶段 1 locator / resolve 库产出 `Locator` + 初始 `ResolveResult`；用阶段 2 `create_annotation` 写入 project-scoped `chrome.storage.local`，初始 `sync.status = local_only`、`task_status = open`；单 project 自动使用。

## 验收标准

- 端到端可在浏览器内完整保存一条 local mark：未授权 → 授权 → 拾取真实元素 → 写 `comment` → `⌘↵` 保存 → 写入 project-scoped storage 并显示 open pin；无 daemon 时仍保存成功。
- 保存的 `Annotation` 符合 schema：snake_case wire、`intent.comment` 必填、`intent.kind` 默认 `other`、`sync.status = local_only`、`task_status = open`，且携带阶段 1 的 locator 与 resolution。
- click / Enter 确认**不触发宿主业务事件**（capture 阶段阻断）。
- KPI（M2 首次达成）：daemon offline 时 mark 的首次 local-only 保存成功率 = 100%（重试/补同步韧性在阶段 4 守住）。

## 范围边界（本阶段不做，留待后续）

- 多 project chooser、键盘父子微调、breadcrumb、kind rail 全形态、collapse-to-pin、2-step Esc、pin 全状态、pin detail、view all、page-level fallback → UI-2 及以后。
- daemon 在线同步（阶段 3）、活体漂移恢复（阶段 4）不在本阶段。

## 依赖

- UI-0：渲染核心、token、i18n、status token、surface host。
- 阶段 1：locator 采集 / 重解析库（拾取即产出 `Locator` + 初始 `ResolveResult`）。
- 阶段 2：`create_annotation`、project-scoped storage key、`local_only` 初始状态。
- 现有 `content.ts` / `background.ts` 的 origin 授权消息（`loupe.origin_auth.*`）。

## 对应 surface 与里程碑

- Surface：1（host auth）/ 3（picker）/ 4（intent）/ 5（pin）的最小形态。
- interaction-spec：§3、§5、§6、§7；验收场景 §16.1 / 16.3 / 16.5 / 16.7 / 16.8。
- 里程碑：M2 golden path 的 UI 落地（PRD §6、§9.1–9.5、§12.1、§14 M2）。
