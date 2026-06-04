# Handoff: Loupe — in-page surfaces ("Optical Instrument")

## Overview
Loupe lets a developer **pin a real DOM element** on a local dev page and write an
intent, turning "this element, right here" into a structured task an AI coding agent
reads over MCP. This handoff covers the **8 in-page surfaces** that render inside the
browser extension's Shadow DOM: the picker, intent input, pins, and their supporting
chrome. The visual system is an original brand direction called **"Optical Instrument"**:
monochrome graphite-on-paper, one accent ("Iris" — the aperture of a lens) that appears
only where the tool is *live/looking*, and camera-viewfinder / reticle motifs.

Driven by `docs/ui-ux/loupe-in-page-surfaces-interaction-spec.md` (§13 locked
interactions, §17 whole-direction visual language). The interaction skeleton is locked;
this bundle locks the **visual language + tokens** on top of it.

## About the design files
The files in this bundle are **design references created in HTML/CSS + React (Babel,
in-browser)** — a working prototype showing intended look, motion, and behaviour. They
are **not production code to ship as-is**. The task is to **recreate these surfaces in
`packages/extension`** as real TypeScript inside the existing MV3 Shadow-DOM content
script, using the repo's conventions. Treat the HTML/JSX as the spec of record for
pixel values, copy, motion, and state; re-implement, don't paste.

`loupe-tokens.css` is the exception: it is **clean, canonical token CSS meant to be
lifted directly** into the extension's Shadow root.

## Fidelity
**High-fidelity.** Final colours, type, spacing, radii, shadows, motion curves, and
interaction states are all specified. Recreate pixel-faithfully using the extension's
patterns. The only deliberately-mocked part is the **gray "Acme settings" page** behind
the surfaces — that is a stand-in for an arbitrary host page (the page the user is
inspecting), NOT part of Loupe. Do not build it.

---

## Design tokens
Use `loupe-tokens.css` verbatim. Summary of the locked values:

**Type** — UI: `Space Grotesk` (Latin) + `PingFang SC`/`Noto Sans SC` (CJK). Mono
(readouts, selectors, status): `JetBrains Mono`. Letter-spacing on UI text `-.006em`.

**Iris accent** (oklch; hue is the one brand knob, **locked at 286**):
| token | light | dark |
|---|---|---|
| `--iris` | `oklch(.50 .135 286)` ≈ `#5a4fc6` | `oklch(.70 .135 286)` ≈ `#9b8ef0` |
| `--iris-hi` (hover) | `oklch(.57 .135 286)` | `oklch(.77 .135 286)` |
| `--iris-press` | `oklch(.44 .135 286)` | `oklch(.63 .135 286)` |
| `--ring` (focus) | `0 0 0 3px oklch(.50 .135 286 / .26)` | `…/.30` |

**Neutrals — light "Daylight":** paper `#eceae4`, surface `#fbfaf7`, surface-2 `#f4f2ec`,
ink `#1c1b18`, ink-2 `#55524b`, ink-3 `#8d897e`, hairline `rgba(28,27,24,.12/.20/.30)`,
field `#fff` / field-line `rgba(28,27,24,.22)`.
**Neutrals — dark "Instrument":** paper `#131316`, surface `#1d1d21`, surface-2 `#232328`,
ink `#eceae4`, ink-2 `#a8a59d`, ink-3 `#74726c`, hairline `rgba(255,255,255,.10/.17/.28)`.

**Status tones** (always paired with a glyph + text, never colour-only):
good `#3f7d52`, warn `#9a6a1a`, bad `#a64238`, open `#55524b`, neutral `#6a675f`
(dark: `#6cc28a / #d3a24e / #e07f72 / #a8a59d / #9a978f`).
Glyphs: located/synced/done `✓` · drifted `△` · lost/failed `✕` · open `○` · neutral `•` · syncing `◌`.

**Kind ramp** (accent only, never status) — muted ink-tints, oklch:
bug `.56 .14 27`, copy `.58 .10 70`, style `.56 .13 350`, layout `.55 .11 245`,
question `.56 .09 195`, other `.58 .015 286` (dark variants in tokens file).

