// Surface 3 (UI-2) — Picker overlay: mode indicator, morphing selection frame,
// breadcrumb, keyboard hierarchy traversal, rAF-throttled frame updates,
// open Shadow DOM penetration.

import { type Dom } from "../core/dom.js";
import { type Translate } from "../core/i18n.js";

export type HoverTarget = {
  element: Element;
  rect: DOMRect;
};

export type PickerHandlers = {
  onHover: (target: HoverTarget | null) => void;
  onConfirm: (target: HoverTarget) => void;
  onEsc: () => void;
};

export type PickerOpts = {
  projectName?: string;
};

export type Picker = {
  modeEl: HTMLElement;
  frameEl: HTMLElement;
  breadcrumbEl: HTMLElement;
  detach: () => void;
};

const SURFACE_ROOT_ID = "loupe-surface-root";

const CANDIDATE_SEL =
  'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="menuitem"]';

function isInsideLoupeRoot(el: Element): boolean {
  let node: Element | null = el;
  while (node !== null) {
    if (node.id === SURFACE_ROOT_ID) return true;
    node = node.parentElement;
  }
  return false;
}

export function semanticLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const label =
    el.getAttribute("aria-label") ??
    el.getAttribute("title") ??
    el.getAttribute("placeholder") ??
    el.getAttribute("alt") ??
    (el.textContent?.trim().slice(0, 28) ?? "");
  return label.length > 0 ? `${tag} "${label}"` : tag;
}

// Walk up DOM up to 3 ancestors (skipping body/html), return semantic labels.
function buildBreadcrumb(el: Element, doc: Document): string[] {
  const segs: string[] = [];
  let node: Element | null = el.parentElement;
  while (node !== null && segs.length < 3) {
    if (node === doc.body || node === doc.documentElement) break;
    if (!isInsideLoupeRoot(node)) segs.unshift(semanticLabel(node));
    node = node.parentElement;
  }
  return segs;
}

// Penetrate open Shadow DOM: if elementFromPoint returns a shadow host, go deeper.
function resolveAt(doc: Document, x: number, y: number): Element | null {
  const el = doc.elementFromPoint(x, y);
  if (el === null) return null;
  if (el.shadowRoot !== null) {
    const inner = (el.shadowRoot as ShadowRoot).elementFromPoint(x, y);
    if (inner !== null) return inner;
  }
  return el;
}

