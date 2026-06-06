# ADP: pin 跟随 live DOM 元素采用 rAF + fixed/transform 持久层

> 本 ADP 只记录"pin 如何持续跟随其 DOM 元素的位置"这一个决策。
> 不覆盖 selection frame / intent / detail 卡片（本次明确不动）。

## Context

实际测试中发现：保存后的 pin 不会跟随它所标记的 DOM 元素移动。网页内有大量
可移动的 DOM——页面滚动、容器重排、用户拖拽、JS 动画都会改变元素的视口位置。

根因在现有定位模型：

- pin 的屏幕位置来自 `PinRecord.rect`，由 `annotationToPinRecord` 从
  `ann.context.position`（**保存时**采集的 rect）构造，之后从不刷新。
  `pin-model.ts` 虽然 `querySelector` 拿到了 live 元素引用，但从不读它的
  `getBoundingClientRect()`。
- `renderPin` 用 `top = rect.top + scrollY` 绝对定位，且只有 `window.resize`
  会触发重定位——没有 scroll / rAF / observer 驱动。
- 更关键：surface root 本身是 `position:fixed; inset:0`，pin 是其内部的
  `position:absolute`，所以 pin 实际上已经是视口锚定的。`+ scrollY` 与 fixed
  容器自相矛盾，导致滚动时 pin 干脆不动。

需求额外要求跟随过程**尽可能丝滑**。难点：用户拖拽 / JS 动画移动元素时没有
任何事件可监听，纯事件驱动无法覆盖。

## Decision

**pin 改为持续跟随其持有的 live DOM 元素，用 rAF 循环 + 视口 fixed/transform
定位 + 独立持久 keyed pin 层实现。**

1. **驱动机制：持续 rAF 循环。**
   - 只要可视区内有 ≥1 个 open pin，就跑 `requestAnimationFrame` 循环；
     每帧读 live rect 并更新 transform。
   - 用 `IntersectionObserver` 剔除不可见 pin，控制开销；无可见 pin 时停循环，
     由 observer / scroll 重新唤醒。
   - 每帧先批量读所有 rect、再批量写 transform，避免 layout thrashing。

2. **每帧元素源：持有引用 + 脱钉则冻结。**
   - 每帧读持有的 `pin.element` 的 `getBoundingClientRect()`（覆盖滚动 /
     拖拽 / 重排——即本次报告的全部场景）。
   - 一旦 `element.isConnected` 为假（节点被替换 / 移除），**冻结**在最后位置
     并反映 drifted/lost，绝不跟到错误目标。
   - 重新解析（节点被 rerender 替换后的重新获取）属于独立的 drift recovery，
     **不进本热循环、不在本 ADP 范围**。

3. **定位方式：viewport-fixed + transform。**
   - pin 层视口固定；每个 pin 用 `transform: translate(rect.left, rect.top)`
     直接消费 `getBoundingClientRect()` 的视口坐标。
   - 彻底丢弃 `scrollY` 运算。transform 走合成器、不触发 layout。

4. **架构：独立持久 keyed pin 层。**
   - pin 从 `render()` / `clearSurfaces` 的拆-重建循环中剥离，改为按 id keyed
     的持久层：只在新增 / 删除 / 状态变化时增量更新节点，rAF 只改 transform。
   - 避免 pin 在不相关状态变化（开 detail、daemon 状态等）时被重建导致闪烁、
     CSS 动画重置——这是丝滑的关键。

## Alternatives considered

- **纯事件驱动**（scroll capture/passive + ResizeObserver + window resize）：
  开销最低，但拖拽 / transform 动画 / 父容器重排时无事件、跟不上，无法满足
  丝滑要求。
- **事件 + 短暂 rAF 突发**：检测到交互时开一段短 rAF 再停。折中方案，但超过
  突发窗口的拖拽会掉队，行为不可预期。
- **保持 absolute + 每帧改 left/top**：改动更小，但每帧触发 layout 重排，高频
  拖拽 / 多 pin 时掉帧；且与 fixed root 的坐标模型仍然别扭。
- **最小改动：render() 仍造 pin、rAF 只动现有节点**：代码改动小，但 render()
  一跑仍重建 pin，不相关状态变化会闪烁、重置动画，与丝滑目标冲突。
- **脱钉则隐藏 pin**：比冻结更干净，但丢失 drifted/lost 的可见性，违背 PRD
  "宁可显示 drifted/lost"原则。

## Consequences

- 引入一个持续运行的 rAF 循环（受 IntersectionObserver 与"有无可见 open pin"
  双重 gating），需要在 unmount 时确保取消，避免泄漏。
- pin 层不再受 `render()` 管理，新增了一条 pin 生命周期路径（keyed diff），是
  本次主要复杂度来源；后续 pin 相关改动需走这条路径而非 `clearSurfaces`。
- `PinRecord.rect`（保存时 rect）不再决定屏幕位置，退化为初始 / 兜底值；真相源
  变为 live 元素 rect。
- 节点被 rerender 替换后的重新获取仍缺失（冻结为 drifted/lost），需由后续
  drift recovery 工作补齐。
- selection frame / intent / detail 仍用旧的保存时定位；如未来发现同样问题，
  需另行决策，不被本 ADP 覆盖。

## Status

Accepted