**Radius (locked "default"):** `--r-lg 14px` (cards/panels) · `--r-md 10px` (buttons/fields)
· `--r-sm 7px` (chips) · `--r-pin 50%`. **Hairline:** `1px`.

**Shadows (no blur anywhere):** `--shadow-xs`, `--shadow`, `--shadow-pop` — see tokens file.

**Motion (locked "precise"):** `--ease cubic-bezier(.22,.78,.18,1)` (primary),
`--ease-out cubic-bezier(.16,1,.3,1)` (entrances/settle), `--dur .19s`, `--dur-fast .12s`
(hover/press), `--dur-slow .34s` (entrances + frame morph). `prefers-reduced-motion`
collapses all durations to `.001s` (continuity preserved, velocity removed).

---

## Surfaces / views
Display vocabulary mapping (schema → UI label) is locked in the interaction spec §2;
the UI uses the friendly labels (`resolved`→`done`/`located`, etc.). UI strings are
bilingual: **中文 primary, EN toggle, technical terms stay English** (DOM, Agent,
Markdown, Pin, Project, kind, route, ⌘↵, CSS selectors).

### 1 · Host authorization CTA
- **Purpose:** unauthorized host → minimal permission card before any picker injects.
- **Layout:** centered card 316px, padding 22px, `--shadow-pop`. Brand row = reticle
  mark (SVG, 28px) + "Loupe" wordmark. Title 16px/600. Body 13px ink-2. Row: primary
  "允许本站点 / Allow site" + ghost "以后再说 / Not now".
- **Behaviour:** Allow → `chrome.permissions.request` → Project step. Not a failure
  state; stays low-noise if dismissed. Backdrop dims host (`paper @55%`, 2px blur veil).

### 2 · Project chooser
- **Purpose:** project = mark's trust boundary; if origin maps to >1 project, choose first.
- **Layout:** card 330px. Title + sub. Radio list of projects (`pname` 13/600 + `ppath`
  mono 10.5 ink-3); selected = iris-veil bg + iris radio dot + hairline-iris border.
  Foot: ghost "仅本地继续 / Continue locally" + primary "进入选取 / Start picking".
- **Behaviour:** single project auto-uses (no prompt). Local fallback marks state
  `project not linked` / `local only`. Don't re-ask per mark once chosen.

### 3 · Picker / Selection frame  ← signature surface
- **Mode indicator:** fixed bottom-center pill: pulsing iris dot + "正在选取元素 / Picking
  element" + `Esc` kbd + "Project: app-web". Appears only while picking. No constant toolbar.
- **Selection frame:** ONE frame that **morphs** between target rects (transition
  transform/width/height over `--dur` w/ `--ease`). Composed of: faint iris veil fill,
  hairline iris edge, **four 13px corner brackets (2px iris)**, a mono **dimension readout**
  (`668×308`) at top-right, and a **semantic label tab** below-left (iris bg, `--iris-fg`):
  `button "Save"` / `input "Email"` / `nav`, selector fallback `div.px-4`.
- **Breadcrumb:** small pill above the target on keyboard parent/child move or dwell —
  semantic-first, selector fallback, ≤3–4 segments, e.g. `main › section "Profile panel"`.
- **Cursor:** contextual crosshair on pickable hosts; no full-screen crosshair.

### 4 · Intent input
- **Layout:** floating shell 380px anchored to target (below > above > bottom-dock
  fallback). `--shadow-pop`, hairline-2 border; `:focus-within` adds iris border + `--ring`.
  Rows: (a) tiny mono target label w/ iris pip; (b) auto-growing `textarea` (1→~4 lines,
  max 88px then scroll, placeholder "告诉 agent 你想改什么…") + **circular submit** (33px,
  `--r-pin`, kind-tinted; up-arrow icon; disabled+greyed when comment empty); (c) **kind
  rail**.
- **Kind rail (locked):** mono "类别/KIND" label + six dots (one per kind). Hover/selected
  dot **expands to reveal its label** (max-width + opacity transition); selected dot gets a
  kind-tinted halo + tinted bg. Default `other`. Keyboard: `role=listbox`/`option`,
  arrow + Enter selectable.
