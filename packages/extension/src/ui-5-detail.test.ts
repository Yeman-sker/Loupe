import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderDetail } from "./ui/surface-detail.js";
import { renderViewAll } from "./ui/surface-view-all.js";
import { type PinRecord } from "./ui/surface-pin.js";
import { createI18n } from "./ui/i18n.js";

// ------------------------------------------------------------------ //
// Minimal fake DOM — same shape as ui-4-pin.test.ts FakeEl/FakeDoc.
// ------------------------------------------------------------------ //

type Listener = (e: unknown) => void;

class FakeClassList {
  private readonly list: string[] = [];
  add(...cls: string[]): void { for (const c of cls) if (!this.list.includes(c)) this.list.push(c); }
  remove(...cls: string[]): void { for (const c of cls) { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); } }
  contains(c: string): boolean { return this.list.includes(c); }
  toggle(c: string, force?: boolean): boolean {
    if (force !== undefined) { if (force) this.add(c); else this.remove(c); return force; }
    if (this.list.includes(c)) { this.remove(c); return false; } else { this.add(c); return true; }
  }
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
  children: FakeEl[] = [];
  id = "";

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  setAttribute(k: string, v: string): void { this.attributes.set(k, v); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  removeAttribute(k: string): void { this.attributes.delete(k); }

  addEventListener(type: string, listener: Listener): void {
    const arr = this._listeners.get(type) ?? [];
    arr.push(listener);
    this._listeners.set(type, arr);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const l of this._listeners.get(type) ?? []) l(event);
  }
  append(...nodes: FakeEl[]): void { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  appendChild(n: FakeEl): void { n.parentElement = this; this.children.push(n); }
  replaceChild(next: FakeEl, old: FakeEl): void {
    const idx = this.children.indexOf(old);
    if (idx >= 0) { this.children[idx] = next; next.parentElement = this; }
  }
  querySelector(sel: string): FakeEl | null {
    // minimal: match by class .x
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return this._findFirst((n) => n.classList.contains(cls));
    }
    return null;
  }
  querySelectorAll(_sel: string): FakeEl[] { return []; }
  private _findFirst(pred: (n: FakeEl) => boolean): FakeEl | null {
    if (pred(this)) return this;
    for (const c of this.children) { const f = c._findFirst(pred); if (f) return f; }
    return null;
  }
  get lastElementChild(): FakeEl | null { return this.children[this.children.length - 1] ?? null; }
}

class FakeDoc {
  createElement(tag: string): FakeEl { return new FakeEl(tag); }
  getElementById(_id: string): null { return null; }
}

function makeDom(): { dom: import("./ui/dom.js").Dom; created: FakeEl[] } {
  const doc = new FakeDoc();
  const created: FakeEl[] = [];
  const el = (
    tag: string,
    props: { class?: string; text?: string; attrs?: Record<string, string>; data?: Record<string, string>; style?: Record<string, string>; on?: Record<string, () => void> } = {},
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
    if (props.on !== undefined) for (const [evt, fn] of Object.entries(props.on)) node.addEventListener(evt, fn);
    for (const child of children) { child.parentElement = node; node.children.push(child); }
    created.push(node);
    return node;
  };
  return { dom: { el: el as unknown as import("./ui/dom.js").Dom["el"], clear: () => {} }, created };
}

function makeRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return { left: 100, top: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100, toJSON: () => ({}), ...overrides };
}

class FakeElement {
  tagName = "BUTTON";
  id = "";
  classList = new FakeClassList();
  scrollIntoView = (): void => { /* no-op */ };
}

function makePin(overrides: Partial<PinRecord> = {}): PinRecord {
  return {
    id: "pin-1",
    num: 1,
    element: new FakeElement() as unknown as Element,
    rect: makeRect(),
    kind: "bug",
    comment: "Fix the submit button colour",
    task: "open",
    loc: "located",
    confidence: 100,
    sync: "local",
    ...overrides,
  };
}

// ------------------------------------------------------------------ //

const { t } = createI18n("zh");

