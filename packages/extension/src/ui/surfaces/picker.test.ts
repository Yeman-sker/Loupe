import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { attachPicker } from "./picker.js";
import type { HoverTarget, PickerHandlers } from "./picker.js";

/* ------------------------------------------------------------------ *
 * Minimal fake DOM for picker tests. Supports:
 *   - createElement / getElementById / querySelectorAll / elementFromPoint
 *   - addEventListener / removeEventListener (capture phase included)
 *   - parentElement / firstElementChild traversal
 *   - shadowRoot on elements
 *   - getBoundingClientRect stub
 *   - defaultView.scrollX/Y, requestAnimationFrame, cancelAnimationFrame
 * ------------------------------------------------------------------ */

type Listener = (e: unknown) => void;

class FakeEl {
  tagName: string;
  id = "";
  className = "";
  readonly attributes = new Map<string, string>();
  readonly classList = { list: [] as string[] };
  textContent: string | null = null;
  parentElement: FakeEl | null = null;
  firstElementChild: FakeEl | null = null;
  shadowRoot: { elementFromPoint: (x: number, y: number) => FakeEl | null } | null = null;
  private readonly _listeners = new Map<string, Listener[]>();
  focusCalled = false;
  rectCalls = 0;
  private _rect: DOMRect = { left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30, x: 0, y: 0, toJSON: () => ({}) };
  readonly style: Record<string, string> = {};

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get parentNode(): FakeEl | null { return this.parentElement; }

  setAttribute(k: string, v: string): void { this.attributes.set(k, v); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }

  getBoundingClientRect(): DOMRect {
    this.rectCalls++;
    return this._rect;
  }
  setRect(r: Partial<DOMRect>): void { this._rect = { ...this._rect, ...r } as DOMRect; }

  addEventListener(type: string, listener: Listener): void {
    const arr = this._listeners.get(type) ?? [];
    arr.push(listener);
    this._listeners.set(type, arr);
  }
  removeEventListener(type: string, listener: Listener): void {
    const arr = this._listeners.get(type) ?? [];
    this._listeners.set(type, arr.filter((l) => l !== listener));
  }
  dispatch(type: string, event: unknown): void {
    for (const l of this._listeners.get(type) ?? []) l(event);
  }
  focus(): void { this.focusCalled = true; }

  appendChild(child: FakeEl): void { child.parentElement = this; }
  removeChild(_child: FakeEl): void { /* no-op for tests */ }
  get firstChild(): null { return null; }
}

class FakeDoc {
  readonly body = new FakeEl("body");
  readonly documentElement = new FakeEl("html");
  private readonly _captureListeners = new Map<string, Listener[]>();
  private readonly _bubbleListeners = new Map<string, Listener[]>();
  private _fromPoint: FakeEl | null = null;
  activeElement: FakeEl | null = null;
  defaultView = {
    scrollX: 0,
    scrollY: 0,
    requestAnimationFrame: (cb: FrameRequestCallback): number => { cb(0); return 1; },
    cancelAnimationFrame: (_id: number): void => { /* no-op */ },
  };
  private _elements: FakeEl[] = [];

  createElement(tag: string): FakeEl { return new FakeEl(tag); }

  getElementById(_id: string): null { return null; }

  // querySelectorAll: returns elements matching the candidate selector by tagName
  querySelectorAll(sel: string): FakeEl[] {
    const tags = sel.split(",").map((s) => s.trim().toLowerCase());
    return this._elements.filter((el) => tags.some((t) => el.tagName.toLowerCase() === t));
  }

  setElements(els: FakeEl[]): void { this._elements = els; }

  elementFromPoint(_x: number, _y: number): FakeEl | null { return this._fromPoint; }
  setFromPoint(el: FakeEl | null): void { this._fromPoint = el; }

  addEventListener(type: string, listener: Listener, opts?: { capture?: boolean }): void {
    const map = opts?.capture ? this._captureListeners : this._bubbleListeners;
    const arr = map.get(type) ?? [];
    arr.push(listener);
    map.set(type, arr);
  }
  removeEventListener(type: string, listener: Listener, opts?: { capture?: boolean }): void {
    const map = opts?.capture ? this._captureListeners : this._bubbleListeners;
    const arr = map.get(type) ?? [];
    map.set(type, arr.filter((l) => l !== listener));
  }

