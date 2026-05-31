# vibe-annotations 深度分析报告

## 目的

本报告用于沉淀对 `vibe-annotations` 项目的技术分析，提炼其对“Web 端 DOM 标记 / 批注 / AI Agent 可消费反馈”产品的设计启发。

`vibe-annotations` 的核心价值不是普通截图批注，而是：

> 在真实网页 DOM 上选择元素，记录“元素定位 + 用户意图 + 可选设计改动 + 视觉上下文”，再同步给本地 MCP/API server，让 AI coding agent 消费这些标记并实现代码修改。

典型链路：

```text
用户在页面上点 DOM
→ 扩展生成稳定 selector + element_context
→ 用户写 comment / 调设计属性
→ 本地保存 chrome.storage.local
→ 同步到本地 server ~/.vibe-annotations/annotations.json
→ AI agent 通过 MCP 读取 annotation
→ agent 修改源码
→ annotation 被删除或归档
```

关键结论：

> 这个项目的重点不是“画框”，而是把用户指向的 DOM 转换成 agent 可执行的结构化任务上下文。

---

## 1. 项目定位

`vibe-annotations` 是一个由三部分组成的 DOM 标记系统：

1. Chrome MV3 扩展：负责 DOM 点选、UI 注入、annotation 创建、页面预览。
2. 本地 Node server：负责本地持久化、HTTP API、MCP 工具暴露。
3. Next.js 文档站：负责安装、MCP、工作流说明。

它面向的核心场景：

- 用户在本地开发页面上直接点选元素。
- 用户留下反馈或直接调整设计值。
- 扩展保存 DOM 上下文、selector、截图、设计改动。
- AI coding agent 读取 annotation，定位代码并实现改动。
- agent 完成后删除 annotation。

与传统网页批注工具相比，它更偏向“AI agent 的任务采集前端”。

---

## 2. 项目结构

```text
vibe-annotations/
├── package.json
├── pnpm-workspace.yaml
├── packages/
│   ├── extension/
│   │   ├── manifest.json
│   │   ├── popup.js
│   │   ├── background/
│   │   │   ├── background.js
│   │   │   ├── api-sync.js
│   │   │   ├── badge.js
│   │   │   ├── export.js
│   │   │   ├── url-filter.js
│   │   │   └── utils.js
│   │   └── content/
│   │       ├── content.js
│   │       ├── bridge-api.js
│   │       └── modules/
│   │           ├── event-bus.js
│   │           ├── styles.js
│   │           ├── shadow-host.js
│   │           ├── theme-manager.js
│   │           ├── api-bridge.js
│   │           ├── shadow-dom-utils.js
│   │           ├── element-context.js
│   │           ├── badge-manager.js
│   │           ├── inspection-mode.js
│   │           ├── popover-panels.js
│   │           ├── annotation-popover.js
│   │           ├── toolbar-docs.js
│   │           ├── floating-toolbar.js
│   │           └── bridge-handler.js
│   ├── server/
│   │   ├── package.json
│   │   ├── bin/
│   │   │   └── cli.js
│   │   └── lib/
│   │       ├── server.js
│   │       └── init/
│   └── website/
│       ├── package.json
│       ├── src/app/docs/
│       └── src/components/
```

技术选择：

- Chrome Manifest V3
- Vanilla JavaScript content scripts
- 无 extension build step
- 通过 manifest 顺序加载全局模块
- Shadow DOM UI 隔离
- `chrome.storage.local` 本地交互存储
- Node ESM server
- Express HTTP API
- MCP SDK
- JSON 文件持久化
- Next.js + React + MDX 文档站

---

## 3. Manifest 注入设计

`packages/extension/manifest.json` 有两套 content script。

### 3.1 ISOLATED world 主逻辑

```json
{
  "matches": [
    "http://localhost/*",
    "https://localhost/*",
    "http://127.0.0.1/*",
    "https://127.0.0.1/*",
    "http://0.0.0.0/*",
    "https://0.0.0.0/*",
    "http://*.local/*",
    "https://*.local/*",
    "http://*.test/*",
    "https://*.test/*",
    "http://*.localhost/*",
    "https://*.localhost/*",
    "file:///*"
  ],
  "all_frames": true,
  "js": [
    "content/modules/event-bus.js",
    "content/modules/styles.js",
    "content/modules/shadow-host.js",
    "content/modules/theme-manager.js",
    "content/modules/api-bridge.js",
    "content/modules/shadow-dom-utils.js",
    "content/modules/element-context.js",
    "content/modules/badge-manager.js",
    "content/modules/inspection-mode.js",
    "content/modules/popover-panels.js",
    "content/modules/annotation-popover.js",
    "content/modules/toolbar-docs.js",
    "content/modules/floating-toolbar.js",
    "content/modules/bridge-handler.js",
    "content/content.js"
  ]
}
```

用途：

