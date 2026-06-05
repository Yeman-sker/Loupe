// Surface 1 — Host authorization CTA. Shown in-page on an unauthorized origin
// before any picker can inject. Matches the locked prototype's primary "Allow
// site" CTA; the caller owns the MV3 permission request bridge.
// Markup/spacing ported from docs/ui-ux/prototypes/loupe-surfaces.jsx (HostAuth).

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";

export type HostAuthOpts = {
  t: Translate;
  onAllow: () => void;
  onDismiss: () => void;
};

// LoupeMark — graphite ring + iris aperture + reticle ticks + handle stroke.
// Set as innerHTML on a wrapper so the HTML parser namespaces the SVG correctly
// (createElement("svg") would produce HTML-namespaced children that don't paint).
const LOUPE_MARK_SVG =
  '<svg class="loupe-mark" width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true">' +
  '<circle cx="17" cy="17" r="13" stroke="var(--ink)" stroke-width="2.4"/>' +
  '<circle cx="17" cy="17" r="6" stroke="var(--iris)" stroke-width="2.4"/>' +
  '<path d="M17 1.5v4M17 28.5v4M1.5 17h4M28.5 17h4" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="m26.5 26.5 9 9" stroke="var(--ink)" stroke-width="3.2" stroke-linecap="round"/>' +
  "</svg>";

export function renderHostAuth(dom: Dom, opts: HostAuthOpts): HTMLElement {
  const { t, onAllow, onDismiss } = opts;

  const mark = dom.el("span", { class: "cta-mark" });
  mark.innerHTML = LOUPE_MARK_SVG;

  const brand = dom.el("div", { class: "cta-brand" }, [
    mark,
    dom.el("span", { class: "wm", text: "Loupe" }),
  ]);

  const allow = dom.el("button", {
    class: "btn primary",
    attrs: { type: "button" },
    text: t("auth.allow"),
    on: { click: onAllow },
  });

  const notNow = dom.el("button", {
    class: "btn ghost",
    attrs: { type: "button" },
    text: t("auth.not"),
    on: { click: onDismiss },
  });

  const card = dom.el("div", {
    class: "cta card anim-pop",
    attrs: { role: "dialog", "aria-modal": "true", "aria-label": t("auth.title") },
  }, [
    brand,
    dom.el("h3", { text: t("auth.title") }),
    dom.el("p", { text: t("auth.body") }),
    dom.el("div", { class: "cta-row" }, [allow, notNow]),
  ]);

  // Esc dismisses (A11y: Esc closes the active surface). Focus the card so the
  // key lands here even before the user tabs in.
  card.setAttribute("tabindex", "-1");
  card.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
  });
  setTimeout(() => { card.focus?.(); }, 0);

  return dom.el("div", { class: "center-wrap lp-auth" }, [card]);
}
