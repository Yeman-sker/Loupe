// Surface 5 (minimal) — Optical reticle pin. 24px marker placed at the
// least-occluding corner of the saved element (prefer top-right, clamped to
// viewport). Composed of: surface-filled hairline ring + mono number + kind
// accent arc SVG. Emits iris focus pulse (pin-ping) while open.

import { type Dom } from "./dom.js";
import { type IntentKind } from "./lib-storage.js";

export type PinRecord = {
  id: string;
  num: number;
  element: Element;
  rect: DOMRect;
  kind: IntentKind;
};

const KIND_COLORS: Record<IntentKind, string> = {
  bug: "var(--k-bug)",
  copy: "var(--k-copy)",
  style: "var(--k-style)",
  layout: "var(--k-layout)",
  question: "var(--k-question)",
  other: "var(--k-other)",
};

function pinCorner(rect: DOMRect, scrollY: number, viewportWidth: number, viewportHeight: number): { x: number; y: number } {
  const PIN = 12; // half of 24px
  const PAD = 4;
  const candidates = [
    { x: rect.right, y: rect.top + scrollY },      // top-right (preferred)
    { x: rect.left, y: rect.top + scrollY },        // top-left
    { x: rect.right, y: rect.bottom + scrollY },    // bottom-right
    { x: rect.left, y: rect.bottom + scrollY },     // bottom-left
  ];
  for (const c of candidates) {
    const inX = c.x - PIN >= PAD && c.x + PIN <= viewportWidth - PAD;
    const inY = c.y - PIN >= PAD && c.y + PIN <= scrollY + viewportHeight - PAD;
    if (inX && inY) return c;
  }
  return { x: Math.max(PIN + PAD, rect.right), y: Math.max(PIN + PAD, rect.top + scrollY) };
}

export function renderPin(
  dom: Dom,
  pin: PinRecord,
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number,
): HTMLElement {
  const pos = pinCorner(pin.rect, scrollY, viewportWidth, viewportHeight);
  const color = KIND_COLORS[pin.kind];

  const arc = dom.el("svg", {
    attrs: {
      width: "24",
      height: "24",
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
      style: `position:absolute;inset:0;pointer-events:none`,
    },
  });
  arc.innerHTML =
    `<circle cx="12" cy="12" r="9.5" stroke="${color}" stroke-width="2" ` +
    `stroke-dasharray="16 60" stroke-dashoffset="0" transform="rotate(-58 12 12)"/>`;

  const ring = dom.el("div", { class: "lp-pin-ring" }, [
    dom.el("span", { class: "lp-pin-num mono", text: String(pin.num) }),
  ]);

  const el = dom.el("div", {
    class: "lp-pin lp-pin--open",
    attrs: { role: "button", tabindex: "0", "aria-label": `Pin ${pin.num}` },
    data: { kind: pin.kind },
    style: {
      left: `${pos.x}px`,
      top: `${pos.y}px`,
    },
  }, [ring, arc]);

  return el;
}
