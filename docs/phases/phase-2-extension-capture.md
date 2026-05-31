# 阶段 2 · 扩展拾取闭环：Picker / Composer / Pin / 本地存储

> **对应里程碑：M2** ｜ 在浏览器内打通 golden path：精确拾取真实 DOM、写下意图、本地优先保存、最小 pin 反馈——一条 mark 不依赖 daemon 也能完整保存。

## 阶段目标

- **扩展 UI 与宿主页面互不污染。** 框架/组件线索只做一次性、只读探测且不暴露常驻 API；扩展自身 UI 以 Shadow DOM 隔离，不插入目标元素内部、不改变宿主布局。
- **能精确拾取真实 DOM，且不误触宿主。** 拾取是清晰的 modal 交互（描边/光标/工具栏同时提示），hover 给出高亮与盒模型提示，拾取动作不触发宿主业务事件，并能穿透 open Shadow DOM、排除扩展自身 UI。
- **键盘可独立完成拾取并有可见层级反馈。** 存在明确的键盘首目标与父/子微调模型，并以 breadcrumb 展示当前层级；鼠标移动、route change、退出与保存成功都会复位微调状态。
- **未授权 host 不注入 picker，且有最小授权 CTA。** 当前 host 未授权时不注入拾取能力；本阶段必须提供最小可用 CTA 并走 `chrome.permissions.request` 完成 host 授权，授权成功后才启用 picker。安全门控与最小授权路径属本阶段，onboarding 文案、视觉与动效打磨留待阶段 5。
- **Composer 让用户低摩擦写下意图。** Composer 就近浮现、自动避让 viewport、自动聚焦；`intent.comment` 必填、`intent.kind` 可选（默认 `other`）；可快捷保存、可取消并恢复拾取前焦点。
- **拾取即采集完整 context。** 每条 mark 采集 element/a11y/layout/framework 四类 context；framework 线索经只读 bridge 获得，`source_hint` 永远带 `confidence` 且仅作线索，不承诺 DOM→源码精确映射。
- **最小 pin 给出可信、可操作的反馈。** pin overlay 显示编号、`task_status`、`locator_status`+`confidence`、`sync.status`；pin detail 提供 MVP 功能操作——Copy Markdown、Resolve（用户手动完成）、Delete（明确删除）。功能可用属本阶段；视觉/动效打磨留待阶段 5。
- **本地存储是交互真相源且一致。** project-scoped `chrome.storage.local` 为本地优先真相源，读改写串行一致，删除写 tombstone，每条 mark 维护独立 `sync.status`（新建即 `local_only`）；daemon 不可用时 mark 仍能完整保存。
- **无 MCP 也有兜底。** 当前 session/route 的 open marks 可复制为 Markdown，供不支持 MCP 的 Agent 使用。
- **a11y 达到 MVP 正确性要求。** Composer/面板具备 ARIA label、focus trap、可 Esc 关闭并恢复焦点；pin 状态不只靠颜色；尊重 `prefers-reduced-motion`。

## 验收标准

- golden path 可在浏览器内完整保存一条 local mark：未授权 host 先显示最小授权 CTA 并通过 `chrome.permissions.request` 授权 → 进入拾取 → 选中真实元素（含键盘父/子微调）→ 写下 `intent.comment` 保存 → 写入 project-scoped `chrome.storage.local` 并显示 open + sync 状态；无 daemon 时仍保存成功。
- View all 按 project/session/route 分组，默认显示当前 session 的 open marks，并展示 lifecycle（`task_status`）、locator（`locator_status`+`confidence`）、sync（`sync.status`）三类状态。
- 从 pin detail 可手动 Resolve、Delete 与 Copy Markdown（功能层面可用）。
- KPI（本阶段达成）：daemon offline 时，mark 的**首次** local-only 保存成功率 = 100%（重试/补同步等韧性在阶段 4 守住）。

## 范围边界（本阶段不做，留待后续）

- 扩展 → daemon 的鉴权同步**实际写入**、以及 `sync.status` 由 `syncing` 推进到 `synced` → 阶段 3；同步韧性（retry / offline fallback / service worker 唤醒补同步 / `delete_pending` 重试）→ 阶段 4。本阶段只负责本地真相源、初始 `local_only` 与最小 host 授权 CTA。
- 活体漂移恢复（route 切换 / target detach 后的恢复）→ 阶段 4。
- support matrix 全量行为与逐项测试（cross-origin iframe / canvas / closed Shadow DOM 等边界）→ 阶段 4。
- onboarding 分支文案与视觉 / motion / rich toolbar / pin detail 视觉打磨 → 阶段 5。

## 依赖

- 阶段 0：schema、project/session 隔离标识与 storage key 契约。
- 阶段 1：locator 采集与重解析库（拾取时生成 locator 并产出初始 resolution）。

## 对应 PRD 章节

- §3.2、§6、§8.2、§9.1–9.5、§9.7、§12.1、§4.1.11、§14（M2）
