// Surface 8 — Page-level fallback. Shown bottom-center when daemon is offline.
// Saves still succeed (local-first); this card is informational, not an error.

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";

export type FallbackOpts = {
  t: Translate;
  onCopy: () => Promise<boolean>;
};

export function renderFallback(dom: Dom, opts: FallbackOpts): HTMLElement {
  const { t, onCopy } = opts;

  const copyBtn = dom.el("button", { class: "btn primary", text: t("fb.copy") });
  copyBtn.addEventListener("click", () => {
    void onCopy().then((ok) => {
      if (ok) {
        copyBtn.textContent = t("detail.copyOk");
        setTimeout(() => { copyBtn.textContent = t("fb.copy"); }, 1200);
      }
    });
  });

  const localTok = dom.el("span", { class: "tok tok--neutral" }, [
    dom.el("span", { class: "g", attrs: { "aria-hidden": "true" }, text: "•" }),
    dom.el("span", { text: t("sync.local") }),
  ]);

  const h4 = dom.el("h4", {}, [
    dom.el("span", { class: "tok tok--neutral" }, [
      dom.el("span", { class: "g", attrs: { "aria-hidden": "true" }, text: "•" }),
    ]),
    dom.el("span", { text: t("fb.title") }),
  ]);

  return dom.el("div", { class: "fallback card" }, [
    h4,
    dom.el("p", { text: t("fb.body") }),
    dom.el("div", { class: "fb-row" }, [copyBtn, localTok]),
  ]);
}
