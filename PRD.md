# PRD — 把页面上的“指一下”变成 Agent 能精确读取的工程任务

> 产品工作代号 **Loupe**（珠宝放大镜，寓意“精密检视后再钉选”）。名称为占位，可替换。  
> 文档状态：**Draft v0.2** ｜ 日期：2026-05-31 ｜ 作者：—  
> 一句话定位：**在本地开发页面上精确“钉选（pin）”一个 DOM 元素并写下意图，让 AI 编码 Agent 通过 MCP 精确读取该元素的定位与上下文。**

---

## 0. TL;DR

Loupe 的 MVP 只服务一条信任闭环：

> **pick → robust locate/recover → persist/sync → low-noise Agent read → resolve**

它不是网页批注工具，不是截图标注工具，也不是页面内设计编辑器。它是把“我在浏览器里指的这个真实 DOM 元素”转换成 Agent 可执行、可复核、可完成的结构化任务。

MVP / Trust Core 的边界很窄：浏览器扩展负责精确拾取真实 DOM、采集 robust locator/context、本地保存与最小 pin 反馈；本地 daemon 负责 JSON 镜像、loopback auth、Agent-readable MCP；Agent 读取 mark、完成修改后默认调用 `resolve_mark` 关闭任务。

组成部分：

| 组件          | 包名                    | 职责                                                                                                                      |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 浏览器扩展    | `@loupe/extension`      | Chrome MV3。picker、composer、locator/context capture、minimal pin overlay、`chrome.storage.local` 本地优先存储           |
| 本地 daemon   | `@loupe-server/server`  | 监听 `127.0.0.1:7373`。暴露 authenticated `/v1/marks*` 与 `/mcp`，维护 `~/.loupe/marks.json` 镜像；并提供 `mcp-proxy` 子命令 |
| 共享 schema   | `@loupe-server/shared`  | wire schema 权威来源：storage key、Annotation/AgentMark、locator、MCP 契约；扩展、daemon、插件共用                        |
| Claude 插件包 | `@loupe/claude-plugin`  | 最小安装路径：启动 daemon、注册 MCP proxy、提供 `/loupe:marks` 与 mark-resolver agent；marketplace 发布放到 Launch polish |
| Codex 插件包  | `@loupe/codex-plugin`   | Codex 分发路径：`loupe-marks` skill、stdio MCP proxy、SessionStart hook；与 Claude 插件共享同一 daemon/MCP                |

参考项目经验只在有助于决策时引用：vibe 验证了多策略 selector、element context、本地优先、异步 server sync、storage lock、atomic JSON write、tombstone、raw/agent payload 分层、project-scoped Agent read、copy/export fallback、CLI status/init/logs；DOM-Review 验证了 Agent-readable surface、MAIN/ISOLATED world 分工、Shadow UI 与 overlay marker，同时暴露出单 selector、弱 recovery、弱权限与 iframe/SVG/canvas/keyboard 边界问题。

---

## 1. 背景与问题

### 1.1 今天的断裂

前端开发者在浏览器里看到一个 UI 问题，要交给 AI 编码 Agent 时，通常必须做一次有损翻译：

```text
看到问题 → 切回编辑器/聊天框 → 描述“右上角那个蓝色按钮”
→ Agent 猜组件/文件 → 可能改错 → 来回澄清
```

丢失的信息包括：确切 DOM 节点、它的上下文、稳定定位方式、当前路由/项目、可访问名称、框架组件线索，以及“这个任务是否已经完成”。

### 1.2 Loupe 要消除的步骤

```text
指一下真实 DOM → 写一句意图 → Agent 读取 project-scoped mark
→ 根据 locator/context 找代码并修改 → resolve_mark
```

核心不是“画框”，而是**让 Agent 低噪声、可验证地知道用户指的是哪个元素**。如果定位信心不足，Loupe 必须显式给出 `drifted` / `lost`，而不是静默指错。

---

## 2. 产品原则

1. **定位即信任。** 指错一次，用户就会回到自然语言描述。Loupe 宁可显示 drifted/lost，也不假装找到了。
2. **任务完成默认 resolve，不默认 delete。** `resolve_mark` 是 Agent 完成工作的默认闭环；`delete_mark` 只代表用户明确删除，不用于“完成任务”。
3. **project/session 隔离是安全边界。** mark 不能只按 route 存取；MCP mutation 不能跨项目 bare-id 执行。
4. **本地优先，daemon 镜像。** 交互真相源是 `chrome.storage.local`；daemon 是 Agent bridge 与磁盘镜像。
5. **Agent payload 低噪声。** raw storage 保存足够证据；MCP 返回只包含 Agent 当前决策需要的信息。
6. **默认安全。** Loopback 接口必须带 token；页面脚本没有任何无 token 写入口。
7. **MVP 不追求全套 polish。** marketplace、完整 onboarding、主题/动效 polish、rich toolbar、截图、watch、design-edit preview 都不进入 Trust Core。

---

## 3. 用户与核心场景

### 3.1 目标用户

- **主要用户：** 在 `localhost` / 本地预览环境中使用 Claude Code、Pi、Cursor 等 Agent 开发前端的工程师。
- **次要用户：** 设计/PM 在本地预览页面上留下精确反馈，由工程师的 Agent 执行。

### 3.2 Golden Path

```text
1. 开发者运行本地应用，例如 http://localhost:5173。
2. 安装 Loupe 扩展与最小 Claude 插件；插件 SessionStart 通过 /health 检查 daemon，未运行则拉起。
3. 扩展检测当前 host 已授权，生成 project_id / route_key / session_id。
4. 用户按 ⌥L 进入拾取模式；鼠标或键盘选择真实 DOM，↑/↓ 微调父子层级，Enter 确认。
5. Composer 自动聚焦；用户输入意图，⌘/Ctrl+Enter 保存。
6. mark 写入 project-scoped `chrome.storage.local`，pin 显示为 open + sync 状态；扩展 best-effort 同步到 daemon。
7. Agent 调 `list_marks` / `get_mark`，读取低噪声 project-scoped payload。
8. Agent 修改代码并验证后调用 `resolve_mark`；浏览器 pin 进入 resolved。
```