describe("UI-5 · surface-detail", () => {
  describe("renders correctly", () => {
    it("has detail + card class", () => {
      const { dom } = makeDom();
      const el = renderDetail(dom, makePin(), {
        t, onDone: () => {}, onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      }) as unknown as FakeEl;
      assert.ok(el.classList.contains("detail"), "has detail class");
      assert.ok(el.classList.contains("card"), "has card class");
    });

    it("is-done class when pin.task is done", () => {
      const { dom } = makeDom();
      const el = renderDetail(dom, makePin({ task: "done" }), {
        t, onDone: () => {}, onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      }) as unknown as FakeEl;
      assert.ok(el.classList.contains("is-done"), "is-done class for done pin");
    });

    it("not is-done for open pin", () => {
      const { dom } = makeDom();
      const el = renderDetail(dom, makePin({ task: "open" }), {
        t, onDone: () => {}, onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      }) as unknown as FakeEl;
      assert.ok(!el.classList.contains("is-done"), "no is-done for open pin");
    });

    it("shows pin number in d-target", () => {
      const { dom, created } = makeDom();
      renderDetail(dom, makePin({ num: 7 }), {
        t, onDone: () => {}, onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      });
      const ix = created.find((e) => e.classList.contains("ix"));
      assert.ok(ix !== undefined, "ix span exists");
      assert.equal(ix.textContent, "#7");
    });

    it("shows comment in d-comment", () => {
      const { dom, created } = makeDom();
      renderDetail(dom, makePin({ comment: "Hello test" }), {
        t, onDone: () => {}, onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      });
      const comment = created.find((e) => e.classList.contains("d-comment"));
      assert.ok(comment !== undefined, "d-comment exists");
      assert.equal(comment.textContent, "Hello test");
    });
  });

  describe("Mark done action", () => {
    it("calls onDone after clicking Mark done button", async () => {
      const { dom, created } = makeDom();
      let calledWith: string | null = null;
      renderDetail(dom, makePin({ id: "pin-abc" }), {
        t, onDone: (id) => { calledWith = id; },
        onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      });
      const doneBtn = created.find((e) => e.classList.contains("primary"));
      assert.ok(doneBtn !== undefined, "primary button exists");
      doneBtn.dispatch("click");
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(calledWith, "pin-abc", "onDone called with pin id");
    });

    it("primary done button is disabled and absent on done pin", () => {
      const { dom, created } = makeDom();
      renderDetail(dom, makePin({ task: "done" }), {
        t, onDone: () => {}, onDelete: () => {}, onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      });
      const primaryBtn = created.find((e) => e.classList.contains("primary"));
      assert.ok(primaryBtn === undefined, "no primary button for done pin");
    });
  });

  describe("Delete action — two-step arm", () => {
    it("first click arms the delete button (data-armed=1)", () => {
      const { dom, created } = makeDom();
      renderDetail(dom, makePin(), {
        t, onDone: () => {}, onDelete: () => {},
        onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      });
      const dangerBtn = created.find((e) => e.classList.contains("danger"));
      assert.ok(dangerBtn !== undefined, "danger button exists");
      assert.equal(dangerBtn.getAttribute("data-armed"), null, "not armed initially");
      dangerBtn.dispatch("click");
      assert.equal(dangerBtn.getAttribute("data-armed"), "1", "armed after first click");
    });

    it("second click calls onDelete", async () => {
      const { dom, created } = makeDom();
      let deletedId: string | null = null;
      renderDetail(dom, makePin({ id: "pin-del" }), {
        t, onDone: () => {}, onDelete: (id) => { deletedId = id; },
        onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => {}, onViewAll: () => {},
      });
      const dangerBtn = created.find((e) => e.classList.contains("danger"))!;
      dangerBtn.dispatch("click"); // arm
      dangerBtn.dispatch("click"); // confirm
      await new Promise((r) => setTimeout(r, 550));
      assert.equal(deletedId, "pin-del");
    });

    it("Esc while armed calls disarm (not close)", () => {
      const { dom, created } = makeDom();
      let closed = false;
      renderDetail(dom, makePin(), {
        t, onDone: () => {}, onDelete: () => {},
        onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => { closed = true; }, onViewAll: () => {},
      });
      const detailEl = created.find((e) => e.classList.contains("detail"))!;
      const dangerBtn = created.find((e) => e.classList.contains("danger"))!;
      dangerBtn.dispatch("click"); // arm
      detailEl.dispatch("keydown", { key: "Escape" }); // should disarm, not close
      assert.equal(closed, false, "not closed on Esc while armed");
      assert.equal(dangerBtn.getAttribute("data-armed"), null, "disarmed by Esc");
    });

    it("Esc when not armed calls onClose", () => {
      const { dom, created } = makeDom();
      let closed = false;
      renderDetail(dom, makePin(), {
        t, onDone: () => {}, onDelete: () => {},
        onCopyMarkdown: () => Promise.resolve(true),
        onClose: () => { closed = true; }, onViewAll: () => {},
      });
      const detailEl = created.find((e) => e.classList.contains("detail"))!;
      detailEl.dispatch("keydown", { key: "Escape" });
      assert.ok(closed, "onClose called on Esc when not armed");
    });
  });

  describe("Copy Markdown action", () => {
    it("calls onCopyMarkdown with pin id on click", async () => {
      const { dom, created } = makeDom();
      let copiedId: string | null = null;
      renderDetail(dom, makePin({ id: "pin-copy" }), {
        t, onDone: () => {}, onDelete: () => {},
        onCopyMarkdown: (id) => { copiedId = id; return Promise.resolve(true); },
        onClose: () => {}, onViewAll: () => {},
      });
      const ghostBtns = created.filter((e) => e.classList.contains("ghost") && e.tagName === "BUTTON");
      const copyBtn = ghostBtns.find((e) => e.textContent === t("detail.copy"));
      assert.ok(copyBtn !== undefined, "copy button exists");
      copyBtn.dispatch("click");
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(copiedId, "pin-copy");
    });
  });
});

