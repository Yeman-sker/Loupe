# DOM-Review 深度分析报告

## 目的

本报告用于沉淀对 `DOM-Review` 项目的技术分析，提炼其对“Web 端 DOM 标记 / 批注 / AI Agent 可消费反馈”产品的设计启发。

DOM-Review 的核心价值不是普通网页批注，而是：

> 让用户在真实浏览器页面上点选 DOM 元素、留下评论，并把这些评论转换为 AI agent 可直接读取、定位和处理的结构化任务。

---

## 1. 项目定位

DOM-Review 是一个 Chrome Manifest V3 扩展。

它解决的问题是：前端视觉反馈很难准确传递给 AI 编码工具。

传统流程：

1. 用户在浏览器里看到 UI 问题
2. 切回编辑器或 AI 聊天窗口
3. 用自然语言描述元素位置
4. AI 猜测对应 DOM / 组件
5. 可能改错地方
6. 反复沟通

DOM-Review 的流程：

1. 用户直接在页面上点击元素
2. 写 comment、category、priority
3. 扩展采集 selector、XPath、computed styles、a11y、framework context
4. 数据写入页面 DOM 和 localStorage
5. AI agent 通过 Chrome DevTools MCP 读取页面中的 review 数据
6. AI 根据结构化上下文修改代码

关键结论：

> DOM 标记产品的真正价值不是“在页面上画标记”，而是把视觉反馈转换成可定位、可执行、可追踪的结构化任务。

---

## 2. 项目结构

```text
DOM-Review/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── content-script.js
│   ├── content-style.css
│   └── modules/
│       ├── review-store.js
│       ├── selector-generator.js
│       ├── framework-detector.js
│       ├── framework-bridge.js
│       ├── agent-api-bridge.js
│       ├── agent-api-handler.js
│       ├── context-capture.js
│       ├── shadow-ui.js
│       ├── comment-panel.js
│       ├── badges.js
│       ├── sidebar.js
│       ├── selector-mode.js
│       └── export-import.js
├── popup/
│   ├── popup.html
│   └── popup.js
├── assets/
├── icons/
└── docs/
```

技术选择：

- Chrome Manifest V3
- Vanilla JavaScript
- 无 bundler
- 无第三方依赖
- IIFE 模块
- 共享命名空间：`window.__domReview`
- UI 使用 Shadow DOM 隔离
- 数据同时写入 localStorage 和页面 DOM

---

## 3. Manifest 注入设计

`manifest.json` 把 content scripts 分为两个世界。

### MAIN world

```json
{
  "js": [
    "content/modules/framework-bridge.js",
    "content/modules/agent-api-bridge.js"
  ],
  "world": "MAIN"
}
```

用途：

- 访问页面真实 JavaScript 上下文
- 读取 React Fiber、Vue、Angular 内部信息
- 暴露 `window.__domReviewAPI` 给 DevTools / MCP / 页面上下文

### ISOLATED world

```json
{
  "js": [
    "content/modules/review-store.js",
    "content/modules/selector-generator.js",
    "content/modules/framework-detector.js",
    "content/modules/context-capture.js",
    "content/modules/shadow-ui.js",
    "content/modules/comment-panel.js",
    "content/modules/badges.js",
    "content/modules/sidebar.js",
    "content/modules/selector-mode.js",
    "content/modules/export-import.js",
    "content/modules/agent-api-handler.js",
    "content/content-script.js"
  ]
}
```

用途：

- 管理扩展状态
- 渲染 UI
- 采集上下文
- 存储 review
- 管理 badge / sidebar / comment panel

设计经验：

> Chrome extension 中，页面上下文能力和扩展权限能力天然分离。需要通过 bridge 显式连接，而不是混在一个脚本里。

---

## 4. 核心数据流

### 初始化流程

```text
chrome.storage.sync.get('dr_enabled')
  ↓
store.loadFromStorage()
  ↓
ui.init()
  ↓
badges.render()
  ↓
绑定 toolbar / selector / comment panel / sidebar / export-import
  ↓
store.onChange(...)
```

### 用户创建一条 review

