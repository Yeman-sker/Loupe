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
  let selectedId = projects[0]?.id ?? "local";

  const items: HTMLElement[] = [];
  for (const pr of projects) {
    const dot = dom.el("span", { class: "pdot" });
    const meta = dom.el("span", { class: "pmeta" }, [
      dom.el("div", { class: "pname", text: pr.name }),
      dom.el("div", { class: "ppath", text: pr.path }),
    ]);
    const item = dom.el("li", { class: pr.id === selectedId ? "proj sel" : "proj" }, [dot, meta]);
    item.addEventListener("click", () => {
      selectedId = pr.id;
      for (const it of items) it.classList.remove("sel");
      item.classList.add("sel");
    });
    items.push(item);
  }

  const list = dom.el("ul", { class: "proj-list" }, items);

  const localBtn = dom.el("button", { class: "btn ghost", text: t("proj.local") });
  localBtn.addEventListener("click", () => onPick("local"));

  const confirmBtn = dom.el("button", { class: "btn primary", text: t("proj.confirm") });
  confirmBtn.addEventListener("click", () => onPick(selectedId));

  const foot = dom.el("div", { class: "chooser-foot" }, [localBtn, confirmBtn]);

  return dom.el("div", { class: "center-wrap" }, [
    dom.el("div", { class: "chooser card anim-pop" }, [
      dom.el("h3", { text: t("proj.title") }),
      dom.el("p", { class: "sub", text: t("proj.sub") }),
      list,
      foot,
    ]),
  ]);
}