---

## 4. Scope 与 Roadmap

### 4.1 MVP / Trust Core

MVP 只包含完成信任闭环所必需的能力：

1. **Picker**
   - 鼠标 hover 高亮、尺寸/盒模型提示。
   - 键盘 first-target traversal 与父/子微调（见 §9.2）。
   - Open Shadow DOM 穿透；扩展自身 UI 排除。

2. **Composer**
   - 必填 `intent.comment`。
   - 可选 `intent.kind`：`bug | copy | style | layout | question | other`。

3. **Locator bundle**
   - 多证据采集：selector、stable attrs、role/name、text hash、parent chain、geometry、shadow path、same-origin iframe `frame_path` 等。
   - wire/storage JSON 使用 snake_case；TypeScript domain 可包一层 camelCase adapter，但 wire schema 是权威。

4. **Scoring resolve**
   - 实现 `resolve(locator, root) -> ResolveResult`。
   - 输出 `locator_status`、`confidence`、`matched_by`，并执行 ambiguity downgrade（见 §7）。

5. **Drift recovery**
   - rerender、DOM detach、route change 后恢复；不可恢复时显式 drifted/lost。
   - route epoch + route_key snapshot cancellation，禁止 stale route pin commit。

6. **Minimal pin overlay**
   - Shadow DOM overlay；编号、任务状态、locator 状态、sync 状态。
   - 不做完整 toolbar polish，只保留 View all / copy / server status 的最小入口。

7. **Local-first storage**
   - `chrome.storage.local` project-scoped key。
   - 应用层 storage lock；delete tombstone；per-mark sync status。

8. **Daemon JSON mirror**
   - `~/.loupe/marks.json` atomic write。
   - `/health`、authenticated `/v1/marks*`、authenticated `/mcp`。

9. **Loopback auth**
   - `~/.loupe/token` pairing token。
   - `~/.loupe/server.json` status file，包含 pid/port/token path。

10. **MCP tools**
    - `list_marks`、`get_mark`、`resolve_mark`、`delete_mark`。
    - 所有读取/写入必须带 project scope；id mutation 不能 bare-id 跨项目执行。

11. **Markdown copy fallback**
    - 当前 session / route 的 open marks 可复制为 Markdown，供不支持 MCP 的 Agent 使用。

12. **Minimal Claude install path**
    - 插件可启动 daemon、注册 MCP proxy、提供命令/agent。
    - Marketplace 发布不是 MVP。

### 4.2 Launch polish

Trust Core 稳定后再做：

- Claude plugin marketplace 发布。
- 完整 onboarding 分支与错误恢复引导。
- 主题、motion、rich toolbar、pin detail 的视觉 polish。
- 更完整的 CLI 文案、日志 UI、安装诊断。

### 4.3 Non-goals

以下明确不进入 MVP：

- `pending_changes` / 页面内设计值预览 / 可逆 patch。
- 默认截图捕获；截图只作为 Phase 2 lazy media。
- `watch_marks` / Agent 阻塞等待新 mark。
- team/cloud sync、多设备冲突合并。
- SDK / embed 形态。
- Firefox/Safari 多浏览器。
- discussion replies / Agent 写回讨论线程。
- 保证 DOM→源码 file:line 精确映射；`source_hint` 永远只是辅助线索。

### 4.4 Roadmap

| 阶段             | 主题                       | 内容                                                          |
| ---------------- | -------------------------- | ------------------------------------------------------------- |
| MVP / Trust Core | 精确指、稳定位、Agent 闭环 | §4.1 全部                                                     |
| Launch polish    | 发布与体验打磨             | marketplace、完整 onboarding、主题/motion/rich toolbar        |
| Phase 2          | 更强 Agent 工作流          | lazy screenshot、watch、replies、generic client config helper |
| Phase 3          | 页面内设计工作流           | `pending_changes`、design token 映射、preview/undo            |
| Phase 4          | 团队化                     | cloud sync、字段级 merge、审计、共享 mark                     |

---

## 5. Project / Session Isolation

### 5.1 标识定义

Loupe 的隔离单位不是单纯 URL route，而是 project + branch + route 组合：

```ts
type ProjectScope = {
  project_id: string; // stable hash，见下
  workspace_root_hash: string; // workspace root 规范路径 hash；无法获取时用 user-confirmed project slug hash
  branch?: string; // git branch；无法获取时省略
  origin: string; // http://localhost:5173
  route_key: string; // origin + pathname + normalized query + optional app route name
  session_id: string; // hash(project_id + "\n" + (branch ?? "") + "\n" + route_key)
};
```

`project_id` 由 daemon/CLI 与扩展共同确认：

1. 首选：daemon 通过当前 Agent workspace 推断 `workspace_root_hash`，扩展用 origin 与用户确认的项目绑定。
2. 无 Agent workspace 时：扩展创建临时 project，要求用户在 onboarding 中命名/确认；daemon 后续可合并。
3. 同一 `origin` 可对应多个 `project_id`，因此 MCP 不能只用 URL 判断项目。

### 5.2 Storage key contract

所有本地存储 key 必须包含 project scope：

```text
loupe:v1:projects:index
loupe:v1:project:{project_id}:sessions:index
loupe:v1:project:{project_id}:session:{session_id}:marks
loupe:v1:project:{project_id}:tombstones
loupe:v1:settings
```

禁止使用全局 `marks` 数组或仅 route-scoped key。

### 5.3 MCP scope contract

- `list_marks` 必须至少传入 `project_id`，或传入足以唯一推断项目的 `workspace_root_hash` / `url` / `route_key` 组合。
- 如果过滤条件命中多个 project，返回 `MULTI_PROJECT` 错误和候选 scope，不返回混合 marks。
- `get_mark`、`resolve_mark`、`delete_mark` 必须传入：
  - `id`；以及
  - `project_id`，或 `url`/`route_key` assertion，且 assertion 必须与 mark 的 project/session 匹配。
