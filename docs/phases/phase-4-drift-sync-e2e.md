# 阶段 4 · 漂移恢复、同步韧性与扩展 E2E

> **对应里程碑：M4** ｜ 把信任闭环做到生产级稳：活体 route/DOM 漂移后能受控恢复且绝不提交 stale 结果、同步可重试可离线降级、support matrix 用运行时验证落地，并用真实 MV3 E2E 回归早期契约/安全门。

## 阶段目标

- **活体 route / detach 恢复正确性由本阶段负责。** route 切换、目标 detach、页面重新稳定后，pin 能以当前世代重新定位；任何属于过期 route 或过期世代的解析结果都不会落地为 pin 位置（宁可不动，也不指错）。
- **各类 SPA 路由都能被一致感知。** 无论通过哪种导航方式触发 route 变化，恢复流程都能被一致触发；恢复过程中到来的新 route 变化会取消旧恢复并以新世代重启。
- **同步韧性在真实生命周期下成立。** 同步失败可重试，daemon 离线时 mark 可靠地留在本地，service worker 唤醒后按 project/session 补齐未同步内容，token 失效时所有 mark 保持本地优先并始终提供 retry 与 Copy Markdown 兜底。
- **support matrix 做运行时验证，而非静态声明。** same-origin iframe 可定位并标明所属 frame；cross-origin iframe 只标外壳并提示边界；SVG / canvas / open & closed Shadow DOM / portal / teleport / nested scroll 各自的 picker 行为与重解析行为都符合 §7.8。
- **信任闭环关键路径有接近真实环境的 MV3 E2E / regression 兜底。** 用加载真实扩展的浏览器 E2E 覆盖 MV3 关键路径（world 桥、权限/授权分支、service worker 生命周期、本地存储一致性、同步的在线/离线/失败重试、MCP 读取与 `resolve_mark` 后 pin 状态变更）。
- **契约/安全门在本阶段只做回归，不做首次归属。** M0/M3 已声明的 MCP schema、scope 隔离、auth、startup、persistence 安全行为必须继续自动化回归；本阶段不把这些 gate 重新定义为 M4 首次交付。

## 验收标准

- rerender、route 切换、目标 detach、service worker 休眠、daemon offline 五类活体场景全部通过，且全程无 stale route pin commit。
- 漂移恢复发生在页面稳定之后；恢复过程中到来的新 route 变化会取消并以新世代重启恢复。
- 同步韧性覆盖 online/offline、service worker 休眠唤醒、失败重试、token 失效与 Copy Markdown 兜底，本地 mark 不因远端失败丢失或被错误覆盖。
- support matrix（§7.8）每一项都在运行时既验 picker 行为，也验重解析行为。
- Playwright persistent Chromium MV3 E2E 覆盖 §13.2 全部清单并通过，作为集成回归验证 world 桥、权限/授权、service worker 生命周期、存储一致性、MCP 读取与 `resolve_mark` 状态变化。
- contract/security 测试（§13.4）作为 M0/M3 gate 的回归信号保持全绿：MCP schema（snake_case/低噪声/无泄漏）、scope 隔离（multi-project 不混读、bare-id mutation 拒绝）、auth（无 token 401、`/health` 匿名）、startup（健康检查判定、端口冲突失败清晰）、persistence（写入健壮、损坏可恢复、tombstone 防复活）。
- KPI：Local save success 在 offline/休眠/重试/token 失效**韧性路径下仍维持** = 100%；live route/detach recovery correctness 通过 E2E 持续守住；Project isolation violations 以回归测试**持续守住** = 0。

## 范围边界（本阶段不做，留待后续）

- onboarding 文案、视觉/motion/rich toolbar/pin detail 视觉打磨、完整 CLI 文案与日志 UI、官方 marketplace 发布 → 阶段 5。
- lazy 截图、`watch_marks`、replies、`pending_changes`、cloud sync 等 → PRD §4.4 后续路线（Roadmap Phase 2 及以后）。

## 依赖

- 阶段 1（重解析）、阶段 2（扩展/存储/pin）、阶段 3（daemon `/v1/marks*` 与 MCP）。

## 对应 PRD 章节

- §7.7、§7.8 与 §13.3、§8.4、§10.4、§12.1、§13.2、§13.4、§14（M4）
