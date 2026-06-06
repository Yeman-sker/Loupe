import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createPinLayer, type PinLayer } from "./pin-layer.js";
import { createDom, type Dom } from "../core/dom.js";
import type { PinRecord } from "../surfaces/pin.js";

// ------------------------------------------------------------------ //
// Fake DOM — supports the node surface the pin layer touches: style,
// append/removeChild, classList, dataset, setAttribute, getBoundingClientRect,
// isConnected. Driven imperatively so tests can move elements and step rAF.
// ------------------------------------------------------------------ //

class FakeClassList {
  private readonly list: string[] = [];
  add(...cls: string[]): void { for (const c of cls) if (!this.list.includes(c)) this.list.push(c); }
  remove(...cls: string[]): void { for (const c of cls) { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); } }
  contains(c: string): boolean { return this.list.includes(c); }
}

class FakeNode {
  tagName: string;
  className = "";
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  // tracked element traits (only meaningful for host-page elements)
  private _rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  isConnected = true;
  private readonly _listeners = new Map<string, Array<(e: unknown) => void>>();

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  setAttribute(k: string, v: string): void { this.attributes.set(k, v); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  append(...nodes: Array<FakeNode | string>): void {
    for (const n of nodes) { if (typeof n === "string") continue; n.parentNode = this; this.children.push(n); }
  }
  removeChild(n: FakeNode): void {
    const i = this.children.indexOf(n);
    if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; }
  }
  addEventListener(type: string, l: (e: unknown) => void): void {
    const arr = this._listeners.get(type) ?? []; arr.push(l); this._listeners.set(type, arr);
  }
  setRect(r: Partial<{ left: number; top: number; width: number; height: number }>): void {
    const left = r.left ?? this._rect.left;
    const top = r.top ?? this._rect.top;
    const width = r.width ?? this._rect.width;
    const height = r.height ?? this._rect.height;
    this._rect = { left, top, width, height, right: left + width, bottom: top + height };
  }
  getBoundingClientRect(): DOMRect {
    const r = this._rect;
    return { ...r, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect;
  }
}

class FakeDoc {
  createElement(tag: string): FakeNode { return new FakeNode(tag); }
}

// Deterministic rAF: callbacks queue; flushFrame() runs the current batch once.
function makeWin() {
  let next = 1;
  const cbs = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame: (cb: FrameRequestCallback): number => { const h = next++; cbs.set(h, cb); return h; },
    cancelAnimationFrame: (h: number): void => { cbs.delete(h); },
    innerWidth: 1024,
    innerHeight: 768,
    flushFrame(): void {
      const batch = [...cbs.entries()];
      cbs.clear();
      for (const [, cb] of batch) cb(0);
    },
    pending(): number { return cbs.size; },
  };
}

function makePin(el: FakeNode, overrides: Partial<PinRecord> = {}): PinRecord {
  return {
    id: "pin-1",
    num: 1,
    element: el as unknown as Element,
    rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    kind: "bug",
    task: "open",
    loc: "located",
    confidence: 100,
    sync: "local",
    ...overrides,
  };
}

type Harness = {
  dom: Dom;
  win: ReturnType<typeof makeWin>;
  layer: PinLayer;
  // The lazily-mounted layer container (undefined until the first pin is synced).
  get container(): FakeNode;
  contentCalls: PinRecord[];
  lost: string[];
  // last inner node rendered per pin id (to assert node identity)
  innerById: Map<string, FakeNode>;
};

function setup(): Harness {
  const doc = new FakeDoc();
  const dom = createDom(doc as unknown as Document);
  const win = makeWin();
  const contentCalls: PinRecord[] = [];
  const innerById = new Map<string, FakeNode>();
  let container: FakeNode | null = null;
  const lost: string[] = [];
  const layer = createPinLayer({
    dom,
    win: win as unknown as Window,
    mount: (node: Node) => { container = node as unknown as FakeNode; return () => { container = null; }; },
    renderContent: (pin) => {
      contentCalls.push(pin);
      const node = dom.el("div", { class: "lp-pin" }) as unknown as FakeNode;
      innerById.set(pin.id, node);
      return node as unknown as HTMLElement;
    },
    onLost: (id) => { lost.push(id); },
  });
  return {
    dom, win, layer, contentCalls, lost, innerById,
    get container(): FakeNode { return container as unknown as FakeNode; },
  };
}

function anchorFor(h: Harness, innerId: string): FakeNode {
  const inner = h.innerById.get(innerId)!;
  return inner.parentNode!;
}

// ------------------------------------------------------------------ //