  dispatchCapture(type: string, event: unknown): void {
    for (const l of this._captureListeners.get(type) ?? []) l(event);
  }
}

function makeFakeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  let stopped = false;
  let prevented = false;
  return {
    stopPropagation() { stopped = true; },
    preventDefault() { prevented = true; },
    get _stopped() { return stopped; },
    get _prevented() { return prevented; },
    ...overrides,
  };
}

function noop(): void {}

function makeHandlers(overrides: Partial<PickerHandlers> = {}): PickerHandlers & { lastHover: HoverTarget | null; confirmed: HoverTarget | null; escCalled: boolean } {
  const out = {
    lastHover: null as HoverTarget | null,
    confirmed: null as HoverTarget | null,
    escCalled: false,
    onHover(t: HoverTarget | null): void { out.lastHover = t; },
    onConfirm(t: HoverTarget): void { out.confirmed = t; },
    onEsc(): void { out.escCalled = true; },
    ...overrides,
  };
  return out;
}

// Minimal Dom factory backed by FakeDoc
function makeDom(fakeDoc: FakeDoc): import("../core/dom.js").Dom {
  const el = (tag: string, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, children: FakeEl[] = []): FakeEl => {
    const node = fakeDoc.createElement(tag);
    if (props.class !== undefined) node.className = props.class;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.attrs !== undefined) {
      for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
    }
    for (const child of children) node.appendChild(child);
    return node;
  };
  return { el: el as unknown as import("../core/dom.js").Dom["el"], clear: noop };
}

const fakeTrans = (key: string): string => key;

// ------------------------------------------------------------------ //

