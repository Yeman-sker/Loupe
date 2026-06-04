/* loupe-app.jsx — picker state machine + live scene wiring + chrome/tweaks. */
(function () {
  "use strict";
  const { useState, useRef, useEffect, useLayoutEffect, useCallback } = React;
  const { Pin, SelectionFrame, IntentInput, PinDetail, ViewAll, HostAuth, ProjectChooser, PageFallback, MockApp, LT } = window;

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accentHue": 286,
    "pinShape": "reticle",
    "kindSelector": "rail",
    "detailStyle": "card",
    "viewAllStyle": "panel",
    "frameStyle": "brackets",
    "corner": "default",
    "motion": "precise"
  }/*EDITMODE-END*/;

  const VW = () => window.innerWidth, VH = () => window.innerHeight;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // anchor a floating surface (w×hEst) near a target rect; prefer below, flip above
  function anchorTo(r, w, hEst) {
    const left = clamp(r.left, 12, VW() - w - 12);
    let top = r.bottom + 10;
    if (top + hEst > VH() - 12) top = Math.max(12, r.top - hEst - 10);
    return { left, top };
  }
  // least-occluding corner for a pin (prefer outside top-right)
  function pinCorner(r) {
    let x = r.right, y = r.top;
    x = clamp(x, 16, VW() - 16); y = clamp(y, 16, VH() - 16);
    return { x, y };
  }
  const labelFor = (el) => ({ tag: el.getAttribute("data-tag") || "div", name: el.getAttribute("data-name") || "" });
  const closestPick = (el) => (el && el.closest ? el.closest("[data-pick]") : null);

  let UID = 100;

  function App() {
    const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
    const [theme, setTheme] = useState(() => { try { return localStorage.getItem("loupe-theme") || "light"; } catch (_) { return "light"; } });
    const [lang, setLang] = useState(() => { try { return localStorage.getItem("loupe-lang") || "zh"; } catch (_) { return "zh"; } });
    const [, force] = useState(0);

    // flow: auth -> project -> ready ; picking toggles within ready
    const [phase, setPhase] = useState("auth");
    const [picking, setPicking] = useState(false);
    const [hover, setHover] = useState(null);      // {rect,label,sel,bc,id}
    const [intent, setIntent] = useState(null);    // {target,anchor}
    const [detail, setDetail] = useState(null);    // {pin,anchor}
    const [viewAll, setViewAll] = useState(false);
    const [addAnchor, setAddAnchor] = useState(null);
    const [pins, setPins] = useState([]);
    const [pos, setPos] = useState({});            // id -> {x,y}
    const [tick, setTick] = useState(0);
    const sceneRef = useRef(null);

    LT.set(lang);
    useEffect(() => { try { localStorage.setItem("loupe-theme", theme); } catch (_) {} }, [theme]);
    useEffect(() => { try { localStorage.setItem("loupe-lang", lang); } catch (_) {} }, [lang]);

    // apply tweak knobs to root
    useEffect(() => {
      const root = document.getElementById("loupe-root");
      root.style.setProperty("--iris-h", t.accentHue);
      root.setAttribute("data-corner", t.corner);
      root.setAttribute("data-motion", t.motion);
    }, [t.accentHue, t.corner, t.motion]);

    /* ---- seed a few marks so View-all + states read true on load ---- */
    useEffect(() => {
      const seed = [
        { hostId: "f-email", kind: "style", comment: lang === "zh" ? "把 label 和上面的输入框左对齐" : "Left-align this label with the input above", task: "open", loc: "located", conf: 100, sync: "synced", targetTag: "input", targetSel: "input#email" },
        { hostId: "banner", kind: "copy", comment: lang === "zh" ? "升级提示文案太硬,换个更轻的说法" : "Reword the upgrade nudge — too pushy", task: "open", loc: "drifted", conf: 62, sync: "local", targetTag: "div", targetSel: "div.banner" },
        { hostId: "s-api", kind: "layout", comment: lang === "zh" ? "收紧侧栏项的行高" : "Tighten the sidebar row height", task: "done", loc: "located", conf: 100, sync: "synced", targetTag: "button", targetSel: "aside .item" },
      ];
      setPins(seed.map((s, i) => ({ id: ++UID, num: i + 1, stack: 0, ...s })));
    }, []); // eslint-disable-line

    /* ---- measure pin host positions ---- */
    const measure = useCallback(() => {
      const m = {}, byHost = {};
      pins.forEach((p) => { (byHost[p.hostId] = byHost[p.hostId] || []).push(p); });
      Object.values(byHost).forEach((group) => {
        const el = document.querySelector(`[data-pick="${group[0].hostId}"]`);
        if (!el) return;
        const c = pinCorner(el.getBoundingClientRect());
        group.forEach((p, i) => { m[p.id] = { x: c.x, y: clamp(c.y + i * 16, 16, VH() - 16) }; });
      });
      setPos(m);
    }, [pins]);
    useLayoutEffect(() => { measure(); }, [pins, tick, theme, lang, measure]);
    useEffect(() => {
      const on = () => setTick((x) => x + 1);
      window.addEventListener("resize", on);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(on);
      return () => window.removeEventListener("resize", on);
    }, []);

    /* ---- picking: hover + keyboard ---- */
    useEffect(() => {
      if (!picking) { setHover(null); return; }
      const scene = sceneRef.current;
      const onMove = (e) => {
        const el = closestPick(e.target);
        if (!el) return;
        const r = el.getBoundingClientRect();
        setHover({ id: el.getAttribute("data-pick"), rect: { x: r.left, y: r.top, w: r.width, h: r.height }, raw: r,
          label: labelFor(el), sel: el.getAttribute("data-sel"), bc: el.getAttribute("data-bc") });
      };
      const onClick = (e) => {
        const el = closestPick(e.target);
        if (!el) return;
        e.preventDefault(); e.stopPropagation();
        confirmTarget(el);
      };
      scene.addEventListener("pointermove", onMove);
      scene.addEventListener("click", onClick, true);
      return () => { scene.removeEventListener("pointermove", onMove); scene.removeEventListener("click", onClick, true); };
    }, [picking]); // eslint-disable-line

    useEffect(() => {
      const onKey = (e) => {
        if (e.altKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); togglePick(); return; }
        if (!picking) return;
        if (e.key === "Escape") { e.preventDefault(); setPicking(false); }
        else if (e.key === "Enter" && hover) { e.preventDefault(); const el = document.querySelector(`[data-pick="${hover.id}"]`); if (el) confirmTarget(el); }
        else if (e.key === "Tab") {
          e.preventDefault();
          const all = [...document.querySelectorAll("[data-pick]")];
          const i = hover ? all.findIndex((x) => x.getAttribute("data-pick") === hover.id) : -1;
          const next = all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length];
          moveHover(next);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          if (!hover) return;
          const cur = document.querySelector(`[data-pick="${hover.id}"]`);
          let nx = null;
          if (e.key === "ArrowUp") { nx = cur.parentElement ? cur.parentElement.closest("[data-pick]") : null; }
          else { nx = cur.querySelector("[data-pick]"); }
          if (nx) moveHover(nx);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [picking, hover]); // eslint-disable-line

    function moveHover(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setHover({ id: el.getAttribute("data-pick"), rect: { x: r.left, y: r.top, w: r.width, h: r.height }, raw: r,
        label: labelFor(el), sel: el.getAttribute("data-sel"), bc: el.getAttribute("data-bc") });
    }

    function togglePick() {
      if (phase !== "ready") return;
      setDetail(null); setAddAnchor(null);
      setPicking((p) => !p);
    }

    function confirmTarget(el) {
      const r = el.getBoundingClientRect();
      const label = labelFor(el);
      setPicking(false); setHover(null); setAddAnchor(null);
      setIntent({
        host: el.getAttribute("data-pick"), target: label, sel: el.getAttribute("data-sel"),
        rect: r, anchor: anchorTo(r, 380, 200),
      });
    }

    function saveMark({ comment, kind }) {
      const it = intent; if (!it) return;
      const corner = pinCorner(it.rect);
      const p = { id: ++UID, num: pins.length + 1, hostId: it.host, kind, comment,
        task: "open", loc: "located", conf: 100, sync: "synced", targetTag: it.target.tag, targetSel: it.sel, stack: 0 };
      setPins((arr) => [...arr, p]);
      setPos((m) => ({ ...m, [p.id]: corner }));
      setIntent(null);
      setAddAnchor({ left: clamp(corner.x - 60, 12, VW() - 140), top: clamp(corner.y + 16, 12, VH() - 60) });
    }

    function openDetail(p) {
      setAddAnchor(null);
      const c = pos[p.id] || { x: VW() / 2, y: VH() / 2 };
      const anchor = { left: clamp(c.x - 300, 12, VW() - 340), top: clamp(c.y + 18, 12, VH() - 240) };
      setDetail({ pin: p, anchor });
    }
    function markDone(id) { setPins((a) => a.map((p) => p.id === id ? { ...p, task: "done" } : p)); setDetail(null); }
    function deleteMark(id) { setPins((a) => a.filter((p) => p.id !== id)); setDetail(null); }
    function jumpTo(p) {
      setViewAll(false);
      const el = document.querySelector(`[data-pick="${p.hostId}"]`);
      if (el) { el.scrollIntoView ? null : null; }
      setTimeout(() => openDetail(p), 60);
    }

    const root = (
      <div className="loupe" data-theme={theme} id="loupe-root">
        {/* mock dev app */}
        <div className="scene" ref={sceneRef}>
          <div className="app-bg" aria-hidden="true" />
          <MockApp />
        </div>

        {/* loupe overlay layer */}
        <div className="loupe-layer">
          {picking && hover ? (
            <React.Fragment>
              <SelectionFrame rect={hover.rect} label={hover.label} frame={t.frameStyle} />
              {hover.bc ? <Breadcrumb bc={hover.bc} label={hover.label} rect={hover.raw} /> : null}
            </React.Fragment>
          ) : null}

          {/* pins */}
          {pins.map((p) => pos[p.id] ? (
            <Pin key={p.id} p={p} shape={t.pinShape} onOpen={openDetail}
              style={{ left: pos[p.id].x, top: pos[p.id].y }} />
          ) : null)}

          {/* intent input */}
          {intent ? (
            <IntentInput anchor={intent.anchor} target={intent.target} kindStyle={t.kindSelector}
              onSave={saveMark} onCancel={() => setIntent(null)} />
          ) : null}

          {/* add-another affordance */}
          {addAnchor ? (
            <button className="add-another" style={{ position: "absolute", ...addAnchor }} onClick={() => { setAddAnchor(null); setPicking(true); }}>
              <span className="x">+</span>{LT("intent.add")}
            </button>
          ) : null}

          {/* pin detail */}
          {detail ? (
            <PinDetail p={detail.pin} anchor={detail.anchor} style={t.detailStyle}
              onDone={markDone} onDelete={deleteMark} onClose={() => setDetail(null)} />
          ) : null}

          {/* view all */}
          {viewAll ? (
            <ViewAll pins={pins} style={t.viewAllStyle} route="/settings" currentId={detail && detail.pin.id}
              onClose={() => setViewAll(false)} onJump={jumpTo} />
          ) : null}

          {/* picking mode indicator */}
          {picking ? (
            <div className="mode-ind">
              <span className="dot" />{LT("mode.pick")} <kbd>Esc</kbd>
              <span className="sep">·</span><span className="meta">{LT("mode.proj")}</span>
            </div>
          ) : null}

          {/* page-level fallback (shown when a local-only/failed mark exists & not picking) */}
          {!picking && !intent && pins.some((p) => p.sync === "failed") ? <PageFallback /> : null}

          {/* prerequisite modals */}
          {phase === "auth" ? <HostAuth onAllow={() => setPhase("project")} onDismiss={() => setPhase("project")} /> : null}
          {phase === "project" ? <ProjectChooser onPick={() => setPhase("ready")} /> : null}
        </div>

        {/* HUD launcher (prototype convenience; not a production constant toolbar) */}
        {phase === "ready" ? (
          <div className="hud">
            {picking ? <div className="hint mono">{LT("hud.hint")}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="pill" onClick={togglePick}>
                <Reticle /> {picking ? LT("hud.exit") : LT("hud.start")} <kbd>⌥L</kbd>
              </button>
              {pins.length ? (
                <button className="pill" onClick={() => { setDetail(null); setViewAll(true); }}>
                  {LT("hud.viewall")} <span className="ct mono">{pins.filter((p) => p.task !== "done").length}</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* top-right chrome: theme + language */}
        <div className="chrome">
          <div className="seg" role="group" aria-label="Theme">
            <button aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Daylight</button>
            <button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Instrument</button>
          </div>
          <div className="seg" role="group" aria-label="Language">
            <button aria-pressed={lang === "zh"} onClick={() => { setLang("zh"); force((x) => x + 1); }}>中</button>
            <button aria-pressed={lang === "en"} onClick={() => { setLang("en"); force((x) => x + 1); }}>EN</button>
          </div>
        </div>

        {/* tweaks */}
        <window.TweaksPanel>
          <window.TweakSection label="Iris accent" />
          <window.TweakSlider label="Hue" value={t.accentHue} min={230} max={330} step={1} unit="°" onChange={(v) => setTweak("accentHue", v)} />
          <window.TweakSection label="Form" />
          <window.TweakRadio label="Pin shape" value={t.pinShape} options={["reticle", "dot", "tag"]} onChange={(v) => setTweak("pinShape", v)} />
          <window.TweakRadio label="Kind selector" value={t.kindSelector} options={["rail", "segmented"]} onChange={(v) => setTweak("kindSelector", v)} />
          <window.TweakRadio label="Selection frame" value={t.frameStyle} options={["brackets", "full"]} onChange={(v) => setTweak("frameStyle", v)} />
          <window.TweakRadio label="Pin detail" value={t.detailStyle} options={["card", "slip"]} onChange={(v) => setTweak("detailStyle", v)} />
          <window.TweakRadio label="View all" value={t.viewAllStyle} options={["panel", "float"]} onChange={(v) => setTweak("viewAllStyle", v)} />
          <window.TweakSection label="Material & motion" />
          <window.TweakRadio label="Corners" value={t.corner} options={["sharp", "default", "soft"]} onChange={(v) => setTweak("corner", v)} />
          <window.TweakRadio label="Motion" value={t.motion} options={["instant", "precise", "gentle"]} onChange={(v) => setTweak("motion", v)} />
        </window.TweaksPanel>
      </div>
    );
    return root;
  }

  /* small inline bits */
  function Reticle() {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="7.5" /><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" strokeLinecap="round" />
      </svg>
    );
  }
  function Breadcrumb({ bc, label, rect }) {
    const segs = bc.split(">").map((s) => s.trim());
    const top = Math.max(12, rect.top - 34), left = clamp(rect.left, 12, VW() - 260);
    return (
      <div className="breadcrumb" style={{ left, top }}>
        {segs.map((s, i) => (
          <React.Fragment key={i}>
            {i ? <i>›</i> : null}
            {i === segs.length - 1 ? <b>{label.tag} <span className="mono">{label.name}</span></b> : <span>{s}</span>}
          </React.Fragment>
        ))}
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById("mount")).render(<App />);
})();
