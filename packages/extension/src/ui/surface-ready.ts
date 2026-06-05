// Surface 1 (minimal) — "Ready" panel shown when extension is active on an
// authorized page. Floating bottom-right card with Loupe brand + Start picking.
// This surface is hidden (display:none) when picking is active, and replaced by
// the intent panel when an element is selected.

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";

export type ReadyHandlers = {
  onPick: () => void;
  onViewAll?: () => void;
};

export function renderReady(dom: Dom, t: Translate, handlers: ReadyHandlers, picking: boolean, markCount?: number): HTMLElement {
  const loupeMark = dom.el("svg", {
    attrs: {
      width: "20",
      height: "20",
      viewBox: "0 0 20 20",
      fill: "none",
      "aria-hidden": "true",
    },
  });
  loupeMark.innerHTML =
    '<circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>' +
    '<line x1="10" y1="3" x2="10" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    '<line x1="10" y1="15" x2="10" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    '<line x1="3" y1="10" x2="5" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    '<line x1="15" y1="10" x2="17" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    '<circle cx="10" cy="10" r="2.5" fill="var(--iris)"/>';

  const brand = dom.el("div", { class: "lp-ready-brand" }, [
    loupeMark,
    dom.el("span", { class: "lp-ready-wm", text: "Loupe" }),
  ]);

  const pickBtn = dom.el("button", {
    class: "btn primary lp-ready-pick",
    attrs: { type: "button", "aria-label": t("proj.confirm") },
    text: t("proj.confirm"),
    on: { click: handlers.onPick },
  });

  const children: HTMLElement[] = [brand, pickBtn];
  if (handlers.onViewAll !== undefined && (markCount ?? 0) > 0) {
    const viewAllBtn = dom.el("button", {
      class: "btn ghost lp-ready-viewall",
      attrs: { type: "button" },
      text: t("detail.viewall"),
      on: { click: handlers.onViewAll },
    });
    children.push(viewAllBtn);
  }

  const el = dom.el("div", { class: "card lp-ready anim-pop" }, children);
  if (picking) el.style.display = "none";
  return el;
}