- 任何 id-based mutation 都不能在缺失 project assertion 时执行，即使 id 是 UUID。

---

## 6. 系统架构

```text
┌──────────────────────────── Chrome MV3 Extension ───────────────────────────┐
│ MAIN world                                                                  │
│  └─ bridge-introspect.ts：只读框架检测；nonce-gated，一次请求后解绑             │
│                                                                              │
│ ISOLATED world                                                               │
│  Picker → LocatorCapture → ContextCapture → Composer                         │
│     ↓          ↓                  ↓             ↓                            │
│  DriftRecovery ← RouteObserver ← PinOverlay ← StoreClient                    │
│                                            ↓                                 │
│                          chrome.storage.local（project-scoped truth）         │
│                                            ↓ best-effort authenticated sync   │
└────────────────────────────────────────────┼────────────────────────────────┘
                                             │
┌──────────────────────────── Local daemon ──▼────────────────────────────────┐
│ 127.0.0.1:7373                                                              │
│  /health                         anonymous                                  │
│  /v1/marks*                      Bearer token required                       │
│  /mcp                            Bearer token required                       │
│                                                                              │
│ ~/.loupe/token                   pairing token                               │
│ ~/.loupe/server.json             { pid, port, token_path, started_at }        │
│ ~/.loupe/marks.json              atomic JSON mirror                          │
└────────────────────────────────────────────┬────────────────────────────────┘
                                             │
┌──────────────────────────── Agent / Plugin ─▼───────────────────────────────┐
│ Claude plugin SessionStart: /health port check, start if absent              │
│ .mcp.json: stdio MCP proxy reads ~/.loupe/token and forwards to daemon /mcp   │
│ Generic MCP clients may connect directly to daemon /mcp with Authorization    │
└──────────────────────────────────────────────────────────────────────────────┘
```

关键决策：

1. **MAIN vs ISOLATED world 分工。** MAIN world 只做只读框架/组件线索采集；Agent 读写不经过页面 `window` API。
2. **Extension UI 全部 Shadow DOM 隔离。** Overlay 不插入目标元素内部，不改变宿主布局。
3. **Daemon 固定默认端口。** MVP 固定 `7373`，用 `/health` 判断是否已有 Loupe daemon；动态端口/service discovery 不进 MVP。
4. **HTTP daemon + MCP proxy。** Daemon 保留 MCP-over-HTTP 供 generic client；Claude 插件通过本地 stdio proxy 注入 token，避免在 `.mcp.json` 明文写 token。

---

## 7. Locator Scoring 与 Drift Recovery

### 7.1 Wire contract

```ts
type ResolveResult = {
  element: Element | null;
  locator_status: "resolved" | "drifted" | "lost";
  confidence: number; // 0..1
  matched_by: string[]; // 人/Agent 可读 evidence，例如 ["primary_selector", "role_name", "parent_chain"]
  candidates_considered: number;
  ambiguity?: {
    top_1: number;
    top_2: number;
    reason: "close_score" | "duplicate_evidence";
  };
};

function resolve(
  locator: Locator,
  root: Document | ShadowRoot | Element,
): ResolveResult;
```

### 7.2 Locator bundle

采集时必须保存多证据 bundle，而不是只保存 selector：

```ts
type FrameLocatorPath = {
  selector: string;
  index?: number;
  name?: string;
}[];

type Locator = {
  frame_path?: FrameLocatorPath; // same-origin iframe chain；顶层文档省略
  primary: { selector: string; strategy: SelectorStrategy };
  alternates: { selector: string; strategy: SelectorStrategy }[];
  evidence: {
    stable_attrs?: Record<string, string>;
    stable_id?: string;
    tag: string;
    role?: string;
    accessible_name?: string;
    classes?: { stable: string[]; total: number };
    text?: { normalized: string; hash: string; length: number };
    nth_path: string;
    parent_chain: {
      tag: string;
      role?: string;
      stable_attr?: string;
      stable_class?: string;
    }[];
    shadow_path?: string[];
    geometry?: {
      x: number;
      y: number;
      width: number;
      height: number;
      viewport_width: number;
      viewport_height: number;
      dpr: number;
    };
  };
};
```

Selector 策略级联：

1. shadow host chain + internal selector。
2. stable attributes：`data-testid` / `data-cy` / `data-qa` / `data-component` / `name`。
3. stable id（过滤 UUID/数字尾缀/hash/css-module）。
4. role + accessible name。
5. stable class combination（过滤 utility/hash class）。
6. tag + normalized text/hash。
7. parent stable selector + child selector。
8. robust `nth-of-type` path。
9. geometry + text fallback。

### 7.3 Candidate collection

`resolve()` 收集候选时使用 union set，去重后评分：

- `primary.selector` 与 `alternates` query。
- `stable_attrs` exact match。
- `stable_id` exact match。
- role/accessibility query（role + accessible name）。
- tag + text exact/hash/fuzzy match。
- stable class subset/Jaccard match。
- parent_chain anchor 下的 descendant candidate。
- nth_path candidate。
- geometry neighborhood candidate（只作兜底，不能单独 resolved）。

候选收集必须限制上限（例如每策略 100，总 500），超过上限时记录 `matched_by`/debug reason 并降级信心，避免大页面卡死。

### 7.4 Primary selector fast path

若 `primary.selector` 在当前 root 下唯一命中，仍必须验证最少证据：

- tag match 必须通过；
- captured text / role / stable attr 中只要 mark-time 存在任一项，至少一项必须通过；
- geometry 只作为 sanity check，不因布局轻微变化失败。

通过则可直接返回高 confidence（起始 0.95–1.0）并写入 `matched_by: ['primary_selector', ...validated_evidence]`。未通过则进入完整 candidate scoring，不可盲信 primary selector。

### 7.5 Weighted scoring

起始权重：