```text
用户点击 Select
  ↓
selector.enable()
  ↓
mouseover 高亮元素
  ↓
click 捕获目标元素
  ↓
selectorGen.generate(element)
  ↓
contextCapture.capture(element)
  ↓
commentPanel.show(...)
  ↓
用户填写 comment / category / priority
  ↓
store.add(review)
  ↓
store._persist()
  ├─ saveToDOM()
  ├─ saveToStorage()
  └─ notify listeners
      ├─ badges.render()
      ├─ sidebar.render()
      └─ ui.updateBadgeCount()
```

### AI agent 读取 review

```text
AI 通过 Chrome MCP evaluate_script
  ↓
document.getElementById('dom-review-data').textContent
  ↓
JSON.parse(...)
  ↓
获得 reviews + api descriptor
```

### AI agent 更新 review

```text
AI 调用 window.__domReviewAPI.resolveReview(id)
  ↓
MAIN world agent-api-bridge.js
  ↓
写入 document.documentElement attribute
  ↓
dispatchEvent('dr-api-request')
  ↓
ISOLATED world agent-api-handler.js
  ↓
store.resolve(id)
  ↓
store._persist()
```

---

## 5. 最重要设计：Agent-readable DOM Surface

`review-store.js` 会把数据写入页面 DOM：

```html
<script id="dom-review-data" type="application/json">
{
  "version": "1.0",
  "page": "...",
  "reviews": [...],
  "api": {...}
}
</script>
```

这是 DOM-Review 最值得吸收的设计。

### 优点

- AI agent 能通过浏览器直接读取
- 不需要用户复制粘贴
- 不需要下载 JSON 文件
- 不要求 AI 具备 extension 内部权限
- review 数据和页面状态位于同一个可观测空间
- 与 Chrome DevTools MCP 工作流天然兼容

### 缺点

- 页面脚本也能读取这份数据
- 页面 DOM 清理逻辑可能删掉 script
- 数据体积大时污染 DOM
- debounce 写入可能导致 agent 立刻读取到旧数据
- 多页面 / 多 route session 支持弱

设计启发：

> 如果目标是让 AI agent 消费 DOM 标记，数据不要只藏在后端或 extension storage；必须设计一个 agent-readable surface。

可选 surface：

- DOM JSON script
- `window` API
- browser-exposed endpoint
- Chrome DevTools bridge
- local MCP tool
- WebSocket debug channel

---

## 6. Review 数据模型

DOM-Review 创建 review 时包含：

```ts
type Review = {
  id: string
  selector: string
  xpath: string
  comment: string
  priority: 'high' | 'medium' | 'low'
  category: 'style' | 'logic' | 'a11y' | 'text' | 'layout' | 'remove' | 'add'
  resolved: boolean
  created: string
  updated: string | null
  context: ElementContext | null
  replies: Reply[]
}
```

`context` 包括：

```ts
type ElementContext = {
  tagName: string
  text: string
  boundingBox: { x: number; y: number; w: number; h: number }
  styles: {
    color: string
    backgroundColor: string
    fontSize: string
    fontWeight: string
    padding: string
    margin: string
    display: string
    position: string
    border: string
    borderRadius: string
    opacity: string
  }
  a11y: {
    role: string
    label: string
    ariaDescribedby: string | null
    ariaExpanded: string | null
    tabIndex: string | null
  }
  framework: FrameworkContext | null
}
```

对 AI 有价值的字段：

- `selector`：定位 DOM
- `xpath`：fallback locator
- `comment`：用户意图
- `category`：任务类型
- `priority`：处理顺序
- `context.styles`：当前视觉状态
- `context.a11y`：可访问性状态
- `context.framework`：源码定位线索
- `replies`：用户 / AI 之间的修复讨论

---

## 7. Selector 生成策略

DOM-Review 的 selector 生成顺序：

1. 优先使用非 extension 自身的 `id`
2. 向上构造 `tag.class:nth-of-type(...)` path
3. 过滤 Tailwind / Bootstrap / utility class
4. 每层最多使用两个“有意义 class”
5. 验证 selector 是否唯一
6. fallback 到完整 `nth-of-type` path
7. 同时生成 XPath

关键代码策略：

```js
const meaningful = Array.from(current.classList || [])
  .filter(c => c && !isUtilityClass(c))
  .slice(0, 2);
```

设计启发：

