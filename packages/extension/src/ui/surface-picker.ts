// Surface 3 (minimal) — Picker overlay: mode indicator pill + morphing selection
// frame. Attaches capture-phase document listeners so:
//  - pointermove → hover highlight via elementFromPoint
//  - click (capture) → stop propagation, confirm selection
//  - keydown Escape → exit picking; Enter → confirm current hover

import { type Dom } from "./dom.js";
import { type Translate } from "./i18n.js";

export type HoverTarget = {
  element: Element;
  rect: DOMRect;
};

export type PickerHandlers = {
  onHover: (target: HoverTarget | null) => void;
  onConfirm: (target: HoverTarget) => void;
  onEsc: () => void;
};

export type Picker = {
  modeEl: HTMLElement;
  frameEl: HTMLElement;
  detach: () => void;
};

const SURFACE_ROOT_ID = "loupe-surface-root";

function isInsideLoupeRoot(el: Element): boolean {
  let node: Element | null = el;
  while (node !== null) {
    if (node.id === SURFACE_ROOT_ID) return true;
    node = node.parentElement;
  }
  return false;
}

function semanticLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const label =
    el.getAttribute("aria-label") ??
    el.getAttribute("title") ??
    el.getAttribute("placeholder") ??
    el.getAttribute("alt") ??
    (el.textContent?.trim().slice(0, 28) ?? "");
  return label.length > 0 ? `${tag} "${label}"` : tag;
}

export function attachPicker(
  doc: Document,
  dom: Dom,
  t: Translate,
  handlers: PickerHandlers,
): Picker {
  let currentHover: HoverTarget | null = null;

  // --- Mode indicator pill ---
  const dot = dom.el("span", { class: "lp-mode-dot" });
  const modeEl = dom.el("div", { class: "lp-mode-ind anim-pop", attrs: { role: "status", "aria-live": "polite" } }, [
    dot,
    dom.el("span", { text: t("mode.pick") }),
    dom.el("kbd", { text: "Esc" }),
  ]);

  // --- Selection frame ---
  const corners = ["tl", "tr", "bl", "br"].map((pos) =>
    dom.el("span", { class: `lp-frame-br lp-frame-br--${pos}` }),
  );
  const edgeEl = dom.el("div", { class: "lp-frame-edge" });
  const dimEl = dom.el("div", { class: "lp-frame-dim mono" });
  const lblEl = dom.el("div", { class: "lp-frame-lbl" });
  const frameEl = dom.el("div", { class: "lp-frame" }, [edgeEl, ...corners, dimEl, lblEl]);
  frameEl.style.display = "none";

  function updateFrame(target: HoverTarget | null): void {
    if (target === null) {
      frameEl.style.display = "none";
      return;
    }
    const { rect } = target;
    const scrollX = doc.defaultView?.scrollX ?? 0;
    const scrollY = doc.defaultView?.scrollY ?? 0;
    frameEl.style.display = "";
    frameEl.style.left = `${rect.left + scrollX}px`;
    frameEl.style.top = `${rect.top + scrollY}px`;
    frameEl.style.width = `${rect.width}px`;
    frameEl.style.height = `${rect.height}px`;
    dimEl.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    lblEl.textContent = semanticLabel(target.element);
  }

  // --- Event listeners ---
  function onMove(e: Event): void {
    const me = e as MouseEvent;
    const el = doc.elementFromPoint(me.clientX, me.clientY);
    if (el === null || isInsideLoupeRoot(el)) {
      if (currentHover !== null) {
        currentHover = null;
        updateFrame(null);
        handlers.onHover(null);
      }
      return;
    }
    const rect = el.getBoundingClientRect();
    const sameEl = currentHover?.element === el;
    currentHover = { element: el, rect };
    if (!sameEl) {
      updateFrame(currentHover);
      handlers.onHover(currentHover);
    }
  }

  function onClick(e: Event): void {
    e.stopPropagation();
    e.preventDefault();
    if (currentHover !== null) handlers.onConfirm(currentHover);
  }

  function onKey(e: Event): void {
    const ke = e as KeyboardEvent;
    if (ke.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      handlers.onEsc();
    } else if (ke.key === "Enter") {
      e.stopPropagation();
      e.preventDefault();
      if (currentHover !== null) handlers.onConfirm(currentHover);
    }
  }

  doc.addEventListener("pointermove", onMove, { capture: true });
  doc.addEventListener("click", onClick, { capture: true });
  doc.addEventListener("keydown", onKey, { capture: true });

  function detach(): void {
    doc.removeEventListener("pointermove", onMove, { capture: true });
    doc.removeEventListener("click", onClick, { capture: true });
    doc.removeEventListener("keydown", onKey, { capture: true });
    if (modeEl.parentNode !== null) modeEl.parentNode.removeChild(modeEl);
    if (frameEl.parentNode !== null) frameEl.parentNode.removeChild(frameEl);
  }

  return { modeEl, frameEl, detach };
}
