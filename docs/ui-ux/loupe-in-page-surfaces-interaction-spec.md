# Loupe in-page surfaces UI/UX interaction spec

## 0. Scope

本 spec 只覆盖 **Loupe in-page surfaces**：浏览器页面内支持 mark trust loop 的交互面。

目标链路：

```text
Project prerequisite / host authorization
→ Picker / Selection frame
→ Intent input
→ Pin
→ Pin detail / View all
→ Agent handoff fallback / done
```

### In scope

1. Host authorization CTA
2. Project chooser
3. Picker / Selection frame
4. Intent input
5. Pin
6. Pin detail
7. View all
8. Page-level status / fallback

### Non-goals

本轮不设计：

- CLI / daemon diagnostics UI
- Claude/Codex plugin UI
- Marketplace / full onboarding flow
- Browser popup redesign
- Settings page
- Team/cloud/replies/discussion UI
- Full DevTools inspector
- Full mark management dashboard
- Page-level mark without DOM target
- Multi-target mark
- Screenshot attachment UI
- Toast system

## 1. Core principles

### 1.1 DOM target, not screenshot annotation

Loupe 的 picker 选择的是 **真实 DOM target**，不是截图框选、视觉批注、裁剪区域或设计编辑器。

Selection frame 是当前 DOM target 的确认器：帮助用户确认“我指的是这个真实元素”。

### 1.2 Invisible until needed

默认页面内 Loupe UI 应尽可能低存在感。

- 不做常驻大 toolbar。
- Pin 常驻但极小。
- Detail / View all / fallback 按需出现。
- Picker active 时才显示 mode indicator。

### 1.3 Comment is primary

Intent input 的主路径是：用户写一句给 Agent 的任务。

- `intent.comment` 是必填。
- `intent.kind` 默认 `other`。
- Kind 是 secondary，不阻断保存。

### 1.4 Kind theme is category accent, not status

Kind theme 可以影响 accent、glow、submit button、pin rim、detail header，但不能覆盖任务/定位/同步状态语义。

状态必须使用文本/图标/token 表达，不只靠颜色。

### 1.5 Precise material motion

整体动效语言：precise, quiet, continuous, low-latency。

- 不做活泼弹跳。
- 不做大面积 glass / blur 依赖。
- 不做烟花式成功动画。
- 运动应像高级系统控件：克制、连续、可预测。

### 1.6 Clean cutover

旧的完整 Composer 表单形态不保留为 classic mode。

新 Intent input 必须覆盖旧能力：

- comment required
- kind optional/default other
- save/cancel
- keyboard/a11y
- viewport avoidance

## 2. Display vocabulary

Schema/API 名称不变；UI display label 可以更贴近用户任务语义。

### Task status

| Schema value | UI label |
| --- | --- |
| `open` | `open` |
| `resolved` | `done` |
| `archived` | `archived` |

UI 按钮使用 `Mark done`，内部 action 仍调用 `resolve_mark`。

### Locator status

| Schema value | UI label |
| --- | --- |
| `resolved` | `located` |
| `drifted` | `drifted` |
| `lost` | `lost` |

Confidence 展示：

- normal compact: `located 100%`
- drifted: `drifted 62%`
- lost: `lost`，不显示假百分比

### Sync status

| State | UI label |
| --- | --- |
| synced | `synced` |
| local-only | `local only` |
| failed | `sync failed` |
| syncing | `syncing` |

### Kind labels

沿用当前 schema：

- `bug`
- `copy`
- `style`
- `layout`
- `question`
- `other`

UI 不新增 `polish`、`interaction` 等近义 kind。

## 3. Surface 1 — Host authorization CTA

### Purpose

当前 host 未授权时，Loupe 不注入 picker。CTA 是进入 Loupe 的最小前置入口。

### Behavior

- 未授权 host：显示极简 permission card。
- 用户点击授权：触发 `chrome.permissions.request`。
- 授权成功：进入 Project prerequisite / Picker flow。
- 授权失败或取消：保持低噪声说明，不进入 picker。

### Microcopy direction

- `Allow Loupe on this site`
- `Pick DOM elements on this page and turn them into agent tasks.`
- Button: `Allow site`

### Visual constraints

- 小 card，不做 onboarding wizard。
- 不使用错误语气；未授权是前置状态，不是失败。

## 4. Surface 2 — Project chooser

### Purpose