- 注入 toolbar、popover、badge。
- 监听 DOM 点选。
- 采集 element context。
- 通过 background 保存 annotation。
- 监听 storage 变化并重渲染页面标记。

### 3.2 MAIN world bridge

```json
{
  "js": ["content/bridge-api.js"],
  "world": "MAIN",
  "run_at": "document_start"
}
```

用途：

- 在宿主页面真实 JS 上下文暴露桥接 API。
- 支持页面或外部脚本主动创建 / 查询 annotation。
- 与 isolated world 通过消息通信。

设计启发：

> DOM 标记工具应区分“页面 UI 注入层”和“宿主页 API 桥接层”。不要把 UI、页面 API、存储协议全部塞进一个 content script。

---

## 4. Shadow DOM UI 隔离

`content/modules/shadow-host.js` 创建所有扩展 UI 的根节点：

```js
hostEl = document.createElement('div');
hostEl.id = 'vibe-annotations-root';
hostEl.style.cssText = `
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  pointer-events: none !important;
  z-index: 2147483647 !important;
  overflow: visible !important;
`;

shadowRoot = hostEl.attachShadow({ mode: 'open' });
```

关键设计：

1. UI 样式完全隔离，避免被宿主页面 CSS 污染。
2. 根节点 `pointer-events: none`，避免遮挡页面。
3. 具体按钮、popover、badge 再开启 pointer events。
4. z-index 使用 `2147483647`，确保可见。
5. Shadow boundary 拦截部分事件：

```js
for (const type of ['pointerdown', 'mousedown', 'click', 'focusin', 'focusout']) {
  hostEl.addEventListener(type, (e) => e.stopPropagation());
}
```

这能避免 React/Vue 应用把扩展 UI 点击误判为 outside click。

设计启发：

> Web DOM 标记产品必须 Shadow DOM 化。普通 fixed div + 全局 CSS 在真实业务页面里很容易被污染或破坏。

---

## 5. Content Runtime 编排

`content/content.js` 是 content runtime 的入口。

初始化流程：

```text
inject font
→ VibeShadowHost.init()
→ 读取 overlay hidden 状态
→ 初始化 theme
→ VibeAPI.loadAnnotations()
→ VibeBadgeManager.init()
→ VibeInspectionMode.init()
→ VibeAnnotationPopover.init()
→ VibeBridgeHandler.init()
→ VibeToolbar.init()
→ 注册 message listener
→ 注册 storage listener
→ 注册 SPA route detection
→ 注册 keyboard shortcuts
→ 注册 annotation lifecycle events
→ hydration 后渲染 badges
```

核心模块职责：

| 模块 | 职责 |
|---|---|
| `event-bus.js` | content 内模块解耦通信 |
| `shadow-host.js` | Shadow DOM 宿主 |
| `inspection-mode.js` | 点选 DOM / hover highlight |
| `element-context.js` | selector 生成、上下文采集、元素重匹配 |
| `annotation-popover.js` | 标记编辑器 |
| `popover-panels.js` | 设计属性面板 |
| `badge-manager.js` | badge 渲染、pending changes 预览与恢复 |
| `floating-toolbar.js` | toolbar、View all、copy、import/export、settings |
| `api-bridge.js` | content 到 background/storage/server 的 API facade |
| `bridge-handler.js` | MAIN world bridge 请求处理 |

设计启发：

> 即使不用框架，也要把“选择、上下文采集、编辑、展示、存储、同步”拆成明确模块。DOM 标记工具复杂度主要来自状态边界，而不是 UI 本身。

---

## 6. DOM 选择模式：Inspection Mode

`inspection-mode.js` 负责进入“点击选择 DOM”的状态。

### 6.1 Capture phase 监听

```js
document.addEventListener('mouseover', onMouseOver, true);
document.addEventListener('mouseout', onMouseOut, true);
document.addEventListener('pointermove', onPointerMove, true);
document.addEventListener('pointerdown', onPointerDown, true);
document.addEventListener('mousedown', onMouseDown, true);
document.addEventListener('click', onClick, true);
document.addEventListener('keydown', onKeyDown, true);
```

原因：

- 先于宿主页面框架拿到事件。
- 能阻止链接跳转、按钮点击等真实业务行为。
- 能在复杂页面里稳定捕获目标。

### 6.2 使用 pointerdown 选中元素

```js
function handlePointerDown(e) {
  if (!active || isOurUI(e)) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  const target = getDeepTarget(e);
  tempDisable();
  VibeEvents.emit('inspection:elementClicked', {
    element: target,
    clientX: e.clientX,
    clientY: e.clientY
  });
}
```

`pointerdown` 比 `click` 更早，能在页面业务逻辑前截断事件。

### 6.3 Shadow-aware target

```js
function getDeepTarget(e) {
  const path = e.composedPath?.() || [];
  for (const node of path) {
    if (node instanceof Element) return node;
  }
  return e.target instanceof Element ? e.target : null;
}
```

