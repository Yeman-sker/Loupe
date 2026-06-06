// Persistent, viewport-fixed pin layer that keeps every pin glued to its live
// DOM element. Decoupled from app.ts render(): pins are keyed by id and only
// added / removed / re-rendered on real change, while a rAF loop reads each
// held element's live getBoundingClientRect() and writes the anchor transform.
// See docs/adp-20260606-pin-live-element-tracking.md.

import type { Dom } from "../core/dom.js";
import type { PinRecord } from "../surfaces/pin.js";

export type PinLayerOptions = {
  dom: Dom;
  win: Window;
  // Mounts the layer container once (host.mount); returns its detacher.
  mount: (node: Node) => () => void;
  // Builds the inner .lp-pin content node (state, badges, tooltip, handlers).
  renderContent: (pin: PinRecord) => HTMLElement | null;
  // Fired once when a pin's held element leaves the document (anchor frozen).
  onLost?: (id: string) => void;
};

export type PinLayer = {
  sync: (pins: PinRecord[]) => void;
  unmount: () => void;
};

const STACK_STEP = 16;

type Entry = {
  id: string;
  element: Element;
  anchor: HTMLElement;
  inner: HTMLElement;
  stackOffset: number;
  frozen: boolean;
  task: PinRecord["task"];
  sig: string;
};

// Presentation fingerprint — when it changes, the inner content node is stale
// and must be rebuilt. Position is excluded: it never rebuilds the node.
function contentSig(pin: PinRecord): string {
  return [pin.num, pin.kind, pin.task, pin.loc, pin.confidence, pin.sync, pin.stack ?? 0, pin.comment ?? ""].join("");
}

export function createPinLayer(opts: PinLayerOptions): PinLayer {
  const { dom, win, renderContent } = opts;

  const container = dom.el("div", { class: "lp-pin-layer" });
  // Mounted lazily: the layer is absent from the overlay while there are no
  // pins, so it never counts as a mounted surface on empty / unauthorized states.
  let detachContainer: (() => void) | null = null;
  const entries = new Map<string, Entry>();

  let rafHandle: number | null = null;

  // Visibility gating: the hot loop runs only while ≥1 open pin is on-screen.
  // An IntersectionObserver tracks viewport membership and wakes the loop when a
  // pin scrolls back in. Feature-detected — without it, pins count as visible
  // and the loop runs whenever an open pin exists (still correct, just warmer).
  const elementVisible = new Map<Element, boolean>();
  const io: IntersectionObserver | null = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((records) => {
        for (const r of records) elementVisible.set(r.target, r.isIntersecting);
        ensureLoop();
      })
    : null;

  function isVisible(el: Element): boolean {
    return elementVisible.get(el) ?? true;
  }

  // Ids that just lost their element this pass. Flushed to onLost *after* the
  // entries loop completes, so the callback (which re-enters via sync) never
  // mutates the map mid-iteration.
  const newlyLost: string[] = [];

  function flushLost(): void {
    if (newlyLost.length === 0) return;
    const ids = newlyLost.splice(0);
    for (const id of ids) opts.onLost?.(id);
  }

  // A pin needs the hot loop while it is open and still anchored to a live node.
  function isTracking(entry: Entry): boolean {
    return !entry.frozen && entry.task === "open" && isVisible(entry.element);
  }

  function frame(): void {
    rafHandle = null;
    for (const entry of entries.values()) positionEntry(entry);
    flushLost();
    ensureLoop();
  }

  function ensureLoop(): void {
    let wanted = false;
    for (const entry of entries.values()) { if (isTracking(entry)) { wanted = true; break; } }
    if (wanted && rafHandle === null) {
      rafHandle = win.requestAnimationFrame(frame);
    } else if (!wanted && rafHandle !== null) {
      win.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  function positionEntry(entry: Entry): void {
    const el = entry.element;
    if (!el.isConnected) {
      // Held node gone — freeze at last position, never follow a wrong target.
      if (!entry.frozen) {
        entry.frozen = true;
        newlyLost.push(entry.id);
      }
      return;
    }
    const rect = el.getBoundingClientRect();
    const x = rect.right;
    const y = rect.top + entry.stackOffset;
    entry.anchor.style.transform = `translate(${x}px, ${y}px)`;

    // Viewport culling — hide pins whose anchor point sits outside the visible
    // area (with a small margin) so off-screen pins cost nothing to paint.
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const M = 32;
    const offscreen = x < -M || x > vw + M || y < -M || y > vh + M;
    entry.anchor.style.display = offscreen ? "none" : "";
  }

  function sync(pins: PinRecord[]): void {
    if (pins.length > 0 && detachContainer === null) detachContainer = opts.mount(container);

    const seen = new Set<string>();
    const stackByElement = new Map<Element, number>();

    for (const pin of pins) {
      seen.add(pin.id);
      const idx = stackByElement.get(pin.element) ?? 0;
      stackByElement.set(pin.element, idx + 1);
      const stackOffset = idx * STACK_STEP;

      const sig = contentSig(pin);
      let entry = entries.get(pin.id);
      if (entry === undefined) {
        const inner = renderContent(pin);
        if (inner === null) continue;
        const anchor = dom.el("div", { class: "lp-pin-anchor" }, [inner]);
        container.append(anchor);
        entry = { id: pin.id, element: pin.element, anchor, inner, stackOffset, frozen: false, task: pin.task, sig };
        entries.set(pin.id, entry);
        io?.observe(pin.element);
      } else {
        entry.stackOffset = stackOffset;
        entry.task = pin.task;
        if (sig !== entry.sig) {
          const next = renderContent(pin);
          if (next !== null) {
            if (entry.inner.parentNode !== null) entry.inner.parentNode.removeChild(entry.inner);
            entry.anchor.append(next);
            entry.inner = next;
          }
          entry.sig = sig;
        }
      }
      positionEntry(entry);
    }

    for (const [id, entry] of entries) {
      if (seen.has(id)) continue;
      if (entry.anchor.parentNode !== null) entry.anchor.parentNode.removeChild(entry.anchor);
      entries.delete(id);
      // Stop observing only once no remaining pin shares this element.
      let stillUsed = false;
      for (const e of entries.values()) { if (e.element === entry.element) { stillUsed = true; break; } }
      if (!stillUsed) { io?.unobserve(entry.element); elementVisible.delete(entry.element); }
    }

    if (entries.size === 0 && detachContainer !== null) { detachContainer(); detachContainer = null; }

    flushLost();
    ensureLoop();
  }

  function unmount(): void {
    if (rafHandle !== null) { win.cancelAnimationFrame(rafHandle); rafHandle = null; }
    io?.disconnect();
    if (detachContainer !== null) { detachContainer(); detachContainer = null; }
    entries.clear();
  }

  return { sync, unmount };
}
