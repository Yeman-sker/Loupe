import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderPin, type PinRecord } from "./pin.js";
import { createI18n } from "../core/i18n.js";

// ------------------------------------------------------------------ //
// Minimal fake DOM — same shape as ui-3-intent.test.ts FakeEl/FakeDoc.
// ------------------------------------------------------------------ //

type Listener = (e: unknown) => void;

class FakeClassList {
  private readonly list: string[] = [];
  add(...cls: string[]): void { for (const c of cls) if (!this.list.includes(c)) this.list.push(c); }
  remove(...cls: string[]): void { for (const c of cls) { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); } }
  contains(c: string): boolean { return this.list.includes(c); }
  toggle(c: string): boolean { if (this.list.includes(c)) { this.remove(c); return false; } else { this.add(c); return true; } }
}

class FakeStyle {
  private readonly _map = new Map<string, string>();
  setProperty(k: string, v: string): void { this._map.set(k, v); }
  getPropertyValue(k: string): string { return this._map.get(k) ?? ""; }
  [key: string]: unknown;
}

class FakeEl {
  tagName: string;
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  textContent: string | null = null;
  innerHTML = "";
  parentElement: FakeEl | null = null;
  readonly style = new FakeStyle();
  private readonly _listeners = new Map<string, Listener[]>();

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  setAttribute(k: string, v: string): void { this.attributes.set(k, v); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }

  addEventListener(type: string, listener: Listener): void {
    const arr = this._listeners.get(type) ?? [];
    arr.push(listener);
    this._listeners.set(type, arr);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const l of this._listeners.get(type) ?? []) l(event);
  }
  append(..._nodes: unknown[]): void { /* no-op */ }
}

class FakeDoc {
  createElement(tag: string): FakeEl { return new FakeEl(tag); }
  getElementById(_id: string): null { return null; }
}

function makeDom(): { dom: import("../core/dom.js").Dom; created: FakeEl[] } {
  const doc = new FakeDoc();
  const created: FakeEl[] = [];
  const el = (
    tag: string,
    props: { class?: string; text?: string; attrs?: Record<string, string>; data?: Record<string, string>; style?: Record<string, string> } = {},
    children: FakeEl[] = [],
  ): FakeEl => {
    const node = doc.createElement(tag);
    if (props.class !== undefined) node.classList.add(...props.class.split(" ").filter(Boolean));
    if (props.text !== undefined) node.textContent = props.text;
    if (props.attrs !== undefined) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
    if (props.data !== undefined) for (const [k, v] of Object.entries(props.data)) node.setAttribute(`data-${k}`, v);
    if (props.style !== undefined) for (const [k, v] of Object.entries(props.style)) {
      if (k.startsWith("--")) node.style.setProperty(k, v);
      else (node.style as unknown as Record<string, string>)[k] = v;
    }
    for (const child of children) child.parentElement = node;
    created.push(node);
    return node;
  };
  return { dom: { el: el as unknown as import("../core/dom.js").Dom["el"], clear: () => {} }, created };
}

function makeRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return { left: 100, top: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}), ...overrides };
}

function makePin(overrides: Partial<PinRecord> = {}): PinRecord {
  return {
    id: "pin-1",
    num: 1,
    element: {} as Element,
    rect: makeRect(),
    kind: "bug",
    task: "open",
    loc: "located",
    confidence: 100,
    sync: "local",
    ...overrides,
  };
}

// ------------------------------------------------------------------ //