- **Validation/keys:** empty comment → submit disabled; ⌘/Ctrl+Enter on empty → inline
  hint "先写一句任务" (subtle shake). ⌘/Ctrl+Enter saves (plain Enter does NOT, for IME).
  Esc: empty → cancel; has content → 1st Esc inline "再按一次 Esc 丢弃", 2nd discards.
- **Save success:** shell plays `collapse-to-pin` (scale→target corner, fade) over
  `--dur-slow`; a Pin appears in `open`; picker exits; low-noise "+ 再标一个 / Add another"
  affordance shows near the new pin. **No toast.**

### 5 · Pin — optical reticle marker
- **Default:** 24px, `transform:translate(-50%,-50%)` onto the target's least-occluding
  outer corner (clamped on-screen; pins on the same host stack +16px down). `pin-in`
  entrance (scale 0.4→1.12→1). Composition: surface-filled hairline ring + centered mono
  **number** + **kind-accent arc** (SVG `circle` stroke-dasharray `16 60`, rotate −58°).
  Open+located pins emit a slow iris focus pulse (`pin-ping`, 2.6s).
- **States (never colour-only):** done → ring dims to surface-2, `✓` badge (good);
  drifted → dashed warn ring + `△` badge; lost → transparent dashed strong-hairline ring,
  `✕` badge; stack → `+N` count chip bottom-right.
- **Tooltip (non-interactive):** pill above pin, compact status row:
  `open · located 100% · synced` etc. Click / Enter / Space → Pin detail.
- **Alt shapes explored (NOT locked):** `dot` (filled kind disc) and `tag` (kind dot +
  number pill). Kept behind the prototype's Tweaks; reticle is the locked default.

### 6 · Pin detail
- **Layout:** popover card 346px anchored near pin, `--shadow-pop`. Hierarchy = task-first:
  (1) tiny mono target label `#3 button "Save" · div.relative.flex` (ink-3);
  (2) **comment** 14px/1.55 ink; (3) meta token row `open · located 100% · synced · style`
  (border-top divider); (4) actions.
- **Actions:** primary **"标记完成 / Mark done"** (no confirm → button morphs in place to
  ✓ "Done", pin transitions to done, detail closes after a beat; calls `resolve_mark`).
  Ghost **"复制 Markdown"** (in-place → "已复制 / Copied"; failure → "Copy failed", retry).
  Danger **"删除 / Delete"** = two-step in place ("删除? / Delete?" → confirm → "已删除",
  pin removed); Esc/timeout disarms. **No dialogs, no toasts, no undo toast.**

### 7 · View all
- **Layout (locked "panel"):** right-docked, full height, 340px, `slide-in` entrance,
  border-left hairline, `--shadow-pop`.
  - Header: iris-dot project `app-web` + mono route `/settings` + close `✕`.
  - Sub row: mono `2 open` count + **"显示已完成 / Show done" toggle** (custom 30×17 switch,
    iris when on — NB: reset native `<button>` chrome). Default filter = current route/session
    **open** marks; done hidden behind toggle.
  - List items: `#n` mono + **comment (clamped to one line, ellipsis)**; 2nd mono line =
    `target · kind · located/drifted/lost · sync`. Left kind rail accent on hover.
    Hover bg surface-2; current = iris-veil. Click → jump + open detail.
  - Empty state: "本页还没有 mark / No marks on this page" + "选取一个元素来创建" + Start picking.
  - Foot: **"复制全部 Markdown"** — ghost normally, **promoted to primary** when any mark is
    `local only` / `sync failed`.
- **Alt style explored (NOT locked):** `float` (detached rounded card top-right).

### 8 · Page-level status / fallback
- **Purpose:** express local-first / sync / MCP availability **without blocking saves**.
- **Daemon offline / no MCP:** soft card bottom-center: "已保存到本地。Agent 同步不可用。" +
  "复制 Markdown 把这个 mark 交给 agent" + primary Copy + `local only` token. Never phrased
  as a hard error.
- **Sync failed:** `sync failed` token in mark/detail/View all + Retry + Copy Markdown.
- **Feedback model:** **no toast system.** All feedback is in-place — button state, inline
  token, pin transition, card state.

---