Project 是 mark 的安全边界。若同一 origin 绑定多个 Project，必须先选择 Project，再允许创建 mark。

### Behavior

- 单一 Project：自动使用，不打扰。
- 多 Project：进入 picker 前显示 Project chooser。
- daemon / project identity unavailable：允许 `Continue locally`，但显式标记 temporary/local-only。
- 选定 Project 后，本 origin/session 不反复询问。
- 当前 Project 在 View all header / picker mode indicator 中低噪声可见。

### UI language

使用 `Project`，不使用 `Workspace` 作为主术语。

示例：

- `Choose project for this site`
- project item: `app-web` + path hint
- fallback: `Continue locally`
- temporary state: `project not linked`

### Temporary/local project rules

- 可保存 mark。
- 不承诺 MCP Agent read。
- 提供 Copy Markdown fallback。
- 状态显示 `local only` / `project not linked`。

## 5. Surface 3 — Picker / Selection frame

### Purpose

Picker 让用户确认一个真实 DOM target。

### Active mode indicator

Picker active 时显示极小 mode indicator：

- `Picking element · Esc`
- 可短暂显示当前 Project：`Project: app-web`

不做常驻 launcher。

### Pointer behavior

- 页面允许 wheel / scroll。
- Pointer down/up/click 在 capture 阶段阻止宿主业务 activation。
- 不触发宿主按钮、链接、表单 click。
- 不默认进入文本选择/拖拽。
- Esc 退出并恢复进入前 focus。

### Cursor

使用 contextual cursor。

- 不使用花哨 custom cursor。
- 不全程 crosshair，避免截图工具心智。
- 可选 target 上可使用 subtle pick affordance；主要反馈来自 Selection frame。

### Selection frame motion

不同 DOM target 之间使用同一个 Selection frame 做 rect morph continuity。

普通模式：

- rect morph
- subtle spring allowed
- 无大 overshoot
- 无 heavy blur

Reduced motion：

- 不等于无位移。
- 保留空间连续性。
- 减少速度、幅度、弹性、overshoot、scale、blur。
- 使用更短、更直接的 interpolation。

### Label

Selection frame label 使用混合策略：语义优先，selector fallback。

优先：

- `button “Save”`
- `input “Email”`
- `nav`

Fallback：

- `div.px-4`
- compact selector preview

不默认显示 source/component 名；`source_hint` 不能承诺 DOM→源码精确映射。

### Breadcrumb

键盘父/子微调或停留片刻后显示 compact breadcrumb。

- 语义优先。
- 缺失处使用 compact selector。
- 最多 3–4 段。
- 中间层过多时折叠。
- 不显示 source/component path。

Example:

```text
main > card > button “Save”
```

### Confirmation

- Mouse click confirms current target and opens Intent input.
- Keyboard Enter confirms current target.
- Tab moves to next candidate.
- ↑ moves to parent.
- ↓ moves to child.
- Esc exits picker.

## 6. Surface 4 — Intent input

### Purpose

Intent input 是 pick 后捕获用户任务意图的 compact command-like input。

### Default shape

- 默认一行。
- 自动增长到 3–4 行上限。
- 超过后内部滚动。
- 自动聚焦。
- Placeholder: `Tell the agent what to change…`

### Positioning

优先贴近 target：下方 > 上方 > 右侧 > 左侧。

Fallback：

- target 太小
- target 靠近 viewport 边缘
- 空间不足
- 软键盘/viewport 挤压

则切到底部居中 command bar。

稳定性规则：

- 一旦出现，本次输入期间不因轻微 layout/scroll 频繁重排。
- target 完全离屏时可切换为 bottom dock。

### Submit affordance

- 默认圆形 icon button。
- 带当前 kind theme。
- Hover/focus tooltip: `Save · ⌘↵`
- Accessible label: `Save mark`
- 不常驻文字 `Save`，避免旧表单感。

### Required comment behavior

- Empty comment: submit disabled。
- 快捷键保存空内容：inline hint `Write a task first`。
- 不弹 toast。
- 不默认 shake；只有明确错误时允许 very subtle micro shake。

### Save shortcut

- `⌘/Ctrl + Enter` 保存。
- 普通 Enter 不锁定为保存，避免中文输入法/多行输入冲突。

### Cancel / close

- Hidden/subtle close affordance 与 Esc 绑定。
- 语义：取消 mark 创建。
- 无内容：Esc / close 直接取消。
- 有内容：第一次 Esc/close 显示 inline hint `Press Esc again to discard`；第二次丢弃。
- 不使用传统 confirm dialog。