| Evidence                 |             Weight |
| ------------------------ | -----------------: |
| stable_attrs exact       |               0.35 |
| stable_id exact          |               0.25 |
| role + accessible_name   |               0.20 |
| text exact/hash/fuzzy    | 0.20 / 0.15 / 0.08 |
| stable class Jaccard     |             ≤ 0.15 |
| parent_chain similarity  |             ≤ 0.15 |
| tag match                |               0.05 |
| geometry IoU / proximity |             ≤ 0.10 |
| nth_path match           |               0.05 |

Missing-evidence policy：

```text
score = matched_weight / available_weight
```

只有 mark-time 实际采集到的 evidence 才进入 `available_weight` 分母。不存在的 `stable_id`、空文本、不可访问 role、缺失 geometry 不惩罚候选。这样可避免“按钮没有 text/id”时系统性低分。

### 7.6 Ambiguity downgrade 与阈值

起始阈值：

| 条件                        | locator_status | 行为                                     |
| --------------------------- | -------------- | ---------------------------------------- |
| score ≥ 0.60 且无 ambiguity | `resolved`     | pin 正常锚定                             |
| 0.40 ≤ score < 0.60         | `drifted`      | 可锚定最优候选，但 UI/Agent 必须提示复核 |
| score < 0.40 或无候选       | `lost`         | 不锚定元素                               |

Ambiguity downgrade：

- 若 top-1 与 top-2 分差 `< 0.10`，或两者 `matched_by` 基本相同且都 ≥ 0.60，则从 `resolved` 降级为 `drifted`。
- `matched_by` 必须解释证据来源；不能只返回 `['score']`。
- 阈值是起始值，必须由 locator robustness suite 标定；KPI 以 suite 结果为准，不以主观演示为准。

### 7.7 Route recovery state machine

```text
stable(resolved/drifted/lost)
  ├─ route_change_detected → route_pending(epoch++, snapshot_route_key)
  ├─ target_detached → dom_pending(current_epoch)
  └─ explicit_resolve/delete → lifecycle update

route_pending
  ├─ DOM quiet window satisfied → resolving(epoch, snapshot_route_key)
  ├─ new route change → route_pending(new_epoch, new_snapshot)
  └─ timeout 1500ms → resolving(epoch, snapshot_route_key)

resolving
  ├─ current route_key != snapshot_route_key → cancel, no pin commit
  ├─ epoch != current_epoch → cancel, no pin commit
  ├─ ResolveResult resolved/drifted/lost → commit target.resolution for same epoch
  └─ new route change → cancel
```

DOM quiet window：默认连续 250ms 无 high-impact mutation，或最长等待 1500ms。Route observer 输入包括 `popstate`、`hashchange`、Navigation API、history monkey patch、root subtree mutation。任何 stale route 结果都不能提交 pin 位置。

### 7.8 Support matrix

| Surface                  | MVP 支持 | 行为                                                                                  |
| ------------------------ | -------: | ------------------------------------------------------------------------------------- |
| Same-origin iframe       |       ✅ | content script 注入 frame；locator 带 `frame_path`；MCP payload 标明 frame            |
| Cross-origin iframe      |  ⚠️ 部分 | 只能 pin iframe element 本身；不能读取内部 DOM；UI 提示 “cross-origin frame boundary” |
| SVG                      |       ✅ | 支持 `SVGElement` bbox、tag/attrs/text；geometry 以 SVG bbox + viewport 转换为准      |
| Canvas                   |  ⚠️ 外壳 | 只能标 canvas 元素，不支持 canvas 内部像素对象；composer 提示限制                     |
| Open Shadow DOM          |       ✅ | `composedPath()` + `shadow_path`                                                      |
| Closed Shadow DOM        |  ⚠️ 外壳 | 只能标 shadow host；不能承诺内部元素定位                                              |
| Portals / teleports      |  ✅ 基础 | 以实际 DOM 位置为准，parent_chain 记录真实宿主；framework hint 可说明 portal          |
| Nested scroll containers |       ✅ | pin position 使用 viewport rect + scroll observer；测试覆盖多层滚动                   |

---

## 8. Annotation Schema 与 Storage/MCP 命名

### 8.1 命名规则

- JSON storage、MCP payload、export/import 全部使用 **snake_case**。
- TypeScript domain code 可用 adapter 包装为 camelCase，但不得改变 wire 字段语义。
- 只有持久化 envelope 与 `Annotation` 携带 `schema_version`；`Locator`、`ResolveResult`、`AgentMark` 等 wire type 只要求 snake_case，不强制版本字段。

### 8.2 Annotation schema

```ts
type Annotation = {
  schema_version: 1;
  id: string; // crypto.randomUUID()

  project: {
    project_id: string;
    workspace_root_hash: string;
    branch?: string;
    origin: string;
    url: string;
    route_key: string;
    session_id: string;
    title?: string;
  };

  target: {
    locator: Locator;
    resolution: {
      locator_status: "resolved" | "drifted" | "lost";
      confidence: number;
      matched_by: string[];
      resolved_at: string; // last locator resolution time, not task completion time
    };
  };

  intent: {
    comment: string;
    kind: "bug" | "copy" | "style" | "layout" | "question" | "other";
  };

  context: {
    element: {
      tag: string;
      id?: string;
      role?: string;
      accessible_name?: string;
      classes?: string[];
      text?: string;
      selector_preview: string;
    };
    a11y?: {
      role?: string;
      label?: string;
      described_by?: string;
      tab_index?: number;
      expanded?: boolean;
    };
    layout?: {
      display?: string;
      position?: string;
      box_sizing?: string;
      flex_direction?: string;
      gap?: string;
    };
    framework?: {
      name: "react" | "vue" | "svelte" | "angular" | "solid" | "unknown";
      component?: string;
      source_hint?: { file?: string; line?: number; confidence: number };
    };
    viewport: { width: number; height: number; dpr: number };
    position: { x: number; y: number; width: number; height: number };
  };

  sync: {
    status: "local_only" | "syncing" | "synced" | "failed" | "delete_pending";
    last_synced_at?: string;
    last_error?: string;
    retry_count: number;
  };

  media: {
    has_screenshot: boolean;
    screenshot_id?: string; // Phase 2 lazy fetch
  };

  replies: {
    items: { author: "user" | "agent"; text: string; at: string }[]; // Phase 2
  };

  lifecycle: {
    task_status: "open" | "resolved" | "archived";
    created_at: string;
    updated_at: string;
    task_resolved_at?: string; // set by resolve_mark
    deleted_at?: string; // tombstone for explicit delete_mark
  };
};
```