> DOM 标记系统的 selector 不是用来写 CSS 的，而是用来复现、定位和帮助 agent 推理的。

好的 locator 应该追求：

- 稳定
- 可读
- 唯一
- 不过度依赖视觉 utility class
- 有 fallback
- 可以重新验证

### 改进建议

不要只保存一个 CSS selector。

更稳的模型：

```ts
type Locator = {
  css: string
  xpath: string
  text?: string
  role?: string
  testId?: string
  component?: string
  boundingBox?: Rect
  fingerprint?: {
    tag: string
    classes: string[]
    textHash: string
    ancestorPath: string[]
  }
}
```

---

## 8. Element Selection 交互

`selector-mode.js` 负责点选 DOM 元素。

特性：

- `mouseover` 高亮元素
- `click` 捕获目标元素
- `Escape` 退出选择模式
- 使用 capture phase 监听事件
- 忽略扩展自身 UI
- 忽略 `SCRIPT / STYLE / META / LINK / HEAD / HTML / NOSCRIPT`
- hover 使用 `requestAnimationFrame` 节流

核心监听：

```js
document.addEventListener('mouseover', handleMouseover, true);
document.addEventListener('click', handleClick, true);
document.addEventListener('keydown', handleKeydown, true);
```

设计优点：

- capture phase 能可靠拦截点击
- `stopImmediatePropagation()` 避免触发页面业务逻辑
- Escape 退出符合用户预期
- Shadow DOM host 排除避免选中扩展自身 UI

不足：

- 不支持 keyboard selection
- iframe 支持有限
- canvas / SVG 支持有限
- 不支持选择父级 / 子级微调
- 不支持穿透 overlay 选择被遮挡元素

设计启发：

> DOM 标记产品的第一关键体验是“用户能否准确点中自己想标记的东西”。

建议补充：

- hover 高亮
- click-to-select
- Escape 退出
- overlay 自身排除
- iframe 策略
- Shadow DOM 策略
- 父级 / 子级切换
- 精确模式

---

## 9. UI 隔离：Shadow DOM

DOM-Review 创建 closed shadow root：

```js
const host = document.createElement('div');
host.id = 'dom-review-host';
host.style.cssText = 'position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0; pointer-events: none;';
const shadow = host.attachShadow({ mode: 'closed' });
```

优点：

- 不被宿主页面 CSS 污染
- 不污染页面 CSS
- z-index 足够高
- host 不拦截页面点击
- closed shadow root 降低页面脚本干扰

取舍：

- closed shadow root 调试困难
- 自动化测试困难
- 宿主应用难以定制主题
- web SDK 场景可能不适合 closed shadow root

建议：

- Chrome extension：closed shadow root 可接受
- Web SDK：open shadow root 或 iframe UI 更灵活
- 企业产品：需要 CSS variables / theme API

---

## 10. Badge 渲染设计

`badges.js` 使用一个 fixed overlay container：

```js
container.id = 'dom-review-badges';
container.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2147483646;
  overflow: hidden;
`;
```

每个 review 一个绝对定位 badge：

```js
const rect = target.getBoundingClientRect();
badgeEl.style.left = `${rect.right - 10}px`;
badgeEl.style.top = `${rect.top - 10}px`;
```

位置更新：

```js
window.addEventListener('scroll', throttledUpdateAll, true);
window.addEventListener('resize', throttledUpdateAll);
```

优点：

- badge 不插入目标元素内部
- 不改变页面 layout
- fixed overlay + getBoundingClientRect 简单可靠
- scroll capture 可以感知内层滚动容器
- priority / resolved 有颜色编码

不足：

- 每次 render 清空重建所有 badges
- review 多时性能一般
- 没有 IntersectionObserver
- 没有 MutationObserver
- selector 失效时只隐藏 badge，没有恢复机制

设计启发：

> 标记视觉层最好和业务 DOM 解耦，不要把 marker 插入目标元素内部。

推荐 overlay 架构：

```text
annotation overlay layer
  ├─ selection highlight
  ├─ persistent pins / badges
  ├─ hover tooltip
  └─ side panel linkage