### Kind behavior

Locked decisions：

- 默认 `other`。
- Kind 是 secondary。
- Submit 主按钮永远是保存，不被 kind selector 抢占。
- Kind theme 影响 accent，不覆盖 status。
- Kind 必须可键盘选择。

Open visual exploration：

- kind selector 展开形态不锁定。
- 可探索 popover list / segmented palette / radial-ish / command-like 等方案。
- 具体快捷键不锁定；基础 a11y 通过 Tab/Enter/Arrow/Esc 保证。

### Save success transition

保存成功后：

- 不显示 toast。
- Intent input 的 submit/kind accent 轻微收束到 target corner pin。
- Pin 出现并进入 `open` 状态。
- 默认退出 picker mode。
- 短暂显示低噪声 affordance：`Add another`，允许快速继续。

本地保存失败才在 input 内显示 inline error。

Daemon offline 不视为创建失败；显示 local-only 状态。

## 7. Surface 5 — Pin

### Purpose

Pin 是页面上的低噪声 mark anchor，连接 mark 与 DOM target。

### Default shape

默认 pin 只显示：

- display number
- kind theme accent

不常驻显示完整状态。

### Positioning

Pin 锚定 target rect 的最少遮挡角。

规则：

- 优先外侧角。
- 空间不足时内侧角。
- 始终保持 viewport 内可见。
- 避免遮挡目标关键内容。
- 和 target/selection frame 保持几何关系。

### Hover/focus tooltip

Tooltip 不可交互，只展示 compact status。

正常：

```text
open · located 100% · synced
```

Other examples：

```text
done · located 100% · synced
open · drifted 62% · local only
open · lost · synced
```

点击 / keyboard activate pin 打开 Pin detail。

### Done/resolved behavior

Resolve 不等于 delete。

- Mark done 后 pin 进入 `done` 低存在感状态。
- Pin 不默认消失。
- View all 默认 open，可切换查看 done/resolved。
- 用户可选择隐藏 done marks，但不是默认语义。

### Drifted/lost behavior

- Located target：pin 跟随当前 target rect。
- Drifted/lost：不静默指错。
- Pin 显示 warning marker。
- Tooltip/detail/View all 明确 `drifted 62%` / `lost`。
- Lost 可保留在最后已知位置或只在 View all 中显示，但必须显式 lost。

### Many pins

- 只渲染 viewport 附近 pins。
- 相近 pins 自动 stack。
- Stack 显示数量，例如 `3`。
- Stack hover/click 打开 mini stack popover。

## 8. Surface 6 — Pin detail

### Purpose

Pin detail 是单个 mark 的极简任务卡，不是 DevTools inspector。

### Opening

- 点击 pin 打开 popover detail。
- Popover 贴近 pin/target。
- 不默认打开 side panel。

### Information hierarchy

任务优先：

1. tiny target label：弱化，例如 `button “Save”` / `div.relative.flex`
2. comment：主内容
3. compact metadata row：`open · located 100% · synced · style`
4. actions

不使用旧表格式字段布局作为主形态。

### Actions

Primary：

- `Mark done`

Secondary：

- `Copy Markdown`

Danger / low frequency：

- `Delete`，低强调或更多菜单

### Mark done behavior

- 不需要确认。
- 点击后 action 调用 `resolve_mark`。
- Button 原位变 check / `Done`。
- Pin 状态 transition 为 done。
- 短暂确认后关闭 detail。

### Delete behavior

- 需要二次确认。
- 不使用传统 confirm dialog。
- 点击 Delete 后原位变 `Delete?` / `Confirm delete`。
- 二次点击执行 delete/tombstone。
- Esc、移开或超时恢复。
- 执行后显示 `Deleted`，随后 detail 关闭、pin 移除。
- 不做 Undo toast。

### Copy Markdown behavior

- 点击后按钮原位短暂变 `Copied` / check icon。
- 失败则原位显示 `Copy failed`，可重试。
- 不使用 toast。

### Archived

- UI 能显示 `archived`。
- 本轮不提供 Archive action。

## 9. Surface 7 — View all

### Purpose

View all 是当前页面/route/session 的轻量 mark list，不是完整管理后台。

### Entry points

