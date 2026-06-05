// i18n — zh primary, EN toggle. Technical terms stay English (DOM, Agent,
// Markdown, Pin, Project, kind, route, CSS selectors, ⌘↵). Dictionary ported
// from docs/ui-ux/prototypes/loupe-surfaces.jsx (the locked copy of record).

export type Lang = "zh" | "en";

type Dict = Record<string, readonly [string, string]>;

const DICT: Dict = {
  "auth.title": ["允许 Loupe 在本站点运行", "Allow Loupe on this site"],
  "auth.body": ["在本页选取真实 DOM 元素,把它变成给 agent 的任务。", "Pick real DOM elements on this page and turn them into agent tasks."],
  "auth.allow": ["允许本站点", "Allow site"],
  "auth.not": ["以后再说", "Not now"],

  "proj.title": ["为本站点选择 Project", "Choose project for this site"],
  "proj.sub": ["此 origin 关联了多个 Project — Project 是 mark 的安全边界。", "This origin maps to several projects — a project is a mark's trust boundary."],
  "proj.local": ["仅本地继续", "Continue locally"],
  "proj.notlink": ["尚未关联 Project", "project not linked"],
  "proj.confirm": ["进入选取", "Start picking"],

  "mode.pick": ["正在选取元素", "Picking element"],

  "intent.ph": ["告诉 agent 你想改什么…", "Tell the agent what to change…"],
  "intent.hint": ["先写一句任务", "Write a task first"],
  "intent.kind": ["类别", "KIND"],
  "intent.save": ["保存 · ⌘↵", "Save · ⌘↵"],
  "intent.savea": ["保存 mark", "Save mark"],
  "intent.commenta": ["给 agent 的任务", "Task for the agent"],
  "intent.add": ["再标一个", "Add another"],
  "intent.discard": ["再按一次 Esc 丢弃", "Press Esc again to discard"],
  "intent.saveErr": ["保存失败", "Save failed"],

  "kind.bug": ["缺陷", "bug"],
  "kind.copy": ["文案", "copy"],
  "kind.style": ["样式", "style"],
  "kind.layout": ["布局", "layout"],
  "kind.question": ["疑问", "question"],
  "kind.other": ["其他", "other"],

  "task.open": ["待办", "open"],
  "task.done": ["已完成", "done"],
  "task.archived": ["已归档", "archived"],
  "loc.located": ["已定位", "located"],
  "loc.drifted": ["偏移", "drifted"],
  "loc.lost": ["丢失", "lost"],
  "sync.synced": ["已同步", "synced"],
  "sync.local": ["仅本地", "local only"],
  "sync.failed": ["同步失败", "sync failed"],
  "sync.syncing": ["同步中", "syncing"],
  // delete_pending is a real wire state the prototype omitted; closest in-flight label.
  "sync.deleting": ["删除中", "deleting"],

  "detail.done": ["标记完成", "Mark done"],
  "detail.doneOk": ["已完成", "Done"],
  "detail.copy": ["复制 Markdown", "Copy Markdown"],
  "detail.copyOk": ["已复制", "Copied"],
  "detail.copyErr": ["复制失败", "Copy failed"],
  "detail.del": ["删除", "Delete"],
  "detail.delArm": ["确认删除?", "Delete?"],
  "detail.delOk": ["已删除", "Deleted"],
  "detail.viewall": ["查看全部", "View all"],

  "va.title": ["当前页面的 marks", "Marks on this page"],
  "va.aria": ["当前页面的 marks", "Marks on this page"],
  "va.open": ["待办", "open"],
  "va.showdone": ["显示已完成", "Show done"],
  "va.copyall": ["复制全部 Markdown", "Copy all Markdown"],
  "va.empty.t": ["本页还没有 mark", "No marks on this page"],
  "va.empty.s": ["选取一个元素来创建。", "Pick an element to create one."],
  "va.start": ["开始选取", "Start picking"],
  "va.close": ["关闭", "Close"],

  "fb.title": ["已保存到本地。Agent 同步不可用。", "Saved locally. Agent sync unavailable."],
  "fb.body": ["复制 Markdown,把这个 mark 交给 agent。", "Copy Markdown to hand this mark to an agent."],
  "fb.copy": ["复制 Markdown", "Copy Markdown"],
  "fb.retry": ["重试", "Retry"],

  "status.title": ["Loupe 状态", "Loupe status"],
  "status.connected": ["已连接", "connected"],
  "status.offline": ["守护进程离线", "daemon offline"],
  "status.tokenMissing": ["令牌缺失", "token missing"],
  "status.syncFailed": ["同步失败", "sync failed"],
  "status.localOnly": ["仅本地保存", "saved locally"],
  "status.retry": ["重试", "Retry"],
  "status.copy": ["复制 Markdown", "Copy Markdown"],
  "status.init": ["运行 `loupe init` 修复", "Run `loupe init` to repair"],
  "status.close": ["关闭", "Close"],

  "ui.theme": ["主题", "Theme"],
  "ui.lang": ["语言", "Language"],
};

export type Translate = (key: string, fallback?: string) => string;

export type I18n = {
  t: Translate;
  lang: () => Lang;
  setLang: (lang: Lang) => void;
};

export function createI18n(initial: Lang = "zh"): I18n {
  let current: Lang = initial;
  const t: Translate = (key, fallback) => {
    const entry = DICT[key];
    if (entry === undefined) return fallback ?? key;
    return current === "zh" ? entry[0] : entry[1];
  };
  return {
    t,
    lang: () => current,
    setLang: (lang) => {
      current = lang;
    },
  };
}