### 8.3 Lifecycle vs locator status

Task lifecycle 与 locator resolution 是不同维度：

| 维度     | 字段                               | 含义                               |
| -------- | ---------------------------------- | ---------------------------------- |
| 任务状态 | `lifecycle.task_status`            | 用户/Agent 是否还需要处理这条 mark |
| 定位状态 | `target.resolution.locator_status` | 当前 DOM 是否还能可信定位原目标    |
| 同步状态 | `sync.status`                      | 本地 mark 是否成功镜像到 daemon    |

允许组合示例：

- `task_status=open` + `locator_status=drifted`：任务未完成，但目标可能漂移，Agent 需谨慎。
- `task_status=resolved` + `locator_status=lost`：任务已完成，页面后来变化导致目标找不到；不重新打开任务。
- `sync.status=failed`：UI 保留本地 mark，并显示 retry/copy fallback。

### 8.4 Per-mark sync UX

| sync.status      | UI / 行为                                                       |
| ---------------- | --------------------------------------------------------------- |
| `local_only`     | 已本地保存，等待首次同步；pin detail 显示“Agent 可能暂时读不到” |
| `syncing`        | pin detail / View all 显示同步中，不阻塞继续标注                |
| `synced`         | Agent 可读取                                                    |
| `failed`         | 显示 retry 与 Copy Markdown；toolbar server status 标明失败原因 |
| `delete_pending` | 本地 tombstone 已写，等待 daemon 删除镜像；失败时可 retry       |

---

## 9. UX 与 Accessibility

### 9.1 Picker model

拾取模式必须是清晰的 modal interaction：页面边缘描边、cursor 状态、toolbar 状态同时提示。扩展在 capture phase 拦截 `pointerdown` / `click`，避免触发宿主业务事件。

### 9.2 Keyboard first-target model

Loupe 声称键盘可完成拾取，因此必须定义 first target：

1. 进入拾取模式时记录 `previous_active_element`。
2. 若 `document.activeElement` 是可见且非扩展 UI 的 Element，则它是 first target。
3. 否则，按 DOM 顺序选择第一个可见、可交互或有语义的元素；`Tab` / `Shift+Tab` 在候选元素间遍历。
4. 鼠标 hover 会把当前 keyboard target 切到 hover target，并重置 traversal cursor。
5. `Enter` 确认当前 target；`Esc` 退出并恢复 `previous_active_element`（若仍 connected）。

### 9.3 Parent/child micro-adjust stack

微调不是简单“选 parent / child”，而是维护 target stack：

- 初始 stack = `[first_target]`。
- `↑`：若当前 target 有可标注 parent，push parent。
- `↓`：若 stack 长度 > 1，pop 回上一个 child；否则尝试进入当前 target 下最接近 pointer/keyboard focus 的 child。
- 鼠标移动、Tab traversal、route change、Esc、保存成功都会 reset stack。
- UI 显示 breadcrumb：`button > span > svg`，并标明当前层级。

### 9.4 Composer

- 就近浮现，自动避让 viewport。
- `intent.comment` 必填；`kind` 可选，默认 `other`。
- 自动 focus 输入框；`⌘/Ctrl+Enter` 保存；`Esc` 取消并回到拾取前 focus。
- 保存后 pin 进入 `open`，并立即显示 sync status。

### 9.5 Minimal pin detail / View all

MVP pin detail 必须显示：

- 编号、任务状态、locator status、confidence。
- `intent.comment` 与 selector preview。
- sync status 与 retry/copy fallback。
- 操作：Copy Markdown、Resolve（用户手动完成时）、Delete（明确删除）。

View all 按 project/session/route 分组，默认只显示当前 `session_id` 的 open marks，可切换查看 resolved/archived。

### 9.6 Onboarding branches

首次使用根据状态分支：

| 状态                   | 引导                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Claude plugin detected | 显示 “按 ⌥L 标记元素，然后在 Claude 中运行 `/loupe:marks`”                              |
| Generic MCP client     | 显示 daemon `/mcp` URL 与 Authorization 配置提示                                        |
| No MCP                 | 强调 Copy Markdown fallback，不阻塞标注                                                 |
| Host not authorized    | 解释当前 host 未授权，提供 `chrome.permissions.request` 授权入口；未授权前不注入 picker |
| Daemon offline         | 显示 `loupe init` / 插件自动启动状态；mark 仍可 local-only 保存                         |

### 9.7 Accessibility

- Composer 与 panel 使用 ARIA labels、focus trap、Escape close、恢复 focus。
- Pin 状态不能只靠颜色：必须有图标/文字。
- Respect `prefers-reduced-motion`；motion polish 不进入 MVP 的正确性路径。

---

## 10. Daemon Lifecycle、Security 与 Auth

### 10.1 Files

```text
~/.loupe/token        # 0600，随机 32+ bytes base64url token
~/.loupe/server.json  # { "pid": 12345, "port": 7373, "token_path": "~/.loupe/token", "started_at": "..." }
~/.loupe/marks.json   # atomic JSON mirror
~/.loupe/server.log   # daemon logs
```

### 10.2 Startup / discovery

MVP 固定默认端口 `7373`：

1. 插件/CLI 先请求 `GET http://127.0.0.1:7373/health`。
2. 若返回 Loupe health payload，则复用现有 daemon。
3. 若连接失败，则启动 `@loupe-server/server serve --port 7373 --daemon`。
4. 若端口被非 Loupe 进程占用，启动失败并给出明确错误；动态端口发现不进入 MVP。

禁止用 `pgrep` 作为启动守卫；进程名不可靠，且无法证明端口上的服务就是 Loupe。

`/health` 返回示例：

```json
{
  "ok": true,
  "name": "loupe",
  "version": "0.2.0",
  "port": 7373,
  "requires_auth": true
}
```

