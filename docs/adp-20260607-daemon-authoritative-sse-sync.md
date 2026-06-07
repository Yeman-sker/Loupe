# ADP 20260607 · Daemon 权威真相源与 SW 持有的 SSE 推送同步

## Context

`adp-20260602` 选择 **local-first**：`chrome.storage.local` 是浏览器交互的真相源，daemon 只做
best-effort 镜像与 Agent bridge，浏览器仅在 service-worker wake 时与 daemon 对账。该架构下存在两个
**可写**的真相副本（page 与 daemon），且不存在 daemon→extension 通道：

1. **数据漂移。** page 与 daemon 双写，需要持续 reconcile、tombstone、冲突恢复。
2. **读侧陈旧。** 页面打开期间，Agent `resolve_mark`、第二个标签页或 CLI 的改动，要等到下一次
   偶发的 SW wake 才会反映——一个已被 resolve 的 pin 可能长时间显示为 open。

产品诉求改变：daemon 现在通过发布的 `loupe` / `loupe-server` CLI 作为**独立常驻进程**启动，
用户要求标注同步在日常工作中**无感**——不打断、不在 daemon 短暂重启时弹错误。

约束：Chrome MV3 扩展**不能 spawn/监管本地进程**，也**不能让 page 持有 daemon token**
（`mv3/content.ts` 断言 `exposes_token_to_page: false`；生产 in-page runtime 从不读取 token）。

## Decision

采用 **daemon 权威真相源 + service-worker 持有的 SSE 推送 + Port 中继到页面**：

1. **真相源 = daemon。** `~/.loupe/marks.json`（`mark-store.ts`）是权威；`chrome.storage.local`
   降级为**渲染缓存 + 写出 outbox**，永不在冲突中胜过 daemon。
2. **daemon 推送。** 新增鉴权端点 `GET /v1/marks/stream`（SSE，`text/event-stream`），按 project
   scope 过滤；mutation 唯一收口（`upsertMark` / `resolveMark` / `deleteMark`，同时覆盖 REST 与 MCP）
   通过进程内事件总线 `mark-events.ts` 发布 `upsert|resolve|delete`，连接时先发一帧 `snapshot`。
3. **SW 持有连接，Port 中继到页面。** service worker 持有 token，用 **`fetch()` 流式读取**（不是
   `EventSource`，后者无法发送 `Authorization` 头）打开 SSE；in-page app 通过
   `chrome.runtime.connect({ name: "loupe.mark_stream" })` 订阅；SW 把每帧 reconcile 进
   `chrome.storage.local` 缓存后，`port.postMessage` 转发**不含 token**的变更帧给页面，页面对 pin 层做
   **diff** 更新（按 id，不整层重渲染）。连接的 Port 仅在 dev tab 打开期间维持 SW 存活，无 tab 时归零。
4. **daemon-down = transient-silent / sustained-onboards。** 曾配对过的 daemon 短暂不可达时静默
   （保留缓存 pin、写入排队、SW 后台退避重连、页面无 UI）；仅首次未配对或长时间缺席才走既有
   onboarding（`adp-20260605-local-project-gated-onboarding`）。

本 ADP **部分取代 `adp-20260602`**：取代其「`chrome.storage.local` 为真相源」与「extension 始终发起、
daemon 无页面通道」两项；其余（多证据 locator、project/session scope、low-noise AgentMark、MAIN/ISOLATED
边界、固定 7373、token 不进 page）继续有效。

## Alternatives considered

1. **保持 local-first（adp-20260602 现状）。** 数据漂移与读侧陈旧无法消除。未采用。
2. **WebSocket 双工通道。** 当前不需要 client→server 推送；比 SSE 多余且更重。未采用。
3. **页面定时轮询（chrome.alarms / setInterval）。** MV3 SW 生命周期使定时器不可靠，keepalive hack
   会泄漏到用户体验，不满足无感。未采用。
4. **无 tab 时仍维持后台 offscreen 连接。** 增加常驻后台足迹，违背「不影响用户」。未采用。
5. **page 直接开 SSE（持有 token）。** 最简单，但把 Bearer token 推入页面隔离世界，破坏
   `exposes_token_to_page: false` 与 adp-20260602 的 page/token 边界。未采用——改由 SW 持有、Port 中继。
6. **匿名（免 token）stream 端点。** 让 page 直连，但放弃 `/v1/marks*` 必须鉴权的约束。未采用。

## Consequences

### Positive
- 消除双可写真相：写侧只有 daemon 权威，page 缓存只读 + outbox。
- 读侧近实时：resolve/delete/编辑在打开的页面上 ~1s 内静默反映，无闪烁、无交互。
- token 始终留在 SW，page 永不持有；保持 `exposes_token_to_page: false`。
- 无 tab 时零后台连接足迹；连接生命周期 ≈ dev tab 打开期。

### Negative / cost
- 新增 SW 端 SSE 客户端 + 退避重连 + Port 中继三段链路的维护成本。
- `background.js` 为手维护的发布 SW，须与 `background.ts` 同步镜像该逻辑。
- 「另一个标签页新建的 mark」在本页放置 pin 依赖从缓存读回完整 Annotation 后用 locator 落点；属边缘路径。

### Follow-up constraints
- `/v1/marks/stream` 与其它 `/v1/marks*` 一样必须 Bearer 鉴权；CORS 不能替代鉴权。
- stream 帧必须保持 snake_case wire 语义（`MarkStreamEvent`）。
- daemon 短暂不可达不得在页面弹错误；仅 sustained 缺席才 onboard。

## Status

Accepted
