// Bilingual copy for the landing page. EN is primary/default; 中文 toggles.
// Technical terms (DOM, Agent, MCP, Markdown, Pin, Project, kind, ⌘↵, selectors,
// list_marks, resolve_mark, AgentMark, route_key, locator) stay English in both.

export type Lang = "en" | "zh";

type Entry = [en: string, zh: string];

export const DICT = {
  // ---- chrome / toggles ----
  "theme.light": ["Daylight", "Daylight"],
  "theme.dark": ["Instrument", "Instrument"],

  // ---- hero (Act 1 · browser side) ----
  "hero.eyebrow": ["FOR FRONTENDS WORKING WITH AI AGENTS", "面向与 AI Agent 协作的前端"],
  "hero.title": ["Point at the real DOM.\nYour agent gets exactly that.", "指一下真实 DOM。\nAgent 一字不差收到。"],
  "hero.sub": [
    "Loupe turns “this element, right here” into a structured, project-scoped task your AI coding agent reads over MCP — no lossy translation, no guessing.",
    "Loupe 把“就是这个元素”变成结构化、project-scoped 的任务，AI 编码 Agent 通过 MCP 直接读到 —— 没有有损翻译，不用猜。",
  ],
  "hero.try": ["Live demo — pointing is locked to the panel on the right.", "实时 demo —— 选取范围锁定在右侧面板内。"],
  "hero.hint": ["Hover any element · click to leave a mark", "hover 任意元素 · 点击留下一个 mark"],
  "hero.picking": ["Picking element", "正在选取元素"],

  // ---- act 2 · agent close ----
  "agent.eyebrow": ["AGENT SIDE", "AGENT 侧"],
  "agent.title": ["What the agent actually receives", "Agent 实际收到的东西"],
  "agent.sub": [
    "The mark you just made — read back over MCP as a low-noise AgentMark payload. No raw DOM dump, no styling soup.",
    "你刚才标记的 mark —— 通过 MCP 读回，是一份低噪声的 AgentMark payload。没有原始 DOM dump，没有样式汤。",
  ],
  "agent.idle": ["Leave a mark in the demo above, and it streams in here.", "在上面的 demo 里留一个 mark，它会流到这里。"],
  "agent.resolve": ["Agent finished the change → resolve_mark", "Agent 改完 → resolve_mark"],
  "agent.resolved": ["Pin flips to done ✓ — the loop is closed.", "Pin 翻成 done ✓ —— 闭环合上。"],

  // ---- act 3 · the lossy handoff ----
  "pain.eyebrow": ["THE PROBLEM", "问题"],
  "pain.title": ["The handoff is lossy today", "今天的交接是有损的"],
  "pain.beforeTitle": ["Without Loupe", "没有 Loupe"],
  "pain.afterTitle": ["With Loupe", "有了 Loupe"],
  "pain.before": [
    "See it → switch to the editor → describe “the blue button top-right” → agent guesses the component → maybe edits the wrong file → back-and-forth.",
    "看到问题 → 切回编辑器 → 描述“右上角那个蓝色按钮” → Agent 猜组件 → 可能改错文件 → 来回澄清。",
  ],
  "pain.after": [
    "Point at the real node → write one line of intent → the agent reads a project-scoped mark with a stable locator → finds the code and fixes it.",
    "指一下真实节点 → 写一句意图 → Agent 读到带稳定 locator 的 project-scoped mark → 找到代码并修复。",
  ],
  "pain.lostLabel": ["What gets lost", "丢失的信息"],
  "pain.lost": [
    "exact DOM node · its context · a stable locator · current route & project · accessible name · framework component · whether it’s already done",
    "确切 DOM 节点 · 它的上下文 · 稳定定位方式 · 当前 route 与 project · 可访问名称 · 框架组件 · 是否已完成",
  ],

  // ---- act 4 · why you can trust it ----
  "trust.eyebrow": ["WHY IT’S TRUSTWORTHY", "为何可信"],
  "trust.title": ["Locating is the trust", "定位即信任"],
  "trust.c1.t": ["Multi-evidence locating", "多证据定位"],
  "trust.c1.b": [
    "A locator bundle, weighted resolve, and ambiguity downgrade — not one fragile selector. Low confidence is surfaced as drifted / lost, never a silent wrong pick.",
    "locator bundle + 加权 resolve + 歧义降级 —— 不是单个脆弱 selector。信心不足会显式标 drifted / lost，绝不静默指错。",
  ],
  "trust.c2.t": ["Project & session isolation", "Project / session 隔离"],
  "trust.c2.b": [
    "Every mark carries project_id, route_key and session_id. Marks never bleed across projects; a project is a mark’s trust boundary.",
    "每个 mark 都带 project_id、route_key、session_id。mark 不跨项目混合；project 就是 mark 的信任边界。",
  ],
  "trust.c3.t": ["Local-first, token-guarded", "本地优先，token 保护"],
  "trust.c3.b": [
    "Everything runs on an authenticated local daemon over loopback. The MAIN world stays read-only; the MCP payload never leaks tokens, raw storage, or screenshot bytes.",
    "一切跑在 loopback 上、带认证的本地 daemon。MAIN world 只读；MCP payload 不泄露 token、原始存储或截图字节。",
  ],
  "trust.c4.t": ["Done is a real state", "完成是一个真实状态"],
  "trust.c4.b": [
    "resolve_mark closes a task; delete_mark is an explicit user deletion that writes a tombstone. The agent always knows what’s still open.",
    "resolve_mark 关闭任务；delete_mark 是用户显式删除并写 tombstone。Agent 永远知道还有什么是 open。",
  ],

  // ---- act 5 · install ----
  "install.eyebrow": ["GET STARTED", "开始使用"],
  "install.title": ["Install", "安装"],
  "install.sub": [
    "Three honest pieces. No single-line curl-pipe-bash — Loupe never pretends.",
    "三件套，诚实呈现。没有单行 curl | bash —— Loupe 绝不假装。",
  ],
  "install.s1.k": ["STEP 1", "第 1 步"],
  "install.s1.t": ["Run the daemon", "启动 daemon"],
  "install.s1.b": [
    "The local daemon hosts the MCP endpoint on 127.0.0.1:7373 and stores your marks.",
    "本地 daemon 在 127.0.0.1:7373 提供 MCP 端点并存储你的 mark。",
  ],
  "install.s2.k": ["STEP 2", "第 2 步"],
  "install.s2.t": ["Chrome extension", "Chrome 扩展"],
  "install.s2.b": [
    "The in-page picker and surfaces live in the extension. Not on the Web Store yet — load it unpacked.",
    "页内 picker 与各 surface 在扩展里。尚未上架 Web Store —— 先用 unpacked 加载。",
  ],
  "install.s2.cta": ["Load unpacked (guide)", "Unpacked 加载指南"],
  "install.s3.k": ["STEP 3", "第 3 步"],
  "install.s3.t": ["Claude plugin", "Claude 插件"],
  "install.s3.b": [
    "Wires the MCP tools into Claude over a token-free stdio proxy. Coming soon.",
    "通过 token-free 的 stdio proxy 把 MCP tools 接入 Claude。即将推出。",
  ],
  "install.soon": ["Coming soon", "即将推出"],
  "install.copy": ["Copy", "复制"],
  "install.copied": ["Copied", "已复制"],

  // ---- footer ----
  "footer.tagline": ["Point at the DOM. The agent gets exactly that.", "指一下 DOM。Agent 一字不差收到。"],
  "footer.github": ["Star on GitHub", "在 GitHub 上 Star"],
  "footer.waitlist": ["Join the waitlist", "加入 waitlist"],
  "footer.waitlist.ph": ["you@email.com", "you@email.com"],
  "footer.waitlist.ok": ["You’re on the list ✓", "已加入 ✓"],
  "footer.built": ["An optical instrument for the DOM.", "一台面向 DOM 的光学仪器。"],
} satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;

export function translate(key: DictKey, lang: Lang): string {
  const e = DICT[key];
  return lang === "zh" ? e[1] : e[0];
}