export function attachPicker(
  doc: Document,
  dom: Dom,
  t: Translate,
  handlers: PickerHandlers,
  opts: PickerOpts = {},
): Picker {
  const prevFocus = doc.activeElement;
  let currentHover: HoverTarget | null = null;

  // Keyboard candidate list (lazy — built on first Tab press)
  let kbdCandidates: Element[] = [];
  let currentKbdIndex = -1;

  function getCandidates(): Element[] {
    return Array.from(doc.querySelectorAll(CANDIDATE_SEL)).filter(
      (el) => !isInsideLoupeRoot(el),
    );
  }

  // --- Mode indicator pill ---
  const dot = dom.el("span", { class: "lp-mode-dot" });
  const modeChildren: HTMLElement[] = [dot, dom.el("span", { text: t("mode.pick") }), dom.el("kbd", { text: "Esc" })];
  // Low-noise current-project context (§5): "· Project: app-web"
  if (opts.projectName !== undefined && opts.projectName.length > 0) {
    modeChildren.push(dom.el("span", { class: "lp-mode-proj", text: `Project: ${opts.projectName}` }));
  }
  const modeEl = dom.el(
    "div",
    { class: "lp-mode-ind anim-pop", attrs: { role: "status", "aria-live": "polite" } },
    modeChildren,
  );

  // --- Selection frame ---
  const corners = ["tl", "tr", "bl", "br"].map((pos) =>
    dom.el("span", { class: `lp-frame-br lp-frame-br--${pos}` }),
  );
  const edgeEl = dom.el("div", { class: "lp-frame-edge" });
  const dimEl = dom.el("div", { class: "lp-frame-dim mono" });
  const lblEl = dom.el("div", { class: "lp-frame-lbl" });
  const frameEl = dom.el("div", { class: "lp-frame" }, [edgeEl, ...corners, dimEl, lblEl]);
  frameEl.style.display = "none";

  // --- Breadcrumb ---
  const bcEl = dom.el("div", { class: "lp-breadcrumb" });
  bcEl.style.display = "none";

  function updateFrame(target: HoverTarget | null): void {
    if (target === null) {
      frameEl.style.display = "none";
      return;
    }
    const { rect } = target;
    // The frame lives in the viewport-fixed surface overlay (host root is
    // position:fixed), so getBoundingClientRect's viewport coords are used as-is.
    // Adding scroll here would double-count it and push the frame off-screen.
    frameEl.style.display = "";
    frameEl.style.left = `${rect.left}px`;
    frameEl.style.top = `${rect.top}px`;
    frameEl.style.width = `${rect.width}px`;
    frameEl.style.height = `${rect.height}px`;
    dimEl.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    lblEl.textContent = semanticLabel(target.element);
  }

  // rAF throttle for mouse-driven frame updates
  let rafPending = false;
  let rafId = -1;

  function scheduleFrame(): void {
    if (rafPending) return;
    rafPending = true;
    const win = doc.defaultView ?? globalThis as Window & typeof globalThis;
    rafId = win.requestAnimationFrame(() => {
      rafPending = false;
      updateFrame(currentHover);
    });
  }

  // --- Breadcrumb show/hide ---
  function showBreadcrumb(el: Element, rect: DOMRect): void {
    const segs = buildBreadcrumb(el, doc);
    // Clear and rebuild content
    while (bcEl.firstChild !== null) bcEl.removeChild(bcEl.firstChild);
    const currentLabel = semanticLabel(el);
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) {
        const sep = doc.createElement("i");
        sep.textContent = "›";
        bcEl.appendChild(sep);
      }
      const span = doc.createElement("span");
      span.textContent = segs[i] ?? "";
      bcEl.appendChild(span);
    }
    // Final segment: bold current element label
    if (segs.length > 0) {
      const sep = doc.createElement("i");
      sep.textContent = "›";
      bcEl.appendChild(sep);
    }
    const bold = doc.createElement("b");
    bold.textContent = currentLabel;
    bcEl.appendChild(bold);

    // Viewport-fixed overlay (see updateFrame) — use viewport coords directly.
    bcEl.style.left = `${rect.left}px`;
    bcEl.style.top = `${Math.max(12, rect.top - 34)}px`;
    bcEl.style.display = "";
  }

  function hideBreadcrumb(): void {
    bcEl.style.display = "none";
  }

  // Dwell timer: show breadcrumb after 800ms of stationary hover
  let dwellTimer = -1;

  let dwellElement: Element | null = null;

  function startDwell(el: Element, rect: DOMRect): void {
    dwellElement = el;
    clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => {
      dwellElement = null;
      showBreadcrumb(el, rect);
    }, 800) as unknown as number;
  }

  function clearDwell(): void {
    clearTimeout(dwellTimer);
    dwellElement = null;
  }

  // --- Keyboard focus helper ---
  function kbdFocusElement(el: Element): void {
    const rect = el.getBoundingClientRect();
    currentHover = { element: el, rect };
    updateFrame(currentHover);
    handlers.onHover(currentHover);
    showBreadcrumb(el, rect);
  }

  // --- Event listeners ---
  function onMove(e: Event): void {
    const me = e as MouseEvent;

    const el = resolveAt(doc, me.clientX, me.clientY);
    if (el === null || isInsideLoupeRoot(el)) {
      hideBreadcrumb();
      clearDwell();
      if (currentHover !== null) {
        currentHover = null;
        scheduleFrame();
        handlers.onHover(null);
      }
      return;
    }
    const sameEl = currentHover?.element === el;
    if (!sameEl) {
      hideBreadcrumb();
      clearDwell();
      const rect = el.getBoundingClientRect();
      currentHover = { element: el, rect };
      scheduleFrame();
      handlers.onHover(currentHover);
      startDwell(el, rect);
    } else {
      // Still schedule frame in case scroll changed position. Do not clear the
      // dwell timer for same-element pointer jitter; Playwright and real mice can
      // emit extra moves at the same coordinate before the 800ms hover dwell.
      scheduleFrame();
      if (bcEl.style.display !== "none" && dwellElement === null) hideBreadcrumb();
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
      (prevFocus as HTMLElement | null)?.focus?.();
      handlers.onEsc();
    } else if (ke.key === "Enter") {
      e.stopPropagation();
      e.preventDefault();
      if (currentHover !== null) handlers.onConfirm(currentHover);
    } else if (ke.key === "Tab") {
      e.stopPropagation();
      e.preventDefault();
      if (kbdCandidates.length === 0) kbdCandidates = getCandidates();
      if (kbdCandidates.length === 0) return;
      if (ke.shiftKey) {
        // currentKbdIndex <= 0 covers both "nothing selected" (-1) and "first element" (0)
        currentKbdIndex =
          currentKbdIndex <= 0 ? kbdCandidates.length - 1 : currentKbdIndex - 1;
      } else {
        currentKbdIndex = (currentKbdIndex + 1) % kbdCandidates.length;
      }
      const el = kbdCandidates[currentKbdIndex];
      if (el !== undefined) kbdFocusElement(el);
    } else if (ke.key === "ArrowUp") {
      e.stopPropagation();
      e.preventDefault();
      if (currentHover !== null) {
        const parent = currentHover.element.parentElement;
        if (
          parent !== null &&
          parent !== doc.body &&
          parent !== doc.documentElement &&
          !isInsideLoupeRoot(parent)
        ) {
          kbdFocusElement(parent);
        }
      }
    } else if (ke.key === "ArrowDown") {
      e.stopPropagation();
      e.preventDefault();
      if (currentHover !== null) {
        const child = currentHover.element.firstElementChild;
        if (child !== null) kbdFocusElement(child);
      }
    }
  }

  doc.addEventListener("pointermove", onMove, { capture: true });
  doc.addEventListener("click", onClick, { capture: true });
  doc.addEventListener("keydown", onKey, { capture: true });

  function detach(): void {
    doc.removeEventListener("pointermove", onMove, { capture: true });
    doc.removeEventListener("click", onClick, { capture: true });
    doc.removeEventListener("keydown", onKey, { capture: true });
    clearDwell();
    if (rafPending) {
      const win = doc.defaultView ?? globalThis as Window & typeof globalThis;
      win.cancelAnimationFrame(rafId);
      rafPending = false;
    }
    if (modeEl.parentNode !== null) modeEl.parentNode.removeChild(modeEl);
    if (frameEl.parentNode !== null) frameEl.parentNode.removeChild(frameEl);
    if (bcEl.parentNode !== null) bcEl.parentNode.removeChild(bcEl);
  }

  return { modeEl, frameEl, breadcrumbEl: bcEl, detach };
}
