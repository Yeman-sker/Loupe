// Surface 4 (minimal) — Intent input panel. Floats near the selected element
// (below preferred; flips above if viewport clips it). Auto-focuses textarea.
// ⌘/Ctrl+Enter saves; Esc cancels (no 2-step for UI-1). Kind default: "other".

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";
import { type IntentKind } from "./lib-storage.js";

export type IntentHandlers = {
  onSave: (comment: string, kind: IntentKind) => void;
  onCancel: () => void;
};

export type Viewport = { width: number; height: number; scrollY: number };

const KINDS: IntentKind[] = ["bug", "copy", "style", "layout", "question", "other"];

export function renderIntent(
  dom: Dom,
  t: Translate,
  targetRect: DOMRect,
  viewport: Viewport,
  handlers: IntentHandlers,
): HTMLElement {
  let kind: IntentKind = "other";

  const pip = dom.el("span", { class: "lp-intent-pip" });
  const targ = dom.el("div", { class: "lp-intent-targ mono" }, [pip]);

  const textarea = dom.el("textarea", {
    class: "lp-intent-field",
    attrs: {
      rows: "2",
      placeholder: t("intent.ph"),
      "aria-label": t("intent.save"),
    },
  }) as HTMLTextAreaElement;

  const submitBtn = dom.el("button", {
    class: "lp-intent-submit",
    attrs: { type: "button", "aria-label": t("intent.savea"), disabled: "" },
  });
  submitBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
    '<path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";

  function refreshSubmit(): void {
    const val = (textarea as HTMLTextAreaElement).value.trim();
    if (val.length > 0) {
      submitBtn.removeAttribute("disabled");
    } else {
      submitBtn.setAttribute("disabled", "");
    }
  }

  textarea.addEventListener("input", refreshSubmit);

  const kindDots = KINDS.map((k) => {
    const dot = dom.el("button", {
      class: "lp-kind-btn" + (k === "other" ? " lp-kind-btn--sel" : ""),
      attrs: { type: "button", "aria-label": t(`kind.${k}`) },
      data: { kind: k },
    });
    dot.addEventListener("click", () => {
      kind = k;
      kindDots.forEach((d) => d.classList.remove("lp-kind-btn--sel"));
      dot.classList.add("lp-kind-btn--sel");
    });
    return dot;
  });

  const kindLabel = dom.el("span", { class: "lp-kindrail-label mono", text: t("intent.kind") });
  const kindrail = dom.el("div", { class: "lp-kindrail" }, [kindLabel, ...kindDots]);

  function doSave(): void {
    const val = (textarea as HTMLTextAreaElement).value.trim();
    if (val.length === 0) return;
    handlers.onSave(val, kind);
  }

  submitBtn.addEventListener("click", doSave);

  textarea.addEventListener("keydown", (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
      ke.preventDefault();
      doSave();
    } else if (ke.key === "Escape") {
      ke.preventDefault();
      handlers.onCancel();
    }
  });

  const row = dom.el("div", { class: "lp-intent-row" }, [textarea, submitBtn]);
  const shell = dom.el("div", { class: "lp-intent-shell" }, [targ, row, kindrail]);
  const el = dom.el("div", { class: "lp-intent card anim-pop" }, [shell]);

  // Position: below element if room, else above, else bottom-dock
  const PANEL_HEIGHT = 210;
  const PANEL_WIDTH = 380;
  const PAD = 8;
  const absTop = targetRect.top + viewport.scrollY;
  const absLeft = targetRect.left;

  const spaceBelow = viewport.height - targetRect.bottom;
  const spaceAbove = targetRect.top;

  let top: number;
  if (spaceBelow >= PANEL_HEIGHT + PAD) {
    top = absTop + targetRect.height + PAD;
  } else if (spaceAbove >= PANEL_HEIGHT + PAD) {
    top = absTop - PANEL_HEIGHT - PAD;
  } else {
    top = viewport.scrollY + viewport.height - PANEL_HEIGHT - PAD;
  }

  const left = Math.max(PAD, Math.min(absLeft, viewport.width - PANEL_WIDTH - PAD));

  el.style.position = "absolute";
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.width = `${PANEL_WIDTH}px`;

  setTimeout(() => {
    (textarea as HTMLTextAreaElement).focus();
  }, 0);

  return el;
}