describe("UI-2 · surface-picker", () => {
  describe("Esc key restores previous focus", () => {
    it("calls focus() on the element that was active when picker was attached", () => {
      const doc = new FakeDoc();
      const prevEl = new FakeEl("button");
      doc.activeElement = prevEl;
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Escape" }));
      assert.ok(prevEl.focusCalled, "previous active element should have focus() called");
      assert.ok(handlers.escCalled, "onEsc handler should be called");
    });
  });

  describe("Tab key — candidate list navigation", () => {
    it("Tab moves to next interactive element", () => {
      const doc = new FakeDoc();
      const btn1 = new FakeEl("button");
      const btn2 = new FakeEl("button");
      const btn3 = new FakeEl("button");
      doc.setElements([btn1, btn2, btn3]);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      // First Tab → index 0
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Tab", shiftKey: false }));
      assert.equal(handlers.lastHover?.element, btn1, "first Tab should move to btn1");

      // Second Tab → index 1
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Tab", shiftKey: false }));
      assert.equal(handlers.lastHover?.element, btn2, "second Tab should move to btn2");
    });

    it("Shift+Tab wraps backward from first candidate to last", () => {
      const doc = new FakeDoc();
      const btn1 = new FakeEl("button");
      const btn2 = new FakeEl("button");
      const btn3 = new FakeEl("button");
      doc.setElements([btn1, btn2, btn3]);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      // Shift+Tab from initial index -1 → last element (index 2)
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Tab", shiftKey: true }));
      assert.equal(handlers.lastHover?.element, btn3, "Shift+Tab from start should wrap to last candidate");
    });
  });

  describe("Arrow key DOM traversal", () => {
    it("ArrowUp moves to parentElement", () => {
      const doc = new FakeDoc();
      const parent = new FakeEl("div");
      const child = new FakeEl("button");
      child.parentElement = parent;
      parent.firstElementChild = child;
      doc.setElements([child]);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      // First select child via Tab
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Tab", shiftKey: false }));
      assert.equal(handlers.lastHover?.element, child);

      // ArrowUp → parent
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "ArrowUp" }));
      assert.equal(handlers.lastHover?.element, parent, "ArrowUp should move to parentElement");
    });

    it("ArrowDown moves to firstElementChild", () => {
      const doc = new FakeDoc();
      const parent = new FakeEl("div");
      const child = new FakeEl("button");
      child.parentElement = parent;
      parent.firstElementChild = child;
      // Reach parent via pointermove (div is not a Tab candidate)
      doc.setFromPoint(parent);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      // Hover parent via mouse
      doc.dispatchCapture("pointermove", makeFakeEvent({ clientX: 50, clientY: 50 }));
      assert.equal(handlers.lastHover?.element, parent);

      // ArrowDown → child
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "ArrowDown" }));
      assert.equal(handlers.lastHover?.element, child, "ArrowDown should move to firstElementChild");
    });

    it("ArrowUp stops at document body", () => {
      const doc = new FakeDoc();
      const el = new FakeEl("div");
      el.parentElement = doc.body as unknown as FakeEl;
      doc.setElements([el]);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Tab", shiftKey: false }));
      const beforeUp = handlers.lastHover?.element;

      doc.dispatchCapture("keydown", makeFakeEvent({ key: "ArrowUp" }));
      // Should NOT move to body
      assert.equal(handlers.lastHover?.element, beforeUp, "ArrowUp should not move to body");
    });
  });

  describe("Breadcrumb visibility", () => {
    it("shows after keyboard navigation, hides on pointermove", () => {
      const doc = new FakeDoc();
      const el = new FakeEl("button");
      const parent = new FakeEl("nav");
      el.parentElement = parent;
      doc.setElements([el]);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      const picker = attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      // Keyboard navigation → breadcrumb visible
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Tab", shiftKey: false }));
      assert.notEqual(
        (picker.breadcrumbEl as unknown as FakeEl).style["display"],
        "none",
        "breadcrumb should be visible after keyboard nav",
      );

      // pointermove → breadcrumb hidden (also element is null so hover cleared)
      doc.setFromPoint(null);
      doc.dispatchCapture("pointermove", makeFakeEvent({ clientX: 0, clientY: 0 }));
      assert.equal(
        (picker.breadcrumbEl as unknown as FakeEl).style["display"],
        "none",
        "breadcrumb should be hidden after pointermove",
      );
    });
  });

  describe("Shadow DOM penetration", () => {
    it("resolves element inside open shadow root", () => {
      const doc = new FakeDoc();
      const shadowHost = new FakeEl("div");
      const innerEl = new FakeEl("button");
      shadowHost.shadowRoot = { elementFromPoint: (_x, _y) => innerEl };
      doc.setFromPoint(shadowHost);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      doc.dispatchCapture("pointermove", makeFakeEvent({ clientX: 50, clientY: 50 }));
      assert.equal(
        handlers.lastHover?.element,
        innerEl,
        "hover should be the element inside shadow root, not the shadow host",
      );
    });
  });

  describe("pointermove — same element optimisation", () => {
    it("does not call getBoundingClientRect again when element unchanged", () => {
      const doc = new FakeDoc();
      const el = new FakeEl("button");
      doc.setFromPoint(el);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);

      // First move — should call getBoundingClientRect once
      doc.dispatchCapture("pointermove", makeFakeEvent({ clientX: 50, clientY: 50 }));
      const firstCount = el.rectCalls;

      // Second move over same element — should NOT call getBoundingClientRect again
      doc.dispatchCapture("pointermove", makeFakeEvent({ clientX: 55, clientY: 55 }));
      assert.equal(el.rectCalls, firstCount, "getBoundingClientRect should not be called again for same element");
    });
  });

  describe("detach", () => {
    it("removes capture listeners so subsequent events are not handled", () => {
      const doc = new FakeDoc();
      const btn = new FakeEl("button");
      doc.setElements([btn]);
      const dom = makeDom(doc);
      const handlers = makeHandlers();

      const picker = attachPicker(doc as unknown as Document, dom, fakeTrans, handlers);
      picker.detach();

      // After detach, Esc should not trigger handler
      handlers.escCalled = false;
      doc.dispatchCapture("keydown", makeFakeEvent({ key: "Escape" }));
      assert.ok(!handlers.escCalled, "onEsc should not be called after detach");
    });
  });
});