### 10.3 Auth policy

- `/health` 可匿名访问，只返回非敏感状态。
- `/v1/marks*` 必须要求 `Authorization: Bearer <token>`。
- `/mcp` 必须要求 `Authorization: Bearer <token>`。
- `Origin: null`、无 Origin、localhost 页面 origin、chrome-extension origin 都不能在无 token 时获得写能力。
- CORS allowlist 只控制浏览器是否可发请求，不替代 token auth。
- Token 创建/读取由 daemon/CLI 管理；权限尽量设为 user-only。

### 10.4 Extension pairing

扩展首次同步时：

1. 调 `/health` 检测 daemon。
2. 若无 token，提示用户运行 `loupe init` 或通过插件完成 pairing。
3. Token 不暴露给宿主页面脚本；只保存在扩展 storage 与 daemon token file 中。
4. Token 失效时所有 mark 仍保持 local-first，sync.status 进入 `failed` 并提供 retry/copy。

---

## 11. MCP 与 Claude Plugin

### 11.1 MCP tools

| Tool           | 入参                                                                        | 出参                                    | 语义                                                  |
| -------------- | --------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `list_marks`   | `project_id?`, `workspace_root_hash?`, `url?`, `route_key?`, `task_status?` | `{ project, marks }` 或 `MULTI_PROJECT` | 默认只列 open；不得跨项目混合返回                     |
| `get_mark`     | `id` + (`project_id` 或 `url` + `route_key`)                                | `AgentMark`                             | id + project assertion 必须匹配；缺失或不唯一时拒绝   |
| `resolve_mark` | `id` + (`project_id` 或 `url` + `route_key`), `resolution_note?`            | `{ ok, task_status: 'resolved' }`       | 默认完成路径；设置 `lifecycle.task_status='resolved'` |
| `delete_mark`  | `id` + (`project_id` 或 `url` + `route_key`), `reason?`                     | `{ ok, deleted_at }`                    | 显式用户删除；写 tombstone，不代表完成                |

`AgentMark` 低噪声 payload：

```ts
type AgentMark = {
  id: string;
  project: {
    project_id: string;
    workspace_root_hash: string;
    branch?: string;
    url: string;
    route_key: string;
    session_id: string;
  };
  intent: { comment: string; kind: string };
  target: {
    frame_path?: FrameLocatorPath;
    selector: string;
    selector_preview: string;
    tag: string;
    text?: string;
    classes?: string[];
    path?: string;
    locator_status: "resolved" | "drifted" | "lost";
    confidence: number;
    matched_by: string[];
  };
  framework?: { name: string; component?: string; source_hint?: string };
  media: { has_screenshot: boolean };
  lifecycle: {
    task_status: "open" | "resolved" | "archived";
    created_at: string;
    updated_at: string;
  };
};
```

MCP payload 不返回 raw storage 内部字段、layout 样式全集、token、sync error stack、截图 bytes。

### 11.2 `.mcp.json` auth strategy

Claude 插件采用 **stdio MCP proxy**，proxy 读取 `~/.loupe/token` 并转发到 daemon `/mcp`。这样 `.mcp.json` 不需要明文 token，同时 daemon 仍提供 MCP-over-HTTP 给 generic clients。proxy 由 `@loupe-server/server` 的 `mcp-proxy` 子命令提供。

插件 `.mcp.json` 使用裸 server 名（不带 `mcpServers` 外层；外层由插件加载器注入）：

```json
{
  "loupe": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "@loupe-server/server",
      "mcp-proxy",
      "--url",
      "http://127.0.0.1:7373/mcp"
    ],
    "timeout": 5000
  }
}
```

Generic MCP client 可直接配置 HTTP：

```json
{
  "type": "http",
  "url": "http://127.0.0.1:7373/mcp",
  "headers": {
    "Authorization": "Bearer ${LOUPE_TOKEN}"
  }
}
```

### 11.3 Plugin hook

`hooks/hooks.json` 使用 `/health` 端口检查，不用 `pgrep`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "npx",
            "args": ["-y", "@loupe-server/server", "ensure", "--port", "7373"],
            "timeout": 8,
            "async": true
          }
        ]
      }
    ]
  }
}
```

`@loupe-server/server ensure` 的 contract：请求 `/health`；若不是 Loupe daemon 则启动；写 `~/.loupe/server.json`；确保 `~/.loupe/token` 存在。

### 11.4 Commands / agent examples

`commands/marks.md`：

```markdown
---
description: List open Loupe DOM marks for the current project/session.
argument-hint: "[project_id or url]"
allowed-tools: ["mcp__loupe__list_marks", "mcp__loupe__get_mark"]
---

Call `list_marks` scoped to the current project. If Loupe returns MULTI_PROJECT,
present the candidate project scopes and ask the user to choose. Summarize each
open mark with: id, selector_preview, intent.comment, locator_status, confidence.
```

`agents/mark-resolver.md`：

```markdown
---
name: mark-resolver
description: Resolve Loupe DOM marks by reading project-scoped marks, implementing the requested frontend change, and calling resolve_mark.
tools:
  [
    "mcp__loupe__list_marks",
    "mcp__loupe__get_mark",
    "mcp__loupe__resolve_mark",
    "Read",
    "Edit",
    "Grep",
    "Glob",
  ]
---