这能拿到 Shadow DOM 内部真实元素，而不是 shadow host。

### 6.4 键盘微调目标

支持：

- `ArrowUp`：选择父级元素。
- `ArrowDown`：回到子级。
- `Enter`：选中当前高亮元素。
- `Esc`：退出选择模式。

设计启发：

> DOM 标记不能只靠鼠标点击。真实页面里用户经常点到 span/svg，而真正要标的是 button/card/container。父子级微调是核心体验。

---

## 7. Element Context 数据模型

`content/modules/element-context.js` 是项目的核心之一。

生成上下文：

```js
const context = {
  selector,
  tag: element.tagName.toLowerCase(),
  classes,
  text: element.textContent.substring(0, 100).trim(),
  path: getElementLocationPath(element),
  styles: {
    display: computedStyle.display,
    position: computedStyle.position,
    fontSize: computedStyle.fontSize,
    fontWeight: computedStyle.fontWeight,
    lineHeight: computedStyle.lineHeight,
    textAlign: computedStyle.textAlign,
    color: computedStyle.color,
    backgroundColor: computedStyle.backgroundColor,
    margin: computedStyle.margin,
    padding: computedStyle.padding,
    flexDirection: computedStyle.flexDirection,
    justifyContent: computedStyle.justifyContent,
    alignItems: computedStyle.alignItems,
    width: computedStyle.width,
    height: computedStyle.height
  },
  position: {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height
  },
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight
  },
  source_mapping: generateSourceMapping(element),
  screenshot: null,
  parent_chain: getParentChainContext(element, 4)
};
```

它采集的不只是 selector，而是完整定位证据：

- selector
- tag
- classes
- text
- path
- computed styles
- position
- viewport
- source mapping hint
- screenshot
- parent chain

设计启发：

> selector 是主定位，但不是唯一定位。DOM 标记需要保存多种证据，才能在 rerender、样式变化、路由变化后恢复。

---

## 8. Selector 生成策略

`generateSelector(element)` 是多策略 fallback。

策略顺序：

```text
1. Shadow DOM aware selector
2. id selector
3. stable attribute selector
4. text-based selector
5. class selector
6. limited context selector
7. fallback selector
8. robust path selector
9. generated data attribute selector
```

稳定属性优先级：

```js
[
  'data-testid',
  'data-test',
  'data-test-id',
  'data-cy',
  'data-qa',
  'data-e2e',
  'data-automation-id',
  'data-component',
  'aria-label',
  'title',
  'name',
  'role'
]
```

Shadow DOM selector 会生成类似：

```text
hostSelector >> innerSelector
```

设计启发：

> selector 可靠性来自“多策略 + 唯一性校验 + fallback”，不是来自某一个完美算法。

建议自己的 DOM 标记产品至少支持：

```text
1. data-testid / data-cy / data-qa
2. aria-label / title / name / role
3. id
4. stable classes
5. text + tag
6. parent stable selector + child selector
7. shadow host chain
8. nth-of-type path
9. position/text/class fallback
```

---

## 9. Selector 漂移恢复

项目不只生成 selector，还支持重匹配。

`findElementBySelector(annotation)` 会：

1. 尝试原 selector。
2. 校验元素 text，避免 selector 指错元素。
3. 如果原 text 不匹配，允许匹配 `pending_changes.copyChange.value`。
4. 用 text + tag 搜索候选。
5. 用 classes 缩小候选。
6. 用 position 缩小候选。
7. 支持 Shadow DOM 搜索范围。

原因：

- React/Vue rerender 后 DOM 节点会断开。
- nth-of-type 可能漂移。
- class 可能变化。
- 用户可能已经把文案临时改了。
- Shadow DOM 需要跨 root 查找。

`badge-manager.js` 还有 MutationObserver：

```js
const hasDisconnected = badges.some(b => !b.targetElement.isConnected);
if (hasDisconnected) {
  rematchDebounceTimer = setTimeout(rematchDisconnectedBadges, 150);
}
```

然后重新调用 `VibeElementContext.findElementBySelector(entry.annotation)` 找新节点。

设计启发：

> DOM annotation 应被视为“可漂移引用”，不是静态 CSS selector。必须有 rematch 机制。

---

## 10. Annotation 数据结构

`annotation-popover.js` 创建 annotation：

```js
const annotation = {
  id: 'vibe_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
  url: window.location.href,
  selector: context.selector,
  comment,
  viewport: context.viewport,
  element_context: {
    tag: context.tag,
    classes: context.classes,
    text: context.text,
    path: context.path || null,
    styles: context.styles,
    position: context.position
  },
  source_file_path: context.source_mapping?.source_file_path || null,
  source_line_range: context.source_mapping?.source_line_range || null,
  project_area: context.source_mapping?.project_area || 'unknown',
  url_path: context.source_mapping?.url_path || vibeLocationPath(window.location),
  source_map_available: context.source_mapping?.source_map_available || false,
  context_hints: context.source_mapping?.context_hints || null,
  screenshot: context.screenshot || null,
  parent_chain: context.parent_chain || null,
  status: 'pending',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

if (pendingChanges) annotation.pending_changes = pendingChanges;
```