describe("UI-5 · surface-view-all", () => {
  describe("renders list", () => {
    it("renders a va-list when pins exist", () => {
      const { dom, created } = makeDom();
      renderViewAll(dom, [makePin()], {
        t, route: "/home", currentId: null,
        onClose: () => {}, onJump: () => {}, onCopyAll: () => Promise.resolve(true),
        onStartPicking: () => {},
      });
      const list = created.find((e) => e.classList.contains("va-list"));
      assert.ok(list !== undefined, "va-list rendered");
    });

    it("renders va-empty when no pins", () => {
      const { dom, created } = makeDom();
      renderViewAll(dom, [], {
        t, route: "/home", currentId: null,
        onClose: () => {}, onJump: () => {}, onCopyAll: () => Promise.resolve(true),
        onStartPicking: () => {},
      });
      const empty = created.find((e) => e.classList.contains("va-empty"));
      assert.ok(empty !== undefined, "va-empty rendered for empty list");
    });

    it("marks current pin with cur class", () => {
      const { dom, created } = makeDom();
      renderViewAll(dom, [makePin({ id: "pin-cur" })], {
        t, route: "/", currentId: "pin-cur",
        onClose: () => {}, onJump: () => {}, onCopyAll: () => Promise.resolve(true),
        onStartPicking: () => {},
      });
      const curItem = created.find((e) => e.classList.contains("cur"));
      assert.ok(curItem !== undefined, "cur item marked");
    });

    it("filters out done pins when showDone is off (default)", () => {
      const { dom, created } = makeDom();
      renderViewAll(dom, [makePin({ task: "done" }), makePin({ id: "pin-2", num: 2, task: "open" })], {
        t, route: "/", currentId: null,
        onClose: () => {}, onJump: () => {}, onCopyAll: () => Promise.resolve(true),
        onStartPicking: () => {},
      });
      const items = created.filter((e) => e.classList.contains("va-item"));
      assert.equal(items.length, 1, "only open pin shown by default");
    });
  });

  describe("close button", () => {
    it("calls onClose when ✕ clicked", () => {
      const { dom, created } = makeDom();
      let closed = false;
      renderViewAll(dom, [], {
        t, route: "/", currentId: null,
        onClose: () => { closed = true; }, onJump: () => {},
        onCopyAll: () => Promise.resolve(true), onStartPicking: () => {},
      });
      const xBtn = created.find((e) => e.classList.contains("va-x"));
      assert.ok(xBtn !== undefined, "close button exists");
      xBtn.dispatch("click");
      assert.ok(closed, "onClose called");
    });

    it("calls onClose on Esc keydown", () => {
      const { dom, created } = makeDom();
      let closed = false;
      renderViewAll(dom, [], {
        t, route: "/", currentId: null,
        onClose: () => { closed = true; }, onJump: () => {},
        onCopyAll: () => Promise.resolve(true), onStartPicking: () => {},
      });
      const aside = created.find((e) => e.classList.contains("viewall"))!;
      aside.dispatch("keydown", { key: "Escape" });
      assert.ok(closed, "Esc closes panel");
    });
  });

  describe("jump to element", () => {
    it("calls onJump with pin when item clicked", () => {
      const { dom, created } = makeDom();
      let jumped: PinRecord | null = null;
      const pin = makePin({ id: "pin-j" });
      renderViewAll(dom, [pin], {
        t, route: "/", currentId: null,
        onClose: () => {}, onJump: (p) => { jumped = p; },
        onCopyAll: () => Promise.resolve(true), onStartPicking: () => {},
      });
      const item = created.find((e) => e.classList.contains("va-item"));
      assert.ok(item !== undefined);
      item.dispatch("click");
      assert.ok(jumped !== null, "onJump called");
      assert.equal((jumped as PinRecord).id, "pin-j");
    });
  });

  describe("Copy all button", () => {
    it("is ghost class when no fallback pins", () => {
      const { dom, created } = makeDom();
      renderViewAll(dom, [makePin({ sync: "synced" })], {
        t, route: "/", currentId: null,
        onClose: () => {}, onJump: () => {},
        onCopyAll: () => Promise.resolve(true), onStartPicking: () => {},
      });
      const foot = created.find((e) => e.classList.contains("va-foot"));
      assert.ok(foot !== undefined);
      const copyBtn = (foot.children ?? []).find((e: FakeEl) => e.classList.contains("ghost"));
      assert.ok(copyBtn !== undefined, "ghost copy button when synced");
    });

    it("is primary class when any pin is local-only", () => {
      const { dom, created } = makeDom();
      renderViewAll(dom, [makePin({ sync: "local" })], {
        t, route: "/", currentId: null,
        onClose: () => {}, onJump: () => {},
        onCopyAll: () => Promise.resolve(true), onStartPicking: () => {},
      });
      const foot = created.find((e) => e.classList.contains("va-foot"));
      assert.ok(foot !== undefined);
      const copyBtn = (foot.children ?? []).find((e: FakeEl) => e.classList.contains("primary"));
      assert.ok(copyBtn !== undefined, "primary copy button when local-only pin");
    });
  });
});
