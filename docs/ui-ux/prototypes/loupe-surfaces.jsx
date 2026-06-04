/* loupe-surfaces.jsx — presentational surfaces + i18n + mock dev app.
   Exports to window: LT (translate), Tok, metaTokens, Pin, SelectionFrame,
   IntentInput, PinDetail, ViewAll, HostAuth, ProjectChooser, PageFallback, MockApp. */
(function () {
  "use strict";
  const { useState, useRef, useEffect, useLayoutEffect } = React;

  /* ---------------- i18n: zh primary, EN toggle; tech terms stay English -------- */
  const DICT = {
    "auth.title":   ["允许 Loupe 在本站点运行", "Allow Loupe on this site"],
    "auth.body":    ["在本页选取真实 DOM 元素,把它变成给 agent 的任务。", "Pick real DOM elements on this page and turn them into agent tasks."],
    "auth.allow":   ["允许本站点", "Allow site"],
    "auth.not":     ["以后再说", "Not now"],

    "proj.title":   ["为本站点选择 Project", "Choose project for this site"],
    "proj.sub":     ["此 origin 关联了多个 Project — Project 是 mark 的安全边界。", "This origin maps to several projects — a project is a mark's trust boundary."],
    "proj.local":   ["仅本地继续", "Continue locally"],
    "proj.notlink": ["尚未关联 Project", "project not linked"],
    "proj.confirm": ["进入选取", "Start picking"],

    "mode.pick":    ["正在选取元素", "Picking element"],
    "mode.proj":    ["Project: app-web", "Project: app-web"],

    "intent.ph":    ["告诉 agent 你想改什么…", "Tell the agent what to change…"],
    "intent.hint":  ["先写一句任务", "Write a task first"],
    "intent.kind":  ["类别", "KIND"],
    "intent.save":  ["保存 · ⌘↵", "Save · ⌘↵"],
    "intent.savea": ["保存 mark", "Save mark"],
    "intent.add":   ["再标一个", "Add another"],
    "intent.discard":["再按一次 Esc 丢弃", "Press Esc again to discard"],

    "kind.bug":["缺陷","bug"], "kind.copy":["文案","copy"], "kind.style":["样式","style"],
    "kind.layout":["布局","layout"], "kind.question":["疑问","question"], "kind.other":["其他","other"],

    "task.open":["待办","open"], "task.done":["已完成","done"], "task.archived":["已归档","archived"],
    "loc.located":["已定位","located"], "loc.drifted":["偏移","drifted"], "loc.lost":["丢失","lost"],
    "sync.synced":["已同步","synced"], "sync.local":["仅本地","local only"],
    "sync.failed":["同步失败","sync failed"], "sync.syncing":["同步中","syncing"],

    "detail.done":   ["标记完成","Mark done"],
    "detail.doneOk": ["已完成","Done"],
    "detail.copy":   ["复制 Markdown","Copy Markdown"],
    "detail.copyOk": ["已复制","Copied"],
    "detail.copyErr":["复制失败","Copy failed"],
    "detail.del":    ["删除","Delete"],
    "detail.delArm": ["确认删除?","Delete?"],
    "detail.delOk":  ["已删除","Deleted"],
    "detail.viewall":["查看全部","View all"],

    "va.title":   ["app-web","app-web"],
    "va.open":    ["待办","open"],
    "va.showdone":["显示已完成","Show done"],
    "va.copyall": ["复制全部 Markdown","Copy all Markdown"],
    "va.empty.t": ["本页还没有 mark","No marks on this page"],
    "va.empty.s": ["选取一个元素来创建。","Pick an element to create one."],
    "va.start":   ["开始选取","Start picking"],
    "va.close":   ["关闭","Close"],

    "fb.title":   ["已保存到本地。Agent 同步不可用。","Saved locally. Agent sync unavailable."],
    "fb.body":    ["复制 Markdown,把这个 mark 交给 agent。","Copy Markdown to hand this mark to an agent."],
    "fb.copy":    ["复制 Markdown","Copy Markdown"],
    "fb.retry":   ["重试","Retry"],

    "hud.start":  ["选取元素","Pick element"],
    "hud.exit":   ["退出选取","Exit picking"],
    "hud.viewall":["查看全部","View all"],
    "hud.hint":   ["在页面上 hover 任意元素 · Enter 确认 · Esc 退出","Hover any element on the page · Enter to confirm · Esc to exit"],

    "app.title":  ["账户设置","Account settings"],
    "app.sub":    ["管理你的个人资料、登录方式与通知偏好。","Manage your profile, sign-in and notification preferences."],
  };
  let LANG = "zh";
  function LT(key, fallback) {
    const e = DICT[key];
    if (!e) return fallback != null ? fallback : key;
    return LANG === "zh" ? e[0] : e[1];
  }
  LT.set = (l) => { LANG = l; };
  LT.get = () => LANG;
  window.LT = LT;

  const KINDS = ["bug", "copy", "style", "layout", "question", "other"];

  /* ---------------- status tokens (glyph + text, never colour-only) ----------- */
  function Tok({ cls, glyph, label, kind }) {
    return (
      <span className={"tok tok--" + cls} data-kind={kind || undefined}>
        <span className="g" aria-hidden="true">{glyph}</span>
        <span>{label}</span>
      </span>
    );
  }
  window.Tok = Tok;

  function locToken(p) {
    if (p.loc === "lost") return { cls: "bad", glyph: "✕", label: LT("loc.lost") };
    if (p.loc === "drifted") return { cls: "warn", glyph: "△", label: LT("loc.drifted") + " " + p.conf + "%" };
    return { cls: "good", glyph: "✓", label: LT("loc.located") + " " + p.conf + "%" };
  }
  function syncToken(p) {
    if (p.sync === "failed") return { cls: "bad", glyph: "✕", label: LT("sync.failed") };
    if (p.sync === "local") return { cls: "neutral", glyph: "•", label: LT("sync.local") };
    if (p.sync === "syncing") return { cls: "open", glyph: "◌", label: LT("sync.syncing") };
    return { cls: "good", glyph: "✓", label: LT("sync.synced") };
  }
  function taskToken(p) {
    if (p.task === "done") return { cls: "good", glyph: "✓", label: LT("task.done") };
    if (p.task === "archived") return { cls: "neutral", glyph: "▢", label: LT("task.archived") };
    return { cls: "open", glyph: "○", label: LT("task.open") };
  }
  function metaTokens(p) { return { task: taskToken(p), loc: locToken(p), sync: syncToken(p) }; }
  window.metaTokens = metaTokens;

  /* ---------------- PIN — optical reticle marker --------------------------------- */
  function Pin({ p, style, shape, onOpen, focused }) {
    const cls = ["pin", "shape-" + (shape || "reticle"), p.task === "done" ? "done" : "",
      p.loc === "drifted" ? "drift" : "", p.loc === "lost" ? "lost" : "",
      p.task === "open" && p.loc === "located" ? "open" : ""].join(" ");
    const m = metaTokens(p);
    return (
      <button className={cls} data-kind={p.kind} style={style}
        onClick={(e) => { e.stopPropagation(); onOpen(p); }}
        aria-label={"Mark " + p.num + " — " + p.comment}>
        {p.task === "open" && p.loc === "located" && shape !== "dot" ? <span className="pulse" /> : null}
        {shape === "tag"
          ? <span className="ring"><span className="kdot" /><span className="num">{p.num}</span></span>
          : <span className="ring"><span className="num">{p.num}</span></span>}
        {shape === "reticle" ? (
          <svg className="arc" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="11" strokeDasharray="16 60" transform="rotate(-58 12 12)" />
          </svg>
        ) : null}
        {p.task === "done" ? <span className="badge" aria-hidden="true">✓</span> : null}
        {p.loc === "drifted" ? <span className="badge" aria-hidden="true">△</span> : null}
        {p.loc === "lost" ? <span className="badge" aria-hidden="true">✕</span> : null}
        {p.stack ? <span className="stackn">+{p.stack}</span> : null}
        <span className="pin-tip">
          <Tok {...m.task} /><span className="tsep">·</span>
          <Tok {...m.loc} /><span className="tsep">·</span>
          <Tok {...m.sync} />
        </span>
      </button>
    );
  }
  window.Pin = Pin;

  /* ---------------- SELECTION FRAME — viewfinder brackets ------------------------ */
  function SelectionFrame({ rect, label, sel, frame }) {
    if (!rect) return null;
    const st = { transform: `translate(${rect.x}px,${rect.y}px)`, width: rect.w, height: rect.h };
    return (
      <div className="selframe" data-frame={frame || "brackets"} style={st} aria-hidden="true">
        <div className="veil" />
        <div className="edge" />
        <span className="br tl" /><span className="br tr" /><span className="br bl" /><span className="br br2" />
        <span className="dim mono">{Math.round(rect.w)}×{Math.round(rect.h)}</span>
        <span className="sel-label">
          <span className="tag">{label.tag}</span>
          <span className="sel">{label.name}</span>
        </span>
      </div>
    );
  }
  window.SelectionFrame = SelectionFrame;

  /* ---------------- INTENT INPUT ------------------------------------------------- */
  function IntentInput({ anchor, target, kindStyle, onSave, onCancel }) {
    const [comment, setComment] = useState("");
    const [kind, setKind] = useState("other");
    const [hint, setHint] = useState(false);
    const [armCancel, setArmCancel] = useState(false);
    const [collapsing, setCollapsing] = useState(false);
    const taRef = useRef(null);

    useEffect(() => { const t = setTimeout(() => taRef.current && taRef.current.focus(), 30); return () => clearTimeout(t); }, []);
    const grow = (el) => { if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 88) + "px"; };
    useLayoutEffect(() => grow(taRef.current));

    const empty = !comment.trim();
    const fire = () => {
      if (empty) { setHint(true); taRef.current && taRef.current.focus(); return; }
      setCollapsing(true);
      setTimeout(() => onSave({ comment: comment.trim(), kind }), 320);
    };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); fire(); }
      else if (e.key === "Escape") {
        e.preventDefault();
        if (!comment.trim()) onCancel();
        else if (!armCancel) { setArmCancel(true); setTimeout(() => setArmCancel(false), 2600); }
        else onCancel();
      }
    };

    const railSeg = kindStyle === "segmented";
    return (
      <div className={"intent" + (hint ? " show-hint" : "") + (collapsing ? " collapsing" : "")}
        data-kind={kind} style={anchor} onKeyDown={onKey}>
        <div className="intent-shell">
          <div className="intent-targ"><span className="pip" />{target.tag} <span className="sel">{target.name}</span></div>
          <div className="intent-row">
            <textarea ref={taRef} className="intent-field" rows="1" placeholder={LT("intent.ph")}
              value={comment} onChange={(e) => { setComment(e.target.value); if (e.target.value.trim()) setHint(false); grow(e.target); }} />
            <button className="intent-submit" disabled={empty} title={LT("intent.save")} aria-label={LT("intent.savea")} onClick={fire}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></svg>
            </button>
          </div>
          <div className={railSeg ? "kindseg" : "kindrail"} role="listbox" aria-label="Kind">
            {!railSeg ? <span className="lab">{LT("intent.kind")}</span> : null}
            {KINDS.map((k) => (
              <button key={k} className={"kind" + (kind === k ? " sel" : "")} data-kind={k} role="option"
                aria-selected={kind === k} style={{ "--kc": `var(--k-${k})` }} title={LT("kind." + k)}
                onClick={() => setKind(k)}>
                <span className="kd" /><span className="kn">{LT("kind." + k)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="intent-hint">{armCancel ? LT("intent.discard") : LT("intent.hint")}</div>
        <div className="intent-foot"><span className="hintkey mono">⌘↵</span></div>
      </div>
    );
  }
  window.IntentInput = IntentInput;

  /* ---------------- PIN DETAIL --------------------------------------------------- */
  function PinDetail({ p, anchor, style, onDone, onDelete, onClose, onViewAll }) {
    const [doneState, setDoneState] = useState(p.task === "done");
    const [copyState, setCopyState] = useState(0); // 0 idle 1 ok
    const [armed, setArmed] = useState(false);
    const armTimer = useRef(null);
    const m = metaTokens({ ...p, task: doneState ? "done" : p.task });

    const doDone = () => { setDoneState(true); setTimeout(() => onDone(p.id), 620); };
    const doCopy = () => { setCopyState(1); setTimeout(() => setCopyState(0), 1200); };
    const doDelete = () => {
      if (armed) { clearTimeout(armTimer.current); setArmed("ok"); setTimeout(() => onDelete(p.id), 480); }
      else { setArmed(true); armTimer.current = setTimeout(() => setArmed(false), 2600); }
    };
    return (
      <div className={"detail card" + (doneState ? " is-done" : "")} data-kind={p.kind} data-style={style}
        style={anchor} role="dialog" aria-label={"Mark " + p.num}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <div className="d-target"><span className="ix">#{p.num}</span>{p.targetTag} {p.targetSel}</div>
        <div className="d-comment">{p.comment}</div>
        <div className="d-meta">
          <Tok {...(doneState ? { cls: "good", glyph: "✓", label: LT("task.done") } : m.task)} />
          <Tok {...m.loc} /><Tok {...m.sync} />
          <Tok cls="kind" kind={p.kind} label={LT("kind." + p.kind)} />
        </div>
        <div className="d-actions">
          {doneState
            ? <button className="btn ghost" disabled><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>{LT("detail.doneOk")}</button>
            : <button className="btn primary" onClick={doDone}>{LT("detail.done")}</button>}
          <button className="btn ghost" onClick={doCopy}>{copyState ? LT("detail.copyOk") : LT("detail.copy")}</button>
          <span className="spacer" />
          <button className="btn danger" data-armed={armed === true ? "1" : undefined} onClick={doDelete}>
            {armed === "ok" ? LT("detail.delOk") : armed ? LT("detail.delArm") : LT("detail.del")}
          </button>
        </div>
      </div>
    );
  }
  window.PinDetail = PinDetail;

  /* ---------------- VIEW ALL ----------------------------------------------------- */
  function ViewAll({ pins, style, route, onClose, onJump, currentId }) {
    const [showDone, setShowDone] = useState(false);
    const list = pins.filter((p) => showDone || p.task !== "done");
    const openCount = pins.filter((p) => p.task !== "done").length;
    const anyFallback = pins.some((p) => p.sync === "failed" || p.sync === "local");
    return (
      <aside className="viewall" data-style={style} role="dialog" aria-label="View all marks"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <div className="va-head">
          <span className="va-proj">{LT("va.title")}</span>
          <span className="va-route mono">{route}</span>
          <button className="va-x" aria-label={LT("va.close")} onClick={onClose}>✕</button>
        </div>
        <div className="va-sub">
          <span className="va-count">{openCount} {LT("va.open")}</span>
          <button className={"va-toggle" + (showDone ? " on" : "")} onClick={() => setShowDone(!showDone)} aria-pressed={showDone}>
            <span className="va-switch" />{LT("va.showdone")}
          </button>
        </div>
        {list.length ? (
          <ul className="va-list">
            {list.map((p) => {
              const m = metaTokens(p);
              return (
                <li key={p.id} className={"va-item" + (p.task === "done" ? " done" : "") + (p.id === currentId ? " cur" : "")}
                  data-kind={p.kind} onClick={() => onJump(p)}>
                  <div className="va-l1"><span className="va-n">#{p.num}</span><span className="va-c">{p.comment}</span></div>
                  <div className="va-l2">
                    <span>{p.targetTag} {p.targetSel}</span>
                    <Tok cls="kind" kind={p.kind} label={LT("kind." + p.kind)} />
                    <Tok {...m.loc} /><Tok {...m.sync} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="va-empty">
            <div className="et">{LT("va.empty.t")}</div>
            <div className="es">{LT("va.empty.s")}</div>
          </div>
        )}
        <div className="va-foot">
          <button className={"btn " + (anyFallback ? "primary" : "ghost")}>{LT("va.copyall")}</button>
          <span className="tok tok--neutral"><span className="g">•</span>{pins.length}</span>
        </div>
      </aside>
    );
  }
  window.ViewAll = ViewAll;

  /* ---------------- HOST AUTH / PROJECT CHOOSER / FALLBACK ----------------------- */
  function LoupeMark({ size }) {
    return (
      <svg className="loupe-mark" width={size || 30} height={size || 30} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="17" cy="17" r="13" stroke="var(--ink)" strokeWidth="2.4" />
        <circle cx="17" cy="17" r="6" stroke="var(--iris)" strokeWidth="2.4" />
        <path d="M17 1.5v4M17 28.5v4M1.5 17h4M28.5 17h4" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        <path d="m26.5 26.5 9 9" stroke="var(--ink)" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
    );
  }
  window.LoupeMark = LoupeMark;

  function HostAuth({ onAllow, onDismiss }) {
    return (
      <div className="center-wrap">
        <div className="cta card anim-pop">
          <div className="cta-brand"><LoupeMark size={28} /><span className="wm">Loupe</span></div>
          <h3>{LT("auth.title")}</h3>
          <p>{LT("auth.body")}</p>
          <div className="cta-row">
            <button className="btn primary" onClick={onAllow}>{LT("auth.allow")}</button>
            <button className="btn ghost" onClick={onDismiss}>{LT("auth.not")}</button>
          </div>
        </div>
      </div>
    );
  }
  window.HostAuth = HostAuth;

  function ProjectChooser({ onPick }) {
    const [sel, setSel] = useState("app-web");
    const projs = [
      { id: "app-web", name: "app-web", path: "~/dev/app-web" },
      { id: "marketing", name: "marketing-site", path: "~/dev/marketing" },
    ];
    return (
      <div className="center-wrap">
        <div className="chooser card anim-pop">
          <h3>{LT("proj.title")}</h3>
          <p className="sub">{LT("proj.sub")}</p>
          <ul className="proj-list">
            {projs.map((pr) => (
              <li key={pr.id} className={"proj" + (sel === pr.id ? " sel" : "")} data-kind="layout" onClick={() => setSel(pr.id)}>
                <span className="pdot" />
                <span className="pmeta"><div className="pname">{pr.name}</div><div className="ppath">{pr.path}</div></span>
              </li>
            ))}
          </ul>
          <div className="chooser-foot">
            <button className="btn ghost" onClick={() => onPick("local")}>{LT("proj.local")}</button>
            <button className="btn primary" onClick={() => onPick(sel)}>{LT("proj.confirm")}</button>
          </div>
        </div>
      </div>
    );
  }
  window.ProjectChooser = ProjectChooser;

  function PageFallback() {
    const [copied, setCopied] = useState(false);
    return (
      <div className="fallback card">
        <h4><span className="tok tok--neutral"><span className="g">•</span></span>{LT("fb.title")}</h4>
        <p>{LT("fb.body")}</p>
        <div className="fb-row">
          <button className="btn primary" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? LT("detail.copyOk") : LT("fb.copy")}
          </button>
          <span className="tok tok--neutral"><span className="g">•</span>{LT("sync.local")}</span>
        </div>
      </div>
    );
  }
  window.PageFallback = PageFallback;

  /* ---------------- MOCK DEV APP (the surface being inspected) ------------------- */
  // each pickable host carries data-pick (id) / data-tag / data-name / data-sel / data-bc
  function pk(id, tag, name, sel, bc) { return { "data-pick": id, "data-tag": tag, "data-name": name, "data-sel": sel, "data-bc": bc }; }
  function MockApp() {
    return (
      <div className="app">
        <div className="app-top">
          <div className="app-brand" {...pk("brand", "div", "Acme", "header.brand", "header > brand")}>
            <span className="glyph" /> Acme
          </div>
          <nav className="app-nav">
            <a {...pk("nav-over", "a", "“Overview”", "nav a", "header > nav > a")}>Overview</a>
            <a className="on" {...pk("nav-set", "a", "“Settings”", "nav a.on", "header > nav > a")}>Settings</a>
            <a {...pk("nav-bill", "a", "“Billing”", "nav a", "header > nav > a")}>Billing</a>
          </nav>
          <span className="spacer" />
          <div className="app-avatar" {...pk("avatar", "button", "avatar", "button.avatar", "header > button")} />
        </div>
        <div className="app-body">
          <aside className="app-side">
            <div className="side-group">
              <div className="side-label">Workspace</div>
              <div className="side-item on" {...pk("s-general", "button", "“General”", "aside .item.on", "aside > nav > button")}><span className="d" />General</div>
              <div className="side-item" {...pk("s-members", "button", "“Members”", "aside .item", "aside > nav > button")}><span className="d" />Members</div>
              <div className="side-item" {...pk("s-api", "button", "“API keys”", "aside .item", "aside > nav > button")}><span className="d" />API keys</div>
            </div>
            <div className="side-group">
              <div className="side-label">Account</div>
              <div className="side-item" {...pk("s-profile", "button", "“Profile”", "aside .item", "aside > nav > button")}><span className="d" />Profile</div>
              <div className="side-item" {...pk("s-notif", "button", "“Notifications”", "aside .item", "aside > nav > button")}><span className="d" />Notifications</div>
            </div>
          </aside>
          <main className="app-main">
            <h1 className="page-h" {...pk("title", "h1", "“Account settings”", "main h1", "main > h1")}>{LT("app.title")}</h1>
            <p className="page-sub" {...pk("sub", "p", "“Manage your…”", "main p.sub", "main > p")}>{LT("app.sub")}</p>

            <div className="app-banner" {...pk("banner", "div", "upgrade banner", "div.banner", "main > div.banner")}>
              <p><b>Free plan.</b> Upgrade to unlock unlimited members and API access.</p>
              <button className="app-btn" {...pk("upgrade", "button", "“Upgrade”", "button.upgrade", "div.banner > button")}>Upgrade</button>
            </div>

            <section className="panel" {...pk("panel", "section", "Profile panel", "section.panel", "main > section")}>
              <div className="panel-h" {...pk("ph", "h2", "“Profile”", "section h2", "section > h2")}>Profile</div>
              <p className="panel-d">This information will be visible to your team members.</p>
              <div className="field">
                <label>Full name</label>
                <div className="faux-input" {...pk("f-name", "input", "“Full name”", "input#name", "form > div > input")}>Ada Lovelace</div>
              </div>
              <div className="field">
                <label>Email</label>
                <div className="faux-input" {...pk("f-email", "input", "“Email”", "input#email", "form > div > input")}>ada@acme.com</div>
              </div>
              <div className="row-actions">
                <button className="app-btn primary" {...pk("save", "button", "“Save changes”", "button.primary", "form > div > button")}>Save changes</button>
                <button className="app-btn" {...pk("cancel", "button", "“Cancel”", "button.ghost", "form > div > button")}>Cancel</button>
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }
  window.MockApp = MockApp;
})();