额外字段：

```js
annotation.selector_preview = getElementOpenTagPreview(targetElement);
annotation.element_context.id = targetElement.id || null;
annotation.element_context.role = targetElement.getAttribute('role') || null;
annotation.css = cssField;
annotation.badge_offset = { x, y };
```

核心字段意义：

| 字段 | 作用 |
|---|---|
| `id` | 跨本地 / server 同步唯一标识 |
| `url` | 精确页面 URL |
| `url_path` | 路由分组 |
| `selector` | 主定位 |
| `selector_preview` | 人类 / agent 可读定位 |
| `comment` | 用户意图 |
| `viewport` | 响应式上下文 |
| `element_context` | DOM 语义、样式、位置上下文 |
| `parent_chain` | 父级上下文 |
| `pending_changes` | 页面上临时设计改动 |
| `css` | CSS rule 级别改动 |
| `screenshot` | 视觉上下文 |
| `source_file_path` | 源码 hint |
| `source_line_range` | 源码行号 hint |
| `status` | 生命周期状态 |

设计启发：

> Annotation 应是产品领域对象，不是 UI 临时状态。它要同时服务用户、页面恢复、agent 消费、同步和导出。

---

## 11. Pending Changes 设计

项目允许用户在 popover 里直接做设计调整，例如字体、间距、布局、颜色、尺寸、文案等。

`pending_changes` 不是只存最终值，而是存：

```js
pending_changes: {
  fontSize: {
    original: '16px',
    value: '18px'
  },
  paddingTop: {
    original: '8px',
    value: '12px'
  },
  copyChange: {
    original: 'Submit',
    value: 'Continue'
  }
}
```

好处：

1. 可以即时预览。
2. 可以关闭 overlay 时恢复原始 DOM。
3. agent 能看到明确 diff。
4. 能把用户视觉调整映射为 Tailwind class、CSS variable、design token。

关闭或删除时恢复：

```js
function revertPendingChanges(el, pc) {
  for (const prop of Object.keys(pc)) {
    if (prop === 'copyChange') {
      el.textContent = pc.copyChange.original;
      continue;
    }
    const entry = pc[prop];
    el.style[prop] = entry.original === '' ? '' : entry.original;
  }
}
```

设计启发：

> 如果 DOM 标记产品支持“页面上直接改设计”，必须使用 reversible patch。只存最终值会导致无法恢复、无法解释、无法安全同步。

---

## 12. Badge 渲染与页面预览

`badge-manager.js` 做两件事：

1. 在 Shadow DOM 内渲染编号 badge。
2. 将 `pending_changes` 临时应用到宿主 DOM。

渲染 badge：

```js
const badge = document.createElement('div');
badge.className = 'vibe-badge';
root.appendChild(badge);
```

应用设计改动：

```js
if (rpc) {
  for (const prop of getStyleProps(rpc)) {
    if (rpc[prop]) target.style[prop] = rpc[prop].value;
  }
  if (rpc.copyChange) target.textContent = rpc.copyChange.value;
}
```

定位更新：

- scroll listener
- resize listener
- ResizeObserver
- requestAnimationFrame batch reposition

```js
window.addEventListener('scroll', scrollListener, { passive: true, capture: true });
window.addEventListener('resize', scrollListener, { passive: true });
resizeObserver = new ResizeObserver(() => scheduleReposition());
```

设计启发：

> Badge 自身应完全隔离；只有用户明确要求预览的设计改动才允许短暂修改宿主 DOM，并且必须可恢复。

---

## 13. SPA 路由适配

`content.js` 支持 SPA 路由变化检测：

```js
window.addEventListener('popstate', onRouteChange);
window.addEventListener('hashchange', onRouteChange);
```

还监听 head 变化：

```js
const headObserver = new MutationObserver(() => onRouteChange());
headObserver.observe(document.head, {
  childList: true,
  subtree: true,
  characterData: true
});
```

以及 Navigation API：

```js
if (typeof navigation !== 'undefined') {
  navigation.addEventListener('navigatesuccess', onRouteChange);
}
```

路由变化后：

```text
reload annotations for current route
→ clear badges
→ 等 DOM 稳定
→ show annotations with retry
```

DOM 稳定等待：

```js
const stabilityDelay = 1500;
const maxMutations = 10;
```

设计启发：

> Web DOM 标记必须把 SPA 作为默认场景。URL 变化不等于 DOM 已稳定，必须有 hydration / DOM stability gate。

---

## 14. Content 到 Background 的数据流