```

推荐位置更新机制：

- `getBoundingClientRect`
- rAF 节流
- scroll / resize
- MutationObserver
- ResizeObserver
- IntersectionObserver
- route change hook

---

## 11. Store 设计

`review-store.js` 是中心状态源。

状态：

```js
let data = { version: '1.0', page: location.href, reviews: [] };
let listeners = [];
```

CRUD：

```js
add(review)
get(id)
getAll()
update(id, changes)
remove(id)
resolve(id)
unresolve(id)
```

持久化：

```text
_persist()
  ├─ saveToDOM()
  ├─ saveToStorage()
  └─ _notify()
```

storage key：

```js
const STORAGE_KEY = `dom-review:${location.origin}${location.pathname}`;
```

优点：

- store 是唯一数据源
- UI 订阅 store 变化
- DOM JSON 和 localStorage 同步
- import/export 走同一 store
- `toJSON()` 深拷贝，避免外部直接修改内部状态

不足：

- storage key 不包含 query/hash
- 不支持多 route session
- id 使用 `Date.now()`，可能冲突
- `remove(id)` 不返回删除结果
- `deleteReview` API 删除不存在 id 仍返回 success
- DOM JSON debounce 可能导致 agent 读旧数据
- `data-review-id` 一个元素只能保存一个 review id
- update selector 时没有迁移 DOM marker

设计建议：

> Store 要区分 annotation identity 和 DOM locator identity。selector 不应该是 annotation 的 identity，只是 target 的一种 locator。

建议模型：

```ts
type Annotation = {
  id: string
  target: TargetLocator
  body: CommentThread
  status: 'open' | 'resolved'
  createdAt: string
  updatedAt: string
  source: {
    url: string
    routeKey: string
    viewport: Viewport
  }
}
```

---

## 12. Agent API 设计

MAIN world 暴露：

```js
window.__domReviewAPI = {
  getReviews(),
  getReview(reviewId),
  addComment(params),
  addReply(params),
  resolveReview(reviewId),
  unresolveReview(reviewId),
  updateComment(params),
  deleteReview(reviewId)
}
```

跨 world 通信方式：

```text
MAIN world
  ↓ setAttribute(data-dr-api-request)
  ↓ dispatchEvent('dr-api-request')
ISOLATED world
  ↓ handleRequest()
  ↓ store operation
  ↓ setAttribute(data-dr-api-response)
MAIN world
  ↓ read response
```

亮点：

- API 同步返回，适合 MCP evaluate_script
- `dom-review-data` 内嵌 api descriptor，agent 可自发现
- 避免 agent 直接手改 JSON
- 支持 agent 添加 reply、resolve、update、delete

风险：

- 页面任意脚本也可以调用 `window.__domReviewAPI`
- request / response 通过 DOM attribute 明文传递
- 没有 auth / nonce
- schema validation 很弱
- 没有批量操作 API
- 没有事务语义

设计问题：

- agent API 是公开能力还是调试能力？
- 是否允许页面业务代码调用？
- 是否需要权限边界？
- 是否需要用户确认 agent 写操作？
- 是否有审计日志？

结论：

> 个人开发工具可以接受弱权限模型；团队或生产环境需要权限、审计和确认机制。

---

## 13. Framework Detection

DOM-Review 在 MAIN world 检测框架信息：

- React：Fiber internals
- Vue 3：`__vueParentComponent`
- Vue 2：`__vue__`
- Angular：`__ngContext__`

ISOLATED world 通过 DOM event/attribute 请求检测。

设计价值：

> selector 只能定位 DOM；component context 才能帮助 AI 定位源码。

理想输出：

```json
{
  "framework": "react",
  "componentName": "SubmitButton",
  "filePath": "src/components/SubmitButton.tsx",
  "props": {
    "variant": "primary"
  }
}
```

现实限制：

- React Fiber 不一定能拿到 filePath
- production build 信息可能被压缩
- Vue / Angular 内部字段不是稳定 API
- 组件名可能匿名化
- 源码定位无法保证

建议：

```text
DOM locator
+ framework component
+ source map metadata
+ React DevTools hook
+ user-provided data attributes
+ test id
+ route information
+ repo/component manifest
```

---

## 14. Popup 与权限边界

`background/service-worker.js` 管理：

- 动态注册 content scripts
- custom host permissions
- 获取当前页面 review JSON
- enable/disable 状态

默认只支持：

```text
http://localhost/*
http://127.0.0.1/*
```

custom domain 流程：

```text
popup 输入 host
  ↓
