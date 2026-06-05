// Surface 5 — Optical reticle pin. Placed at the least-occluding corner of the
// saved element (prefer top-right, clamped to viewport). Composed of: hairline
// ring + mono number + kind-accent arc + state badges + stack chip + tooltip.
// Emits iris focus pulse while open+located.

import { type Dom } from "./dom.js";
import { createI18n, type Translate } from "./i18n.js";
import { type IntentKind } from "./lib-storage.js";
import { type TokenSpec, uiLocatorToken, uiSyncToken, uiTaskToken } from "./status-tokens.js";

export type PinRecord = {
  id: string;
  num: number;
  element: Element;
  rect: DOMRect;
  kind: IntentKind;
  comment?: string;
  task?: "open" | "done" | "archived";
  loc?: "located" | "drifted" | "lost";
  confidence?: number;
  sync?: "synced" | "local" | "failed" | "syncing";
  stack?: number;
};

export type RenderPinOpts = {
  onOpen?: (pin: PinRecord) => void;
  stackOffset?: number;
  t?: Translate;
};

const KIND_COLORS: Record<IntentKind, string> = {
  bug: "var(--k-bug)",
  copy: "var(--k-copy)",
  style: "var(--k-style)",
  layout: "var(--k-layout)",
  question: "var(--k-question)",
  other: "var(--k-other)",
};

function pinCorner(
  rect: DOMRect,
  scrollY: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  const PIN = 12;
  const PAD = 4;
  const candidates = [
    { x: rect.right, y: rect.top + scrollY },
    { x: rect.left, y: rect.top + scrollY },
    { x: rect.right, y: rect.bottom + scrollY },
    { x: rect.left, y: rect.bottom + scrollY },
  ];
  for (const c of candidates) {
    const inX = c.x - PIN >= PAD && c.x + PIN <= vw - PAD;
    const inY = c.y - PIN >= PAD && c.y + PIN <= scrollY + vh - PAD;
    if (inX && inY) return c;
  }
  return { x: Math.max(PIN + PAD, rect.right), y: Math.max(PIN + PAD, rect.top + scrollY) };
}

const defaultT = createI18n("en").t;

function makeTok(dom: Dom, token: TokenSpec): HTMLElement {
  return dom.el("span", { class: `tok tok--${token.cls}` }, [
    dom.el("span", { class: "g", attrs: { "aria-hidden": "true" }, text: token.glyph }),
    dom.el("span", { text: token.label }),
  ]);
}

function taskTok(dom: Dom, t: Translate, pin: PinRecord): HTMLElement {
  return makeTok(dom, uiTaskToken(t, pin.task));
}

function locTok(dom: Dom, t: Translate, pin: PinRecord): HTMLElement {
  return makeTok(dom, uiLocatorToken(t, pin.loc, pin.confidence));
}

function syncTok(dom: Dom, t: Translate, pin: PinRecord): HTMLElement {
  return makeTok(dom, uiSyncToken(t, pin.sync));
}

export function renderPin(
  dom: Dom,
  pin: PinRecord,
  scrollY: number,
  vw: number,
  vh: number,
  opts: RenderPinOpts = {},
): HTMLElement | null {
  const t = opts.t ?? defaultT;
  const pos = pinCorner(pin.rect, scrollY, vw, vh);
  const offsetY = opts.stackOffset ?? 0;
  const y = pos.y + offsetY;

  // Viewport culling — skip pins well outside the visible area
  if (pos.x < -32 || pos.x > vw + 32 || y < scrollY - 32 || y > scrollY + vh + 32) return null;

  const task = pin.task ?? "open";
  const loc = pin.loc ?? "located";
  const isOpen = task === "open" && loc === "located";
  const isDone = task === "done";
  const isDrift = loc === "drifted";
  const isLost = loc === "lost";

  const cls = ["lp-pin"];
  if (isOpen) cls.push("lp-pin--open");
  if (isDone) cls.push("lp-pin--done");
  if (isDrift) cls.push("lp-pin--drift");
  if (isLost) cls.push("lp-pin--lost");

  const color = KIND_COLORS[pin.kind];

  // kind-accent arc SVG
  const arc = dom.el("svg", {
    class: "lp-pin-arc",
    attrs: {
      width: "26",
      height: "26",
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
      style: "position:absolute;inset:-1px;pointer-events:none",
    },
  });
  arc.innerHTML =
    `<circle cx="12" cy="12" r="11" fill="none" stroke="${color}" stroke-width="2.2" ` +
    `stroke-linecap="round" stroke-dasharray="16 60" transform="rotate(-58 12 12)"/>`;

  const ring = dom.el("div", { class: "lp-pin-ring" }, [
    dom.el("span", { class: "lp-pin-num mono", text: String(pin.num) }),
  ]);

  // State badge
  let badge: HTMLElement | null = null;
  if (isDone) badge = dom.el("span", { class: "lp-pin-badge", attrs: { "aria-hidden": "true" }, text: "✓" });
  else if (isDrift) badge = dom.el("span", { class: "lp-pin-badge", attrs: { "aria-hidden": "true" }, text: "△" });
  else if (isLost) badge = dom.el("span", { class: "lp-pin-badge", attrs: { "aria-hidden": "true" }, text: "✕" });

  // Stack chip
  const stackEl = pin.stack != null && pin.stack > 0
    ? dom.el("span", { class: "lp-pin-stackn", text: `+${pin.stack}` })
    : null;

  // Tooltip
  const tipEl = dom.el("span", { class: "lp-pin-tip" }, [
    taskTok(dom, t, pin),
    dom.el("span", { class: "lp-pin-tip-sep", text: "·" }),
    locTok(dom, t, pin),
    dom.el("span", { class: "lp-pin-tip-sep", text: "·" }),
    syncTok(dom, t, pin),
  ]);

  const children: HTMLElement[] = [
    ...(isOpen ? [dom.el("span", { class: "lp-pin-pulse" })] : []),
    ring,
    arc,
    ...(badge ? [badge] : []),
    ...(stackEl ? [stackEl] : []),
    tipEl,
  ];

  const el = dom.el("div", {
    class: cls.join(" "),
    attrs: { role: "button", tabindex: "0", "aria-label": `Pin ${pin.num}` },
    data: { kind: pin.kind },
    style: { left: `${pos.x}px`, top: `${y}px` },
  }, children);

  if (opts.onOpen !== undefined) {
    const onOpen = opts.onOpen;
    el.addEventListener("click", (e) => { (e as MouseEvent).stopPropagation?.(); onOpen(pin); });
    el.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" || ke.key === " ") { ke.preventDefault(); onOpen(pin); }
    });
  }

  return el;
}