content 层通过 `VibeAPI` 发送消息：

```js
chrome.runtime.sendMessage({ action: 'saveAnnotation', annotation });
```

background 中 `setupMessageListener()` 处理：

```js
case 'saveAnnotation':
  this.saveAnnotation(request.annotation)
```

保存逻辑：

```js
const result = await chrome.storage.local.get(['annotations']);
const annotations = result.annotations || [];
const idx = annotations.findIndex(a => a.id === annotation.id);
if (idx >= 0) annotations[idx] = annotation;
else annotations.push(annotation);
await chrome.storage.local.set({ annotations });
```

然后异步同步 server：

```js
saveOne(annotation).then(async () => {
  const fresh = await chrome.storage.local.get(['annotations']);
  const target = arr.find(a => a.id === annotation.id);
  if (target && !target._synced) {
    target._synced = true;
    await chrome.storage.local.set({ annotations: arr });
  }
}).catch(() => {});
```

设计取舍：

- 用户点击保存后先写本地。
- server 不在线也不阻塞用户。
- 同步成功后标记 `_synced`。

设计启发：

> 对浏览器标记工具，`chrome.storage.local` 应是交互路径上的 source of truth。server 是 agent bridge / sync mirror，不能成为保存动作的硬依赖。

---

## 15. Storage Lock 与并发安全

background 有应用层串行锁：

```js
this._storageQueue = Promise.resolve();

_withStorageLock(fn) {
  this._storageQueue = this._storageQueue.then(fn, fn);
  return this._storageQueue;
}
```

用于：

- save annotation
- delete annotation
- delete annotations by URL
- update annotation
- import annotations
- smart sync

原因：

`chrome.storage.local` 不是事务数据库。并发读写容易出现：

```text
操作 A 读取 annotations = [1]
操作 B 读取 annotations = [1]
A 写入 [1,2]
B 写入 [1,3]
结果丢失 2
```

设计启发：

> 浏览器扩展中任何“读数组 → 修改 → 写数组”的 storage 操作都必须串行化。

---

## 16. Server API 设计

`packages/server/lib/server.js` 固定监听：

```js
const PORT = 3846;
const DATA_FILE = path.join(DATA_DIR, 'annotations.json');
```

HTTP API：

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/health` | 扩展检测 server 状态 |
| `GET` | `/api/annotations` | 查询 annotations |
| `POST` | `/api/annotations` | 保存 / upsert 单条 annotation |
| `POST` | `/api/annotations/sync` | 全量同步替换 |
| `PUT` | `/api/annotations/:id` | 更新 annotation |
| `DELETE` | `/api/annotations/:id` | 删除 annotation |
| `GET` | `/api/watchers` | 查询 watch 状态 |
| `POST` | `/api/watchers/stop` | 停止全部 watchers |
| `GET` | `/sse` | MCP SSE transport |
| `POST` | `/messages` | MCP SSE message endpoint |
| `ANY` | `/mcp` | MCP Streamable HTTP endpoint |

CORS 只允许：

```text
localhost / 127.0.0.1 / 0.0.0.0
chrome-extension://
*.local / *.test / *.localhost
no origin
```

设计启发：

> 本地 annotation server 应默认只服务本地开发环境和扩展，不应向任意公网 origin 开放。

---

## 17. Server 持久化设计

持久化文件：

```text
~/.vibe-annotations/annotations.json
```

读取时处理空文件和损坏 JSON：

```js
if (!data || data.trim() === '') {
  await this.saveAnnotations([]);
  return [];
}

try {
  return JSON.parse(data);
} catch (parseError) {
  const backupFile = DATA_FILE + '.corrupted.' + Date.now();
  await writeFile(backupFile, data);
  await this.saveAnnotations([]);
  return [];
}
```

写入时使用 atomic write：

```js
const tempFile = DATA_FILE + '.tmp';
await writeFile(tempFile, jsonData);
await fs.promises.rename(tempFile, DATA_FILE);
```

并用 save lock 串行化：

```js
this.saveLock = Promise.resolve();