For each mark, call get_mark with id plus project scope. Treat source_hint as a hint only.
If target.locator_status is drifted/lost or confidence is low, surface the uncertainty before editing.
After implementing and verifying the requested change, call resolve_mark. Never call delete_mark unless the user explicitly asks to delete the mark.
```

### 11.5 Marketplace schema

Launch polish 发布时使用官方 marketplace shape：top-level `name`、`owner`、`plugins`；每个 plugin entry 至少包含 `name` 与 `source`。

```json
{
  "name": "loupe-plugins",
  "owner": {
    "name": "Loupe"
  },
  "plugins": [
    {
      "name": "loupe",
      "description": "Read DOM marks placed in the browser as precise frontend tasks.",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/Yeman-sker/Loupe",
        "path": "packages/claude-plugin",
        "ref": "main"
      }
    }
  ]
}
```

不使用 `repositoryUrl` / `ref` / `path` 作为 plugin entry 顶层字段；也不使用 `type: "git"` 或 `subdirectory`。

### 11.6 Codex plugin

除 Claude 插件外，`@loupe/codex-plugin` 提供 Codex 分发路径，复用同一 daemon 与 MCP：

- `loupe-marks` skill 引导 Codex 列出并 resolve 当前 project 的 marks。
- `.mcp.json` 同样用 stdio `mcp-proxy` 转发到 daemon `/mcp`，token 不落明文。
- SessionStart hook 用 `/health` 确保 daemon 可用，约定与 §11.3 一致。

两个插件共享 §11.1 的 MCP 工具与 scope 契约，不引入第二套 wire schema。

---

## 12. Local Storage 与 Daemon Persistence

### 12.1 Extension storage

- 所有 read-modify-write 通过 storage lock 串行化。
- 保存 mark 顺序：生成 annotation → 写 `chrome.storage.local` → UI 显示 local/syncing → POST daemon → 更新 `sync.status`。
- 删除顺序：写 tombstone + `sync.status=delete_pending` → DELETE daemon → tombstone synced。
- Service worker 休眠不影响真相源；唤醒后按 project/session 补同步。

### 12.2 Daemon persistence

`~/.loupe/marks.json`：

```json
{
  "schema_version": 1,
  "projects": {
    "<project_id>": {
      "sessions": {
        "<session_id>": {
          "marks": []
        }
      },
      "tombstones": []
    }
  }
}
```

写入必须 atomic：write temp → fsync where practical → rename。并发写通过 saveLock 串行化。启动读取遇到损坏 JSON 时备份为 `.corrupted.<timestamp>` 后初始化空 store，并在 `/health` / CLI status 暴露 warning。

---

## 13. Testing 与 Quality Gates

> 本节定义实现时必须具备的验证策略；当前 PRD 修改不运行测试。

### 13.1 Locator robustness suite

核心指标：

- **Top-1 target accuracy**：`resolved` 时 top-1 是否为原目标。
- **False-resolved rate**：错误元素被标为 `resolved` 的比例，必须极低。
- **Ambiguity downgrade correctness**：重复按钮/列表项等场景是否降级 `drifted`。
- **Offline locator classification correctness**：目标移动、文本变化、节点删除等离线 fixture 扰动后 `resolved` / `drifted` / `lost` 分类是否正确。
- **Live route/detach recovery correctness**：真实 MV3 页面中 route 切换、rerender、DOM detach、service worker 唤醒后是否无 stale pin commit，并正确恢复或标记 lost。

Fixture 必须覆盖：class hash 变化、Tailwind utility 噪声、文案变更、列表插入、父容器重排、Shadow DOM、same-origin iframe、SVG、nested scroll。

### 13.2 MV3 extension E2E

使用 Playwright persistent Chromium 加载 unpacked extension，覆盖真实 MV3 行为：

- content script MAIN/ISOLATED bridge 一次性只读通信。
- extension permissions / host authorization 分支。
- service worker lifecycle 与消息唤醒。
- `chrome.storage.local` project-scoped 写入与 lock 行为。
- daemon sync：token header、local-only fallback、failed retry。
- MCP read / `resolve_mark` 后 pin 状态变更。

### 13.3 Support-matrix tests

逐项覆盖 §7.8：same-origin iframe、cross-origin iframe boundary、SVG、canvas shell、open/closed Shadow DOM、portal/teleport、nested scroll。每项既测 picker 行为，也测 locator resolution 行为。

### 13.4 Contract / security tests

- MCP schema：snake_case、低噪声、无 token/内部字段泄漏。
- Project scope：multi-project 同 origin 不混读；bare-id mutation 被拒绝。
- Auth：`/v1/marks*` 与 `/mcp` 无 token 401；`/health` anonymous。
- Startup：`ensure` 使用 `/health`，端口非 Loupe 时失败清晰。
- Persistence：atomic write、损坏 JSON 备份、tombstone 防复活。

### 13.5 Anomaly capture / replay（dev-build only）

Locator robustness suite 的 fixture 来源之一是真实页面上捕获的定位异常。该 capture/replay 管线只在 dev build 启用，自成一套子系统（扩展 dev capture、daemon anomaly store、shared 离线 replay、`/loupe:anomalies` 命令与 anomaly-fixer agent），不进入产品运行路径。

设计细节与取舍不在本 PRD 展开，见 `docs/adp-20260606-anomaly-capture-dev-build-only.md`、`docs/adp-20260606-anomaly-capture-offline-replay-pipeline.md`、`docs/adp-20260606-anomaly-repro-fidelity-replay-guard.md` 与 `docs/phases/phase-qa-0-anomaly-capture-replay.md`。

---

## 14. Milestones

| 里程碑                                       | 交付                                                                                                              | 验收                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| M0 Schema / daemon health / empty MCP        | shared snake_case schema、project/session scope、daemon `/health`、token/server files、最小 command/agent 文件、`/loupe:marks` empty path | Claude MCP proxy 可连接；无 token 访问 `/mcp` 失败；`/loupe:marks` 对 scoped empty `list_marks` 返回空数组 |
| M1 Locator robustness                        | locator capture model（含 same-origin `frame_path`）、`resolve()`、candidate scoring、ambiguity downgrade、offline robustness suite        | Top-1 / false-resolved / ambiguity / offline locator classification 指标可自动输出；阈值可校准            |
| M2 Picker / composer / minimal pin / storage | MV3 extension、picker keyboard model、composer、pin overlay、project-scoped `chrome.storage.local`、Markdown copy                         | Golden path 可在浏览器内保存 local mark；View all 显示 lifecycle/locator/sync 状态                      |
| M3 Daemon persistence / project-scoped MCP   | authenticated `/v1/marks*`、atomic `marks.json`、MCP four tools、AgentMark payload、resolve/delete 后 daemon→extension 状态 reconciliation、contract/security gates | Agent scoped read/get/resolve/delete contract 通过；bare-id cross-project mutation 被拒绝；pin 状态随 mutation 对账 |
| M4 Live recovery / extension E2E regression  | route epoch recovery、DOM quiet window、detach/rerender recovery、sync retry、Playwright MV3 E2E                                           | rerender/route/detach/service-worker/daemon offline 场景通过；无 stale route pin commit；M0/M3 contract/security 集成回归通过 |
| M5 Launch polish / marketplace               | 全部 onboarding branches、host authorization polish、visual polish、CLI status/init/logs/diagnostics、official marketplace package         | Marketplace schema 验证；所有 onboarding 分支与 CLI 诊断可走通；用户可从 marketplace 安装并完成首个 mark |

---

## 15. KPI 与 Research Metrics

### 15.1 MVP KPI

| 指标                            | 定义                                                       |   目标 |
| ------------------------------- | ---------------------------------------------------------- | -----: |
| Top-1 target accuracy           | robustness suite 中 `resolved` top-1 命中原目标比例        |  ≥ 99% |
| False-resolved rate             | 错误元素被标为 `resolved` 的比例                           | ≤ 0.5% |
| Ambiguity downgrade correctness | 应 drifted 的重复/相似目标被降级比例                       |  ≥ 95% |
| Offline locator classification | 离线 fixture 扰动后 `resolved` / `drifted` / `lost` 分类正确比例 |  ≥ 95% |
| Live route/detach recovery     | route/rerender/detach 后恢复或 lost 判定正确且无 stale commit 比例 |  ≥ 95% |
| Save-to-Agent readable P95      | 用户保存 mark 到 daemon/MCP 可读的 P95；daemon online 场景 |   < 2s |
| Local save success              | daemon offline 时 mark 成功 local-only 保存比例            |   100% |
| Project isolation violations    | 测试中跨项目混读/误 mutation 次数                          |      0 |

### 15.2 Launch metrics

| 指标                        | 定义                                           |   目标 |
| --------------------------- | ---------------------------------------------- | -----: |
| TTFM                        | 从插件/扩展安装完成到第一个 mark synced        | < 5min |
| Agent payload size          | 单条 `AgentMark` JSON 中位数，不含 screenshot  |  < 1KB |
| Marketplace install success | clean machine 安装后 `/loupe:marks` 可运行比例 |  ≥ 95% |

### 15.3 Research metric

“每条 mark 的来回澄清次数下降”保留为 research metric，而不是 MVP KPI。基线定义为：同一组 UI 任务仅用自然语言描述交给 Agent 时的平均澄清次数；Loupe 组与自然语言组对比，统计 open→resolved 前用户额外澄清轮数。

---

## 16. 风险与对策

| 风险                                    | 影响              | 对策                                                                        |
| --------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| Locator 在相似元素中误判                | 信任崩塌          | Top-1/top-2 ambiguity downgrade；false-resolved KPI；matched_by 透明化      |
| Project scope 推断错误                  | Agent 读/改错项目 | 显式 `project_id` / `workspace_root_hash` / assertion；multi-project 不混返 |
| Daemon 未启动或 token 失效              | Agent 读不到 mark | local-first 保存；sync.status 可见；copy fallback；`ensure` + `/health`     |
| MV3 service worker 休眠                 | 同步延迟          | storage.local 为真相源；唤醒补同步；E2E 覆盖                                |
| MAIN world bridge 被页面滥用            | 安全问题          | 无常驻 API；nonce-gated；只读；Agent 写只走 authenticated daemon            |
| Cross-origin iframe/canvas 内部不可定位 | 用户预期落差      | support matrix 明确提示；只能标外壳元素                                     |
| DOM→source hint 不准                    | Agent 改错文件    | `source_hint` 永远带 confidence，仅作 hint；agent prompt 要求代码验证       |
| 端口 7373 被占用                        | daemon 启动失败   | MVP 明确失败并提示；动态 discovery 放 Phase 2                               |

---

## 17. 附录

### 17.1 对照速查

| 维度          | DOM-Review            | vibe-annotations        | Loupe v0.2                                                    |
| ------------- | --------------------- | ----------------------- | ------------------------------------------------------------- |
| Agent surface | window/API + DOM JSON | local server + MCP      | authenticated local daemon + project-scoped MCP               |
| 定位          | 单 selector           | 多策略 selector/context | locator bundle + weighted resolve + ambiguity downgrade       |
| 漂移恢复      | 弱/缺失               | mutation 重匹配         | route epoch + DOM quiet + no stale commit                     |
| 数据模型      | 弱 schema             | raw/agent 分层          | snake_case wire schema + lifecycle/resolution/sync 分离       |
| 删除语义      | 删除                  | tombstone               | `resolve_mark` 默认完成；`delete_mark` 仅显式删除 + tombstone |
| 安全          | page API 暴露弱       | localhost server        | token-required loopback APIs；MAIN world 只读                 |
| UI 隔离       | Shadow overlay        | Shadow UI               | open Shadow DOM + minimal MVP overlay                         |
| 分发          | 无插件                | server/CLI              | minimal Claude plugin path；marketplace launch polish         |

### 17.2 术语表

- **mark / annotation**：存储与 Agent 读取的任务领域对象。
- **pin**：mark 在页面 overlay 上的视觉标记。
- **locator bundle**：mark-time 采集的多重定位证据。
- **resolve(locator)**：用 locator bundle 在当前 DOM 重解析目标元素。
- **`resolve_mark`**：Agent/用户完成任务后关闭 mark 的 MCP 工具。
- **`delete_mark`**：用户明确删除 mark 的 MCP 工具；不表示任务完成。
- **`project_id`**：项目隔离 ID。
- **`route_key`**：页面/SPA route 隔离键。
- **`session_id`**：`project_id + branch + route_key` 的 hash。
- **`locator_status`**：当前 DOM 定位状态：resolved / drifted / lost。
- **`task_status`**：任务生命周期：open / resolved / archived。
