// Surface 1 (minimal) — "Ready" HUD shown when the extension is active on an
// authorized page. Floating bottom-left launcher with two pills: "选取元素"
// (Pick element, ⌥L) and "查看全部" (View all, with mark count). Hidden
// (display:none) while picking is active, and replaced by the intent panel when
// an element is selected.

import { type Dom } from "../core/dom.js";
import { type Translate } from "../core/i18n.js";

export type ReadyHandlers = {
  onPick: () => void;
  onViewAll?: () => void;
};

export function renderReady(dom: Dom, t: Translate, handlers: ReadyHandlers, picking: boolean, markCount?: number): HTMLElement {
  // SVG set via innerHTML on a wrapper so the HTML parser namespaces it correctly
  // (dom.el → createElement("svg") would be HTML-namespaced and not render).
  const reticle = dom.el("span", { class: "lp-pill-icon", attrs: { "aria-hidden": "true" } });
  reticle.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="7.5"/>' +
    '<path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke-linecap="round"/>' +
    "</svg>";

  const pickBtn = dom.el("button", {
    class: "lp-pill lp-ready-pick",
    attrs: { type: "button", "aria-label": t("hud.start") },
    on: { click: handlers.onPick },
  }, [
    reticle,
    dom.el("span", { text: t("hud.start") }),
    dom.el("kbd", { text: "⌥L" }),
  ]);

  const children: HTMLElement[] = [pickBtn];
  if (handlers.onViewAll !== undefined && (markCount ?? 0) > 0) {
    const viewAllBtn = dom.el("button", {
      class: "lp-pill lp-ready-viewall",
      attrs: { type: "button" },
      on: { click: handlers.onViewAll },
    }, [
      dom.el("span", { text: t("detail.viewall") }),
      dom.el("span", { class: "ct mono", text: String(markCount ?? 0) }),
    ]);
    children.push(viewAllBtn);
  }

  const el = dom.el("div", { class: "lp-ready anim-pop" }, children);
  if (picking) el.style.display = "none";
  return el;
}