- 有 pin：pin hover/detail 提供 `View all`。
- 无 pin：picker active 时显示极小 hint。
- 快捷键可打开/关闭；建议后续实现阶段确认。
- Browser popup 可作为外部入口，但不是本轮 in-page 主体。

### Default filter

默认显示当前 route/session 的 open marks。

- done/resolved 通过 toggle 查看。
- 不默认跨 route/project 展示。
- 不做 search。
- 不做 bulk resolve/delete。

### Header

显示：

- current Project（低噪声）
- current route/session context（如需要）
- open count
- resolved toggle

### Empty state

```text
No marks on this page
Pick an element to create one.
```

可提供 `Start picking`。

### Mark item layout

第一行：编号 + comment。

```text
#3  Fix button alignment
```

第二行弱化：

```text
button “Save” · style · located 100% · synced
```

### Copy all Markdown

- 正常状态：次级按钮。
- daemon offline / no MCP / sync failed：提升为明显 fallback CTA。
- 不阻止保存/浏览。

### Delete in list

和 Pin detail 一致：二次确认。

## 10. Surface 8 — Page-level status / fallback

### Purpose

表达 local-first / sync / MCP 可用性，不打断 mark 创建。

### Daemon offline / no MCP

应强调仍可保存：

```text
Saved locally. Agent sync unavailable.
Copy Markdown to hand this mark to an agent.
```

避免：

```text
Error: daemon offline
```

### Severity

- Daemon offline：弱提示，保存仍成功。
- Sync failed：mark/detail/View all 中显示 `sync failed`，提供 retry + Copy Markdown。
- No MCP：View all / fallback 区域提示 Copy Markdown。
- Token/auth 严重阻断 Agent read：View all 顶部小提示，不用全页 banner。

### Feedback model

不建立 toast system。

反馈就地发生：

- button state
- inline token
- pin transition
- card state

## 11. Keyboard model

### Picker active

| Key | Behavior |
| --- | --- |
| Tab | next candidate |
| ↑ | parent target |
| ↓ | child target |
| Enter | confirm current target |
| Esc | exit picker and restore prior focus |

### Intent input

| Key | Behavior |
| --- | --- |
| ⌘/Ctrl + Enter | save mark |
| Esc | cancel; if content exists, first Esc asks inline, second discards |
| Tab | normal focus traversal |
| Arrow keys | text navigation unless kind selector open |

Kind selector shortcut remains open. Requirement: kind selector must be keyboard-openable and keyboard-selectable.

### Pin / Pin detail / View all

| Key | Behavior |
| --- | --- |
| Enter/Space on pin | open Pin detail |
| Esc in detail | close detail |
| Esc in View all | close View all |
| Tab | normal focus traversal |
| Arrow keys | list navigation where appropriate |

Danger actions require local confirmation.

## 12. Accessibility requirements

- Picker can be completed fully with keyboard.
- Intent input, Pin detail, and View all have reasonable focus management.
- Esc closes active surface and restores prior focus where applicable.
- Icon buttons have accessible labels.
- Status is never color-only.
- Kind theme is not the only carrier of meaning.
- Motion preferences reduce speed/amplitude/elasticity but preserve continuity.
- Transparency preferences / unsupported backdrop-filter fall back to solid surfaces.
- Tooltip content is not required for completing critical actions.

## 13. Visual system decisions locked for implementation

### Locked interaction decisions

- Invisible-until-needed.
- No constant large toolbar / launcher.
- Project chooser appears before picker when origin has multiple projects.
- Picker selects one real DOM target.
- Selection frame uses rect morph continuity.
- Label/breadcrumb use semantic-first, selector fallback.
- Intent input is compact, comment-first, auto-growing.
- Kind defaults to `other` and is secondary.
- Kind theme exists but does not override status.
- Submit is always save.
- Empty comment cannot save.
- Save success transitions input into pin.
- Default after save exits picker, with low-noise Add another affordance.
- Pin default shows number + kind accent only.
- Pin tooltip is non-interactive compact status.
- Pin detail is comment-first task card.
- Resolve UI label is `Mark done`; no confirmation.
- Delete requires local second confirmation.
- View all defaults to current route/session open marks.
- Copy Markdown is fallback; elevated only when sync/MCP unavailable.
- No toast system in this round.

### Open visual exploration items

后续多样式 UI 生成阶段再决定：

- Kind selector shape: popover list / segmented palette / radial-ish / command-like / other
- Submit icon exact form
- Pin exact shape
- Detail card visual style
- View all panel style
- Kind theme exact color tokens
- Surface radius / shadow / border style
- Blur/translucency strength
- Motion timing/easing exact values
- Font sizing/density scale
- Visual direction set