describe("UI · pin-layer", () => {
  let h: Harness;
  beforeEach(() => { h = setup(); });

  it("positions a pin anchor at the element's live viewport rect", () => {
    const el = new FakeNode("div");
    el.setRect({ left: 120, top: 80, width: 200, height: 40 });
    h.layer.sync([makePin(el)]);
    const anchor = anchorFor(h, "pin-1");
    // anchored at the element's top-right corner
    assert.equal(anchor.style["transform"], "translate(320px, 80px)");
  });

  it("re-reads the live rect each frame so the pin follows movement", () => {
    const el = new FakeNode("div");
    el.setRect({ left: 100, top: 100, width: 50, height: 20 });
    h.layer.sync([makePin(el)]);
    const anchor = anchorFor(h, "pin-1");
    assert.equal(anchor.style["transform"], "translate(150px, 100px)");

    // Element moves (scroll / drag) with no DOM event — only rAF can catch it.
    el.setRect({ left: 300, top: 60, width: 50, height: 20 });
    h.win.flushFrame();
    assert.equal(anchor.style["transform"], "translate(350px, 60px)");
  });

  it("freezes at the last position and reports loss when the element disconnects", () => {
    const el = new FakeNode("div");
    el.setRect({ left: 100, top: 100, width: 40, height: 20 });
    h.layer.sync([makePin(el)]);
    const anchor = anchorFor(h, "pin-1");
    const frozenAt = anchor.style["transform"];

    // Node removed from the document; a moved phantom rect must NOT be followed.
    el.isConnected = false;
    el.setRect({ left: 999, top: 999, width: 40, height: 20 });
    h.win.flushFrame();

    assert.equal(anchor.style["transform"], frozenAt, "should stay frozen, not chase the detached node");
    assert.deepEqual(h.lost, ["pin-1"], "should report the loss exactly once");

    // Subsequent frames must not re-fire onLost.
    h.layer.sync([makePin(el)]);
    h.win.flushFrame();
    assert.deepEqual(h.lost, ["pin-1"], "loss is reported only once");
  });

  it("keyed diff: keeps the same node across identical syncs, and adds / removes by id", () => {
    const a = new FakeNode("div"); a.setRect({ left: 10, top: 10, width: 10, height: 10 });
    const b = new FakeNode("div"); b.setRect({ left: 50, top: 50, width: 10, height: 10 });

    h.layer.sync([makePin(a, { id: "a", num: 1 })]);
    const firstNode = h.innerById.get("a");
    assert.equal(h.contentCalls.length, 1);

    // Re-syncing an unchanged pin must NOT rebuild its node (would restart anim).
    h.layer.sync([makePin(a, { id: "a", num: 1 })]);
    assert.equal(h.contentCalls.length, 1, "unchanged pin is not re-rendered");
    assert.equal(h.innerById.get("a"), firstNode, "node identity preserved");

    // Adding a new pin mounts a new anchor; the layer container now holds two.
    h.layer.sync([makePin(a, { id: "a", num: 1 }), makePin(b, { id: "b", num: 2 })]);
    assert.equal(h.container.children.length, 2, "second anchor mounted");

    // Removing a pin detaches its anchor.
    h.layer.sync([makePin(b, { id: "b", num: 2 })]);
    assert.equal(h.container.children.length, 1, "removed anchor detached");
  });

  it("re-renders inner content only when presentation state changes", () => {
    const el = new FakeNode("div"); el.setRect({ left: 10, top: 10, width: 10, height: 10 });
    h.layer.sync([makePin(el, { task: "open", loc: "located" })]);
    const anchorBefore = anchorFor(h, "pin-1");
    assert.equal(h.contentCalls.length, 1);

    // task open -> done is a real visual change: inner must be rebuilt in place.
    h.layer.sync([makePin(el, { task: "done", loc: "located" })]);
    assert.equal(h.contentCalls.length, 2, "state change re-renders inner");
    assert.equal(anchorFor(h, "pin-1"), anchorBefore, "anchor identity preserved across re-render");
    assert.equal(anchorBefore.children.length, 1, "anchor holds exactly one inner node");
  });

  it("runs the loop only while an open pin is tracked, and cancels it on unmount", () => {
    const open = new FakeNode("div"); open.setRect({ left: 10, top: 10, width: 10, height: 10 });
    h.layer.sync([makePin(open, { task: "open" })]);
    assert.ok(h.win.pending() > 0, "loop scheduled while an open pin is tracked");

    h.layer.unmount();
    assert.equal(h.win.pending(), 0, "no frame pending after unmount");
  });

  it("does not schedule the loop when no pin is open", () => {
    const el = new FakeNode("div"); el.setRect({ left: 10, top: 10, width: 10, height: 10 });
    h.layer.sync([makePin(el, { task: "done" })]);
    assert.equal(h.win.pending(), 0, "done-only pins need no animation loop");
  });

  it("culls a pin whose live rect leaves the viewport and restores it when it returns", () => {
    const el = new FakeNode("div"); el.setRect({ left: 50, top: 50, width: 10, height: 10 });
    h.layer.sync([makePin(el)]);
    const anchor = anchorFor(h, "pin-1");
    assert.notEqual(anchor.style["display"], "none", "on-screen pin is visible");

    el.setRect({ left: 5000, top: 50, width: 10, height: 10 });
    h.win.flushFrame();
    assert.equal(anchor.style["display"], "none", "off-screen pin is hidden");

    el.setRect({ left: 50, top: 50, width: 10, height: 10 });
    h.win.flushFrame();
    assert.notEqual(anchor.style["display"], "none", "pin restored when back on screen");
  });
});