async saveAnnotations(annotations) {
  this.saveLock = this.saveLock.then(async () => {
    return this._saveAnnotationsInternal(annotations);
  });

  return this.saveLock;
}
```

设计启发：

> 单用户本地工具不一定需要数据库。JSON 文件 + atomic write + save lock 足够简单、可调试、可迁移。

限制：

- 数据量大时全量 JSON 读写成本会上升。
- 多进程同时写没有跨进程锁。
- 不适合团队协作或云同步。

---

## 18. Sync 机制

`background/api-sync.js` 提供：

- `checkConnection()`
- `syncAll(annotations)`
- `saveOne(annotation)`
- `deleteOne(id)`
- `smartSync(storageLockFn)`

### 18.1 单条保存

```js
POST /api/annotations
```

本地保存成功后异步推送 server。失败不影响本地保存。

### 18.2 全量同步

```js
POST /api/annotations/sync
body: { annotations }
```

server 直接替换全部 annotations。

server 为避免重复保存，会比较排序后的 JSON：

```js
const currentJson = JSON.stringify(currentAnnotations.sort((a, b) => a.id.localeCompare(b.id)));
const newJson = JSON.stringify(annotations.sort((a, b) => a.id.localeCompare(b.id)));
```

注意：这里 `sort()` 会原地修改数组。当前场景影响有限，但更安全应使用拷贝：

```js
JSON.stringify([...currentAnnotations].sort(...))
```

### 18.3 smartSync

每 10 秒：

```js
if (isConnected()) await smartSync(fn => this._withStorageLock(fn));
```

合并规则：

1. 拉取 server annotations。
2. 读取 local annotations。
3. 读取 `deletedAnnotationIds` tombstones。
4. 用 id 合并 local/server。
5. 两边都有时，按 `updated_at || created_at` 新者胜。
6. tombstone 中的 id 不恢复。
7. local-only 且未同步的保留。
8. server-only 拉回本地。
9. 合并后推回 server。
10. 删除 server 上仍存在的 tombstone id。

设计启发：

> 双端同步里删除必须被建模为状态，而不能只依赖“数组里不存在”。否则离线删除后，server 旧数据会把它复活。

---

## 19. MCP 工具设计

server 暴露 MCP tools：

| Tool | 用途 |
|---|---|
| `read_annotations` | 读取用户创建的 annotation |
| `delete_annotation` | 完成单条任务后删除 annotation |
| `get_project_context` | 根据 localhost URL 推测项目上下文 |
| `delete_project_annotations` | 项目级批量删除 annotations |
| `get_annotation_screenshot` | 按需获取截图 |
| `watch_annotations` | 阻塞等待新 annotations |

### 19.1 read_annotations 的 agent 优化

server 不直接返回原始 annotation，而是优化后返回：

```js
const { screenshot, ...rest } = annotation;
const optimized = {
  ...rest,
  has_screenshot: !!(screenshot && screenshot.data_url)
};
return this.optimizeForAgent(optimized);
```

`optimizeForAgent()` 会：

- 删除 `_synced`
- 删除 `badge_offset`
- 删除 `context_hints`
- 删除 `element_context.styles`
- 删除 null/empty 字段
- 保留 `has_screenshot`

原因：

- computed styles 对 agent 噪声大。
- screenshot 体积大，不应默认返回。
- extension 内部字段对 agent 无用。

设计启发：

> 原始 annotation 是 UI/storage 数据；MCP payload 是 agent 消费数据。两者必须分层。

### 19.2 多项目安全

如果 annotation 横跨多个 localhost project 且调用方没有传 `url`，server 返回 warning：

```js
multiProjectWarning = {
  warning: 'MULTI-PROJECT DETECTED...',
  recommendation: "Use the 'url' parameter...",
  suggested_filters: ['http://localhost:3000/*', ...]
}
```

设计启发：

> Agent 读取 annotation 时必须 project scoped。否则它可能把 A 项目的反馈实现到 B 项目。

### 19.3 Screenshot lazy fetch

`read_annotations` 只返回：

```js
has_screenshot: true
```

需要视觉上下文时再调用：

```js
get_annotation_screenshot({ id })
```

设计启发：

> 大字段要 lazy。截图、完整 DOM、computed styles 不应默认进 agent 上下文。

---

## 20. Watch Mode 设计

`watch_annotations` 用于 hands-free agent workflow。

流程：

```text
agent 调 watch_annotations(url)
→ server 每 10 秒查询 pending annotations
→ 有新 annotation 就返回
→ agent 实现修改
→ agent delete_annotation
→ agent 再次 watch
```

server 维护：

```js
this.watchers = new Map();
this.WATCHER_GRACE_MS = 120_000;
```

防止 watcher 堆积：

- 同 URL 新 watcher 会替换旧 watcher。
- watcher 最大数量限制 100。
- sweep interval 每 15 秒清理 stale watcher。
- watcher timeout 后自动删除。

extension toolbar 会轮询：

```text
GET /api/watchers
```

如果有 active watcher，badge label 显示眼睛 icon，表示 agent 正在 watch。

设计启发：

> 如果 DOM 标记产品要服务 AI agent，不应只提供一次性导出。可以设计 watch loop，让用户持续在页面上标注，agent 持续消费。

---

## 21. Floating Toolbar 产品流程

`floating-toolbar.js` 提供页面内常驻工具条。

主要能力：

- Annotate：进入点选模式。
- View all：查看当前 site 所有 annotations。
- Settings：主题、截图、server 状态、快捷键等。
- Server status：显示 MCP server 在线 / 离线 / watch 状态。
- Close：隐藏 overlay。

View all 面板：

- 按 route 分组。
- project-wide 编号。
- 单条删除。
- route 级清理。
- project 级 copy all。
- export / import。

设计启发：

> DOM 标记工具需要一个“现场控制台”，让用户在不离开页面的情况下完成标注、查看、复制、清理、同步。

---

## 22. Clipboard / Export / Import

### 22.1 Clipboard Markdown

`formatAnnotationsForClipboard()` 生成 agent / 人类可读 Markdown：

```md
# Vibe Annotations — localhost:3000 · 3 annotations