## 14. Implementation constraints affecting design

- All in-page surfaces render inside Shadow DOM.
- Do not insert UI inside the target element.
- Do not mutate host page layout.
- Shadow host default should not swallow all page interaction; active controls opt into pointer events.
- Picker active allows scroll but prevents host click/activation.
- Loupe surfaces must remain visible above page content without becoming full-page obstruction.
- Avoid host outside-click false positives where possible.
- Do not depend on host page CSS.
- Avoid large-area blur, complex filters, and heavy shadows as core layer mechanism.
- High-frequency pointer move must not queue animations indefinitely.

## 15. Performance boundaries

“Silky” is a correctness requirement, not only aesthetics.

- Pointer move must not perform unbounded DOM full-tree scans.
- Target resolution and frame animation should be separated.
- Selection frame updates should use geometry interpolation and compositor-friendly transforms where possible.
- Frame animation must interrupt and retarget cleanly; animations must not queue behind high-frequency pointer movement.
- Avoid repeated layout thrash during hover.
- Large pages should degrade gracefully: keep selection feedback responsive even if deep evidence collection is delayed.
- Many pins should render only viewport-near surfaces and stack close pins.
- Avoid large-area backdrop blur, complex filters, and long shadows on every frame.
- `prefers-reduced-motion` reduces velocity/amplitude/elasticity but keeps spatial continuity.

## 16. Design acceptance scenarios

These are user-observable design acceptance scenarios, not framework-specific tests.

### 16.1 Host authorization

Given the current host is not authorized, Loupe shows a minimal authorization CTA. After the user grants permission, picker can start. If permission is denied, no picker is injected and the UI stays low-noise.

### 16.2 Project ambiguity

Given the same origin maps to multiple projects, Loupe asks the user to choose a Project before picker starts. After selection, the chosen Project is visible in low-noise contexts and Loupe does not ask again for every mark.

### 16.3 Picker mouse selection

Given picker is active, moving across DOM targets morphs one Selection frame between target rects. Clicking a target opens Intent input and does not trigger the host page's click handler.

### 16.4 Picker keyboard selection

Given picker is active, the user can use Tab, ↑, ↓, Enter, and Esc to select or exit without using a mouse. Breadcrumb feedback makes parent/child target changes understandable.

### 16.5 Intent input validation

Given Intent input is open with empty comment, save is disabled. A keyboard save attempt shows inline guidance. Once the user writes a comment, `⌘/Ctrl + Enter` saves.

### 16.6 Kind default and theme

Given the user does not choose kind, the mark is saved as `other`. If the user chooses another kind, the kind theme affects accent surfaces but status remains text/icon/token based.

### 16.7 Save success

Given a valid comment, saving transitions the Intent input into a Pin anchored to the selected target. No toast appears. Picker exits by default, with a low-noise way to add another mark.

### 16.8 Daemon offline

Given daemon is unavailable, saving still succeeds locally. UI shows `local only` and offers Copy Markdown fallback without presenting daemon offline as a hard creation failure.

### 16.9 Pin detail actions

Given a pin exists, activating it opens Pin detail. `Mark done` changes the mark to done without confirmation. Delete requires local second confirmation. Copy Markdown confirms in-place.

### 16.10 View all

Given View all opens, it defaults to current route/session open marks. Done marks are hidden behind a toggle. Copy all Markdown is available and becomes more prominent when MCP/sync is unavailable.

### 16.11 Drift/lost

Given a mark target can no longer be confidently located, Loupe displays `drifted` or `lost` explicitly in pin/detail/View all and does not silently anchor the mark to a wrong element.

## 17. Later visual direction generation

后续多样式 UI 生成阶段应生成 **整套 visual direction**，不是单组件拼装。

每套必须覆盖：

- Host authorization CTA
- Project chooser
- Picker / Selection frame
- Intent input
- Pin
- Pin detail
- View all
- Page-level status/fallback

Recommended spread：

1. Precision Minimal：极简系统控件
2. Soft Glass：轻 glass，高级但克制
3. Command Line Native：像 agent command surface
4. Radical Concept：更有记忆点，用来提炼灵感，不一定直接实现

所有方案仍必须满足 locked interaction decisions、a11y、performance、Shadow DOM constraints、low-noise defaults。
