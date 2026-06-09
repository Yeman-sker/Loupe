# 阶段 MKT-0 · 落地产品介绍页（交互式 Selection frame demo）

> **性质：营销产物，非产品运行路径。** 一个独立部署的落地页，让访客在页内直接体验 Loupe 的签名动作——指一下真实 DOM、框精确跟过去——并把"你指的东西 Agent 一字不差收到"演到闭环合上。品牌严格遵循已锁定的 "Optical Instrument" 设计系统。

## 阶段目标

- **Hero 看，Demo 摸（精细化改版，推翻原决策 #7）。** 首屏 hero 不再承载交互沙盒：左侧极简标题 + install widget，右侧一块**循环品牌动画**——点阵粒子从混沌漂浮 → 被扫描捕中 → 凝聚对齐成 **Selection frame**（iris hue 286 角括号 + mono dimension readout）→ 消散重来；动画里子与产品核心动作「从混沌 DOM 中精准锁定一个元素」同构。Hero 占 ~90vh。可交互沙盒下移为**独立第二屏满宽**（访客滚一屏即上手），数据流（沙盒生成 mark → Agent 侧读取）仍靠 context 串联。
- **演完整信任闭环、拆成上下两幕。** Hero（第一幕·浏览器侧）演到 `pick → intent input → 写一句意图 → ⌘↵ → 框 collapse 成 pin`；向下滚，刚生成的那条 mark 数据无缝流入第二幕（Agent 侧）的仿终端，显示 `list_marks` 读到的低噪声 AgentMark payload（PRD §11.1 shape），pin 翻成 `done ✓`。**闭环在第二幕合上。** 只走 happy path，不演 drifted/lost。
- **诚实的三件套安装。** install widget 视觉照抄 opencode 式（包管理器 tab + 复制按钮），内容为 daemon `@loupe-server/server` 的 `npm / npx / pnpm / bun`（brew 待 formula）；外层用 **Step 1（daemon）/ Step 2（Chrome 扩展）/ Step 3（Claude 插件）** 的真实结构呈现，未发布的扩展/插件标 Coming soon 或给手动/unpacked 链接。**不伪装成单行 `curl|bash` 一键装。**
- **品牌一致。** 只共享 `loupe-tokens.css` 作为唯一真相源；Selection frame / intent input / pin / 仿终端按落地页语境**重写**，以 `docs/ui-ux/prototypes` 的 JSX/CSS 当像素与动效蓝图。默认 dark "Instrument"，带主题开关；默认英文，单一开关同步切外壳与沙盒，技术术语恒英文。
- **7 段叙事弧（改版后）。** Hero（品牌动画） → Demo（可交互沙盒，独立一屏） → Agent 侧合环 → 有损翻译痛点（PRD §1.1 对比） → 为何可信（多证据定位+显式 drifted/lost、project/session 隔离、本地优先 token 安全；PRD §17.1） → Install Step 1/2/3 → Footer（GitHub 主 CTA + waitlist 次 + 主题/语言开关）。

- **全页微弱格子背景。** 整页底层铺一层极微弱 hairline 格子（编程/精密质感），但**沙盒舱体处挑空**（不透明遮住全页格子），避免与沙盒自带网格、host 内部栅格三层叠加「格子套格子」。全页格仅作环境质感，不与产品航拍网格争夺视觉。

## 验收标准

- 首屏沙盒可交互：鼠标划过 mock host 元素，Selection frame 连续 morph、报正确尺寸与语义 label；交互**永不指错**（作用域锁死在沙盒内）。
- 完整闭环可走通：沙盒内 `pick → intent → pin`，向下滚第二幕仿终端展示该 mark 的 AgentMark payload 并将 pin 置为 `done`，数据来自访客刚才的真实操作。
- install widget tab 切换正确、复制按钮可用；Step 1/2/3 结构诚实，未发布部分明确标注，无"单行一键装"的虚假承诺。
- 主题开关在 dark/light 间切换、语言开关在 EN/中文间**同步**切外壳与沙盒；技术术语两语言下均英文。
- 品牌 token 全部来自共享的 `loupe-tokens.css`；iris 仅出现在"工具 live/看着"的地方，无满屏品牌紫。
- 可在 Vercel 以 monorepo 子目录（Root Directory 指向 `packages/landing`）成功部署；沙盒为 `"use client"` island，其余 SSG，首屏 JS 体积受控。

## 范围边界（本阶段不做）

- 让访客拾取**落地页自身**的任意元素（whole-page picker）——明确不做，作用域只在沙盒。
- 真实跑 locator scoring / drift recovery / MCP——仿 Agent 侧是 demo 自生数据的证据展示，不接真引擎。
- drifted / lost 等失败态演示、replies、screenshot——落地页只讲 happy path。
- 编排式 `curl -fsSL .../install | bash` 安装脚本——待 Claude 插件发布后作为 launch polish，再把 Step 1+3 合并；Step 2（扩展）永远独立。
- waitlist 后端选型、SEO/OG、移动端深度打磨——可在实现期作为子任务细化，不阻塞主闭环。

## 依赖