## Interactions & behaviour (cross-cutting)
- **Keyboard — picking:** `Tab/Shift+Tab` next/prev candidate · `↑` parent target ·
  `↓` child target · `Enter` confirm → intent · `Esc` exit & restore prior focus.
  (`⌥L` toggles picking globally — the repo's existing shortcut.)
- **Keyboard — intent:** `⌘/Ctrl+Enter` save · `Esc` cancel (2-step if dirty) ·
  kind rail arrow-selectable.
- **Keyboard — pin/detail/view-all:** `Enter/Space` on pin opens detail · `Esc` closes
  active surface · danger actions need local 2nd confirm.
- **Motion specifics:** selection frame = geometry interpolation, must interrupt &
  retarget cleanly (don't queue behind pointermove); hover/press = `--dur-fast` translateY/
  scale micro-feedback; save = collapse-to-pin; state changes animate in place.
- **A11y:** picker fully keyboard-completable; focus management + restore on close; icon
  buttons have aria-labels; status never colour-only; kind theme never the sole meaning
  carrier; reduced-motion keeps continuity.

## State management
Per-surface React state in the prototype; in the extension map to the content script's
store. Key state:
- **flow phase:** `auth → project → ready`; `picking` boolean within ready.
- **hover target** (while picking): `{ id, rect, semanticLabel, selector, breadcrumb }` —
  resolve target separately from frame animation (perf §15: no unbounded full-tree scans on
  pointermove).
- **intent draft:** `{ targetRef, comment (required), kind (default 'other') }`.
- **marks[]:** `{ id, num, hostRef, kind, comment, task: open|resolved|archived,
  locator: { status: resolved|drifted|lost, confidence }, sync: synced|local|failed|syncing }`.
  Schema stays snake_case on the wire; UI maps to display labels.
- **pin positions:** measured from host rects on mount / resize / `document.fonts.ready`;
  same-host marks offset to stack.
- **detail open** (pin ref + anchor), **viewAll open**, **add-another anchor**.
- Actions call MCP/daemon: `resolve_mark` (Mark done), `delete_mark` (2-step Delete),
  list/get. Daemon offline ≠ creation failure → `sync.status = local_only`, Copy Markdown
  fallback always available.

## Implementation constraints (from spec §14–15)
- All surfaces render in **Shadow DOM**; don't insert UI inside the target; don't mutate
  host layout; don't depend on host CSS. Host default shouldn't swallow all interaction —
  active controls opt into pointer-events; picking allows scroll but blocks host
  click/activation (capture-phase).
- No large-area blur / heavy filters as a layer mechanism (the system uses **none** —
  honour that). Render only viewport-near pins; stack close ones. Keep selection feedback
  responsive on large pages even if evidence collection lags.

## Assets
No raster assets. All marks/icons are inline SVG built from primitives:
- **Loupe brand mark / reticle** — circles + tick lines + handle stroke (see
  `LoupeMark` and `Reticle` in `loupe-surfaces.jsx` / `loupe-app.jsx`).
- **Pin kind arc** — single SVG `<circle>` with `stroke-dasharray`.
- **Submit / check / close** — small stroked SVG paths.
Fonts load from Google Fonts in the prototype; in the extension, self-host
Space Grotesk + JetBrains Mono (CJK falls back to system PingFang/Noto).

## Files in this bundle
| File | Role |
|---|---|
| `loupe-tokens.css` | **Lift verbatim.** Canonical locked tokens (light/dark, Iris, kind, motion). |
| `Loupe System.html` | Prototype shell — loads fonts, React/Babel, mounts the app. |
| `loupe.css` | Full prototype stylesheet (token layer + every surface's component CSS). The component CSS is the visual source of truth for spacing/shape/motion. |
| `loupe-surfaces.jsx` | i18n dictionary + all presentational surfaces (Pin, SelectionFrame, IntentInput, PinDetail, ViewAll, HostAuth, ProjectChooser, PageFallback) + status tokens + mock host page. |
| `loupe-app.jsx` | Picker state machine, live hover/morph wiring, save→pin flow, theme/lang/Tweaks. The behavioural source of truth. |
| `tweaks-panel.jsx` | Prototype-only Tweaks shell (explored the now-locked open items). Not for production. |

> Reference, not a build target: open `Loupe System.html`, click Allow → Start picking,
> then `⌥L` / hover any element to feel the picker. The "Acme settings" page is a mock host.