Follow my instructions on these elements.
When applying design changes, map values to the project design system...

---

## /dashboard (2)

1. <button> "Submit"
   Comment: Make this primary
   Selector: <button class="...">
   Path: div[...] > button[...]
   Source: src/...
   Design changes: font-size: 16px → 18px
```

价值：

- MCP 之外的降级通道。
- 可直接粘贴给任意 AI coding agent。
- 对人类也可读。

### 22.2 Export

导出结构：

```js
{
  vibe_annotations_export: true,
  version: '1.0',
  exported_at,
  source: {
    origin,
    hostname,
    port
  },
  scope,
  annotations: annotations.map(a => {
    delete cleaned.screenshot;
    return cleaned;
  })
}
```

默认删除 screenshot，避免文件过大。

### 22.3 Import origin remap

导入时校验 `source.origin`。

如果 origin 不同：

- 当前页面是 local dev：允许 remap。
- 当前页面不是 local dev：拒绝导入。

这支持“线上标注 → 本地实现”的场景。

设计启发：

> 即使有 MCP，也应该保留 copy/export/import。DOM 标记数据需要可迁移、可分享、可降级。

---

## 23. Popup 权限策略

`popup.js` 逻辑：

1. localhost / 127.0.0.1 / 0.0.0.0 / `.local` / `.test` / file 默认支持。
2. 非本地站点需要用户授权。
3. 用户可授权当前 site 或 all sites。
4. 授权后通过 background 动态注册 content scripts。
5. popup 可打开 / 关闭 overlay。

关键代码：

```js
const isLocalhost = isLocalhostUrl(tab.url);
const granted = !isLocalhost && (
  await chrome.permissions.contains({ origins: [originPattern] }) ||
  await chrome.permissions.contains({ origins: ['*://*/*'] })
);
const isSupported = isLocalhost || granted;
```

设计启发：

> 默认只支持本地开发地址；非本地站点走显式授权。这比默认 `<all_urls>` 更安全，也更容易获得用户信任。

---

## 24. CLI 与安装体验

server package 提供 bin：

```json
"bin": {
  "vibe-annotations": "./bin/cli.js",
  "vibe-annotations-server": "./bin/cli.js"
}
```

CLI 命令：

| 命令 | 作用 |
|---|---|
| `init` | 交互式配置 server、MCP、extension |
| `start` | 启动 server |
| `start --daemon` | 后台启动 server |
| `stop` | 停止 server |
| `restart` | 重启 server |
| `status` | 查看状态 |
| `logs` | 查看日志 |

server daemon 使用：

```text
~/.vibe-annotations/server.pid
~/.vibe-annotations/server.log
```

设计启发：

> 如果产品依赖本地 server，必须提供极简 init/start/status/logs。否则用户无法判断 MCP/server 是否可用。

---

## 25. 最值得借鉴的设计

### 25.1 Annotation 作为核心领域模型

不要把 DOM 标记看成 UI 状态。它应该是长期存在的任务对象：

```text
annotation = target reference + user intent + visual context + implementation hints + lifecycle status
```

### 25.2 selector 必须多策略

单一 CSS selector 不可靠。要有：

- stable attributes
- text
- class
- parent context
- nth-of-type
- position fallback
- shadow DOM path

### 25.3 必须支持漂移恢复

前端页面会 rerender。需要存：

- text
- classes
- parent_chain
- position
- viewport
- original/changed text
- shadow host path

### 25.4 UI 隔离必须 Shadow DOM

这是 DOM 标记工具的基础设施，不是优化项。

### 25.5 数据分 raw 与 agent optimized

```text
Raw annotation for UI/storage
Optimized annotation for agent/MCP
```

不要让 agent 消费所有 computed styles、截图、内部字段。

### 25.6 Screenshot lazy fetch

默认只返回 `has_screenshot`，需要时再取。

### 25.7 本地优先保存

```text
chrome.storage.local 是 interaction source of truth
server 是 agent bridge / sync mirror
```

### 25.8 删除必须 tombstone

离线同步时，删除必须被记录，否则旧 server 数据会复活。

### 25.9 多项目隔离

annotation 必须按 origin/project/url pattern 隔离。agent API 必须强提醒 filter。

### 25.10 Copy Markdown 是强 fallback

即使有 MCP，也要支持一键复制人类可读上下文。

---

## 26. 不足与风险

### 26.1 全局变量模块组织风险

content modules 依赖全局变量：

```js
var VibeAPI = (() => { ... })();
var VibeElementContext = (() => { ... })();
```

优点：

- 无 build step。
- Chrome extension 加载简单。

缺点：

- 类型不安全。
- 依赖顺序隐式。
- 重构风险高。
- 大文件维护成本高。

建议自己的项目使用 TypeScript + bundler，至少在源码层保持模块化和类型约束。

### 26.2 Annotation schema 没有强版本管理

export 有 version，但 storage annotation 本身没有明显 `schema_version`。

建议：

```ts
type Annotation = {
  schema_version: 1;
  ...
}
```

并提供 migration。

### 26.3 全量 JSON 同步不适合大规模

`/api/annotations/sync` 是全量替换。

适合：

- 单用户。
- 小数据量。
- 本地开发。

不适合：

- 大量截图。
- 团队协作。
- 云端多设备。
- 高并发更新。

### 26.4 sync conflict 只按时间戳

`updated_at` 新者胜，简单但不精细。

更可靠方案：

```text
record_revision
device_id
updated_by
field-level merge
deleted_at tombstone
```

### 26.5 source mapping 只能作为 hint

DOM → 源码映射很难保证准确。`source_file_path/source_line_range` 应只作为辅助，不应作为唯一定位依据。

### 26.6 computed styles 存储较重

MCP 会剥离 `element_context.styles`，但 storage/export 仍可能比较臃肿。

建议只存：

- 定位有帮助的样式。
- 用户改动相关 original styles。
- 少量 layout-critical 字段。

---

## 27. 对我们做 Web DOM 标记的建议架构

### 27.1 模块边界

```text
content runtime
  ├─ ShadowRoot UI
  ├─ InspectionController
  ├─ ElementLocator
  ├─ AnnotationEditor
  ├─ BadgeRenderer
  ├─ RouteObserver
  └─ StorageClient