- 已发布 `@loupe-server/server@0.4.0`（bin `loupe` / `loupe-server`），install widget 的 Step 1 可立即兑现。
- `docs/ui-ux/prototypes/`（loupe-tokens.css + loupe-surfaces.jsx + loupe.css）作为像素/动效/字串蓝图。
- `docs/ui-ux/loupe-in-page-surfaces-interaction-spec.md` §2 显示词表、§5 selection frame、Pin/AgentMark 语义。
- PRD §1.1（痛点）、§11.1（AgentMark payload）、§17.1（差异化对照）。

## 退出条件

- `packages/landing` 可本地起、可 Vercel 部署；6 段叙事弧全部到位。
- 首屏沙盒完整闭环 + 第二幕合环可演示；install Step 1/2/3 诚实可用；主题/语言开关工作。
- hero 截帧/录屏可反哺 GitHub README 顶部（一处生产、多处复用）。

## 决策记录（本阶段 grill 结论，不另写 ADP）

| # | 决策 | 结论 |
|---|---|---|
| 1 | Hero 主角 | Selection frame（非 Pin、非满屏紫） |
| 2 | 交互形态 | 受控沙盒，作用域锁死，零误判 |
| 3 | 闭环深度 | 演完整闭环含仿 Agent 侧；仅 happy path |
| 4 | 代码复用 | 只共享 `loupe-tokens.css`；表面重写，prototype 当蓝图；不耦合扩展运行时 |
| 5 | 技术栈/位置 | `packages/landing`，Next.js + Vercel；沙盒 `"use client"` island，其余 SSG |
| 6 | 主 CTA / 安装 | GitHub 主 + waitlist 次；install widget = daemon 包管理器 tab，外套 Step 1/2/3 诚实结构 |
| 7 | 沙盒位置 | ~~沙盒即 hero，above the fold~~ **改版推翻**：Hero 右侧为品牌动画，沙盒下移为独立第二屏满宽 |
| 11 | Hero 动画 | 循环品牌动画 = 点阵/点阵粒子 **凝聚成 Selection frame**（混沌漂浮→扫描捕中→对齐成框→消散重来）；非 8-bit pixel-art、非 logo 拼字、非纯装饰点阵场 |
| 12 | 动画实现 | Canvas 2D 手写 rAF 粒子（不引重库，首屏 JS 增量 <10kB，仅视口内可见时跑）；`prefers-reduced-motion` 时冻结为一帧静态「已凝聚的选框」 |
| 13 | iris 用量 | 点阵默认中性色；iris 仅在「扫描捕中→凝聚成框」一刻点亮，守住「无满屏品牌紫」铁律 |
| 14 | 全页格子 | 全页底层铺极微弱 hairline 格子；沙盒舱体处挑空，避免格子套格子 |
| 15 | 首屏高度 | Hero ~90vh（动画够大够惊艳，底部留下滚提示）；Demo 沙盒满宽独立一屏 |
| 8 | 语言 | 默认英文 + 单一开关同步切中文；技术术语恒英文 |
| 9 | 主题 | 默认 dark "Instrument"，带开关；主题+语言开关并排顶栏右上 |
| 10 | 叙事弧 | ~~6 段~~ **改版为 7 段**：Hero（动画）→ Demo（沙盒）→ Agent 合环 → 痛点 → 为何可信 → Install → Footer |

> install 诚实性（不伪装单行一键装）编码了产品"绝不假装"第一原则；理由留在本文档与落地页 install section 文案/代码注释中，按 AGENTS.md 不另写 ADP（易回滚，三条件缺 hard-to-reverse）。

> **改版说明（推翻 #7 → 新增 #11–#15）。** 原赌注「沙盒即 hero、3 秒摸到手感」放弃，因为 demo 挤在标题右侧空间太小、演示效果差。改为：Hero 用一段循环品牌动画（点阵凝聚成 Selection frame）抓注意力，沙盒下移为独立满宽一屏让访客充分上手。此为落地页布局调整，易回滚、不触及产品运行路径，按 AGENTS.md 三条件（缺 hard-to-reverse）不写 ADP，结论留在本决策表。

## 当前状态

`In progress` — `packages/landing`（Next.js 15 + App Router）已落地，6 段叙事弧全部到位：
Hero 沙盒（hover→morph→pick→intent→⌘↵→collapse-to-pin，作用域锁定面板内）→ Agent 侧仿终端
（`list_marks`/`get_mark` 读访客真实 mark 的 AgentMark payload，`resolve_mark` 合环、pin→done）→
痛点对照 → 为何可信 → 诚实 Install Step 1/2/3（daemon 包管理器 tab + 复制；扩展/插件标 Coming soon）→
Footer（GitHub 主 CTA + waitlist 次 + 主题/语言开关）。共享 `loupe-tokens.css` 为唯一 token 真相源；
默认 dark "Instrument" + 主题开关；默认英文 + 单一语言开关同步切外壳与沙盒，技术术语恒英文。
本地 `pnpm --filter @loupe-server/landing dev` 可起，`build` 产物全站 SSG（首屏 ~112kB JS）。
完整闭环已用浏览器端到端验证通过。

待办（不阻塞主闭环）：Vercel 部署（Root Directory 指向 `packages/landing`）实测、waitlist 后端、
hero 截帧反哺 README、SEO/OG、移动端深度打磨。
