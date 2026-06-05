// Surface 7 — View all panel. Fixed right-side panel listing all marks for the
// current route/session. Supports "Show done" toggle, jump-to-element, and
// Copy all Markdown (promoted to primary when any mark is unsynced).

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";
import { type PinRecord } from "./surface-pin.js";

export type ViewAllOpts = {
  t: Translate;
  route: string;
  currentId: string | null;
  projectName?: string;
  onClose: () => void;
  onJump: (pin: PinRecord) => void;
  onCopyAll: () => Promise<boolean>;
  onStartPicking: () => void;
};

function makeTok(dom: Dom, glyph: string, label: string, cls: string): HTMLElement {
  return dom.el("span", { class: `tok tok--${cls}` }, [
    dom.el("span", { class: "g", attrs: { "aria-hidden": "true" }, text: glyph }),
    dom.el("span", { text: label }),
  ]);
}

export function renderViewAll(dom: Dom, pins: PinRecord[], opts: ViewAllOpts): HTMLElement {
  const { t } = opts;
  let showDone = false;

  const openCount = pins.filter((p) => p.task !== "done").length;
  const anyFallback = pins.some((p) => p.sync === "failed" || p.sync === "local");

  // Header
  const projLabel = dom.el("span", { class: "va-proj", text: opts.projectName ?? t("va.title") });
  const routeLabel = dom.el("span", { class: "va-route mono", text: opts.route });
  const closeBtn = dom.el("button", {
    class: "va-x",
    attrs: { "aria-label": t("va.close") },
    text: "✕",
  });
  closeBtn.addEventListener("click", opts.onClose);
  const headEl = dom.el("div", { class: "va-head" }, [projLabel, routeLabel, closeBtn]);

  // Sub-header
  const countEl = dom.el("span", { class: "va-count", text: `${openCount} ${t("va.open")}` });
  const switchEl = dom.el("span", { class: "va-switch" });
  const toggleLabel = dom.el("span", { text: t("va.showdone") });
  const toggleBtn = dom.el("button", {
    class: "va-toggle",
    attrs: { "aria-pressed": "false" },
  }, [switchEl, toggleLabel]);
  const subEl = dom.el("div", { class: "va-sub" }, [countEl, toggleBtn]);

  // Footer
  const copyAllBtn = dom.el("button", {
    class: `btn ${anyFallback ? "primary" : "ghost"}`,
    text: t("va.copyall"),
  });
  copyAllBtn.addEventListener("click", () => {
    copyAllBtn.setAttribute("disabled", "");
    opts.onCopyAll().then((ok) => {
      copyAllBtn.textContent = ok ? t("detail.copyOk") : t("detail.copyErr");
      setTimeout(() => {
        copyAllBtn.textContent = t("va.copyall");
        copyAllBtn.removeAttribute("disabled");
      }, 1200);
    });
  });
  const totalTok = dom.el("span", { class: "tok tok--neutral" }, [
    dom.el("span", { class: "g", text: "•" }),
    dom.el("span", { text: String(pins.length) }),
  ]);
  const footEl = dom.el("div", { class: "va-foot" }, [copyAllBtn, totalTok]);

  // List container — rebuilt when toggle changes
  let listEl = buildList(dom, pins, opts, showDone, t);

  const el = dom.el("aside", {
    class: "viewall",
    attrs: { role: "dialog", "aria-label": "View all marks", tabindex: "-1" },
  }, [headEl, subEl, listEl, footEl]);

  toggleBtn.addEventListener("click", () => {
    showDone = !showDone;
    toggleBtn.classList.toggle("on", showDone);
    toggleBtn.setAttribute("aria-pressed", String(showDone));
    const next = buildList(dom, pins, opts, showDone, t);
    el.replaceChild(next, listEl);
    listEl = next;
  });

  el.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") opts.onClose();
  });

  // Focus the panel on open so keyboard users land inside it and Esc works
  // without a prior click. Runs after mount via the macrotask queue.
  setTimeout(() => { el.focus(); }, 0);

  return el;
}

function buildList(
  dom: Dom,
  pins: PinRecord[],
  opts: ViewAllOpts,
  showDone: boolean,
  t: Translate,
): HTMLElement {
  const list = pins.filter((p) => showDone || p.task !== "done");

  if (list.length === 0) {
    const emptyEl = dom.el("div", { class: "va-empty" }, [
      dom.el("div", { class: "et", text: t("va.empty.t") }),
      dom.el("div", { class: "es", text: t("va.empty.s") }),
    ]);
    const startBtn = dom.el("button", { class: "btn primary", text: t("va.start") });
    startBtn.addEventListener("click", opts.onStartPicking);
    emptyEl.appendChild(startBtn);
    return emptyEl;
  }

  const items = list.map((p) => buildItem(dom, p, opts, t));
  return dom.el("ul", { class: "va-list" }, items);
}

function buildItem(dom: Dom, p: PinRecord, opts: ViewAllOpts, t: Translate): HTMLElement {
  const locTok = p.loc === "lost"
    ? makeTok(dom, "✕", t("loc.lost"), "bad")
    : p.loc === "drifted"
      ? makeTok(dom, "△", p.confidence !== undefined ? `drifted ${p.confidence}%` : t("loc.drifted"), "warn")
      : makeTok(dom, "✓", p.confidence !== undefined ? `located ${p.confidence}%` : t("loc.located"), "good");
  const syncTok = p.sync === "failed"
    ? makeTok(dom, "✕", t("sync.failed"), "bad")
    : p.sync === "local"
      ? makeTok(dom, "•", t("sync.local"), "neutral")
      : p.sync === "syncing"
        ? makeTok(dom, "◌", t("sync.syncing"), "open")
        : makeTok(dom, "✓", t("sync.synced"), "good");
  const kindTok = dom.el("span", { class: "tok tok--kind", data: { kind: p.kind }, text: p.kind });

  const tag = (p.element as Element).tagName?.toLowerCase() ?? "?";
  const sel = selectorPreview(p.element as Element);

  const l1 = dom.el("div", { class: "va-l1" }, [
    dom.el("span", { class: "va-n mono", text: `#${p.num}` }),
    dom.el("span", { class: "va-c", text: p.comment ?? "" }),
  ]);
  const l2 = dom.el("div", { class: "va-l2" }, [
    dom.el("span", { text: `${tag} ${sel}` }),
    kindTok,
    locTok,
    syncTok,
  ]);

  const cls = [
    "va-item",
    ...(p.task === "done" ? ["done"] : []),
    ...(p.id === opts.currentId ? ["cur"] : []),
  ].join(" ");

  const item = dom.el("li", {
    class: cls,
    data: { kind: p.kind },
    attrs: { role: "button", tabindex: "0", "aria-label": `#${p.num} ${p.comment ?? ""}`.trim() },
  }, [l1, l2]);
  item.addEventListener("click", () => opts.onJump(p));
  item.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" || ke.key === " ") {
      ke.preventDefault();
      opts.onJump(p);
    }
  });
  return item;
}

function selectorPreview(element: Element): string {
  const tag = element.tagName?.toLowerCase() ?? "?";
  if (element.id?.length > 0) return `${tag}#${element.id}`;
  const cls = Array.from(element.classList ?? [])
    .filter((c) => c.length < 32)
    .slice(0, 2)
    .join(".");
  return cls.length > 0 ? `${tag}.${cls}` : tag;
}