background runtime
  ├─ StorageRepository
  ├─ SyncCoordinator
  ├─ PermissionManager
  └─ API/MCP Bridge

local server
  ├─ AnnotationStore
  ├─ Agent API
  ├─ Screenshot API
  ├─ Watch API
  └─ Export/Import API
```

### 27.2 推荐 Annotation schema

```ts
type Annotation = {
  schema_version: 1;
  id: string;

  project: {
    origin: string;
    url: string;
    path: string;
    title?: string;
  };

  target: {
    selector: string;
    selector_strategy: string;
    selector_preview?: string;

    element: {
      tag: string;
      id?: string;
      classes: string[];
      role?: string;
      text?: string;
      path?: string;
      parent_chain?: ParentNodeContext[];
    };

    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };

    viewport: {
      width: number;
      height: number;
      device_pixel_ratio: number;
    };
  };

  intent: {
    comment: string;
    kind: 'bug' | 'copy' | 'style' | 'layout' | 'question' | 'other';
  };

  changes?: {
    inline_style?: Record<string, { original: string; value: string }>;
    text?: { original: string; value: string };
    css_rules?: string;
  };

  media?: {
    screenshot_id?: string;
    has_screenshot: boolean;
  };

  source_hint?: {
    file?: string;
    line_range?: string;
    confidence?: number;
  };

  status: 'pending' | 'in_progress' | 'resolved' | 'archived';
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};
```

### 27.3 推荐 Agent payload

```ts
type AgentAnnotation = {
  id: string;
  url: string;
  comment: string;
  target: {
    selector_preview: string;
    tag: string;
    text?: string;
    classes?: string[];
    path?: string;
    parent_chain?: string[];
  };
  design_changes?: string[];
  css_rules?: string;
  source_hint?: string;
  has_screenshot: boolean;
};
```

原则：

- agent payload 要低噪声。
- 截图按需取。
- computed styles 默认不返回。
- 多项目必须 filter。

---

## 28. 后续深挖方向

建议后续继续专项分析：

1. `vibe-annotations` selector 生成与重匹配算法。
2. `pending_changes` 如何从 UI 调整映射到代码实现。
3. MCP 工具协议如何控制噪声与误操作。
4. `DOM-Review` 与 `vibe-annotations` 的架构对比。
5. 基于两个项目设计我们自己的 DOM 标记系统技术方案。

---

## 29. 总结

`vibe-annotations` 最有价值的地方，是它把 DOM 标记从“页面上的视觉批注”推进到了“AI coding agent 可消费的工程任务”。

它的核心设计经验：

```text
Shadow DOM UI 隔离
+ 多策略 selector
+ element_context 多证据定位
+ reversible pending_changes
+ 本地优先保存
+ server/MCP agent bridge
+ lazy screenshot
+ project scoped annotations
+ watch mode
+ copy/export fallback
```

对我们做 Web 端 DOM 标记，最应该吸收的是：

> 标记不是 UI，标记是可定位、可同步、可恢复、可执行的任务数据。
