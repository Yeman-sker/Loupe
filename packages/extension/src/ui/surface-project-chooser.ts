// Surface 2 — Project chooser. Shown before picker starts when the current
// origin maps to multiple known projects. Single-project origins auto-select.

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";

export type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  workspace_root_hash?: string;
  branch?: string;
};

export type ChooserOpts = {
  t: Translate;
  onPick: (id: string | "local") => void;
};

export function renderProjectChooser(dom: Dom, projects: ProjectEntry[], opts: ChooserOpts): HTMLElement {
  const { t, onPick } = opts;
  let selectedIdx = 0;
  const selectedId = (): string | "local" => projects[selectedIdx]?.id ?? "local";

  const items: HTMLElement[] = [];

  // Single source of truth for selection: sel class + aria-checked + roving
  // tabindex (only the checked radio is a tab stop). Used by click and arrows.
  function select(idx: number): void {
    selectedIdx = idx;
    items.forEach((it, i) => {
      const on = i === idx;
      it.classList.toggle("sel", on);
      it.setAttribute("aria-checked", on ? "true" : "false");
      it.setAttribute("tabindex", on ? "0" : "-1");
    });
  }

  projects.forEach((pr, i) => {
    const dot = dom.el("span", { class: "pdot" });
    const meta = dom.el("span", { class: "pmeta" }, [
      dom.el("div", { class: "pname", text: pr.name }),
      dom.el("div", { class: "ppath", text: pr.path }),
    ]);
    const item = dom.el("li", {
      class: i === 0 ? "proj sel" : "proj",
      attrs: {
        role: "radio",
        "aria-checked": i === 0 ? "true" : "false",
        "aria-label": pr.name,
        tabindex: i === 0 ? "0" : "-1",
      },
    }, [dot, meta]);

    item.addEventListener("click", () => select(i));

    // Radiogroup keyboard: arrows move selection + focus (with wrap);
    // Enter/Space confirm the focused project (fast keyboard completion, §16.2).
    item.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "ArrowDown" || ke.key === "ArrowRight") {
        ke.preventDefault();
        const next = (i + 1) % projects.length;
        select(next);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        items[next]!.focus();
      } else if (ke.key === "ArrowUp" || ke.key === "ArrowLeft") {
        ke.preventDefault();
        const prev = (i - 1 + projects.length) % projects.length;
        select(prev);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        items[prev]!.focus();
      } else if (ke.key === "Enter" || ke.key === " ") {
        ke.preventDefault();
        onPick(selectedId());
      }
    });

    items.push(item);
  });

  const list = dom.el("ul", {
    class: "proj-list",
    attrs: { role: "radiogroup", "aria-label": t("proj.title") },
  }, items);

  const localBtn = dom.el("button", { class: "btn ghost", text: t("proj.local") });
  localBtn.addEventListener("click", () => onPick("local"));

  const confirmBtn = dom.el("button", { class: "btn primary", text: t("proj.confirm") });
  confirmBtn.addEventListener("click", () => onPick(selectedId()));

  const foot = dom.el("div", { class: "chooser-foot" }, [localBtn, confirmBtn]);

  const card = dom.el("div", {
    class: "chooser card anim-pop",
    attrs: { role: "dialog", "aria-label": t("proj.title") },
  }, [
    dom.el("h3", { text: t("proj.title") }),
    dom.el("p", { class: "sub", text: t("proj.sub") }),
    list,
    foot,
  ]);

  // Focus the selected radio on open so arrow keys work immediately. Guarded
  // for the fake DOM in unit tests; runs after mount via the macrotask queue.
  const initialFocus = items[selectedIdx];
  setTimeout(() => { initialFocus?.focus(); }, 0);

  return dom.el("div", { class: "center-wrap" }, [card]);
}