normalizeInput()
  ↓
chrome.permissions.request({ origins: [pattern] })
  ↓
background ADD_CUSTOM_PATTERN
  ↓
chrome.storage.sync 保存
  ↓
chrome.scripting.registerContentScripts()
```

设计经验：

> 浏览器扩展产品必须把权限最小化当成可信度的一部分。

---

## 15. 最值得吸收的设计

### 1. Agent-readable DOM surface

把标记结果放在 agent 能直接读到的位置。

### 2. 标记不是纯文本

一条 annotation 应包含：

- 用户意图
- DOM selector
- fallback locator
- computed style
- a11y 信息
- framework context
- 状态
- 优先级
- replies

### 3. UI overlay 与目标 DOM 解耦

不要把 marker 插入目标元素内部，不要影响页面 layout。

### 4. Shadow DOM 隔离

标记工具必须避免被宿主页面 CSS 污染。

### 5. MAIN world / ISOLATED world 分层

扩展权限逻辑和页面上下文检测要分开。

### 6. Selector 要过滤 utility class

Tailwind / Bootstrap utility class 对定位不稳定。

### 7. Store 是中心数据源

UI 不应各自持久化状态。

### 8. Agent 应走 API，不应直接改 JSON blob

API 比直接手改 JSON 更稳定、可控、可发现。

---

## 16. 不建议照抄的地方

### 1. `Date.now()` 作为 id

建议使用：

```js
crypto.randomUUID()
```

### 2. 单 selector 模型

建议保存多 locator。

### 3. DOM JSON debounce

如果 agent-readable surface 是核心能力，需要可 flush。

### 4. 缺少 DOM 变化恢复机制

建议增加：

- MutationObserver
- ResizeObserver
- route change detection
- remount detection
- locator re-resolution

### 5. 权限模型弱

团队或生产场景需要：

- permission
- nonce/session token
- audit log
- user confirmation

### 6. 多页面 session 弱

建议显式建模：

```ts
routeKey = origin + pathname + normalizedQuery + appRouteName
sessionId = projectId + branch + routeKey
```

---

## 17. 面向自研 Web DOM 标记产品的建议架构

```text
Annotation SDK
├── Target Picker
│   ├─ hover highlight
│   ├─ click capture
│   ├─ parent/child refine
│   └─ iframe/shadow-dom strategy
│
├── Locator Engine
│   ├─ css selector
│   ├─ xpath
│   ├─ role/name
│   ├─ text fingerprint
│   ├─ data-testid
│   ├─ component metadata
│   └─ re-resolve scoring
│
├── Context Capture
│   ├─ computed styles
│   ├─ bounding box
│   ├─ accessibility
│   ├─ framework component
│   ├─ viewport/device
│   └─ screenshot crop 可选
│
├── Overlay Renderer
│   ├─ badges
│   ├─ highlight
│   ├─ connector lines 可选
│   └─ side panel
│
├── Annotation Store
│   ├─ local draft
│   ├─ remote sync
│   ├─ status/replies
│   ├─ route/session model
│   └─ conflict handling
│
└── Agent Surface
    ├─ DOM JSON script
    ├─ window API
    ├─ MCP/tool endpoint
    ├─ export JSON
    └─ permission/audit layer
```

---

## 18. 总结

DOM-Review 的技术路线可以概括为：

> 在浏览器页面中建立一个轻量 DOM annotation layer，把用户视觉反馈转成 AI agent 可读、可定位、可操作的结构化数据。

它最值得学习的是：

1. 把标记结果放到 agent 可直接读取的 surface
2. 每条标记绑定 DOM locator 和上下文
3. 通过 Shadow DOM / overlay 隔离 UI
4. 通过 MAIN world bridge 获取框架组件信息
5. 通过 window API 允许 agent 回写状态

它不够完善的地方主要在：

1. locator 稳定性
2. 多页面 / SPA session 建模
3. DOM mutation 后的恢复能力
4. 权限和安全边界
5. 大规模 review 的性能

对自研 Web DOM 标记产品，建议保留它的核心思想，但在 locator、session、权限、恢复机制和 agent API 上做更严谨的设计。