describe("UI-4 · surface-pin", () => {
  describe("open + located state", () => {
    it("has lp-pin--open class and no badge", () => {
      const { dom, created } = makeDom();
      const el = renderPin(dom, makePin({ task: "open", loc: "located" }), 0, 1024, 768) as unknown as FakeEl;
      assert.ok(el !== null, "should render");
      assert.ok(el.classList.contains("lp-pin--open"), "should have open class");
      const badge = created.find((e) => e.classList.contains("lp-pin-badge"));
      assert.ok(badge === undefined, "should have no badge");
    });

    it("renders iris pulse element", () => {
      const { dom, created } = makeDom();
      renderPin(dom, makePin({ task: "open", loc: "located" }), 0, 1024, 768);
      const pulse = created.find((e) => e.classList.contains("lp-pin-pulse"));
      assert.ok(pulse !== undefined, "pulse element should exist for open+located");
    });
  });

  describe("done state", () => {
    it("has lp-pin--done class and ✓ badge", () => {
      const { dom, created } = makeDom();
      const el = renderPin(dom, makePin({ task: "done" }), 0, 1024, 768) as unknown as FakeEl;
      assert.ok(el !== null);
      assert.ok(el.classList.contains("lp-pin--done"), "should have done class");
      assert.ok(!el.classList.contains("lp-pin--open"), "should not have open class");
      const badge = created.find((e) => e.classList.contains("lp-pin-badge")) as unknown as FakeEl;
      assert.ok(badge !== undefined, "badge should exist");
      assert.equal(badge.textContent, "✓", "badge should be ✓");
    });

    it("does not render pulse for done pin", () => {
      const { dom, created } = makeDom();
      renderPin(dom, makePin({ task: "done" }), 0, 1024, 768);
      const pulse = created.find((e) => e.classList.contains("lp-pin-pulse"));
      assert.ok(pulse === undefined, "no pulse for done pin");
    });
  });

  describe("drifted state", () => {
    it("has lp-pin--drift class and △ badge", () => {
      const { dom, created } = makeDom();
      const el = renderPin(dom, makePin({ task: "open", loc: "drifted", confidence: 62 }), 0, 1024, 768) as unknown as FakeEl;
      assert.ok(el !== null);
      assert.ok(el.classList.contains("lp-pin--drift"), "should have drift class");
      const badge = created.find((e) => e.classList.contains("lp-pin-badge")) as unknown as FakeEl;
      assert.ok(badge !== undefined, "badge should exist");
      assert.equal(badge.textContent, "△", "badge should be △");
    });
  });

  describe("lost state", () => {
    it("has lp-pin--lost class and ✕ badge", () => {
      const { dom, created } = makeDom();
      const el = renderPin(dom, makePin({ task: "open", loc: "lost" }), 0, 1024, 768) as unknown as FakeEl;
      assert.ok(el !== null);
      assert.ok(el.classList.contains("lp-pin--lost"), "should have lost class");
      const badge = created.find((e) => e.classList.contains("lp-pin-badge")) as unknown as FakeEl;
      assert.ok(badge !== undefined, "badge should exist");
      assert.equal(badge.textContent, "✕", "badge should be ✕");
    });
  });

  describe("stack chip", () => {
    it("renders +N chip when stack > 0", () => {
      const { dom, created } = makeDom();
      renderPin(dom, makePin({ stack: 3 }), 0, 1024, 768);
      const chip = created.find((e) => e.classList.contains("lp-pin-stackn")) as unknown as FakeEl;
      assert.ok(chip !== undefined, "stack chip should exist");
      assert.equal(chip.textContent, "+3");
    });

    it("does not render chip when stack is absent", () => {
      const { dom, created } = makeDom();
      renderPin(dom, makePin(), 0, 1024, 768);
      const chip = created.find((e) => e.classList.contains("lp-pin-stackn"));
      assert.ok(chip === undefined, "no chip when stack absent");
    });
  });

  describe("tooltip text", () => {
    it("uses the active i18n labels in hover tooltip", () => {
      const { dom, created } = makeDom();
      const { t } = createI18n("zh");
      renderPin(dom, makePin({ task: "open", loc: "located", confidence: 0.9333333333333332, sync: "local" }), 0, 1024, 768, { t });
      const allText = created.map((e) => e.textContent ?? "").join(" ");

      assert.ok(allText.includes("待办"), "task token should be localized");
      assert.ok(allText.includes("已定位 93%"), "locator token should be localized and rounded");
      assert.ok(allText.includes("仅本地"), "sync token should be localized");
      assert.ok(!allText.includes("located"), "tooltip should not leak EN locator label in zh");
      assert.ok(!allText.includes("local only"), "tooltip should not leak EN sync label in zh");
    });

    it("located shows confidence %", () => {
      const { dom, created } = makeDom();
      renderPin(dom, makePin({ loc: "located", confidence: 100 }), 0, 1024, 768);
      const tip = created.find((e) => e.classList.contains("lp-pin-tip")) as unknown as FakeEl;
      assert.ok(tip !== undefined, "tooltip should exist");
      // The loc tok child should have text including "100%"
      const toks = created.filter((e) => e.classList.contains("tok") && e.classList.contains("tok--good"));
      const locTok = toks.find((e) => {
        const textNodes = created.filter((c) => c.parentElement === e);
        return textNodes.some((c) => c.textContent?.includes("100%"));
      });
      assert.ok(locTok !== undefined, "located tok should contain 100%");
    });

    it("lost does not show confidence %", () => {
      const { dom, created } = makeDom();
      renderPin(dom, makePin({ loc: "lost" }), 0, 1024, 768);
      const tip = created.find((e) => e.classList.contains("lp-pin-tip")) as unknown as FakeEl;
      assert.ok(tip !== undefined);
      const allText = created.map((e) => e.textContent ?? "").join(" ");
      assert.ok(!allText.includes("%"), "lost pin should not show confidence %");
    });
  });

  describe("event handlers", () => {
    it("click fires onOpen with the pin record", () => {
      const { dom } = makeDom();
      let called: PinRecord | null = null;
      const pin = makePin();
      const el = renderPin(dom, pin, 0, 1024, 768, { onOpen: (p) => { called = p; } }) as unknown as FakeEl;
      assert.ok(el !== null);
      el.dispatch("click", { stopPropagation: () => {} });
      assert.ok(called !== null, "onOpen should be called on click");
      assert.equal((called as PinRecord).id, pin.id);
    });

    it("Enter keydown fires onOpen", () => {
      const { dom } = makeDom();
      let called = false;
      const el = renderPin(dom, makePin(), 0, 1024, 768, { onOpen: () => { called = true; } }) as unknown as FakeEl;
      assert.ok(el !== null);
      el.dispatch("keydown", { key: "Enter", preventDefault: () => {} });
      assert.ok(called, "onOpen should be called on Enter");
    });

    it("Space keydown fires onOpen", () => {
      const { dom } = makeDom();
      let called = false;
      const el = renderPin(dom, makePin(), 0, 1024, 768, { onOpen: () => { called = true; } }) as unknown as FakeEl;
      assert.ok(el !== null);
      el.dispatch("keydown", { key: " ", preventDefault: () => {} });
      assert.ok(called, "onOpen should be called on Space");
    });
  });

  describe("viewport culling", () => {
    it("returns null for pin far outside viewport", () => {
      const { dom } = makeDom();
      // Pin rect is entirely off-screen to the right
      const rect = makeRect({ left: 2000, right: 2200, top: 100, bottom: 140 });
      const result = renderPin(dom, makePin({ rect }), 0, 1024, 768);
      assert.equal(result, null, "should return null for out-of-viewport pin");
    });

    it("returns element for pin inside viewport", () => {
      const { dom } = makeDom();
      const result = renderPin(dom, makePin(), 0, 1024, 768);
      assert.ok(result !== null, "should render pin inside viewport");
    });
  });

  describe("stack offset", () => {
    it("applies stackOffset to pin y position", () => {
      const { dom } = makeDom();
      const el1 = renderPin(dom, makePin(), 0, 1024, 768, { stackOffset: 0 }) as unknown as FakeEl;
      const el2 = renderPin(dom, makePin(), 0, 1024, 768, { stackOffset: 16 }) as unknown as FakeEl;
      assert.ok(el1 !== null && el2 !== null);
      const top1 = (el1.style as unknown as Record<string, string>)["top"] ?? "";
      const top2 = (el2.style as unknown as Record<string, string>)["top"] ?? "";
      assert.ok(top1 !== top2, "stacked pins should have different top positions");
    });
  });
});
